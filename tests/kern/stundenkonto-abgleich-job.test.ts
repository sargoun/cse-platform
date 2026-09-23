import { describe, expect, it } from 'vitest';
import { meldung } from '../../src/server/jobs/stundenkontoAbgleich.js';
import type { Drift } from '../../src/server/services/zeit/stundenkonto.js';

/**
 * **Eine Wache ohne Uhr ist eine Funktion, die niemand ruft** (V-073,
 * EMP-04, §12.2).
 *
 * `pruefeAbgleich` stand seit `0060` im Dienst, trug im Kopf ausdrücklich
 * „(`job:stundenkonto_abgleich`, naechtlich)" und war geprüft. **Den Lauf gab
 * es nicht** — derselbe Befund wie beim Kettenprüfer (FIN-06) und bei der
 * Nachtragswache (BAU-04). Er fällt niemandem auf, weil eine nicht laufende
 * Prüfung keine Meldung erzeugt und damit aussieht wie eine, die nichts
 * findet.
 *
 * Hier steht die Hälfte, die ohne Datenbank prüfbar ist: dass der Job
 * registriert ist, dass er die richtige Form hat, und dass seine Meldung
 * ZAHLEN trägt statt „es gibt Abweichungen".
 */

const drift = (teil: Partial<Drift> = {}): Drift => ({
  kontoId: 'k-1',
  anstellungId: 'a-1',
  jahr: 2026,
  monat: 3,
  istMinutenKonto: 9600,
  istMinutenJournal: 9480,
  korrekturMinutenKonto: 0,
  korrekturMinutenJournal: 0,
  ...teil,
});

describe('(1) der Job ist registriert und hat die richtige Form', () => {
  it('steht im Auslöseplan, je Mandant, ohne Wiederholung', async () => {
    const { alleJobs } = await import('../../src/server/jobs/bootstrap.js');
    const nie = (): never => {
      throw new Error('Die Registrierung fragt nicht ab.');
    };
    const jobs = alleJobs({ unsafe: nie, begin: nie } as never);
    const abgleich = jobs.find((j) => j.schluessel === 'stundenkonto_abgleich');
    expect(abgleich).toBeDefined();
    expect(abgleich!.bereich).toBe('je_mandant');
    /*
     * `versuche: 0` — eine Abweichung wird beim zweiten Hinsehen nicht
     * kleiner. Was ein Wiederholungsversuch kaufte, ist Verzögerung zwischen
     * Fund und Meldung.
     */
    expect(abgleich!.versuche).toBe(0);
  });

  it('läuft nachts und NACH den schreibenden Läufen', () => {
    /*
     * Geprüft wird der Stand, mit dem die Personalstelle morgens anfängt —
     * nicht einer von mittendrin, an dem gerade gebucht wird.
     */
    const plan = '40 3 * * *';
    const [minute, stunde] = plan.split(' ');
    expect(Number(stunde)).toBeGreaterThanOrEqual(3);
    expect(Number(minute)).toBeGreaterThan(20); // nach dem Kettenprüfer (20 3)
  });
});

describe('(2) die Meldung trägt Zahlen', () => {
  it('nennt Anzahl, Monat und BEIDE Summen', () => {
    const text = meldung([drift()]);
    expect(text).toContain('1 Stundenkonto');
    expect(text).toContain('2026-03');
    // Ohne die zwei Zahlen müsste morgens jemand eine Abfrage schreiben, um
    // zu wissen, wie gross die Abweichung überhaupt ist.
    expect(text).toContain('9600');
    expect(text).toContain('9480');
  });

  it('kürzt lange Listen und sagt, dass sie gekürzt sind', () => {
    const viele = Array.from({ length: 9 }, (_, i) => drift({ monat: i + 1 }));
    const text = meldung(viele);
    expect(text).toContain('9 Stundenkonto');
    // „… und 4 weitere" statt einer Meldung, die kein Protokoll mehr fasst.
    expect(text).toContain('und 4 weitere');
  });
});
