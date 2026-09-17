/**
 * Die reinen Funktionen der Stammdatenpflege — ohne Datenbank, ohne Sitzung
 * (OPS-02, OPS-03, SEC-01, EMP-05, EMP-10; SEITENKARTE §5.13).
 *
 * **Was hier geprueft wird, ist die Schicht, die eine Fehleingabe in einen
 * SATZ verwandelt.** Die Schranken selbst stehen in der Datenbank
 * (`aa_schluessel_form`, `belagsart_zeitraum_eindeutig`,
 * `qualifikation_warnstufen`, `reinigungsklasse_code_uk`) und werden in
 * `tests/isolation/stammdaten.test.ts` gegen echtes Postgres geprueft. Diese
 * Datei prueft die erste Linie: dass die Meldung am FELD entsteht und nicht
 * als SQLSTATE auf dem Bildschirm.
 *
 * **Die Datierung ist der teuerste Fall.** `pruefeDatierung` entscheidet, ob
 * die laufende Fassung eines Leistungswerts zum Vortag geschlossen wird — und
 * `vortag` rechnet dieses Datum. Beides ohne Datenbank testbar zu halten ist
 * Absicht: ein Monatsende, ein Jahreswechsel und ein Schalttag sind drei
 * Faelle, die in einer Integrationsprobe niemand aufschreibt.
 */
import { describe, expect, it } from 'vitest';
import {
  StammdatenFehler, ganzzahlOderNull, i18nAus, isoDatum, pflegbar, pflichttext,
  pruefeSchluessel, sperrgrund,
} from '../../src/server/services/stammdaten/katalog.js';
import {
  alsLeistungswert, pruefeBelagsartEingabe, pruefeDatierung, vortag,
} from '../../src/server/services/stammdaten/belagsart.js';
import { pruefeWarnstufen, pruefeQualifikationEingabe }
  from '../../src/server/services/stammdaten/qualifikation.js';
import { pruefeAntragsartEingabe, SCHALTER }
  from '../../src/server/services/stammdaten/antragsart.js';
import { pruefeArtEingabe } from '../../src/server/services/stammdaten/abwesenheitsart.js';
import { pruefeKlasseEingabe }
  from '../../src/server/services/stammdaten/reinigungsklasse.js';

/** Ein Formular, wie ein `FormData`-Leser es liefert. */
const formular = (werte: Readonly<Record<string, string>>) =>
  (feld: string): string | null => werte[feld] ?? null;

describe('der Schlüssel eines Katalogeintrags', () => {
  it('nimmt die Form, die auch die Datenbank prüft', () => {
    expect(pruefeSchluessel('urlaub_halbtags')).toBe('urlaub_halbtags');
    expect(pruefeSchluessel('  hitzefrei ')).toBe('hitzefrei');
  });

  it('wird kleingeschrieben, weil der Rechner das kann', () => {
    expect(pruefeSchluessel('Hitzefrei')).toBe('hitzefrei');
  });

  it('erfindet aber nichts: ein Leerzeichen wird kein Unterstrich', () => {
    // `urlaub halbtags` und `urlaub_halbtags` sind zwei Schluessel in einem
    // Lohnexport — geraten wird hier keiner.
    expect(() => pruefeSchluessel('urlaub halbtags')).toThrow(StammdatenFehler);
  });

  it.each([
    ['', 'leer'],
    ['a', 'ein Zeichen — die Form verlangt mindestens zwei'],
    ['9urlaub', 'beginnt mit einer Ziffer'],
    ['urlaub-halb', 'Bindestrich'],
    ['ü', 'Umlaut'],
    ['a'.repeat(42), '42 Zeichen'],
  ])('weist „%s" ab (%s)', (eingabe) => {
    expect(() => pruefeSchluessel(eingabe)).toThrow(StammdatenFehler);
  });
});

