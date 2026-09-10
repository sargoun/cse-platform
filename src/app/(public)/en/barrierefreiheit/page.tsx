import type { Metadata } from 'next';
import { Barrierefreiheit, barriereMetadaten } from '../../barrierefreiheit/Erklaerung';

/**
 * Dieselbe Erklärung, dieselbe Komponente, andere Sprache.
 *
 * Der Pfad bleibt `/barrierefreiheit` — ein zweiter Slug (`/accessibility`)
 * wäre eine zweite Adresse für dieselbe Seite und damit eine zweite Zeile in
 * jeder Prüfliste, die es gibt.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return barriereMetadaten('en');
}

export default function EnglishAccessibility() {
  return <Barrierefreiheit sprache="en" />;
}
