import type { Metadata } from 'next';
import { DankeSeiteFuer, dankMetadaten } from '../../../../angebot/[bereich]/danke/Danke';

/** Dieselbe Bestätigung, englisch (D-82). */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return dankMetadaten(bereich, 'en');
}

export default async function EnglishThanks(
  { params, searchParams }: {
    params: Promise<{ bereich: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { bereich } = await params;
  const suche = await searchParams;
  const nummer = typeof suche['nr'] === 'string' ? suche['nr'] : null;
  return DankeSeiteFuer(bereich, nummer, 'en');
}
