/**
 * § 5 ArbZG und der geteilte Dienst (V-190, TIM-06, TIM-14, O-926).
 *
 * **Der Befund.** `pruefeArbzg` mass die Ruhezeit zwischen JEDEM Paar
 * aufeinanderfolgender Blöcke und meldete unter elf Stunden einen Verstoss —
 * auch zwischen Früh- und Abendreinigung desselben Tages. § 5 Abs. 1 verlangt
 * die Ruhezeit „nach Beendigung der täglichen Arbeitszeit"; die Unterbrechung
 * eines geteilten Dienstes ist keine. Jeder solche Tag trug einen falschen
 * Rechtsverstoss, beim Einteilen zu quittieren und nachts als Konflikt.
 *
 * **Was offen bleibt, bleibt offen.** Wo ein Arbeitstag endet (Kalendertag
 * oder 24 Stunden ab Arbeitsbeginn), ist O-926. Der Platzhalter
 * `ARBEITSTAG_BEIDE_LESARTEN` verschweigt nur, was nach KEINER Lesart ein
 * Verstoss ist; wo sie auseinandergehen, meldet er wie bisher.
 */
import { describe, expect, it } from 'vitest';
import {
  ARBEITSTAG_BEIDE_LESARTEN, pruefeArbzg,
  type Arbeitstagsgrenze, type ArbzgBefund, type Schicht,
} from '../../src/server/services/zeit/arbzg.js';

const PERSON = 'person-fatima';
const REINIGUNG = 'mandant-reinigung';
const SECURITY = 'mandant-security';

/** Ein Block in Berliner Wanduhrzeit — die UTC-Instants stehen daneben. */
function block(id: string, vonUtc: string, bisUtc: string, mandantId = REINIGUNG): Schicht {
  return {
    id, personId: PERSON, mandantId,
    vonUtc: new Date(vonUtc), bisUtc: new Date(bisUtc), pauseMinuten: null,
  };
}

const ruhezeiten = (
  bloecke: readonly Schicht[], arbeitstag?: Arbeitstagsgrenze,
): readonly ArbzgBefund[] =>
  pruefeArbzg(bloecke, arbeitstag === undefined ? {} : { arbeitstag })
    .filter((b) => b.regel === 'ruhezeit_unter_11h');

describe('der geteilte Dienst desselben Tages ist kein Ruhezeitverstoss', () => {
  // 04.05.2026 ist MESZ (UTC+2).
  const frueh = block('frueh', '2026-05-04T04:00:00Z', '2026-05-04T07:00:00Z'); // 06–09
  const abends = block('abends', '2026-05-04T15:00:00Z', '2026-05-04T18:00:00Z'); // 17–20

  it('06–09 und 17–20: kein § 5-Befund, und § 3 sieht sechs Stunden an EINEM Tag', () => {
    expect(ruhezeiten([frueh, abends])).toEqual([]);
    // Nichts anderes wird still: sechs Stunden sind unter jeder § 3-Grenze.
    expect(pruefeArbzg([frueh, abends])).toEqual([]);
  });

  it('06–09, 17–20 und am Folgetag 05:00: EIN Verstoss über 540 Minuten', () => {
    const morgen = block('morgen', '2026-05-05T03:00:00Z', '2026-05-05T06:00:00Z'); // 05–08
    const befunde = ruhezeiten([frueh, abends, morgen]);
    expect(befunde).toHaveLength(1);
    expect(befunde[0]?.minuten).toBe(540);
    expect(befunde[0]?.schwere).toBe('verstoss');
    expect(befunde[0]?.beteiligteSchichten).toEqual(['abends', 'morgen']);
    expect(befunde[0]?.kalendertag).toBe('2026-05-05');
    // Die Lesart steht in der Begründung — mit ihrer offenen Frage.
    expect(befunde[0]?.begruendung).toContain('O-926');
  });

  it('über zwei Gesellschaften (K-06) genauso: der Teildienst summiert sich nach § 3, § 5 schweigt', () => {
    const fremdAbends = { ...abends, id: 'fremd-abends', mandantId: SECURITY };
    const lang = block('lang', '2026-05-04T04:00:00Z', '2026-05-04T11:00:00Z'); // 06–13
    const befunde = pruefeArbzg([lang, fremdAbends]);
    expect(befunde.filter((b) => b.regel === 'ruhezeit_unter_11h')).toEqual([]);
    // 7 h + 3 h = 10 h: über acht Stunden, an einem Tag, über zwei Gesellschaften.
    const acht = befunde.find((b) => b.regel === 'tagesarbeitszeit_ueber_8h');
    expect(acht?.minuten).toBe(600);
    expect(acht?.ueberMandanten).toBe(true);
  });

  it('am Tag der Zeitumstellung (29.03.2026) ebenso — der Tag hat 23 Stunden, nicht der Dienst', () => {
    const f = block('f', '2026-03-29T04:00:00Z', '2026-03-29T07:00:00Z'); // 06–09 MESZ
    const a = block('a', '2026-03-29T15:00:00Z', '2026-03-29T18:00:00Z'); // 17–20 MESZ
    expect(ruhezeiten([f, a])).toEqual([]);
  });
});

