/**
 * Die Lage eines Fensters — Einspruch (APR-05) und Rücknahme (APR-06).
 *
 * **Warum das eine geprüfte Funktion und keine Bedingung in einer Seite ist.**
 * Drei Bildschirme entscheiden aus denselben vier Werten, ob ein Knopf
 * dastehen darf. Steht die Bedingung dreimal, läuft sie auseinander — und der
 * teure Fall ist nicht der überzählige Knopf (die Datenbank weist ihn ab),
 * sondern der FEHLENDE: ein laufendes Fenster, das die Seite nicht anbietet,
 * verstreicht, und danach ist die Korrektur eine neue Freigabe.
 *
 * **Und warum die Restzeit Instanten vergleicht.** Ein Fenster von dreissig
 * Minuten über die Zeitumstellung hinweg ist dreissig Minuten lang. Wer die
 * Differenz aus Ortszeitangaben rechnet, bekommt in der Nacht der
 * Frühjahrsumstellung neunzig und in der Herbstnacht minus dreissig — einmal
 * ein Fenster, das nicht zugeht, und einmal eines, das nie aufgeht. Die
 * beiden Nächte stehen deshalb unten als Fälle.
 */
import { describe, expect, it } from 'vitest';
import {
  fensterLage, restInWorten, type FensterEingabe,
} from '../../src/server/services/freigabe/fenster.js';

/** Eine genehmigte, noch nicht ausgeführte Freigabe mit Fenster. */
function offenMitFenster(bis: Date | null): FensterEingabe {
  return { status: 'genehmigt', ausfuehrungStatus: 'offen', bis };
}

/** Eine ausgeführte Freigabe mit Rücknahmefenster. */
function ausgefuehrt(bis: Date | null): FensterEingabe {
  return { status: 'genehmigt', ausfuehrungStatus: 'ausgefuehrt', bis };
}

const JETZT = new Date('2026-09-18T10:00:00Z');

describe('das Einspruchsfenster (APR-05)', () => {
  it('läuft, solange der Zeitpunkt in der Zukunft liegt', () => {
    const lage = fensterLage(
      'einspruch', offenMitFenster(new Date('2026-09-18T10:30:00Z')), JETZT);
    expect(lage.art).toBe('laeuft');
    if (lage.art !== 'laeuft') throw new Error('unerreichbar');
    expect(lage.restSekunden).toBe(1800);
  });

  it('ist abgelaufen, sobald der Zeitpunkt erreicht ist — nicht erst danach', () => {
    /*
     * Die Grenze ist `<=` und nicht `<`, weil `app.freigabe_einspruch` genau
     * das prueft (`verzoegerte_freigabe_bis <= now()` weist ab). Eine Seite,
     * die auf der Sekunde noch einen Knopf zeigt, zeigt einen, der abgewiesen
     * wird.
     */
    const lage = fensterLage('einspruch', offenMitFenster(JETZT), JETZT);
    expect(lage.art).toBe('abgelaufen');
  });

  it('ist „nicht armiert", wenn kein Zeitpunkt gesetzt ist — und nicht „abgelaufen"', () => {
    /*
     * Der ganze Zweck der Unterscheidung: „kein Fenster armiert" heisst, dass
     * diese Genehmigung sofort gilt (so wie jede vor APR-05); „abgelaufen"
     * heisst, jemand hat eine Frist verpasst. Das ist etwas anderes, und die
     * Seite sagt etwas anderes.
     */
    expect(fensterLage('einspruch', offenMitFenster(null), JETZT).art)
      .toBe('nicht_armiert');
  });

  it('gibt es nicht, solange die Freigabe noch wartet', () => {
    const lage = fensterLage('einspruch', {
      status: 'offen', ausfuehrungStatus: 'offen', bis: null,
    }, JETZT);
    expect(lage.art).toBe('falscher_stand');
    if (lage.art !== 'falscher_stand') throw new Error('unerreichbar');
    expect(lage.grund).toContain('noch nicht entschieden');
  });

  it('gibt es nicht bei einer abgelehnten oder widerrufenen Freigabe', () => {
    for (const status of ['abgelehnt', 'widerrufen', 'zurueckgezogen']) {
      const lage = fensterLage('einspruch', {
        status, ausfuehrungStatus: 'offen', bis: new Date('2026-09-18T10:30:00Z'),
      }, JETZT);
      expect(lage.art, status).toBe('falscher_stand');
    }
  });

  it('ist nach der Ausführung vorbei — und nennt die Rücknahme als den Weg', () => {
    /*
     * Die Reihenfolge der Pruefungen ist hier das Ergebnis: „bereits
     * ausgefuehrt" muss VOR „kein Fenster" stehen, weil die Ausfuehrung die
     * Fensterspalte leert. Andernfalls hiesse der haeufigste Fall „kein
     * Einspruchsfenster", wo „dafuer ist es zu spaet" die Auskunft ist, die
     * weiterhilft.
     */
    const lage = fensterLage('einspruch', ausgefuehrt(null), JETZT);
    expect(lage.art).toBe('falscher_stand');
    if (lage.art !== 'falscher_stand') throw new Error('unerreichbar');
    expect(lage.grund).toContain('Rücknahmefenster');
  });

  it('nennt eine zurückgenommene Ausführung als solche', () => {
    const lage = fensterLage('einspruch', {
      status: 'genehmigt', ausfuehrungStatus: 'zurueckgenommen', bis: null,
    }, JETZT);
    expect(lage.art).toBe('falscher_stand');
    if (lage.art !== 'falscher_stand') throw new Error('unerreichbar');
    expect(lage.grund).toContain('zurückgenommen');
  });
});

