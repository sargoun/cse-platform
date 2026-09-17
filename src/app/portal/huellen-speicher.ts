import 'server-only';
import { cache } from 'react';
import type { PortalSprache } from '@/lib/i18n/texte';

/**
 * Was die Portalhuelle ueber DIESE Anfrage wissen muss — einmal vom Tor
 * geschrieben, von der Huelle gelesen.
 *
 * Zwei Angaben: die gewaehlte Sprache und die Adresse, auf der die Sitzung
 * gerade steht. Die erste beschriftet Leisten und Kopfzeile, die zweite ist
 * der Rueckweg des Sprachumschalters — er schickt ein Formular an
 * `/api/konto/sprache` und will danach dort landen, wo er gedrueckt wurde,
 * nicht auf der Kontoseite.
 *
 * **Warum nicht als Eigenschaft.** `PortalRahmen` steht an 176 Stellen. Beides
 * als Pflichteigenschaft anzuhaengen hiesse, 176 Aufrufe zu aendern und bei
 * jedem kuenftigen zu HOFFEN, dass jemand daran denkt. Vergisst es einer,
 * faellt seine Seite still ins Deutsche zurueck und der Umschalter wirft den
 * Benutzer auf die Kontoseite — kein Fehler, keine rote Zeile, nur ein
 * Bildschirm, der sich falsch benimmt. Genau die Sorte Fehlschlag, die dieses
 * Haus vermeiden will.
 *
 * **Warum `cache()` und keine Modulvariable.** Eine Modulvariable lebt im
 * PROZESS: zwei Anfragen zweier Benutzer teilten sie sich, und wer zuletzt das
 * Tor passierte, bestimmte die Sprache aller anderen — im schlimmsten Fall
 * auch den Rueckweg, also eine fremde Adresse. `cache()` von React ist pro
 * Anfrage: Next.js legt fuer jeden Durchlauf einen eigenen Speicher an und
 * wirft ihn danach weg. Dasselbe Werkzeug, das Next fuer request-scoped
 * Memoisierung vorsieht, nur mit einem Kasten statt einem Ergebnis darin.
 *
 * **Und wenn niemand schreibt?** Dann bleibt beides `null`. `null` heisst bei
 * `internSprache()` Deutsch, und ein Umschalter ohne Rueckweg faellt auf die
 * Vorgabe der Route. Eine Huelle ohne Tor davor gibt es nicht —
 * `portalZugang` laeuft vor jeder —, aber die Vorschau unter `/dev/portal`
 * rendert den Rahmen ohne Sitzung, und die soll nicht fallen.
 */
export interface HuellenStand {
  sprache: PortalSprache | null;
  pfad: string | null;
}

const kasten = cache((): HuellenStand => ({ sprache: null, pfad: null }));

/** Vom Tor aufgerufen, sobald die Sitzung aufgeloest ist. */
export function merkeHuelle(sprache: PortalSprache | null, pfad: string | null): void {
  const k = kasten();
  k.sprache = sprache;
  k.pfad = pfad;
}

/** Von der Huelle aufgerufen, beim Rendern der Kopfzeile und der Leisten. */
export function gemerkteHuelle(): Readonly<HuellenStand> {
  return kasten();
}
