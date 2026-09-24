/**
 * **Nach einem reinen HTML-Formular kommt eine Seite mit einem Satz — kein
 * rohes JSON** (V-158, D-652, D-599).
 *
 * Die Befunde:
 *
 *  1. `POST /api/einsaetze/[id]/absagen` und `…/besetzen` antworteten auf
 *     Fachfehler mit `{"fehler": code}` und verwarfen die deutsche Meldung.
 *     „ok" als Absagegrund (der Dienst verlangt drei Zeichen, das Feld nur
 *     `required`) endete als `{"fehler":"ungueltige_eingabe"}`; ein Doppelklick
 *     auf „Einteilen" als `{"fehler":"ungueltiger_zustand"}`.
 *  2. `POST /api/karriere/bewerbung` antwortete auf JEDEN Fehler mit JSON —
 *     `name@firma` liess der Browser durch, der Dienst nicht, und die
 *     Bewerberin sah eine geschweifte Klammer.
 *
 * Die Bewerbungsroute lässt sich bis zur Bereichsprüfung ohne Datenbank
 * aufrufen; genau dort liegt einer der Fehlerwege, und er wird hier wirklich
 * durchlaufen. Die Einteilungsrouten brauchen eine Sitzung — für sie wird die
 * Zuordnung Fehler → Grund → Satz geprüft und der Quelltext darauf, dass er
 * sie benutzt.
 */
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { einteilungsGrund, fachStatus } from '../../src/app/api/einsaetze/fehler.js';
import { grundAufsFormular } from '../../src/app/api/formular-antwort.js';
import { POST as bewerbung } from '../../src/app/api/karriere/bewerbung/route.js';
import {
  BEWERBUNG_MELDUNG, BEWERBUNG_MELDUNG_SONST, EMAIL_MUSTER, bewerbungsMeldung,
} from '../../src/app/(public)/karriere/meldung.js';
import { SCHICHT_TEXTE } from '../../src/lib/i18n/verwaltung/dienstplan-schicht.js';
import {
  AnstellungNichtGefunden, ArbzgPruefungNichtErlaubt, BereitsEingeteilt, EinsatzNichtGefunden,
  GrundFehlt, SchichtStorniert, ZuordnungNichtGefunden,
} from '../../src/server/services/dienstplan/einteilung.js';
import { BEWERBUNG_EMAIL } from '../../src/server/services/recruiting/dienst.js';

const UUID = '3f2a8c1e-0b7d-4e59-9a61-2d4c8e7f1a0b';

function formularPost(url: string, felder: Readonly<Record<string, string>>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return new NextRequest(url, {
    method: 'POST', body: daten, headers: { origin: new URL(url).origin },
  });
}