describe('das Rücknahmefenster (APR-06)', () => {
  it('gibt es erst nach der Ausführung', () => {
    const lage = fensterLage('ruecknahme', offenMitFenster(null), JETZT);
    expect(lage.art).toBe('falscher_stand');
    if (lage.art !== 'falscher_stand') throw new Error('unerreichbar');
    expect(lage.grund).toContain('NEUE Freigabe');
  });

  it('ist „nicht armiert", wo `app.freigabe_umkehrbar` nein sagt (O-368)', () => {
    /*
     * Heute ist das JEDE Vorgangsart: die einzige Handlung, die ausgefuehrt
     * wird, legt eine Eingangsrechnung an, und dafuer gibt es keinen gebauten
     * Rueckweg. Die Seite geht damit dauerhaft in ihrem leeren Zustand in
     * Betrieb — und sagt das. „Nicht armiert" ist deshalb der wichtigste Fall
     * dieser Funktion und nicht ein Randfall.
     */
    expect(fensterLage('ruecknahme', ausgefuehrt(null), JETZT).art)
      .toBe('nicht_armiert');
  });

  it('läuft mit gesetztem Fenster', () => {
    const lage = fensterLage(
      'ruecknahme', ausgefuehrt(new Date('2026-09-18T11:00:00Z')), JETZT);
    expect(lage.art).toBe('laeuft');
    if (lage.art !== 'laeuft') throw new Error('unerreichbar');
    expect(lage.restSekunden).toBe(3600);
  });

  it('ist nach Ablauf zu', () => {
    expect(fensterLage(
      'ruecknahme', ausgefuehrt(new Date('2026-09-18T09:59:59Z')), JETZT).art)
      .toBe('abgelaufen');
  });

  it('gibt es nach einer Rücknahme nicht zweimal', () => {
    const lage = fensterLage('ruecknahme', {
      status: 'genehmigt', ausfuehrungStatus: 'zurueckgenommen',
      bis: new Date('2026-09-18T11:00:00Z'),
    }, JETZT);
    expect(lage.art).toBe('falscher_stand');
  });
});

describe('die Restzeit ist eine Differenz von UTC-Instanten (Invariante 2)', () => {
  /**
   * **Die Nacht der Frühjahrsumstellung.** 2027 springt Europe/Berlin am
   * 28. März um 02:00 Ortszeit auf 03:00; in UTC ist das 01:00Z. Ein Fenster
   * von dreissig Minuten über diesen Sprung ist dreissig Minuten lang — die
   * Ortszeit springt, der Instant nicht.
   */
  it('Frühjahrsumstellung: dreissig Minuten bleiben dreissig Minuten', () => {
    const jetzt = new Date('2027-03-28T00:45:00Z');
    const bis = new Date('2027-03-28T01:15:00Z');
    const lage = fensterLage('einspruch', offenMitFenster(bis), jetzt);
    if (lage.art !== 'laeuft') throw new Error('Fenster sollte laufen');
    expect(lage.restSekunden).toBe(1800);
    /* Zum Gegenbeweis: die Ortszeitangaben lägen eine Stunde auseinander. */
    const ortJetzt = jetzt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const ortBis = bis.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    expect(ortJetzt).toContain('01:45');
    expect(ortBis).toContain('03:15');
  });

  /**
   * **Die Nacht der Herbstumstellung.** 2026 fällt Europe/Berlin am
   * 25. Oktober um 03:00 Ortszeit auf 02:00 zurück (01:00Z). „02:30" gibt es
   * in dieser Nacht zweimal; der Instant ist eindeutig.
   */
  it('Herbstumstellung: das Fenster geht zu, obwohl die Ortszeit zurückspringt', () => {
    const jetzt = new Date('2026-10-25T00:45:00Z');
    const bis = new Date('2026-10-25T01:15:00Z');
    const lage = fensterLage('ruecknahme', ausgefuehrt(bis), jetzt);
    if (lage.art !== 'laeuft') throw new Error('Fenster sollte laufen');
    expect(lage.restSekunden).toBe(1800);
    const ortJetzt = jetzt.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const ortBis = bis.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    /* Beide Ortszeiten heissen „02:45" und „02:15" — die zweite liegt SPÄTER. */
    expect(ortJetzt).toContain('02:45');
    expect(ortBis).toContain('02:15');
  });

  it('rundet ab und verspricht keine Zeit, die es nicht gibt', () => {
    const lage = fensterLage('einspruch',
      offenMitFenster(new Date('2026-09-18T10:00:59.900Z')), JETZT);
    if (lage.art !== 'laeuft') throw new Error('Fenster sollte laufen');
    expect(lage.restSekunden).toBe(59);
  });
});

describe('restInWorten', () => {
  it('sagt unter einer Minute keine Sekundenzahl — eine Seite ist kein Ticker', () => {
    expect(restInWorten(59)).toBe('weniger als eine Minute');
    expect(restInWorten(1)).toBe('weniger als eine Minute');
  });

  it('beugt den Singular', () => {
    expect(restInWorten(60)).toBe('noch 1 Minute');
    expect(restInWorten(120)).toBe('noch 2 Minuten');
    expect(restInWorten(3600)).toBe('noch 1 Stunde');
  });

  it('nennt Stunden und Minuten, wo beides zählt', () => {
    expect(restInWorten(3600 + 60)).toBe('noch 1 Stunde und 1 Minute');
    expect(restInWorten(2 * 3600 + 30 * 60)).toBe('noch 2 Stunden und 30 Minuten');
  });

  it('nennt null und negativ „abgelaufen" statt einer negativen Zahl', () => {
    expect(restInWorten(0)).toBe('abgelaufen');
    expect(restInWorten(-5)).toBe('abgelaufen');
  });
});
