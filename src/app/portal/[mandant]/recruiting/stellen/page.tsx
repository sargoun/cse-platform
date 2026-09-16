import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { listeStellen, type StelleStatus } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../rahmen';

/**
 * `/portal/[mandant]/recruiting/stellen` — die Ausschreibungen (REC-02).
 *
 * **Die Spalte „Entwurf von" ist keine Schmückerei.** Eine Stellenanzeige darf
 * ein Agent vorschlagen; freigeben muss ein Mensch (Invariante 7). Wer die
 * Liste liest, soll sehen, was noch ein Vorschlag ist — ohne die Zeile zu
 * öffnen.
 */
export const dynamic = 'force-dynamic';

/**
 * Die vier Zustände einer Stelle auf die MARKEN aus DESIGN §5 abgebildet.
 *
 * Der Satz ist geschlossen, und das ist der Punkt: „Veröffentlicht" als
 * fünfzehnte Marke zu erfinden hiesse, eine Farbe zu erfinden. `Aktiv` sagt
 * dasselbe in der Sprache, die das Portal überall spricht — eine
 * veröffentlichte Stelle ist die, die gerade läuft.
 */
const STATUS: Readonly<Record<StelleStatus, PillZustand>> = {
  entwurf: 'Entwurf',
  freigegeben: 'Bereit',
  veroeffentlicht: 'Aktiv',
  geschlossen: 'Abgeschlossen',
};

export default async function Stellen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="stellen"
      titel="Stellen"
      kinder={async (zugang) => {
        const stellen = await leseImMandanten(zugang, listeStellen);
        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">Stellen</h1>
              <Link
                href={`/portal/${mandant}/recruiting/stellen/neu`}
                data-cse="stelle-neu"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
              >
                Neue Stelle
              </Link>
            </div>

            {stellen.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Keine Stelle erfasst. Eine veröffentlichte Stelle erscheint
                sofort auf <code className="break-all">/karriere</code> —
                das ist der einzige Kanal, der ohne fremden Vertrag geht
                (REC-09, O-374).
              </p>
            ) : (
              <DataTable
                beschriftung="Ausgeschriebene Stellen dieser Gesellschaft"
                zeilen={stellen}
                schluessel={(s) => s.id}
                spalten={[
                  {
                    schluessel: 'titel',
                    kopf: 'Titel',
                    zelle: (s) => (
                      <Link
                        href={`/portal/${mandant}/recruiting/stellen/${s.id}`}
                        className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                      >
                        {s.titel}
                      </Link>
                    ),
                  },
                  { schluessel: 'ort', kopf: 'Einsatzort', zelle: (s) => s.einsatzort ?? '—' },
                  {
                    schluessel: 'status',
                    kopf: 'Status',
                    zelle: (s) => <StatusPill zustand={STATUS[s.status]} />,
                  },
                  {
                    schluessel: 'entwurf',
                    kopf: 'Entwurf von',
                    zelle: (s) => (s.entwurfVonArt === 'agent'
                      ? <span className="text-warning">Agent — ungeprüft</span>
                      : 'Mensch'),
                  },
                  {
                    schluessel: 'frist',
                    kopf: 'Bewerbungsfrist',
                    zelle: (s) => (
                      <span className="tabular-nums">{s.bewerbungsfrist ?? 'offen'}</span>
                    ),
                  },
                  {
                    schluessel: 'bewerbungen',
                    kopf: 'Bewerbungen',
                    numerisch: true,
                    zelle: (s) => String(s.bewerbungen),
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
