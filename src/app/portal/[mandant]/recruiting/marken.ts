import type { PillZustand } from '@/components/ui/StatusPill';
import type { BewerbungStatus } from '@/server/services/recruiting/dienst';

/**
 * Die sechs Zustände einer Bewerbung auf die MARKEN aus DESIGN §5.
 *
 * Der Satz der Marken ist geschlossen; eine siebte zu erfinden hiesse, eine
 * Farbe zu erfinden (DESIGN §5). Die Zuordnung ist deshalb eine Übersetzung
 * und keine Erweiterung — und sie steht an EINER Stelle, weil fünf Seiten sie
 * brauchen und fünf Abschriften fünf Gelegenheiten wären, sie verschieden zu
 * treffen.
 */
export const BEWERBUNG_MARKE: Readonly<Record<BewerbungStatus, PillZustand>> = {
  eingegangen: 'Offen',
  in_pruefung: 'In Prüfung',
  gespraech: 'In Arbeit',
  eingestellt: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
};

/** Dasselbe im Klartext — für Fliesstext, wo keine Marke steht. */
export const BEWERBUNG_TEXT: Readonly<Record<BewerbungStatus, string>> = {
  eingegangen: 'Eingegangen',
  in_pruefung: 'In Prüfung',
  gespraech: 'Im Gespräch',
  eingestellt: 'Eingestellt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};

export const GESPRAECH_MARKE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  stattgefunden: 'Abgeschlossen',
  abgesagt: 'Abgelehnt',
  verschoben: 'Wartet',
};

/**
 * Berliner Ortszeit, ausgeschrieben — und die Zone steht dabei.
 *
 * Ein Gesprächstermin ohne Zonenangabe ist im Oktober zweideutig: zwischen
 * 02:00 und 03:00 gibt es die Stunde zweimal (Invariante 2). Wer zum falschen
 * Termin erscheint, hat kein Anzeigeproblem.
 *
 * **Der Absatz darüber stimmte, der Code nicht.** `timeStyle: 'short'` gibt
 * die Wanduhr und keine Zone; die beiden `02:30` der Umstellungsnacht sahen
 * in der Gesprächsliste gleich aus — genau der Fall, den der Absatz
 * beschreibt. Eine Zusage im Kommentar, die keine Prüfung hält, wird still
 * falsch (dieselbe Lehre wie D-580). `timeZoneName: 'short'` schreibt MEZ
 * oder MESZ dazu, und `zeit-anzeige.test.ts` hält beide Stunden auseinander.
 *
 * `dateStyle`/`timeStyle` vertragen `timeZoneName` nicht — deshalb stehen die
 * Felder hier einzeln; das Ergebnis ist dasselbe Format, das `de-DE` auch
 * vorher lieferte.
 */
export function berlinZeit(wert: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin', timeZoneName: 'short',
  }).format(wert);
}

export function berlinDatum(wert: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeZone: 'Europe/Berlin',
  }).format(wert);
}
