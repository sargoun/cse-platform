/**
 * Die Berliner Feiertage — geprueft gegen den veroeffentlichten Kalender.
 *
 * Ein falscher Feiertag faellt niemandem auf: der Generator plant dann eine
 * Reinigung an einem Tag, an dem das Objekt zu ist, oder er laesst eine
 * ausfallen, die geschuldet ist. Beides zeigt sich erst vor Ort. Deshalb
 * stehen hier bekannte Werte mehrerer Jahre und nicht das Ergebnis der
 * Rechnung, die sie erzeugt hat — ein Test, der die Formel gegen sich selbst
 * prueft, bestaetigt jeden Fehler, den sie hat.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDESLAND_BERLIN,
  feiertageBerlin,
  FeiertagFehler,
  istFeiertag,
  ostersonntag,
} from '../../src/lib/datum/feiertage-berlin.js';

const datumMit = (jahr: number, bezeichnung: string): string | undefined =>
  feiertageBerlin(jahr).find((f) => f.bezeichnung === bezeichnung)?.datum;

const daten = (jahr: number): readonly string[] => feiertageBerlin(jahr).map((f) => f.datum);

/**
 * Ostersonntag und die vier beweglichen Feste, vier Jahre lang.
 *
 * Vier Jahre, weil ein einzelnes zufaellig stimmen kann: 2024 ist ein
 * Schaltjahr mit fruehem Ostern, 2025 hat das spaeteste der vier, 2027 wieder
 * ein fruehes. Wer die Osterformel falsch abschreibt, faellt spaetestens beim
 * zweiten Jahr auf.
 */
const OSTERJAHRE = [
  {
    jahr: 2024, ostern: '2024-03-31', karfreitag: '2024-03-29',
    ostermontag: '2024-04-01', himmelfahrt: '2024-05-09', pfingstmontag: '2024-05-20',
  },
  {
    jahr: 2025, ostern: '2025-04-20', karfreitag: '2025-04-18',
    ostermontag: '2025-04-21', himmelfahrt: '2025-05-29', pfingstmontag: '2025-06-09',
  },
  {
    jahr: 2026, ostern: '2026-04-05', karfreitag: '2026-04-03',
    ostermontag: '2026-04-06', himmelfahrt: '2026-05-14', pfingstmontag: '2026-05-25',
  },
  {
    jahr: 2027, ostern: '2027-03-28', karfreitag: '2027-03-26',
    ostermontag: '2027-03-29', himmelfahrt: '2027-05-06', pfingstmontag: '2027-05-17',
  },
] as const;

describe('(1) Die beweglichen Feste haengen am Ostersonntag', () => {
  for (const jahr of OSTERJAHRE) {
    it(`${jahr.jahr}: Ostern ${jahr.ostern}, und die vier Feste daran`, () => {
      expect(ostersonntag(jahr.jahr)).toBe(jahr.ostern);
      expect(datumMit(jahr.jahr, 'Karfreitag')).toBe(jahr.karfreitag);
      expect(datumMit(jahr.jahr, 'Ostermontag')).toBe(jahr.ostermontag);
      expect(datumMit(jahr.jahr, 'Christi Himmelfahrt')).toBe(jahr.himmelfahrt);
      expect(datumMit(jahr.jahr, 'Pfingstmontag')).toBe(jahr.pfingstmontag);
    });
  }

  it('Ostersonntag selbst ist in Berlin KEIN gesetzlicher Feiertag', () => {
    // In Brandenburg schon — deshalb steht er hier nicht "aus Versehen" nicht
    // drin, sondern weil das Modul Berlin rechnet.
    expect(daten(2026)).not.toContain('2026-04-05');
    expect(istFeiertag('2026-04-05')).toBe(false);
    // Pfingstsonntag, derselbe Fall.
    expect(istFeiertag('2026-05-24')).toBe(false);
  });
});

