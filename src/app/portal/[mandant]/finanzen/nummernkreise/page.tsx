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
 * **Es gibt hier keinen Knopf „Neuer Kreis" und keinen „Jahreswechsel".** Der
 * Jahreswechsel ist ein beschriebener Vorgang: Vorgänger schliessen,
 * `letzter_hash` als `genesis_hash` des Nachfolgers eintragen, Vorgänger
 * verweisen. Wer ihn ausführt, ist offen (O-352) — und ein Knopf erfände die
 * Rolle, die ihn auslöst. Der Vorgang steht deshalb als Text da, nicht als
 * Schalter.
 *
 * **Ein Kreis mit unbestätigter Maske trägt das sichtbar** (O-134): ein Kreis
 * je Gesellschaft oder je Gesellschaft und Belegart, Nummer fortlaufend oder
 * am 1. Januar zurückgesetzt, und wie die Maske genau lautet — alles offen.
 * Solange `ist_platzhalter` steht, wird in diesem Kreis nicht festgeschrieben,
 * und die Seite sagt das an der Zeile.
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
 * Spalten-, Funktions- und Rechtenamen lauten in beiden Sprachen gleich und
 * stehen deshalb hier und nicht in der Texttabelle (siehe deren Kopf).
 */
const FN_NUMMER_ZIEHEN = 'fin.rechnung_nummer_ziehen';
const SPALTE_IST_PLATZHALTER = 'ist_platzhalter';
const SPALTE_GESCHLOSSEN_AM = 'geschlossen_am';
const SPALTE_GENESIS_HASH = 'genesis_hash';
const SPALTE_LETZTER_HASH = 'letzter_hash';
const SPALTE_VORGAENGER = 'vorgaenger_nummernkreis_id';
const RECHT_VERWALTEN = 'nummernkreis.verwalten';
const WERT_TRUE = 'true';

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
 * sagt es, statt dass es jemand beim Lesen der Seeddaten findet.
 */
function widerspruechlich(k: Kreis): boolean {
  return !k.istPlatzhalter && /unbest(ä|ae)tigt|DEMO|O-134/iu.test(k.bezeichnung);
}

export default async function Nummernkreisblatt(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
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

  const alle = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) =>
      kreise(kontext))) as Promise<readonly Kreis[]>);

  const platzhalter = alle.filter((k) => k.istPlatzhalter);
  const widersprueche = alle.filter(widerspruechlich);

  return (
    <PortalRahmen
      titel={t.nummernkreiseTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{t.nummernkreiseUeberschrift}</h1>

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
            {t.widerspruchMitte}{' '}
            <code>{FN_NUMMER_ZIEHEN}</code>{t.widerspruchNachSpalte}{' '}
            <code>{WERT_TRUE}</code> {t.widerspruchSchluss}
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
                      {t.widerspruchZeileVor} <code>{SPALTE_IST_PLATZHALTER}</code>{' '}
                      {t.widerspruchZeileNach}
                    </span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
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
              {t.schrittSchliessenVor} <strong>{t.schrittSchliessenWort}</strong> (
              <code>{SPALTE_GESCHLOSSEN_AM}</code>{t.schrittSchliessenNach}
            </li>
            <li>
              {t.schrittNachfolgerVor} <code>{SPALTE_GENESIS_HASH}</code>{' '}
              {t.schrittNachfolgerMitte} <code>{SPALTE_LETZTER_HASH}</code>{' '}
              {t.schrittNachfolgerNach}
            </li>
            <li>
              {t.schrittVorgaengerVor}
              <code>{SPALTE_VORGAENGER}</code>{t.schrittVorgaengerNach}
            </li>
          </ol>
          <p className="m-0 mt-s3 max-w-prose text-warning">
            <strong>{t.keinKnopfDafuer}</strong> {t.keinKnopfWer}{' '}
            <code>{RECHT_VERWALTEN}</code> {t.keinKnopfNach}{' '}
            {darf['nummernkreis.verwalten'] === true ? t.rechtGehalten : t.rechtFehlt}{' '}
            {t.auchMitRecht}
          </p>
        </div>
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