describe('Pflichtfelder und Zahlen', () => {
  it('ein Pflichttext ohne Inhalt nennt das Feld', () => {
    expect(() => pflichttext('   ', 'Bezeichnung')).toThrow(/Bezeichnung/u);
    expect(pflichttext(' Urlaub ', 'Bezeichnung')).toBe('Urlaub');
  });

  it('eine leere Zahl ist NULL und nicht 0', () => {
    // Der Unterschied ist die ganze Aussage: `0` heisst „ab dem ersten Tag ein
    // Nachweis", leer heisst „ungeklaert" (O-139).
    expect(ganzzahlOderNull('', 'Nachweis ab Tag')).toBeNull();
    expect(ganzzahlOderNull('0', 'Nachweis ab Tag')).toBe(0);
    expect(ganzzahlOderNull('3', 'Nachweis ab Tag')).toBe(3);
  });

  it('und keine halbe Zahl', () => {
    expect(() => ganzzahlOderNull('3,5', 'Sortierung')).toThrow(StammdatenFehler);
    expect(() => ganzzahlOderNull('-1', 'Sortierung')).toThrow(StammdatenFehler);
  });

  it('ein Datum reist als Text, nie durch eine Zeitzone', () => {
    expect(isoDatum('2026-03-01', 'Gültig ab')).toBe('2026-03-01');
    expect(() => isoDatum('1.3.2026', 'Gültig ab')).toThrow(StammdatenFehler);
    expect(() => isoDatum(null, 'Gültig ab')).toThrow(/Gültig ab/u);
  });
});

describe('die vier Arbeitersprachen', () => {
  it('nimmt genau de/en/ar/tr und lässt Leeres weg', () => {
    const karte = i18nAus(formular({
      i18n_en: 'Annual leave', i18n_ar: 'إجازة', i18n_tr: '   ',
      i18n_fr: 'Congé', i18n_de: 'ignoriert',
    }), 'Urlaub');
    expect(karte).toEqual({ de: 'Urlaub', en: 'Annual leave', ar: 'إجازة' });
  });

  it('eine leere Fassung wird nicht hinterlegt', () => {
    // Sonst stünde im Antragsformular ein Eintrag ohne Text — auswählbar und
    // unlesbar.
    expect(i18nAus(formular({}), 'Urlaub')).toEqual({ de: 'Urlaub' });
  });
});

describe('welche Zeile die Seite zum Ändern anbietet', () => {
  const plattform = { istPlattform: true };
  const eigen = { istPlattform: false };
  const system = { istPlattform: true, istSystem: true };

  it('eine eigene Zeile immer', () => {
    expect(pflegbar(eigen, false)).toBe(true);
    expect(sperrgrund(eigen, false)).toBeNull();
  });

  it('eine Plattformzeile nur dem Super-Admin', () => {
    expect(pflegbar(plattform, false)).toBe(false);
    expect(pflegbar(plattform, true)).toBe(true);
    expect(sperrgrund(plattform, false)).toMatch(/Plattformkatalog/u);
  });

  it('eine Systemzeile niemandem — auch dem Super-Admin nicht', () => {
    expect(pflegbar(system, true)).toBe(false);
    expect(sperrgrund(system, true)).toMatch(/unveränderlich/u);
  });
});

describe('der Leistungswert einer Belagsart', () => {
  it('reist als Text mit drei Nachkommastellen, nie als Gleitkommazahl', () => {
    expect(alsLeistungswert('250')).toBe('250.000');
    expect(alsLeistungswert('187,5')).toBe('187.500');
    expect(alsLeistungswert('187.500')).toBe('187.500');
  });

  it('kennt kein 0 m²/h', () => {
    // `belagsart_leistungswert_positiv` weist es ab; eine Sollzeit daraus
    // waere unendlich.
    expect(() => alsLeistungswert('0')).toThrow(StammdatenFehler);
    expect(() => alsLeistungswert('0,000')).toThrow(StammdatenFehler);
  });

  it('und keinen Text und keine vier Nachkommastellen', () => {
    expect(() => alsLeistungswert('viel')).toThrow(StammdatenFehler);
    expect(() => alsLeistungswert('250,0001')).toThrow(StammdatenFehler);
  });
});

describe('der Vortag — ohne Uhr und ohne Zeitzone', () => {
  it('am Monatsanfang', () => {
    expect(vortag('2026-03-01')).toBe('2026-02-28');
  });

  it('am Jahreswechsel', () => {
    expect(vortag('2027-01-01')).toBe('2026-12-31');
  });

  it('und am Schalttag', () => {
    // 2028 ist ein Schaltjahr: der Vortag des 1. Maerz ist der 29. Februar.
    expect(vortag('2028-03-01')).toBe('2028-02-29');
  });

  it('auch über die Sommerzeitumstellung hinweg', () => {
    // Der 29.03.2026 ist der Tag der Umstellung. Ein Datum ist hier ein
    // Kalendertag und keine Dauer — die Stunde, die fehlt, darf ihn nicht
    // verschieben (K-11).
    expect(vortag('2026-03-30')).toBe('2026-03-29');
    expect(vortag('2026-10-26')).toBe('2026-10-25');
  });
});

