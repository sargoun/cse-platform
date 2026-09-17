import type { Metadata } from 'next';
import { BeitragDetailSeite } from '@/app/(public)/unternehmen/[bereich]/_profil/seiten';
import { ladeBereich } from '@/app/(public)/unternehmen/[bereich]/_profil/Rahmen';

/**
 * `/en/unternehmen/[bereich]/beitraege/[slug]` — die KANONISCHE Adresse eines Beitrags (SEITENKARTE §2.2).
 *
 * Die Gruppenliste unter `/news` verweist hierher und setzt
 * `rel=canonical` darauf: eine Meldung ist EINE Zeile und muss EINE Adresse
 * haben, sonst hat die Website zwei Fassungen derselben Sache.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string; slug: string }> },
): Promise<Metadata> {
  const { bereich } = await params;
  const daten = await ladeBereich(bereich, 'en');
  if (daten === null) return { title: 'Not found' };
  return { title: daten.name };
}

export default async function Seite(
  { params }: { params: Promise<{ bereich: string; slug: string }> },
) {
  const { bereich, slug } = await params;
  return (
    <BeitragDetailSeite bereich={bereich} slug={slug} sprache="en" segment="beitraege" />
  );
}
