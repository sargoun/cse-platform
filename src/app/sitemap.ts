import type { MetadataRoute } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { sitemapEintraege } from '@/server/services/inhalt/sitemap';

/**
 * `/sitemap.xml` (PUB-10, PUB-12) — die veroeffentlichten Seiten, sonst nichts.
 *
 * `force-dynamic`, weil die Liste aus der Datenbank kommt: eine beim Build
 * eingefrorene Sitemap meldet die naechste veroeffentlichte Seite erst beim
 * naechsten Deployment — und eine zurueckgezogene meldet sie weiter.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const basis = await basisAusAnfrage();
  const eintraege = await oeffentlichLesen(async (kontext) =>
    sitemapEintraege({ unsafe: (s, w) => kontext.abfrage(s, w) }));

  return [
    ...eintraege.map((e) => ({
      url: `${basis}${e.pfad === '/' ? '' : e.pfad}`,
      lastModified: e.geaendert,
    })),
    // Die Erklaerung ist eine Codeseite und steht in keiner `seite`-Zeile —
    // sie gehoert trotzdem in die Sitemap (LEG-07).
    { url: `${basis}/barrierefreiheit` },
  ];
}
