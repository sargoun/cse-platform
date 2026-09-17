import type { Metadata } from 'next';
import {
  AngebotSeiteFuer, angebotMetadaten, felderAus,
} from '../../../angebot/[bereich]/Angebot';

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
   * kommt als Adresse zurueck, mit dem Grund UND den Feldmeldungen. Ohne
   * diese Zeilen saehe der englische Besucher ein leeres Formular und wuesste
   * nicht, warum es nicht durchging (D-599).
   */
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  return AngebotSeiteFuer(bereich, 'en', meldung, felderAus(suche['felder']));
}
