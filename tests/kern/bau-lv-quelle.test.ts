/**
 * Der LV-Leser (O-41) — was er liest, was er ABWEIST und was er nie tut.
 *
 * Drei Zusagen stehen hier, und jede kostet Geld, wenn sie fällt:
 *
 *  1. **Der Einheitspreis wird in ganzen Cent gelesen oder gar nicht.**
 *     `12,99` sind 1299 Cent. Eine dritte Dezimalstelle (`12,345`) wird
 *     ABGEWIESEN und nicht gerundet: eine Rundung hier entschiede für den
 *     Auftraggeber, und die Differenz taucht mal 3000 m² in der
 *     Schlussrechnung wieder auf.
 *  2. **Ein nicht implementiertes Format wird abgewiesen, nicht halb
 *     gelesen.** Ein GAEB-Leser, der die erste Ebene versteht und
 *     Zuschlagspositionen übersieht, meldet Erfolg und liefert ein
 *     unvollständiges LV. Das ist teurer als eine klare Auskunft.
 *  3. **Die Art der Zeile wird aus der OZ-Tiefe abgeleitet, wenn die Quelle
 *     sie nicht nennt** — sonst trüge jeder Titel eine Menge.
 */
import { describe, expect, it } from 'vitest';
import {
  CSV_QUELLE, LV_FORMATE, LV_FORMAT_TEXT, LvQuelleFehler, istLvFormat, lvQuelle,
  ordneSpaltenZu,
} from '../../src/server/services/bau/lv-quelle.js';
import { elternOz } from '../../src/server/services/bau/lv-import.js';

const KOPF = 'OZ;Art;Kurztext;Einheit;Menge;Einheitspreis;Positionsart';

function lese(...zeilen: readonly string[]) {
  return CSV_QUELLE.lese([KOPF, ...zeilen].join('\n'));
}

describe('der Einheitspreis — ganze Cent oder ein Fehler', () => {
  it('liest deutsches Dezimalkomma in Cent', () => {
    const { zeilen } = lese(
      '1.1;Position;A;m2;1,000;12,99;Normalposition',
      '1.2;Position;B;m2;1,000;1.299,00;Normalposition',
      '1.3;Position;C;m2;1,000;0,99;Normalposition',
      '1.4;Position;D;m2;1,000;1299;Normalposition',
    );
    expect(zeilen.map((z) => z.einheitspreisCent))
      .toEqual(['1299', '129900', '99', '129900']);
  });

  it('weist eine dritte Dezimalstelle AB, statt zu runden', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;12,345;Normalposition');
    expect(zeilen[0]!.einheitspreisCent).toBeNull();
    expect(zeilen[0]!.fehler.join(' ')).toMatch(/mehr als zwei Dezimalstellen/u);
    // Die Zeile wird damit ungültig — sie kommt nicht in die neue Fassung.
    expect(zeilen[0]!.fehler.length).toBeGreaterThan(0);
  });

  it('ein leeres Preisfeld ist kein Fehler — ein LV kommt oft ohne Preise', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;;Normalposition');
    expect(zeilen[0]!.einheitspreisCent).toBeNull();
    expect(zeilen[0]!.fehler).toEqual([]);
  });

  it('aber Text im Preisfeld ist einer', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;auf Anfrage;Normalposition');
    expect(zeilen[0]!.fehler.join(' ')).toMatch(/kein Einheitspreis/u);
  });
});

describe('die Menge', () => {
  it('kommt in der Form heraus, die `numeric(12,3)` erwartet', () => {
    const { zeilen } = lese(
      '1.1;Position;A;m2;3,333;1,00;Normalposition',
      '1.2;Position;B;m2;17,5;1,00;Normalposition',
      '1.3;Position;C;St;0,125;1,00;Normalposition',
    );
    expect(zeilen.map((z) => z.menge)).toEqual(['3.333', '17.500', '0.125']);
  });

  it('eine Position ohne Menge oder ohne Einheit ist ungültig (0071 sagt dasselbe)', () => {
    const { zeilen } = lese(
      '1.1;Position;A;;5,000;1,00;Normalposition',
      '1.2;Position;B;m2;;1,00;Normalposition',
    );
    expect(zeilen[0]!.fehler.join(' ')).toMatch(/braucht eine Einheit/u);
    expect(zeilen[1]!.fehler.join(' ')).toMatch(/braucht eine Vertragsmenge/u);
  });
});

