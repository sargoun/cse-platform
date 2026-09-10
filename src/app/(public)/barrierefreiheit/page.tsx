import type { Metadata } from 'next';
import { Barrierefreiheit, barriereMetadaten } from './Erklaerung';

/**
 * Die deutsche Route. Die englische liegt unter `en/` und ruft dieselbe
 * Komponente mit `sprache="en"` auf.
 *
 * Komponente und Metadaten stehen in `Erklaerung.tsx`, weil Next.js aus einer
 * `page.tsx` nur die bekannten Exporte erlaubt — ein zusätzlicher Export ist
 * dort ein Typfehler und keine Stilfrage.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return barriereMetadaten();
}

export default function BarrierefreiheitSeite() {
  return <Barrierefreiheit />;
}
