import type { Metadata } from 'next';
import { Angebotsauswahl, auswahlMetadaten } from './Auswahl';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten();
}

export default function AngebotSeite() {
  return <Angebotsauswahl />;
}
