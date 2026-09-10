import type { Metadata } from 'next';
import { Angebotsauswahl } from '../../angebot/Auswahl';
import { auswahlMetadaten } from '../../angebot/page';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten('en');
}

export default function EnglishQuoteChooser() {
  return <Angebotsauswahl sprache="en" />;
}
