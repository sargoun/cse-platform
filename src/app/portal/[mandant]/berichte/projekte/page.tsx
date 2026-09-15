import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { projektReihe, type ProjektZeile } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/projekte` — REP-05.
 *
 * Status, Marge, Termintreue. **Die Marge ist eine Näherung und sagt es** —
 * Auftragssumme minus Lohn (Zeiteinträge zum internen Stundensatz) minus
 * Fremdleistung (zugeordnete Eingangsrechnungen). Material ohne
 * Rechnungsbezug, Gemeinkosten und Gerätestunden fehlen (O-502).
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, string>> = {
  geplant: 'Geplant', in_arbeit: 'In Arbeit', abgenommen: 'Abgenommen',
  abgeschlossen: 'Abgeschlossen', archiviert: 'Archiviert',
};

function verzugsText(tage: number | null): React.ReactNode {
  if (tage === null) return <span className="text-text-subtle">offen</span>;
  if (tage > 0) return <span className="text-danger">{tage} Tage zu spät</span>;
  if (tage < 0) return <span className="text-success">{Math.abs(tage)} Tage früher</span>;
  return <span className="text-success">pünktlich</span>;
}

export default async function Projekte({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="projekte"
      suche={suche}
      nurJahr
      fussnote={
        <>
          <strong>Die Marge ist eine Näherung.</strong> Sie ist Auftragssumme minus Lohn
          (freigegebene Zeiteinträge zum internen Stundensatz) minus Fremdleistung
          (Eingangsrechnungen mit Projektbezug). Material ohne Rechnungsbezug, Gemeinkosten
          und Gerätestunden sind <em>nicht</em> enthalten — welche Kostenarten hineingehören,
          ist offen (O-502). Eine Nachkalkulation ist das nicht, und in ein Angebot gehört
          diese Zahl nicht ungeprüft.
        </>
      }
      kinder={async (kontext, lage) => {
        const zeilen = await projektReihe(kontext, lage.jahresZeitraum);

        if (zeilen.length === 0) {
          return (
            <Hinweis art="hinweis" cse="projekte-leer">
              <strong>Für {lage.jahr} läuft kein Projekt.</strong> Gezeigt werden Projekte,
              deren Laufzeit den Zeitraum berührt.
            </Hinweis>
          );
        }

        return (
          <DataTable<ProjektZeile>
            beschriftung={`Projekte ${String(lage.jahr)}`}
            schluessel={(z) => z.id}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.nummer },
              { schluessel: 'bezeichnung', kopf: 'Projekt', zelle: (z) => z.bezeichnung },
              { schluessel: 'status', kopf: 'Status',
                zelle: (z) => STATUS[z.status] ?? z.status },
              { schluessel: 'summe', kopf: 'Auftragssumme', numerisch: true,
                zelle: (z) => formatiereGeld(z.auftragssummeCent) },
              { schluessel: 'berechnet', kopf: 'Berechnet', numerisch: true,
                zelle: (z) => formatiereGeld(z.berechnetCent) },
              { schluessel: 'kosten', kopf: 'Kosten (Näherung)', numerisch: true,
                zelle: (z) => formatiereGeld(z.kostenCent) },
              { schluessel: 'marge', kopf: 'Marge', numerisch: true,
                zelle: (z) => (z.margeBp === null
                  ? <span className="text-text-subtle">—</span>
                  : (
                    <span className={z.margeBp < 0 ? 'text-danger' : 'text-text'}>
                      {prozent(z.margeBp)}
                    </span>
                  )) },
              { schluessel: 'termin', kopf: 'Termintreue',
                zelle: (z) => verzugsText(z.verzugTage) },
            ]}
          />
        );
      }}
    />
  );
}
