import { DataTable } from '@/components/ui/DataTable';
import { prozent } from '@/server/services/bericht/ausgabe';
import { attributionJeBereich, type AttributionJeBereich }
  from '@/server/services/bericht/gruppe';
import { LeereListe, BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';
import { nurLesbar } from '../Zelle';

/**
 * `/portal/gruppe/berichte/attribution` — REP-03 je Gesellschaft UND Kanal.
 *
 * Ein Kanal, der in einer Gesellschaft funktioniert und in einer anderen
 * nicht, ist genau der Befund, wegen dessen diese Seite in der Gruppenansicht
 * steht.
 */
export const dynamic = 'force-dynamic';

export default async function Attribution({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="attribution"
      suche={searchParams}
      kinder={async (kontext, jahr) => {
        const zeilen = await attributionJeBereich(kontext, jahr);
        if (zeilen.length === 0) {
          return <LeereListe text={`Für ${jahr.bezeichnung} ist keine Anfrage erfasst.`} />;
        }
        return (
          <DataTable<AttributionJeBereich>
            beschriftung={`Herkunft je Gesellschaft ${jahr.bezeichnung}`}
            schluessel={(z) => `${z.mandantId}|${z.kanal}`}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
              { schluessel: 'kanal', kopf: 'Kanal', zelle: (z) => z.kanal },
              { schluessel: 'leads', kopf: 'Anfragen', numerisch: true, zelle: (z) => nurLesbar(z, z.leads) },
              { schluessel: 'auftraege', kopf: 'Aufträge', numerisch: true,
                zelle: (z) => nurLesbar(z, z.auftraege) },
              { schluessel: 'quote', kopf: 'Quote', numerisch: true,
                zelle: (z) => nurLesbar(z, prozent(z.leads === 0
                  ? 0 : Math.round((z.auftraege * 10000) / z.leads))) },
            ]}
          />
        );
      }}
    />
  );
}
