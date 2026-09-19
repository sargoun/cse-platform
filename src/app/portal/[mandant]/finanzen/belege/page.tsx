import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  BELEG_QUELLEN, BELEG_TYPEN, belegZaehler, belege,
  istBelegQuelle, istBelegTyp, type BelegZaehler, type BelegZeile,
} from '@/server/services/finanz/beleg';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { BELEGE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/belege';

/**
 * `/portal/[mandant]/finanzen/belege` — das GoBD-Belegarchiv einer
 * Gesellschaft (04-SEITENKARTE.md §5.14, FIN-14, ACC-03, ACC-06, DOC-08,
 * §147 AO).
 *
 * **Die Datei ist hier nirgends verlinkt.** Jede Zeile führt auf
 * `/finanzen/belege/[id]`, und erst dort wird — nach der Berechtigungs­
 * entscheidung — die kurzlebige signierte URL gezogen (DOC-03, SEC-A6). Ein
 * direkter Speicherpfad in einer Liste ist eine Adresse, die im HTML, im
 * Serverprotokoll und in der Zwischenablage landet.
 *
 * **Fünf Quellen, nicht vier.** Das DB-Enum `beleg_quelle` führt
 * `erzeugt` — jede Ausgangsrechnung, die die Plattform selbst erstellt. Der
 * engere Typ in `eingangsrechnung.ts` kennt ihn nicht, und ein Filter darauf
 * liess erzeugte Belege lautlos verschwinden: nicht als Fehler, sondern als
 * Liste, in der etwas fehlt, das niemand zählt. Dieser Filter benutzt deshalb
 * den vollen Satz aus `services/finanz/beleg.ts`.
 *
 * **Die Aufbewahrungsfrist wird nicht geraten.** Wo `aufbewahrung_bis` leer
 * ist, ist die Frist dieser Klasse nicht entschieden (O-46) — dann steht
 * „Frist offen (O-46)" da und nicht „zehn Jahre". §147 AO nennt zehn Jahre
 * für Buchungsbelege und sechs für Handelsbriefe; welche Klasse dieser
 * Plattform welche Frist trägt, bestätigt der Mandant.
 *
 * **Die Löschsperre ist ein ZUSTAND, kein Schalter.** Es gibt hier keinen
 * Löschknopf, auch keinen ausgegrauten: ein gelöschter Beleg liesse eine
 * Buchung ohne Nachweis zurück (Invariante 8), und ein gesperrter Knopf
 * erklärt das nicht.
 *
 * **Ohne verbundenen Objektspeicher legt der Seed keine Belege an.** Das ist
 * die wirkliche Ursache einer leeren Liste in einer Demo — nicht eine
 * fehlende Seedzeile. Der Leerzustand sagt das, damit niemand die Seite für
 * kaputt hält.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Belege — Finanzen' };

/*
 * Der Spaltenname lautet in beiden Sprachen gleich und steht deshalb hier und
 * nicht in der Texttabelle (siehe den Kopf von `i18n/verwaltung/finanzen/belege.ts`).
 */
const SPALTE_AUFBEWAHRUNG_BIS = 'aufbewahrung_bis';

export default async function Belegliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;

  const typRoh = typeof suche['typ'] === 'string' ? suche['typ'] : null;
  const quelleRoh = typeof suche['quelle'] === 'string' ? suche['quelle'] : null;
  const jahrRoh = typeof suche['jahr'] === 'string' ? suche['jahr'] : null;
  const filter = {
    typ: istBelegTyp(typRoh) ? typRoh : null,
    quelle: istBelegQuelle(quelleRoh) ? quelleRoh : null,
    jahr: jahrRoh !== null && /^\d{4}$/u.test(jahrRoh) ? Number(jahrRoh) : null,
  };

  const tor = await mandantTor(`/portal/${mandant}/finanzen/belege`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(BELEGE_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      zeilen: await belege(kontext, filter),
      zaehler: await belegZaehler(kontext, filter),
    }))) as Promise<{
      zeilen: readonly BelegZeile[]; zaehler: BelegZaehler;
    }>);

  /*
   * `max-w-full` und `min-w-0` — dieselbe Behandlung wie in `finanzen/ausgaben`
   * (D-609). Ein `<select>` ist so breit wie seine LAENGSTE Option und
   * schrumpft nicht, weil es nicht umbricht; `min-width: auto` am
   * Flex-Element haelt diese Mindestbreite, BEVOR `flex-wrap` greift.
   *
   * Diese Seite war gruen — aber nur, weil ihre Optionstexte heute kurz sind
   * („Rechnung", „Kassenbeleg"). Ein laengeres Wort oder die englische
   * Fassung (D-592) haette sie ueber den Rand geschoben. Darauf zu warten,
   * bis die Suite es meldet, waere die teurere Reihenfolge.
   */
  const feld = 'min-h-11 max-w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const gefiltert = filter.typ !== null || filter.quelle !== null || filter.jahr !== null;

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.titel}</h1>
        <form method="get" className="flex min-w-0 flex-wrap items-end gap-s3">
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="typ">{t.typ}</label>
            <select id="typ" name="typ" defaultValue={filter.typ ?? ''} className={feld}>
              <option value="">{t.alle}</option>
              {BELEG_TYPEN.map((bt) => (
                <option key={bt} value={bt}>{t.typNamen[bt]}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="quelle">
              {t.quelle}
            </label>
            <select
              id="quelle" name="quelle" defaultValue={filter.quelle ?? ''} className={feld}
            >
              <option value="">{t.alle}</option>
              {BELEG_QUELLEN.map((bq) => (
                <option key={bq} value={bq}>{t.quelleNamen[bq]}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="block text-xs text-text-muted" htmlFor="jahr">{t.jahr}</label>
            <input
              id="jahr" name="jahr" type="number" min="2000" max="2999" step="1"
              defaultValue={filter.jahr ?? ''} placeholder={t.alle} className={feld}
            />
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
          >
            {t.anzeigen}
          </button>
          {gefiltert ? (
            <Link
              href={`/portal/${mandant}/finanzen/belege`}
              className="text-sm text-text-muted underline underline-offset-2 hover:text-text"
            >
              {g.zuruecksetzen}
            </Link>
          ) : null}
        </form>
      </div>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3">
        <KpiStat label={t.belegeImArchiv} wert={String(daten.zaehler.gesamt)} icon="dokument" />
        <KpiStat
          label={t.mitLoeschsperre}
          wert={String(daten.zaehler.mitLoeschsperre)}
          icon="schloss"
        />
        <KpiStat
          label={t.fristOffen}
          wert={String(daten.zaehler.ohneFrist)}
          ton={daten.zaehler.ohneFrist > 0 ? 'warning' : 'muted'}
          icon="uhr"
        />
      </div>

      {daten.zaehler.jeTyp.length === 0 ? null : (
        <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="belege-je-typ">
          {t.jeTyp}{' '}
          {daten.zaehler.jeTyp
            .map((jt) => `${t.typNamen[jt.typ] ?? jt.typ} ${String(jt.anzahl)}`)
            .join(' · ')}
        </p>
      )}

      {daten.zaehler.ohneFrist > 0 ? (
        <Hinweis art="warnung" cse="belege-frist-offen" className="mb-s5">
          <p className="m-0 max-w-prose">
            {daten.zaehler.ohneFrist === 1
              ? t.einBelegOhneFrist
              : `${String(daten.zaehler.ohneFrist)}${t.belegeOhneFrist}`}{' '}
            {t.fristOffenErklaerung}
          </p>
        </Hinweis>
      ) : null}

      {daten.zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="belege-leer">
          <p className="m-0 max-w-prose">
            {gefiltert ? t.keinBelegZumFilter : t.keinBelegImArchiv}
          </p>
        </Hinweis>
      ) : (
        <DataTable
          beschriftung={t.tabelleListe}
          zeilen={daten.zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: t.belegnummer,
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/finanzen/belege/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.belegnummer
                    ?? <span className="text-text-subtle">{t.ohneNummer}</span>}
                </Link>
              ),
            },
            { schluessel: 'typ', kopf: t.typ, zelle: (z) => t.typNamen[z.typ] ?? z.typ },
            {
              schluessel: 'quelle', kopf: t.quelle,
              zelle: (z) => t.quelleNamen[z.quelle] ?? z.quelle,
            },
            {
              schluessel: 'datum', kopf: t.belegdatum,
              zelle: (z) => z.belegdatum ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'brutto', kopf: t.brutto, numerisch: true,
              zelle: (z) => (z.bruttoCent === null ? '—' : formatiereGeld(z.bruttoCent)),
            },
            {
              schluessel: 'seiten', kopf: t.seiten, numerisch: true,
              zelle: (z) => z.seiten ?? '—',
            },
            {
              schluessel: 'eingang', kopf: t.eingegangen,
              zelle: (z) => (
                <span className="text-xs text-text-muted">{z.eingegangenAm}</span>
              ),
            },
            {
              schluessel: 'aufbewahrung',
              kopf: t.aufbewahrung,
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1">
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    {/*
                      * DESIGN §5 führt ein FESTES Pillenvokabular, und
                      * „Gesperrt" steht nicht darin. Abgebildet wird auf
                      * „Archiviert" — die Löschsperre heisst hier: die Zeile
                      * bleibt. Der Zustand steht ausgeschrieben daneben, weil
                      * die Farbe die Bedeutung nicht allein tragen darf (§9).
                      */}
                    {z.loeschsperre
                      ? <StatusPill zustand="Archiviert" sprache={zugang.sprache} />
                      : <StatusPill zustand="Inaktiv" sprache={zugang.sprache} />}
                    <span className="text-xs text-text-muted">
                      {z.loeschsperre ? t.loeschsperre : t.keineSperre}
                      {' · '}
                      {z.aufbewahrungKlasse}
                    </span>
                  </span>
                  <span className="text-xs">
                    {z.fristOffen
                      ? <span className="text-warning">{t.fristOffen}</span>
                      : (
                        <span className="text-text-muted">
                          {t.bisZum} {z.aufbewahrungBis}
                        </span>
                      )}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.listeFussnoteVor}{' '}
        <code>{SPALTE_AUFBEWAHRUNG_BIS}</code>{' '}
        {t.listeFussnoteNach}
      </p>
    </PortalRahmen>
  );
}
