import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KlaerungGrund } from '../../src/server/services/finanz/bank/import.js';
import type { ZahlungFehler } from '../../src/server/services/finanz/zahlung/index.js';
import { KONTOAUSZUG_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/kontoauszug.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

/**
 * **Das Kontoauszugsblatt spricht zwei Sprachen, und jede Abweisung der
 * Klärung hat ihren Satz** (V-217, D-710; Prüfung von V-216).
 *
 * Vorher war das Blatt ganz deutsch, auch die mit V-216 neue Maske für den
 * Ausgang, und `/api/buchhaltung/bank/umsatz` schickte bei einer Abweisung
 * den deutschen Satz des Dienstes als `?meldung=` — das Blatt zeigte ihn,
 * wie er in der Adresse stand. Jetzt reist nur der Grund; das Blatt schlägt
 * den Satz nach und fällt für einen unbekannten Grund auf `fehlerSonst`.
 *
 * Die Gründe stehen als `Record` über die Vereinigungen: kommt an
 * `ImportFehler` (Klärung) oder `ZahlungFehler` ein Grund dazu, meldet der
 * Übersetzer die Lücke hier.
 */
const KLAERUNG: Readonly<Record<KlaerungGrund, true>> = {
  umsatz_fehlt: true,
  schon_entschieden: true,
  vormerkung: true,
  nur_eingang: true,
  posten_nicht_offen: true,
  verbindlichkeit_nicht_offen: true,
  begruendung_fehlt: true,
};

const ZAHLUNG: Readonly<Record<ZahlungFehler['grund'], true>> = {
  nicht_gefunden: true,
  kein_posten: true,
  schon_ausgeglichen: true,
  storniert: true,
  abgewiesen: true,
  betrag_nicht_positiv: true,
  bankkonto_fremd: true,
};

/** Was die Route selbst vergibt, bevor ein Dienst läuft. */
const ROUTE = ['posten_waehlen'] as const;

const ALLE = [
  ...Object.keys(KLAERUNG),
  ...Object.keys(ZAHLUNG).map((g) => `zahlung_${g}`),
  ...ROUTE,
];

describe('Kontoauszug: jeder Grund der Klärung hat einen Satz in beiden Sprachen', () => {
  for (const sprache of ['de', 'en'] as const) {
    const t = KONTOAUSZUG_TEXTE[sprache];

    it(`${sprache}: kein Grund fällt auf den allgemeinen Satz`, () => {
      expect(ALLE.filter((g) => eigenerEintrag(t.fehler, g) === undefined)).toEqual([]);
    });

    it(`${sprache}: kein Satz steht für einen Grund, den es nicht gibt`, () => {
      expect(Object.keys(t.fehler).filter((g) => !ALLE.includes(g))).toEqual([]);
    });

    it(`${sprache}: ein unbekannter Schlüssel wird nicht nachgeschlagen`, () => {
      for (const roh of ['constructor', '__proto__', 'toString', 'Bitte zahlen Sie an DE00…']) {
        expect(eigenerEintrag(t.fehler, roh)).toBeUndefined();
        expect(eigenerEintrag(t.meldungen, roh)).toBeUndefined();
      }
    });
  }

  it('die englischen Sätze sind andere als die deutschen', () => {
    const de = KONTOAUSZUG_TEXTE.de;
    const en = KONTOAUSZUG_TEXTE.en;
    expect(ALLE.filter((g) => de.fehler[g] === en.fehler[g])).toEqual([]);
    expect(de.probeFehlt('1', '2', '3', '4')).not.toBe(en.probeFehlt('1', '2', '3', '4'));
    expect(en.wartend(1)).toMatch(/^1 line is /u);
    expect(en.wartend(3)).toMatch(/^3 lines are /u);
    expect(de.wartend(1)).toMatch(/^1 Zeile wartet /u);
  });
});

describe('Route und Blatt: Schlüssel statt Satz in der Adresse', () => {
  const wurzel = join(import.meta.dirname, '..', '..');
  const route = readFileSync(join(wurzel, 'src/app/api/buchhaltung/bank/umsatz/route.ts'), 'utf8');
  const blatt = readFileSync(
    join(wurzel, 'src/app/portal/[mandant]/buchhaltung/bank/[auszugId]/page.tsx'), 'utf8');

  it('die Route schickt keinen Satz des Dienstes mehr als ?meldung=', () => {
    expect(route).not.toMatch(/meldung:\s*fehler\.message/u);
    expect(route).toMatch(/fehler:\s*fehler\.grund/u);
    expect(route).toMatch(/fehler:\s*`zahlung_\$\{fehler\.grund\}`/u);
  });

  it('das Blatt schlägt Meldung und Fehler über eigenerEintrag nach und zeigt nie den Rohwert', () => {
    expect(blatt).toMatch(/eigenerEintrag\(t\.meldungen, suche\['meldung'\]\)/u);
    expect(blatt).toMatch(/eigenerEintrag\(t\.fehler, fehler\) \?\? t\.fehlerSonst/u);
    expect(blatt).not.toMatch(/\?\? meldung\}/u);
  });

  it('Tage und Beträge in der Sprache der Sitzung', () => {
    expect(blatt).not.toMatch(/\bformatiereGeld\(/u);
    expect(blatt).not.toMatch(/\btagDeutsch\(/u);
    expect(blatt).not.toMatch(/\{z\.buchungsdatum\}/u);
  });
});
