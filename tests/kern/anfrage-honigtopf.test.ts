/**
 * **`/api/anfrage`: der Honigtopf antwortet in derselben FORM wie der Erfolg,
 * und die englische Seite bekommt englische Sammelsätze** (V-157, D-651).
 *
 * Die Befunde:
 *
 *  1. Das Formular schickt `antwort=seite`; Erfolg und Fehler gehen per 303 auf
 *     Seiten. Der Honigtopf-Zweig antwortete aber VOR dieser Weiche mit
 *     `NextResponse.json({ ok: true, … })`. Ein falsch positiver Treffer
 *     (Passwortverwalter im versteckten Feld) sah eine weisse Seite mit JSON
 *     statt der Dankseite, die `lead/annahme.ts` ausdrücklich zusagt — und ein
 *     Bot erkannte am anderen Antworttyp, dass er erkannt war.
 *  2. Auf `/en/angebot/<bereich>` standen über englischen Feldmeldungen der
 *     deutsche Sammelsatz und die deutsche Ratenlimitmeldung im `role="alert"`.
 *
 * Der Honigtopf-Zweig läuft VOR jeder Datenbankberührung — die Route lässt
 * sich hier also wirklich aufrufen, ohne Datenbank und ohne Attrappe.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POST } from '../../src/app/api/anfrage/route.js';
import { API_TEXTE, formularSammelmeldung } from '../../src/lib/i18n/texte.js';
import { FormularFehler, type FormularFeld } from '../../src/lib/formular/schema.js';
import {
  RatenlimitFehler, nimmAn, type FormularVersion,
} from '../../src/server/services/lead/annahme.js';

function anfrage(felder: Readonly<Record<string, string>>): Request {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return new Request('https://cse.example/api/anfrage', { method: 'POST', body: daten });
}

describe('der Honigtopf gibt dieselbe Antwortform wie der Erfolg (V-157)', () => {
  it('ein Formular (antwort=seite) bekommt 303 auf die Dankseite — nicht JSON', async () => {
    const antwort = await POST(anfrage({
      bereich: 'reinigung', antwort: 'seite', sprache: 'de', website: 'https://spam.example',
    }));
    expect(antwort.status).toBe(303);
    const ziel = new URL(antwort.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/angebot/reinigung/danke');
    /*
     * Keine Vorgangsnummer: es gibt keinen Vorgang, und eine erfundene wäre
     * eine, auf die sich ein Mensch am Telefon beruft und die niemand findet.
     */
    expect(ziel.searchParams.has('nr')).toBe(false);
    expect(antwort.headers.get('content-type') ?? '').not.toContain('json');
  });

  it('die englische Seite landet auf der englischen Dankseite', async () => {
    const antwort = await POST(anfrage({
      bereich: 'bau', antwort: 'seite', sprache: 'en', website: 'x',
    }));
    expect(antwort.status).toBe(303);
    expect(new URL(antwort.headers.get('location') ?? '').pathname)
      .toBe('/en/angebot/bau/danke');
  });

  it('ein Programm (ohne antwort=seite) bekommt weiter JSON — wie beim Erfolg', async () => {
    const antwort = await POST(anfrage({ bereich: 'reinigung', website: 'x', sprache: 'en' }));
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ ok: true, meldung: API_TEXTE.en.dank });
  });
});

