import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { auftraegeJeBereich, type AuftraegeJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';
import { nurLesbar } from '../Zelle';

/** `/portal/gruppe/berichte/auftraege` — REP-02 je Gesellschaft. */
export const dynamic = 'force-dynamic';

export default async function Auftraege({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="auftraege"
      suche={searchParams}
      fussnote={<>Die Quote gehört zur Kohorte: Zähler und Nenner sind Anfragen, die im
        gewählten Jahr entstanden sind.</>}
      kinder={async (kontext, jahr) => {
        const zeilen = await auftraegeJeBereich(kontext, jahr);
        return (
          <DataTable<AuftraegeJeBereich>
            beschriftung={`Aufträge je Gesellschaft ${jahr.bezeichnung}`}
            schluessel={(z) => z.mandantId}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
              { schluessel: 'leads', kopf: 'Anfragen', numerisch: true, zelle: (z) => nurLesbar(z, z.leads) },
              { schluessel: 'gewonnen', kopf: 'Gewonnen', numerisch: true,
                zelle: (z) => nurLesbar(z, z.gewonnen) },
              { schluessel: 'quote', kopf: 'Quote', numerisch: true,
                zelle: (z) => nurLesbar(z, prozent(z.quoteBp)) },
              { schluessel: 'auftraege', kopf: 'Aufträge', numerisch: true,
                zelle: (z) => nurLesbar(z, z.auftraege) },
              { schluessel: 'wert', kopf: 'Auftragswert netto', numerisch: true,
                zelle: (z) => nurLesbar(z, formatiereGeld(z.auftragswertCent)) },
            ]}
          />
        );
      }}
    />
  );
}
