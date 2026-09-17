import type { Metadata } from 'next';
import { DankeSeiteFuer, dankMetadaten } from './Danke';

/**
 * `/angebot/[bereich]/danke` — die deutsche Route (REQ-01).
 *
 * Wie beim Formular daneben steht der Inhalt in einer eigenen Datei: aus einer
 * `page.tsx` erlaubt Next.js nur die bekannten Exporte, und die englische
 * Route unter `en/` ruft dieselbe Funktion mit `sprache="en"`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return dankMetadaten(bereich);
}

export default async function DankeSeite(
  { params, searchParams }: {
    params: Promise<{ bereich: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { bereich } = await params;
  const suche = await searchParams;
  const nummer = typeof suche['nr'] === 'string' ? suche['nr'] : null;
  return DankeSeiteFuer(bereich, nummer);
}
