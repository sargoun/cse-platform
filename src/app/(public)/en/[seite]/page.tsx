import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OEFFENTLICHE_ROUTEN } from '@/server/services/inhalt/routen';
import { istAusgeschlossen } from '@/server/services/inhalt/sitemap';
import { OeffentlicheSeite } from '../../OeffentlicheSeite';
import { metadatenFuer } from '../../metadaten';

/** Dieselben Pfade wie deutsch, nur unter `/en`. Die Liste ist dieselbe. */
export const dynamic = 'force-dynamic';

const ERLAUBT = new Set(
  OEFFENTLICHE_ROUTEN.map((r) => r.pfad).filter((p) => p !== '/'),
);

function pfadVon(segment: string): string | null {
  const pfad = `/${segment}`;
  if (istAusgeschlossen(pfad) || !ERLAUBT.has(pfad)) return null;
  return pfad;
}

export async function generateMetadata(
  { params }: { params: Promise<{ seite: string }> },
): Promise<Metadata> {
  const { seite } = await params;
  const pfad = pfadVon(seite);
  return pfad === null ? { title: 'Not found' } : metadatenFuer(pfad, 'en');
}

export default async function EnglishPage(
  { params }: { params: Promise<{ seite: string }> },
) {
  const { seite } = await params;
  const pfad = pfadVon(seite);
  if (pfad === null) notFound();
  return <OeffentlicheSeite pfad={pfad} sprache="en" />;
}
