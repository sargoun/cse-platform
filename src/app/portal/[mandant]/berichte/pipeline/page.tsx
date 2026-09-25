import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { pipeline, type PipelineStufe } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/pipeline` — REP-06.
 *
 * **Ein Trichter, weil die Zahlen einer sind** (V-226, D-720). Jede Stufe
 * zählt, was sie ERREICHT hat — gefunden, gesichtet, geboten, gewonnen —, und
 * nicht, wo ein Vorgang heute steht. Vorher stand hier der heutige Status je
 * Vorgang als Balken: ein gewonnener Vorgang zählte nur unter „Zuschlag",
 * „Gefunden" war immer 0, und die Gruppenseite zeigte für dieselben Zeilen
 * andere Zahlen. Verworfen steht in der Tabelle daneben und nicht im
 * Trichter: es ist ein Ausgang, keine Stufe.
 *
 * Der Balken ist kein Diagramm mit eigener Skala, sondern ein Anteil an
 * „gefunden": er lässt sich ohne Achse lesen und trägt seine Zahl daneben
 * (DESIGN §9 — Farbe und Länge tragen nie allein).
 */
export const dynamic = 'force-dynamic';

export default async function Pipeline({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="pipeline"
      suche={suche}
      nurJahr
      fussnote={
        <>
          <strong>Gezählt wird, was eine Stufe erreicht hat, im Jahr des Eingangs.</strong>{' '}
          Gefunden ist jede Bekanntmachung, die das Radar für diese Gesellschaft bewertet und
          nicht ausgeschlossen hat, und jede, zu der jemand einen Vorgang eröffnet hat.
          Gesichtet ist ein Vorgang mit einem Stand, auch ein verworfener. Geboten ist, was
          eingereicht wurde — mit oder ohne Ergebnis, auch wenn die Vergabestelle das
          Verfahren danach aufgehoben hat. Ein Fall erscheint im Jahr, in dem er gefunden
          wurde, auch wenn der Zuschlag erst im nächsten kommt. Der Zuschlagswert steht nur
          auf „Gewonnen"; die Gruppenansicht zählt genauso.
        </>
      }
      kinder={async (kontext, lage) => {
        const stufen = await pipeline(kontext, lage.jahresZeitraum);
        const trichter = stufen.filter((s) => s.imTrichter);
        const groesste = Math.max(1, ...trichter.map((s) => s.anzahl));

        return (
          <>
            <ol data-cse="pipeline-trichter" className="mb-s6 flex flex-col gap-s3">
              {trichter.map((s) => (
                <li key={s.stufe} data-cse={`stufe-${s.stufe}`}
                    className="grid grid-cols-[10rem_1fr_3rem] items-center gap-s3">
                  <span className="truncate text-sm text-text">{s.bezeichnung}</span>
                  <span className="h-2 rounded-full bg-surface-3" aria-hidden="true">
                    <span
                      className="block h-2 rounded-full bg-brand"
                      style={{ width: `${String(Math.round((s.anzahl / groesste) * 100))}%` }}
                    />
                  </span>
                  <span className="text-end text-sm tabular-nums text-text">{s.anzahl}</span>
                </li>
              ))}
            </ol>

            <DataTable<PipelineStufe>
              beschriftung={`Vergabepipeline ${String(lage.jahr)}`}
              schluessel={(z) => z.stufe}
              zeilen={stufen}
              spalten={[
                { schluessel: 'stufe', kopf: 'Stufe',
                  zelle: (z) => (z.imTrichter
                    ? z.bezeichnung
                    : <>{z.bezeichnung} <span className="text-text-subtle">(nicht im Trichter)</span></>) },
                { schluessel: 'anzahl', kopf: 'Fälle', numerisch: true,
                  zelle: (z) => z.anzahl },
                { schluessel: 'wert', kopf: 'Zuschlagswert', numerisch: true,
                  zelle: (z) => (z.zuschlagswertCent === null
                    ? <span className="text-text-subtle">—</span>
                    : formatiereGeld(z.zuschlagswertCent)) },
              ]}
            />
          </>
        );
      }}
    />
  );
}
