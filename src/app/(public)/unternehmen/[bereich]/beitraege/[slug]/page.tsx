import type { Metadata } from 'next';
import { BeitragDetailSeite } from '@/app/(public)/unternehmen/[bereich]/_profil/seiten';
import { beitragsMetadaten } from '@/app/(public)/unternehmen/[bereich]/_profil/kanonik';

/**
 * `/unternehmen/[bereich]/beitraege/[slug]` — die KANONISCHE Adresse eines Beitrags (SEITENKARTE §2.2).
 *
 * Die Gruppenliste unter `/news` verweist hierher und setzt
 * `rel=canonical` darauf: eine Meldung ist EINE Zeile und muss EINE Adresse
 * haben, sonst hat die Website zwei Fassungen derselben Sache.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ bereich: string; slug: string }> },
): Promise<Metadata> {
  const { bereich, slug } = await params;
  /*
   * `canonical` auf die EINE Adresse, die die Art dieses Beitrags trägt —
   * dieselbe, die `detailEintraege()` in die Sitemap schreibt. Vorher stand
   * hier nur der Name der Gesellschaft, und zwei Adressen lieferten
   * denselben Text ohne jede Zuordnung (SEITENKARTE §2.2).
   */
  return beitragsMetadaten(bereich, slug, 'de');
}

export default async function Seite(
  { params }: { params: Promise<{ bereich: string; slug: string }> },
) {
  const { bereich, slug } = await params;
  return (
    <BeitragDetailSeite bereich={bereich} slug={slug} sprache="de" segment="beitraege" />
  );
}
