/**
 * Die zweisprachige Website (D-82) — deutsch unter `/`, englisch unter `/en`.
 *
 * **Der Fehler, den diese Datei verhindert, ist nicht ein Tippfehler.** Er ist
 * die halbe Übersetzung: ein Feld, das jemand deutsch ergänzt und englisch
 * vergisst, eine Seite ohne englische Fassung, ein Titel, der deutsch bleibt.
 * Nichts davon bricht etwas — es steht einfach ein deutsches Wort auf der
 * Seite, die jemand liest, WEIL er kein Deutsch kann. Genau deshalb muss es
 * eine Prüfung sein und keine Sorgfalt.
 */
import { describe, expect, it } from 'vitest';
import {
  alternativen, BCP47, EIGENNAME, istSprache, mitSprache, OG_LOCALE, praefix,
  SPRACHEN, VORGABE_SPRACHE, zerlegePfad,
} from '../../src/lib/sprache.js';
import { SHELL_TEXTE, ANFRAGE_TEXTE, API_TEXTE, BARRIERE_TEXTE } from '../../src/lib/i18n/texte.js';
import { FORMULAR_EN, uebersetzeFelder, uebersetzeTitel } from '../../src/lib/i18n/formular-en.js';
import { SEITEN } from '../../src/server/db/seed/inhalt.js';
import { SEITEN_EN } from '../../src/server/db/seed/inhalt-en.js';
import { TITEL_EN } from '../../src/server/db/seed/routen-en.js';
import { FORMULARE } from '../../src/server/db/seed/formulare.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

describe('Pfade und Sprachen', () => {
  it('Deutsch hat keinen Präfix, Englisch hat einen', () => {
    // Die bestehenden deutschen Adressen sind im Umlauf. Ein nachträgliches
    // `/de` davor wäre eine Umleitung für jede einzelne.
    expect(praefix('de')).toBe('');
    expect(praefix('en')).toBe('/en');
    expect(VORGABE_SPRACHE).toBe('de');
  });

  it('zerlegt einen Pfad in Sprache und Inhalt', () => {
    expect(zerlegePfad('/en/kontakt')).toEqual({ sprache: 'en', pfad: '/kontakt' });
    expect(zerlegePfad('/en')).toEqual({ sprache: 'en', pfad: '/' });
    expect(zerlegePfad('/en/')).toEqual({ sprache: 'en', pfad: '/' });
    expect(zerlegePfad('/kontakt')).toEqual({ sprache: 'de', pfad: '/kontakt' });
    expect(zerlegePfad('/')).toEqual({ sprache: 'de', pfad: '/' });
  });

  it('der Präfix muss ein GANZES Segment sein', () => {
    // `/english` fängt mit `en` an und ist trotzdem eine deutsche Seite. Wer
    // hier auf `startsWith` prüft, verliert sie.
    expect(zerlegePfad('/english')).toEqual({ sprache: 'de', pfad: '/english' });
    expect(zerlegePfad('/entwicklung')).toEqual({ sprache: 'de', pfad: '/entwicklung' });
  });

  it('setzt einen Pfad in eine Sprache — und verdoppelt keinen Präfix', () => {
    expect(mitSprache('/kontakt', 'en')).toBe('/en/kontakt');
    expect(mitSprache('/kontakt', 'de')).toBe('/kontakt');
    expect(mitSprache('/', 'en')).toBe('/en');
    expect(mitSprache('/', 'de')).toBe('/');
    // Ein bereits präfigierter Pfad wird zerlegt, nicht verdoppelt.
    expect(mitSprache('/en/kontakt', 'en')).toBe('/en/kontakt');
    expect(mitSprache('/en/kontakt', 'de')).toBe('/kontakt');
  });

  it('Hin und zurück ergibt denselben Pfad', () => {
    for (const p of ['/', '/kontakt', '/reinigung', '/anfrage/bau']) {
      for (const s of SPRACHEN) {
        expect(zerlegePfad(mitSprache(p, s))).toEqual({ sprache: s, pfad: p });
      }
    }
  });

  it('`alternativen` nennt jede Sprache UND x-default', () => {
    const a = alternativen('/kontakt', 'https://x.test');
    expect(a).toEqual({
      'de-DE': 'https://x.test/kontakt',
      en: 'https://x.test/en/kontakt',
      'x-default': 'https://x.test/kontakt',
    });
  });

  it('`alternativen` ist gegenseitig — beide Fassungen nennen dieselbe Menge', () => {
    /**
     * Google wertet `hreflang` nur aus, wenn die Verweise gegenseitig sind.
     * Zeigte die englische Seite auf die deutsche, ohne dass die zurückzeigt,
     * konkurrierten beide um dieselbe Suchanfrage, statt sich zu ergänzen.
     */
    const deutsch = alternativen('/kontakt', 'https://x.test');
    const englisch = alternativen('/en/kontakt', 'https://x.test');
    expect(englisch).toEqual(deutsch);
  });

  it('kein öffentlicher Seitenslug kollidiert mit einem Sprachpräfix', () => {
    /**
     * Gäbe es eine Seite `/en`, wäre `/en` zugleich die englische Startseite
     * und diese Seite — und welche gewinnt, entschiede die Reihenfolge im
     * Dateibaum. Eine Kollision ist deshalb ein Fehler und kein Sonderfall.
     */
    const slugs = OEFFENTLICHE_ROUTEN.map((r) => r.pfad.split('/')[1] ?? '');
    const kollision = slugs.filter((s) => s !== '' && istSprache(s));
    expect(kollision).toEqual([]);
  });

  it('jede Sprache hat BCP47, OG-Locale und einen Eigennamen', () => {
    for (const s of SPRACHEN) {
      expect(BCP47[s], s).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/u);
      expect(OG_LOCALE[s], s).toMatch(/^[a-z]{2}_[A-Z]{2}$/u);
      // Der Name der Sprache steht IN ihrer Sprache — "Deutsch", nicht "German".
      expect(EIGENNAME[s], s).not.toBe('');
    }
  });
});

