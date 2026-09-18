/**
 * Die Ablage, ohne Datenbank und ohne Speicher (DOC-01, DOC-06).
 *
 * Geprüft wird die Beschriftung, nicht die Datei: den Typ prüft
 * `storage/mime.ts` an den BYTES, und das steht in `tests/kern/dokument.test.ts`.
 * Hier geht es um die Felder, die ein Mensch tippt — und um die zwei, die
 * still falsch werden können: eine unbekannte Kategorie (an ihr hängt die
 * Aufbewahrungsfrist) und eine Schlagwortliste, die dieselbe Marke dreimal
 * trägt.
 */
import { describe, expect, it } from 'vitest';
import {
  AblageFehler, TAG_HOECHSTZAHL, TAG_LAENGE, istKategorie, leseTags, pruefeFelder,
} from '../../src/server/services/dokument/ablage.js';
import { KATEGORIEN } from '../../src/server/services/dokument/kategorie.js';

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);   // `%PDF-`

function eingabe(ueber: Record<string, unknown> = {}) {
  return {
    kategorie: 'vertrag',
    titel: 'Rahmenvertrag 2026',
    beschreibung: '',
    tags: '',
    kundeId: '',
    objektId: '',
    sichtbarFuerMitarbeiter: false,
    dateiname: 'vertrag.pdf',
    daten: BYTES,
    behaupteterTyp: 'application/pdf',
    ...ueber,
  };
}

describe('leseTags', () => {
  it('trennt am Komma und wirft Leerraum weg', () => {
    expect(leseTags(' Rahmenvertrag , 2026 ')).toEqual(['Rahmenvertrag', '2026']);
  });

  it('lässt leere Stücke fallen statt leere Schlagworte anzulegen', () => {
    expect(leseTags(',,a,,,b,')).toEqual(['a', 'b']);
    expect(leseTags('   ')).toEqual([]);
  });

  it('fasst doppelte zusammen — auch über die Schreibweise hinweg', () => {
    /*
     * Zwei Marken, die sich nur in der Grossschreibung unterscheiden, sind
     * eine: der Filter der Ablage sucht nach Gleichheit, und `GmbH` neben
     * `gmbh` teilte dieselben Dokumente auf zwei Listen auf.
     */
    expect(leseTags('GmbH, gmbh, GMBH')).toEqual(['GmbH']);
  });

  it('behält die ERSTE Schreibweise — die, die der Mensch gesehen hat', () => {
    expect(leseTags('gmbh, GmbH')).toEqual(['gmbh']);
  });

  it('kürzt ein zu langes Schlagwort, statt es abzuweisen', () => {
    const lang = 'x'.repeat(TAG_LAENGE + 20);
    expect(leseTags(lang)[0]).toHaveLength(TAG_LAENGE);
  });

  it('nimmt höchstens die vereinbarte Zahl', () => {
    const viele = Array.from({ length: TAG_HOECHSTZAHL + 5 }, (_, i) => `t${String(i)}`);
    expect(leseTags(viele.join(','))).toHaveLength(TAG_HOECHSTZAHL);
  });
});

describe('istKategorie — die neun aus DOC-01, geschlossen', () => {
  it('kennt jede der neun', () => {
    for (const k of KATEGORIEN) expect(istKategorie(k), k).toBe(true);
  });

  it('und keine zehnte', () => {
    for (const fremd of ['', 'sonstiges', 'Rechnung', 'personal']) {
      expect(istKategorie(fremd), fremd).toBe(false);
    }
  });
});

describe('pruefeFelder', () => {
  it('nimmt eine vollständige Eingabe an und trimmt den Titel', () => {
    const g = pruefeFelder(eingabe({ titel: '  Rahmenvertrag  ' }));
    expect(g.titel).toBe('Rahmenvertrag');
    expect(g.kategorie).toBe('vertrag');
    expect(g.beschreibung).toBeNull();
    expect(g.kundeId).toBeNull();
    expect(g.objektId).toBeNull();
  });

  it('ohne Titel nicht — ein Dokument ohne Titel findet niemand wieder', () => {
    expect(() => pruefeFelder(eingabe({ titel: '   ' }))).toThrow(AblageFehler);
  });

  it('und nicht mit einer Kategorie, die es nicht gibt', () => {
    /*
     * An der Kategorie hängt die Aufbewahrungsfrist (DOC-07). Eine zehnte zu
     * erfinden hiesse, eine Frist zu erfinden — und die Datenbank nähme sie
     * ohnehin nicht an (`dokument_kategorie` ist ein ENUM).
     */
    expect(() => pruefeFelder(eingabe({ kategorie: 'sonstiges' }))).toThrow(/DOC-01/u);
    expect(() => pruefeFelder(eingabe({ kategorie: '' }))).toThrow(AblageFehler);
  });

  it('weist eine Kennung ab, die keine ist — statt sie an die Datenbank zu geben', () => {
    // `where id = 'nein'::uuid` wäre ein 500 mit „invalid input syntax",
    // nicht eine Auskunft.
    expect(() => pruefeFelder(eingabe({ kundeId: 'nein' }))).toThrow(/Kunde/u);
    expect(() => pruefeFelder(eingabe({ objektId: '123' }))).toThrow(/Objekt/u);
  });

  it('nimmt eine gültige Kennung an', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const g = pruefeFelder(eingabe({ kundeId: id, objektId: id }));
    expect(g.kundeId).toBe(id);
    expect(g.objektId).toBe(id);
  });

  it('und keine leere Datei', () => {
    expect(() => pruefeFelder(eingabe({ daten: new Uint8Array(0) })))
      .toThrow(/keine Datei/u);
  });

  it('die Sichtbarkeit für Beschäftigte ist AUS, bis jemand sie anhakt (DOC-04)', () => {
    expect(pruefeFelder(eingabe()).sichtbarFuerMitarbeiter).toBe(false);
    expect(pruefeFelder(eingabe({ sichtbarFuerMitarbeiter: true })).sichtbarFuerMitarbeiter)
      .toBe(true);
  });

  it('Schlagworte gehen durch dieselbe Leseregel', () => {
    expect(pruefeFelder(eingabe({ tags: 'a, a , b' })).tags).toEqual(['a', 'b']);
  });
});
