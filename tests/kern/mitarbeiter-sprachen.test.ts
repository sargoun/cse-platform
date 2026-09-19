/**
 * PR 39 Abnahme (6), erste Haelfte — vier Sprachen, und Arabisch laeuft nach
 * rechts (EMP-12, SEITENKARTE §12).
 *
 * **Der Fehler, den diese Datei verhindert, ist nicht ein Tippfehler.** Er ist
 * die halbe Uebersetzung: ein Schluessel, den jemand deutsch ergaenzt und
 * arabisch vergisst. Nichts bricht davon — es steht ein deutsches Wort auf dem
 * Bildschirm eines Menschen, der WEGEN der Uebersetzung dort liest, und genau
 * der kann es nicht lesen. Deshalb muss es eine Pruefung sein und keine
 * Sorgfalt.
 *
 * Die zweite Haelfte — null axe-Verstoesse in der gerenderten Seite — steht in
 * `tests/e2e/mitarbeiter.spec.ts`: sie braucht einen Browser.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BAUTAG_STATUS_TEXTE, EINWAND_ARTEN, EINWAND_ART_TEXTE, MEIN_TEXTE, PORTAL_BCP47,
  PORTAL_EIGENNAME, PORTAL_RICHTUNG, PORTAL_SPRACHEN, WACHBUCH_ARTEN_I18N,
  WACHBUCH_ART_TEXTE, WETTER_QUELLE_TEXTE,
  istPortalSprache, meinTexte,
} from '../../src/lib/i18n/texte.js';
import {
  BAUTAG_STATUS_TEXT, WETTER_QUELLE_TEXT,
} from '../../src/app/portal/[mandant]/bau/bautagebuch-anzeige.js';
import { ART_TEXT } from '../../src/server/services/security/wachbuch.js';
import { istFensterOffen } from '../../src/server/services/mitarbeiter/schichtbuch.js';
import { SPRACHEN } from '../../src/lib/sprache.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('die vier Sprachen sind vier, und sie sind nicht die der Website', () => {
  it('de · en · ar · tr', () => {
    expect([...PORTAL_SPRACHEN]).toEqual(['de', 'en', 'ar', 'tr']);
  });

  it('die oeffentliche Website bleibt bei zwei — die beiden Mengen sind getrennt', () => {
    /**
     * D-82 gilt fuer `/` und `/en`: eine Seite je Sprache, mit Pfadpraefix.
     * Das Arbeiterportal hat KEIN Sprachsegment (SEITENKARTE §12) — vierzig
     * Routen mal vier Sprachen waeren hundertsechzig Adressen und zwei URLs
     * auf einem § 17-MiLoG-Bildschirm.
     */
    expect([...SPRACHEN]).toEqual(['de', 'en']);
    expect(PORTAL_SPRACHEN.length).toBeGreaterThan(SPRACHEN.length);
  });

  it('`istPortalSprache` laesst nur die vier durch', () => {
    for (const s of PORTAL_SPRACHEN) expect(istPortalSprache(s)).toBe(true);
    for (const s of ['fr', 'pl', 'DE', '', 'ar-EG']) {
      expect(istPortalSprache(s), s).toBe(false);
    }
  });
});

describe('(6) Arabisch setzt `dir="rtl"` — und sonst niemand', () => {
  it('die Richtungstabelle ist vollstaendig und nennt genau eine RTL-Sprache', () => {
    for (const s of PORTAL_SPRACHEN) {
      expect(PORTAL_RICHTUNG[s], s).toMatch(/^(ltr|rtl)$/u);
    }
    expect(PORTAL_SPRACHEN.filter((s) => PORTAL_RICHTUNG[s] === 'rtl')).toEqual(['ar']);
  });

  it('jede Sprache hat ein gueltiges `lang`-Kuerzel (WCAG 3.1.1)', () => {
    for (const s of PORTAL_SPRACHEN) {
      expect(PORTAL_BCP47[s], s).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/u);
    }
    expect(PORTAL_BCP47.ar).toBe('ar');
  });

  it('der Eigenname steht in der eigenen Schrift — nie uebersetzt', () => {
    expect(PORTAL_EIGENNAME.ar).toBe('العربية');
    expect(PORTAL_EIGENNAME.tr).toBe('Türkçe');
    for (const s of PORTAL_SPRACHEN) expect(PORTAL_EIGENNAME[s].length).toBeGreaterThan(2);
  });

  it('die Huelle des Portals setzt `dir` und `lang` aus genau diesen Tabellen', () => {
    /**
     * Die Zusage haengt an EINER Datei. Steht dort ein festes `ltr`, ist die
     * Tabelle oben korrekt und die Seite trotzdem falsch — und kein Test ueber
     * die Tabelle faende das.
     */
    const quelle = readFileSync(join(WURZEL, 'src/app/portal/mein/rahmen.tsx'), 'utf8');
    expect(quelle).toMatch(/dir=\{PORTAL_RICHTUNG\[basis\.sprache\]\}/u);
    expect(quelle).toMatch(/lang=\{PORTAL_BCP47\[basis\.sprache\]\}/u);
  });
});

