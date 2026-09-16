/**
 * **Zwei verschiedene Augenblicke duerfen nicht gleich aussehen.**
 *
 * In der Nacht der Rueckstellung gibt es `02:30` Berliner Ortszeit ZWEIMAL:
 * einmal in der Sommerzeit (MESZ, UTC+2) und eine Stunde spaeter noch einmal
 * in der Winterzeit (MEZ, UTC+1). Invariante 2 haelt beide als verschiedene
 * UTC-Augenblicke auseinander — die Anzeige tat es nicht.
 *
 * `berlinZeit` versprach im Kommentar ausdruecklich, die Zone zu nennen, und
 * gab mit `timeStyle: 'short'` nur die Wanduhr aus. In der Gespraechsliste
 * standen damit zwei Termine mit demselben Text; wer zum falschen erscheint,
 * hat kein Anzeigeproblem, sondern ein verpasstes Vorstellungsgespraech.
 * Gemeldet von der Copilot-Runde auf PR 16 (D-583).
 *
 * Eine Zusage im Kommentar, die keine Pruefung haelt, wird still falsch —
 * dieselbe Lehre wie D-580. Also steht sie hier.
 */
import { describe, expect, it } from 'vitest';
import { berlinZeit, berlinDatum } from
  '../../src/app/portal/[mandant]/recruiting/marken.js';

/** Die beiden `02:30` der Nacht vom 25. Oktober 2026. */
const SOMMER = new Date('2026-10-25T00:30:00Z');
const WINTER = new Date('2026-10-25T01:30:00Z');

describe('berlinZeit nennt die Zone (Invariante 2)', () => {
  it('die beiden 02:30 der Rueckstellungsnacht sehen verschieden aus', () => {
    expect(berlinZeit(SOMMER)).not.toBe(berlinZeit(WINTER));
  });

  it('und beide tragen dieselbe Wanduhr — der Unterschied IST die Zone', () => {
    expect(berlinZeit(SOMMER)).toContain('02:30');
    expect(berlinZeit(WINTER)).toContain('02:30');
    expect(berlinZeit(SOMMER)).toContain('MESZ');
    expect(berlinZeit(WINTER)).toContain('MEZ');
  });

  it('die Vorstellungnacht ebenso — 02:30 gibt es dort gar nicht', () => {
    /*
     * Am 29. Maerz 2026 springt die Uhr von 02:00 auf 03:00. `00:30 UTC` ist
     * `01:30 MEZ`, `01:30 UTC` ist `03:30 MESZ` — zwischen beiden liegt eine
     * Stunde, die auf keiner Berliner Uhr steht.
     */
    expect(berlinZeit(new Date('2026-03-29T00:30:00Z'))).toContain('01:30');
    expect(berlinZeit(new Date('2026-03-29T01:30:00Z'))).toContain('03:30');
  });

  it('der Kalendertag bleibt der Berliner — 23:30 UTC ist schon morgen', () => {
    expect(berlinDatum(new Date('2026-07-14T23:30:00Z'))).toContain('15.');
  });
});
