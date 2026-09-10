import { notFound } from 'next/navigation';
import { Abschnitte } from '@/components/oeffentlich/Abschnitte';
import { JsonLd } from '@/components/oeffentlich/JsonLd';
import { ansprueche, seitenDaten } from '@/server/inhalt/seiten-daten';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { shellBereiche } from './lade-shell';

/**
 * Eine oeffentliche Seite, so wie sie in der Datenbank steht.
 *
 * Es gibt sie **einmal** — Startseite, Bereichsseite und jede Rechtsseite
 * gehen hier durch. Waere sie je Route kopiert, muesste jede Kopie an die
 * JSON-LD-Bloecke und an `pruefeSeite()` denken, und die vierte tut es nicht.
 */
export async function OeffentlicheSeite(
  { pfad, sprache = VORGABE_SPRACHE }:
  { readonly pfad: string; readonly sprache?: Sprache },
) {
  const daten = await seitenDaten(pfad, sprache);
  // Eine Seite im Entwurf ist fuer den Besucher nicht vorhanden — nicht leer.
  if (daten === null) notFound();

  return (
    <>
      <JsonLd blocks={daten.jsonLd} />
      <Abschnitte
        seite={daten.seite}
        bereiche={shellBereiche(daten.bereiche)}
        ansprueche={ansprueche(daten.bereiche)}
        sprache={sprache}
      />
    </>
  );
}
