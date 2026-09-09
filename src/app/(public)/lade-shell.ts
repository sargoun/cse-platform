import 'server-only';
import { FARBEN_BEREICH } from '@/lib/design/theme';
import type { BereichSchluessel } from '@/lib/design/theme';
import type { ShellBereich } from '@/components/oeffentlich/OeffentlicheShell';
import { napAus } from '@/server/services/inhalt/nap';
import type { BereichZeile } from '@/server/inhalt/lesen';

/**
 * Aus `mandant`-Zeilen werden Shell-Bereiche — aber nur die mit einem
 * bekannten Farbschluessel.
 *
 * DESIGN §1 kennt vier Bereichsfarben. Ein fuenfter Mandant haette keine, und
 * die Karte erschiene mit einer nicht aufloesenden CSS-Variablen: im Markup
 * richtig, auf dem Schirm durchsichtig. Er faellt hier heraus, sichtbar und
 * nicht stillschweigend — die Farbe kommt aus DESIGN.md und wird nicht
 * erfunden.
 */
export function istBereichsSchluessel(slug: string): slug is BereichSchluessel {
  return Object.prototype.hasOwnProperty.call(FARBEN_BEREICH, slug);
}

export function shellBereiche(zeilen: readonly BereichZeile[]): readonly ShellBereich[] {
  return zeilen
    .filter((z) => istBereichsSchluessel(z.slug))
    .map((z) => ({
      slug: z.slug,
      name: z.name,
      bereich: z.slug as BereichSchluessel,
      // `napAus()` wirft bei einer halben Anschrift. Das ist hier die richtige
      // Antwort: eine unvollstaendige Adresse im Fussbereich erzeugt einen
      // zweiten, schwaecheren Eintrag in der lokalen Suche — schlechter als
      // keiner.
      nap: napAus({
        firma: z.firma, strasse: z.strasse, plz: z.plz, ort: z.ort,
        land: z.land, telefon: z.telefon, email: z.email,
      }).einzeilig,
    }));
}
