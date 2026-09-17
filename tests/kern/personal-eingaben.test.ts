/**
 * Die Eingabegrenze der Personaldienste — geprueft OHNE Datenbank.
 *
 * **Was hier bewiesen wird, ist eine Reihenfolge.** Jede dieser Funktionen
 * prueft ihre Eingabe, BEVOR sie eine Abfrage stellt. Das ist keine
 * Stilfrage: eine Personalnummer aus einem Formular, ein Eurobetrag in
 * amerikanischer Schreibweise oder ein Geburtsdatum als `31.02.1990` laufen
 * sonst in die Datenbank und kommen als `22P02`, `23505` oder `permission
 * denied` zurueck — Meldungen, die dem Menschen am Bildschirm nichts sagen und
 * im Fehlerprotokoll wie Programmfehler aussehen.
 *
 * Der Kontext unten WIRFT bei jeder Abfrage. Ein Test, der nur die Meldung
 * prueft, waere auch gruen, wenn die Pruefung hinter der ersten Abfrage
 * stuende; dieser faellt dann.
 */
import { describe, expect, it } from 'vitest';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereVertrag, beendeAnstellung, leseEntgelt, setzeKondition,
  VertragEingabeFehler,
} from '../../src/server/services/personal/anstellung.js';
import {
  schreibeStammdaten, StammdatenEingabeFehler,
} from '../../src/server/services/personal/stammdaten.js';
import {
  fuehreZusammen, ZusammenfuehrenFehler,
} from '../../src/server/services/personal/dublette.js';
import { cent } from '../../src/server/services/finanz/geld.js';

class AbfrageVerboten extends Error {
  constructor(sql: string) {
    super(`Diese Eingabe hätte die Datenbank nie erreichen dürfen: ${sql.slice(0, 60)}`);
    this.name = 'AbfrageVerboten';
  }
}

const STUMM: SchreibKontext = {
  scope: 'mandant',
  portal: 'intern',
  benutzerId: '00000000-0000-0000-0000-0000000000b1',
  aktiverMandantId: '00000000-0000-0000-0000-0000000000a1',
  mandantIds: ['00000000-0000-0000-0000-0000000000a1'],
  abfrage: <T,>(sql: string): Promise<readonly T[]> => {
    throw new AbfrageVerboten(sql);
  },
  schreibe: <T,>(sql: string): Promise<readonly T[]> => {
    throw new AbfrageVerboten(sql);
  },
};

const ANSTELLUNG = '00000000-0000-0000-0000-0000000000c1';
const PERSON = '00000000-0000-0000-0000-0000000000d1';
const PERSON_ZWEI = '00000000-0000-0000-0000-0000000000d2';

