import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { bedarf } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../rahmen';
import { KNOPF } from '../felder';

/**
 * `/portal/[mandant]/recruiting/bedarf` — woher der Bedarf kommt (REC-01,
 * TIM-05).
 *
 * **Diese Seite rechnet keine Stelle aus, und das ist eine Entscheidung.** Aus
 * „14 unbesetzte Schichten in vier Wochen" folgt keine Zahl an
 * Einzustellenden: dafür bräuchte es Vertragsmodelle, Ausfallquoten und die
 * ArbZG-Grenzen je Person — drei Dinge, von denen keines in dieser Tabelle
 * steht. Sie zeigt, wo es klemmt; die Stelle schreibt ein Mensch.
 *
 * **Gezählt werden Zusagen, nicht Einteilungen.** Eine Schicht, für die drei
 * Leute eingeteilt sind und niemand zugesagt hat, ist leer.
 */
export const dynamic = 'force-dynamic';

const HORIZONTE = [2, 4, 8, 12] as const;

export default async function Bedarf(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const roh = (await searchParams)['wochen'];
  const gewaehlt = HORIZONTE.find((h) => String(h) === roh) ?? 4;

  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="bedarf"
      titel="Bedarf"
      kinder={async (zugang) => {
        const zeilen = await leseImMandanten(zugang, (k) => bedarf(k, gewaehlt));
        const gesamt = zeilen.reduce((s, z) => s + z.fehlendeZusagen, 0);

        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Bedarf</h1>

            <nav aria-label="Horizont" className="mb-s5 flex flex-wrap gap-s2">
              {HORIZONTE.map((h) => (
                <Link
                  key={h}
                  href={`/portal/${mandant}/recruiting/bedarf?wochen=${String(h)}`}
                  data-cse="bedarf-horizont"
                  aria-current={h === gewaehlt ? 'page' : undefined}
                  className={`${KNOPF} ${h === gewaehlt ? 'border-line-strong bg-surface-2' : ''}`}
                >
                  {String(h)} Wochen
                </Link>
              ))}
            </nav>

            {zeilen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                In den nächsten {String(gewaehlt)} Wochen ist jede Schicht
                mindestens knapp besetzt. Das heisst nicht, dass niemand
                gebraucht wird — es heisst, dass der Dienstplan es nicht sagt.
              </p>
            ) : (
              <>
                <p className="mb-s3 text-sm text-text">
                  <strong className="tabular-nums">{String(gesamt)}</strong>{' '}
                  fehlende Zusagen in {String(gewaehlt)} Wochen, verteilt auf{' '}
                  {String(zeilen.length)} Objekte.
                </p>
                <DataTable
                  beschriftung="Unbesetzte Schichten je Objekt im gewählten Zeitraum"
                  zeilen={zeilen}
                  schluessel={(z) => z.objektId ?? 'ohne-objekt'}
                  spalten={[
                    {
                      schluessel: 'objekt',
                      kopf: 'Objekt',
                      zelle: (z) => (z.objektId === null ? 'ohne Objekt' : (
                        <Link
                          href={`/portal/${mandant}/objekte/${z.objektId}`}
                          className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                        >
                          {z.objektName ?? z.objektId}
                        </Link>
                      )),
                    },
                    {
                      schluessel: 'schichten',
                      kopf: 'Schichten',
                      numerisch: true,
                      zelle: (z) => String(z.schichten),
                    },
                    {
                      schluessel: 'fehlt',
                      kopf: 'Fehlende Zusagen',
                      numerisch: true,
                      zelle: (z) => (
                        <span className="text-warning">{String(z.fehlendeZusagen)}</span>
                      ),
                    },
                    {
                      schluessel: 'von',
                      kopf: 'Erste',
                      zelle: (z) => <span className="tabular-nums">{z.ersteSchicht}</span>,
                    },
                    {
                      schluessel: 'bis',
                      kopf: 'Letzte',
                      zelle: (z) => <span className="tabular-nums">{z.letzteSchicht}</span>,
                    },
                  ]}
                />
              </>
            )}

            <Hinweis art="hinweis" cse="bedarf-keine-zahl" className="mt-s6 max-w-prose">
              <strong>Hieraus folgt keine Zahl an Einzustellenden.</strong> Wie
              viele Menschen eine Lücke schliessen, hängt an Vertragsmodellen,
              Ausfallquoten und den ArbZG-Grenzen je Person — nichts davon
              steht in dieser Tabelle, und eine Zahl daraus zu rechnen hiesse,
              eine Geschäftsregel zu erfinden.
            </Hinweis>
          </>
        );
      }}
    />
  );
}
