/**
 * Ein abgewiesenes Formular endet auf seiner Seite MIT einem Satz — Personal,
 * Dienstplan, Finanzen (V-197, D-599, D-562, EMP-10, TIM-02, ACC-03).
 *
 * **Der Befund.** Die Routen bildeten den fachlichen Fehler richtig als
 * Umleitung ab — `?meldung=<Satz>` (Anträge, Abwesenheiten) bzw.
 * `?fehler=<grund>` (Ausgaben, Nachweise, Schichten) auf `zurueck` oder
 * `fehlerweg`. Die Zielseiten nahmen den Parameter aber nicht an: „Ablehnen"
 * ohne Kommentar, „Freigeben" ohne Beleg, ein schon entschiedener Nachweis —
 * der Klick landete auf derselben Seite, nichts war geschehen, und kein Satz
 * sagte, warum.
 *
 * Geprüft wird dreierlei: jede Zielseite liest ihren Parameter und zeigt ihn
 * in einem Hinweiskasten mit `role="alert"`; jeder Grund, den ein Dienst
 * werfen kann, hat in beiden Sprachen einen Satz; und ein unbekannter Grund
 * aus der Adresse wird ein allgemeiner Satz, nie der rohe Schlüssel und nie
 * ein Treffer im Prototyp (D-728).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { AUSGABE_ERFASSEN_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/ausgabe-erfassen.js';
import { NACHWEIS_ERFASSEN_TEXTE } from '../../src/lib/i18n/verwaltung/personal-nachweis.js';
import { SCHICHT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-schicht.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const M = 'src/app/portal/[mandant]';

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

/** Die Gründe einer Fehlerklasse, so wie ihr Konstruktor sie als Union trägt. */
function gruende(datei: string, klasse: string): readonly string[] {
  const text = quelle(datei);
  const ab = text.indexOf(`class ${klasse}`);
  expect(ab, `${klasse} in ${datei}`).toBeGreaterThan(-1);
  const union = /readonly grund:([^,]*?),\s*readonly status/su.exec(text.slice(ab))?.[1] ?? '';
  const werte = [...union.matchAll(/'([a-z_]+)'/gu)].map((m) => m[1] ?? '');
  expect(werte.length, klasse).toBeGreaterThan(2);
  return werte;
}

const PROTOTYP = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'];

describe('jede Zielseite liest den Grund ihres Formulars', () => {
  const FAELLE = [
    { seite: `${M}/personal/antraege/page.tsx`, parameter: 'meldung', cse: 'antraege-meldung' },
    { seite: `${M}/personal/abwesenheiten/page.tsx`, parameter: 'meldung', cse: 'abwesenheiten-meldung' },
    { seite: `${M}/finanzen/ausgaben/[id]/page.tsx`, parameter: 'fehler', cse: 'ausgabe-fehler' },
    { seite: `${M}/personal/nachweise/[id]/page.tsx`, parameter: 'fehler', cse: 'nachweis-fehler' },
    { seite: `${M}/dienstplan/einsatz/[id]/page.tsx`, parameter: 'fehler', cse: 'einsatz-fehler' },
  ] as const;

  it.each(FAELLE)('$seite liest ?$parameter= und zeigt ihn', ({ seite, parameter, cse }) => {
    const s = quelle(seite);
    expect(s).toMatch(/searchParams/u);
    expect(s).toContain(`['${parameter}']`);
    expect(s).toContain(`cse="${cse}"`);
  });

  it('die neuen Kästen melden sich einem Screenreader (role="alert")', () => {
    for (const { seite, cse } of FAELLE.filter((f) => f.cse !== 'einsatz-fehler')) {
      const s = quelle(seite);
      const kasten = new RegExp(`<Hinweis[^>]*cse="${cse}"[^>]*>`, 'u').exec(s)?.[0] ?? '';
      expect(kasten, seite).toContain('rolle="alert"');
    }
  });

  it('und die Formulare schicken ihren Rückweg auf genau diese Seite', () => {
    expect(quelle(`${M}/personal/antraege/page.tsx`)).toMatch(/name="zurueck" value=\{pfad\}/u);
    expect(quelle(`${M}/personal/abwesenheiten/page.tsx`)).toMatch(/name="zurueck" value=\{pfad\}/u);
    expect(quelle(`${M}/finanzen/ausgaben/[id]/page.tsx`)).toMatch(/name="fehlerweg" value=\{pfad\}/u);
    expect(quelle(`${M}/personal/nachweise/[id]/page.tsx`)).toMatch(/name="fehlerweg" value=\{pfad\}/u);
  });
});

