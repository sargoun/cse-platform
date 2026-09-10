import type { Metadata } from 'next';
import { AngebotSeiteFuer, angebotMetadaten } from '../../../angebot/[bereich]/Angebot';

/** Dasselbe Formular, dieselbe Felddefinition, englische Beschriftungen. */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  return angebotMetadaten(bereich, 'en');
}

export default async function EnglishEnquiry(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  return AngebotSeiteFuer(bereich, 'en');
}
