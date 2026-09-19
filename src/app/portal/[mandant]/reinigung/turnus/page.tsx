import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { lesbareRegel, regelFehler } from '@/lib/datum/regeltext';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import {
  listeTurnusse, type TurnusListe, type TurnusZeile,
} from '@/server/services/reinigung/turnus';

/**
 * `/portal/[mandant]/reinigung/turnus` — die Reinigungsturnusse (CLN-02,
 * CLN-03, TIM-02).
 *
 * **Diese Seite und `/dienstplan/serien` zeigen dasselbe Artefakt aus zwei
 * Richtungen, und genau deshalb lesen sie über EINE Quelle.** Dort ankert die
 * Liste auf `planungsserie` und zeigt Turnus- und Postenserien zusammen; hier
 * ankert sie auf `turnus` und zeigt nur die Reinigung — inklusive der
 * Turnusse, die noch keine Serie haben. Die zwei Zahlen, die beide gross
 * anzeigen — Termine und `generiert_bis` — kommen aus denselben Bausteinen in
 * `services/dienstplan/serienliste.ts`. Zwei Abfragen wären zwei Meinungen
 * darüber, wie viele Schichten diese Regel erzeugt hat.
 *
 * **„Generator steht" und „kein Recht" sehen gleich aus — hier nicht.**
 * `planungsserie` und `einsatz` liegen hinter `dienstplan.lesen`, diese Route
 * hält `reinigung.lesen`. Ohne das zweite Recht wären „geplant bis" und
 * „Schichten" still leer, und eine leere Zelle liest sich als Befund. Steht
 * das Recht nicht, sagt die Spalte „nicht geprüft" — als Wort, nicht als
 * Farbe (DESIGN §9).
 *
 * **Eine Regel, die der Parser abweist, wird als Fehler gezeigt.** Nicht
 * übersprungen und nicht geraten: derselbe Parser entfaltet sie nachts, und
 * eine erfundene Zusammenfassung wäre schlimmer als der Rohtext.
 */
export const dynamic = 'force-dynamic';

const UNGEPRUEFT = 'nicht geprüft';