describe('der Sammelsatz spricht die Sprache der Seite (V-157)', () => {
  it('englisch: „prüfen" und „Datenschutz bestätigen" nach der Ursache', () => {
    const pruefen = new FormularFehler('Bitte prüfen Sie die markierten Felder.',
      { email: 'Bitte geben Sie eine E-Mail-Adresse an.' }, 'pruefen');
    const datenschutz = new FormularFehler(
      'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.',
      { datenschutz_hinweis: 'Bitte bestätigen Sie die Datenschutzhinweise.' }, 'datenschutz');
    expect(formularSammelmeldung('en', pruefen)).toBe(API_TEXTE.en.pruefen);
    expect(formularSammelmeldung('en', datenschutz)).toBe(API_TEXTE.en.datenschutzBestaetigen);
    expect(formularSammelmeldung('en', new RatenlimitFehler(900)))
      .toBe(API_TEXTE.en.zuVieleAnfragen);
    // Eine Ursache ohne eigenen Satz bekommt den allgemeinen — nie „prüfen".
    expect(formularSammelmeldung('en', new FormularFehler('x', {}, 'sonst')))
      .toBe(API_TEXTE.en.nichtGespeichert);
  });

  it('deutsch: der Satz des Dienstes, unverändert', () => {
    const f = new FormularFehler('Bitte prüfen Sie die markierten Felder.', { a: 'b' });
    expect(formularSammelmeldung('de', f)).toBe('Bitte prüfen Sie die markierten Felder.');
  });

  it('die neuen Sätze sind in beiden Sprachen gesetzt und verschieden', () => {
    for (const k of ['pruefen', 'datenschutzBestaetigen', 'zuVieleAnfragen'] as const) {
      expect(API_TEXTE.de[k], k).not.toBe('');
      expect(API_TEXTE.en[k], k).not.toBe('');
      expect(API_TEXTE.en[k], k).not.toBe(API_TEXTE.de[k]);
    }
    // Das Ratenlimit sagte auf Deutsch schon dasselbe — der Satz bleibt.
    expect(API_TEXTE.de.zuVieleAnfragen).toBe(new RatenlimitFehler(900).message);
  });

  it('die Route reicht weder fehler.message noch die Ratenlimitmeldung roh durch', () => {
    const quelle = readFileSync('src/app/api/anfrage/route.ts', 'utf8');
    expect(quelle).not.toMatch(/antworteFehler\(\s*\d+\s*,\s*fehler\.message/u);
    expect(quelle).toContain('antworteFehler(429, t.zuVieleAnfragen)');
    expect(quelle).toContain('formularSammelmeldung(sprache, fehler)');
  });
});

/**
 * **Beide Sprachen sagen dasselbe über dieselbe Abweisung** (V-160).
 *
 * Die erste Fassung las die Ursache auf Englisch aus den FELDERN: stand
 * `datenschutz_hinweis` darunter, hiess es „Please confirm … privacy notice".
 * Die Formularversion führt die Checkbox aber als Pflichtfeld, und die Prüfung
 * meldet sie zusammen mit allen anderen: bei drei leeren Feldern und fehlendem
 * Häkchen stand auf Deutsch „Bitte prüfen Sie die markierten Felder.", auf
 * Englisch etwas anderes. Hier läuft der ECHTE Dienst — die drei Prüfungen
 * stehen vor der ersten Datenbankberührung, und die Attrappe wirft, falls
 * sich das je ändert.
 */
describe('die Ursache entsteht im Dienst, und beide Sprachen folgen ihr (V-160)', () => {
  const keineDatenbank = {
    unsafe: (): Promise<readonly unknown[]> => {
      throw new Error('Vor der Prüfung darf keine Abfrage laufen.');
    },
  };
  const feld = (f: Partial<FormularFeld> & Pick<FormularFeld, 'typ' | 'schluessel'>): FormularFeld =>
    ({ label: f.schluessel, pflicht: true, sortierung: 0,
      fehlermeldung: `Bitte prüfen: ${f.schluessel}.`, ...f }) as FormularFeld;
  const version = (felder: readonly FormularFeld[]): FormularVersion => ({
    id: 'f', mandantId: 'm', schluessel: 'angebot_reinigung', felder,
    datenschutzHinweisVersion: '1', slaStunden: null, standardBesitzerBenutzerId: 'b',
  });
  const MIT_PFLICHT = version([
    feld({ typ: 'text', schluessel: 'firma' }),
    feld({ typ: 'email', schluessel: 'email' }),
    feld({ typ: 'checkbox', schluessel: 'datenschutz_hinweis' }),
  ]);
  const abweisung = async (
    formular: FormularVersion, werte: Record<string, unknown>,
  ): Promise<FormularFehler> => {
    const fehler = await nimmAn(keineDatenbank, formular, { werte, attribution: {} })
      .then(() => null, (e: unknown) => e);
    expect(fehler).toBeInstanceOf(FormularFehler);
    return fehler as FormularFehler;
  };

  it('mehrere Felder UND das Häkchen: überall „prüfen"', async () => {
    const f = await abweisung(MIT_PFLICHT, { firma: '', email: 'kaputt' });
    expect(Object.keys(f.felder).sort()).toEqual(['datenschutz_hinweis', 'email', 'firma']);
    expect(f.grund).toBe('pruefen');
    expect(formularSammelmeldung('de', f)).toBe(API_TEXTE.de.pruefen);
    expect(formularSammelmeldung('en', f)).toBe(API_TEXTE.en.pruefen);
  });

  it('NUR das Häkchen fehlt: überall „bestätigen"', async () => {
    const f = await abweisung(MIT_PFLICHT, { firma: 'Muster GmbH', email: 'a@b.de' });
    expect(Object.keys(f.felder)).toEqual(['datenschutz_hinweis']);
    expect(f.grund).toBe('datenschutz');
    expect(formularSammelmeldung('de', f)).toBe(API_TEXTE.de.datenschutzBestaetigen);
    expect(formularSammelmeldung('en', f)).toBe(API_TEXTE.en.datenschutzBestaetigen);
  });

  it('eine Version mit FREIWILLIGER Checkbox: die zweite Prüfung, derselbe Grund', async () => {
    const frei = version([
      feld({ typ: 'text', schluessel: 'firma' }),
      feld({ typ: 'checkbox', schluessel: 'datenschutz_hinweis', pflicht: false }),
    ]);
    const f = await abweisung(frei, { firma: 'Muster GmbH' });
    expect(f.grund).toBe('datenschutz');
    expect(formularSammelmeldung('de', f)).toBe(API_TEXTE.de.datenschutzBestaetigen);
    expect(formularSammelmeldung('en', f)).toBe(API_TEXTE.en.datenschutzBestaetigen);
  });

  it('der Honigtopf im Dienst trägt seinen eigenen Grund', async () => {
    const f = await nimmAn(keineDatenbank, MIT_PFLICHT,
      { werte: {}, attribution: {}, honigtopf: 'x' }).then(() => null, (e: unknown) => e);
    expect((f as FormularFehler).grund).toBe('automatisiert');
  });
});
