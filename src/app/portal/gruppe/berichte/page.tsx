import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import { GruppenAntwort, GruppenRahmen, gruppenTor } from '../tor';
import { GRUPPEN_BERICHTE } from './rahmen';

/** `/portal/gruppe/berichte` — der Index der Gruppenberichte (SPEC §6). */
export const dynamic = 'force-dynamic';

export default async function GruppenBerichte() {
  const tor = await gruppenTor('/portal/gruppe/berichte');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Berichte" aktiverTab="berichte">
      <h1 className="mb-s3 text-h1 text-text">Berichte</h1>
      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Dieselben sechs Auswertungen wie im Bereich, nur nebeneinander: je Gesellschaft eine
        Zeile und darunter die Summe. Lesend — eine Zahl entsteht dort, wo gearbeitet wird.
      </p>

      <ul data-cse="berichtsliste" className="grid gap-s4 sm:grid-cols-2">
        {GRUPPEN_BERICHTE.map((b) => (
          <li key={b.schluessel}>
            <Link href={alsRoute(`/portal/gruppe/berichte/${b.schluessel}`)}
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
    </GruppenRahmen>
  );
}
