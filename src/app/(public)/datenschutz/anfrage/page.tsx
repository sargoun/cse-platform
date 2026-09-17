import type { Metadata } from 'next';
import { AnfrageSeiteFuer, anfrageMetadaten } from './Anfrage';

/** `/datenschutz/anfrage` — deutsch (LEG-09). */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return anfrageMetadaten();
}

export default async function Seite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  return AnfrageSeiteFuer(undefined, meldung);
}