describe('keine halbe Uebersetzung', () => {
  const deutsch = MEIN_TEXTE.de;
  const schluessel = Object.keys(deutsch) as (keyof typeof deutsch)[];

  it('es gibt ueberhaupt Schluessel zu pruefen', () => {
    // Ohne diese Zusage bestuende jede Schleife unten ueber der leeren Menge.
    expect(schluessel.length).toBeGreaterThan(40);
  });

  it('jede Sprache traegt JEDEN Schluessel, und keiner ist leer', () => {
    for (const s of PORTAL_SPRACHEN) {
      const texte = meinTexte(s);
      expect(Object.keys(texte).sort(), s).toEqual([...schluessel].sort());
      for (const k of schluessel) {
        expect(texte[k].trim(), `${s}.${String(k)}`).not.toBe('');
      }
    }
  });

  it('und keine Sprache ausser Deutsch gibt einfach den deutschen Text zurueck', () => {
    /**
     * Der bequeme Fehler: einen Eintrag kopieren, statt ihn zu uebersetzen.
     * Er faellt in keiner Vollstaendigkeitspruefung auf. Ein paar Woerter sind
     * in mehreren Sprachen gleich („Status"), deshalb wird nicht jeder
     * einzelne Eintrag verlangt, sondern die grosse Mehrheit.
     */
    for (const s of PORTAL_SPRACHEN.filter((x) => x !== 'de')) {
      const texte = meinTexte(s);
      const gleich = schluessel.filter((k) => texte[k] === deutsch[k]);
      expect(gleich.length / schluessel.length, `${s}: ${gleich.join(', ')}`)
        .toBeLessThan(0.15);
    }
  });

  it('die fuenf Einwandarten sind in allen vier Sprachen benannt', () => {
    expect([...EINWAND_ARTEN]).toHaveLength(5);
    for (const s of PORTAL_SPRACHEN) {
      const arten = EINWAND_ART_TEXTE[s];
      expect(Object.keys(arten).sort(), s).toEqual([...EINWAND_ARTEN].sort());
      for (const a of EINWAND_ARTEN) expect(arten[a].trim(), `${s}.${a}`).not.toBe('');
    }
  });

  it('uebersetzt wird das LABEL, nie der Wert (D-83)', () => {
    // Die Schluessel sind das Vokabular des Enums `einwand_art` und reisen in
    // die Datenbank. Sie sind in jeder Sprache dieselben.
    for (const s of PORTAL_SPRACHEN) {
      expect(Object.keys(EINWAND_ART_TEXTE[s])).toEqual(Object.keys(EINWAND_ART_TEXTE.de));
    }
  });

  it('„nicht hinterlegt" (O-18) ist in jeder Sprache ein Satz und keine Null', () => {
    for (const s of PORTAL_SPRACHEN) {
      const texte = meinTexte(s);
      expect(texte.nichtHinterlegt).not.toMatch(/^0/u);
      // Der erklaerende Satz daneben ist der Unterschied zwischen „null Tage"
      // und „wir wissen es nicht".
      expect(texte.nichtHinterlegtErklaerung.length, s).toBeGreaterThan(40);
    }
  });
});

describe('die fuenf Wachbucharten sind in allen vier Sprachen benannt (SEC-05)', () => {
  it('jede Sprache traegt jeden Schluessel, und keiner ist leer', () => {
    expect([...WACHBUCH_ARTEN_I18N]).toHaveLength(5);
    for (const s of PORTAL_SPRACHEN) {
      const arten = WACHBUCH_ART_TEXTE[s];
      expect(Object.keys(arten).sort(), s).toEqual([...WACHBUCH_ARTEN_I18N].sort());
      for (const a of WACHBUCH_ARTEN_I18N) expect(arten[a].trim(), `${s}.${a}`).not.toBe('');
    }
  });

  it('uebersetzt wird das LABEL, nie der Wert (D-83)', () => {
    /**
     * Die Schluessel sind das Vokabular des Enums `wachbuch_art` und reisen
     * unuebersetzt in die Datenbank. Waeren sie es nicht, stuende auf einer
     * arabischen Oberflaeche ein Wert, den `wachbuch_art` nicht kennt — und
     * der Eintrag scheiterte erst beim Absenden, im Treppenhaus.
     */
    for (const s of PORTAL_SPRACHEN) {
      expect(Object.keys(WACHBUCH_ART_TEXTE[s])).toEqual(Object.keys(WACHBUCH_ART_TEXTE.de));
    }
  });

  it('die deutschen Bezeichnungen sind die des Dienstes — zeichengleich', () => {
    /*
     * `ART_TEXT` in `server/services/security/wachbuch.ts` beschriftet das
     * interne Portal. Zwei Woerter fuer dieselbe Art hiessen, dass Buero und
     * Wache ueber verschiedene Dinge zu sprechen glauben.
     */
    expect(WACHBUCH_ART_TEXTE.de).toEqual(ART_TEXT);
  });
});

