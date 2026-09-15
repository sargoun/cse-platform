import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { pipelineJeBereich, type PipelineJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';
import { nurLesbar } from '../Zelle';

/** `/portal/gruppe/berichte/pipeline` — REP-06 je Gesellschaft. */
export const dynamic = 'force-dynamic';

export default async function Pipeline({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="pipeline"
      suche={searchParams}
      fussnote={<>„Eingereicht" fasst alles zusammen, was das Haus verlassen hat —
        eingereicht, bezuschlagt und nicht berücksichtigt. Die Trefferquote ist Zuschlag
        geteilt durch eingereicht; verworfene Vorgänge zählen dort nicht mit, weil sie
        nie eingereicht wurden.</>}
      kinder={async (kontext, jahr) => {
        const zeilen = await pipelineJeBereich(kontext, jahr);
        return (
          <DataTable<PipelineJeBereich>
            beschriftung={`Vergabepipeline je Gesellschaft ${jahr.bezeichnung}`}
            schluessel={(z) => z.mandantId}
            zeilen={zeilen}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (z) => <BereichMarke slug={z.slug} name={z.name} /> },
              { schluessel: 'gefunden', kopf: 'Gefunden', numerisch: true,
                zelle: (z) => nurLesbar(z, z.gefunden) },
              { schluessel: 'eingereicht', kopf: 'Eingereicht', numerisch: true,
                zelle: (z) => nurLesbar(z, z.eingereicht) },
              { schluessel: 'zuschlag', kopf: 'Zuschlag', numerisch: true,
                zelle: (z) => nurLesbar(z, z.zuschlag) },
              { schluessel: 'quote', kopf: 'Trefferquote', numerisch: true,
                zelle: (z) => nurLesbar(z, (z.eingereicht === 0
                  ? <span className="text-text-subtle">—</span>
                  : prozent(Math.round((z.zuschlag * 10000) / z.eingereicht)))) },
              { schluessel: 'wert', kopf: 'Zuschlagswert', numerisch: true,
                zelle: (z) => nurLesbar(z, formatiereGeld(z.zuschlagswertCent)) },
            ]}
          />
        );
      }}
    />
  );
}