describe('die Beschriftungen sind in beiden Sprachen vollständig', () => {
  it('kein leerer Text in der Hülle', () => {
    for (const s of SPRACHEN) {
      const t = SHELL_TEXTE[s];
      for (const [k, v] of Object.entries(t.navigation)) expect(v, `${s}.${k}`).not.toBe('');
      for (const [k, v] of Object.entries(t.rechtlich)) expect(v, `${s}.${k}`).not.toBe('');
      expect(t.hauptnavigation, s).not.toBe('');
      expect(t.sprachwahl, s).not.toBe('');
    }
  });

  it('die englische Fassung nennt die deutsche als die rechtsverbindliche', () => {
    // §5 TMG und DSGVO Art. 13 verlangen die Pflichtangaben auf Deutsch. Eine
    // englische Fassung ohne diesen Satz sähe aus wie die geltende.
    expect(SHELL_TEXTE.en.rechtsverbindlichHinweis).not.toBe('');
    expect(SHELL_TEXTE.en.rechtsverbindlichHinweis.toLowerCase()).toContain('german');
    // Deutsch braucht ihn nicht — dort IST es die geltende Fassung.
    expect(SHELL_TEXTE.de.rechtsverbindlichHinweis).toBe('');
  });

  it('Formular- und API-Texte sind in beiden Sprachen gesetzt', () => {
    for (const s of SPRACHEN) {
      for (const [k, v] of Object.entries(ANFRAGE_TEXTE[s])) expect(v, `${s}.${k}`).not.toBe('');
      for (const [k, v] of Object.entries(API_TEXTE[s])) expect(v, `${s}.${k}`).not.toBe('');
      for (const [k, v] of Object.entries(BARRIERE_TEXTE[s])) expect(v, `${s}.${k}`).not.toBe('');
    }
  });

  it('deutsch und englisch sagen NICHT dasselbe Wort — sonst ist nichts übersetzt', () => {
    // Eine Kopie der deutschen Werte in den englischen Block bestünde jede
    // Vollständigkeitsprüfung und wäre keine Übersetzung.
    expect(SHELL_TEXTE.en.navigation.leistungen).not.toBe(SHELL_TEXTE.de.navigation.leistungen);
    expect(ANFRAGE_TEXTE.en.absenden).not.toBe(ANFRAGE_TEXTE.de.absenden);
    expect(API_TEXTE.en.dank).not.toBe(API_TEXTE.de.dank);
  });
});