describe('aendereVertrag — Personalnummer und Eintritt', () => {
  it('eine leere Personalnummer ist keine Nummer', async () => {
    await expect(aendereVertrag(STUMM, {
      anstellungId: ANSTELLUNG, personalnummer: '   ', eintritt: '2025-01-01',
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });

  it('ein Eintritt in deutscher Schreibweise wird abgewiesen, nicht geraten', async () => {
    /*
     * `01.02.2025` waere als `date` je nach DateStyle der Sitzung der 1.
     * Februar ODER der 2. Januar. Zu raten ist hier besonders teuer: am
     * Eintritt haengt die Sollstundenrechnung des ersten Monats.
     */
    await expect(aendereVertrag(STUMM, {
      anstellungId: ANSTELLUNG, personalnummer: 'R-1', eintritt: '01.02.2025',
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });
});

describe('beendeAnstellung — Austritt und Grund', () => {
  it('ohne Grund gibt es keine Beendigung', async () => {
    await expect(beendeAnstellung(STUMM, {
      anstellungId: ANSTELLUNG, austritt: '2025-06-30', grund: '  ',
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });

  it('ein Austritt ohne Kalenderform wird abgewiesen', async () => {
    await expect(beendeAnstellung(STUMM, {
      anstellungId: ANSTELLUNG, austritt: 'heute', grund: 'Eigenkündigung',
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });
});

describe('setzeKondition — gilt ab, Satz in Cent', () => {
  it('„gilt ab" ohne Kalenderform wird abgewiesen', async () => {
    await expect(setzeKondition(STUMM, {
      anstellungId: ANSTELLUNG, giltAb: '2025-6-1', stundensatzCent: cent(1650n),
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });

  it('ein negativer Satz ist kein Kostensatz', async () => {
    await expect(setzeKondition(STUMM, {
      anstellungId: ANSTELLUNG, giltAb: '2025-06-01', stundensatzCent: cent(-1n),
    })).rejects.toBeInstanceOf(VertragEingabeFehler);
  });
});

describe('leseEntgelt — der Stichtag', () => {
  it('ein Stichtag ohne Kalenderform erreicht die Definer-Funktion nicht', async () => {
    /*
     * Wichtiger als die Meldung: der Aufruf darf nicht stattfinden. Jeder
     * Aufruf von `app.entgelt_lesen` schreibt eine Auditzeile — eine Auditzeile
     * fuer einen Tippfehler waere ein Zugriff im Protokoll, den niemand
     * getaetigt hat.
     */
    await expect(leseEntgelt(STUMM, ANSTELLUNG, 'gestern'))
      .rejects.toBeInstanceOf(VertragEingabeFehler);
  });
});

describe('schreibeStammdaten — die drei geschuetzten Felder', () => {
  it('ein Geburtsdatum ohne Kalenderform wird abgewiesen', async () => {
    await expect(schreibeStammdaten(STUMM, {
      personId: PERSON, geburtsdatum: '31.02.1990', geburtsort: null,
      staatsangehoerigkeit: null,
    })).rejects.toBeInstanceOf(StammdatenEingabeFehler);
  });

  it('eine Staatsangehörigkeit als Wort ist kein ISO-Code', async () => {
    /*
     * SEC-03 verlangt ISO 3166-1 alpha-2. „Deutschland" statt „DE" laeuft
     * sonst in einen `char(2)`-CHECK — und der Mensch am Bildschirm liest
     * „new row violates check constraint person_staat_form".
     */
    await expect(schreibeStammdaten(STUMM, {
      personId: PERSON, geburtsdatum: null, geburtsort: null,
      staatsangehoerigkeit: 'Deutschland',
    })).rejects.toBeInstanceOf(StammdatenEingabeFehler);
  });

  it('drei leere Felder sind eine gueltige Eingabe — sie erreichen die Datenbank', async () => {
    /*
     * Die Gegenprobe zu den beiden Fällen oben: mit gueltiger Eingabe geht es
     * WEITER, und der stumme Kontext wirft. Ohne diesen Test waere „alles
     * abgewiesen" ebenfalls gruen.
     */
    await expect(schreibeStammdaten(STUMM, {
      personId: PERSON, geburtsdatum: null, geburtsort: null,
      staatsangehoerigkeit: null,
    })).rejects.toBeInstanceOf(AbfrageVerboten);
  });
});

describe('fuehreZusammen — zwei Zeilen, ein Mensch', () => {
  it('ein Mensch ist keine Dublette von sich selbst', async () => {
    await expect(fuehreZusammen(STUMM, {
      dublettePersonId: PERSON, fuehrendPersonId: PERSON,
      grund: 'Dublette', bestaetigung: 'Yildiz',
    })).rejects.toBeInstanceOf(ZusammenfuehrenFehler);
  });

  it('ohne Grund wird nicht zusammengefuehrt', async () => {
    await expect(fuehreZusammen(STUMM, {
      dublettePersonId: PERSON, fuehrendPersonId: PERSON_ZWEI,
      grund: '   ', bestaetigung: 'Yildiz',
    })).rejects.toBeInstanceOf(ZusammenfuehrenFehler);
  });
});
