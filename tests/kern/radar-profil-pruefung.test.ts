/**
 * Die Eingabeprüfung eines Suchprofils (RAD-04, O-15, O-47, O-98, O-191, O-721).
 *
 * **Was hier geprüft wird, ist keine Formatierung, sondern eine Zusicherung:**
 * der Editor darf keinen Wert speichern, den die Bewertung später nicht lesen
 * kann — und er darf keinen ABWEISEN, den sie lesen könnte. Beide Fehler sind
 * still: ein CPV-Code mit sieben Ziffern läuft in ein `check_violation` nach
 * dem Absenden, ein NUTS-Präfix in falscher Schreibweise engt die Suche ein,
 * ohne dass jemand es sieht.
 *
 * **Und: was gesperrt bleibt, taucht in `ProfilEingabe` nicht auf.** Der
 * letzte Block hält das fest — nicht als Stilregel, sondern weil ein Aufrufer,
 * der `gewichtung` mitgeben KÖNNTE, sie irgendwann mitgibt, und dann stünde
 * eine unbestätigte Gewichtung (O-15) als Einstellung in der Datenbank.
 */
import { describe, expect, it } from 'vitest';
import {
  ProfilFehler, pruefeCpvCode, pruefeFristMinTage, pruefeName, pruefeNutsPraefix,
  pruefePraefixLaenge, pruefeStichwort, pruefeWertgrenzen, teileListe,
} from '../../src/server/services/radar/profil.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';

const c = (wert: number | bigint): Cent => cent(BigInt(wert));

describe('pruefeCpvCode', () => {
  it('nimmt acht Ziffern — mit und ohne Prüfziffer', () => {
    expect(pruefeCpvCode('90910000')).toBe('90910000');
    expect(pruefeCpvCode('90910000-9')).toBe('90910000-9');
    expect(pruefeCpvCode('45000000')).toBe('45000000');
  });

  it('trimmt, bevor es prüft — ein abgeschriebener Code bringt Leerzeichen mit', () => {
    expect(pruefeCpvCode('  90910000 ')).toBe('90910000');
  });

  it('weist sieben und neun Ziffern ab', () => {
    expect(() => pruefeCpvCode('9091000')).toThrow(ProfilFehler);
    expect(() => pruefeCpvCode('909100000')).toThrow(ProfilFehler);
  });

  it('weist Buchstaben, Punkte und leere Eingaben ab', () => {
    for (const roh of ['9091000A', '90.910.000', '', '   ', '90910000-', '90910000-99']) {
      expect(() => pruefeCpvCode(roh), JSON.stringify(roh)).toThrow(ProfilFehler);
    }
  });

  it('gibt die Fehlerart `cpv` — die Seite zeigt daraus einen Satz, keinen Code', () => {
    try {
      pruefeCpvCode('nein');
      throw new Error('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(ProfilFehler);
      expect((fehler as ProfilFehler).code).toBe('cpv');
    }
  });
});

describe('pruefePraefixLaenge', () => {
  it('nimmt 2 bis 8 — genau die Grenzen der Datenbank', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) expect(pruefePraefixLaenge(n)).toBe(n);
  });

  it('weist 1, 9, Bruchzahlen und NaN ab', () => {
    for (const n of [1, 0, -2, 9, 80, 4.5, Number.NaN]) {
      expect(() => pruefePraefixLaenge(n), String(n)).toThrow(ProfilFehler);
    }
  });
});

describe('pruefeNutsPraefix', () => {
  it('nimmt Land, Region und Kreis', () => {
    expect(pruefeNutsPraefix('DE')).toBe('DE');
    expect(pruefeNutsPraefix('DE3')).toBe('DE3');
    expect(pruefeNutsPraefix('DE30')).toBe('DE30');
    expect(pruefeNutsPraefix('DE300')).toBe('DE300');
  });

  it('macht Grossbuchstaben daraus — „de300" und „DE300" sind derselbe Ort', () => {
    /*
     * Die Bewertung vergleicht Praefixe ohne weitere Normalisierung. Ein
     * kleingeschriebenes Praefix traefe nie, und das faellt niemandem auf:
     * die Liste bliebe einfach leer.
     */
    expect(pruefeNutsPraefix('de300')).toBe('DE300');
    expect(pruefeNutsPraefix(' de3 ')).toBe('DE3');
  });

  it('weist ein einzelnes Zeichen und mehr als fünf Stellen ab', () => {
    for (const roh of ['D', '', 'DE3000', 'DE-300', 'D3']) {
      expect(() => pruefeNutsPraefix(roh), JSON.stringify(roh)).toThrow(ProfilFehler);
    }
  });

  it('prüft die Form, nicht die Existenz (O-721)', () => {
    /*
     * `ZZ999` hat die Form eines NUTS-Codes und bezeichnet kein Gebiet. Es
     * geht durch — bewusst: es gibt keine NUTS-Tabelle im Haus, und gegen
     * welche Fassung der amtlichen Liste zu pruefen waere, ist offen. Die
     * Oberflaeche sagt das am Feld, statt eine Pruefung vorzutaeuschen.
     */
    expect(pruefeNutsPraefix('ZZ999')).toBe('ZZ999');
  });
});

