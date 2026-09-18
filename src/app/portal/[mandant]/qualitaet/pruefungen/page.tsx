import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { monatsgrenzen } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { Icon } from '@/components/ui/Icon';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import {
  listePruefungen, PRUEFUNG_GRENZE, zaehlePruefungen,
  type PruefungZahlen, type PruefungZeile,
} from '@/server/services/reinigung/qualitaet';

/**
 * `/portal/[mandant]/qualitaet/pruefungen` — die Qualitätsprüfungen (OPS-11,
 * SPEC §22).
 *
 * **Hier steht keine Bestanden-Pille, und das ist der Punkt.** SPEC nennt kein
 * Prüfverfahren, keine Skala und keine Bestehensschwelle; in der Datenbank
 * steht je Gesellschaft genau ein Verfahren „unbestimmt" mit `max_punkte
 * NULL`, `bestehensschwelle_prozent NULL` und `ist_platzhalter true`, und
 * `qualitaetspruefung.bestanden` bleibt NULL. Eine plausible Zahl — 90 %,
 * 95 % — wäre eine erfundene Geschäftsregel mit vertraglicher Wirkung (K-17).
 * Also steht in der Bewertungsspalte ein Strich, und über der Tabelle steht,
 * warum.
 *
 * **Der Erfüllungsgrad erscheint nur, wenn das Verfahren eine Skala trägt.**
 * `erfuellungsgrad_prozent` ist eine generierte Spalte (`punkte / max_punkte`)
 * und damit NULL, solange keine Skala existiert — und eine leere Prozentspalte
 * ohne Erklärung liest sich als „0 %".
 *
 * **Qualität steht NEBEN den Gewerken.** Das Modul ist ein Querschnittsmodul
 * (`registry/modul.ts`): eine Prüfung an einem Wachobjekt ist dieselbe Zeile
 * wie eine an einem Reinigungsrevier. Deshalb liegen `objekt` (`objekt.lesen`),
 * `kunde` (`crm.lesen`) und `revier` (`reinigung.lesen`) hinter anderen
 * Rechten als diese Liste (`qualitaet.lesen`), und fehlende Namen heissen
 * „nicht geprüft" und nicht „nicht vorhanden".
 */
export const dynamic = 'force-dynamic';

const UNGEPRUEFT = 'nicht geprüft';

/** Punkt zu Komma — die Datenbank liefert Punkte, DESIGN §5 zeigt Kommas. */
function deutsch(wert: string | null): string {
  return wert === null ? '—' : wert.replace('.', ',');
}

