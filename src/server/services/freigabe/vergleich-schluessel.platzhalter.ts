/**
 * Was zwei Rechnungspositionen fachlich zu DERSELBEN Position macht — und
 * warum die Liste leer anfaengt (APR-02, `06-AGENTEN-FREIGABEN.md` §14.5).
 *
 * Der Schluessel einer Position ist `${objekt_id}|${leistungskatalog_id}|${einheit}`
 * plus die hier genannten Merkmale. Ein frueherer Entwurf hatte den Tarif fest
 * im Schluessel. Das ist genau der Fall, den `CLAUDE.md` verbietet: ein
 * Tarifwert, den der Kunde noch nicht bestaetigt hat, entschiede damit, WAS
 * der Diff ueberhaupt zeigt.
 *
 * **Und die Richtung des Fehlers ist nicht symmetrisch.** Steht der Zuschlag
 * IM Schluessel, so erscheint eine geaenderte Zuschlagsgruppe als eine
 * entfallene und eine hinzugekommene Zeile — ein Add/Remove-Paar, in dem eine
 * Preisaenderung unsichtbar wird, weil der Betrag der neuen Zeile mit nichts
 * verglichen wird. Steht er NICHT im Schluessel, erscheint dieselbe Aenderung
 * als GEAENDERTE Position mit ihrem Delta. Solange die Frage offen ist, gilt
 * deshalb die sichtbare Variante.
 *
 * TODO(client, O-114): Voreinstellung — die Tarif- bzw. Zuschlagsgruppe ist
 * ein ATTRIBUT der Position, nicht Teil ihrer Identitaet: Objekt, Leistung
 * und Einheit bestimmen sie, eine geaenderte Zuschlagsgruppe erscheint als
 * Aenderung derselben Zeile mit Delta. Wie gebaut (leere Liste). D-796.
 */

/**
 * VOREINSTELLUNG (O-114, D-796) — leer: kein zusaetzliches Merkmal.
 *
 * Jeder Eintrag ist ein Schluessel aus `VergleichsPosition.meta`. Ein Name,
 * den `meta` nicht traegt, geht als leerer Abschnitt in den Schluessel ein —
 * nicht als Fehler: die Liste ist Konfiguration und darf einer aelteren
 * Nutzlast vorauslaufen.
 */
export const ZUSAETZLICHE_SCHLUESSEL_MERKMALE: readonly string[] = [];

/** Damit die Oberflaeche den Platzhalter als solchen ausweisen kann (K-17). */
export const IST_PLATZHALTER = true as const;
