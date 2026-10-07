/**
 * Der Zeichnungsvermerk der Verfahrensdokumentation als reine Rechnung
 * (V-316, O-188, D-837).
 *
 * Was die Datenbank hält — Zeichner und Zeit aus der Sitzung, keine Änderung,
 * kein Löschen, Rechte —, steht in
 * `tests/isolation/verfahrensdokumentation-zeichnung.test.ts`. Hier:
 *
 *  1. `plusMonate` rechnet im Kalender: Monatsende und 29. Februar fallen auf
 *     den letzten Tag des Zielmonats, nie in den Folgemonat.
 *  2. `zeichnungsStand` ordnet die Gründe: ungezeichnet, Schemastand
 *     gewechselt, Turnus abgelaufen, Inhalt geändert, aktuell — der Prüftag
 *     selbst ist schon fällig.
 *  3. Die Route zeichnet, was SIE erzeugt — nach `authorize` mit zweitem
 *     Faktor; das Formular schickt keinen Hash.
 *  4. Die Wörter: jeder Grund hat einen Satz in beiden Sprachen, und die
 *     genannten Grenzen sind die des Dienstes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BEMERKUNG_HOECHSTENS, FUNKTION_HOECHSTENS, PRUEF_TURNUS_MONATE, plusMonate,
  zeichnungsStand, type ZeichnungFehlerGrund,
} from '../../src/server/services/buchhaltung/verfahrensdokumentation-zeichnung.js';
import { ZEICHNUNG_TEXTE } from '../../src/lib/i18n/verwaltung/verfahrensdokumentation-zeichnung.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('plusMonate — im Kalender, ohne Uhr', () => {
  it('derselbe Tag ein Jahr später', () => {
    expect(plusMonate('2026-10-07', 12)).toBe('2027-10-07');
    expect(plusMonate('2026-12-15', 1)).toBe('2027-01-15');
    expect(plusMonate('2026-01-15', 23)).toBe('2027-12-15');
  });

  it('gibt es den Tag nicht, ist es der letzte des Zielmonats — nie der Folgemonat', () => {
    expect(plusMonate('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonate('2028-01-31', 1)).toBe('2028-02-29');
    expect(plusMonate('2026-03-31', 1)).toBe('2026-04-30');
    // Der 29. Februar: ein Jahr später gibt es ihn nicht, vier Jahre später schon.
    expect(plusMonate('2028-02-29', 12)).toBe('2029-02-28');
    expect(plusMonate('2028-02-29', 48)).toBe('2032-02-29');
    // Hundertjahresregel: 2100 ist kein Schaltjahr, 2000 war eines.
    expect(plusMonate('2099-02-28', 12)).toBe('2100-02-28');
    expect(plusMonate('2096-02-29', 48)).toBe('2100-02-28');
    expect(plusMonate('1996-02-29', 48)).toBe('2000-02-29');
  });

  it('ein Wert, der kein Kalendertag ist, wirft', () => {
    expect(() => plusMonate('7.10.2026', 12)).toThrow(RangeError);
    expect(() => plusMonate('2026-10-07T00:00:00Z', 12)).toThrow(RangeError);
  });
});

describe('zeichnungsStand — die Gründe in ihrer Reihenfolge', () => {
  const aktuell = { sha256: HASH_A, schemastand: '0526_verfahrensdokumentation_zeichnung' };
  const gezeichnet = { ...aktuell, gezeichnetTag: '2026-03-10' };

  it('der Turnus ist die Voreinstellung (O-188): zwölf Monate', () => {
    expect(PRUEF_TURNUS_MONATE).toBe(12);
  });

  it('ohne Zeichnung: ungezeichnet', () => {
    expect(zeichnungsStand(null, aktuell, '2026-10-07')).toEqual({ art: 'ungezeichnet' });
  });

  it('dieselbe Fassung im Turnus: aktuell, mit dem nächsten Prüftag', () => {
    expect(zeichnungsStand(gezeichnet, aktuell, '2026-10-07'))
      .toEqual({ art: 'aktuell', faelligAm: '2027-03-10' });
  });

  it('der Prüftag selbst ist fällig, der Tag davor nicht', () => {
    expect(zeichnungsStand(gezeichnet, aktuell, '2027-03-09'))
      .toEqual({ art: 'aktuell', faelligAm: '2027-03-10' });
    expect(zeichnungsStand(gezeichnet, aktuell, '2027-03-10'))
      .toEqual({ art: 'turnus_abgelaufen', faelligSeit: '2027-03-10' });
    expect(zeichnungsStand(gezeichnet, aktuell, '2028-01-01'))
      .toEqual({ art: 'turnus_abgelaufen', faelligSeit: '2027-03-10' });
  });

  it('ein anderer Hash im selben Schemastand ist ein Hinweis, keine Fälligkeit', () => {
    expect(zeichnungsStand(gezeichnet, { ...aktuell, sha256: HASH_B }, '2026-10-07'))
      .toEqual({ art: 'inhalt_geaendert', faelligAm: '2027-03-10' });
  });

  it('ein neuer Schemastand verlangt die Prüfung, gleich wie jung die Zeichnung ist', () => {
    expect(zeichnungsStand(gezeichnet, { ...aktuell, schemastand: '0527_neu' }, '2026-03-11'))
      .toEqual({ art: 'schemastand_gewechselt', gezeichnet: '0526_verfahrensdokumentation_zeichnung' });
    // … und er geht dem abgelaufenen Turnus vor: er ist der stärkere Grund.
    expect(zeichnungsStand(gezeichnet, { ...aktuell, schemastand: '0527_neu' }, '2028-01-01'))
      .toEqual({ art: 'schemastand_gewechselt', gezeichnet: '0526_verfahrensdokumentation_zeichnung' });
  });

  it('ein Schemastand, der beim Zeichnen nicht ablesbar war, ist ein Wechsel, sobald er es ist', () => {
    expect(zeichnungsStand({ ...gezeichnet, schemastand: null }, aktuell, '2026-10-07'))
      .toEqual({ art: 'schemastand_gewechselt', gezeichnet: null });
    expect(zeichnungsStand({ ...gezeichnet, schemastand: null },
      { ...aktuell, schemastand: null }, '2026-10-07'))
      .toEqual({ art: 'aktuell', faelligAm: '2027-03-10' });
  });

  it('ein „heute", das kein Kalendertag ist, wirft — auch ohne Zeichnung', () => {
    expect(() => zeichnungsStand(null, aktuell, '07.10.2026')).toThrow(RangeError);
    expect(() => zeichnungsStand(gezeichnet, aktuell, '')).toThrow(RangeError);
  });
});

describe('die Route zeichnet, was sie selbst erzeugt', () => {
  const ROUTE = readFileSync(fileURLToPath(new URL(
    '../../src/app/api/buchhaltung/verfahrensdokumentation/zeichnung/route.ts', import.meta.url)), 'utf8');
  const FORMULAR = readFileSync(fileURLToPath(new URL(
    '../../src/app/portal/[mandant]/buchhaltung/verfahrensdokumentation/Zeichnungsvermerk.tsx',
    import.meta.url)), 'utf8');

  it('authorize mit dem Verwaltungsrecht und zweitem Faktor, VOR dem Erzeugen und Zeichnen', () => {
    const recht = ROUTE.indexOf(
      "{ recht: 'buchhaltung_konfiguration.verwalten', schreibend: true, erfordert2fa: true }");
    expect(recht, 'authorize ohne Recht oder ohne zweiten Faktor').toBeGreaterThan(-1);
    const erzeugt = ROUTE.indexOf('erstelleVerfahrensdokumentation(');
    const zeichnet = ROUTE.indexOf('zeichne(kontext, fassungVon(doku)');
    expect(erzeugt).toBeGreaterThan(recht);
    expect(zeichnet, 'gezeichnet wird die eben erzeugte Fassung').toBeGreaterThan(erzeugt);
  });

  it('aus dem Formular kommen nur Funktion und Bemerkung — kein Hash, kein Schemastand', () => {
    const felder = [...ROUTE.matchAll(/daten\.get\('([a-z_]+)'\)/gu)].map((m) => m[1]);
    expect(felder.sort()).toEqual(['bemerkung', 'funktion']);
    const namen = [...FORMULAR.matchAll(/\bname="([a-z_]+)"/gu)].map((m) => m[1]);
    expect(namen.sort()).toEqual(['bemerkung', 'funktion']);
  });
});

describe('die Wörter des Vermerks', () => {
  const GRUENDE: readonly (ZeichnungFehlerGrund | 'wirtschaftsjahr')[] =
    ['funktion_fehlt', 'funktion_zu_lang', 'bemerkung_zu_lang', 'wirtschaftsjahr'];

  it('jeder Grund der Route hat einen Satz — deutsch und englisch', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const g of GRUENDE) {
        expect(ZEICHNUNG_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
      }
      expect(Object.keys(ZEICHNUNG_TEXTE[sprache].fehler).sort()).toEqual([...GRUENDE].sort());
    }
  });

  it('die genannten Grenzen sind die des Dienstes', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(ZEICHNUNG_TEXTE[sprache].fehler['bemerkung_zu_lang'])
        .toContain(String(BEMERKUNG_HOECHSTENS));
      expect(ZEICHNUNG_TEXTE[sprache].fehler['funktion_zu_lang'])
        .toContain(String(FUNKTION_HOECHSTENS));
    }
  });

  it('der Stand nennt den Tag, den er bekommt', () => {
    expect(ZEICHNUNG_TEXTE.de.aktuell('10.03.2027')).toContain('10.03.2027');
    expect(ZEICHNUNG_TEXTE.en.turnusAbgelaufen('10 Mar 2027')).toContain('10 Mar 2027');
    expect(ZEICHNUNG_TEXTE.de.schemastandGewechselt('0526_x')).toContain('0526_x');
  });
});
