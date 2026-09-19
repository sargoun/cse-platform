import type { Metadata } from 'next';
import { beitragDerGruppe, NewsDetailSeite } from '@/app/(public)/_gruppe/NewsDetail';
import { gruppenDetailMetadaten } from '@/app/(public)/_gruppe/detail';

/**
 * `/news/[slug]` — der kurze Weg zu einer Meldung der Gruppe (SEITENKARTE §2.2).
 *
 * `rel=canonical` zeigt auf `/unternehmen/operations/news/<slug>`: dieselbe
 * Zeile unter zwei indexierbaren Adressen wäre genau die Doppelung, wegen der
 * die kurzen Adressen einmal gelöscht worden sind.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const { beitrag } = await beitragDerGruppe(slug, 'de');
  return gruppenDetailMetadaten({
    segment: 'news', slug, sprache: 'de', titel: beitrag?.titel ?? null,
  });
}

export default async function Seite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NewsDetailSeite slug={slug} sprache="de" />;
}
