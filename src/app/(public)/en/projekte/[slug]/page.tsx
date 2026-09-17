import type { Metadata } from 'next';
import {
  ProjektDetailGruppe, referenzDerGruppe,
} from '@/app/(public)/_gruppe/ProjektDetailSeite';
import { gruppenDetailMetadaten } from '@/app/(public)/_gruppe/detail';

/** Dieselbe Seite unter `/en` (D-82). Kanonisch bleibt die Gesellschaftsadresse. */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const { referenz } = await referenzDerGruppe(slug, 'en');
  return gruppenDetailMetadaten({
    segment: 'projekte', slug, sprache: 'en', titel: referenz?.titel ?? null,
  });
}

export default async function EnglishPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProjektDetailGruppe slug={slug} sprache="en" />;
}
