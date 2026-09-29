import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel } from '@/server/auth/ursprung';
import { istPortalSprache } from '@/lib/i18n/texte';
import { SPRACH_KEKS } from '@/lib/i18n/geraetesprache';
import { sprachKeksOptionen } from '@/server/konto/sprach-keks';

/**
 * `GET /api/geraetesprache?sprache=…&zurueck=…` — die Sprache der Flächen
 * OHNE Sitzung: Stempeluhr und Anmeldung der Beschäftigten (V-200, D-694,
 * EMP-12, SEITENKARTE §12).
 *
 * **Warum ein Keks und keine Zeile.** Vor der Anmeldung gibt es keinen
 * Menschen, dessen `person.sprache` gälte, und die Stempeluhr löst ihre Marke
 * vor dem Antippen absichtlich nicht auf (AUT-06). Die Wahl gehört deshalb dem
 * GERÄT: ein Keks mit einem von vier Werten, der nichts über jemanden sagt.
 *
 * **Warum `GET`.** Die Wahl steht als Reihe von Verweisen auf der
 * Stempelfläche, und die hat genau EINEN Knopf (DESIGN §8) — ein Formular
 * mit vier Knöpfen bräche die Zusage, auf der die Fläche gebaut ist. Die
 * Handlung ist eine Anzeigeeinstellung, keine Aussage über Zeit oder Geld:
 * sie ändert keine Zeile, sie ist wiederholbar, und sie gibt nichts heraus.
 * Zwei Riegel bleiben trotzdem:
 *
 *  1. **Kein Keks auf Zuruf einer fremden Seite.** `Sec-Fetch-Site:
 *     cross-site` heisst: der Verweis stand woanders. Dann wird nur
 *     zurückgeleitet — umgestellt wird die Sprache nur von hier aus
 *     (`same-origin`) oder aus der Adresszeile (`none`).
 *  2. **Der Rückweg bleibt im eigenen Ursprung** (`internesZiel`): ein
 *     `zurueck=https://boese.example` endet auf der Anmeldung.
 *
 * Ein Wert ausserhalb der vier setzt nichts; die Seite bleibt, wie sie war.
 */
export const dynamic = 'force-dynamic';

export function GET(anfrage: NextRequest): NextResponse {
  const suche = anfrage.nextUrl.searchParams;
  const sprache = suche.get('sprache') ?? '';
  const antwort = NextResponse.redirect(
    internesZiel(suche.get('zurueck'), '/auth/mitarbeiter', anfrage), 303);
  antwort.headers.set('Cache-Control', 'no-store');

  const herkunft = anfrage.headers.get('sec-fetch-site');
  if (herkunft === 'cross-site' || herkunft === 'same-site') return antwort;
  if (istPortalSprache(sprache)) {
    antwort.cookies.set(SPRACH_KEKS, sprache, sprachKeksOptionen());
  }
  return antwort;
}