export default async function Pruefungsliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const nurMangel = suche['mangel'] === '1';

  const tor = await mandantTor(`/portal/${mandant}/qualitaet/pruefungen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: „Prüfung erfassen" verlangt `qualitaet.schreiben`, das Objekt
     `objekt.lesen`. Ein Verweis auf 404 verrät, was er nicht zeigen darf. */
  const darf = await haeltRechte(sitzung, 'qualitaet.schreiben', 'objekt.lesen');

  const heute = await berlinHeute();
  const monat = monatsgrenzen(heute);

  /*
   * ZWEI Abfragen, und der Unterschied ist die ganze Auskunft der Kacheln:
   * `listePruefungen` liefert den ANGEZEIGTEN Ausschnitt (gefiltert, bei
   * `PRUEFUNG_GRENZE` abgeschnitten), `zaehlePruefungen` die Zahlen der
   * GANZEN Gesellschaft. Aus dem Ausschnitt gerechnet zeigte die Kachel
   * „Prüfungen (alle)" unter `?mangel=1` die Zahl der Prüfungen MIT Mangel —
   * eine Beschriftung, die das Gegenteil ihres Wortes behauptet.
   */
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      zeilen: await listePruefungen(kontext, { nurMitMangel: nurMangel }),
      zahlen: await zaehlePruefungen(kontext, monat),
    }))) as Promise<{
      zeilen: readonly PruefungZeile[];
      zahlen: PruefungZahlen;
    }>);
  const { zeilen, zahlen } = daten;
  const amLimit = zeilen.length >= PRUEFUNG_GRENZE;
  /* Diese eine Zahl gehoert BEWUSST zum Ausschnitt: der Satz unten vergleicht
     sie mit `zeilen.length` und meint die angezeigte Tabelle, nicht die
     Gesellschaft. `zahlen.ohneSkala` waere hier die falsche Bezugsgroesse. */
  const ohneSkalaImAusschnitt = zeilen.filter(
    (z) => z.verfahrenMaxPunkte === null).length;

  return (
    <PortalRahmen
      titel="Qualitätsprüfungen"
      wurzelTitel="Qualität"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="qualitaet"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Qualitätsprüfungen</h1>
        <div className="flex flex-wrap items-baseline gap-s4">
          <Link
            href={`/portal/${mandant}/qualitaet/reklamationen`}
            className="text-sm underline hover:text-text"
          >
            Reklamationen
          </Link>
          {darf['qualitaet.schreiben'] === true && (
            <Link
              href={`/portal/${mandant}/qualitaet/pruefungen/neu`}
              data-cse="pruefung-neu"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4 text-sm
                         font-semibold text-white hover:bg-brand-hover"
            >
              Prüfung erfassen
            </Link>
          )}
        </div>
      </div>

      {/*
        Die Erklärzeile steht ÜBER der Tabelle, nicht als Fussnote: eine leere
        Bewertungsspalte ohne diesen Satz liest sich als „noch nicht bewertet"
        oder als „0 %".
      */}
      <Hinweis art="hinweis" cse="pruefung-o29" className="mb-s5 max-w-prose">
        <strong>Offen (O-29): es gibt keine Bewertung.</strong> Auslöser, Skala,
        Bestehensschwelle und die Folge einer nicht bestandenen Prüfung sind
        nicht festgelegt. Das Prüfverfahren in der Datenbank ist ein
        <strong> Platzhalter ohne Skala</strong>, deshalb bleibt
        „bestanden" leer — <em>nicht</em> „nicht bestanden" — und ein
        Erfüllungsgrad erscheint nur, wo ein Verfahren eine Skala trägt. Eine
        plausible Schwelle (90 %, 95 %) wäre eine erfundene Regel mit
        vertraglicher Wirkung. Was die Prüfung schon heute belegt, sind die
        <strong> Befunde</strong>: was in Ordnung war, was nicht, und bis wann es
        abgestellt sein soll.
      </Hinweis>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat
          label="Prüfungen (alle)"
          wert={String(zahlen.alle)}
          icon="qualitaet"
          ton="info"
        />
        <KpiStat
          label="Im laufenden Monat"
          wert={String(zahlen.imMonat)}
          icon="kalender"
          ton="info"
        />
        <KpiStat
          label="Mit Mangel"
          wert={String(zahlen.mitMangel)}
          icon="warnung"
          ton={zahlen.mitMangel === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Mängelfristen überfällig"
          wert={String(zahlen.fristenUeberfaellig)}
          icon="fehler"
          ton={zahlen.fristenUeberfaellig === 0 ? 'muted' : 'danger'}
        />
      </div>

      {(nurMangel || amLimit) && (
        <p className="mb-s5 max-w-prose text-sm text-text-muted" data-cse="kachel-umfang">
          Die Kacheln zählen <strong className="text-text">alle</strong> Prüfungen
          dieser Gesellschaft, die Tabelle darunter zeigt
          {nurMangel ? ' nur die mit Mangel' : ' den Anfang der Liste'}
          {amLimit && (
            <>
              {' '}und endet bei {PRUEFUNG_GRENZE} Zeilen — es gibt weitere
            </>
          )}
          . Die beiden Zahlen dürfen deshalb auseinandergehen.
        </p>
      )}

      <div className="mb-s5 flex flex-wrap items-baseline gap-s4">
        <Link
          href={`/portal/${mandant}/qualitaet/pruefungen`}
          className={`text-sm ${nurMangel ? 'text-text-muted underline hover:text-text' : 'text-text'}`}
        >
          Alle Prüfungen
        </Link>
        <Link
          href={`/portal/${mandant}/qualitaet/pruefungen?mangel=1`}
          className={`text-sm ${nurMangel ? 'text-text' : 'text-text-muted underline hover:text-text'}`}
          data-cse="filter-mangel"
        >
          Nur mit Mangel
        </Link>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {nurMangel
            ? 'Keine Prüfung mit einem Befund „nicht in Ordnung".'
            : 'Keine Qualitätsprüfung erfasst. Das heisst: keine ist durchgeführt '
              + 'worden — nicht, dass alles in Ordnung wäre.'}
        </p>
      ) : (
        <DataTable<PruefungZeile>
          beschriftung="Qualitätsprüfungen mit Bezug, Verfahren, Prüfer und Befunden"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/qualitaet/pruefungen/${z.id}`}
                  data-cse="zur-pruefung"
                  className="underline hover:text-text"
                >
                  {z.nummer}
                </Link>
              ),
            },
            {
              schluessel: 'zeit',
              kopf: 'Geprüft (Berlin)',
              zelle: (z) => (
                <span>
                  <span className="tabular-nums">{z.gepruefLokal}</span>
                  {z.nachgetragen && (
                    <span className="block text-micro text-warning">nachgetragen</span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'bezug',
              kopf: 'Bezug',
              zelle: (z) => (
                <span>
                  {z.objektId === null
                    ? (z.projektId === null ? '—' : 'Projekt')
                    : (z.objekt ?? <span className="text-text-muted">{UNGEPRUEFT}</span>)}
                  <span className="block text-micro text-text-muted">
                    {z.revier ?? (z.revierId === null ? 'ganzes Objekt' : UNGEPRUEFT)}
                    {z.kunde !== null && ` · ${z.kunde}`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'verfahren',
              kopf: 'Verfahren',
              zelle: (z) => (
                <span>
                  {z.verfahren}
                  {/* §1.16: ein unbestätigtes Verfahren sagt das — als WORT und
                      nicht als Pille (DESIGN §5 führt kein solches Wort). */}
                  {z.verfahrenIstPlatzhalter && (
                    <span className="block text-micro text-warning">
                      Platzhalter ohne Skala (O-29)
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'pruefer',
              kopf: 'Prüfer',
              zelle: (z) => (z.prueferName
                ?? z.prueferExternName
                ?? (z.prueferAnstellungId === null ? '—' : UNGEPRUEFT)),
            },
            {
              schluessel: 'kunde',
              kopf: 'Mit Kunde',
              zelle: (z) => (z.mitKunde ? 'ja' : 'nein'),
            },
            {
              schluessel: 'befunde',
              kopf: 'Befunde',
              numerisch: true,
              zelle: (z) => (
                <span className="tabular-nums">
                  {z.befunde}
                  {z.befundeNio > 0 && (
                    <span className="ml-s2 text-warning">
                      <Icon
                        name="warnung"
                        groesse="sm"
                        className="mr-s1 inline-block align-[-2px]"
                      />
                      {z.befundeNio} nio
                    </span>
                  )}
                </span>
              ),
            },
            {
              schluessel: 'fristen',
              kopf: 'Fristen überfällig',
              numerisch: true,
              zelle: (z) => (z.fristenUeberfaellig === 0
                ? '—'
                : (
                  <span className="tabular-nums text-danger" data-cse="frist-ueberfaellig">
                    {z.fristenUeberfaellig}
                  </span>
                )),
            },
            {
              schluessel: 'grad',
              kopf: 'Erfüllungsgrad',
              numerisch: true,
              /*
                Nur wo das Verfahren eine Skala trägt. Sonst ein Strich — und
                der Satz über der Tabelle sagt, warum (O-29). Eine leere
                Prozentspalte ohne Erklärung liest sich als „0 %".
              */
              zelle: (z) => (z.verfahrenMaxPunkte === null || z.erfuellungsgradProzent === null
                ? <span className="text-text-muted">—</span>
                : <span className="tabular-nums">{deutsch(z.erfuellungsgradProzent)} %</span>),
            },
          ]}
        />
      )}

      {ohneSkalaImAusschnitt > 0 && zeilen.length > 0 && (
        <p className="mt-s4 max-w-prose text-xs text-text-subtle">
          {ohneSkalaImAusschnitt} von {zeilen.length} angezeigten Prüfung(en)
          laufen auf einem Verfahren
          ohne Skala — dort bleibt der Erfüllungsgrad leer, weil es keinen gibt,
          und nicht, weil er null wäre.
        </p>
      )}
    </PortalRahmen>
  );
}