describe('die Art der Zeile', () => {
  it('kommt aus der Spalte, wenn sie da ist', () => {
    const { zeilen } = lese(
      '1;Los;Rohbau;;;;',
      '1.2;Titel;Mauerwerk;;;;',
      '1.2.1;Untertitel;KS;;;;',
      '1.2.1.1;Position;Mauerwerk 24;m2;1,000;1,00;',
      '9;Hinweis;Bauzeit;;;;',
    );
    expect(zeilen.map((z) => z.art))
      .toEqual(['los', 'titel', 'untertitel', 'position', 'hinweistext']);
  });

  it('und ohne Spalte aus der OZ-Tiefe — eine Zeile mit Menge ist immer Position', () => {
    const ohneArt = CSV_QUELLE.lese([
      'OZ;Kurztext;Einheit;Menge;Einheitspreis',
      '1;Rohbau;;;',
      '1.2;Mauerwerk;;;',
      '1.2.3;KS;;;',
      '1.2.3.4;Mauerwerk 24;m2;1,000;1,00',
      // Tief in der Gliederung, aber MIT Menge: das ist eine Position.
      '1.2;Sonderfall mit Menge;m2;5,000;1,00',
    ].join('\n'));
    expect(ohneArt.zeilen.map((z) => z.art))
      .toEqual(['los', 'titel', 'untertitel', 'position', 'position']);
  });
});

describe('die Positionsart (O-155)', () => {
  it('erkennt die Schreibweisen, die vorkommen', () => {
    const { zeilen } = lese(
      '1.1;Position;A;m2;1,000;1,00;Normalposition',
      '1.2;Position;B;m2;1,000;1,00;Bedarfsposition',
      '1.3;Position;C;m2;1,000;1,00;Eventualposition',
      '1.4;Position;D;m2;1,000;1,00;Alternativposition',
      '1.5;Position;E;m2;1,000;1,00;Wahlposition',
      '1.6;Position;F;m2;1,000;1,00;Zuschlagsposition',
    );
    expect(zeilen.map((z) => z.positionsart)).toEqual([
      'normalposition', 'bedarfsposition', 'bedarfsposition',
      'alternativposition', 'alternativposition', 'zuschlagsposition',
    ]);
  });

  it('eine unbekannte bleibt `unbestimmt` — MIT Hinweis, nicht stillschweigend', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;1,00;Sonderposition');
    expect(zeilen[0]!.positionsart).toBe('unbestimmt');
    expect(zeilen[0]!.fehler.join(' ')).toMatch(/O-155/u);
  });

  it('und ein leeres Feld ist `unbestimmt` ohne Hinweis', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;1,00;');
    expect(zeilen[0]!.positionsart).toBe('unbestimmt');
    expect(zeilen[0]!.fehler).toEqual([]);
  });
});

describe('APR-03 — eine wörtlich gelesene Spalte hat keine Konfidenz', () => {
  it('`konfidenz` bleibt null; eine erfundene 100 wäre die Behauptung einer Prüfung', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;1,00;Normalposition');
    expect(zeilen[0]!.konfidenz).toBeNull();
  });
});

describe('die Rohzeile bleibt erhalten', () => {
  it('sie ist der Nachweis darüber, WAS hochgeladen wurde', () => {
    const { zeilen } = lese('1.1;Position;A;m2;1,000;12,99;Normalposition');
    expect(zeilen[0]!.rohdaten['Einheitspreis']).toBe('12,99');
    expect(zeilen[0]!.rohdaten['Kurztext']).toBe('A');
  });
});

describe('O-41 — nur EIN Format ist implementiert, und das steht dran', () => {
  it('`csv_semikolon` liest, alle anderen werfen mit Namen und Nummer', () => {
    expect(lvQuelle('csv_semikolon').implementiert).toBe(true);
    for (const format of LV_FORMATE.filter((x) => x !== 'csv_semikolon')) {
      const quelle = lvQuelle(format);
      expect(quelle.implementiert, format).toBe(false);
      try {
        quelle.lese('<GAEB/>');
        expect.unreachable(`${format} hätte werfen müssen`);
      } catch (fehler: unknown) {
        expect(fehler).toBeInstanceOf(LvQuelleFehler);
        expect((fehler as LvQuelleFehler).grund).toBe('nicht_implementiert');
        expect((fehler as Error).message).toMatch(/O-41/u);
      }
    }
  });

  it('und die Auswahl der Oberfläche nennt bei jedem nicht implementierten „nicht implementiert"',
    () => {
      for (const format of LV_FORMATE) {
        const text = LV_FORMAT_TEXT[format];
        if (format === 'csv_semikolon') expect(text).toMatch(/implementiert/u);
        else expect(text, format).toMatch(/nicht implementiert/u);
      }
    });

  it('`istLvFormat` lässt kein erfundenes Format durch', () => {
    for (const format of LV_FORMATE) expect(istLvFormat(format)).toBe(true);
    for (const nein of ['gaeb', 'CSV', 'xml', '', null, 3]) {
      expect(istLvFormat(nein), String(nein)).toBe(false);
    }
  });
});

