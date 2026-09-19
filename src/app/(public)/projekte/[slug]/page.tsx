import type { Metadata } from 'next';
import {
  ProjektDetailGruppe, referenzDerGruppe,
} from '@/app/(public)/_gruppe/ProjektDetailSeite';
import { gruppenDetailMetadaten } from '@/app/(public)/_gruppe/detail';

/**
 * `/projekte/[slug]` — der kurze Weg zu einem Projekt der Gruppe (§2.2).
 *
 * `rel=canonical` zeigt auf `/unternehmen/operations/projekte/<slug>`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const { referenz } = await referenzDerGruppe(slug, 'de');
  return gruppenDetailMetadaten({
    segment: 'projekte', slug, sprache: 'de', titel: referenz?.titel ?? null,
  });
}

export default async function Seite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjektDetailGruppe slug={slug} sprache="de" />;
}
