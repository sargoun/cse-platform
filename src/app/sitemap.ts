import type { MetadataRoute } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { detailEintraege, sitemapEintraege } from '@/server/services/inhalt/sitemap';
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
  const { eintraege, details } = await oeffentlichLesen(async (kontext) => {
    const db = { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) };
    return { eintraege: await sitemapEintraege(db), details: await detailEintraege(db) };
  });

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

  /**
   * **Die kanonischen Detailadressen** (PUB-10, §2.5) — Meldungen und
   * Projekte. Sie fehlten vollständig: gemeldet wurden nur `seite`-Zeilen,
   * und ein freigegebenes Kundenprojekt stand damit in keiner Sitemap.
   *
   * Ohne `alternates`: `beitrag` und `referenz` tragen keine `sprache`, es
   * gibt eine Fassung. Ein `hreflang="en"` auf denselben deutschen Text
   * behauptete eine Übersetzung, die es nicht gibt.
   */
  const detailseiten = details.map((d) => ({
    url: `${basis}${d.pfad}`,
    // Ohne Zeitstempel KEINE Angabe: „heute" als Ersatz wäre jeden Tag eine
    // neue Behauptung, die Seite habe sich geändert (R-11).
    ...(d.geaendert === null ? {} : { lastModified: d.geaendert }),
  }));

  return [...seiten, ...detailseiten, ...barrierefreiheit];
}
