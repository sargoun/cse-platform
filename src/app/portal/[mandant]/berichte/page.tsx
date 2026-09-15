import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';
import { BERICHTE } from './rahmen';

/**
 * `/portal/[mandant]/berichte` — der Index (SPEC §5.23).
 *
 * **Eine Liste und keine Kacheln mit Zahlen.** Eine Übersicht, die schon
 * Zahlen zeigt, lädt sechs Berichte, um sechs Zeilen zu zeichnen — und wer
 * sie liest, hält die Kachelzahl für den Bericht und klickt nicht weiter.
 * Die Kennzahlen des Tages stehen auf dem Dashboard; hier steht, welche
 * Frage welcher Bericht beantwortet.
 */
export const dynamic = 'force-dynamic';

export default async function Berichte({ params }: {
  params: Promise<{ mandant: string }>;
}) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/berichte`, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  return (
    <PortalRahmen
      titel="Berichte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="berichte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Berichte</h1>
      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Sechs Auswertungen über diese Gesellschaft. Jede lässt sich nach Jahr und Körnung
        einstellen und als CSV ausgeben — der Ausgang verlangt ein eigenes Recht, weil eine
        Datei das Portal verlässt.
      </p>

      <ul data-cse="berichtsliste" className="grid gap-s4 sm:grid-cols-2">
        {BERICHTE.map((b) => (
          <li key={b.schluessel}>
            <Link href={alsRoute(`/portal/${mandant}/berichte/${b.schluessel}`)}
                  data-cse={`bericht-${b.schluessel}`}
                  className="block h-full rounded-lg focus-visible:outline focus-visible:outline-2">
              <Card interaktiv className="flex h-full flex-col gap-s2">
                <span className="text-xs font-semibold uppercase tracking-widest text-text-subtle">
                  {b.spec}
                </span>
                <h2 className="text-h3 text-text">{b.titel}</h2>
                <p className="text-sm text-text-muted">{b.beschreibung}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PortalRahmen>
  );
}
