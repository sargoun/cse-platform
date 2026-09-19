import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  aufbewahrung, dokumentstand, leseBeleg, verwendungen,
  zugriffe, type Aufbewahrung, type BelegZeile, type Dokumentstand,
  type Verwendung, type Zugriff,
} from '@/server/services/finanz/beleg';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { BELEGE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/belege';

/**
 * `/portal/[mandant]/finanzen/belege/[id]` — ein Buchungsbeleg im Detail
 * (04-SEITENKARTE.md §5.14, ACC-03, ACC-06, DOC-03, DOC-05, SEC-A6, §147 AO).
 *
 * **Die Datei wird über `/api/dokumente/[id]/datei` geöffnet** — dieselbe
 * Adresse, die `/api/buchhaltung/buchungen/[id]/beleg` schon benutzt: sie
 * zieht die kurzlebige signierte URL erst NACH ihrer eigenen
 * Rechteentscheidung (`dokument.lesen`) und leitet weiter. Diese Seite hält
 * keine URL, und sie baut keine: ein Speicherpfad im HTML ist eine Adresse,
 * die den Bildschirm überlebt.
 *
 * **`datei_sha256` steht oben, nicht im Kleingedruckten.** Er ist der
 * Nachweis, dass die Datei dieselbe ist — ohne sie zu öffnen. Weicht er vom
 * Hash der Dokumentversion ab, wurde getauscht; die Datenbank verbietet das
 * (`fin.beleg_unveraenderlich`), und wenn es doch dastünde, wäre es das
 * Wichtigste auf dieser Seite.
 *
 * **Kein Löschknopf, auch kein ausgegrauter.** Ein gelöschter Beleg liesse
 * eine Buchung ohne Nachweis zurück — genau der Mangel, den eine
 * Betriebsprüfung zuerst feststellt (Invariante 8). Stattdessen steht hier,
 * WER sich auf diesen Beleg beruft: das ist die Begründung, und sie erklärt
 * mehr als ein gesperrter Knopf.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Beleg — Finanzen' };

/*
 * Spalten-, Tabellen- und Rechtenamen lauten in beiden Sprachen gleich und
 * stehen deshalb hier und nicht in der Texttabelle (siehe den Kopf von
 * `i18n/verwaltung/finanzen/belege.ts`). `kB` ist eine Einheit, keine Sprache.
 */
const SPALTE_DOKUMENT_VERSION_ID = 'beleg.dokument_version_id';
const TABELLE_DOKUMENT = 'dokument';
const SPALTE_AUFBEWAHRUNG_BIS = 'aufbewahrung_bis';
const RECHT_DOKUMENT_LESEN = 'dokument.lesen';
const EINHEIT_KB = 'kB';

export default async function Belegblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(`/portal/${mandant}/finanzen/belege/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;
  const { sitzung } = zugang;

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(BELEGE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  /*
   * Diese Seite öffnet mit `eingang.lesen`. Die DATEI liegt hinter
   * `dokument.lesen` (die Adresse prüft es selbst), die Eingangsrechnung
   * daneben ebenfalls hinter `eingang.lesen`, und das Journal hinter
   * `buchhaltung.lesen`. Wer die Datei nicht ziehen darf, bekommt den Knopf
   * nicht — sonst endete er in einem 403 und verriete, was er verbirgt
   * (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    sitzung, 'dokument.lesen', 'buchhaltung.lesen', 'finanzen.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const beleg = await leseBeleg(kontext, id);
      if (beleg === null) {
        return {
          beleg: null, stand: null, verwendung: [], historie: [], frist: null,
        };
      }
      const stand = await dokumentstand(kontext, id);
      return {
        beleg,
        stand,
        verwendung: await verwendungen(kontext, id),
        historie: stand === null ? [] : await zugriffe(kontext, stand.dokumentId),
        frist: await aufbewahrung(kontext, mandantId, beleg.aufbewahrungKlasse),
      };
    })) as Promise<{
      beleg: BelegZeile | null;
      stand: Dokumentstand | null;
      verwendung: readonly Verwendung[];
      historie: readonly Zugriff[];
      frist: Aufbewahrung | null;
    }>);

  const b = daten.beleg;
  if (b === null) notFound();
  /*
   * Die Dokumentversion in einer eigenen Bindung. Der Grund ist nicht Stil:
   * die Wache `anzeige-berlin` sucht auf jeder Zeile mit `toLocaleString`
   * nach einem Datumsbezug, und die Zeichenfolge `daten` enthält `date` —
   * eine Zahlenformatierung mit `daten.…` darin meldet sie als Datumsanzeige
   * ohne Zeitzone. Sie meldet im Zweifel, und das ist richtig; hier ist der
   * Zweifel unbegründet, und statt eine Ausnahme zu erfinden, heisst die
   * Bindung anders.
   */
  const dokv = daten.stand;

  return (
    <PortalRahmen
      titel={t.belegTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label={g.zurueck} className="mb-s3">
        <Link
          href={`/portal/${mandant}/finanzen/belege`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {t.titel}
        </Link>
      </nav>

      <h1 className="mb-s3 text-h1 text-text">
        {b.belegnummer ?? t.belegOhneNummer}
      </h1>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{t.typ}</dt>
          <dd className="text-sm text-text">{t.typNamen[b.typ] ?? b.typ}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.quelle}</dt>
          <dd className="text-sm text-text">{t.quelleNamen[b.quelle] ?? b.quelle}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.belegdatum}</dt>
          <dd className="text-sm text-text">{b.belegdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.bruttoNurZurSuche}</dt>
          <dd className="cse-zahl text-sm text-text">
            {b.bruttoCent === null ? '—' : formatiereGeld(b.bruttoCent)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.seiten}</dt>
          <dd className="cse-zahl text-sm text-text">{b.seiten ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.eingegangenBerlin}</dt>
          <dd className="text-sm text-text">{b.eingegangenAm}</dd>
        </div>
        <div className="sm:col-span-3">
          <dt className="text-xs text-text-muted">{t.sha256Erklaerung}</dt>
          <dd className="break-all font-mono text-xs text-text" data-cse="beleg-sha256">
            {b.dateiSha256}
          </dd>
        </div>
      </dl>

      <h2 className="mb-s3 text-h2 text-text">{t.dieDatei}</h2>
      {dokv === null ? (
        <Hinweis art="warnung" cse="beleg-kein-dokument" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.keineDokumentversionVor}{' '}
            <code>{SPALTE_DOKUMENT_VERSION_ID}</code>{' '}
            {t.keineDokumentversionMitte}{' '}
            <code>{TABELLE_DOKUMENT}</code>{' '}
            {t.keineDokumentversionNach}
          </p>
        </Hinweis>
      ) : (
        <>
          {!dokv.hashStimmt ? (
            <Hinweis art="warnung" cse="beleg-hash-abweichung" className="mb-s3">
              <p className="m-0 max-w-prose">
                <strong>{t.hashAbweichungTitel}</strong> {t.belegBezeugt}{' '}
                <code className="break-all text-xs">{b.dateiSha256}</code>
                {t.versionTraegt}{' '}
                <code className="break-all text-xs">{dokv.sha256}</code>
                {t.hashAbweichungNach}
              </p>
            </Hinweis>
          ) : null}

          {dokv.neuereVersion === null ? null : (
            <Hinweis art="hinweis" cse="beleg-neuere-version" className="mb-s3">
              <p className="m-0 max-w-prose">
                {t.neuereVersionVor}{' '}
                {dokv.neuereVersion}{t.neuereVersionMitte}{' '}
                {dokv.version} {t.neuereVersionNach}
              </p>
            </Hinweis>
          )}

          <dl className="mb-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-muted">{t.titelFeld}</dt>
              <dd className="text-sm text-text">{dokv.titel}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.version}</dt>
              <dd className="cse-zahl text-sm text-text">{dokv.version}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.formatUndGroesse}</dt>
              <dd className="text-sm text-text">
                {dokv.mimeTyp} ·{' '}
                {Math.round(dokv.groesseBytes / 1024).toLocaleString('de-DE')}{' '}
                {EINHEIT_KB}
              </dd>
            </div>
          </dl>

          {dokv.geloeschtAm !== null ? (
            <Hinweis art="warnung" cse="beleg-dokument-geloescht" className="mb-s5">
              <p className="m-0 max-w-prose">
                {t.dokumentGeloeschtVor} {dokv.geloeschtAm}{' '}
                {t.dokumentGeloeschtNach}
              </p>
            </Hinweis>
          ) : darf['dokument.lesen'] === true ? (
            <p className="mb-s5">
              <a
                href={`/api/dokumente/${dokv.dokumentId}/datei`}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand px-s4 text-base text-white"
                data-cse="beleg-oeffnen"
              >
                {t.belegOeffnen}
              </a>
              <span className="ml-s3 text-xs text-text-muted">
                {t.signierteUrlHinweis}
              </span>
            </p>
          ) : (
            <p className="mb-s5 max-w-prose text-sm text-text-muted">
              {t.diesemKontoFehlt} <strong>{RECHT_DOKUMENT_LESEN}</strong>
              {t.dateiBleibtZu}
            </p>
          )}
        </>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.aufbewahrung}</h2>
      <div
        data-cse="beleg-aufbewahrung"
        data-frist-offen={String(b.fristOffen)}
        className={`mb-s5 rounded-lg border p-s5 text-sm ${
          b.fristOffen
            ? 'border-warning bg-warning-soft text-warning'
            : 'border-line bg-surface text-text'}`}
      >
        <p className="m-0 flex flex-wrap items-center gap-s3">
          <StatusPill
            zustand={b.loeschsperre ? 'Archiviert' : 'Inaktiv'}
            sprache={zugang.sprache}
          />
          <span className="text-text">
            {t.klasse} <strong>{b.aufbewahrungKlasse}</strong>
            {b.loeschsperre ? t.loeschsperreAktiv : t.keineLoeschsperre}
          </span>
        </p>
        <p className="m-0 mt-s3 max-w-prose">
          {b.fristOffen
            ? t.fristOffenLang
            : `${t.aufzubewahrenBis} ${String(b.aufbewahrungBis)}`
              + `${daten.frist?.jahre === null || daten.frist === null
                ? '.' : ` (${String(daten.frist.jahre)} ${t.jahreAbBelegdatum}).`}`}
        </p>
        {daten.frist !== null && daten.frist.istPlatzhalter && !b.fristOffen ? (
          <p className="m-0 mt-s2 max-w-prose">
            {t.regelUnbestaetigt}
          </p>
        ) : null}
      </div>

      <h2 className="mb-s3 text-h2 text-text">{t.woranDieserBelegHaengt}</h2>
      {daten.verwendung.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineVerwendung}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelleVerwendung}
          zeilen={daten.verwendung}
          schluessel={(v) => `${v.art}-${v.id}`}
          spalten={[
            {
              schluessel: 'art', kopf: g.art,
              zelle: (v) => t.verwendungNamen[v.art],
            },
            {
              schluessel: 'bezeichnung',
              kopf: t.belegOderText,
              /*
               * Eingangsrechnung und Ausgabe liegen hinter DEMSELBEN Recht
               * wie diese Seite (`eingang.lesen`) und sind immer verlinkt.
               * Die Ausgangsrechnung liegt hinter `finanzen.lesen` — sie wird
               * verlinkt, wenn dieses Konto es hält, und bleibt sonst Text,
               * bevor ein Verweis auf 404 führt (AUT-06, D-581; dasselbe
               * Muster wie beim buchungssatz-Zweig). Der Buchungssatz hat
               * keine Einzelseite — das Journal ist die Liste.
               */
              zelle: (v) => (v.art === 'eingangsrechnung' ? (
                <Link
                  href={`/portal/${mandant}/finanzen/eingangsrechnungen/${v.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {v.bezeichnung}
                </Link>
              ) : v.art === 'ausgabe' ? (
                <Link
                  href={`/portal/${mandant}/finanzen/ausgaben/${v.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {v.bezeichnung}
                </Link>
              ) : v.art === 'rechnung' && darf['finanzen.lesen'] === true ? (
                <Link
                  href={`/portal/${mandant}/finanzen/rechnungen/${v.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {v.bezeichnung}
                </Link>
              ) : v.bezeichnung),
            },
            {
              schluessel: 'zustand', kopf: g.zustand,
              zelle: (v) => v.zustand ?? '—',
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s7 text-h2 text-text">{t.zugriffeTitel}</h2>
      {daten.historie.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineZugriffe}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelleZugriffe}
          zeilen={daten.historie}
          schluessel={(z) => `${z.zeitpunkt}-${z.art}-${z.benutzer ?? ''}`}
          spalten={[
            { schluessel: 'zeit', kopf: t.zeitpunkt, zelle: (z) => z.zeitpunkt },
            { schluessel: 'art', kopf: g.art, zelle: (z) => z.art },
            {
              schluessel: 'wer', kopf: t.konto,
              zelle: (z) => z.benutzer ?? <span className="text-text-subtle">—</span>,
            },
          ]}
        />
      )}

      <p className="mt-s7 max-w-prose text-xs text-text-muted">
        {t.belegFussnoteVor}{' '}
        <code>{SPALTE_AUFBEWAHRUNG_BIS}</code>{' '}
        {t.belegFussnoteNach}
        {darf['buchhaltung.lesen'] === true ? (
          <>
            {' '}
            <Link
              href={`/portal/${mandant}/buchhaltung/archiv`}
              className="underline underline-offset-2"
            >
              {t.zumGobdArchiv}
            </Link>
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