describe('jeder Grund hat einen Satz — in beiden Sprachen', () => {
  it('Ausgaben: jeder Grund von AusgabeFehler', () => {
    const alle = gruende('src/server/services/finanz/ausgabe-schreiben.ts', 'AusgabeFehler');
    for (const sprache of ['de', 'en'] as const) {
      for (const g of alle) {
        expect(eigenerEintrag(AUSGABE_ERFASSEN_TEXTE[sprache].fehler, g), `${sprache}.${g}`)
          .toBeTruthy();
      }
    }
  });

  it('Nachweise: jeder Grund von NachweisFehler', () => {
    const alle = gruende('src/server/services/nachweis/aufnahme.ts', 'NachweisFehler');
    for (const sprache of ['de', 'en'] as const) {
      for (const g of alle) {
        expect(eigenerEintrag(NACHWEIS_ERFASSEN_TEXTE[sprache].fehler, g), `${sprache}.${g}`)
          .toBeTruthy();
      }
    }
  });

  it('Schichten: jeder Grund von SchichtFehler (V-158, hier gegengeprüft)', () => {
    const alle = gruende('src/server/services/dienstplan/einzelschicht.ts', 'SchichtFehler');
    for (const sprache of ['de', 'en'] as const) {
      for (const g of alle) {
        expect(eigenerEintrag(SCHICHT_TEXTE[sprache].fehler, g), `${sprache}.${g}`).toBeTruthy();
      }
    }
  });

  it('„nicht_gefunden" beim Nachweis nennt den häufigen Fall: schon entschieden', () => {
    expect(NACHWEIS_ERFASSEN_TEXTE.de.fehler['nicht_gefunden']).toMatch(/bestätigt|widerrufen/u);
    expect(NACHWEIS_ERFASSEN_TEXTE.en.fehler['nicht_gefunden']).toMatch(/confirmed|revoked/u);
  });
});

describe('ein fremder Grund wird ein allgemeiner Satz — nie der Schlüssel', () => {
  it('die Tabellen kennen keinen Schlüssel des Prototyps', () => {
    for (const sprache of ['de', 'en'] as const) {
      for (const k of PROTOTYP) {
        expect(eigenerEintrag(AUSGABE_ERFASSEN_TEXTE[sprache].fehler, k), k).toBeUndefined();
        expect(eigenerEintrag(NACHWEIS_ERFASSEN_TEXTE[sprache].fehler, k), k).toBeUndefined();
      }
      expect(AUSGABE_ERFASSEN_TEXTE[sprache].fehlerAllgemein.trim()).not.toBe('');
      expect(NACHWEIS_ERFASSEN_TEXTE[sprache].fehlerSonst.trim()).not.toBe('');
    }
  });

  it('die Seiten fallen auf den allgemeinen Satz zurück, nicht auf `?? fehler`', () => {
    for (const seite of [
      `${M}/finanzen/ausgaben/[id]/page.tsx`,
      `${M}/finanzen/ausgaben/erfassen/page.tsx`,
      `${M}/personal/nachweise/[id]/page.tsx`,
      `${M}/personal/nachweise/erfassen/page.tsx`,
    ]) {
      const s = quelle(seite);
      expect(s, seite).not.toMatch(/eigenerEintrag\([^)]*\)\s*\?\?\s*fehler\s*\}/u);
    }
  });
});
