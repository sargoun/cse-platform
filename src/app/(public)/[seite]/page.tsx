import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OEFFENTLICHE_ROUTEN } from '@/server/services/inhalt/routen';
import { istAusgeschlossen } from '@/server/services/inhalt/sitemap';
import { OeffentlicheSeite } from '../OeffentlicheSeite';
import { metadatenFuer } from '../metadaten';

/**
 * Die uebrigen PUB-01-Routen — eine Datei, dreizehn Seiten.
 *
 * **Warum nicht zwoelf Dateien.** Jede waere identisch bis auf einen String,
 * und die dreizehnte vergaesse dann die JSON-LD-Bloecke. Welche Pfade es gibt,
 * sagt `OEFFENTLICHE_ROUTEN` — dieselbe Liste, gegen die der Test prueft, dass
 * jede Route eine `seite`-Zeile hat.
 *
 * Ein unbekannter Pfad ist 404 und nicht "leere Seite": eine leere Seite sieht
 * aus wie "noch nicht fertig" und wird von Suchmaschinen indexiert.
 */
export const dynamic = 'force-dynamic';

const ERLAUBT = new Set(
  OEFFENTLICHE_ROUTEN.map((r) => r.pfad).filter((p) => p !== '/'),
);

function pfadVon(segment: string): string | null {
  const pfad = `/${segment}`;
  if (istAusgeschlossen(pfad) || !ERLAUBT.has(pfad)) return null;
  return pfad;
}

export async function generateMetadata(
  { params }: { params: Promise<{ seite: string }> },
): Promise<Metadata> {
  const { seite } = await params;
  const pfad = pfadVon(seite);
  return pfad === null ? { title: 'Nicht gefunden' } : metadatenFuer(pfad);
}

export default async function Unterseite(
  { params }: { params: Promise<{ seite: string }> },
) {
  const { seite } = await params;
  const pfad = pfadVon(seite);
  if (pfad === null) notFound();
  return <OeffentlicheSeite pfad={pfad} />;
}
