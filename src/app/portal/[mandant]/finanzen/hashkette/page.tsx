import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { ALGORITHMUS, GENESIS } from '@/server/services/finanz/hash-chain';
import { meldung, pruefeKette, type KettenBefund, type KettenBruch }
  from '@/server/services/finanz/kettenlauf';
import {
  kettenkoepfe, letzterKettenlauf, type Kettenkopf, type Kettenlauf,
} from '@/server/services/finanz/kreisuebersicht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/finanzen/hashkette` — der **Prüfbericht** der
 * Rechnungs-Hashkette (04-SEITENKARTE.md §5.14, FIN-06, LEG-01).
 *
 * **Der GESPEICHERTE Lauf steht oben, die Live-Prüfung hinter einem Knopf.**
 * Der Nachtlauf `kette_pruefen` (20 3 * * *) rechnet die Kette jede Nacht nach
 * und schreibt Ergebnis und Meldung nach `job_lauf` / `job_lauf_mandant`. Das
 * ist der Bericht. `pruefeKette()` rechnet sie LIVE nach — bei wenigen Gliedern
 * unkritisch, bei Jahrgangsgrösse eine Abfrage über jede Rechnung des Jahres,
 * und deshalb nicht das, was bei jedem Seitenaufruf läuft. Mit
 * `?nachrechnen=jetzt` passiert es ausdrücklich.
 *
 * **Hat der Nachtlauf nie gelaufen, sagt die Seite das.** Ein leerer
 * Berichtsblock, der aussieht wie „keine Befunde", ist die gefährlichste
 * Darstellung dieser Seite: er behauptet eine Prüfung, die nicht stattgefunden
 * hat. In einer frischen Datenbank ist `job_lauf` leer, und genau dann steht
 * hier „noch nie gelaufen" und nicht „in Ordnung".
 *
 * **Ein Bruch wird mit seiner Bruchart benannt, nicht mit einer Farbe** —
 * falscher Vorgänger, falscher Nutzlast-Hash, fehlendes Glied, falscher
 * Kettenkopf, falscher Übergang zum Vorgängerkreis. Mit Rechnungsnummer,
 * Kreis und Position, denn danach sucht jemand.
 *
 * **Die Seite ändert nichts und löst keinen Lauf aus.** Ein Prüfer, der
 * repariert, bezeugt nichts mehr (§5.7); ein Knopf, der den Nachtlauf startet,
 * bräuchte das Betriebsgeheimnis und stünde damit an der falschen Stelle.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Hashkette — Finanzen' };

const ERGEBNIS_PILLE: Readonly<Record<string, PillZustand>> = {
  erfolg: 'Abgeschlossen',
  teilweise: 'Fehler',
  fehler: 'Fehler',
  abgebrochen: 'Fehler',
};

/**
 * Die zwei Befunde der Kettenkopf-Tabelle — als eigene Konstanten und nicht
 * über die Zuordnung geholt.
 *
 * `kopfStimmt` und `uebergangStimmt` sind BOOLESCHE Spalten aus
 * `kettenkoepfe()`, kein `KettenBruch`. Sie über `BRUCH_TEXT['…']` zu lesen
 * hiess, einen Schlüssel zu raten, den der Typechecker nicht prüft — genau so
 * entstand die textlose rote Pille. Jetzt stehen die Sätze da, wo sie
 * gebraucht werden, und `BRUCH_TEXT` benutzt sie mit.
 */
const TEXT_KOPF =
  'Der Kettenkopf des Kreises weicht vom Hash seines letzten Gliedes ab.';

const TEXT_UEBERGANG =
  'Der Genesis-Hash dieses Kreises ist nicht der letzte Hash seines Vorgängers '
  + '(§5.7 Schritt 3b).';

