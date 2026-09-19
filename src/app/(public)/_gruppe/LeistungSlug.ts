import { istAusgeschlossen } from '@/server/services/inhalt/sitemap';

/**
 * Der Pfad einer Leistungsseite aus ihrem Slug — oder `null` fuer 404.
 *
 * **Die Form steht hier und nicht in zwei Seiten.** `seite.pfad` traegt
 * `CHECK (pfad ~ '^/[a-z0-9/-]*$')`; ein Slug mit Grossbuchstaben, Punkt oder
 * Schraegstrich kann deshalb gar keine Zeile treffen, und ihn in eine Abfrage
 * zu geben hiesse, auf eine leere Antwort zu warten, statt sofort 404 zu
 * sagen. `istAusgeschlossen` haelt die gesperrten Praefixe fern — dieselbe
 * Konstante, nach der `robots.txt` und die Sitemap filtern.
 *
 * Es gibt KEINE Liste erlaubter Slugs: welche Leistungen eine eigene Seite
 * bekommen, ist Redaktion und steht in `seite`. Eine zweite Liste im Code
 * waere die Stelle, an der die vierzehnte Leistung fehlt (O-652).
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function leistungsPfad(slug: string): string | null {
  if (!SLUG.test(slug)) return null;
  const pfad = `/leistungen/${slug}`;
  return istAusgeschlossen(pfad) ? null : pfad;
}
