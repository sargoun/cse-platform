import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { cent, formatiereGeld, NULL_CENT } from '@/server/services/finanz/geld';
import { umsatzReihe, type UmsatzZeile } from '@/server/services/bericht/kennzahlen';
import { BerichtsSeite } from '../rahmen';

/**
 * `/portal/[mandant]/berichte/umsatz` — REP-01.
 *
 * Erlöse aus festgeschriebenen Rechnungen, Aufwand aus freigegebenen
 * Eingangsrechnungen, Ergebnis als Differenz. **Kein Jahresabschluss und
 * kein Abschluss**: Abgrenzungen, Abschreibungen und Rückstellungen fehlen, und
 * das steht unter der Tabelle statt in einer Fussnote, die niemand liest.
 */
export const dynamic = 'force-dynamic';

export default async function Umsatz({ params, searchParams }: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const suche = await searchParams;

  return (
    <BerichtsSeite
      mandant={mandant}
      bericht="umsatz"
      suche={suche}
      fussnote={
        <>
          <strong>Das ist keine betriebswirtschaftliche Auswertung und kein
          Jahresabschluss.</strong> Gezählt werden
          festgeschriebene Ausgangsrechnungen und freigegebene Eingangsrechnungen nach
          ihrem Rechnungsdatum. Periodenabgrenzung, Abschreibungen, Rückstellungen und
          Bestandsveränderungen sind nicht enthalten — dafür ist der
          Steuerberater zuständig, und die Plattform exportiert ihm die Belege.
        </>
      }
      kinder={async (kontext, lage) => {
        const zeilen = await umsatzReihe(kontext, lage.abschnitte);
        const summe = zeilen.reduce(
          (s, z) => ({
            erloese: cent(s.erloese + z.erloeseCent),
            aufwand: cent(s.aufwand + z.aufwandCent),
            rechnungen: s.rechnungen + z.rechnungen,
          }),
          { erloese: NULL_CENT, aufwand: NULL_CENT, rechnungen: 0 },
        );
        const ergebnis = cent(summe.erloese - summe.aufwand);

        return (
          <>
            <div className="mb-s6 grid gap-s4 sm:grid-cols-3">
              <div data-cse="kpi-erloese">
                <KpiStat label="Erlöse" wert={formatiereGeld(summe.erloese)} icon="euro" />
              </div>
              <div data-cse="kpi-aufwand">
                <KpiStat label="Aufwand" wert={formatiereGeld(summe.aufwand)} icon="rechnung" />
              </div>
              <div data-cse="kpi-ergebnis">
                <KpiStat label="Ergebnis" wert={formatiereGeld(ergebnis)} icon="uebersicht"
                         ton={ergebnis < 0n ? 'danger' : 'success'} />
              </div>
            </div>

            <DataTable<UmsatzZeile>
              beschriftung={`Umsatz ${String(lage.jahr)}`}
              schluessel={(z) => z.zeitraum.von}
              zeilen={zeilen}
              spalten={[
                { schluessel: 'zeitraum', kopf: 'Zeitraum',
                  zelle: (z) => z.zeitraum.bezeichnung },
                { schluessel: 'erloese', kopf: 'Erlöse', numerisch: true,
                  zelle: (z) => formatiereGeld(z.erloeseCent) },
                { schluessel: 'rechnungen', kopf: 'Rechnungen', numerisch: true,
                  zelle: (z) => z.rechnungen },
                { schluessel: 'aufwand', kopf: 'Aufwand', numerisch: true,
                  zelle: (z) => formatiereGeld(z.aufwandCent) },
                { schluessel: 'eingang', kopf: 'Eingangsrechnungen', numerisch: true,
                  zelle: (z) => z.eingangsrechnungen },
                { schluessel: 'ergebnis', kopf: 'Ergebnis', numerisch: true,
                  zelle: (z) => (
                    <span className={z.ergebnisCent < 0n ? 'text-danger' : 'text-text'}>
                      {formatiereGeld(z.ergebnisCent)}
                    </span>
                  ) },
              ]}
            />
          </>
        );
      }}
    />
  );
}
