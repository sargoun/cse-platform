import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenText } from '@/server/services/dienstplan/wochenraster';
import { beschriftung } from '../../daten';

/**
 * `/portal/[mandant]/dienstplan/einsatz/[id]` — die einzelne Schicht.
 *
 * Sie ist das Ziel jedes Blocks im Plan (DSH-04: keine Zahl ohne Weg zu ihren
 * Zeilen) und zeigt, was an dieser Schicht haengt: Zeitfenster, Objekt,
 * Besetzung — und, sobald PR 31/32 sie liefern, Qualifikation und ArbZG.
 *
 * **Die Besetzung nennt Anstellungen, nicht Personen** (D-09). Wer fuer zwei
 * Gesellschaften arbeitet, ist EIN Mensch mit zwei Beschaeftigungen; die
 * Schicht gehoert einer davon, und die Anzeige sagt welcher.
 *
 * Eine fremde Schicht ist **404 und nie 403** (AUT-06): die Existenz einer
 * Zeile in einem anderen Mandanten ist selbst eine Auskunft.
 */
export const dynamic = 'force-dynamic';

interface Kopf {
  readonly id: string;
  readonly plan_datum: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly endet_am_folgetag: boolean;
  readonly zeitanomalie: string;
  readonly status: string;
  readonly quelle: string;
  readonly quell_schluessel: string;
  readonly soll: number;
  readonly besetzt: number;
  readonly objekt: string;
  readonly objekt_id: string;
  readonly kunde: string | null;
  readonly revier: string | null;
  readonly feiertag: string | null;
  readonly storno_grund: string | null;
}

interface Besetzung {
  readonly id: string;
  readonly name: string;
  readonly personalnummer: string | null;
  readonly funktion: string | null;
  readonly status: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
}

