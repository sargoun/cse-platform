import type { MetadataRoute } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { sitemapEintraege } from '@/server/services/inhalt/sitemap';
import { alternativen, istSprache, mitSprache, SPRACHEN } from '@/lib/sprache';

/**
 * `/sitemap.xml` (PUB-10, PUB-12) — die veroeffentlichten Seiten, sonst nichts.
 *
 * `force-dynamic`, weil die Liste aus der Datenbank kommt: eine beim Build
 * eingefrorene Sitemap meldet die naechste veroeffentlichte Seite erst beim
 * naechsten Deployment — und eine zurueckgezogene meldet sie weiter.
 *
 * **Jede Zeile traegt ihre `alternates`.** Google verlangt die Verweise
 * gegenseitig; eine Sitemap, die nur die deutschen Adressen nennt, laesst die
 * englischen Fassungen als eigenstaendige, konkurrierende Seiten erscheinen —
 * und dann verdraengen sich zwei Fassungen derselben Seite gegenseitig aus dem
 * Ergebnis.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const basis = await basisAusAnfrage();
  const eintraege = await oeffentlichLesen(async (kontext) =>
    sitemapEintraege({ unsafe: (s, w) => kontext.abfrage(s, w) }));

  // Eine Zeile in einer Sprache, die es im Code nicht gibt, hat keine Adresse
  // — sie zu erfinden hiesse, der Suchmaschine eine 404 zu melden. `flatMap`
  // statt `filter`+`map`, damit die Sprache wirklich verengt ist und nicht
  // durch einen Cast an der eigenen Wache vorbeigeht.
  const seiten = eintraege.flatMap((e) => (istSprache(e.sprache) ? [{
    url: `${basis}${mitSprache(e.pfad, e.sprache)}`,
    lastModified: e.geaendert,
    alternates: { languages: alternativen(e.pfad, basis) },
  }] : []));

  // Die Erklaerung ist eine Codeseite und steht in keiner `seite`-Zeile —
  // sie gehoert trotzdem in die Sitemap (LEG-07), in beiden Sprachen.
  const barrierefreiheit = SPRACHEN.map((s) => ({
    url: `${basis}${mitSprache('/barrierefreiheit', s)}`,
    alternates: { languages: alternativen('/barrierefreiheit', basis) },
  }));

  return [...seiten, ...barrierefreiheit];
}
