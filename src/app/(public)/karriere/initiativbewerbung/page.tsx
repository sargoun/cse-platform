import type { Metadata } from 'next';
import { bewerbungsMeldung } from '../meldung';
import { initiativBlatt } from '../Seiten';
import { KARRIERE_TEXTE } from '../texte';

/**
 * `/karriere/initiativbewerbung` — ohne Stelle (REC-03, REC-07).
 *
 * **Der Bereich ist hier eine Wahl und kein Parameter.** Eine
 * Initiativbewerbung gehört zu einer Gesellschaft, weil der Arbeitsvertrag mit
 * ihr zustande käme (D-09) — und weil `mandant_id` an der Zeile hängt, ohne
 * das keine Policy greift (K-03). Englisch unter
 * `/en/karriere/initiativbewerbung` (V-393).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.de.initiativMetaTitel };

export default async function InitiativSeite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  // V-158: eine Abweisung kommt als Grund zurück, nicht als JSON.
  const meldung = bewerbungsMeldung((await searchParams)['fehler']);
  return initiativBlatt('de', meldung);
}
