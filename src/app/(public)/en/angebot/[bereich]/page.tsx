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
  { params, searchParams }: {
    params: Promise<{ bereich: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { bereich } = await params;
  /*
   * Dieselbe Weiche wie auf der deutschen Route: eine abgewiesene Eingabe
   * kommt als Adresse zurueck, mit dem Grund UND den Schluesseln der Felder
   * (D-769). Die Saetze schlaegt `Angebot.tsx` englisch nach — auch die der
   * Dateifelder, die vorher deutsch aus der Definition kamen. Ohne diese
   * Weiche saehe der englische Besucher ein leeres Formular und wuesste nicht,
   * warum es nicht durchging (D-599).
   */
  return AngebotSeiteFuer(bereich, 'en', await searchParams);
}