describe('die Kopfzeile', () => {
  it('ohne OZ oder Kurztext wird die Datei abgewiesen — nicht halb gelesen', () => {
    expect(() => CSV_QUELLE.lese('Menge;Einheit\n1;m2'))
      .toThrow(/Ordnungszahl oder der Kurztext/u);
  });

  it('eine leere Datei ebenso', () => {
    expect(() => CSV_QUELLE.lese('   ')).toThrow(LvQuelleFehler);
  });

  it('die Zuordnung nimmt die genaue Übereinstimmung vor der enthaltenen', () => {
    /*
     * Zwei Fallen in einer Kopfzeile: „Positionsart" enthält „position" (das
     * Wort des Feldes `oz`) UND „art" (das Wort des Feldes `art`). Ohne den
     * getrennten Genau-Durchgang nähme das erste passende Feld sie weg, und
     * die Positionsart landete nirgends — also hiesse jede Zeile
     * „unbestimmt", und jede Bedarfsposition zählte in die Summe (O-155).
     */
    const zu = ordneSpaltenZu(['Position', 'Positionsart', 'Kurztext', 'Menge']);
    expect(zu.oz).toBe('Position');
    expect(zu.positionsart).toBe('Positionsart');
    expect(zu.art).toBeUndefined();
  });

  it('und eine Kopfzeile OHNE Artspalte lässt `art` leer, statt „Positionsart" zu nehmen',
    () => {
      const zu = ordneSpaltenZu(['OZ', 'Kurztext', 'Positionsart', 'Menge', 'Einheit']);
      expect(zu.positionsart).toBe('Positionsart');
      expect(zu.art).toBeUndefined();
    });

  it('und sie versteht die üblichen Schreibweisen', () => {
    const zu = ordneSpaltenZu([
      'OZ', 'Kurztext', 'Langtext', 'ME', 'Vertragsmenge', 'EP', 'Zeilenart',
    ]);
    expect(zu.oz).toBe('OZ');
    expect(zu.einheit).toBe('ME');
    expect(zu.menge).toBe('Vertragsmenge');
    expect(zu.preis).toBe('EP');
    expect(zu.art).toBe('Zeilenart');
  });
});

describe('der Elternteil einer OZ — auf SEGMENTGRENZEN, nicht als Zeichenkette', () => {
  it('`1.2` ist Elternteil von `1.2.10`, aber NICHT von `1.20`', () => {
    expect(elternOz('1.2.10', ['1', '1.2', '1.20'])).toBe('1.2');
    // Der Textvergleich hätte hier `1.2` gesagt und `1.20…` unter den falschen
    // Titel gehängt — ein Baum, der plausibel aussieht und falsch ist.
    expect(elternOz('1.20', ['1', '1.2'])).toBe('1');
    expect(elternOz('1.20.1', ['1', '1.2'])).toBe('1');
  });

  it('nimmt den LÄNGSTEN vorhandenen Präfix', () => {
    expect(elternOz('1.2.3.4', ['1', '1.2', '1.2.3'])).toBe('1.2.3');
    expect(elternOz('1.2.3.4', ['1', '1.2'])).toBe('1.2');
  });

  it('und ohne Präfix hängt die Zeile an der Wurzel, statt zu verschwinden', () => {
    expect(elternOz('5.1', ['1', '1.2'])).toBeNull();
    expect(elternOz('1', ['1'])).toBeNull();
    expect(elternOz('', [])).toBeNull();
  });
});

