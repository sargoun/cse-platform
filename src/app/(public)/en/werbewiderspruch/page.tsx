import type { Metadata } from 'next';
import {
  WerbewiderspruchSeiteFuer, werbewiderspruchMetadaten,
} from '../../werbewiderspruch/Werbewiderspruch';

/**
 * `/en/werbewiderspruch` — englisch (D-82).
 *
 * **Warum der Pfad deutsch bleibt.** D-82 verlangt „same paths": die englische
 * Fassung liegt unter `/en/…` auf DEMSELBEN Pfad. `werbewiderspruch` ist
 * ausserdem der Pfad, der in ausgehenden Nachrichten steht und in der
 * Seitenkarte §2.4 als Pflichtweg geführt wird — ihn zu übersetzen hiesse,
 * zwei Adressen für eine gesetzliche Pflicht zu führen.
 *
 * **Der Schreibweg ist derselbe**: `POST /api/werbewiderspruch`. Die
 * Formularfelder sind überlagert, nicht verdoppelt (D-83) — eine englische
 * Fassung mit eigenen Feldnamen wäre eine zweite Wahrheit über dieselbe
 * Pflicht, und sie fiele erst auf, wenn ein Widerspruch nicht ankommt.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return werbewiderspruchMetadaten('en');
}

export default async function WerbewiderspruchPage(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const stand = typeof suche['stand'] === 'string' ? suche['stand'] : '';
  return WerbewiderspruchSeiteFuer('en', stand);
}