export default async function TurnusListe(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /*
   * Die Rueckmeldung des Generatorlaufs. `/api/reinigung/turnus` haengt sie
   * an die Weiterleitung, und /neu sagt dem Bedienenden zweimal zu, dass sie
   * hier ankommt: „die Serienliste meldet die Zahl der erzeugten Schichten und
   * was er uebersprungen hat". Ohne diesen Block verschwand genau das —
   * einschliesslich „0 Schichten erzeugt, weil Objekt ohne Kunde", also der
   * einen Meldung, nach der jemand sonst eine Stunde sucht.
   */
  const suche = await searchParams;
  const einzeln = (k: string): string | null => (
    typeof suche[k] === 'string' && suche[k] !== '' ? suche[k] : null);
  const angelegt = einzeln('angelegt');
  const erzeugtRoh = einzeln('erzeugt');
  const erzeugt = erzeugtRoh !== null && /^\d+$/u.test(erzeugtRoh)
    ? Number(erzeugtRoh) : null;
  const bestandSchon = einzeln('bestand') === '1';
  const uebersprungen = einzeln('uebersprungen');

  const tor = await mandantTor(`/portal/${mandant}/reinigung/turnus`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: „Turnus anlegen" verlangt `reinigung.schreiben`, „Zur Serie"
     verlangt `dienstplan.lesen`. Ein Verweis auf 404 verrät, was er nicht
     zeigen darf. */
  const darf = await haeltRechte(sitzung, 'reinigung.schreiben', 'dienstplan.lesen');

  const heute = await berlinHeute();
  const { zeilen, geprueft } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) =>
        listeTurnusse(kontext))) as Promise<TurnusListe>);

  const planbar = geprueft['dienstplan.lesen'] === true;
  const lebend = zeilen.filter((z) => !z.archiviert);
  /* `planungsserie` liegt hinter `dienstplan.lesen`. Ohne das Recht ist
     `planungsserieId` auf JEDER Zeile null — „Ohne Serie: alle" waere ein
     Fehlalarm, kein Befund. Dieselbe Behandlung wie bei `stehend`. */
  const ohneSerie = planbar
    ? lebend.filter((z) => z.planungsserieId === null).length
    : null;
  const stehend = planbar
    ? lebend.filter((z) => z.planungsserieId !== null
      && (z.generiertBis === null || z.generiertBis < heute)).length
    : null;
  const kaputt = lebend.filter((z) => regelFehler(z.rrule) !== null).length;

  return (
    <PortalRahmen
      titel="Turnus"
      wurzelTitel="Reinigung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/reinigung`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Reinigung
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Turnus</h1>
        <div className="flex flex-wrap items-baseline gap-s4">
          {darf['dienstplan.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/dienstplan/serien`}
              className="text-sm underline hover:text-text"
            >
              Alle Serien (auch Posten)
            </Link>
          )}
          {darf['reinigung.schreiben'] === true && (
            <Link
              href={`/portal/${mandant}/reinigung/turnus/neu`}
              data-cse="turnus-neu"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4 text-sm
                         font-semibold text-white hover:bg-brand-hover"
            >
              Turnus anlegen
            </Link>
          )}
        </div>
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Ein Turnus ist die Regel, nach der eine Reinigungsleistung wiederkehrt —
        Revier, Wochen- oder Monatsrhythmus, Beginn als Berliner Wanduhrzeit und
        eine Solldauer. Aus ihm schreibt der nächtliche Generator Schichten;
        die <strong className="text-text">Dauer ist ein Sollwert</strong>,
        keine gemessene Zeit.
      </p>

      {angelegt !== null && (
        <Hinweis art="erfolg" cse="turnus-angelegt" className="mb-s5 max-w-prose">
          <strong>
            {bestandSchon
              ? 'Turnus angelegt, die Planungsserie bestand schon.'
              : 'Turnus und Planungsserie angelegt.'}
          </strong>{' '}
          {erzeugt === null
            ? 'Wie viele Schichten der Generator daraus geschrieben hat, meldet '
              + 'die Weiterleitung nicht.'
            : erzeugt === 0
              ? 'Der Generator hat dabei KEINE Schicht geschrieben.'
              : `Der Generator hat dabei ${String(erzeugt)} Schicht(en) geschrieben.`}
          {uebersprungen !== null && (
            <>
              {' '}
              <strong className="text-text">Übersprungen:</strong> {uebersprungen}
            </>
          )}
          {erzeugt === 0 && uebersprungen === null && (
            <>
              {' '}
              Das ist nicht zwingend ein Fehler: liegt der Beginn ausserhalb des
              Horizonts oder fällt jeder Termin auf einen Feiertag, entsteht
              zunächst nichts. Die Zeile unten zeigt, bis wann geplant ist.
            </>
          )}
        </Hinweis>
      )}

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat label="Turnusse" wert={String(lebend.length)} icon="dienstplan" ton="info" />
        <KpiStat
          label="Ohne Serie"
          wert={ohneSerie === null ? UNGEPRUEFT : String(ohneSerie)}
          icon="warnung"
          ton={ohneSerie === null || ohneSerie === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Generator steht"
          wert={stehend === null ? UNGEPRUEFT : String(stehend)}
          icon="fehler"
          ton={stehend === null || stehend === 0 ? 'muted' : 'danger'}
        />
        <KpiStat
          label="Regel unlesbar"
          wert={String(kaputt)}
          icon="fehler"
          ton={kaputt === 0 ? 'muted' : 'danger'}
        />
      </div>

      {!planbar && (
        <Hinweis art="hinweis" cse="turnus-ungeprueft" className="mb-s5 max-w-prose">
          <strong>Ob eine Serie besteht, Generatorstand und Schichtzahl sind
          nicht geprüft.</strong> Alle drei stehen in der Planungsserie und in
          den Schichten, und die liegen hinter dem Recht
          {' '}<code>dienstplan.lesen</code>. Die Regeln selbst stehen unten
          vollständig — ob daraus Schichten entstanden sind, sagt diese Ansicht
          nicht. Eine Null wäre hier eine Entwarnung und „ohne Serie" ein
          Fehlalarm; beides hat niemand geprüft.
        </Hinweis>
      )}

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Turnus angelegt. Ohne Turnus entsteht keine wiederkehrende
          Schicht — und damit kein Leistungsnachweis, den ein Kunde
          unterschreiben kann.
        </p>
      ) : (
        <DataTable<TurnusZeile>
          beschriftung="Turnusse dieser Gesellschaft mit Regel, Zeitfenster und Generatorstand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Turnus',
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/reinigung/turnus/${z.id}`}
                    data-cse="zum-turnus"
                    className="block text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.bezeichnung}
                  </Link>
                  <span className="block text-micro text-text-muted">
                    {z.objekt ?? `Objekt ${UNGEPRUEFT}`}
                    {' · '}
                    {z.revier}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'leistung',
              kopf: 'Leistung',
              zelle: (z) => (z.leistung === null ? (
                <span className="text-text-muted">{UNGEPRUEFT}</span>
              ) : (
                <span>
                  {z.leistung}
                  {z.leistungIstPlatzhalter === true && (
                    <span className="ml-s2 text-warning">· Katalogwert unbestätigt</span>
                  )}
                </span>
              )),
            },
            {
              schluessel: 'regel',
              kopf: 'Regel',
              zelle: (z) => {
                const fehler = regelFehler(z.rrule);
                return fehler === null ? lesbareRegel(z.rrule) : (
                  <span className="text-danger" data-cse="turnus-regelfehler" title={fehler}>
                    <Icon name="fehler" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
                    Regel unlesbar: <code>{z.rrule}</code>
                  </span>
                );
              },
            },
            {
              schluessel: 'zeit',
              kopf: 'Beginn · Solldauer',
              zelle: (z) => `${z.beginnLokal} · ${stundenAusMinuten(z.dauerMinuten)}`,
            },
            {
              schluessel: 'feiertag',
              kopf: 'Am Feiertag',
              zelle: (z) => (z.feiertagsregel === 'ausfall' ? 'fällt aus' : 'findet statt'),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Gültig',
              zelle: (z) => (z.gueltigBis === null
                ? `ab ${z.gueltigAb}`
                : `${z.gueltigAb} bis ${z.gueltigBis}`),
            },
            {
              schluessel: 'stand',
              kopf: 'Geplant bis',
              zelle: (z) => {
                if (!planbar) return <span className="text-text-muted">{UNGEPRUEFT}</span>;
                if (z.planungsserieId === null) {
                  return <span className="text-warning">keine Serie</span>;
                }
                if (z.generiertBis === null) {
                  return <span className="text-warning">noch nie gelaufen</span>;
                }
                return z.generiertBis < heute && !z.archiviert
                  ? (
                    <span className="tabular-nums text-danger" data-cse="generator-steht">
                      {z.generiertBis} — Generator steht
                    </span>
                  )
                  : <span className="tabular-nums">{z.generiertBis}</span>;
              },
            },
            {
              schluessel: 'einsaetze',
              kopf: 'Schichten',
              numerisch: true,
              zelle: (z) => (z.einsaetze === null
                ? <span className="text-text-muted">—</span>
                : String(z.einsaetze)),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={z.archiviert ? 'Archiviert' : 'Aktiv'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
