import { DataTable } from '@/components/ui/DataTable';
import { cent, formatiereGeld, NULL_CENT } from '@/server/services/finanz/geld';
import { umsatzJeBereich, type UmsatzJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';

/** `/portal/gruppe/berichte/umsatz` — REP-01 über alle Gesellschaften. */
export const dynamic = 'force-dynamic';

export default async function Umsatz({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="umsatz"
      suche={searchParams}
      fussnote={<>Erlöse aus festgeschriebenen Rechnungen, Aufwand aus freigegebenen
        Eingangsrechnungen — keine betriebswirtschaftliche Auswertung und kein
        Jahresabschluss.</>}
      kinder={async (kontext, jahr) => {
        const zeilen = await umsatzJeBereich(kontext, jahr);
        const summe = zeilen.reduce(
          (s, z) => ({
            erloese: cent(s.erloese + z.erloeseCent),
            aufwand: cent(s.aufwand + z.aufwandCent),
          }),
          { erloese: NULL_CENT, aufwand: NULL_CENT },
        );
        return (
          <>
            <DataTable<UmsatzJeBereich>
              beschriftung={`Umsatz je Gesellschaft ${jahr.bezeichnung}`}
              schluessel={(z) => z.mandantId}
              zeilen={zeilen}
              spalten={[
                { schluessel: 'bereich', kopf: 'Gesellschaft',
                  zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
                { schluessel: 'erloese', kopf: 'Erlöse', numerisch: true,
                  zelle: (z) => formatiereGeld(z.erloeseCent) },
                { schluessel: 'rechnungen', kopf: 'Rechnungen', numerisch: true,
                  zelle: (z) => z.rechnungen },
                { schluessel: 'aufwand', kopf: 'Aufwand', numerisch: true,
                  zelle: (z) => formatiereGeld(z.aufwandCent) },
                { schluessel: 'ergebnis', kopf: 'Ergebnis', numerisch: true,
                  zelle: (z) => (
                    <span className={z.ergebnisCent < 0n ? 'text-danger' : 'text-text'}>
                      {formatiereGeld(z.ergebnisCent)}
                    </span>
                  ) },
              ]}
            />
            <p data-cse="gruppen-summe"
               className="mt-s4 flex flex-wrap gap-s5 text-sm text-text">
              <span>Erlöse gesamt: <strong>{formatiereGeld(summe.erloese)}</strong></span>
              <span>Aufwand gesamt: <strong>{formatiereGeld(summe.aufwand)}</strong></span>
              <span>Ergebnis gesamt:{' '}
                <strong>{formatiereGeld(cent(summe.erloese - summe.aufwand))}</strong>
              </span>
            </p>
          </>
        );
      }}
    />
  );
}
