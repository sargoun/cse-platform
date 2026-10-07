/**
 * Die Herausnahme einer veröffentlichten Referenz nach dem Widerruf der
 * Kundenfreigabe — die reine Rechnung und die Wörter (V-287, O-735, D-780,
 * D-841).
 *
 * Was die Datenbank hält — die Aufgabe entsteht in der Transaktion des
 * Widerrufs, nur für eine veröffentlichte Referenz, auch ohne Aufgabenrecht,
 * nur einmal offen —, steht in `tests/isolation/referenz-herausnahme.test.ts`.
 * Hier:
 *
 *  1. `werktageNach` zählt Berliner Arbeitstage vorwärts: Wochenende und
 *     gesetzliche Feiertage zählen nicht, der Ausgangstag auch nicht.
 *  2. Die Frist ist die Voreinstellung (O-735): fünf Arbeitstage.
 *  3. Titel und Beschreibung der Aufgabe nennen Referenz, Auftrag, Tag und
 *     den Knopf, der die Referenz wirklich zurückzieht.
 *  4. Die Seiten sagen, was geschieht — nicht mehr „entsteht noch nicht von
 *     selbst" und nicht mehr „beim Auftraggeber angefragt".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { werktageNach, werktageVor } from '../../src/lib/datum/werktage.js';
import {
  HERAUSNAHME_QUELLE, HERAUSNAHME_WERKTAGE, herausnahmeFrist, herausnahmeText,
} from '../../src/server/services/auftrag/kundenfreigabe.js';
import { WEBSITE_REFERENZ_TEXTE } from '../../src/lib/i18n/verwaltung/website-referenz.js';

describe('werktageNach — Berliner Arbeitstage vorwärts', () => {
  it('fünf Arbeitstage nach einem Mittwoch ist der Mittwoch darauf', () => {
    expect(werktageNach('2026-10-07', 5)).toBe('2026-10-14');
    expect(werktageNach('2026-10-09', 5)).toBe('2026-10-16'); // Freitag → Freitag
  });

  it('nach einem Samstag oder Sonntag beginnt die Zählung am Montag', () => {
    expect(werktageNach('2026-10-10', 5)).toBe('2026-10-16');
    expect(werktageNach('2026-10-11', 1)).toBe('2026-10-12');
  });

  it('über Ostern zählen Karfreitag und Ostermontag nicht', () => {
    expect(werktageNach('2026-04-02', 5)).toBe('2026-04-13');
  });

  it('über Weihnachten: Heiligabend und Silvester zählen, die Feiertage nicht', () => {
    expect(werktageNach('2026-12-23', 5)).toBe('2026-12-31');
    expect(werktageNach('2026-12-31', 1)).toBe('2027-01-04');
  });

  it('der Frauentag ist in Berlin ein Feiertag', () => {
    expect(werktageNach('2027-03-05', 5)).toBe('2027-03-15');
  });

  it('vor und nach heben sich für einen Arbeitstag auf', () => {
    for (const tag of ['2026-10-07', '2026-12-23', '2026-04-02', '2027-03-05']) {
      expect(werktageVor(werktageNach(tag, 5), 5), tag).toBe(tag);
    }
  });

  it('null Arbeitstage ist der Tag selbst; eine falsche Eingabe wirft', () => {
    expect(werktageNach('2026-10-07', 0)).toBe('2026-10-07');
    expect(() => werktageNach('7.10.2026', 5)).toThrow(RangeError);
    expect(() => werktageNach('2026-02-30', 5)).toThrow(RangeError);
    expect(() => werktageNach('2026-10-07', -1)).toThrow(RangeError);
    expect(() => werktageNach('2026-10-07', 2.5)).toThrow(RangeError);
  });
});

describe('die Frist der Herausnahme (O-735)', () => {
  it('ist die Voreinstellung: fünf Arbeitstage nach dem Tag des Widerrufs', () => {
    expect(HERAUSNAHME_WERKTAGE).toBe(5);
    expect(herausnahmeFrist('2026-10-07')).toBe('2026-10-14');
    expect(herausnahmeFrist('2026-12-23')).toBe('2026-12-31');
  });

  it('der Doppelungsschlüssel ist der, den die Policy aus 0528 zulässt', () => {
    expect(HERAUSNAHME_QUELLE).toBe('ereignis:referenz_widerruf');
    const MIGRATION = readFileSync('drizzle/0528_referenz_herausnahme_aufgabe.sql', 'utf8');
    expect(MIGRATION).toContain(`quelle_job = '${HERAUSNAHME_QUELLE}'`);
    expect(MIGRATION).toContain(`'ereignis', '${HERAUSNAHME_QUELLE}', v_konto`);
  });
});

describe('die Wörter der Aufgabe', () => {
  const text = herausnahmeText('Grundreinigung Ärztehaus Süd', 'AU-2026-0012', '2026-10-14');

  it('der Titel sagt, was zu tun ist, und an welcher Referenz', () => {
    expect(text.titel).toBe('Referenz herausnehmen: Grundreinigung Ärztehaus Süd');
  });

  it('die Beschreibung nennt Auftrag, Tag, Knopf und Voreinstellung', () => {
    expect(text.beschreibung).toContain('AU-2026-0012');
    expect(text.beschreibung).toContain('14.10.2026');
    expect(text.beschreibung)
      .toContain(`„${WEBSITE_REFERENZ_TEXTE.de.vTitelZurueckziehen}"`);
    expect(text.beschreibung).toContain('Voreinstellung O-735');
    expect(text.beschreibung).toContain('gelöscht wird nichts');
  });
});

describe('die Seiten sagen, was geschieht', () => {
  const SEITE = readFileSync(
    'src/app/portal/[mandant]/auftraege/[id]/kundenfreigabe/page.tsx', 'utf8');
  const DIENST = readFileSync('src/server/services/auftrag/kundenfreigabe.ts', 'utf8');

  it('die Kundenfreigabe am Auftrag zeigt die Aufgaben und verspricht nichts Altes', () => {
    expect(SEITE).not.toContain('noch nicht von selbst');
    expect(SEITE).toContain('data-cse="herausnahme-aufgaben"');
    expect(SEITE).toContain('ladeHerausnahmeAufgaben(kontext, id)');
  });

  it('der Dienst schreibt die Aufgabe nur über die Funktion aus 0528', () => {
    expect(DIENST).not.toMatch(/insert\s+into\s+aufgabe/u);
    expect(DIENST).toContain('app.referenz_herausnahme_aufgabe(');
    expect(DIENST).toContain('// TODO(client, O-735): Voreinstellung');
  });

  it('das Referenzblatt nennt die Voreinstellung mit der Frist des Dienstes', () => {
    for (const sprache of ['de', 'en'] as const) {
      const satz = WEBSITE_REFERENZ_TEXTE[sprache].herkunftWiderrufen('07.10.2026', 5);
      expect(satz).toContain('07.10.2026');
      expect(satz).toContain('5');
      expect(satz).toContain('O-735');
      expect(satz).not.toMatch(/angefragt|asked of the client/u);
      expect(WEBSITE_REFERENZ_TEXTE[sprache].herausnahmeEinleitung(5)).toContain('5');
      expect(WEBSITE_REFERENZ_TEXTE[sprache].herausnahmeFaellig('14 Oct 2026'))
        .toContain('14 Oct 2026');
      expect(WEBSITE_REFERENZ_TEXTE[sprache].herausnahmeTitel).toBeTruthy();
      expect(WEBSITE_REFERENZ_TEXTE[sprache].herausnahmeOhneFrist).toBeTruthy();
    }
  });
});
