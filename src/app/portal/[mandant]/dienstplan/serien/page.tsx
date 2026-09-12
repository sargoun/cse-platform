import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { leseRegel, RegelFehler } from '@/lib/datum/rrule';
import { stundenAusMinuten } from '@/lib/datum/stunden';

/**
 * `/portal/[mandant]/dienstplan/serien` — TIM-02, TIM-03, CLN-02.
 *
 * Die Liste beantwortet die Frage, die im Plan selbst nicht steht: **woher
 * kommen diese Schichten?** Ein Dienstplan ohne diesen Weg ist eine
 * Behauptung; mit ihm ist er eine Ableitung, die jemand nachsehen kann.
 *
 * `generiert_bis` steht mit in der Liste, weil eine Serie, die stehen
 * geblieben ist, sonst aussieht wie eine Serie ohne Termine. Der Unterschied
 * ist der zwischen „nichts zu tun" und „der Generator laeuft nicht".
 */
export const dynamic = 'force-dynamic';

interface SerienZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly objekt: string;
  readonly revier: string | null;
  readonly rrule: string;
  readonly beginn_lokal: string;
  readonly dauer_minuten: number;
  readonly feiertagsregel: string;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  readonly generiert_bis: string | null;
  readonly archiviert: boolean;
  readonly einsaetze: number;
}

export default async function Serienliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/serien`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<SerienZeile>(
      /**
       * Die Zahl der Termine kommt aus demselben `select` — hundert Serien
       * waeren sonst hunderteins Abfragen, und die Liste waere genau dann
       * langsam, wenn sie sich lohnt.
       */
      `select ps.id, t.bezeichnung, o.bezeichnung as objekt, r.bezeichnung as revier,
              t.rrule,
              to_char(t.dtstart_lokal, 'HH24:MI')            as beginn_lokal,
              t.dauer_minuten,
              t.feiertagsregel::text                         as feiertagsregel,
              to_char(t.gueltig_ab, 'YYYY-MM-DD')            as gueltig_ab,
              to_char(t.gueltig_bis, 'YYYY-MM-DD')           as gueltig_bis,
              to_char(ps.generiert_bis, 'YYYY-MM-DD')        as generiert_bis,
              (ps.archiviert_am is not null)                 as archiviert,
              coalesce(e.anzahl, 0)::int                     as einsaetze
         from planungsserie ps
         join turnus t on t.mandant_id = ps.mandant_id and t.id = ps.turnus_id
         join revier r on r.mandant_id = t.mandant_id and r.id = t.revier_id
         join objekt o on o.mandant_id = r.mandant_id and o.id = r.objekt_id
         left join lateral (
                select count(*) as anzahl from einsatz e
                 where e.planungsserie_id = ps.id and e.storniert_am is null
              ) e on true
        order by ps.archiviert_am nulls first, o.bezeichnung, t.bezeichnung`,
    ))) as Promise<readonly SerienZeile[]>);

  return (
    <PortalRahmen
      titel="Serien"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Serien</h1>
        <Link
          href={`/portal/${mandant}/dienstplan/woche`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zum Dienstplan
        </Link>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Eine Serie beschreibt, wann eine Leistung wiederkehrt. Der nächtliche
        Generator schreibt daraus acht Wochen im Voraus Schichten — er legt keine
        an, die schon begonnen hat, und er löscht keine, sondern storniert sie
        mit Grund.
      </p>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Serie angelegt. Ohne Serie entstehen Schichten nur von Hand.
        </p>
      ) : (
        <DataTable
          beschriftung="Serien dieser Gesellschaft mit Regel, Zeitfenster und Generatorstand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Serie',
              zelle: (z) => (
                <span>
                  <span className="block text-text">{z.bezeichnung}</span>
                  <span className="block text-micro text-text-muted">
                    {z.objekt}{z.revier !== null ? ` · ${z.revier}` : ''}
                  </span>
                </span>
              ),
            },
            { schluessel: 'regel', kopf: 'Regel', zelle: (z) => lesbareRegel(z.rrule) },
            {
              schluessel: 'zeit',
              kopf: 'Zeitfenster',
              zelle: (z) => `${z.beginn_lokal} · ${stundenAusMinuten(z.dauer_minuten)}`,
            },
            {
              schluessel: 'feiertag',
              kopf: 'Am Feiertag',
              zelle: (z) => (z.feiertagsregel === 'ausfall' ? 'fällt aus' : 'findet statt'),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Gültig',
              zelle: (z) => (z.gueltig_bis === null
                ? `ab ${z.gueltig_ab}`
                : `${z.gueltig_ab} bis ${z.gueltig_bis}`),
            },
            {
              schluessel: 'stand',
              kopf: 'Geplant bis',
              zelle: (z) => (z.generiert_bis === null
                ? <span className="text-warning">noch nie gelaufen</span>
                : <span className="tabular-nums">{z.generiert_bis}</span>),
            },
            {
              schluessel: 'einsaetze', kopf: 'Schichten', numerisch: true,
              zelle: (z) => String(z.einsaetze),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={z.archiviert ? 'Archiviert' : 'Aktiv'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}

const TAGE: Readonly<Record<string, string>> = {
  MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So',
};

/**
 * Die RRULE in einem Satz — gelesen vom **selben Parser**, den der Generator
 * benutzt.
 *
 * Eine zweite, nur fuer die Anzeige geschriebene Auslegung waere die
 * gefaehrlichste Variante: sie zeigte „montags", waehrend der Generator
 * dienstags plant, und beides saehe richtig aus.
 *
 * Was der Parser nicht lesen kann, wird als Rohtext gezeigt und nicht
 * geraten — eine erfundene Zusammenfassung waere schlimmer als die Regel
 * selbst.
 */
function lesbareRegel(rrule: string): string {
  try {
    const r = leseRegel(rrule);
    const jede = r.interval === 1 ? 'jede' : `jede ${String(r.interval)}.`;
    if (r.freq === 'WEEKLY') {
      const tage = r.byday?.map((d) => TAGE[d] ?? d).join(', ');
      return tage === undefined ? `${jede} Woche` : `${jede} Woche · ${tage}`;
    }
    if (r.freq === 'DAILY') {
      return r.interval === 1 ? 'täglich' : `jeden ${String(r.interval)}. Tag`;
    }
    const tage = r.bymonthday?.map((d) => `${String(d)}.`).join(', ');
    return tage === undefined
      ? `${jede} Monat`
      : `${jede === 'jede' ? 'jeden' : jede} Monat · ${tage}`;
  } catch (fehler) {
    if (fehler instanceof RegelFehler) return rrule;
    throw fehler;
  }
}

