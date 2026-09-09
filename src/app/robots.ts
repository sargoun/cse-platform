import type { MetadataRoute } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { AUSGESCHLOSSEN } from '@/server/services/inhalt/sitemap';

/**
 * `/robots.txt` (PUB-12).
 *
 * Die Sperrliste ist dieselbe Konstante, nach der die Sitemap filtert. Zwei
 * gepflegte Listen waeren zwei Gelegenheiten, eine Flaeche in der einen zu
 * sperren und in der anderen zu melden — und die Suchmaschine glaubt der
 * Sitemap.
 *
 * `Disallow` ist eine Bitte und keine Zugangskontrolle. Was nicht oeffentlich
 * sein darf, ist durch RLS geschuetzt und nicht durch diese Datei.
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const basis = await basisAusAnfrage();
  return {
    rules: [{ userAgent: '*', disallow: AUSGESCHLOSSEN.map((p) => `${p}/`) }],
    sitemap: `${basis}/sitemap.xml`,
  };
}
