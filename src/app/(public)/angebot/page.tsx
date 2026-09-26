import type { Metadata } from 'next';
import { Angebotsauswahl, auswahlMetadaten } from './Auswahl';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten();
}

export default async function AngebotSeite(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  // Die Kampagnenparameter des Aufrufs reisen an den Bereichslinks weiter (D-631).
  return <Angebotsauswahl suche={await searchParams} />;
}
