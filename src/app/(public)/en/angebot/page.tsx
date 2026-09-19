import type { Metadata } from 'next';
import { Angebotsauswahl, auswahlMetadaten } from '../../angebot/Auswahl';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten('en');
}

export default function EnglishQuoteChooser() {
  return <Angebotsauswahl sprache="en" />;
}
