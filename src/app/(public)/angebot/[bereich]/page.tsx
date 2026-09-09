import type { Metadata } from 'next';
import { AngebotSeiteFuer, angebotMetadaten } from './Angebot';

/**
 * `/angebot/[bereich]` — die deutsche Route (REQ-01).
 *
 * Formular und Metadaten stehen in `Anfrage.tsx`: aus einer `page.tsx` erlaubt
 * Next.js nur die bekannten Exporte, und die englische Route unter `en/` ruft
 * dieselbe Funktion mit `sprache="en"` auf.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return angebotMetadaten(bereich);
}

export default async function AnfrageSeite(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  return AngebotSeiteFuer(bereich);
}
