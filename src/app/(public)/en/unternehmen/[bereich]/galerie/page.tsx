import type { Metadata } from 'next';
import { GalerieSeite } from '@/app/(public)/unternehmen/[bereich]/_profil/seiten';
import { titelFuer } from '@/app/(public)/unternehmen/[bereich]/_profil/seiten';
import { ladeBereich } from '@/app/(public)/unternehmen/[bereich]/_profil/Rahmen';

/**
 * `/en/unternehmen/[bereich]/galerie` — SEITENKARTE §2.2
 *
 * Dünn mit Absicht: die Seite steht in `_profil/seiten.tsx`, einmal für beide
 * Sprachen (D-82). Hier steht nur, WELCHE Sprache gilt.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  const daten = await ladeBereich(bereich, 'en');
  if (daten === null) return { title: 'Not found' };
  return { title: `${titelFuer('galerie', 'en')} — ${daten.name}` };
}

export default async function Seite(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  return <GalerieSeite bereich={bereich} sprache="en" />;
}
