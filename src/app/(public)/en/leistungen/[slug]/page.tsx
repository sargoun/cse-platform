import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OeffentlicheSeite } from '@/app/(public)/OeffentlicheSeite';
import { metadatenFuer } from '@/app/(public)/metadaten';
import { leistungsPfad } from '@/app/(public)/_gruppe/LeistungSlug';

/**
 * Dieselbe Seite unter `/en` (D-82) — und dieselbe `seite`-Zeile? Nein: die
 * englische Fassung ist eine EIGENE Zeile mit `sprache = 'en'`. Fehlt sie,
 * gibt es die englische Adresse nicht, und das ist ehrlicher als eine
 * deutsche Seite unter einer englischen Adresse.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const pfad = leistungsPfad(slug);
  return pfad === null ? { title: 'Not found' } : metadatenFuer(pfad, 'en');
}

export default async function EnglishPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pfad = leistungsPfad(slug);
  if (pfad === null) notFound();
  return <OeffentlicheSeite pfad={pfad} sprache="en" />;
}
