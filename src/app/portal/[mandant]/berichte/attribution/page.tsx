import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { attribution, type AttributionsZeile } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/attribution` — REP-03, „channel to signed order".
 *
 * **Die Kette ist Formulareingang → Lead → Auftrag.** Der Kanal steht am
 * Eingang (UTM, Verweisadresse), nicht am Lead: ein Lead, den jemand am
 * Telefon aufnimmt, hat keinen Kanal, und „Manuell erfasst" ist die richtige
 * Antwort darauf — nicht ein erfundener.
 *
 * **Gezählt wird der unterschriebene Auftrag.** Ein Angebot, das nie
 * angenommen wurde, hat keinen Kanal verdient; sonst sieht jeder Kanal gut
 * aus, der viele Anfragen bringt.
 */
export const dynamic = 'force-dynamic';

export default async function Attribution({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="attribution"
      suche={suche}
      nurJahr
      fussnote={
        <>
          <strong>Ohne UTM-Parameter kein Kanal.</strong> Die Herkunft steht im
          Formulareingang; wer die Website ohne Kampagnenparameter erreicht, erscheint als
          „Website (ohne UTM)". Anfragen, die am Telefon oder per Mail eingehen und von Hand
          erfasst werden, tragen „Manuell erfasst" — das ist eine Antwort und keine Lücke.
        </>
      }
      kinder={async (kontext, lage) => {
        const zeilen = await attribution(kontext, lage.jahresZeitraum);

        if (zeilen.length === 0) {
          return (
            <Hinweis art="hinweis" cse="attribution-leer">
              <strong>Für {lage.jahr} ist keine Anfrage erfasst.</strong> Sobald das erste
              Formular eingeht, steht hier, über welchen Weg es kam.
            </Hinweis>
          );
        }

        return (
          <DataTable<AttributionsZeile>
            beschriftung={`Herkunft der Anfragen ${String(lage.jahr)}`}
            schluessel={(z) => `${z.kanal}|${z.medium ?? ''}|${z.kampagne ?? ''}`}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'kanal', kopf: 'Kanal', zelle: (z) => z.kanal },
              { schluessel: 'medium', kopf: 'Medium', zelle: (z) => z.medium ?? '—' },
              { schluessel: 'kampagne', kopf: 'Kampagne', zelle: (z) => z.kampagne ?? '—' },
              { schluessel: 'leads', kopf: 'Anfragen', numerisch: true, zelle: (z) => z.leads },
              { schluessel: 'auftraege', kopf: 'Aufträge', numerisch: true,
                zelle: (z) => z.auftraege },
              { schluessel: 'quote', kopf: 'Quote', numerisch: true,
                zelle: (z) => prozent(z.quoteBp) },
              { schluessel: 'wert', kopf: 'Auftragswert netto', numerisch: true,
                zelle: (z) => formatiereGeld(z.auftragswertCent) },
            ]}
          />
        );
      }}
    />
  );
}
