import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { projekteJeBereich, type ProjekteJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';
import { nurLesbar } from '../Zelle';

/** `/portal/gruppe/berichte/projekte` — REP-05 je Gesellschaft. */
export const dynamic = 'force-dynamic';

export default async function Projekte({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="projekte"
      suche={searchParams}
      fussnote={<>„Verspätet" heisst: abgeschlossen nach dem Soll-Ende. Ein laufendes
        Projekt, dessen Soll-Ende vergangen ist, zählt hier noch nicht — es steht in der
        Bereichsansicht mit seinem Verzug.</>}
      kinder={async (kontext, jahr) => {
        const zeilen = await projekteJeBereich(kontext, jahr);
        return (
          <DataTable<ProjekteJeBereich>
            beschriftung={`Projekte je Gesellschaft ${jahr.bezeichnung}`}
            schluessel={(z) => z.mandantId}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
              { schluessel: 'laufend', kopf: 'Laufend', numerisch: true,
                zelle: (z) => nurLesbar(z, z.laufend) },
              { schluessel: 'fertig', kopf: 'Abgeschlossen', numerisch: true,
                zelle: (z) => nurLesbar(z, z.abgeschlossen) },
              { schluessel: 'spaet', kopf: 'Davon verspätet', numerisch: true,
                zelle: (z) => nurLesbar(z, (z.verspaetet === 0
                  ? <span className="text-text-subtle">0</span>
                  : <span className="text-warning">{z.verspaetet}</span>)) },
              { schluessel: 'summe', kopf: 'Auftragssumme', numerisch: true,
                zelle: (z) => nurLesbar(z, formatiereGeld(z.auftragssummeCent)) },
            ]}
          />
        );
      }}
    />
  );
}