describe('teileListe', () => {
  it('trennt nach Zeilenumbruch, Semikolon und Komma', () => {
    expect(teileListe('DE3\nDE4;DE5,DE6')).toEqual(['DE3', 'DE4', 'DE5', 'DE6']);
  });

  it('wirft Leeres weg, ohne die Reihenfolge zu ändern', () => {
    expect(teileListe('a\n\n b \n,,c')).toEqual(['a', 'b', 'c']);
  });

  it('entfernt Doppelte und behält das ERSTE Vorkommen', () => {
    /*
     * Die Reihenfolge geht in den `eingaben_hash` einer Bewertung ein. Eine
     * Umsortierung waere eine Aenderung, die keine ist — und sie erzeugte eine
     * neue Bewertungszeile ohne neuen Inhalt.
     */
    expect(teileListe('b,a,b,c,a')).toEqual(['b', 'a', 'c']);
  });

  it('macht aus null und leer eine leere Liste, nicht eine mit leerem Wort', () => {
    expect(teileListe(null)).toEqual([]);
    expect(teileListe('')).toEqual([]);
    expect(teileListe('  ,  ;\n')).toEqual([]);
  });
});

describe('pruefeStichwort', () => {
  it('nimmt ein Wort und eine kurze Wendung', () => {
    expect(pruefeStichwort(' Unterhaltsreinigung ')).toBe('Unterhaltsreinigung');
    expect(pruefeStichwort('Glas- und Rahmenreinigung')).toBe('Glas- und Rahmenreinigung');
  });

  it('weist Leeres und einen ganzen Satz ab', () => {
    expect(() => pruefeStichwort('   ')).toThrow(ProfilFehler);
    expect(() => pruefeStichwort('x'.repeat(101))).toThrow(ProfilFehler);
    expect(pruefeStichwort('x'.repeat(100))).toHaveLength(100);
  });
});

describe('pruefeWertgrenzen — ganze Cent, nie Gleitkomma (Invariante 1)', () => {
  it('nimmt beide Grenzen, eine allein und keine', () => {
    expect(() => pruefeWertgrenzen(null, null)).not.toThrow();
    expect(() => pruefeWertgrenzen(c(0), null)).not.toThrow();
    expect(() => pruefeWertgrenzen(null, c(50_000_00))).not.toThrow();
    expect(() => pruefeWertgrenzen(c(10_000_00), c(50_000_00))).not.toThrow();
  });

  it('nimmt Gleichheit — „genau eine Million" ist eine gültige Spanne', () => {
    expect(() => pruefeWertgrenzen(c(100_000_000), c(100_000_000))).not.toThrow();
  });

  it('weist eine Obergrenze unter der Untergrenze ab', () => {
    /*
     * Die Datenbank hat dafuer `radar_profil_wertgrenzen`. Hier steht es
     * ebenfalls, damit die Seite einen Satz zeigen kann statt eines
     * `check_violation` — und damit jemand nicht ein Profil speichert, das
     * nie einen Wert trifft und aussieht wie eins, das eng eingestellt ist.
     */
    try {
      pruefeWertgrenzen(c(50_000_00), c(10_000_00));
      throw new Error('hätte werfen müssen');
    } catch (fehler) {
      expect((fehler as ProfilFehler).code).toBe('wert');
    }
  });

  it('weist negative Grenzen ab', () => {
    expect(() => pruefeWertgrenzen(c(-1), null)).toThrow(ProfilFehler);
    expect(() => pruefeWertgrenzen(null, c(-1))).toThrow(ProfilFehler);
  });

  it('rechnet mit bigint — zwei Milliarden Euro sind kein Rundungsproblem', () => {
    /*
     * 2 000 000 000,00 € sind 200_000_000_000 Cent und liegen ueber
     * `Number.MAX_SAFE_INTEGER / 100`. Mit einer Gleitkommazahl waere die
     * Obergrenze hier bereits ungenau; mit `bigint` ist der Vergleich exakt.
     */
    const zweiMilliarden = c(200_000_000_000n);
    const eineMilliarde = c(100_000_000_000n);
    expect(() => pruefeWertgrenzen(eineMilliarde, zweiMilliarden)).not.toThrow();
    expect(() => pruefeWertgrenzen(zweiMilliarden, eineMilliarde)).toThrow(ProfilFehler);
  });
});

describe('pruefeFristMinTage', () => {
  it('nimmt null (keine eigene Grenze) und ganze Tage bis 365', () => {
    expect(pruefeFristMinTage(null)).toBeNull();
    expect(pruefeFristMinTage(0)).toBe(0);
    expect(pruefeFristMinTage(14)).toBe(14);
    expect(pruefeFristMinTage(365)).toBe(365);
  });

  it('weist Bruchtage, negative Werte, 366 und NaN ab', () => {
    for (const n of [-1, 1.5, 366, Number.NaN]) {
      expect(() => pruefeFristMinTage(n), String(n)).toThrow(ProfilFehler);
    }
  });

  it('gibt die Fehlerart `frist`', () => {
    try {
      pruefeFristMinTage(-3);
      throw new Error('hätte werfen müssen');
    } catch (fehler) {
      expect((fehler as ProfilFehler).code).toBe('frist');
    }
  });
});

describe('pruefeName', () => {
  it('trimmt und nimmt bis 120 Zeichen', () => {
    expect(pruefeName('  Unterhaltsreinigung Berlin  ')).toBe('Unterhaltsreinigung Berlin');
    expect(pruefeName('x'.repeat(120))).toHaveLength(120);
  });

  it('weist Leeres und Übergrosses ab — die Datenbank verlangt einen Namen', () => {
    expect(() => pruefeName('')).toThrow(ProfilFehler);
    expect(() => pruefeName('   ')).toThrow(ProfilFehler);
    expect(() => pruefeName('x'.repeat(121))).toThrow(ProfilFehler);
  });
});
