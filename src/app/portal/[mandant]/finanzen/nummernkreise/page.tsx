import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { kreise, type Kreis } from '@/server/services/finanz/kreisuebersicht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { UEBERSICHT_TEXTE } from '@/lib/i18n/verwaltung/finanzen/uebersicht';
import { WECHSEL_TEXTE } from '@/lib/i18n/verwaltung/finanzen/nummernkreis-wechsel';
import { FREIGABE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/nummernkreis-freigabe';
import { Recht } from '@/components/ui/Recht';
import { Button } from '@/components/ui/Button';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import {
  ersteNummer, heutigesJahr, wechselLage,
} from '@/server/services/finanz/nummernkreis-wechsel';
import {
  behauptetVorbehalt, BEZEICHNUNG_HOECHSTENS, ersteFreigegebeneNummer, MASKE_HOECHSTENS,
  maskenMangel, vorgeschlageneBezeichnung, type Ruecksetzung,
} from '@/server/services/finanz/nummernkreis-freigabe';

/**
 * `/portal/[mandant]/finanzen/nummernkreise` — die Nummernkreise einer
 * Gesellschaft, **Zähler lesend** (04-SEITENKARTE.md §5.14, TEN-02, FIN-03,
 * FIN-16).
 *
 * **Der Zähler ist ANSICHT und nirgends Eingabefeld.** `naechste_nummer` wird
 * ausschliesslich unter `SELECT … FOR UPDATE` in der
 * Festschreibungstransaktion fortgezählt (§5.6). Ein Formular darauf wäre der
 * kürzeste Weg zu zwei Rechnungen mit derselben Nummer — und §14 UStG duldet
 * weder Lücke noch Doppelung.
 *
 * **Zwei Knöpfe, und nur diese** (V-284, D-848) — beide für wer
 * `nummernkreis.verwalten` hält (Voreinstellung O-352: die Administration),
 * beide in der Datenbank ausgeführt (0532). Einen „Neuer Kreis" gibt es nicht.
 *
 *  - **Freigeben.** Ein Kreis mit unbestätigter Maske trägt das sichtbar
 *    (O-134): solange `ist_platzhalter` steht, wird in ihm nicht
 *    festgeschrieben, und die Seite sagt das an der Zeile. Das Formular
 *    „Maske festlegen und freigeben" zeigt die Voreinstellung (D-779) und
 *    die erste Nummer; bestätigt oder angepasst gibt es den Kreis frei. Nach
 *    der ersten Nummer friert `fin.nummernkreis_pruefen` Maske und
 *    Geltungsbereich ein.
 *  - **Jahreswechsel.** Ist das Jahr eines freigegebenen, jährlich
 *    zurückgesetzten Kreises vergangen, steht an ihm das Formular
 *    „Nachfolgekreis eröffnen": die Datenbank schliesst den Vorgänger,
 *    eröffnet den Nachfolger mit `letzter_hash` als `genesis_hash` und
 *    verweist ihn auf den Vorgänger — in einer Transaktion.
 *
 * Zähler und Hash kommen nie aus einem Formular.
 *
 * **Der Widerspruch, der an dieser Seite auffällt und den sie NICHT auflöst:**
 * die Demokreise heissen „Ausgangsrechnungen (DEMO — Maske unbestätigt,
 * O-134)" und tragen `ist_platzhalter = false`. Der Name behauptet den Schutz,
 * die Spalte hebt ihn auf — und der Schutz sitzt für Rechnungskreise
 * ausschliesslich in `fin.rechnung_nummer_ziehen`, weil `vergebeNummer()` für
 * sie gar nicht zuständig ist (`DEFINER_KREISE`). Die Seite stellt beides
 * nebeneinander und benennt es als Datenentscheidung mit Wirkung auf bereits
 * festgeschriebene Belege (O-606). Sie ändert nichts.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Nummernkreise — Finanzen' };

/*
 * Der Rechteschlüssel lautet in beiden Sprachen gleich und steht deshalb hier
 * und nicht in der Texttabelle; auf dem Schirm steht er als Satz (`<Recht>`).
 * Spalten- und Funktionsnamen stehen seit V-251 gar nicht mehr da.
 */
const RECHT_VERWALTEN = 'nummernkreis.verwalten';

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

/**
 * Ein Hash, gekürzt auf 12 Zeichen, Auslassung, die letzten 6 — lesbar, und
 * immer noch **ein Wort ohne Trennstelle**.
 *
 * **Deshalb tragen die Zellen dieser Seite `flex min-w-0 flex-col` und die
 * Hashzeilen `break-all`.** Gemessen am Telefon (390px) lief die Seite in
 * jeder der drei Gesellschaften 26px über den rechten Rand; der schuldige
 * Kasten war jedes Mal `span.inline-flex flex-col gap-s1` der Spalte
 * „Kettenlage" bei x=264…416. Im Kartenstapel unter `md` ist die
 * Wertspalte rund 74px breit (`DataTable`, D-420) — ein `inline-flex`
 * schrumpft aber nicht unter die Mindestbreite seiner Kinder, und die ist
 * hier dieses eine 19-Zeichen-Wort. Das `min-w-0 break-words` am `<dd>`
 * wirkt durch den Flex-Behälter hindurch nicht (D-594); `break-all` am
 * Hash selbst wirkt, weil ein Hash gelesen und nicht gesprochen wird
 * (D-569).
 */
function kurz(hash: string | null): string {
  return hash === null ? '—' : `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}

/**
 * Trägt die Bezeichnung einen Hinweis auf eine unbestätigte Maske, während die
 * Spalte `ist_platzhalter` das Gegenteil sagt?
 *
 * Das ist kein Schönheitsfehler: der Name behauptet einen Schutz, den die
 * Spalte nicht gibt. Erkannt wird er am Text und nicht geraten — und die Zeile
 * sagt es, statt dass es jemand beim Lesen der Seeddaten findet. Dieselbe
 * Regel, mit der die Freigabe einen solchen Namen abweist
 * (`behauptetVorbehalt`, V-284).
 */
function widerspruechlich(k: Kreis): boolean {
  return !k.istPlatzhalter && behauptetVorbehalt(k.bezeichnung);
}

export default async function Nummernkreisblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/finanzen/nummernkreise`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Diese Seite öffnet mit `nummernkreis.lesen`. Das Ausgangsbuch und die
   * Hashkette liegen hinter anderen Schlüsseln — ohne sie steht hier Text
   * statt eines Verweises, der auf 404 führt (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'finanzen.lesen', 'nummernkreis.verwalten');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(UEBERSICHT_TEXTE, zugang.sprache);

  const { alle, jahr } = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      alle: await kreise(kontext),
      jahr: await heutigesJahr(kontext),
    }))) as Promise<{ alle: readonly Kreis[]; jahr: number }>);
  const w = nachSprache(WECHSEL_TEXTE, zugang.sprache);
  const f = nachSprache(FREIGABE_TEXTE, zugang.sprache);
  const verwalten = darf['nummernkreis.verwalten'] === true && zugang.sitzung.ansicht !== 'gruppe';
  const pfad = `/portal/${mandant}/finanzen/nummernkreise`;
  /* Der Jahreswechsel: fällig ist ein offener, freigegebener, jährlich zurückgesetzter Kreis eines vergangenen Jahres. */
  const faellig = alle.filter((k) => wechselLage(
    { zuruecksetzung: k.zuruecksetzung, jahr: k.jahr, geschlossen: k.geschlossenAm !== null,
      platzhalter: k.istPlatzhalter },
    jahr) === 'faellig');
  /* Die Freigabe: ein offener Platzhalterkreis (O-134). */
  const freizugeben = alle.filter((k) => k.istPlatzhalter && k.geschlossenAm === null);

  /*
   * D-599/D-728: Grund und Ergebnis nur als EIGENER Eintrag der Tabelle —
   * der Tabelle DER Handlung, die abgewiesen wurde (`aktion` reist mit,
   * V-240). Eine abgewiesene Freigabe bringt ihre Eingaben mit.
   */
  const aktion = vorbelegt(suche, 'aktion');
  const grund = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const freigabeFehler = grund !== null && aktion === 'freigeben'
    ? (eigenerEintrag(f.fehler, grund) ?? f.fehlerUnbekannt) : null;
  const wechselFehler = grund !== null && aktion !== 'freigeben'
    ? (eigenerEintrag(w.fehler, grund) ?? w.fehlerUnbekannt) : null;
  const wechselJahr = typeof suche['wechsel'] === 'string' && /^\d{4}$/u.test(suche['wechsel'])
    ? suche['wechsel'] : null;
  const freigegeben = typeof suche['freigegeben'] === 'string'
    ? alle.find((k) => k.id === suche['freigegeben'] && !k.istPlatzhalter) ?? null : null;
  /* Was im Formular eines Kreises steht: die Eingaben einer abgewiesenen Freigabe, sonst die Voreinstellung. */
  const eingabe = (k: Kreis): { maske: string; ruecksetzung: Ruecksetzung; bezeichnung: string } => {
    const zurueck = aktion === 'freigeben' && vorbelegt(suche, 'kreis') === k.id;
    const r = zurueck ? vorbelegt(suche, 'ruecksetzung') : k.zuruecksetzung;
    return {
      maske: (zurueck ? vorbelegt(suche, 'maske') : undefined) ?? k.formatMaske,
      ruecksetzung: r === 'nie' ? 'nie' : 'jaehrlich',
      bezeichnung: (zurueck ? vorbelegt(suche, 'bezeichnung') : undefined)
        ?? vorgeschlageneBezeichnung(k.bezeichnung),
    };
  };
  /* Bei einer abgewiesenen Maske: was genau an ihr nicht taugt. */
  const mangelZurueck = grund === 'maske_ungueltig' && aktion === 'freigeben'
    ? (() => {
        const k = freizugeben.find((x) => x.id === vorbelegt(suche, 'kreis'));
        if (k === undefined) return null;
        const e = eingabe(k);
        const m = maskenMangel(e.maske.trim(), e.ruecksetzung);
        return m === null ? null : f.mangel[m];
      })()
    : null;

  const platzhalter = alle.filter((k) => k.istPlatzhalter);
  const widersprueche = alle.filter(widerspruechlich);

  return (
    <PortalRahmen
      titel={t.nummernkreiseTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={!verwalten}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{t.nummernkreiseUeberschrift}</h1>

      {wechselFehler !== null && (
        <Hinweis art="warnung" cse="nummernkreise-wechsel-abgewiesen" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{w.abgewiesen}</strong>{' '}{wechselFehler}
        </Hinweis>
      )}
      {wechselJahr !== null && (
        <Hinweis art="erfolg" cse="nummernkreise-wechsel-eroeffnet" rolle="status" className="mb-s5 max-w-prose">
          {w.erfolg(wechselJahr)}
        </Hinweis>
      )}
      {freigabeFehler !== null && (
        <Hinweis art="warnung" cse="nummernkreise-freigabe-abgewiesen" rolle="alert" className="mb-s5 max-w-prose">
          <strong>{f.abgewiesen}</strong>{' '}{freigabeFehler}
          {mangelZurueck === null ? null : <>{' '}{mangelZurueck}</>}
        </Hinweis>
      )}
      {freigegeben !== null && (
        <Hinweis art="erfolg" cse="nummernkreise-freigegeben" rolle="status" className="mb-s5 max-w-prose">
          {f.erfolg(freigegeben.bezeichnung, freigegeben.naechsteNummerFormatiert)}
        </Hinweis>
      )}

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {t.nummernkreiseEinleitung}
      </p>

      {platzhalter.length > 0 ? (
        <Hinweis art="warnung" cse="nummernkreise-platzhalter" className="mb-s5">
          <p className="m-0 max-w-prose">
            {platzhalter.length === 1
              ? t.einPlatzhalter
              : `${String(platzhalter.length)} ${t.platzhalterNach}`}{' '}
            {t.platzhalterErklaerung}{' '}
            <strong>{t.nichtFestgeschrieben}</strong>{' '}
            {t.erfundeneNummer}
          </p>
        </Hinweis>
      ) : null}

      {widersprueche.length > 0 ? (
        <Hinweis art="warnung" cse="nummernkreise-widerspruch" className="mb-s5">
          <p className="m-0 max-w-prose">
            <strong>
              {widersprueche.length === 1
                ? t.einWiderspruch
                : `${String(widersprueche.length)} ${t.widersprucheNach}`}
            </strong>{' '}
            {t.widerspruch}
          </p>
        </Hinweis>
      ) : null}

      {alle.length === 0 ? (
        <Hinweis art="hinweis" cse="nummernkreise-leer">
          <p className="m-0 max-w-prose">
            {t.keinNummernkreis}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.tabelleKreise}
          zeilen={alle}
          schluessel={(k) => k.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: t.kreisKopf,
              zelle: (k) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  <span className="text-text">{k.bezeichnung}</span>
                  <span className="text-xs text-text-muted">{k.typText}</span>
                </span>
              ),
            },
            {
              schluessel: 'jahr', kopf: t.jahr, numerisch: true,
              zelle: (k) => (k.jahr === 0 ? t.fortlaufend : k.jahr),
            },
            {
              schluessel: 'maske',
              kopf: t.maskeKopf,
              zelle: (k) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  <code className="break-all text-xs text-text">{k.formatMaske}</code>
                  <span className="text-xs text-text-muted">
                    {k.zuruecksetzung === null
                      ? t.ruecksetzungOffen
                      : t.zuruecksetzung[k.zuruecksetzung]}
                    {k.lueckenlos ? t.lueckenlos : t.nichtLueckenlos}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'zaehler',
              kopf: t.naechsteNummerKopf,
              numerisch: true,
              zelle: (k) => (
                <span className="flex min-w-0 flex-col gap-s1 text-right">
                  <span className="cse-zahl text-text">{k.naechsteNummerFormatiert}</span>
                  <span className="cse-zahl text-xs text-text-muted">
                    {`${t.zaehler} ${String(k.naechsteNummer)}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'kette',
              kopf: t.kettenlageKopf,
              zelle: (k) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  <span className="break-all font-mono text-xs text-text-muted">
                    {`${t.genesisWort} ${kurz(k.genesisHash)}`}
                  </span>
                  <span className="break-all font-mono text-xs text-text-muted">
                    {`${t.letzterWort} ${kurz(k.letzterHash)}`}
                  </span>
                  <span className="text-xs text-text-muted">
                    {`${String(k.kettenlaenge)} ${t.glieder}`}
                    {k.vorgaengerBezeichnung === null
                      ? ''
                      : `${t.vorgaengerZusatz}${k.vorgaengerBezeichnung}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'offen',
              kopf: t.geoeffnetKopf,
              zelle: (k) => (
                <span className="text-xs text-text-muted">
                  {k.geoeffnetAm}
                  {k.geschlossenAm === null
                    ? t.offenZusatz
                    : `${t.geschlossenZusatz}${k.geschlossenAm}`}
                </span>
              ),
            },
            {
              schluessel: 'zustand',
              kopf: t.vergabeKopf,
              zelle: (k) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {k.istPlatzhalter
                      ? <StatusPill zustand="Entwurf" sprache={zugang.sprache} />
                      : k.geschlossenAm !== null
                        ? <StatusPill zustand="Archiviert" sprache={zugang.sprache} />
                        : <StatusPill zustand="Aktiv" sprache={zugang.sprache} />}
                    <span className="text-xs text-text-muted">
                      {k.zugDurchDefiner ? t.zugDefiner : t.zugAnwendung}
                    </span>
                  </span>
                  {k.vergabeGrund === null ? null : (
                    <span className="max-w-prose text-xs text-warning">
                      {k.vergabeGrund}
                    </span>
                  )}
                  {widerspruechlich(k) ? (
                    <span className="max-w-prose text-xs text-warning">
                      {t.widerspruchZeile}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      )}

      {freizugeben.length > 0 && (
        <section aria-labelledby="freigabe-titel" className="mt-s7" data-cse="nummernkreise-freigabe">
          <h2 id="freigabe-titel" className="mb-s3 text-h2 text-text">{f.abschnittTitel}</h2>
          <p className="m-0 mb-s4 max-w-prose text-sm text-text-muted">{f.voreinstellung}</p>
          {freizugeben.map((k) => {
            const e = eingabe(k);
            const erste = ersteFreigegebeneNummer(e.maske.trim(), e.ruecksetzung, k.jahr, jahr);
            return (
              <div key={k.id} data-cse="nummernkreise-freizugeben" data-kreis={k.id}
                   className="mt-s4 rounded-lg border border-line bg-surface p-s5">
                <h3 className="mb-s2 mt-0 text-h3 text-text">{f.titel(k.bezeichnung)}</h3>
                <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">{f.erklaerung}</p>
                <dl className="m-0 mb-s4 grid max-w-prose grid-cols-1 gap-s2 text-sm md:grid-cols-2">
                  <dt className="text-text-muted">
                    {f.ersteNummer}{' '}<span className="text-xs">({f.ersteNummerHinweis})</span>
                  </dt>
                  <dd className="m-0 cse-zahl text-text" data-cse="nummernkreise-freigabe-erste-nummer">
                    {erste ?? f.keineVorschau}
                  </dd>
                </dl>
                {verwalten ? (
                  <form method="post" action="/api/finanzen/nummernkreise"
                        className="flex max-w-[64ch] flex-col gap-s4">
                    <input type="hidden" name="aktion" value="freigeben" />
                    <input type="hidden" name="kreis" value={k.id} />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <label className="flex flex-col gap-s2 text-sm text-text">
                      {f.feldMaske}
                      <input type="text" name="maske" required maxLength={MASKE_HOECHSTENS}
                             defaultValue={e.maske} className={`${FELD} font-mono`}
                             spellCheck={false} autoComplete="off" />
                      <span className="text-xs text-text-muted">{f.maskeHilfe}</span>
                    </label>
                    <fieldset className="flex flex-col gap-s2 border-0 p-0">
                      <legend className="mb-s2 text-sm font-semibold text-text">{f.feldRuecksetzung}</legend>
                      {(['jaehrlich', 'nie'] as const).map((r) => (
                        <label key={r} className="flex min-h-11 items-start gap-s2 text-sm text-text">
                          <input type="radio" name="ruecksetzung" value={r} className="mt-s1"
                                 defaultChecked={e.ruecksetzung === r} />
                          <span>{f.ruecksetzung[r]}</span>
                        </label>
                      ))}
                    </fieldset>
                    <label className="flex flex-col gap-s2 text-sm text-text">
                      {f.feldBezeichnung}
                      <input type="text" name="bezeichnung" required maxLength={BEZEICHNUNG_HOECHSTENS}
                             defaultValue={e.bezeichnung} className={FELD} />
                    </label>
                    <label className="flex min-h-11 max-w-prose items-start gap-s2 text-sm text-text">
                      <input type="checkbox" name="bestaetigt" value="ja" required className="mt-s1" />
                      <span>{f.bestaetigen}</span>
                    </label>
                    <div>
                      <Button type="submit" data-cse="nummernkreise-freigeben">
                        {f.freigeben}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="m-0 text-sm text-text-muted" data-cse="nummernkreise-freigabe-ohne-recht">
                    {f.ohneRechtVor}{' '}<Recht schluessel={RECHT_VERWALTEN} sprache={zugang.sprache} />{' '}{f.ohneRechtNach}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section aria-labelledby="jahreswechsel-titel" className="mt-s7">
        <h2 id="jahreswechsel-titel" className="mb-s3 text-h2 text-text">
          {t.jahreswechselTitel}
        </h2>
        <div
          className="rounded-lg border border-line bg-surface-2 p-s5 text-sm text-text"
          data-cse="nummernkreise-jahreswechsel"
        >
          <p className="m-0 max-w-prose">
            {t.jahreswechselEinleitung}
          </p>
          <ol className="mt-s3 max-w-prose list-decimal space-y-s2 pl-s5">
            <li>
              {t.schrittSchliessenVor} <strong>{t.schrittSchliessenWort}</strong>
              {t.schrittSchliessenNach}
            </li>
            <li>
              {t.schrittNachfolger}
            </li>
            <li>
              {t.schrittVorgaenger}
            </li>
          </ol>
          <p className="m-0 mt-s3 max-w-prose text-text-muted">
            {t.wechselWer}{' '}
            <Recht schluessel={RECHT_VERWALTEN} sprache={zugang.sprache} /> {t.wechselNach}{' '}
            {darf['nummernkreis.verwalten'] === true ? t.rechtGehalten : t.rechtFehlt}
          </p>
        </div>

        {faellig.length === 0 ? (
          <p className="mt-s4 max-w-prose text-sm text-text-muted" data-cse="nummernkreise-kein-wechsel">
            {w.keinerFaellig} {w.laeuftHinweis(jahr)}
          </p>
        ) : faellig.map((k) => (
          <div key={k.id} data-cse="nummernkreise-faellig" data-kreis={k.id}
               className="mt-s4 rounded-lg border border-line bg-surface p-s5">
            <h3 className="mb-s2 mt-0 text-h3 text-text">{w.faelligTitel(k.bezeichnung, jahr)}</h3>
            <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">{w.faelligErklaerung(k.jahr)}</p>
            <dl className="m-0 mb-s4 grid max-w-prose grid-cols-1 gap-s2 text-sm md:grid-cols-2">
              <dt className="text-text-muted">{w.ersteNummer}</dt>
              <dd className="m-0 cse-zahl text-text" data-cse="nummernkreise-erste-nummer">
                {ersteNummer(k.formatMaske, jahr)}
              </dd>
              <dt className="text-text-muted">{w.kette}</dt>
              <dd className="m-0 break-all font-mono text-xs text-text">
                {kurz(k.letzterHash ?? k.genesisHash)}
              </dd>
            </dl>
            {verwalten ? (
              <form method="post" action="/api/finanzen/nummernkreise" className="flex flex-col gap-s3">
                <input type="hidden" name="aktion" value="nachfolger" />
                <input type="hidden" name="vorgaenger" value={k.id} />
                <input type="hidden" name="zurueck" value={pfad} />
                <label className="flex min-h-11 max-w-prose items-start gap-s2 text-sm text-text">
                  <input type="checkbox" name="maske_bestaetigt" value="ja" required className="mt-s1" />
                  <span>{w.maskeBestaetigen(k.formatMaske)}</span>
                </label>
                <div>
                  <Button type="submit" data-cse="nummernkreise-nachfolger">
                    {w.eroeffnen(jahr)}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="m-0 text-sm text-text-muted" data-cse="nummernkreise-wechsel-ohne-recht">
                {w.ohneRechtVor}{' '}<Recht schluessel={RECHT_VERWALTEN} sprache={zugang.sprache} />{' '}{w.ohneRechtNach}
              </p>
            )}
          </div>
        ))}
      </section>

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.zaehlerFussnote}
        {darf['finanzen.lesen'] === true ? (
          <>
            {' '}
            <Link
              href={`/portal/${mandant}/finanzen/ausgangsbuch`}
              className="underline underline-offset-2"
            >
              {t.zumAusgangsbuch}
            </Link>
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
