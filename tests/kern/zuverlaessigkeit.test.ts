/**
 * Die Meldung „Zuverlässigkeitsüberprüfung fällig" (V-320, O-140, D-815).
 *
 * Ohne Datenbank: was die Meldung sagt, wohin sie zeigt, und dass sie nie
 * mehr behauptet, als die Plattform weiss — das Register ist nicht verbunden,
 * und ein abgeleitetes Datum ist als solches gekennzeichnet.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { erzeuge, leereArten } from '../../src/server/benachrichtigung/registry.js';
import {
  ART_UEBERPRUEFUNG_FAELLIG, UEBERPRUEFUNG_VORLAUF_TAGE, registriereZuverlaessigkeitArten,
} from '../../src/server/services/security/zuverlaessigkeit.js';
import {
  BEWACHER_VORWARNUNG_TAGE, ZUVERLAESSIGKEIT_JAHRE,
} from '../../src/server/services/security/bewacherregister.js';
import { KONTO_BENACHRICHTIGUNG_TEXTE } from '../../src/lib/i18n/konto.js';

const KONTEXT = {
  mandantId: '00000000-0000-4000-8000-0000000000aa',
  mandantSlug: 'security',
  objektTyp: 'bewacher_eintrag',
  objektId: '00000000-0000-4000-8000-0000000000bb',
};

beforeEach(() => {
  leereArten();
  registriereZuverlaessigkeitArten();
});

describe('V-320 — die Meldung der fälligen Zuverlässigkeitsüberprüfung', () => {
  it('fünf Jahre (§ 34a Abs. 1 GewO) und derselbe Vorlauf wie die Erlaubnis (O-707)', () => {
    expect(ZUVERLAESSIGKEIT_JAHRE).toBe(5);
    expect(UEBERPRUEFUNG_VORLAUF_TAGE).toBe(BEWACHER_VORWARNUNG_TAGE);
  });

  it('ein abgeleitetes Datum heisst so — und das Register heisst nicht verbunden', () => {
    const b = erzeuge(ART_UEBERPRUEFUNG_FAELLIG, {
      ...KONTEXT,
      daten: { person: 'Fatima Yilmaz', bewacherId: 'BE-1', faellig: '12.03.2027', abgeleitet: true },
    });
    expect(b.titel).toContain('Fatima Yilmaz');
    expect(b.text).toContain('12.03.2027');
    expect(b.text).toContain('BE-1');
    expect(b.text).toMatch(/abgeleitet, 5 Jahre nach der letzten eingetragenen Prüfung \(Voreinstellung\)/u);
    expect(b.text).toMatch(/nicht verbunden/u);
    expect(b.ziel).toBe('/portal/security/security/bewacherregister');
  });

  it('ein eingetragenes Datum heisst „so eingetragen"', () => {
    const b = erzeuge(ART_UEBERPRUEFUNG_FAELLIG, {
      ...KONTEXT,
      daten: { person: 'Fatima Yilmaz', bewacherId: 'BE-1', faellig: '01.02.2027', abgeleitet: false },
    });
    expect(b.text).toMatch(/so eingetragen/u);
    expect(b.text).not.toMatch(/Voreinstellung/u);
  });

  it('ohne Slug kein Ziel — und ohne Ziel keine Meldung (NOT-03)', () => {
    expect(() => erzeuge(ART_UEBERPRUEFUNG_FAELLIG, {
      ...KONTEXT, mandantSlug: null, daten: {},
    })).toThrow();
  });

  it('die Kontoeinstellungen nennen die Art', () => {
    expect(KONTO_BENACHRICHTIGUNG_TEXTE.de.art['bewacher_pruefung_faellig'])
      .toBe('Zuverlässigkeitsüberprüfung fällig (§ 34a GewO)');
  });
});