/**
 * Die Bruchart in einem Satz, den ein Mensch lesen kann.
 *
 * **`Record<KettenBruch['grund'], string>` und nicht `Record<string, string>`.**
 * Die erste Fassung war auf `string` getippt und traf mit ihren sieben
 * erfundenen Schlüsseln — `falscher_vorgaenger`, `falscher_hash`, `luecke` …
 * — KEINEN einzigen echten Bruchgrund. In der Live-Tabelle fiel sie auf den
 * rohen Enum-Bezeichner zurück; in der Kettenkopf-Tabelle stand ein fester
 * Zugriff ohne `??`-Rückfall und ergab `undefined`, also eine rote Pille ohne
 * Text — bei `!kopfStimmt`, dem wichtigsten Befund dieser Seite. Der
 * Typechecker meldete nichts, weil `string | undefined` ein gültiges
 * React-Kind ist.
 *
 * Auf `KettenBruch['grund']` getippt meldet er jede künftige Abweichung: ein
 * neuer Bruchgrund in `hash-chain.ts` oder `kettenlauf.ts` macht diese Zuordnung
 * unvollständig, und das ist ein Fehler beim Übersetzen und nicht eine leere
 * Zelle beim Kunden.
 */
const BRUCH_TEXT: Readonly<Record<KettenBruch['grund'], string>> = {
  hash_falsch:
    'Der gespeicherte Hash stimmt nicht mit dem überein, der sich aus Nutzlast '
    + 'und Vorgänger ergibt.',
  nutzlast_veraendert:
    'Der Nutzlast-Hash passt nicht zu den Bytes des Snapshots — der Beleginhalt '
    + 'ist ein anderer als der, über den gehasht wurde.',
  verkettung_gebrochen:
    'Das Glied nennt einen anderen Vorgänger-Hash als den seines Vorgängers — '
    + 'zwischen beiden fehlt etwas oder es wurde eines ersetzt.',
  position_luecke:
    'Die Kettenposition springt oder wiederholt sich — zwischen zwei Gliedern '
    + 'liegt eine Lücke.',
  format_ungueltig:
    'Der Hash ist kein Hex-64. Er kann damit aus keinem SHA-256 stammen, und '
    + 'nachrechnen lässt sich an dieser Stelle nichts mehr.',
  kopf_weicht_ab: TEXT_KOPF,
  ohne_kettenglied:
    'Eine Kettenposition fehlt: eine festgeschriebene Rechnung ohne Kettensatz.',
  kreisuebergang_gebrochen: TEXT_UEBERGANG,
  kettenkopf_weicht_ab:
    'Der in `nummernkreis.letzter_hash` gespeicherte Kettenkopf ist nicht der '
    + 'Hash des letzten Gliedes dieses Kreises.',
};