describe('Einteilung: jeder Fachfehler hat einen Grund und einen Satz (V-158)', () => {
  const faelle: readonly [unknown, string][] = [
    [new GrundFehlt(), 'grund_fehlt'],
    [new ZuordnungNichtGefunden(UUID), 'einteilung_weg'],
    [new SchichtStorniert(), 'schon_storniert'],
    [new BereitsEingeteilt(), 'bereits_eingeteilt'],
    [new AnstellungNichtGefunden(UUID), 'anstellung_weg'],
    [new EinsatzNichtGefunden(UUID), 'nicht_gefunden'],
    [new ArbzgPruefungNichtErlaubt(), 'kein_arbzg_recht'],
  ];

  it('der Fehler wird zum Grund', () => {
    for (const [fehler, grund] of faelle) expect(einteilungsGrund(fehler)).toBe(grund);
  });

  it('jeder Grund steht in BEIDEN Sprachen als Satz — ohne Kennung', () => {
    for (const [, grund] of faelle) {
      for (const s of ['de', 'en'] as const) {
        const satz = SCHICHT_TEXTE[s].fehler[grund];
        expect(satz, `${s}.${grund}`).toBeDefined();
        expect(satz, `${s}.${grund}`).not.toContain(UUID);
      }
    }
    expect(SCHICHT_TEXTE.de.fehler['keine_auswahl']).toBeDefined();
    expect(SCHICHT_TEXTE.en.fehler['keine_auswahl']).toBeDefined();
    // Der Satz des DIENSTES trug die Kennung — deshalb reist er nicht mit.
    expect(new ZuordnungNichtGefunden(UUID).message).toContain(UUID);
  });

  /**
   * **Einteilen und Absagen fehlt je etwas anderes** (V-160). `besetzen`
   * schickte ohne Beschäftigung den Grund des Absagens, `keine_auswahl` — und
   * dessen Satz fragt nach der EINTEILUNG. Gemeint ist die Beschäftigung.
   */
  it('ohne Beschäftigung nennt das Einteilen die Beschäftigung, nicht die Einteilung', () => {
    const besetzen = readFileSync('src/app/api/einsaetze/[id]/besetzen/route.ts', 'utf8');
    expect(besetzen).toMatch(/abgewiesen\('keine_anstellung', 400, 'keine_anstellung'/u);
    expect(besetzen).not.toContain("abgewiesen('keine_auswahl'");
    // Das Absagen bleibt bei seinem Grund.
    expect(readFileSync('src/app/api/einsaetze/[id]/absagen/route.ts', 'utf8'))
      .toContain("abgewiesen('keine_auswahl'");
    expect(SCHICHT_TEXTE.de.fehler['keine_anstellung']).toContain('Beschäftigung');
    expect(SCHICHT_TEXTE.de.fehler['keine_anstellung']).not.toContain('Einteilung');
    expect(SCHICHT_TEXTE.en.fehler['keine_anstellung']).toContain('Anstellung (employment)');
    expect(SCHICHT_TEXTE.de.fehler['keine_auswahl']).toContain('Einteilung');
  });

  it('ein unbekannter Fachfehler wird „abgewiesen", ein fremder Fehler gar nicht', () => {
    const fremd = Object.assign(new Error('x'), { status: 409, code: 'irgendwas' });
    expect(einteilungsGrund(fremd)).toBe('abgewiesen');
    expect(SCHICHT_TEXTE.de.fehler['abgewiesen']).toBeDefined();
    expect(einteilungsGrund(new Error('kaputt'))).toBeNull();
    expect(fachStatus(new BereitsEingeteilt())).toEqual({ status: 409, code: 'ungueltiger_zustand' });
  });

  it('grundAufsFormular: 303 zurück mit ?fehler=, nie nach draussen', () => {
    const a = formularPost('https://cse.example/api/einsaetze/x/absagen', {});
    const r = grundAufsFormular(a, {
      json: false, zurueck: '/portal/security/dienstplan/einsatz/abc', grund: 'grund_fehlt',
    });
    expect(r?.status).toBe(303);
    expect(r?.headers.get('location'))
      .toBe('https://cse.example/portal/security/dienstplan/einsatz/abc?fehler=grund_fehlt');
    const mitFrage = grundAufsFormular(a, {
      json: false, zurueck: '/portal/x?woche=2026-09-21', grund: 'a b',
    });
    expect(mitFrage?.headers.get('location'))
      .toBe('https://cse.example/portal/x?woche=2026-09-21&fehler=a%20b');
    const fremd = grundAufsFormular(a, {
      json: false, zurueck: 'https://boese.example/', grund: 'x',
    });
    expect(new URL(fremd?.headers.get('location') ?? '').origin).toBe('https://cse.example');
    /*
     * „Nie nach draussen" gilt auch für die Pfade, die erst die Normalisierung
     * zu `//boese.example` macht (V-159): sie bestehen die Ursprungsprüfung,
     * und das zweite Einlesen machte daraus eine schemalose Adresse.
     */
    for (const zurueck of ['/.//boese.example', '/portal/..//boese.example',
      '/%2e//boese.example', '/./\\boese.example']) {
      const umweg = grundAufsFormular(a, { json: false, zurueck, grund: 'grund_fehlt' });
      expect(umweg?.status, zurueck).toBe(303);
      expect(new URL(umweg?.headers.get('location') ?? '').origin, zurueck)
        .toBe('https://cse.example');
    }
    expect(grundAufsFormular(a, { json: true, zurueck: '/portal', grund: 'x' })).toBeNull();
    expect(grundAufsFormular(a, { json: false, zurueck: undefined, grund: 'x' })).toBeNull();
  });

  it('beide Routen benutzen den Weg — und kein rohes json({ fehler: code }) mehr', () => {
    for (const datei of ['absagen', 'besetzen']) {
      const quelle = readFileSync(`src/app/api/einsaetze/[id]/${datei}/route.ts`, 'utf8');
      expect(quelle, datei).toContain('grundAufsFormular(');
      expect(quelle, datei).toContain('einteilungsGrund(fehler)');
      expect(quelle, datei).not.toMatch(/NextResponse\.json\(\{ fehler: code \}, \{ status \}\)/u);
    }
  });

  it('das Schichtblatt liest den Grund, übersetzt ihn und verlangt drei Zeichen', () => {
    const seite = readFileSync(
      'src/app/portal/[mandant]/dienstplan/einsatz/[id]/page.tsx', 'utf8');
    expect(seite).toContain("frage['fehler']");
    // Nur ein EIGENER Schlüssel der Tabelle (V-159) — `?fehler=__proto__` fände sonst
    // `Object.prototype`, und die Seite endete in einem 500.
    expect(seite).toContain('eigenerEintrag(t.fehler, abgewiesen) ?? t.fehlerSonst');
    // Der Absagegrund der EINTEILUNG — dieselbe Mindestlänge wie der Dienst.
    const absage = /action=\{`\/api\/einsaetze\/\$\{kopf\.id\}\/absagen`\}[\s\S]*?<\/form>/u
      .exec(seite)?.[0] ?? '';
    expect(absage).toContain('minLength={3}');
    // Und die Formulare stehen nur, wo die Route sie annimmt.
    expect(seite).toMatch(/darf\['dienstplan\.schreiben'\] === true && \(\s*<form\s+action=\{`\/api\/einsaetze/u);
  });
});

describe('Bewerbung: eine Abweisung ist ein Satz auf der Formularseite (V-158)', () => {
  it('ohne Bereich: 303 zurück auf die Initiativbewerbung, mit Grund', async () => {
    const antwort = await bewerbung(formularPost('https://cse.example/api/karriere/bewerbung', {
      antwort: 'seite', bereich: '', name: 'Ada', email: 'ada@firma.de',
    }));
    expect(antwort.status).toBe(303);
    const ziel = new URL(antwort.headers.get('location') ?? '');
    expect(ziel.pathname).toBe('/karriere/initiativbewerbung');
    expect(ziel.searchParams.get('fehler')).toBe('kein_bereich');
    // Die Eingaben reisen NICHT in die Adresse.
    expect(ziel.search).not.toContain('ada');
  });

  it('ein Programm bekommt weiter JSON — jetzt mit Satz', async () => {
    const antwort = await bewerbung(formularPost('https://cse.example/api/karriere/bewerbung', {
      bereich: 'KEIN SLUG',
    }));
    expect(antwort.status).toBe(400);
    expect(await antwort.json())
      .toEqual({ fehler: 'kein_bereich', meldung: BEWERBUNG_MELDUNG['kein_bereich'] });
  });

  it('der Honigtopf führt weiter auf die Dankseite', async () => {
    const antwort = await bewerbung(formularPost('https://cse.example/api/karriere/bewerbung', {
      antwort: 'seite', webseite: 'https://spam.example',
    }));
    expect(antwort.status).toBe(303);
    expect(new URL(antwort.headers.get('location') ?? '').pathname).toBe('/karriere/danke');
  });

  it('jeder Grund der Route hat einen Satz — und nie steht der rohe Schlüssel da', () => {
    for (const grund of ['unvollstaendig', 'zu_viele', 'kein_bereich', 'stelle_geschlossen']) {
      const satz = bewerbungsMeldung(grund);
      expect(satz, grund).toBe(BEWERBUNG_MELDUNG[grund]);
      expect(satz, grund).not.toContain(grund);
    }
    expect(bewerbungsMeldung('etwas_neues')).toBe(BEWERBUNG_MELDUNG_SONST);
    expect(bewerbungsMeldung(undefined)).toBeUndefined();
    expect(bewerbungsMeldung(['a', 'b'])).toBeUndefined();
  });

  /**
   * **Ein Schlüssel des Prototyps ist kein Grund** (V-159).
   *
   * `BEWERBUNG_MELDUNG['__proto__']` ist `Object.prototype`, `['toString']` eine
   * Funktion — beides nicht `undefined`, also griff der Rückfall nicht. Die drei
   * öffentlichen Karriereseiten geben den Wert als Kind eines `role="alert"`
   * aus; React wirft bei einem Objekt, und `/karriere?fehler=__proto__` war eine
   * Fehlerseite.
   */
  it('?fehler=__proto__, toString, constructor … bekommen den allgemeinen Satz', () => {
    for (const grund of ['__proto__', 'toString', 'constructor', 'hasOwnProperty',
      'valueOf', 'isPrototypeOf', '__defineGetter__', 'toLocaleString']) {
      expect(bewerbungsMeldung(grund), grund).toBe(BEWERBUNG_MELDUNG_SONST);
      // Und das Element lässt sich zeichnen — vorher warf React hier.
      const html = renderToStaticMarkup(
        createElement('p', { role: 'alert' }, bewerbungsMeldung(grund)));
      expect(html, grund).toBe(`<p role="alert">${BEWERBUNG_MELDUNG_SONST}</p>`);
    }
  });

  it('das E-Mail-Feld prüft wie der Dienst — `name@firma` kommt gar nicht erst an', () => {
    // Browser kompilieren `pattern` mit dem v-Flag und verankern es selbst.
    const feld = new RegExp(`^(?:${EMAIL_MUSTER})$`, 'v');
    for (const probe of ['name@firma.de', 'a.b@c.d', 'name@firma', 'a b@c.de', '@x.de', 'x@.']) {
      expect(feld.test(probe), probe).toBe(BEWERBUNG_EMAIL.test(probe));
    }
    expect(feld.test('name@firma')).toBe(false);
  });

  it('das Formular sagt der Route, dass es eine Seite will, und zeigt den Satz', () => {
    const quelle = readFileSync('src/app/(public)/karriere/Formular.tsx', 'utf8');
    expect(quelle).toContain('name="antwort" value="seite"');
    expect(quelle).toContain('pattern={EMAIL_MUSTER}');
    expect(quelle).toContain('role="alert"');
    for (const seite of ['src/app/(public)/karriere/[stelle]/bewerbung/page.tsx',
      'src/app/(public)/karriere/initiativbewerbung/page.tsx',
      'src/app/(public)/karriere/page.tsx']) {
      expect(readFileSync(seite, 'utf8'), seite).toContain("bewerbungsMeldung((await searchParams)['fehler'])");
    }
  });
});
