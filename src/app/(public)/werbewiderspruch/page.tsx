import type { Metadata } from 'next';
import {
  WerbewiderspruchSeiteFuer, werbewiderspruchMetadaten,
} from './Werbewiderspruch';

/**
 * `/werbewiderspruch` — deutsch (CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG).
 *
 * Inhalt, Formular und Stände stehen in `Werbewiderspruch.tsx`: eine Pflicht,
 * eine Quelle, zwei Sprachen (D-82, D-83).
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return werbewiderspruchMetadaten();
}

export default async function Werbewiderspruchseite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const stand = typeof suche['stand'] === 'string' ? suche['stand'] : '';
  return WerbewiderspruchSeiteFuer('de', stand);
}
