import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { rangliste } from '@/server/services/recruiting/dienst';
import { punkteText } from '@/server/services/recruiting/rangfolge';
import { RecruitingSeite, leseImMandanten } from '../rahmen';
import { BEWERBUNG_MARKE } from '../marken';

/**
 * `/portal/[mandant]/recruiting/kandidaten` — die Rangfolge (REC-05, REC-08,
 * LEG-12).
 *
 * **Das ist die einzige Seite des Moduls, die eine Reihenfolge behauptet — und
 * sie sagt es.** Die Punktzahl entsteht aus Kriterien, die jemand
 * aufgeschrieben hat; sie ist ein Vorschlag und keine Auswahl. Wer sie im
 * AGG-Streit erklären muss, findet die Kriterien eine Ebene tiefer, mit
 * Gewicht, Punkten und Begründung.
 *
 * **Gleiche Punktzahl heisst gleicher Rang** (1, 2, 2, 4). Zwei Bewerbungen
 * künstlich zu trennen hiesse, eine Ordnung zu erfinden, die die Kriterien
 * nicht hergeben.
 */
export const dynamic = 'force-dynamic';

export default async function Kandidaten(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="kandidaten"
      titel="Kandidaten"
      kinder={async (zugang) => {
        const zeilen = await leseImMandanten(zugang, (k) => rangliste(k));
        return (
          <>
            <h1 className="mb-s5 text-h1 text-text">Kandidaten</h1>

            <Hinweis art="warnung" cse="rec-vorschlag" className="mb-s5 max-w-prose">
              <strong>Diese Reihenfolge ist ein Vorschlag, keine Auswahl.</strong>{' '}
              Sie entsteht aus den Kriterien, die unter jeder Zeile stehen —
              nicht aus einem Modell und nicht aus einer Eigenschaft der
              Person. Eine Entscheidung trifft ein benannter Mensch mit
              Begründung (REC-08, Art. 22 DSGVO).
            </Hinweis>

            {zeilen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Bewerbung zu bewerten.
              </p>
            ) : (
              <DataTable
                beschriftung="Bewerbungen nach Punktzahl, mit Rang"
                zeilen={zeilen}
                schluessel={(z) => z.eintrag.id}
                spalten={[
                  {
                    schluessel: 'rang',
                    kopf: 'Rang',
                    numerisch: true,
                    zelle: (z) => String(z.rang),
                  },
                  {
                    schluessel: 'name',
                    kopf: 'Name',
                    zelle: (z) => (
                      <Link
                        href={`/portal/${mandant}/recruiting/kandidaten/${z.eintrag.id}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {z.eintrag.name}
                      </Link>
                    ),
                  },
                  {
                    schluessel: 'stelle',
                    kopf: 'Stelle',
                    zelle: (z) => z.eintrag.stelleTitel ?? 'Initiativ',
                  },
                  {
                    schluessel: 'punkte',
                    kopf: 'Punkte',
                    numerisch: true,
                    zelle: (z) => (z.kriterien.length === 0
                      ? <span className="text-text-muted">nicht bewertet</span>
                      : punkteText(z.punktzahlZehntel)),
                  },
                  {
                    schluessel: 'kriterien',
                    kopf: 'Kriterien',
                    numerisch: true,
                    zelle: (z) => String(z.kriterien.length),
                  },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (z) => <StatusPill zustand={BEWERBUNG_MARKE[z.eintrag.status]} />,
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
