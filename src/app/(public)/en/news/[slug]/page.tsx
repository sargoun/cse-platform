import type { Metadata } from 'next';
import { beitragDerGruppe, NewsDetailSeite } from '@/app/(public)/_gruppe/NewsDetail';
import { gruppenDetailMetadaten } from '@/app/(public)/_gruppe/detail';

/** Dieselbe Seite unter `/en` (D-82). Kanonisch bleibt die Gesellschaftsadresse. */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const { beitrag } = await beitragDerGruppe(slug, 'en');
  return gruppenDetailMetadaten({
    segment: 'news', slug, sprache: 'en', titel: beitrag?.titel ?? null,
  });
}

export default async function EnglishPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NewsDetailSeite slug={slug} sprache="en" />;
}
