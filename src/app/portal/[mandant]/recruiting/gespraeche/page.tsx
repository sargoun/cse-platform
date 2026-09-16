import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { listeGespraeche } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../rahmen';
import { GESPRAECH_MARKE, berlinZeit } from '../marken';

/**
 * `/portal/[mandant]/recruiting/gespraeche` — die Termine (REC-06, CAL-01).
 *
 * **Jede Zeit steht in Berliner Ortszeit, und die Zone steht dabei.** Ein
 * Termin im Oktober zwischen 02:00 und 03:00 gibt es zweimal (Invariante 2);
 * wer zum falschen erscheint, hat kein Anzeigeproblem.
 */
export const dynamic = 'force-dynamic';

export default async function Gespraeche(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="gespraeche"
      titel="Gespräche"
      kinder={async (zugang) => {
        const zeilen = await leseImMandanten(zugang, listeGespraeche);
        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Gespräche</h1>
            {zeilen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Kein Gespräch geplant. Ein Termin entsteht aus einer Bewerbung —
                auf ihrem Blatt steht der Knopf.
              </p>
            ) : (
              <DataTable
                beschriftung="Geplante und geführte Gespräche"
                zeilen={zeilen}
                schluessel={(g) => g.id}
                spalten={[
                  {
                    schluessel: 'termin',
                    kopf: 'Termin (Europe/Berlin)',
                    zelle: (g) => (
                      <Link
                        href={`/portal/${mandant}/recruiting/gespraeche/${g.id}`}
                        className="tabular-nums text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {berlinZeit(g.termin)}
                      </Link>
                    ),
                  },
                  { schluessel: 'wer', kopf: 'Bewerber', zelle: (g) => g.bewerberName },
                  { schluessel: 'stelle', kopf: 'Stelle', zelle: (g) => g.stelleTitel ?? 'Initiativ' },
                  {
                    schluessel: 'dauer',
                    kopf: 'Dauer',
                    numerisch: true,
                    zelle: (g) => `${String(g.dauerMinuten)} min`,
                  },
                  { schluessel: 'ort', kopf: 'Ort', zelle: (g) => g.ort ?? '—' },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (g) => <StatusPill zustand={GESPRAECH_MARKE[g.status] ?? 'Geplant'} />,
                  },
                ]}
              />
            )}
          </>
        );
      }}
    />
  );
}
