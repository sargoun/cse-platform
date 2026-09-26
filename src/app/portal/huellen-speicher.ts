import 'server-only';
import { cache } from 'react';
import type { PortalSprache } from '@/lib/i18n/texte';
import type { UmschalterStand } from '@/server/services/mandant/umschalter';

/**
 * Was der Bereichsumschalter braucht (DESIGN §6, TEN-06, TEN-10, V-165) —
 * vom Tor in DERSELBEN gebundenen Transaktion gelesen wie der Zugang zur
 * Seite, damit die Kopfzeile keine zweite Wahrheit ueber die Bereiche hat.
 */
export interface UmschalterHuelle {
  readonly stand: UmschalterStand;
  /** Der aktive Bereich dieser Sitzung — `null` in der Gruppenansicht. */
  readonly aktiverMandantId: string | null;
  readonly gruppenansicht: boolean;
}

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
 * Vorgabe der Route. Vor fast jeder Huelle laeuft `portalZugang`; die
 * Kontoseiten binden ihre Sitzung selbst (`leseKonto`) und legen nur die
 * Bereiche ab (`merkeUmschalter`, V-165). Die Vorschau unter `/dev/portal`
 * rendert den Rahmen ganz ohne Sitzung, und die soll nicht fallen.
 */
export interface HuellenStand {
  sprache: PortalSprache | null;
  pfad: string | null;
  /**
   * Der Weg zurueck — abgeleitet aus der Adresse, vom Tor gegen die Rechte
   * seines Ziels geprueft (DESIGN §5 „The way back", D-613, V-108).
   *
   * **Aus demselben Grund hier und nicht als Eigenschaft** wie Sprache und
   * Pfad darueber: `PortalRahmen` steht an 176 Stellen. Ihn anzuhaengen
   * hiesse, 176 Aufrufe zu aendern und bei jedem kuenftigen zu HOFFEN, dass
   * jemand daran denkt — und wer es vergisst, baut wieder eine Seite ohne
   * Ausgang. Gemessen war das der Zustand: 311 Seiten, zwei mit Rueckweg.
   */
  rueckweg: { ziel: string; segment: string } | null;
  /**
   * Die Bereiche dieser Anmeldung — `null` heisst „nicht gefragt" (die
   * Vorschau unter `/dev/portal`, ein Rahmen ohne Tor). Dann bleibt die
   * Kopfzeile, wie sie vor V-165 war: kein Umschalter, der Verweis auf die
   * Bereichswahl bleibt. Niemand soll ohne Ausgang dastehen, weil ein Wert
   * fehlte.
   */
  umschalter: UmschalterHuelle | null;
}

const kasten = cache((): HuellenStand => ({
  sprache: null, pfad: null, rueckweg: null, umschalter: null,
}));

/** Vom Tor aufgerufen, sobald die Sitzung aufgeloest ist. */
export function merkeHuelle(
  sprache: PortalSprache | null,
  pfad: string | null,
  rueckweg: HuellenStand['rueckweg'] = null,
  umschalter: UmschalterHuelle | null = null,
): void {
  const k = kasten();
  k.sprache = sprache;
  k.pfad = pfad;
  k.rueckweg = rueckweg;
  k.umschalter = umschalter;
}

/**
 * Nur die Bereiche — fuer die Kontoseiten (`leseKonto`), die nicht durch das
 * Tor gehen und ihre Sitzung selbst binden (V-165).
 *
 * **Warum eine eigene Funktion und nicht `merkeHuelle`.** Die Kontoseiten
 * setzten bisher NICHTS in diesen Speicher; Sprache, Pfad und Rueckweg dort
 * anzufassen hiesse, drei Verhalten zu aendern, um eines zu reparieren. Ohne
 * diese Zeile aber zeigte die Kopfzeile auf `/portal/konto` jedem Konto
 * „Bereich wechseln" — auch dem mit einem einzigen Bereich (TEN-06), und
 * genau das hat V-165 ueberall sonst abgestellt.
 */
export function merkeUmschalter(umschalter: UmschalterHuelle | null): void {
  kasten().umschalter = umschalter;
}

/** Von der Huelle aufgerufen, beim Rendern der Kopfzeile und der Leisten. */
export function gemerkteHuelle(): Readonly<HuellenStand> {
  return kasten();
}