describe('(2) Der Internationale Frauentag gilt in Berlin seit 2019', () => {
  it('2018 kennt ihn nicht — ein Lauf ueber das Jahr darf ihn nicht enthalten', () => {
    expect(datumMit(2018, 'Internationaler Frauentag')).toBeUndefined();
    expect(daten(2018)).not.toContain('2018-03-08');
    expect(istFeiertag('2018-03-08')).toBe(false);
  });

  it('2019 kennt ihn, und jedes Jahr danach', () => {
    expect(datumMit(2019, 'Internationaler Frauentag')).toBe('2019-03-08');
    expect(istFeiertag('2019-03-08')).toBe(true);
    expect(istFeiertag('2026-03-08')).toBe(true);
  });
});

describe('(3) Was in Berlin gerade NICHT gilt', () => {
  it('Fronleichnam (Ostern + 60) ist kein Berliner Feiertag', () => {
    // 2026: Ostern 5. April, Fronleichnam waere der 4. Juni.
    expect(daten(2026)).not.toContain('2026-06-04');
    expect(istFeiertag('2026-06-04')).toBe(false);
    expect(feiertageBerlin(2026).map((f) => f.bezeichnung)).not.toContain('Fronleichnam');
  });

  it('Der Reformationstag gilt in Berlin nicht — ausser im Jubilaeumsjahr 2017', () => {
    for (const jahr of [2016, 2018, 2025, 2026]) {
      expect(daten(jahr)).not.toContain(`${jahr}-10-31`);
      expect(istFeiertag(`${jahr}-10-31`)).toBe(false);
    }
    // 2017 war er einmalig in allen Laendern gesetzlicher Feiertag. Ihn
    // wegzulassen waere eine falsche Aussage ueber einen vergangenen Tag.
    expect(datumMit(2017, 'Reformationstag')).toBe('2017-10-31');
    expect(istFeiertag('2017-10-31')).toBe(true);
  });

  it('der 8. Mai war 2020 und 2025 Feiertag in Berlin — und sonst nie', () => {
    // Zwei einzeln aufgezaehlte Tage, keine Regel: haetten sie eine, rechnete
    // sie in Jahre weiter, in denen der Tag ein Werktag ist.
    expect(datumMit(2020, 'Tag der Befreiung')).toBe('2020-05-08');
    expect(datumMit(2025, 'Tag der Befreiung')).toBe('2025-05-08');
    for (const jahr of [2019, 2021, 2024, 2026]) {
      expect(daten(jahr)).not.toContain(`${jahr}-05-08`);
      expect(istFeiertag(`${jahr}-05-08`)).toBe(false);
    }
  });
});

describe('(4) Heiligabend und Silvester: festgehalten, nicht entschieden', () => {
  it('stehen in der Liste, aber mit gesetzlich = false (§5.1)', () => {
    const liste = feiertageBerlin(2026);
    expect(liste.find((f) => f.datum === '2026-12-24')).toEqual({
      datum: '2026-12-24',
      bezeichnung: 'Heiligabend',
      gesetzlich: false,
      quelle: 'berechnet',
    });
    expect(liste.find((f) => f.datum === '2026-12-31')?.gesetzlich).toBe(false);
  });

  it('sind fuer den Generator keine Feiertage — sonst faellt still eine Schicht aus', () => {
    // `istFeiertag` beantwortet die Frage des Generators. Ein `true` hier
    // entschiede die offene Frage O-167 in die Richtung, die §8.5
    // ausschliesst: nie stillschweigend eine geplante Schicht entfernen.
    expect(istFeiertag('2026-12-24')).toBe(false);
    expect(istFeiertag('2026-12-31')).toBe(false);
    expect(istFeiertag('2026-12-25')).toBe(true);
    expect(istFeiertag('2026-12-26')).toBe(true);
  });
});