function kurz(hash: string | null): string {
  return hash === null ? '—' : `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}

export default async function Hashkettenblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const nachrechnen = suche['nachrechnen'] === 'jetzt';

  const tor = await mandantTor(`/portal/${mandant}/finanzen/hashkette`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Diese Seite öffnet mit `finanzen.lesen`; die Nummernkreise daneben
   * verlangen `nummernkreis.lesen`. Wer die Kette lesen darf, darf nicht
   * zwangsläufig die Kreise verwalten — der Verweis führte dann auf 404 und
   * verriete, was er verbirgt (AUT-06, D-581).
   */
  const darf = await haeltRechte(sitzung, 'nummernkreis.lesen', 'finanzen.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      lauf: await letzterKettenlauf(kontext),
      koepfe: await kettenkoepfe(kontext),
      live: nachrechnen ? await pruefeKette(kontext) : null,
    }))) as Promise<{
      lauf: Kettenlauf | null;
      koepfe: readonly Kettenkopf[];
      live: KettenBefund | null;
    }>);

  const abweichendeKoepfe = daten.koepfe.filter((k) => !k.kopfStimmt || !k.uebergangStimmt);

  return (
    <PortalRahmen
      titel="Hashkette"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Hashkette der Ausgangsrechnungen</h1>
        <form method="get">
          <input type="hidden" name="nachrechnen" value="jetzt" />
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
            data-cse="hashkette-nachrechnen"
          >
            Jetzt nachrechnen
          </button>
        </form>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Jede festgeschriebene Rechnung trägt{' '}
        <code className="text-xs">hash = SHA256(Nutzlast ‖ vorheriger Hash)</code>{' '}
        (Algorithmus <strong>{ALGORITHMUS}</strong>). Wird ein Beleg nachträglich
        verändert, passt sein Hash nicht mehr — und alle folgenden auch nicht.
        Das ist der Nachweis, den §146 AO und die GoBD verlangen.
      </p>

      <section aria-labelledby="nachtlauf-titel" className="mb-s7">
        <h2 id="nachtlauf-titel" className="mb-s3 text-h2 text-text">
          Der nächtliche Prüflauf
        </h2>
        {daten.lauf === null ? (
          <Hinweis art="warnung" cse="hashkette-kein-lauf">
            <p className="m-0 max-w-prose">
              <strong>Der Prüflauf <code>kette_pruefen</code> ist hier noch nie
              gelaufen.</strong> Er ist im Jobregister eingetragen (täglich 03:20
              Berliner Zeit), aber es liegt kein Ergebnis vor. Das heisst
              <strong> nicht</strong>, dass die Kette in Ordnung ist — es heisst,
              dass niemand nachgerechnet hat. „Jetzt nachrechnen" oben rechnet
              sie für diesen Aufruf nach, ohne etwas zu speichern.
            </p>
          </Hinweis>
        ) : (
          <div
            data-cse="hashkette-nachtlauf"
            data-ergebnis={daten.lauf.mandantErgebnis ?? daten.lauf.ergebnis}
            className={`rounded-lg border p-s5 text-sm ${
              (daten.lauf.mandantErgebnis ?? daten.lauf.ergebnis) === 'erfolg'
                ? 'border-line bg-surface text-text'
                : 'border-warning bg-warning-soft text-warning'}`}
          >
            <p className="m-0 flex flex-wrap items-center gap-s3">
              <StatusPill
                zustand={ERGEBNIS_PILLE[daten.lauf.mandantErgebnis ?? daten.lauf.ergebnis]
                  ?? 'Offen'}
              />
              <span className="text-text">
                Gestartet {daten.lauf.gestartetAm}
                {daten.lauf.beendetAm === null
                  ? ' — noch nicht beendet'
                  : `, beendet ${daten.lauf.beendetAm}`}
              </span>
            </p>
            <p className="m-0 mt-s3 max-w-prose">
              {daten.lauf.meldung
                ?? 'Der Lauf hat für diese Gesellschaft keine Meldung hinterlassen.'}
            </p>
            {daten.lauf.geprueft === null ? null : (
              <p className="m-0 mt-s2 text-xs text-text-muted">
                Geprüfte Rechnungen im Lauf: {daten.lauf.geprueft}
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="koepfe-titel" className="mb-s7">
        <h2 id="koepfe-titel" className="mb-s3 text-h2 text-text">
          Die Kettenköpfe je Nummernkreis
        </h2>

        {abweichendeKoepfe.length === 0 ? null : (
          <Hinweis art="warnung" cse="hashkette-kopf-abweichung" className="mb-s3">
            <p className="m-0 max-w-prose">
              {abweichendeKoepfe.length === 1
                ? 'Ein Kreis trägt einen Kopf, der nicht zu seinen Gliedern passt.'
                : `${String(abweichendeKoepfe.length)} Kreise tragen einen Kopf, der `
                  + 'nicht zu ihren Gliedern passt.'}{' '}
              Das ist kein Rechenfehler: entweder fehlt ein Glied, oder es wurde
              eines ausgetauscht. Die Zeilen unten sind markiert.
            </p>
          </Hinweis>
        )}

        {daten.koepfe.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diese Gesellschaft ist kein Rechnungs- oder Gutschriftenkreis
            eingerichtet. Ohne Kreis gibt es keine Kette — und keine
            festgeschriebene Rechnung.
          </p>
        ) : (
          <DataTable
            beschriftung="Genesis-Hash, letzter Hash und Kettenlänge je Nummernkreis"
            zeilen={daten.koepfe}
            schluessel={(z) => z.nummernkreisId}
            spalten={[
              {
                schluessel: 'kreis',
                kopf: 'Kreis',
                zelle: (z) => (darf['nummernkreis.lesen'] !== true ? z.bezeichnung : (
                  <Link
                    href={`/portal/${mandant}/finanzen/nummernkreise`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.bezeichnung}
                  </Link>
                )),
              },
              {
                schluessel: 'jahr', kopf: 'Jahr', numerisch: true,
                zelle: (z) => (z.jahr === 0 ? 'fortlaufend' : z.jahr),
              },
              {
                schluessel: 'genesis', kopf: 'Genesis',
                zelle: (z) => (
                  <span className="font-mono text-xs text-text-muted">
                    {z.genesisHash === null
                      ? `${kurz(GENESIS)} (Vorgabe)`
                      : kurz(z.genesisHash)}
                  </span>
                ),
              },
              {
                schluessel: 'letzter', kopf: 'Letzter Hash',
                zelle: (z) => (
                  <span className="font-mono text-xs text-text-muted">
                    {kurz(z.letzterHash)}
                  </span>
                ),
              },
              {
                schluessel: 'laenge', kopf: 'Glieder', numerisch: true,
                zelle: (z) => z.kettenlaenge,
              },
              {
                schluessel: 'befund',
                kopf: 'Befund',
                zelle: (z) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {z.kopfStimmt && z.uebergangStimmt
                      ? <StatusPill zustand="Abgeschlossen" />
                      : <StatusPill zustand="Fehler" />}
                    <span className="text-xs text-text-muted">
                      {!z.kopfStimmt
                        ? TEXT_KOPF
                        : !z.uebergangStimmt
                          ? `${TEXT_UEBERGANG} Vorgänger: `
                            + `${z.vorgaengerBezeichnung ?? '—'}`
                          : z.hoechstePosition === null
                            ? 'kein Glied'
                            : `Kopf und letztes Glied stimmen überein, Position `
                              + `${String(z.hoechstePosition)}`}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section aria-labelledby="live-titel">
        <h2 id="live-titel" className="mb-s3 text-h2 text-text">
          Nachgerechnet, Glied für Glied
        </h2>
        {daten.live === null ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Nicht nachgerechnet. Die Live-Prüfung liest jedes Glied und rechnet
            jeden Hash neu — das kostet mit der Menge und läuft deshalb nicht bei
            jedem Seitenaufruf, sondern nur auf „Jetzt nachrechnen". Sie
            speichert nichts: ein Prüfer, der schreibt, bezeugt nichts mehr.
          </p>
        ) : (
          <>
            <div
              data-cse="hashkette-live"
              data-ok={String(daten.live.ok)}
              className={`mb-s3 rounded-lg border p-s5 text-sm ${
                daten.live.ok
                  ? 'border-line bg-surface text-text'
                  : 'border-warning bg-warning-soft text-warning'}`}
            >
              <p className="m-0 max-w-prose">{meldung(daten.live)}</p>
            </div>

            {daten.live.kreise.length === 0 ? null : (
              <DataTable
                beschriftung="Befund je Nummernkreis aus der Live-Prüfung"
                zeilen={daten.live.kreise}
                schluessel={(z) => z.nummernkreisId}
                spalten={[
                  { schluessel: 'kreis', kopf: 'Kreis', zelle: (z) => z.bezeichnung },
                  {
                    schluessel: 'geprueft', kopf: 'Geprüfte Glieder', numerisch: true,
                    zelle: (z) => z.geprueft,
                  },
                  {
                    schluessel: 'bruch',
                    kopf: 'Befund',
                    zelle: (z) => (z.bruch === null ? (
                      <StatusPill zustand="Abgeschlossen" />
                    ) : (
                      <span className="inline-flex flex-col gap-s1">
                        <span className="inline-flex flex-wrap items-center gap-s2">
                          <StatusPill zustand="Fehler" />
                          <span className="text-xs text-text">
                            Rechnung {z.bruch.nummer}, Position {z.bruch.position}
                          </span>
                        </span>
                        <span className="max-w-prose text-xs text-text-muted">
                          {BRUCH_TEXT[z.bruch.grund]}
                        </span>
                        <span className="font-mono text-xs text-text-muted">
                          erwartet {kurz(z.bruch.erwartet)} · gefunden{' '}
                          {kurz(z.bruch.gefunden)}
                        </span>
                      </span>
                    )),
                  },
                ]}
              />
            )}
          </>
        )}
      </section>

      <p className="mt-s7 max-w-prose text-xs text-text-muted">
        Wer die Kettenmeldung bekommt und auf welchem Weg, ist noch offen
        (O-357). Bis dahin steht der Befund hier und im Betriebsbericht — er
        wird nicht zugestellt.
      </p>
    </PortalRahmen>
  );
}
