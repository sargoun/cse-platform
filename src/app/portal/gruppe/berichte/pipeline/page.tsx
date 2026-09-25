import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { prozent } from '@/server/services/bericht/ausgabe';
import { pipelineJeBereich, type PipelineJeBereich }
  from '@/server/services/bericht/gruppe';
import { BereichMarke } from '../../tor';
import { GruppenBerichtsSeite } from '../rahmen';
import { nurLesbar } from '../Zelle';

/**
 * `/portal/gruppe/berichte/pipeline` — REP-06 je Gesellschaft, mit derselben
 * Zählung wie die Bereichsseite (`pipelineZahlen`, V-226, D-720).
 */
export const dynamic = 'force-dynamic';

export default async function Pipeline({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <GruppenBerichtsSeite
      bericht="pipeline"
      suche={searchParams}
      fussnote={<>Dieselbe Zählung wie auf der Seite jeder Gesellschaft: eine Stufe zählt,
        was sie erreicht hat, im Jahr des Eingangs. Gefunden ist, was das Radar bewertet
        und nicht ausgeschlossen hat oder wozu ein Vorgang eröffnet wurde; gesichtet ist
        ein Vorgang mit Stand; geboten ist, was eingereicht wurde, samt Zuschlag, Absage
        und aufgehobenem Verfahren. Die Trefferquote ist gewonnen geteilt durch geboten;
        verworfene Fälle zählen dort nicht mit, weil sie nie geboten wurden.</>}
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
              { schluessel: 'gesichtet', kopf: 'Gesichtet', numerisch: true,
                zelle: (z) => nurLesbar(z, z.gesichtet) },
              { schluessel: 'geboten', kopf: 'Geboten', numerisch: true,
                zelle: (z) => nurLesbar(z, z.geboten) },
              { schluessel: 'gewonnen', kopf: 'Gewonnen', numerisch: true,
                zelle: (z) => nurLesbar(z, z.gewonnen) },
              { schluessel: 'verworfen', kopf: 'Verworfen', numerisch: true,
                zelle: (z) => nurLesbar(z, z.verworfen) },
              { schluessel: 'quote', kopf: 'Trefferquote', numerisch: true,
                zelle: (z) => nurLesbar(z, (z.trefferquoteBp === null
                  ? <span className="text-text-subtle">—</span>
                  : prozent(z.trefferquoteBp))) },
              { schluessel: 'wert', kopf: 'Zuschlagswert', numerisch: true,
                zelle: (z) => nurLesbar(z, formatiereGeld(z.zuschlagswertCent)) },
            ]}
          />
        );
      }}
    />
  );
}
