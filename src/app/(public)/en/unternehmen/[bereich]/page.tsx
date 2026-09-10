import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OEFFENTLICHE_ROUTEN } from '@/server/services/inhalt/routen';
import { OeffentlicheSeite } from '../../../OeffentlicheSeite';
import { metadatenFuer } from '../../../metadaten';

/**
 * `/unternehmen/[bereich]` — das Profil EINER Gesellschaft (§2.2, PRO-01…PRO-05).
 *
 * Eine eigene Route, weil sie zwei Segmente hat: der `[seite]`-Sammler bedient
 * genau eines. Welche Bereiche es gibt, sagt `OEFFENTLICHE_ROUTEN` — ein
 * erfundener Bereich ist 404 und keine leere Seite.
 */
export const dynamic = 'force-dynamic';

const ERLAUBT = new Set(
  OEFFENTLICHE_ROUTEN.filter((r) => r.bereich !== null).map((r) => r.pfad),
);

function pfadVon(bereich: string): string | null {
  const pfad = `/unternehmen/${bereich}`;
  return ERLAUBT.has(pfad) ? pfad : null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  const pfad = pfadVon(bereich);
  return pfad === null ? { title: 'Not found' } : metadatenFuer(pfad, 'en');
}

export default async function EnglishProfile(
  { params }: { params: Promise<{ bereich: string }> },
) {
  const { bereich } = await params;
  const pfad = pfadVon(bereich);
  if (pfad === null) notFound();
  return <OeffentlicheSeite pfad={pfad} sprache="en" />;
}
