/**
 * Die Bauabzugsteuer-Anmeldung nach § 48a EStG, vorbereitet (V-315, O-187,
 * D-847) — was ohne Datenbank entschieden wird.
 *
 * Was die Datenbank hält — welche Zahlungen zählen (Richtung, Storno, Art der
 * Zuordnung), die Rechte, die Frist im Kalender —, steht in
 * `tests/isolation/bauabzug-anmeldung.test.ts` und `tests/isolation/kalender.test.ts`.
 * Hier:
 *
 *  1. Die Frist: der 10. des Folgemonats, an einem Wochenende oder Feiertag
 *     der nächste Werktag (§ 108 Abs. 3 AO).
 *  2. Der Einbehalt je Zahlung: anteilig, kumuliert gerundet — die Anteile
 *     ergeben genau den Einbehalt, und Überzahlung trägt nichts.
 *  3. Die Monatssummen je Lieferant und was noch keinem Monat zugeordnet ist.
 *  4. Die Wörter und die Verdrahtung.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  anmeldungsFrist, einbehaltJeZahlung, monatsEinbehalte, type EinbehaltBeleg,
} from '../../src/server/services/finanz/estg48/anmeldung.js';
import { BAUABZUG_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/bauabzug.js';

describe('die Frist der Anmeldung (§ 48a EStG, § 108 Abs. 3 AO)', () => {
  it('der 10. des Folgemonats, wenn er ein Werktag ist', () => {
    expect(anmeldungsFrist('2026-10')).toBe('2026-11-10');   // Dienstag
    expect(anmeldungsFrist('2026-07')).toBe('2026-08-10');   // Montag
  });

  it('Sonnabend und Sonntag schieben auf den Montag', () => {
    expect(anmeldungsFrist('2026-09')).toBe('2026-10-12');   // 10.10. ist ein Sonnabend
    expect(anmeldungsFrist('2026-04')).toBe('2026-05-11');   // 10.05. ist ein Sonntag
  });

  it('ein Feiertag schiebt weiter — Ostermontag 2023', () => {
    expect(anmeldungsFrist('2023-03')).toBe('2023-04-11');
  });

  it('über den Jahreswechsel, und falsche Monate werfen', () => {
    expect(anmeldungsFrist('2026-12')).toBe('2027-01-11');   // 10.01.2027 ist ein Sonntag
    expect(() => anmeldungsFrist('2026-13')).toThrow(RangeError);
    expect(() => anmeldungsFrist('2026-1')).toThrow(RangeError);
  });
});

describe('der Einbehalt je Zahlung', () => {
  it('eine volle Zahlung trägt den ganzen Einbehalt', () => {
    expect(einbehaltJeZahlung(150_000n, 850_000n, [{ tag: '2026-08-14', betragCent: 850_000n }]))
      .toEqual([{ tag: '2026-08-14', anteilCent: 150_000n }]);
  });

  it('zwei Raten in zwei Monaten: anteilig, zusammen genau der Einbehalt', () => {
    const anteile = einbehaltJeZahlung(150_000n, 850_000n, [
      { tag: '2026-09-02', betragCent: 425_000n },
      { tag: '2026-08-20', betragCent: 425_000n },
    ]);
    expect(anteile).toEqual([
      { tag: '2026-08-20', anteilCent: 75_000n },
      { tag: '2026-09-02', anteilCent: 75_000n },
    ]);
  });

  it('kumuliert gerundet: drei Drittel ergeben 33 + 34 + 33, nicht 99', () => {
    const anteile = einbehaltJeZahlung(100n, 3n, [
      { tag: '2026-01-05', betragCent: 1n },
      { tag: '2026-02-05', betragCent: 1n },
      { tag: '2026-03-05', betragCent: 1n },
    ]);
    expect(anteile.map((a) => a.anteilCent)).toEqual([33n, 34n, 33n]);
    expect(anteile.reduce((s, a) => s + a.anteilCent, 0n)).toBe(100n);
  });

  it('was über den Posten hinaus gezahlt wird, trägt nichts', () => {
    const anteile = einbehaltJeZahlung(150_000n, 850_000n, [
      { tag: '2026-08-14', betragCent: 850_000n },
      { tag: '2026-08-20', betragCent: 10_000n },
    ]);
    expect(anteile.map((a) => a.anteilCent)).toEqual([150_000n, 0n]);
  });

  it('eine Teilzahlung lässt den Rest offen', () => {
    const [a] = einbehaltJeZahlung(150_000n, 850_000n, [{ tag: '2026-08-14', betragCent: 85_000n }]);
    expect(a?.anteilCent).toBe(15_000n);
  });
});

describe('die Monatssummen', () => {
  const beleg = (mehr: Partial<EinbehaltBeleg>): EinbehaltBeleg => ({
    rechnungId: 'r1', beleg: 'EB-2026-00001', lieferantId: 'l1', lieferant: 'Gerüstbau Nord GmbH',
    steuernummer: '27/123/45678', einbehaltCent: 150_000n, postenCent: 850_000n,
    zahlungen: [{ tag: '2026-08-14', betragCent: 850_000n }], ...mehr,
  });

  it('je Lieferant und Monat der Zahlung, mit Frist und Zahl der Rechnungen', () => {
    const { zeilen, offen } = monatsEinbehalte([
      beleg({}),
      beleg({ rechnungId: 'r2', beleg: 'EB-2026-00002', einbehaltCent: 30_000n, postenCent: 170_000n,
        zahlungen: [{ tag: '2026-08-30', betragCent: 170_000n }] }),
      beleg({ rechnungId: 'r3', lieferantId: 'l2', lieferant: 'Abbruch Süd GmbH', steuernummer: null,
        zahlungen: [{ tag: '2026-09-01', betragCent: 850_000n }] }),
    ]);
    expect(offen).toEqual([]);
    expect(zeilen).toEqual([
      { monat: '2026-09', lieferantId: 'l2', lieferant: 'Abbruch Süd GmbH', steuernummer: null,
        einbehaltCent: 150_000n, rechnungen: 1, frist: '2026-10-12' },
      { monat: '2026-08', lieferantId: 'l1', lieferant: 'Gerüstbau Nord GmbH',
        steuernummer: '27/123/45678', einbehaltCent: 180_000n, rechnungen: 2, frist: '2026-09-10' },
    ]);
  });

  it('was noch keiner Zahlung zugeordnet ist, steht als offen da — geraten wird es nicht', () => {
    const { zeilen, offen } = monatsEinbehalte([
      beleg({ zahlungen: [{ tag: '2026-08-14', betragCent: 425_000n }] }),
      beleg({ rechnungId: 'r2', beleg: 'EB-2026-00002', postenCent: null, zahlungen: [] }),
    ]);
    expect(zeilen.map((z) => z.einbehaltCent)).toEqual([75_000n]);
    expect(offen).toEqual([
      { rechnungId: 'r1', beleg: 'EB-2026-00001', lieferant: 'Gerüstbau Nord GmbH', offenCent: 75_000n },
      { rechnungId: 'r2', beleg: 'EB-2026-00002', lieferant: 'Gerüstbau Nord GmbH', offenCent: 150_000n },
    ]);
  });
});

describe('Wörter und Verdrahtung', () => {
  it('die Voreinstellung nennt O-187, ELSTER ist nicht verbunden — in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = BAUABZUG_TEXTE[sprache];
      expect(t.voreinstellung).toContain('O-187');
      expect(t.elster).toContain('ELSTER');
      expect(t.einleitung).toContain('§ 48a EStG');
    }
    expect(readFileSync('src/server/services/finanz/estg48/anmeldung.ts', 'utf8'))
      .toContain('// TODO(client, O-187): Voreinstellung');
  });

  it('der Kalender nennt dieselbe Frist — aus derselben Funktion', () => {
    const kalender = readFileSync('src/server/services/kalender/eintraege.ts', 'utf8');
    expect(kalender).toContain("import { anmeldungsFrist } from '../finanz/estg48/anmeldung.js';");
    expect(kalender).toContain("quelle: 'bauabzug'");
    expect(readFileSync('src/app/portal/[mandant]/kalender/page.tsx', 'utf8')).toContain("'bauabzug'");
  });
});
