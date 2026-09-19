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
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { UEBERSICHT_TEXTE } from '@/lib/i18n/verwaltung/finanzen/uebersicht';

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

/*
 * Der Jobname lautet in beiden Sprachen gleich und steht deshalb hier und
 * nicht in der Texttabelle (siehe den Kopf von `i18n/verwaltung/finanzen/uebersicht.ts`).
 */
const JOB_KETTE_PRUEFEN = 'kette_pruefen';

/*
 * `'Fehler'` ist hier der SCHLUESSEL einer Pille (DESIGN §5) und keine
 * Beschriftung — die Pille uebersetzt sich selbst. Ueber eine Konstante
 * gelesen bleibt der Schluessel das, was er ist: `fehler` ist zudem ein Wert
 * des Job-Ergebnisses und keine Textzuweisung.
 */
const PILLE_FEHLER: PillZustand = 'Fehler';

const ERGEBNIS_PILLE: Readonly<Record<string, PillZustand>> = {
  erfolg: 'Abgeschlossen',
  teilweise: PILLE_FEHLER,
  fehler: PILLE_FEHLER,
  abgebrochen: PILLE_FEHLER,
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

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(UEBERSICHT_TEXTE, zugang.sprache);

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
  const TEXT_KOPF = t.textKopf;
  const TEXT_UEBERGANG = t.textUebergang;

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
  const BRUCH_TEXT: Readonly<Record<KettenBruch['grund'], string>> = t.bruchGrund;

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
      titel={t.hashketteTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.hashketteUeberschrift}</h1>
        <form method="get">
          <input type="hidden" name="nachrechnen" value="jetzt" />
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
            data-cse="hashkette-nachrechnen"
          >
            {t.jetztNachrechnen}
          </button>
        </form>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {t.hashSatzVor}{' '}
        <code className="text-xs">{t.hashFormel}</code>{' '}
        ({t.algorithmusWort} <strong>{ALGORITHMUS}</strong>). {t.hashSatzNach}
      </p>

      <section aria-labelledby="nachtlauf-titel" className="mb-s7">
        <h2 id="nachtlauf-titel" className="mb-s3 text-h2 text-text">
          {t.nachtlaufTitel}
        </h2>
        {daten.lauf === null ? (
          <Hinweis art="warnung" cse="hashkette-kein-lauf">
            <p className="m-0 max-w-prose">
              <strong>
                {t.keinLaufVor} <code>{JOB_KETTE_PRUEFEN}</code> {t.keinLaufNach}
              </strong>{' '}
              {t.keinLaufMitte}
              <strong> {t.keinLaufNicht}</strong>{t.keinLaufSchluss}
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
                sprache={zugang.sprache}
              />
              <span className="text-text">
                {`${t.gestartet} ${daten.lauf.gestartetAm}`}
                {daten.lauf.beendetAm === null
                  ? ` ${t.nochNichtBeendet}`
                  : `${t.beendet} ${daten.lauf.beendetAm}`}
              </span>
            </p>
            <p className="m-0 mt-s3 max-w-prose">
              {daten.lauf.meldung ?? t.keineMeldung}
            </p>
            {daten.lauf.geprueft === null ? null : (
              <p className="m-0 mt-s2 text-xs text-text-muted">
                {`${t.gepruefteRechnungen} ${String(daten.lauf.geprueft)}`}
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="koepfe-titel" className="mb-s7">
        <h2 id="koepfe-titel" className="mb-s3 text-h2 text-text">
          {t.koepfeTitel}
        </h2>

        {abweichendeKoepfe.length === 0 ? null : (
          <Hinweis art="warnung" cse="hashkette-kopf-abweichung" className="mb-s3">
            <p className="m-0 max-w-prose">
              {abweichendeKoepfe.length === 1
                ? t.einKreisKopf
                : `${String(abweichendeKoepfe.length)} ${t.kreiseKopfNach}`}{' '}
              {t.kopfAbweichungSchluss}
            </p>
          </Hinweis>
        )}

        {daten.koepfe.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.keinKreis}
          </p>
        ) : (
          <DataTable
            beschriftung={t.tabelleKoepfe}
            zeilen={daten.koepfe}
            schluessel={(z) => z.nummernkreisId}
            spalten={[
              {
                schluessel: 'kreis',
                kopf: t.kreisKopf,
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
                schluessel: 'jahr', kopf: t.jahr, numerisch: true,
                zelle: (z) => (z.jahr === 0 ? t.fortlaufend : z.jahr),
              },
              {
                schluessel: 'genesis', kopf: t.genesisKopf,
                zelle: (z) => (
                  <span className="font-mono text-xs text-text-muted">
                    {z.genesisHash === null
                      ? `${kurz(GENESIS)} ${t.vorgabe}`
                      : kurz(z.genesisHash)}
                  </span>
                ),
              },
              {
                schluessel: 'letzter', kopf: t.letzterHashKopf,
                zelle: (z) => (
                  <span className="font-mono text-xs text-text-muted">
                    {kurz(z.letzterHash)}
                  </span>
                ),
              },
              {
                schluessel: 'laenge', kopf: t.gliederKopf, numerisch: true,
                zelle: (z) => z.kettenlaenge,
              },
              {
                schluessel: 'befund',
                kopf: t.befundKopf,
                zelle: (z) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {z.kopfStimmt && z.uebergangStimmt
                      ? <StatusPill zustand="Abgeschlossen" sprache={zugang.sprache} />
                      : <StatusPill zustand="Fehler" sprache={zugang.sprache} />}
                    <span className="text-xs text-text-muted">
                      {!z.kopfStimmt
                        ? TEXT_KOPF
                        : !z.uebergangStimmt
                          ? `${TEXT_UEBERGANG} ${t.vorgaenger} `
                            + `${z.vorgaengerBezeichnung ?? '—'}`
                          : z.hoechstePosition === null
                            ? t.keinGlied
                            : `${t.kopfStimmtPosition} `
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
          {t.liveTitel}
        </h2>
        {daten.live === null ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.nichtNachgerechnet}
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
                beschriftung={t.tabelleLive}
                zeilen={daten.live.kreise}
                schluessel={(z) => z.nummernkreisId}
                spalten={[
                  { schluessel: 'kreis', kopf: t.kreisKopf, zelle: (z) => z.bezeichnung },
                  {
                    schluessel: 'geprueft', kopf: t.gepruefteGlieder, numerisch: true,
                    zelle: (z) => z.geprueft,
                  },
                  {
                    schluessel: 'bruch',
                    kopf: t.befundKopf,
                    zelle: (z) => (z.bruch === null ? (
                      <StatusPill zustand="Abgeschlossen" sprache={zugang.sprache} />
                    ) : (
                      <span className="inline-flex flex-col gap-s1">
                        <span className="inline-flex flex-wrap items-center gap-s2">
                          <StatusPill zustand="Fehler" sprache={zugang.sprache} />
                          <span className="text-xs text-text">
                            {`${t.rechnungWort} ${z.bruch.nummer}, `
                              + `${t.positionWort} ${String(z.bruch.position)}`}
                          </span>
                        </span>
                        <span className="max-w-prose text-xs text-text-muted">
                          {BRUCH_TEXT[z.bruch.grund]}
                        </span>
                        <span className="font-mono text-xs text-text-muted">
                          {`${t.erwartet} ${kurz(z.bruch.erwartet)} · `
                            + `${t.gefunden} ${kurz(z.bruch.gefunden)}`}
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
        {t.kettenmeldungOffen}
      </p>
    </PortalRahmen>
  );
}
