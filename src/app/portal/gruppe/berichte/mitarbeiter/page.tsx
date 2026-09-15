import { DataTable } from '@/components/ui/DataTable';
import { stunden } from '@/server/services/bericht/ausgabe';
import { stundenJeBereich, type StundenJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';

/**
 * `/portal/gruppe/berichte/mitarbeiter` — REP-04 je Gesellschaft.
 *
 * **Köpfe, nicht Namen.** Wer in zwei Gesellschaften beschäftigt ist, zählt
 * in beiden — die Stunden gehören der Gesellschaft, in der sie geleistet
 * wurden (D-09). Eine Namensliste über alle Bereiche stünde ausserdem quer zu
 * K-05: das Entgelt und die persönliche Auslastung gehören in den Bereich,
 * nicht in eine Gruppenübersicht.
 */
export const dynamic = 'force-dynamic';

export default async function Mitarbeiter({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="mitarbeiter"
      suche={searchParams}
      fussnote={<>Gezählt werden Köpfe je Gesellschaft, nicht Menschen: wer in zwei
        Gesellschaften arbeitet, erscheint in beiden. Die namentliche Auswertung steht im
        Bereich — sie gehört dorthin, wo das Arbeitsverhältnis besteht (D-09, K-05).</>}
      kinder={async (kontext, jahr) => {
        const zeilen = await stundenJeBereich(kontext, jahr);
        const gesamt = zeilen.reduce((s, z) => s + z.istMinuten, 0);
        return (
          <>
            <DataTable<StundenJeBereich>
              beschriftung={`Stunden je Gesellschaft ${jahr.bezeichnung}`}
              schluessel={(z) => z.mandantId}
              zeilen={zeilen}
              spalten={[
                { schluessel: 'bereich', kopf: 'Gesellschaft',
                  zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
                { schluessel: 'personen', kopf: 'Köpfe', numerisch: true,
                  zelle: (z) => z.personen },
                { schluessel: 'stunden', kopf: 'Freigegebene Stunden', numerisch: true,
                  zelle: (z) => stunden(z.istMinuten) },
              ]}
            />
            <p data-cse="gruppen-summe" className="mt-s4 text-sm text-text">
              Gesamt: <strong>{stunden(gesamt)}</strong>
            </p>
          </>
        );
      }}
    />
  );
}
