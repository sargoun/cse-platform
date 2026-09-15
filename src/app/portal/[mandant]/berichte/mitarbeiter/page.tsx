import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { prozent, stunden } from '@/server/services/bericht/ausgabe';
import { mitarbeiterReihe, type MitarbeiterZeile }
  from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/mitarbeiter` — REP-04.
 *
 * **Nur freigegebene Zeiteinträge.** Ein Eintrag im Status `erfasst` ist eine
 * Behauptung; eine Auslastung aus Behauptungen ändert sich noch und steht
 * neben Zahlen, die sich nicht mehr ändern.
 *
 * **Auslastung ohne Soll ist `null` und nicht 0 %.** Ein Aushilfsvertrag ohne
 * Wochenstunden ist kein Mensch, der nicht arbeitet — und in derselben Spalte
 * wäre eine echte Null von einer fehlenden nicht zu unterscheiden.
 */
export const dynamic = 'force-dynamic';

export default async function Mitarbeiter({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="mitarbeiter"
      suche={suche}
      nurJahr
      fussnote={
        <>
          <strong>Das Soll ist gerechnet, nicht gepflegt.</strong> Wochenstunden × Kalendertage
          ÷ 7 — Urlaub, Krankheit und Feiertage sind <em>nicht</em> abgezogen. „Mehrarbeit" ist
          deshalb die Differenz Ist − Soll über den Zeitraum und kein arbeitsrechtlicher
          Überstundenanspruch: was daraus folgt, entscheidet der Arbeitsvertrag. Gezählt werden
          ausschliesslich freigegebene Zeiteinträge.
        </>
      }
      kinder={async (kontext, lage) => {
        const zeilen = await mitarbeiterReihe(kontext, lage.jahresZeitraum);

        if (zeilen.length === 0) {
          return (
            <Hinweis art="hinweis" cse="mitarbeiter-leer">
              <strong>Für {lage.jahr} liegt keine freigegebene Zeit vor.</strong> Sobald
              Zeiteinträge freigegeben sind, stehen hier Stunden, Soll und Mehrarbeit je Mensch.
            </Hinweis>
          );
        }

        return (
          <DataTable<MitarbeiterZeile>
            beschriftung={`Stunden und Auslastung ${String(lage.jahr)}`}
            schluessel={(z) => z.personId}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'name', kopf: 'Name', zelle: (z) => z.name },
              { schluessel: 'pnr', kopf: 'Personalnr.', zelle: (z) => z.personalnummer ?? '—' },
              { schluessel: 'ist', kopf: 'Ist', numerisch: true,
                zelle: (z) => stunden(z.istMinuten) },
              { schluessel: 'soll', kopf: 'Soll', numerisch: true,
                zelle: (z) => (z.sollMinuten === null
                  ? <span className="text-text-subtle">kein Soll</span>
                  : stunden(z.sollMinuten)) },
              { schluessel: 'auslastung', kopf: 'Auslastung', numerisch: true,
                zelle: (z) => (z.auslastungBp === null
                  ? <span className="text-text-subtle">—</span>
                  : prozent(z.auslastungBp)) },
              { schluessel: 'mehrarbeit', kopf: 'Ist − Soll', numerisch: true,
                zelle: (z) => (z.mehrarbeitMinuten === null
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <span className={z.mehrarbeitMinuten > 0 ? 'text-warning' : 'text-text'}>
                      {stunden(z.mehrarbeitMinuten)}
                    </span>
                  )) },
            ]}
          />
        );
      }}
    />
  );
}
