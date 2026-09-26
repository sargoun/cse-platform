import type { Metadata } from 'next';
import { Angebotsauswahl, auswahlMetadaten } from '../../angebot/Auswahl';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten('en');
}

export default async function EnglishQuoteChooser(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  // Die Kampagnenparameter des Aufrufs reisen an den Bereichslinks weiter (D-631).
  return <Angebotsauswahl sprache="en" suche={await searchParams} />;
}