describe('die Datierung einer neuen Fassung', () => {
  it('ohne laufende Fassung ist die neue die erste', () => {
    expect(pruefeDatierung('2026-01-01', null)).toEqual({ art: 'erste' });
  });

  it('eine spätere Fassung schliesst die laufende zum Vortag', () => {
    expect(pruefeDatierung('2026-07-01', '2026-01-01'))
      .toEqual({ art: 'ablösung', schliesseZu: '2026-06-30' });
  });

  it('am selben Tag wird abgewiesen, nicht überschrieben', () => {
    const befund = pruefeDatierung('2026-01-01', '2026-01-01');
    expect(befund.art).toBe('fehler');
    expect(befund.art === 'fehler' ? befund.satz : '').toMatch(/2026-01-01/u);
  });

  it('und vor der laufenden Fassung ebenfalls', () => {
    // Die alte zum Vortag zu schliessen ergaebe `gueltig_bis < gueltig_ab`.
    expect(pruefeDatierung('2025-12-01', '2026-01-01').art).toBe('fehler');
  });
});

describe('die Eingabe einer Belagsart', () => {
  it('verlangt eine Quelle — ein Wert ohne Herkunft ist nicht verteidigbar', () => {
    expect(() => pruefeBelagsartEingabe(formular({
      code: 'PVC', bezeichnung: 'PVC-Boden', leistungswert: '250',
      gueltigAb: '2026-01-01',
    }))).toThrow(/Quelle/u);
  });

  it('und ist ohne „bestätigt" ein Platzhalter (O-17)', () => {
    const e = pruefeBelagsartEingabe(formular({
      code: 'PVC', bezeichnung: 'PVC-Boden', leistungswert: '250',
      quelle: 'Zeitaufnahme 2026', gueltigAb: '2026-01-01',
    }));
    expect(e.bestaetigt).toBe(false);
    expect(e.leistungswert).toBe('250.000');
  });
});

describe('die Warnstufen einer Qualifikation', () => {
  it('leer heisst die Vorgabe aus SPEC §14', () => {
    expect(pruefeWarnstufen('')).toEqual([60, 30, 7]);
  });

  it('sortiert absteigend und entfernt Dubletten', () => {
    expect(pruefeWarnstufen('7, 30, 60, 30')).toEqual([60, 30, 7]);
    expect(pruefeWarnstufen('90 14')).toEqual([90, 14]);
  });

  it('kennt keine Stufe 0 — das hiesse „immer warnen"', () => {
    expect(() => pruefeWarnstufen('60, 0')).toThrow(StammdatenFehler);
    expect(() => pruefeWarnstufen('bald')).toThrow(StammdatenFehler);
  });
});

describe('die Eingabe einer Qualifikation', () => {
  const basis = {
    schluessel: 'hausordnung', bezeichnung: 'Hausordnungsschulung',
    kategorie: 'intern', warnungTage: '60,30,7',
  };

  it('nimmt genau die fünf Kategorien des Aufzählungstyps (O-144)', () => {
    expect(pruefeQualifikationEingabe(formular(basis), false).kategorie).toBe('intern');
    expect(() => pruefeQualifikationEingabe(
      formular({ ...basis, kategorie: 'sonstiges' }), false)).toThrow(/Kategorie/u);
  });

  it('lässt die Standardgültigkeit leer, wo O-341 offen ist', () => {
    const e = pruefeQualifikationEingabe(formular({ ...basis, laeuftAb: 'ja' }), false);
    expect(e.standardGueltigkeitMonate).toBeNull();
    expect(e.laeuftAb).toBe(true);
  });

  it('weist eine Frist an einer Qualifikation ab, die nicht abläuft', () => {
    // Eine bestandene Sachkundepruefung verfaellt nicht; ein Ablaufdatum
    // darauf waere eine erfundene Frist.
    expect(() => pruefeQualifikationEingabe(
      formular({ ...basis, standardGueltigkeitMonate: '24' }), false))
      .toThrow(/nicht abläuft/u);
  });

  it('und eine Frist von 0 Monaten', () => {
    expect(() => pruefeQualifikationEingabe(
      formular({ ...basis, laeuftAb: 'ja', standardGueltigkeitMonate: '0' }), false))
      .toThrow(StammdatenFehler);
  });
});

