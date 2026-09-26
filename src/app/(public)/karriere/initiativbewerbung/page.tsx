import Link from 'next/link';
import type { Metadata } from 'next';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { aufbewahrungTage } from '@/server/services/recruiting/dienst';
import { bereiche } from '../daten';
import { Bewerbungsformular } from '../Formular';
import { bewerbungsMeldung } from '../meldung';

/**
 * `/karriere/initiativbewerbung` — ohne Stelle (REC-03, REC-07).
 *
 * **Der Bereich ist hier eine Wahl und kein Parameter.** Eine
 * Initiativbewerbung gehört zu einer Gesellschaft, weil der Arbeitsvertrag mit
 * ihr zustande käme (D-09) — und weil `mandant_id` an der Zeile hängt, ohne
 * das keine Policy greift (K-03).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Initiativbewerbung — CSE Gruppe' };

export default async function InitiativSeite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const [tage, liste] = await Promise.all([
    oeffentlichLesen((kontext) => aufbewahrungTage(kontext)),
    bereiche(),
  ]);
  // V-158: eine Abweisung kommt als Grund zurück, nicht als JSON.
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s6 px-s5 py-s7">
      <nav aria-label="Zurück">
        <Link href="/karriere" className="text-sm text-text-muted underline underline-offset-2">
          ‹ Alle offenen Stellen
        </Link>
      </nav>
      <header className="flex flex-col gap-s2">
        <h1 className="m-0 text-h1 text-text">Initiativbewerbung</h1>
        <p className="m-0 max-w-prose text-base text-text-muted">
          Sagen Sie uns, was Sie können und wo Sie arbeiten möchten. Wir melden
          uns, wenn eine Stelle dazu passt.
        </p>
      </header>
      <Bewerbungsformular stelleId={null} aufbewahrungTage={tage} bereiche={liste}
                          meldung={meldung} />
    </main>
  );
}
