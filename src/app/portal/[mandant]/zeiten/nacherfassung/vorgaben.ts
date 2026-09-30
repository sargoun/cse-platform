import { istKennung } from '../../../kennung';

/**
 * Was die freie Nacherfassung aus einem Einwand mitbringt — und was ihr
 * Rückweg davon weiterträgt (V-275 Nachtrag, D-773, D-769).
 *
 * **Der Befund.** Aus einem anerkannten Einwand „Eintrag fehlt ganz" führt der
 * Link `?anstellung=<Kennung>&einwand=<Kennung>` hierher: die Person ist
 * vorbelegt, der Einwand hängt als verstecktes Feld am Formular. Wies die
 * Route ab, ging es auf `?frei=1&fehler=<grund>` zurück — und beides war
 * weg: die Auswahl stand wieder auf „Person wählen", und ein zweiter Versuch
 * legte den Eintrag an, ohne dass der Einwand davon erfuhr (seine
 * Entscheidungsbegründung nennt den neuen Eintrag nur, wenn `einwand`
 * mitkommt, V-067).
 *
 * **Nur Kennungen, nie Freitext.** Mit zurück reisen genau die zwei Werte,
 * die die Seite aus ihrer Adresse liest, und nur, wenn sie die Form einer
 * Kennung haben (`istKennung`). Alles andere in `?anstellung=` oder
 * `?einwand=` fällt weg, bevor es vorbelegt, versteckt mitgeschickt oder
 * weitergetragen wird — die Zeiten und die Begründung ohnehin: eine
 * vorbelegte Behauptung wäre von einer Entscheidung nicht mehr zu
 * unterscheiden.
 *
 * Diese Datei liegt neben der Seite und nicht in ihr, damit sich ihre
 * Antworten ohne Datenbank prüfen lassen
 * (`tests/kern/rueckweg-zeit-nacherfassung.test.ts`).
 */

type Suche = Readonly<Record<string, string | string[] | undefined>>;

/** Die zwei Vorgaben aus der Adresse — jede eine geprüfte Kennung oder `null`. */
export interface FreieVorgaben {
  readonly anstellung: string | null;
  readonly einwand: string | null;
}

export function freieVorgaben(frage: Suche): FreieVorgaben {
  const kennung = (name: string): string | null => {
    const wert = frage[name];
    return typeof wert === 'string' && istKennung(wert) ? wert : null;
  };
  return { anstellung: kennung('anstellung'), einwand: kennung('einwand') };
}

/**
 * Das `zurueck` des freien Formulars: `?frei=1`, dazu die geprüften
 * Kennungen. Die Route hängt nur `&fehler=<grund>` an (`grundAufsFormular`).
 */
export function freiesZurueck(pfad: string, vorgaben: FreieVorgaben): string {
  const suche = new URLSearchParams({ frei: '1' });
  if (vorgaben.anstellung !== null) suche.set('anstellung', vorgaben.anstellung);
  if (vorgaben.einwand !== null) suche.set('einwand', vorgaben.einwand);
  return `${pfad}?${suche.toString()}`;
}

/**
 * Welche Beschäftigung die Auswahl vorbelegt: die Vorgabe nur, wenn die
 * Liste sie anbietet — sonst keine (`''`, „Person wählen").
 *
 * Eine Auswahl, deren Vorgabe keine ihrer Zeilen ist, zeigt im Browser die
 * ERSTE wählbare Zeile: die Person, die im Alphabet vorn steht, vorbelegt,
 * ohne dass jemand sie gewählt hat — etwa, wenn die Beschäftigung aus dem
 * Einwand inzwischen nicht mehr aktiv ist.
 */
export function vorbelegteAnstellung(
  vorgaben: FreieVorgaben, anstellungen: readonly { readonly id: string }[],
): string {
  const gewuenscht = vorgaben.anstellung;
  return gewuenscht !== null && anstellungen.some((a) => a.id === gewuenscht) ? gewuenscht : '';
}
