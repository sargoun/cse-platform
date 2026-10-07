import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { gelesenerHinweis } from '@/server/rueckmeldung/hinweis-keks';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/mandant` — die Unternehmensdaten dieser
 * Gesellschaft (TEN-01, TEN-02, TEN-09).
 *
 * **Was hier steht, steht auf jeder Rechnung und im Impressum** — deshalb
 * sagt die Seite zuerst, ob die Angaben bestätigt sind. Solange
 * `angaben_bestaetigt_am` leer ist, stammen Register, Steuernummern und Bank
 * aus dem Demonstrationsbestand (O-353); Anschrift und Kontakt kommen, wo es
 * einen gibt, aus dem bestehenden Auftritt (D-473).
 *
 * **Gepflegt und bestätigt wird hier** (V-390, D-804) — mit
 * `system.mandant_verwalten` und zweitem Faktor, über
 * `/api/einstellungen/mandant` und `app.mandant_angaben_setzen` (0494). Wer das
 * Recht nicht hält, sieht kein Formular (AUT-06): die Seite öffnet mit
 * `system.mandant_lesen`, und Felder, deren Speichern abgewiesen würde, wären
 * eine Einladung zu einem Fehler.
 */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly name: string;
  readonly firma: string;
  readonly rechtsform: string | null;
  /** `null` = nicht eingetragen (O-01). */
  readonly ist_rechtseinheit: boolean | null;
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

const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text';

/** Ein Eingabefeld des Pflegeformulars — Beschriftung über dem Feld, wie auf der Identitätsseite. */
function Eingabe({ name, label, wert, hinweis, pflicht }: {
  readonly name: string;
  readonly label: string;
  readonly wert: string | null;
  readonly hinweis?: string;
  readonly pflicht?: boolean;
}) {
  return (
    <div>
      <label className="mt-s4 block text-sm text-text" htmlFor={`angabe-${name}`}>{label}</label>
      <input id={`angabe-${name}`} name={name} type="text" className={FELD}
             defaultValue={wert ?? ''} required={pflicht === true} />
      {hinweis === undefined ? null : <p className="mt-s2 text-xs text-text-muted">{hinweis}</p>}
    </div>
  );
}

/** IBAN in Vierergruppen — Anzeige, keine Pruefung (die steht in `finanz/zahlung/iban.ts`). */
function gruppiert(iban: string | null): string | null {
  return iban === null ? null : iban.replace(/\s+/gu, '').replace(/(.{4})/gu, '$1 ').trim();
}

function rechtseinheitText(wert: boolean | null): string {
  if (wert === null) return 'nicht eingetragen — trägt der Betreiber ein (O-01); bis dahin keine Rechnung unter eigener Nummer';
  return wert ? 'ja — eigene Rechnungen' : 'nein';
}

export default async function Unternehmensdaten(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const hinweis = await gelesenerHinweis(`/portal/${mandant}/einstellungen/mandant`);
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

  const darf = await haeltRechte(zugang.sitzung, 'system.mandant_verwalten');
  const darfPflegen = darf['system.mandant_verwalten'] === true;
  const geschaeftsfuehrung = m.geschaeftsfuehrer === null || m.geschaeftsfuehrer.length === 0
    ? null : m.geschaeftsfuehrer.join(', ');

  return (
    <PortalRahmen
      titel="Unternehmensdaten"
      wurzelTitel={m.name}
      bereich={mandant as BereichSchluessel}
      nurLesen={!darfPflegen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Unternehmensdaten</h1>
      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="angaben-hinweis"
           className="mb-s5 max-w-prose rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}
      {m.bestaetigt_am === null ? (
        <p data-cse="angaben-unbestaetigt"
           className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          Register, Steuernummern und Bankverbindung sind nicht bestätigt (O-353): sie
          stammen aus dem Demonstrationsbestand oder wurden seit der letzten Bestätigung
          geändert. Anschrift und Kontakt kommen aus dem bestehenden Auftritt, wo es einen
          gibt (D-473). Bestätigt wird hier, nachdem die Geschäftsführung die Angaben
          geprüft hat — bis dahin sagt es auch das Impressum.
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
          <Feld label="Rechtseinheit" wert={rechtseinheitText(m.ist_rechtseinheit)} />
          <Feld label="Nummernkreis" wert={m.eigener_nummernkreis ? 'eigener Kreis (TEN-02)' : 'kein eigener Kreis'} />
          <Feld label="Geschäftsführung" wert={geschaeftsfuehrung} />
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

      {darfPflegen ? (
        <>
          <details data-cse="angaben-pflegen"
                   className="mt-s6 max-w-prose rounded-lg border border-line bg-surface p-s5">
            <summary className="min-h-11 cursor-pointer text-h3 text-text">Angaben pflegen</summary>
            <p className="mt-s2 text-xs text-text-muted">
              Jede Änderung steht im Protokoll (TEN-09) und nimmt die Bestätigung zurück.
              Festgeschriebene Rechnungen behalten die Angaben, mit denen sie
              festgeschrieben wurden.
            </p>
            <form method="post" action={`/api/einstellungen/mandant?mandant=${mandant}`}>
              <Eingabe name="firma" label="Firma" wert={m.firma} pflicht
                       hinweis="Der Name, unter dem die Gesellschaft im Register steht." />
              <Eingabe name="rechtsform" label="Rechtsform" wert={m.rechtsform} />
              <label className="mt-s4 block text-sm text-text" htmlFor="angabe-istRechtseinheit">
                Eigene Rechtseinheit
              </label>
              <select id="angabe-istRechtseinheit" name="istRechtseinheit" className={FELD}
                      defaultValue={m.ist_rechtseinheit === null ? 'offen' : m.ist_rechtseinheit ? 'ja' : 'nein'}>
                <option value="offen">nicht eingetragen (O-01)</option>
                <option value="ja">ja — stellt eigene Rechnungen</option>
                <option value="nein">nein — fakturiert über eine andere Gesellschaft</option>
              </select>
              <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
                <input type="checkbox" name="eigenerNummernkreis" value="ja"
                       defaultChecked={m.eigener_nummernkreis} />
                Eigener Rechnungsnummernkreis (TEN-02)
              </label>
              <p className="text-xs text-text-muted">
                Nur für eine eigene Rechtseinheit, und nur mit Straße, Postleitzahl, Ort und
                einer Steuernummer oder USt-IdNr. (§ 14 Abs. 4 UStG).
              </p>
              <label className="mt-s4 block text-sm text-text" htmlFor="angabe-geschaeftsfuehrer">
                Geschäftsführung
              </label>
              <textarea id="angabe-geschaeftsfuehrer" name="geschaeftsfuehrer" rows={2} className={FELD}
                        defaultValue={(m.geschaeftsfuehrer ?? []).join('\n')} />
              <p className="mt-s2 text-xs text-text-muted">Eine Person je Zeile.</p>

              <Eingabe name="handelsregisterGericht" label="Registergericht" wert={m.handelsregister_gericht} />
              <Eingabe name="handelsregisterNummer" label="Registernummer" wert={m.handelsregister_nummer} />
              <Eingabe name="ustId" label="USt-IdNr." wert={m.ust_id} hinweis="DE und neun Ziffern." />
              <Eingabe name="steuernummer" label="Steuernummer" wert={m.steuernummer} />
              <Eingabe name="finanzamt" label="Finanzamt" wert={m.finanzamt} />
              <Eingabe name="betriebsnummer" label="Betriebsnummer" wert={m.betriebsnummer} />

              <Eingabe name="strasse" label="Straße" wert={m.strasse} />
              <Eingabe name="plz" label="Postleitzahl" wert={m.plz} />
              <Eingabe name="ort" label="Ort" wert={m.ort} />
              <Eingabe name="land" label="Land" wert={m.land} hinweis="Zwei Buchstaben, zum Beispiel DE." />
              <Eingabe name="telefon" label="Telefon" wert={m.telefon} />
              <Eingabe name="email" label="E-Mail" wert={m.email} />
              <Eingabe name="web" label="Web" wert={m.web} />

              <Eingabe name="iban" label="IBAN" wert={gruppiert(m.iban)} />
              <Eingabe name="bic" label="BIC" wert={m.bic} />
              <Eingabe name="bank" label="Bank" wert={m.bank} />
              <Eingabe name="rechnungKontaktName" label="Ansprechperson Rechnung" wert={m.rechnung_kontakt_name}
                       hinweis="Die Kontaktstelle auf der XRechnung (BT-41)." />
              <Eingabe name="elektronischeAdresse" label="Elektronische Adresse" wert={m.elektronische_adresse}
                       hinweis="Zusammen mit ihrem Schema oder gar nicht (BT-34)." />
              <Eingabe name="elektronischeAdresseSchema" label="Schema der elektronischen Adresse"
                       wert={m.elektronische_adresse_schema}
                       hinweis="EAS-Code: 9930 USt-IdNr., 0204 Leitweg-ID, EM E-Mail." />

              <button type="submit"
                      className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
                Angaben speichern
              </button>
            </form>
          </details>

          <section data-cse="angaben-bestaetigen"
                   className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5">
            <h2 className="text-h3 text-text">Angaben bestätigen</h2>
            <p className="mt-s2 text-sm text-text-muted">
              Bestätigt wird, nachdem die Geschäftsführung die Angaben oben geprüft hat. Der
              Zeitpunkt kommt aus der Serveruhr, und die Bestätigung steht im Protokoll.
            </p>
            <form method="post" action={`/api/einstellungen/mandant?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="bestaetigen" />
              <button type="submit"
                      className="mt-s3 min-h-11 rounded-md border border-line bg-surface px-s4 text-sm font-semibold text-text hover:bg-surface-3">
                Angaben bestätigen
              </button>
            </form>
          </section>
        </>
      ) : null}

      <p className="mt-s5 text-sm text-text-subtle">
        Zuletzt geändert {m.geaendert_am ?? '—'}. Gepflegt und bestätigt wird von der
        Super-Administration; jede Änderung steht im Protokoll (TEN-09).
      </p>
    </PortalRahmen>
  );
}
