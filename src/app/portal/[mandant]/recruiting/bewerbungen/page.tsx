import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { listeBewerbungen } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../rahmen';
import { BEWERBUNG_MARKE, berlinDatum } from '../marken';

/**
 * `/portal/[mandant]/recruiting/bewerbungen` — der Eingang (REC-03, REC-04).
 *
 * **Die Liste ist nach EINGANG sortiert und nicht nach Punktzahl.** Eine
 * Reihenfolge nach Bewertung ist eine Behauptung über Menschen, und sie hat
 * ihre eigene Seite (`kandidaten`), auf der die Kriterien danebenstehen
 * (REC-05, LEG-12). Der Eingang behauptet nichts.
 */
export const dynamic = 'force-dynamic';

const QUELLE: Readonly<Record<string, string>> = {
  karriereseite: 'Karriereseite', initiativ: 'Initiativ', mail: 'E-Mail', import: 'Import',
};

export default async function Bewerbungen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="bewerbungen"
      titel="Bewerbungen"
      kinder={async (zugang) => {
        const zeilen = await leseImMandanten(zugang, listeBewerbungen);
        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Bewerbungen</h1>
            {zeilen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Bewerbung. Was über <code className="break-all">/karriere</code>{' '}
                eingeht, steht hier — sofort und ohne Vorsortierung.
              </p>
            ) : (
              <DataTable
                beschriftung="Eingegangene Bewerbungen dieser Gesellschaft"
                zeilen={zeilen}
                schluessel={(b) => b.id}
                spalten={[
                  {
                    schluessel: 'name',
                    kopf: 'Name',
                    zelle: (b) => (
                      <Link
                        href={`/portal/${mandant}/recruiting/bewerbungen/${b.id}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {b.name}
                      </Link>
                    ),
                  },
                  { schluessel: 'stelle', kopf: 'Stelle', zelle: (b) => b.stelleTitel ?? 'Initiativ' },
                  { schluessel: 'quelle', kopf: 'Quelle', zelle: (b) => QUELLE[b.quelle] ?? b.quelle },
                  {
                    schluessel: 'eingang',
                    kopf: 'Eingegangen',
                    zelle: (b) => <span className="tabular-nums">{berlinDatum(b.eingegangenAm)}</span>,
                  },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (b) => <StatusPill zustand={BEWERBUNG_MARKE[b.status]} />,
                  },
                  {
                    schluessel: 'frist',
                    kopf: 'Löschung',
                    zelle: (b) => (
                      <span className="tabular-nums text-text-muted">{b.aufbewahrungBis}</span>
                    ),
                  },
                ]}
              />
            )}

            <Hinweis art="hinweis" cse="rec-keine-automatik" className="mt-s6 max-w-prose">
              <strong>Keine Absage geschieht automatisch.</strong> Art. 22 DSGVO
              verbietet eine Entscheidung allein aufgrund automatisierter
              Verarbeitung; dieser Bildschirm hat deshalb keinen Knopf, der
              eine Bewerbung ohne einen benannten Menschen ablehnt (REC-08,
              LEG-12). Die Datenbank lehnt es zusätzlich ab.
            </Hinweis>
          </>
        );
      }}
    />
  );
}
