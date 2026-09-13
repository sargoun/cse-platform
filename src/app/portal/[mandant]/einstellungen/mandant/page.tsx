import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/mandant` — die Unternehmensdaten dieser
 * Gesellschaft (TEN-01, TEN-02), lesend.
 *
 * **Was hier steht, steht auf jeder Rechnung und im Impressum** — deshalb
 * sagt die Seite zuerst, ob die Angaben bestätigt sind. Solange
 * `angaben_bestaetigt_am` leer ist, stammen Register, Steuernummern und Bank
 * aus dem Demonstrationsbestand (O-353); Anschrift und Kontakt kommen, wo es
 * einen gibt, aus dem bestehenden Auftritt (D-473).
 */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly name: string;
  readonly firma: string;
  readonly rechtsform: string | null;
  readonly ist_rechtseinheit: boolean;
  readonly eigener_nummernkreis: boolean;
  readonly handelsregister_gericht: string | null;
  readonly handelsregister_nummer: string | null;
  readonly geschaeftsfuehrer: readonly string[] | null;
  readonly ust_id: string | null;
  readonly steuernummer: string | null;
  readonly finanzamt: string | null;
  readonly betriebsnummer: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string | null;
  readonly telefon: string | null;
  readonly email: string | null;
  readonly web: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
  readonly bank: string | null;
  readonly rechnung_kontakt_name: string | null;
  readonly elektronische_adresse: string | null;
  readonly elektronische_adresse_schema: string | null;
  readonly bestaetigt_am: string | null;
  readonly geaendert_am: string | null;
}

function Feld({ label, wert }: { readonly label: string; readonly wert: string | null | undefined }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 text-sm text-text">
        {wert === null || wert === undefined || wert === ''
          ? <span className="text-text-subtle">nicht hinterlegt</span> : wert}
      </dd>
    </div>
  );
}

function Abschnitt({ titel, kinder }: { readonly titel: string; readonly kinder: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-s5">
      <h2 className="mb-s4 text-h3 text-text">{titel}</h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3">{kinder}</dl>
    </section>
  );
}

/** IBAN in Vierergruppen — Anzeige, keine Pruefung (die steht in `finanz/zahlung/iban.ts`). */
function gruppiert(iban: string | null): string | null {
  return iban === null ? null : iban.replace(/\s+/gu, '').replace(/(.{4})/gu, '$1 ').trim();
}

export default async function Unternehmensdaten(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/mandant`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const [m] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select name, firma, rechtsform, ist_rechtseinheit, eigener_nummernkreis,
              handelsregister_gericht, handelsregister_nummer, geschaeftsfuehrer,
              ust_id, steuernummer, finanzamt, betriebsnummer,
              strasse, plz, ort, land, telefon, email, web, iban, bic, bank,
              rechnung_kontakt_name, elektronische_adresse, elektronische_adresse_schema,
              to_char(angaben_bestaetigt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as bestaetigt_am,
              to_char(geaendert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as geaendert_am
         from mandant where id = $1`, [mandantId]))) as Promise<readonly Zeile[]>);
  if (m === undefined) notFound();

  return (
    <PortalRahmen
      titel="Unternehmensdaten"
      wurzelTitel={m.name}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Unternehmensdaten</h1>
      {m.bestaetigt_am === null ? (
        <p data-cse="angaben-unbestaetigt"
           className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Register, Steuernummern und Bankverbindung sind nicht bestätigt (O-353): sie
          stammen aus dem Demonstrationsbestand. Anschrift und Kontakt kommen aus dem
          bestehenden Auftritt, wo es einen gibt (D-473). Bestätigt werden die Angaben
          von der Geschäftsführung — bis dahin sagt es auch das Impressum.
        </p>
      ) : (
        <p data-cse="angaben-bestaetigt" className="mb-s5 text-sm text-text-muted">
          Angaben bestätigt am {m.bestaetigt_am}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-s4 lg:grid-cols-2">
        <Abschnitt titel="Gesellschaft" kinder={<>
          <Feld label="Marke" wert={m.name} />
          <Feld label="Firma" wert={m.firma} />
          <Feld label="Rechtsform" wert={m.rechtsform} />
          <Feld label="Rechtseinheit" wert={m.ist_rechtseinheit ? 'ja — eigene Rechnungen, eigener Nummernkreis' : 'nein'} />
          <Feld label="Nummernkreis" wert={m.eigener_nummernkreis ? 'eigener Kreis (TEN-02)' : 'kein eigener Kreis'} />
          <Feld label="Geschäftsführung" wert={m.geschaeftsfuehrer === null || m.geschaeftsfuehrer.length === 0 ? null : m.geschaeftsfuehrer.join(', ')} />
        </>} />
        <Abschnitt titel="Register und Steuern" kinder={<>
          <Feld label="Registergericht" wert={m.handelsregister_gericht} />
          <Feld label="Registernummer" wert={m.handelsregister_nummer} />
          <Feld label="USt-IdNr." wert={m.ust_id} />
          <Feld label="Steuernummer" wert={m.steuernummer} />
          <Feld label="Finanzamt" wert={m.finanzamt} />
          <Feld label="Betriebsnummer" wert={m.betriebsnummer} />
        </>} />
        <Abschnitt titel="Anschrift und Kontakt" kinder={<>
          <Feld label="Straße" wert={m.strasse} />
          <Feld label="Ort" wert={[m.plz, m.ort].filter((t) => t !== null && t !== '').join(' ') || null} />
          <Feld label="Land" wert={m.land} />
          <Feld label="Telefon" wert={m.telefon} />
          <Feld label="E-Mail" wert={m.email} />
          <Feld label="Web" wert={m.web} />
        </>} />
        <Abschnitt titel="Rechnung und Bank" kinder={<>
          <Feld label="IBAN" wert={gruppiert(m.iban)} />
          <Feld label="BIC" wert={m.bic} />
          <Feld label="Bank" wert={m.bank} />
          <Feld label="Ansprechperson Rechnung" wert={m.rechnung_kontakt_name} />
          <Feld label="Elektronische Adresse" wert={m.elektronische_adresse === null ? null
            : `${m.elektronische_adresse}${m.elektronische_adresse_schema === null ? '' : ` (${m.elektronische_adresse_schema})`}`} />
        </>} />
      </div>
      <p className="mt-s5 text-sm text-text-subtle">
        Zuletzt geändert {m.geaendert_am ?? '—'}. Geändert wird über die Super-Administration;
        jede Änderung steht im Protokoll (TEN-09).
      </p>
    </PortalRahmen>
  );
}