describe('die dritte Bedingung der Tabelle: ein Preis nur auf einer Position', () => {
  it('ein Titel mit Titelsumme behält seinen Platz und verliert den Preis', () => {
    /*
     * `lvp_preis_nur_position` (0071) weist `einheitspreis_cent` auf allem
     * ab, was keine Position ist. Der Leser nahm zwei der drei Bedingungen
     * vorweg und diese nicht: eine Titelsumme in der EP-Spalte — in
     * exportierten LV-Tabellen üblich — stand als gültig in der Vorschau,
     * und die Übernahme brach mit einem Datenbankfehler ab.
     */
    const { zeilen } = lese(
      '1;Los;Rohbau;;;25.000,00;',
      '1.2;Titel;Mauerwerk;;;12.500,00;',
      '1.2.9;Position;Mauerwerk 24 cm KS;m2;3,000;12,99;Normalposition',
    );
    const [los, titel, position] = zeilen;

    // Der Preis fällt weg — aber die Zeile bleibt, sonst hinge `1.2.9` an
    // der Wurzel statt unter seinem Titel.
    expect(los?.einheitspreisCent).toBeNull();
    expect(titel?.einheitspreisCent).toBeNull();
    expect(los?.fehler).toEqual([]);
    expect(titel?.fehler).toEqual([]);
    expect(titel?.hinweise.join(' ')).toMatch(/nicht übernommen/u);
    expect(titel?.hinweise.join(' ')).toMatch(/12\.500,00/u);

    // Die Position behält ihren Einheitspreis und bekommt keinen Hinweis.
    expect(position?.einheitspreisCent).toBe('1299');
    expect(position?.hinweise).toEqual([]);
  });

  it('ein unleserlicher Preis bleibt ein FEHLER, auch auf einem Titel', () => {
    // Hinweis ≠ Fehler: „zwölf" ist keine Zahl, und das ist eine andere
    // Aussage als „diese Zahl gehört hier nicht hin".
    const { zeilen } = lese('1.2;Titel;Mauerwerk;;;zwölf;');
    expect(zeilen[0]?.fehler.join(' ')).toMatch(/kein Einheitspreis/u);
  });
});

describe('eine OZ kommt einmal vor', () => {
  it('die zweite Zeile mit derselben OZ wird ungültig — mit Verweis auf die erste', () => {
    /*
     * `lv_position_oz_uk` (0071) ist je Verzeichnis eindeutig. Vorher waren
     * beide Zeilen gültig, beide standen in der Vorschau, und die Übernahme
     * brach mitten in der Schleife mit `unique_violation` ab — ein 500 nach
     * einer grünen Vorschau.
     */
    const { zeilen } = lese(
      '1.1.1;Position;Mauerwerk 24 cm KS;m2;3,000;12,99;Normalposition',
      '1.1.2;Position;Sturz;St;1,000;9,90;Normalposition',
      '1.1.1;Position;Mauerwerk 24 cm KS (Wiederholung);m2;4,000;12,99;Normalposition',
    );
    expect(zeilen[0]?.fehler).toEqual([]);
    expect(zeilen[1]?.fehler).toEqual([]);
    expect(zeilen[2]?.fehler.join(' ')).toMatch(/steht in Zeile 1 schon/u);
  });

  it('und zwei LEERE OZ ergeben nicht den Vorwurf einer Doppelung', () => {
    // Die leere OZ hat ihren eigenen Fehler; sie zweimal als „schon vergeben"
    // zu melden verwischte den eigentlichen Befund.
    const { zeilen } = lese(';Position;A;m2;1,000;1,00;', ';Position;B;m2;1,000;1,00;');
    for (const z of zeilen) {
      expect(z.fehler.join(' ')).toMatch(/Ohne Ordnungszahl/u);
      expect(z.fehler.join(' ')).not.toMatch(/schon/u);
    }
  });
});

describe('CSV trägt keine Konfidenz — und das ist eine Aussage, keine Lücke', () => {
  it('jede gelesene Zeile hat `konfidenz: null`', () => {
    /*
     * Woraus folgt: eine so entstandene Position gilt NICHT als maschinell
     * gelesen. `istUngeprueftMaschinell` ist falsch, das Hindernis in
     * `kern.aufmass_vorlage_pruefen()` (0072) greift nicht, und
     * `bestaetigeLvPosition` trifft sie nicht — die Bestätigungspflicht
     * beginnt bei einem EXTRAHIERENDEN Leser (PDF, Bild), den es noch nicht
     * gibt (O-41). Eine erfundene 100 wäre die Behauptung, ein Modell habe
     * geprüft.
     */
    const { zeilen } = lese(
      '1.1;Position;A;m2;1,000;12,99;Normalposition',
      '1.2;Titel;B;;;;',
    );
    expect(zeilen.every((z) => z.konfidenz === null)).toBe(true);
  });
});
