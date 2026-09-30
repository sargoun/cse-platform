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
  /*
   * Eine Abweisung kommt als GRUND zurück (`?fehler=`, D-769) — `Anfrage.tsx`
   * schlägt ihn nach. Ein Satz aus der Adresse erscheint nie.
   */
  return AnfrageSeiteFuer(undefined, await searchParams);
}