export default async function Einsatzblatt({
  params,
}: { params: Promise<{ mandant: string; id: string }> }) {
  const { mandant, id } = await params;
  const pfad = `/portal/${mandant}/dienstplan/einsatz/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select e.id, to_char(e.plan_datum,'YYYY-MM-DD') as plan_datum,
                e.beginn_zeitpunkt as beginn, e.ende_zeitpunkt as ende,
                to_char(e.beginn_lokal,'HH24:MI') as beginn_lokal,
                to_char(e.ende_lokal,'HH24:MI')   as ende_lokal,
                e.endet_am_folgetag,
                e.zeitanomalie::text as zeitanomalie,
                e.status::text as status, e.quelle::text as quelle, e.quell_schluessel,
                e.soll_besetzung::int as soll, e.besetzt_anzahl::int as besetzt,
                o.bezeichnung as objekt, o.id as objekt_id,
                k.name as kunde, r.bezeichnung as revier,
                f.bezeichnung as feiertag, e.storno_grund
           from einsatz e
           join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
           left join kunde  k on k.mandant_id = e.mandant_id and k.id = e.kunde_id
           left join revier r on r.mandant_id = e.mandant_id and r.id = e.revier_id
           left join feiertag f on f.id = e.feiertag_id
          where e.id = $1`,
        [id],
      );
      if (kopf === undefined) return null;

      const besetzung = await kontext.abfrage<Besetzung>(
        /**
         * Ueber `anstellung` und `person` — und die Personalnummer kommt aus
         * der ANSTELLUNG, weil sie je Gesellschaft eine eigene ist. Ein Mensch
         * mit zwei Beschaeftigungen hat zwei; sie zu mischen waere D-09
         * genau falsch herum.
         */
        `select z.id,
                (p.vorname || ' ' || p.nachname) as name,
                a.personalnummer, z.funktion, z.status::text as status,
                to_char((z.beginn_zeitpunkt at time zone 'Europe/Berlin'), 'HH24:MI') as beginn_lokal,
                to_char((z.ende_zeitpunkt   at time zone 'Europe/Berlin'), 'HH24:MI') as ende_lokal
           from einsatz_zuordnung z
           join anstellung a on a.mandant_id = z.mandant_id and a.id = z.anstellung_id
           join person p     on p.id = a.person_id
          where z.einsatz_id = $1 and z.entfernt_am is null
          order by p.nachname, p.vorname`,
        [id],
      );
      return { kopf, besetzung };
    }));

  // AUT-06: eine fremde oder nicht vorhandene Zeile ist 404, nie 403.
  if (daten === null) notFound();
  const { kopf, besetzung } = daten;
  const dauer = stundenText({ id: kopf.id, beginn: new Date(kopf.beginn), ende: new Date(kopf.ende) });

  return (
    <PortalRahmen
      titel="Schicht"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/dienstplan/woche?woche=${kopf.plan_datum}`}
          className="inline-flex items-center gap-s2 text-sm text-text-muted hover:text-text"
        >
          <Icon name="pfeil-rechts" groesse="sm" className="rotate-180" />
          Zurück zum Dienstplan
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.objekt}</h1>
        <StatusPill zustand={statusPille(kopf.status)} />
      </div>

      <dl className="m-0 grid gap-s4 sm:grid-cols-2 lg:grid-cols-3">
        <Feld beschriftung="Tag" wert={beschriftung(kopf.plan_datum)} />
        <Feld
          beschriftung="Zeitfenster (Berlin)"
          wert={`${kopf.beginn_lokal}–${kopf.ende_lokal}${kopf.endet_am_folgetag ? ' (Folgetag)' : ''}`}
        />
        <Feld beschriftung="Dauer" wert={dauer} />
        <Feld beschriftung="Kunde" wert={kopf.kunde ?? 'ohne Kundenbezug'} />
        <Feld beschriftung="Revier" wert={kopf.revier ?? '—'} />
        <Feld
          beschriftung="Besetzung"
          wert={`${String(kopf.besetzt)} von ${String(kopf.soll)}`}
          hinweis={kopf.besetzt < kopf.soll ? 'unterbesetzt' : null}
        />
      </dl>

      {kopf.zeitanomalie !== 'keine' && (
        <p
          data-cse="zeitanomalie"
          className="mt-s5 rounded-md bg-warning-soft px-s3 py-s2 text-sm text-warning"
        >
          {kopf.zeitanomalie === 'dst_luecke'
            ? 'Zeitumstellung: die geplante Ortszeit gibt es an diesem Tag nicht — die Schicht '
              + 'beginnt zum Umstellungszeitpunkt.'
            : 'Zeitumstellung: die geplante Ortszeit gibt es an diesem Tag zweimal — gerechnet '
              + 'wird mit dem früheren Zeitpunkt (offen: O-163).'}
        </p>
      )}

      {kopf.feiertag !== null && (
        <p className="mt-s3 rounded-md bg-info-soft px-s3 py-s2 text-sm text-info">
          Feiertag: {kopf.feiertag} — die Schicht findet trotzdem statt.
        </p>
      )}

      {kopf.storno_grund !== null && (
        <p className="mt-s3 rounded-md bg-danger-soft px-s3 py-s2 text-sm text-danger">
          Storniert: {kopf.storno_grund}
        </p>
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Besetzung</h2>
      {besetzung.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch niemand eingeteilt. Die Einteilung nennt eine Beschäftigung, nicht
          eine Person — wer für zwei Gesellschaften arbeitet, ist ein Mensch mit
          zwei Beschäftigungen, und die Schicht gehört genau einer davon (D-09).
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {besetzung.map((b) => (
            <li
              key={b.id}
              data-cse="besetzung"
              className="flex flex-wrap items-baseline justify-between gap-s3 border-b border-line py-s3"
            >
              <span className="text-sm text-text">{b.name}</span>
              <span className="text-sm tabular-nums text-text-muted">
                {b.beginn_lokal}–{b.ende_lokal}
                {b.personalnummer !== null ? ` · ${b.personalnummer}` : ''}
                {b.funktion !== null ? ` · ${b.funktion}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Die Felder für Qualifikation und ArbZG stehen NICHT hier, solange sie
        nichts anzeigen können. Ein leeres Panel „Keine Verstöße" wäre eine
        Aussage, die niemand geprüft hat — und genau die Sorte stiller
        Falschauskunft, gegen die K-06 geschrieben ist.
      */}
      <p className="mt-s6 text-micro text-text-subtle">
        Herkunft: {kopf.quelle} · Schlüssel <code className="tabular-nums">{kopf.quell_schluessel}</code>
      </p>
    </PortalRahmen>
  );
}

function Feld({
  beschriftung: label, wert, hinweis = null,
}: { readonly beschriftung: string; readonly wert: string; readonly hinweis?: string | null }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-s4">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className="m-0 mt-s1 text-base text-text">
        {wert}
        {hinweis !== null && <span className="ml-s2 text-sm text-warning">{hinweis}</span>}
      </dd>
    </div>
  );
}

/** Der Status der Schicht auf das feste Vokabular von DESIGN §5 abgebildet. */
function statusPille(status: string): 'In Arbeit' | 'Geplant' | 'Abgeschlossen' | 'Abgelehnt' {
  switch (status) {
    case 'laufend': return 'In Arbeit';
    case 'abgeschlossen': return 'Abgeschlossen';
    case 'storniert': return 'Abgelehnt';
    default: return 'Geplant';
  }
}