describe('jede Seite gibt es in beiden Sprachen', () => {
  it('dieselben Pfade, keine Seite mehr und keine weniger', () => {
    const de = SEITEN.map((s) => s.pfad).sort();
    const en = SEITEN_EN.map((s) => s.pfad).sort();
    // Eine englische Seite ohne deutsche Fassung wäre ein toter Verweis in der
    // Sprachwahl; eine deutsche ohne englische ein Sprung auf eine 404.
    expect(en).toEqual(de);
  });

  it('jede öffentliche Route hat einen englischen Titel', () => {
    const fehlend = OEFFENTLICHE_ROUTEN.map((r) => r.pfad).filter((p) => TITEL_EN[p] === undefined);
    expect(fehlend).toEqual([]);
  });

  it('die englischen Abschnitte haben dieselbe Struktur wie die deutschen', () => {
    /**
     * Gleiche Reihenfolge, gleiche Arten. Eine englische Seite mit einer
     * Abschnittsart weniger rendert ohne Fehler — sie zeigt nur die
     * Leistungsliste nicht, und das fällt erst dem Kunden auf.
     */
    const en = new Map(SEITEN_EN.map((s) => [s.pfad, s]));
    for (const d of SEITEN) {
      const e = en.get(d.pfad);
      expect(e, d.pfad).toBeDefined();
      expect(e!.abschnitte.map((a) => a.art), d.pfad).toEqual(d.abschnitte.map((a) => a.art));
    }
  });

  it('kein englischer Text ist bloss der deutsche', () => {
    const en = new Map(SEITEN_EN.map((s) => [s.pfad, s]));
    for (const d of SEITEN) {
      const e = en.get(d.pfad)!;
      expect(e.beschreibung, `${d.pfad} Beschreibung`).not.toBe(d.beschreibung);
    }
  });
});

