import type { Metadata } from 'next';
import { bewerbungsMeldung } from '../../karriere/meldung';
import { karriereListe, karriereMetadaten } from '../../karriere/Seiten';
import { KARRIERE_TEXTE } from '../../karriere/texte';

/**
 * `/en/karriere` — dieselbe Liste englisch (V-393, D-82). Der Pfad bleibt
 * `/karriere`: dieselben Pfade in beiden Sprachen, wie überall auf der Website.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  const t = KARRIERE_TEXTE.en;
  return karriereMetadaten('en', '/karriere', t.metaTitel, t.metaBeschreibung);
}

export default async function EnglishCareers(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const meldung = bewerbungsMeldung((await searchParams)['fehler'], 'en');
  return karriereListe('en', (await searchParams)['bereich'], meldung);
}
