import type { Metadata } from 'next';
import { AnfrageSeiteFuer, anfrageMetadaten } from '../../../anfrage/[bereich]/Anfrage';

/** Dasselbe Formular, dieselbe Felddefinition, englische Beschriftungen. */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return anfrageMetadaten(bereich, 'en');
}

export default async function EnglishEnquiry(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  return AnfrageSeiteFuer(bereich, 'en');
}