describe('jedes Formularfeld ist übersetzt — sonst bricht der Build', () => {
  it('jede Vorlage hat eine englische Fassung', () => {
    const fehlend = FORMULARE.map((f) => f.schluessel)
      .filter((s) => FORMULAR_EN[s] === undefined);
    expect(fehlend).toEqual([]);
  });

  it('jedes Feld jeder Vorlage hat Label und Fehlermeldung auf Englisch', () => {
    const fehlend: string[] = [];
    for (const f of FORMULARE) {
      const en = FORMULAR_EN[f.schluessel];
      // NICHT `continue`: eine fehlende Vorlage machte diese Prüfung leer, und
      // eine leere Prüfung besteht immer. Genau so bestand sie beim ersten
      // Anlauf über vier Formulare, deren Schlüssel ich erfunden hatte.
      if (en === undefined) { fehlend.push(`${f.schluessel} (Vorlage fehlt)`); continue; }
      for (const feld of f.felder) {
        const t = en.felder[feld.schluessel];
        if (t === undefined) { fehlend.push(`${f.schluessel}.${feld.schluessel}`); continue; }
        if (t.label === '') fehlend.push(`${f.schluessel}.${feld.schluessel}.label`);
        if (t.fehlermeldung === '') fehlend.push(`${f.schluessel}.${feld.schluessel}.fehler`);
      }
    }
    /**
     * Ein deutsches Pflichtfeld auf einem englischen Formular ist nicht nur
     * unschön: die Fehlermeldung, die erklärt, WAS zu tun ist (WCAG 3.3.3),
     * erklärt es dann in einer Sprache, die der Besucher nicht liest.
     */
    expect(fehlend).toEqual([]);
  });

  it('jede Auswahloption ist übersetzt — auch die letzte', () => {
    const fehlend: string[] = [];
    for (const f of FORMULARE) {
      const en = FORMULAR_EN[f.schluessel];
      if (en === undefined) { fehlend.push(`${f.schluessel} (Vorlage fehlt)`); continue; }
      for (const feld of f.felder) {
        if (!('optionen' in feld) || feld.optionen === undefined) continue;
        const t = en.felder[feld.schluessel];
        for (const o of feld.optionen) {
          if (t?.optionen?.[o.wert] === undefined) {
            fehlend.push(`${f.schluessel}.${feld.schluessel}.${o.wert}`);
          }
        }
      }
    }
    expect(fehlend).toEqual([]);
  });

  it('ein Hilfetext, den es deutsch gibt, gibt es auch englisch', () => {
    const fehlend: string[] = [];
    for (const f of FORMULARE) {
      const en = FORMULAR_EN[f.schluessel];
      if (en === undefined) { fehlend.push(`${f.schluessel} (Vorlage fehlt)`); continue; }
      for (const feld of f.felder) {
        if (feld.hilfetext === undefined) continue;
        if (en.felder[feld.schluessel]?.hilfetext === undefined) {
          fehlend.push(`${f.schluessel}.${feld.schluessel}`);
        }
      }
    }
    expect(fehlend).toEqual([]);
  });
});

describe('die Auflage ändert nur, was gelesen wird', () => {
  const reinigung = FORMULARE.find((f) => f.slug === 'reinigung')!;

  it('Struktur, Pflicht, Typ und Optionswerte bleiben unverändert', () => {
    const uebersetzt = uebersetzeFelder(reinigung.schluessel, reinigung.felder);
    expect(uebersetzt.length).toBe(reinigung.felder.length);
    uebersetzt.forEach((f, i) => {
      const d = reinigung.felder[i]!;
      expect(f.schluessel).toBe(d.schluessel);
      expect(f.typ).toBe(d.typ);
      expect(f.pflicht).toBe(d.pflicht);
      expect(f.sortierung).toBe(d.sortierung);
      if ('optionen' in d && 'optionen' in f) {
        // Die WERTE sind der gespeicherte Inhalt und werden nie übersetzt —
        // sonst stünde in `formular_eingang` je nach Sprache etwas anderes.
        expect(f.optionen.map((o) => o.wert)).toEqual(d.optionen.map((o) => o.wert));
      }
    });
  });

  it('die Beschriftungen sind danach englisch', () => {
    const uebersetzt = uebersetzeFelder(reinigung.schluessel, reinigung.felder);
    const gebaeudetyp = uebersetzt.find((f) => f.schluessel === 'gebaeudetyp')!;
    expect(gebaeudetyp.label).toBe('Type of building');
    expect('optionen' in gebaeudetyp).toBe(true);
    if ('optionen' in gebaeudetyp) {
      expect(gebaeudetyp.optionen.find((o) => o.wert === 'buero')?.label)
        .toBe('Office building');
    }
    expect(uebersetzeTitel(reinigung.schluessel, reinigung.titel))
      .toBe('Request a quote for building cleaning');
  });

  it('ein unbekanntes Formular bleibt unverändert, statt zu werfen', () => {
    // Eine Auflage, die bei einem unbekannten Schlüssel wirft, nähme ein
    // funktionierendes deutsches Formular vom Netz.
    expect(uebersetzeFelder('gibtesnicht', reinigung.felder)).toEqual(reinigung.felder);
    expect(uebersetzeTitel('gibtesnicht', 'Titel')).toBe('Titel');
  });
});