describe('(5) Die Liste ist sortiert und je Tag einzeilig', () => {
  it('aufsteigend nach Datum, ohne zwei Zeilen auf einem Tag', () => {
    for (const jahr of [2018, 2024, 2025, 2026, 2027]) {
      const liste = daten(jahr);
      expect([...liste].sort()).toEqual([...liste]);
      expect(new Set(liste).size).toBe(liste.length);
    }
  });

  it('jede Zeile traegt quelle = berechnet und liegt im gefragten Jahr', () => {
    for (const f of feiertageBerlin(2026)) {
      expect(f.quelle).toBe('berechnet');
      expect(f.datum.startsWith('2026-')).toBe(true);
    }
    // Die Zeilen dieser Datei werden als `feiertag` mit `bundesland` gespeichert.
    expect(BUNDESLAND_BERLIN).toBe('BE');
  });

  it('2008 faellt Christi Himmelfahrt auf den 1. Mai — eine Zeile, beide Namen', () => {
    // `feiertag` hat `unique (bundesland, datum)` (§5.1): zwei Zeilen liessen
    // sich nicht speichern, und eine wegzuwerfen naehme dem Ausfall den Grund.
    expect(ostersonntag(2008)).toBe('2008-03-23');
    const ersterMai = feiertageBerlin(2008).filter((f) => f.datum === '2008-05-01');
    expect(ersterMai).toHaveLength(1);
    expect(ersterMai[0]?.bezeichnung).toBe('Tag der Arbeit / Christi Himmelfahrt');
    expect(ersterMai[0]?.gesetzlich).toBe(true);
    expect(istFeiertag('2008-05-01')).toBe(true);
  });

  it('ein gewoehnliches Jahr hat genau zwoelf Zeilen, davon zehn gesetzliche', () => {
    // Die Zahl ist die Probe gegen zugewachsene Listen: ein versehentlich
    // mitgerechneter Fronleichnam oder Reformationstag faellt hier auf.
    const zweitausendsechsundzwanzig = feiertageBerlin(2026);
    expect(zweitausendsechsundzwanzig).toHaveLength(12);
    expect(zweitausendsechsundzwanzig.filter((f) => f.gesetzlich)).toHaveLength(10);
    // Vor dem Frauentag ist es je eine Zeile weniger.
    expect(feiertageBerlin(2018)).toHaveLength(11);
    expect(feiertageBerlin(2018).filter((f) => f.gesetzlich)).toHaveLength(9);
  });
});

describe('(6) Schaltjahr und unmoegliche Tage', () => {
  it('der 29. Februar eines Schaltjahres ist ein gueltiger Tag (und kein Feiertag)', () => {
    expect(istFeiertag('2024-02-29')).toBe(false);
  });

  it('der 29. Februar eines Normaljahres wirft, statt still false zu sagen', () => {
    // Ein stilles `false` hiesse: geprueft wurde ein Tag, den es nicht gibt.
    expect(() => istFeiertag('2026-02-29')).toThrow(FeiertagFehler);
    expect(() => istFeiertag('2026-02-30')).toThrow(FeiertagFehler);
    expect(() => istFeiertag('2026-13-01')).toThrow(FeiertagFehler);
    expect(() => istFeiertag('26.12.2026')).toThrow(FeiertagFehler);
  });

  it('das Schaltjahr verschiebt die beweglichen Feste nicht', () => {
    // 2024 ist ein Schaltjahr; die Feste liegen alle nach dem Februar, und die
    // bekannten Werte oben belegen, dass die Tagesrechnung nicht verrutscht.
    expect(datumMit(2024, 'Karfreitag')).toBe('2024-03-29');
    expect(datumMit(2024, 'Christi Himmelfahrt')).toBe('2024-05-09');
  });
});

describe('(7) Jahre, ueber die dieses Modul nichts sagt', () => {
  it('vor 1990 wird gar nicht erst geantwortet', () => {
    // Den Tag der Deutschen Einheit gibt es seit dem Einigungsvertrag; eine
    // Liste fuer 1989 mit dem 3. Oktober waere schlicht falsch.
    expect(() => feiertageBerlin(1989)).toThrow(FeiertagFehler);
    expect(() => feiertageBerlin(2026.5)).toThrow(FeiertagFehler);
    expect(() => feiertageBerlin(Number.NaN)).toThrow(FeiertagFehler);
  });
});