describe('die Eingabe einer Antragsart', () => {
  const basis = { schluessel: 'freistellung', bezeichnung: 'Unbezahlte Freistellung' };

  it('führt sechs Schalter, und jeder nennt, wo er wirkt', () => {
    expect(SCHALTER).toHaveLength(6);
    expect(SCHALTER.filter((s) => s.wo === 'formular')).toHaveLength(4);
    // Die zwei, die das Formular NICHT erreichen — und die teureren sind.
    expect(SCHALTER.find((s) => s.feld === 'erzeugtAbwesenheit')?.wo).toBe('entscheidung');
    expect(SCHALTER.find((s) => s.feld === 'istStammdatenaenderung')?.wo).toBe('datenbank');
  });

  it('erzeugt eine Abwesenheit nur mit Zeitraum UND Abwesenheitsart', () => {
    // Sonst scheitert erst die GENEHMIGUNG, an einem NOT NULL in
    // `abwesenheit` — an einer Stelle, an der niemand nach dem Katalog sucht.
    expect(() => pruefeAntragsartEingabe(
      formular({ ...basis, erzeugtAbwesenheit: 'ja', erfordertZeitraum: 'ja' }), false))
      .toThrow(/Zeitraum UND Abwesenheitsart/u);
    const e = pruefeAntragsartEingabe(formular({
      ...basis, erzeugtAbwesenheit: 'ja', erfordertZeitraum: 'ja',
      erfordertAbwesenheitsart: 'ja',
    }), false);
    expect(e.erzeugtAbwesenheit).toBe(true);
  });

  it('eine Art ohne Folgewirkung ist erlaubt', () => {
    const e = pruefeAntragsartEingabe(formular(basis), false);
    expect(e.erzeugtAbwesenheit).toBe(false);
    expect(e.plattform).toBe(false);
  });
});

describe('die Eingabe einer Abwesenheitsart', () => {
  const basis = { schluessel: 'hitzefrei', bezeichnung: 'Hitzefrei' };

  it('kennt drei Zustände von „bezahlt" — nicht zwei', () => {
    expect(pruefeArtEingabe(formular({ ...basis, bezahlt: 'ja' }), false).bezahlt).toBe(true);
    expect(pruefeArtEingabe(formular({ ...basis, bezahlt: 'nein' }), false).bezahlt).toBe(false);
    // „offen" ist NICHT „nein": der Dienst weist die Verwendung ab (O-139).
    expect(pruefeArtEingabe(formular({ ...basis, bezahlt: 'offen' }), false).bezahlt).toBeNull();
  });

  it('und verlangt die Angabe ausdrücklich', () => {
    expect(() => pruefeArtEingabe(formular(basis), false)).toThrow(/ungeklärt/u);
  });

  it('nimmt nur die semantischen Farbtokens aus DESIGN §1', () => {
    expect(pruefeArtEingabe(
      formular({ ...basis, bezahlt: 'ja', farbeToken: 'warning' }), false).farbeToken)
      .toBe('warning');
    expect(() => pruefeArtEingabe(
      formular({ ...basis, bezahlt: 'ja', farbeToken: '#ff0000' }), false))
      .toThrow(/Farbtoken/u);
  });
});

describe('die Eingabe einer Reinigungsklasse', () => {
  it('nimmt den Code, wie er im Raumbuch des Kunden steht', () => {
    const e = pruefeKlasseEingabe(formular({
      code: ' RK 1 ', bezeichnung: 'Büro', sortierung: '10',
    }));
    // Getrimmt, aber nicht umgeschrieben: der Import vergleicht auf Gleichheit.
    expect(e.code).toBe('RK 1');
    expect(e.sortierung).toBe(10);
    expect(e.bestaetigt).toBe(false);
  });

  it('ohne Sortierung ist sie 0 und nicht „irgendwo"', () => {
    expect(pruefeKlasseEingabe(formular({ code: 'RK2', bezeichnung: 'Sanitär' })).sortierung)
      .toBe(0);
  });

  it('und ein Code ohne Inhalt wird abgewiesen', () => {
    expect(() => pruefeKlasseEingabe(formular({ bezeichnung: 'Büro' }))).toThrow(/Code/u);
  });
});
