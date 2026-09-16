import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/crm/leads/[id]` — eine Anfrage, ihr Verlauf und ihr
 * naechster Schritt (CRM-04, CRM-06).
 *
 * **Der Verlauf waechst, er wird nicht bearbeitet.** Eine Aktivitaet, die
 * sich nachtraeglich umschreiben laesst, ist kein Verlauf, sondern eine
 * Erzaehlung — deshalb gibt es hier ein Formular zum Anlegen und keines zum
 * Aendern.
 *
 * Der **naechste Schritt** steht dagegen auf dem Lead und wird ersetzt: er
 * ist eine Absicht ueber die Zukunft, kein Ereignis der Vergangenheit. Eine
 * Anfrage ohne naechsten Schritt sagt das ausdruecklich, statt still zu
 * liegen — genau so verliert man sie.
 */
export const dynamic = 'force-dynamic';

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen', in_bearbeitung: 'In Arbeit', qualifiziert: 'Bereit',
  angebot: 'Angebot', gewonnen: 'Abgeschlossen', verloren: 'Abgelehnt',
  kein_bedarf: 'Archiviert',
};

const TYP_TEXT: Readonly<Record<string, string>> = {
  notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin',
  aufgabe: 'Aufgabe', system: 'System',
};

interface Kopf {
  readonly id: string;
  readonly leadnummer: string;
  readonly betreff: string | null;
  readonly bedarf: string | null;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly punktzahl: number | null;
  readonly punktzahl_begruendung: string | null;
  readonly wert: string | null;
  readonly frist: string | null;
  readonly erste_reaktion: string | null;
  readonly naechste_aktion_text: string | null;
  readonly naechste_aktion_am: string | null;
  readonly besitzer: string | null;
  readonly kunde_id: string | null;
}

interface AktivitaetZeile {
  readonly id: string;
  readonly typ: string;
  readonly richtung: string;
  readonly betreff: string | null;
  readonly inhalt: string | null;
  readonly geschehen: string;
  readonly wer: string | null;
}

export default async function LeadDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/crm/leads/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select l.id, l.leadnummer, l.betreff, l.bedarf_zusammenfassung as bedarf,
                l.firma_name, l.quelle::text as quelle, l.status::text as status,
                l.prioritaet::text as prioritaet, l.punktzahl, l.punktzahl_begruendung,
                l.geschaetzter_wert_cent::text as wert,
                to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as frist,
                to_char(l.erste_reaktion_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as erste_reaktion,
                l.naechste_aktion_text,
                to_char(l.naechste_aktion_am at time zone 'Europe/Berlin', 'YYYY-MM-DD')
                  as naechste_aktion_am,
                b.name as besitzer, l.kunde_id
           from lead l
           left join benutzer b on b.id = l.besitzer_benutzer_id
          where l.id = $1`, [id]);
      if (kopf === undefined) return null;

      const verlauf = await kontext.abfrage<AktivitaetZeile>(
        `select a.id, a.typ::text as typ, a.richtung::text as richtung, a.betreff, a.inhalt,
                to_char(a.geschehen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as geschehen,
                b.name as wer
           from lead_aktivitaet a
           left join benutzer b on b.id = a.benutzer_id
          where a.lead_id = $1
          order by a.geschehen_am desc`, [id]);
      return { kopf, verlauf };
    })) as Promise<{ kopf: Kopf; verlauf: readonly AktivitaetZeile[] } | null>);

  if (daten === null) notFound();
  const { kopf, verlauf } = daten;

  return (
    <PortalRahmen
      titel={kopf.betreff ?? kopf.leadnummer}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/crm/leads`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Leads
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.betreff ?? 'Anfrage'}</h1>
        <StatusPill zustand={STATUS_PILLE[kopf.status] ?? 'Offen'} />
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.leadnummer}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Firma</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.firma_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Erste Reaktion
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.erste_reaktion ?? (
              <span className="text-warning">
                {kopf.frist === null ? 'offen' : `offen — Frist ${kopf.frist}`}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Geschätzter Wert
          </dt>
          <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
            {kopf.wert === null ? '—' : formatiereGeld(cent(BigInt(kopf.wert)))}
          </dd>
        </div>
      </dl>

      {kopf.bedarf === null ? null : (
        <p className="mb-s6 max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
          {kopf.bedarf}
        </p>
      )}

      <section aria-labelledby="naechster" className="mb-s7">
        <h2 id="naechster" className="text-h2 text-text">Nächster Schritt</h2>
        {kopf.naechste_aktion_text === null ? (
          <p data-cse="ohne-naechsten-schritt" className="text-sm text-warning">
            Nicht festgelegt. Eine Anfrage ohne nächsten Schritt liegt still —
            und genau so verliert man sie.
          </p>
        ) : (
          <p data-cse="naechster-schritt" className="text-sm text-text">
            {kopf.naechste_aktion_text}
            {kopf.naechste_aktion_am === null ? null : (
              <span className="ml-s2 text-text-muted">({kopf.naechste_aktion_am})</span>
            )}
          </p>
        )}

        <form
          method="post"
          action={`/api/lead?mandant=${mandant}`}
          className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="leadId" value={id} />

          <label className="block text-sm text-text" htmlFor="typ">Art</label>
          <select
            id="typ"
            name="typ"
            defaultValue="notiz"
            className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          >
            <option value="notiz">Notiz</option>
            <option value="anruf">Anruf</option>
            <option value="email">E-Mail</option>
            <option value="termin">Termin</option>
            <option value="aufgabe">Aufgabe</option>
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="inhalt">
            Was ist passiert?
          </label>
          <textarea
            id="inhalt"
            name="inhalt"
            rows={3}
            className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="naechsteAktion">
            Nächster Schritt
          </label>
          <input
            id="naechsteAktion"
            name="naechsteAktion"
            type="text"
            defaultValue={kopf.naechste_aktion_text ?? ''}
            className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <label className="mt-s4 block text-sm text-text" htmlFor="naechsteAktionAm">
            Wann
          </label>
          <input
            id="naechsteAktionAm"
            name="naechsteAktionAm"
            type="date"
            defaultValue={kopf.naechste_aktion_am ?? ''}
            className="mt-s2 min-h-11 rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
          />

          <button
            type="submit"
            data-cse="lead-notieren"
            className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            Festhalten
          </button>
        </form>
      </section>

      <section aria-labelledby="verlauf">
        <h2 id="verlauf" className="text-h2 text-text">Verlauf</h2>
        {verlauf.length === 0 ? (
          <p className="text-sm text-text-muted">Noch nichts festgehalten.</p>
        ) : (
          <ol data-cse="verlauf" className="m-0 list-none p-0">
            {verlauf.map((a) => (
              <li key={a.id} className="border-b border-line py-s4">
                <p className="m-0 text-micro uppercase tracking-[0.08em] text-text-subtle">
                  {`${TYP_TEXT[a.typ] ?? a.typ} · ${a.geschehen}`}
                  {a.wer === null ? '' : ` · ${a.wer}`}
                </p>
                {a.betreff === null ? null : (
                  <p className="m-0 mt-s1 text-sm text-text">{a.betreff}</p>
                )}
                {a.inhalt === null ? null : (
                  <p className="m-0 mt-s1 whitespace-pre-line text-sm text-text-muted">
                    {a.inhalt}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </PortalRahmen>
  );
}