describe('der Bautag spricht auch arabisch und tuerkisch (BAU-07, EMP-12)', () => {
  /**
   * **Der Befund, gegen den diese Faelle stehen.** `BAUTAG_STATUS_TEXT` und
   * `WETTER_QUELLE_TEXT` waren deutsche Literale in der Anzeigehilfe des
   * INTERNEN Portals, und die Bautagebuchseite des Mitarbeiterportals las sie
   * von dort. Auf einem arabischen Bildschirm stand „Gegengezeichnet
   * (Auftraggeber)" und „keine Quelle". Die Sprachwache sah es nicht, weil sie
   * nur `MEIN_TEXTE` prueft — deshalb prueft sie jetzt auch diese zwei Karten.
   */
  it('jede Sprache traegt jeden Bautagstatus, und keiner ist leer', () => {
    const schluessel = Object.keys(BAUTAG_STATUS_TEXTE.de).sort();
    expect(schluessel).toHaveLength(3);
    for (const s of PORTAL_SPRACHEN) {
      expect(Object.keys(BAUTAG_STATUS_TEXTE[s]).sort(), s).toEqual(schluessel);
      for (const k of schluessel) {
        expect(BAUTAG_STATUS_TEXTE[s][k as keyof typeof BAUTAG_STATUS_TEXTE.de].trim(),
          `${s}.${k}`).not.toBe('');
      }
    }
  });

  it('jede Sprache traegt jede Wetterquelle, und keine ist leer', () => {
    const schluessel = Object.keys(WETTER_QUELLE_TEXTE.de).sort();
    expect(schluessel).toHaveLength(3);
    for (const s of PORTAL_SPRACHEN) {
      expect(Object.keys(WETTER_QUELLE_TEXTE[s]).sort(), s).toEqual(schluessel);
      for (const k of schluessel) {
        expect(WETTER_QUELLE_TEXTE[s][k as keyof typeof WETTER_QUELLE_TEXTE.de].trim(),
          `${s}.${k}`).not.toBe('');
      }
    }
  });

  it('und keine Sprache ausser Deutsch gibt einfach den deutschen Text zurueck', () => {
    for (const s of PORTAL_SPRACHEN) {
      if (s === 'de') continue;
      const gleich = Object.keys(BAUTAG_STATUS_TEXTE.de).filter(
        (k) => BAUTAG_STATUS_TEXTE[s][k as 'entwurf'] === BAUTAG_STATUS_TEXTE.de[k as 'entwurf']);
      expect(gleich, `${s}: Bautagstatus unuebersetzt`).toEqual([]);
    }
    /*
     * Bei der Wetterquelle ist EIN Wert absichtlich gleich: „DWD Open Data"
     * ist ein Eigenname (§ der Deutsche Wetterdienst nennt sein Angebot so)
     * und wird nicht uebersetzt — wie `PORTAL_EIGENNAME` oben.
     */
    for (const s of PORTAL_SPRACHEN) {
      if (s === 'de') continue;
      const gleich = Object.keys(WETTER_QUELLE_TEXTE.de).filter(
        (k) => WETTER_QUELLE_TEXTE[s][k as 'dwd'] === WETTER_QUELLE_TEXTE.de[k as 'dwd']);
      expect(gleich, `${s}: Wetterquelle unuebersetzt`).toEqual(['dwd']);
    }
  });

  it('das interne Portal liest die de-Spalte — zeichengleich mit frueher', () => {
    /*
     * Die Anzeigehilfe des internen Portals leitet ihre zwei Karten jetzt aus
     * der i18n-Tabelle ab. Sie muss dabei WOERTLICH dasselbe sagen wie zuvor,
     * sonst hat der Umzug nebenbei eine Beschriftung geaendert.
     */
    expect(BAUTAG_STATUS_TEXT).toEqual(BAUTAG_STATUS_TEXTE.de);
    expect(WETTER_QUELLE_TEXT).toEqual(WETTER_QUELLE_TEXTE.de);
    expect(BAUTAG_STATUS_TEXT.gegengezeichnet).toBe('Gegengezeichnet (Auftraggeber)');
    expect(WETTER_QUELLE_TEXT.keine).toBe('keine Quelle');
  });
});

describe('das Uebergabefenster kennt DREI Zustaende (SEC-05, O-151)', () => {
  it('nicht eingestellt ist zu', () => {
    expect(istFensterOffen(null)).toBe(false);
  });

  it('eingestellt und NULL ist ebenfalls zu — und das ist nicht dasselbe', () => {
    /*
     * Der Seed setzt `{"interval": "PT0S"}` (0033). `00:00:00` heisst
     * „jemand hat entschieden: aus"; `null` heisst „niemand hat entschieden".
     * Die Seite zeigt denselben Satz, die Daten unterscheiden sie.
     */
    for (const wert of ['00:00:00', '00:00', '00:00:00.000', ' 00:00:00 ']) {
      expect(istFensterOffen(wert), wert).toBe(false);
    }
  });

  it('jede echte Dauer ist offen', () => {
    for (const wert of ['12:00:00', '00:30:00', '1 day', '00:00:01']) {
      expect(istFensterOffen(wert), wert).toBe(true);
    }
  });
});