describe('wo die Lesarten auseinandergehen, bleibt der Verstoss (vorsichtig, O-926)', () => {
  it('geteilter Dienst über Mitternacht: zwei Kalendertage — gemeldet wie bisher', () => {
    const vor = block('vor', '2026-05-04T20:00:00Z', '2026-05-04T21:30:00Z'); // 22:00–23:30
    const nach = block('nach', '2026-05-04T22:30:00Z', '2026-05-05T04:00:00Z'); // 00:30–06:00
    const befunde = ruhezeiten([vor, nach]);
    expect(befunde).toHaveLength(1);
    expect(befunde[0]?.minuten).toBe(60);
  });

  it('eine Kette kurzer Pausen über mehr als 24 Stunden: der 24-Stunden-Werktag ist vorbei', () => {
    // 03.05. 20:00–23:00, 04.05. 04:00–10:00, 04.05. 20:30–22:00 (Berlin).
    const a = block('a', '2026-05-03T18:00:00Z', '2026-05-03T21:00:00Z');
    const b = block('b', '2026-05-04T02:00:00Z', '2026-05-04T08:00:00Z');
    const c = block('c', '2026-05-04T18:30:00Z', '2026-05-04T20:00:00Z');
    const befunde = ruhezeiten([a, b, c]);
    // a→b: zwei Kalendertage (300 min). b→c: derselbe Kalendertag, aber 24,5 h
    // nach Beginn des Werktags um 20:00 — nach einer Lesart zwei Arbeitstage.
    expect(befunde.map((x) => [x.beteiligteSchichten.join('→'), x.minuten]))
      .toEqual([['a→b', 300], ['b→c', 630]]);
  });

  it('nach einer Ruhezeit von elf Stunden beginnt ein neuer Arbeitstag', () => {
    // 04.05. 00:00–01:00, 12:00–13:00 (11 h Ruhe), 15:00–16:00 (Teildienst).
    const a = block('a', '2026-05-03T22:00:00Z', '2026-05-03T23:00:00Z');
    const b = block('b', '2026-05-04T10:00:00Z', '2026-05-04T11:00:00Z');
    const c = block('c', '2026-05-04T13:00:00Z', '2026-05-04T14:00:00Z');
    expect(ruhezeiten([a, b, c])).toEqual([]);
  });
});

describe('die Grenze ist austauschbar — die Antwort auf O-926 ersetzt eine Stelle', () => {
  it('der Platzhalter ist beschriftet und nennt seine Frage', () => {
    expect(ARBEITSTAG_BEIDE_LESARTEN.offeneFrage).toBe('O-926');
    expect(ARBEITSTAG_BEIDE_LESARTEN.name).toContain('Platzhalter');
  });

  it('eine andere Lesart ändert das Ergebnis, nicht die Rechnung', () => {
    const frueh = block('frueh', '2026-05-04T04:00:00Z', '2026-05-04T07:00:00Z'); // 06–09
    const abends = block('abends', '2026-05-04T15:00:00Z', '2026-05-04T18:00:00Z'); // 17–20
    /** Nur für diesen Test: die alte Rechnung — jede Lücke als Ruhezeit. */
    const jedeLuecke: Arbeitstagsgrenze = {
      name: 'Test: jede Lücke ist Ruhezeit', offeneFrage: null, gleicherArbeitstag: () => false,
    };
    const befunde = ruhezeiten([frueh, abends], jedeLuecke);
    expect(befunde.map((b) => b.minuten)).toEqual([480]);
    expect(befunde[0]?.begruendung).toContain('Test: jede Lücke ist Ruhezeit');
    expect(befunde[0]?.begruendung).not.toContain('O-926');
    // Mit dem ausgelieferten Platzhalter: kein Befund.
    expect(ruhezeiten([frueh, abends])).toEqual([]);
  });
});
