import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OeffentlicheSeite } from '@/app/(public)/OeffentlicheSeite';
import { metadatenFuer } from '@/app/(public)/metadaten';
import { leistungsPfad } from '@/app/(public)/_gruppe/LeistungSlug';

/**
 * `/leistungen/[slug]` — eine einzelne Leistung als redaktionelle Seite
 * (PUB-01, PUB-07, PUB-11).
 *
 * **Sie kommt aus `seite`/`abschnitt`, wie jede andere oeffentliche Seite.**
 * `seite.pfad` erlaubt mehrsegmentige Pfade seit `0014`; es fehlten nicht die
 * Spalten, sondern die ZEILEN. Deshalb ist diese Datei so duenn wie
 * `[seite]/page.tsx`: Pfad zusammensetzen, unbekannt → 404, sonst die eine
 * Huelle rendern.
 *
 * **Anders als `/news/[slug]` ist diese Adresse die kanonische.** Eine
 * Leistungsseite ist eine eigene redaktionelle Seite mit eigener `seite`-Zeile
 * je Sprache — keine zweite Fassung einer Gesellschaftsseite. `metadatenFuer`
 * setzt deshalb `canonical` auf die eigene Adresse und die `hreflang`-Paare
 * dazu.
 *
 * Der `Service`-Block entsteht in `seiten-daten.ts` und nicht hier: stuende er
 * in der Seite, setzte ihn jede neue Seite neu zusammen.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const pfad = leistungsPfad(slug);
  return pfad === null ? { title: 'Nicht gefunden' } : metadatenFuer(pfad);
}

export default async function Seite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pfad = leistungsPfad(slug);
  // 404 und nicht „leere Seite": leer sieht aus wie „noch nicht fertig" und
  // wird indexiert.
  if (pfad === null) notFound();
  return <OeffentlicheSeite pfad={pfad} />;
}
