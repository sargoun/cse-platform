/**
 * Der Alarm eines gescheiterten Laufs nach draussen (V-374, O-354, D-823).
 *
 * Ohne Datenbank: das Betriebspostfach kommt aus der Umgebung und muss eine
 * Adresse sein; gesendet wird nur über einen VERBUNDENEN Postausgang und an
 * eine eingetragene Adresse — sonst nichts, und die Auskunft sagt, warum;
 * ein Fehler beim Senden fällt nicht auf den Lauf zurück, und ein
 * scheiternder Empfänger hält die übrigen nicht auf. Die Route der Jobs
 * benutzt genau diesen Alarm.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MehrfachAlarm, PostfachAlarm, alarmFuerLauf, alarmKanal, betriebspostfach,
} from '../../src/server/jobs/alarm.js';
import {
  EntwicklungsEmailDienst, NichtVerbundenerEmailDienst, type EmailAuftrag, type EmailDienst,
} from '../../src/server/versand/email.js';
import type { Alarm } from '../../src/server/jobs/runner.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/** Ein Postausgang, der WIRKLICH verbunden wäre — hier nur zum Mitschreiben. */
class VerbundenerProbedienst implements EmailDienst {
  readonly verbunden = true;
  readonly zeigtInhalt = false;
  readonly name = 'Probe-Postausgang';
  readonly gesendet: EmailAuftrag[] = [];
  scheitert = false;
  sende(auftrag: EmailAuftrag): Promise<void> {
    if (this.scheitert) return Promise.reject(new Error('Anbieter antwortet nicht'));
    this.gesendet.push(auftrag);
    return Promise.resolve();
  }
}

let fehlerZeilen: string[] = [];
beforeEach(() => {
  fehlerZeilen = [];
  vi.spyOn(console, 'error').mockImplementation((z: unknown) => { fehlerZeilen.push(String(z)); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('V-374 — das Betriebspostfach', () => {
  it('kommt aus CSE_ALARM_POSTFACH und muss eine Adresse sein', () => {
    expect(betriebspostfach({ CSE_ALARM_POSTFACH: ' betrieb@cse-gruppe.de ' })).toBe('betrieb@cse-gruppe.de');
    for (const falsch of ['', ' ', 'betrieb', 'a@b', 'zwei@@x.de', 'a b@x.de']) {
      expect(betriebspostfach({ CSE_ALARM_POSTFACH: falsch }), falsch).toBeNull();
    }
    expect(betriebspostfach({})).toBeNull();
  });

  it('.env.example führt den Schalter, leer', () => {
    expect(readFileSync(join(WURZEL, '.env.example'), 'utf8')).toMatch(/^CSE_ALARM_POSTFACH=$/mu);
  });
});

describe('V-374 — gesendet wird nur über einen verbundenen Postausgang', () => {
  it('ohne Postausgang: nicht verbunden, kein Versand — auch nicht der Entwicklungsdienst', async () => {
    for (const dienst of [new NichtVerbundenerEmailDienst(), new EntwicklungsEmailDienst()]) {
      expect(alarmKanal(dienst, 'betrieb@cse-gruppe.de'))
        .toEqual({ verbunden: false, grund: 'kein_postausgang' });
      await expect(new PostfachAlarm(dienst, 'betrieb@cse-gruppe.de')
        .melde('kette_pruefen', 'l-1', 'Bruch', 1)).resolves.toBeUndefined();
    }
    expect(fehlerZeilen).toEqual([]);
  });

  it('ohne Betriebspostfach: nicht verbunden, kein Versand', async () => {
    const dienst = new VerbundenerProbedienst();
    expect(alarmKanal(dienst, null)).toEqual({ verbunden: false, grund: 'kein_postfach' });
    await new PostfachAlarm(dienst, null).melde('kette_pruefen', 'l-1', 'Bruch', 1);
    expect(dienst.gesendet).toEqual([]);
  });

  it('mit beidem: eine E-Mail an das Postfach, mit Lauf, Versuchen und Fehler', async () => {
    const dienst = new VerbundenerProbedienst();
    expect(alarmKanal(dienst, 'betrieb@cse-gruppe.de'))
      .toEqual({ verbunden: true, an: 'betrieb@cse-gruppe.de', dienst: 'Probe-Postausgang' });
    await new PostfachAlarm(dienst, 'betrieb@cse-gruppe.de')
      .melde('kette_pruefen', 'lauf-7', 'Kette gebrochen bei R-2026-0042', 2);
    expect(dienst.gesendet).toHaveLength(1);
    expect(dienst.gesendet[0]).toMatchObject({
      an: 'betrieb@cse-gruppe.de', betreff: 'Nachtlauf gescheitert: kette_pruefen',
    });
    expect(dienst.gesendet[0]!.text).toContain('lauf-7');
    expect(dienst.gesendet[0]!.text).toContain('2 Versuche');
    expect(dienst.gesendet[0]!.text).toContain('Kette gebrochen bei R-2026-0042');
  });

  it('ein Fehler beim Senden fällt nicht auf den Lauf zurück — er steht im Protokoll', async () => {
    const dienst = new VerbundenerProbedienst();
    dienst.scheitert = true;
    await expect(new PostfachAlarm(dienst, 'betrieb@cse-gruppe.de')
      .melde('kette_pruefen', 'l-1', 'Bruch', 1)).resolves.toBeUndefined();
    expect(fehlerZeilen.some((z) => z.includes('JOB-ALARM-POSTFACH'))).toBe(true);
  });
});

describe('V-374 — mehrere Empfänger', () => {
  it('ein scheiternder Empfänger hält die übrigen nicht auf', async () => {
    const erreicht: string[] = [];
    const kaputt: Alarm = { melde: () => Promise.reject(new Error('kaputt')) };
    const gut: Alarm = { melde: (job) => { erreicht.push(job); return Promise.resolve(); } };
    await new MehrfachAlarm(kaputt, gut).melde('radar_einlesen', 'l-2', 'Zeitüberschreitung', 3);
    expect(erreicht).toEqual(['radar_einlesen']);
    expect(fehlerZeilen.some((z) => z.includes('JOB-ALARM-EMPFAENGER'))).toBe(true);
  });

  it('der Alarm eines Laufs schreibt immer ins Funktionsprotokoll — auch ohne Postausgang', async () => {
    await alarmFuerLauf(new NichtVerbundenerEmailDienst(), null)
      .melde('social_plan', 'l-3', 'Fehler', 1);
    expect(fehlerZeilen.some((z) => z.includes('"ereignis":"JOB-ALARM"'))).toBe(true);
  });

  it('die Route der Jobs benutzt genau diesen Alarm', () => {
    const route = readFileSync(join(WURZEL, 'src/app/api/jobs/[schluessel]/route.ts'), 'utf8');
    expect(route).toMatch(/alarmFuerLauf\(emailDienst\(devFlaechenAn\(\)\), betriebspostfach\(\)\)/u);
    expect(route).not.toMatch(/new ProtokollAlarm\(\)/u);
  });
});
