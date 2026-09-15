import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { pipeline, type PipelineStufe } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/pipeline` — REP-06.
 *
 * **Jede Stufe erscheint, auch die leere.** Eine Pipeline, die nur zeigt, wo
 * etwas liegt, verschweigt genau die Stufe, an der nichts ankommt — und das
 * ist die, wegen der man hinsieht.
 *
 * Der Balken ist kein Diagramm mit eigener Skala, sondern ein Anteil an der
 * grössten Stufe: er lässt sich ohne Achse lesen und trägt seine Zahl
 * daneben (DESIGN §9 — Farbe und Länge tragen nie allein).
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
          <strong>Gezählt wird nach Eingang, nicht nach Entscheidung.</strong> Ein Vorgang
          erscheint im Jahr, in dem er gefunden wurde — auch wenn der Zuschlag erst im
          nächsten kommt. Der Zuschlagswert steht nur auf der Stufe „Zuschlag"; er wird beim
          Eintragen des Ergebnisses erfasst.
        </>
      }
      kinder={async (kontext, lage) => {
        const stufen = await pipeline(kontext, lage.jahresZeitraum);
        const groesste = Math.max(1, ...stufen.map((s) => s.anzahl));

        return (
          <>
            <ol data-cse="pipeline-trichter" className="mb-s6 flex flex-col gap-s3">
              {stufen.map((s) => (
                <li key={s.status} data-cse={`stufe-${s.status}`}
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
              schluessel={(z) => z.status}
              zeilen={stufen}
              spalten={[
                { schluessel: 'stufe', kopf: 'Stufe', zelle: (z) => z.bezeichnung },
                { schluessel: 'anzahl', kopf: 'Vorgänge', numerisch: true,
                  zelle: (z) => z.anzahl },
                { schluessel: 'wert', kopf: 'Zuschlagswert', numerisch: true,
                  zelle: (z) => (z.status === 'zuschlag'
                    ? formatiereGeld(z.zuschlagswertCent)
                    : <span className="text-text-subtle">—</span>) },
              ]}
            />
          </>
        );
      }}
    />
  );
}
