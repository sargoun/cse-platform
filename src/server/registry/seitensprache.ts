import { UEBERSETZUNG_AUSNAHMEN } from '../../../scripts/guards/uebersetzung-ausnahmen.js';
import { findeRoute } from './routen.js';

/**
 * Spricht der INHALT einer Portalseite die Sprache der Sitzung — oder steht
 * er noch fest auf Deutsch? (D-767, V-257)
 *
 * **Warum das eine Frage ist.** Die Hülle des internen Portals spricht seit
 * D-592 zwei Sprachen: Leiste, Kopfzeile und Tab-Leiste kommen aus
 * `INTERN_BESCHRIFTUNGEN`. Der Seiteninhalt tut es nur, wo die Seite
 * umgestellt ist — 70 von 378 Seiten der Verwaltung, der Kunden und der
 * Gruppe; die übrigen tragen ihre Wörter fest im Rumpf und bleiben deutsch.
 * Ein `lang="en"` über ALLEM liesse einen Screenreader den deutschen Inhalt
 * dieser Seiten mit englischer Aussprache lesen — derselbe Fehler, den
 * `lang="de"` über einer englischen Seite macht, nur für mehr Seiten.
 *
 * **Die Antwort steht schon im Haus:** die Ausnahmeliste der Sperrklinke
 * `seite-ohne-uebersetzung` (`scripts/guards/uebersetzung-ausnahmen.ts`)
 * nennt genau die Seiten, deren Wörter noch fest deutsch sind, und die Wache
 * hält sie genau: eine Seite ohne feste Zeichenkette darf nicht darin stehen,
 * eine mit darf nicht fehlen. Wer eine Seite umstellt und ihre Zeile
 * streicht, stellt damit auch ihre Sprachangabe um — eine Liste, zwei
 * Antworten, keine zweite Stelle.
 *
 * **Von der Adresse zur Datei über das Routenmanifest** (`findeRoute`, dieselbe
 * Schärferegel wie die Pforte). Dass Manifest und Seitenbaum einander genau
 * abbilden, prüft `tests/kern/seitensprache.test.ts` über den ganzen Baum.
 */

const NOCH_DEUTSCH: ReadonlySet<string> = new Set(UEBERSETZUNG_AUSNAHMEN);

/** Die Seitendatei einer Portaladresse (`src/app/…/page.tsx`) — `null` ohne Manifestzeile. */
export function seitendatei(pfad: string): string | null {
  const route = findeRoute(pfad);
  return route === undefined ? null : `src/app${route.pfad}/page.tsx`;
}

/**
 * `true`, wenn der Inhalt der Seite unter `pfad` der Sitzung folgt; `false`,
 * wenn er noch fest deutsch ist — und auch, wenn die Adresse keine Seite des
 * Manifests ist: Deutsch ist die Vorgabe, nicht ein Raten.
 */
export function inhaltFolgtSitzung(pfad: string): boolean {
  const datei = seitendatei(pfad);
  return datei !== null && !NOCH_DEUTSCH.has(datei);
}
