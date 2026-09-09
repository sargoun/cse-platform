import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { AUSWAHL_TEXTE } from '@/lib/i18n/texte';
import { alternativen, mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { Angebotsauswahl } from './Auswahl';

export const dynamic = 'force-dynamic';

export async function auswahlMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = AUSWAHL_TEXTE[sprache];
  return {
    title: t.titel,
    description: t.einleitung,
    alternates: {
      canonical: `${basis}${mitSprache('/angebot', sprache)}`,
      languages: alternativen('/angebot', basis),
    },
  };
}

export function generateMetadata(): Promise<Metadata> {
  return auswahlMetadaten();
}

export default function AngebotSeite() {
  return <Angebotsauswahl />;
}
