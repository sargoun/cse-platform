/**
 * Der Feiertagskalender auf den Planungsseiten — in beiden Sprachen
 * (V-178, CLN-03, TIM-02, D-592).
 *
 * **Warum es diese Sätze gibt.** Die Vorschau eines Turnus und der Generator
 * lesen die Feiertage aus der Tabelle `feiertag`. Fehlt dort ein Jahr, fällt
 * in diesem Jahr KEIN Termin wegen eines Feiertags aus, und die Vorschau sieht
 * genauso aus wie eine Vorschau ohne Feiertage im Fenster. Der Unterschied
 * gehört auf den Bildschirm, bevor jemand eine Serie anlegt.
 *
 * **Fachbegriffe bleiben deutsch**, auch im englischen Text: `Turnus`,
 * `Feiertagsregel` tragen die Bedeutung aus Vertrag und Plan.
 */
import type { InternSprache } from '../intern.js';

export interface FeiertagTexte {
  /** Die Überschrift des Hinweises. */
  readonly kalenderFehltTitel: string;
  /** Der Satz dazu — mit Bundesland und Jahren. */
  readonly kalenderFehlt: (bundesland: string, jahre: readonly number[]) => string;
}

function liste(jahre: readonly number[], und: string): string {
  const texte = jahre.map((j) => String(j));
  if (texte.length <= 1) return texte.join('');
  return `${texte.slice(0, -1).join(', ')} ${und} ${texte[texte.length - 1] ?? ''}`;
}

export const FEIERTAG_TEXTE: Readonly<Record<InternSprache, FeiertagTexte>> = {
  de: {
    kalenderFehltTitel: 'Feiertagskalender nicht gepflegt',
    kalenderFehlt: (bundesland, jahre) =>
      `Für ${bundesland} ${liste(jahre, 'und')} steht kein Feiertag im Kalender. Die `
      + 'Vorschau und der Dienstplan kennen dort keinen Feiertag — ein Turnus, der an '
      + 'Feiertagen ausfällt, fiele dort nicht aus. Die Berliner Feiertage trägt der '
      + 'nächtliche Kalenderlauf ein; andere Bundesländer rechnet die Plattform noch '
      + 'nicht (O-167).',
  },
  en: {
    kalenderFehltTitel: 'Holiday calendar not maintained',
    kalenderFehlt: (bundesland, jahre) =>
      `No public holiday is recorded for ${bundesland} ${liste(jahre, 'and')}. The `
      + 'preview and the Dienstplan know no holiday there — a Turnus that is skipped on '
      + 'public holidays would not be skipped. The nightly calendar run records the '
      + 'Berlin holidays; the platform does not yet compute other federal states '
      + '(O-167).',
  },
};
