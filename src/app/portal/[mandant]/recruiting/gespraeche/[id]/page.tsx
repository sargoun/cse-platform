import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { ladeGespraech } from '@/server/services/recruiting/dienst';
import { kennungOder404 } from '../../../../kennung';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { KNOPF } from '../../felder';
import { GESPRAECH_MARKE, berlinZeit } from '../../marken';

/**
 * `/portal/[mandant]/recruiting/gespraeche/[id]` — ein Termin (REC-06, CAL-01).
 *
 * **Die vorbereiteten Fragen stehen hier, weil sie für ALLE dieselben sein
 * sollen.** Ein strukturiertes Gespräch ist nicht Bürokratie: wer jedem
 * dieselben Fragen stellt, kann hinterher erklären, warum er sich anders
 * entschieden hat — und genau das verlangt § 22 AGG im Streitfall.
 */
export const dynamic = 'force-dynamic';

export default async function Gespraechsblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`gespraeche/${id}`}
      titel="Gespräch"
      kinder={async (zugang) => {
        const g = await leseImMandanten(zugang, (k) => ladeGespraech(k, id));
        if (g === null) notFound();

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{g.bewerberName}</h1>
              <StatusPill zustand={GESPRAECH_MARKE[g.status] ?? 'Geplant'} />
            </div>

            <nav className="mb-s5 flex flex-wrap gap-s2">
              <Link href={`/portal/${mandant}/recruiting/gespraeche`} className={KNOPF}>
                Alle Gespräche
              </Link>
              <Link
                href={`/portal/${mandant}/recruiting/bewerbungen/${g.bewerbungId}`}
                className={KNOPF}
              >
                Zur Bewerbung
              </Link>
            </nav>

            <dl className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
              <dt className="text-text-muted">Termin</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {berlinZeit(g.termin)} <span className="text-text-muted">(Europe/Berlin)</span>
              </dd>
              <dt className="text-text-muted">Dauer</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {String(g.dauerMinuten)} Minuten
              </dd>
              <dt className="text-text-muted">Ort</dt>
              <dd className="m-0 min-w-0 break-words text-text">{g.ort ?? '—'}</dd>
              <dt className="text-text-muted">Stelle</dt>
              <dd className="m-0 min-w-0 break-words text-text">
                {g.stelleTitel ?? 'Initiativbewerbung'}
              </dd>
            </dl>

            <h2 className="mb-s3 text-h3 text-text">Vorbereitete Fragen</h2>
            {g.fragen.length === 0 ? (
              <Hinweis art="warnung" cse="gespraech-ohne-fragen" className="mb-s6 max-w-prose">
                <strong>Keine Fragen hinterlegt.</strong> Ein Gespräch ohne
                festgelegte Fragen lässt sich hinterher nicht mit einem anderen
                vergleichen — und im AGG-Streit ist genau dieser Vergleich das,
                was die Gesellschaft vorlegen muss.
              </Hinweis>
            ) : (
              <ol className="mb-s6 m-0 max-w-prose list-decimal pl-s5 text-sm text-text">
                {g.fragen.map((f) => <li key={f} className="mb-s2">{f}</li>)}
              </ol>
            )}

            <h2 className="mb-s3 text-h3 text-text">Notiz</h2>
            <p className="max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
              {g.notiz ?? 'Keine Notiz erfasst.'}
            </p>
          </>
        );
      }}
    />
  );
}
