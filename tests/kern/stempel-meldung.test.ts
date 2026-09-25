/**
 * Die Stempeluhr übersetzt eine Ablehnung nach ihrem CODE — und sagt einer
 * gültigen Marke nie, sie sei ungültig (V-200, D-752, AUT-06).
 *
 * **Der Befund.** `stempelMeldung` bildete jeden Code ausser
 * `kein_benutzerkonto` auf „Dieser Link ist nicht gültig." ab, und
 * `KeinOffenerEintragFehler` trug denselben Code wie `TokenAbgelehntFehler`.
 * Wer ausstempelte, während das Einstempeln noch in der Offline-Schlange lag
 * (TIM-09), las in allen vier Sprachen, sein Link sei kaputt — obwohl P0004
 * nur für eine Marke entsteht, die jede Prüfung bestanden hat, und die Marke
 * unverbraucht bleibt.
 *
 * Geprüft wird gegen die ECHTEN Codes der Fehlerklassen, nicht gegen
 * abgeschriebene Zeichenketten: ein Tippfehler auf einer Seite fiele sonst
 * still auf den allgemeinen Satz.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEMPEL_TEXTE, stempelMeldung } from '../../src/lib/i18n/vor-anmeldung.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import {
  KeinBenutzerkontoFehler, KeinOffenerEintragFehler, TokenAbgelehntFehler,
} from '../../src/server/services/zeit/checkin.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('stempelMeldung — nach dem Code der Fehlerklasse', () => {
  it.each(PORTAL_SPRACHEN)('%s: jede Ablehnung der Marke bekommt denselben Satz', (s) => {
    const t = STEMPEL_TEXTE[s];
    expect(stempelMeldung(t, new TokenAbgelehntFehler().code)).toBe(t.ungueltig);
    /* Ein unbekannter oder fehlender Code verrät nichts und fällt auf denselben Satz. */
    expect(stempelMeldung(t, 'irgendwas')).toBe(t.ungueltig);
    expect(stempelMeldung(t, undefined)).toBe(t.ungueltig);
    expect(stempelMeldung(t, '__proto__')).toBe(t.ungueltig);
  });

  it.each(PORTAL_SPRACHEN)('%s: die zwei Fälle mit gültiger Marke haben ihren eigenen Satz', (s) => {
    const t = STEMPEL_TEXTE[s];
    expect(stempelMeldung(t, new KeinBenutzerkontoFehler().code)).toBe(t.keinZugang);
    expect(stempelMeldung(t, new KeinOffenerEintragFehler().code)).toBe(t.keinOffenerEintrag);
    expect(t.keinOffenerEintrag).not.toBe(t.ungueltig);
    expect(t.keinOffenerEintrag).not.toBe(t.keinZugang);
  });

  it('der Satz sagt, dass der Link gültig bleibt — nie, dass er ungültig ist', () => {
    expect(STEMPEL_TEXTE.de.keinOffenerEintrag).toContain('Der Link bleibt gültig');
    expect(STEMPEL_TEXTE.de.keinOffenerEintrag).not.toMatch(/nicht gültig/u);
    expect(STEMPEL_TEXTE.en.keinOffenerEintrag).toContain('The link stays valid');
    expect(STEMPEL_TEXTE.en.keinOffenerEintrag).not.toMatch(/not valid/u);
  });
});

describe('die Fehlerklassen an der Grenze', () => {
  it('KeinOffenerEintragFehler ist KEINE Ablehnung der Marke — eigener Code, 409', () => {
    const f = new KeinOffenerEintragFehler();
    expect(f.code).toBe('kein_offener_eintrag');
    expect(f.status).toBe(409);
    expect(f.code).not.toBe(new TokenAbgelehntFehler().code);
    expect(f.code).not.toBe(new KeinBenutzerkontoFehler().code);
  });

  it('die Route reicht den Code der Klasse durch, die Stempeluhr liest nur ihn', () => {
    const route = readFileSync(join(WURZEL, 'src/app/api/check-in/[token]/route.ts'), 'utf8');
    expect(route).toContain('fehler instanceof KeinOffenerEintragFehler');
    expect(route).toMatch(/\{ error: \{ code: fehler\.code, message: fehler\.message \} \}/u);
    const uhr = readFileSync(join(WURZEL, 'src/app/check-in/[token]/Stempeluhr.tsx'), 'utf8');
    expect(uhr).toContain('stempelMeldung(texte, daten.error?.code)');
    expect(uhr).not.toMatch(/daten\.error\?\.message/u);
  });
});
