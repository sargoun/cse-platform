import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { cent, formatiereGeld, NULL_CENT } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { auftragsReihe, type AuftragsZeile } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/auftraege` — REP-02.
 *
 * **Die Quote misst eine Kohorte, keine Geschwindigkeit.** Ein Lead, der im
 * Januar entsteht und im März gewonnen wird, zählt in beiden Spalten des
 * Januars. Wer stattdessen „gewonnene im Zeitraum / offene im Zeitraum"
 * rechnet, misst, wie schnell aufgeräumt wird — und die Zahl steigt, wenn
 * niemand neue Anfragen bekommt.
 */
export const dynamic = 'force-dynamic';

export default async function Auftraege({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="auftraege"
      suche={suche}
      fussnote={
        <>
          <strong>Die Abschlussquote gehört zur Kohorte.</strong> Zähler und Nenner sind
          Anfragen, die im selben Abschnitt <em>entstanden</em> sind — ein Lead vom Januar
          zählt im Januar, auch wenn er im März gewonnen wurde. Anfragen aus dem laufenden
          Abschnitt sind deshalb noch nicht fertig bewertet.
        </>
      }
      kinder={async (kontext, lage) => {
        const zeilen = await auftragsReihe(kontext, lage.abschnitte);
        const summe = zeilen.reduce(
          (s, z) => ({
            leads: s.leads + z.leads,
            gewonnen: s.gewonnen + z.leadsGewonnen,
            auftraege: s.auftraege + z.auftraege,
            wert: cent(s.wert + z.auftragswertCent),
          }),
          { leads: 0, gewonnen: 0, auftraege: 0, wert: NULL_CENT },
        );
        const quote = summe.leads === 0
          ? 0 : Math.round((summe.gewonnen * 10000) / summe.leads);

        return (
          <>
            <div className="mb-s6 grid gap-s4 sm:grid-cols-2 lg:grid-cols-4">
              <div data-cse="kpi-leads">
                <KpiStat label="Anfragen" wert={String(summe.leads)} icon="crm" />
              </div>
              <div data-cse="kpi-gewonnen">
                <KpiStat label="Gewonnen" wert={String(summe.gewonnen)} icon="ok"
                         ton="success" />
              </div>
              <div data-cse="kpi-quote">
                <KpiStat label="Abschlussquote" wert={prozent(quote)} icon="uebersicht" />
              </div>
              <div data-cse="kpi-auftragswert">
                <KpiStat label="Auftragswert" wert={formatiereGeld(summe.wert)} icon="auftrag" />
              </div>
            </div>

            <DataTable<AuftragsZeile>
              beschriftung={`Aufträge und Anfragen ${String(lage.jahr)}`}
              schluessel={(z) => z.zeitraum.von}
              zeilen={zeilen}
              spalten={[
                { schluessel: 'zeitraum', kopf: 'Zeitraum', zelle: (z) => z.zeitraum.bezeichnung },
                { schluessel: 'leads', kopf: 'Anfragen', numerisch: true, zelle: (z) => z.leads },
                { schluessel: 'gewonnen', kopf: 'Gewonnen', numerisch: true,
                  zelle: (z) => z.leadsGewonnen },
                { schluessel: 'quote', kopf: 'Quote', numerisch: true,
                  zelle: (z) => prozent(z.quoteBp) },
                { schluessel: 'auftraege', kopf: 'Aufträge', numerisch: true,
                  zelle: (z) => z.auftraege },
                { schluessel: 'wert', kopf: 'Auftragswert netto', numerisch: true,
                  zelle: (z) => formatiereGeld(z.auftragswertCent) },
              ]}
            />
          </>
        );
      }}
    />
  );
}
