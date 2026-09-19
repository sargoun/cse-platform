/**
 * Die reinen Teile der Ausgaben-, Beleg- und Vorabprüfungsschicht
 * (FIN-14, FIN-17, FIN-18, ACC-03, O-46, O-185, O-186, O-601).
 *
 * **Warum ein Test über Platzhalter.** Ein Platzhalter, der still zu einer
 * Zahl wird, ist der teuerste Fehler dieser Domäne: er sieht wie eine
 * Entscheidung aus. `EIGENBELEG_PLATZHALTER.grenzeCent` muss `null` bleiben
 * und `istPlatzhalter` `true` — und die Herkunft muss die offene Frage
 * NENNEN, weil die Oberfläche sie wörtlich anzeigt. Genau dasselbe gilt für
 * `BAGATELLGRENZE_PLATZHALTER` (§48 EStG) und
 * `BEDINGUNGEN_PLATZHALTER` (VOB/B §17): beide wurden schon einmal
 * missverstanden, weil `einbehaltCent()` bei `null` ein `0n` zurückgibt und
 * nicht wirft.
 *
 * **Und ein Test über den Quellensatz von `beleg_quelle`.** Der engere Typ in
 * `eingangsrechnung.ts` kennt `erzeugt` nicht; ein Filter darauf liess jede
 * erzeugte Ausgangsrechnung lautlos aus der Liste verschwinden. Der Satz hier
 * ist der volle, und dieser Test hält ihn fest.
 */
import { describe, expect, it } from 'vitest';
import {
  AUSGABE_STATUS, EIGENBELEG_PLATZHALTER, istAusgabeStatus,
} from '../../src/server/services/finanz/ausgabe.js';
import {
  BELEG_QUELLEN, BELEG_TYPEN, QUELLE_TEXT, TYP_TEXT, istBelegQuelle, istBelegTyp,
} from '../../src/server/services/finanz/beleg.js';
import {
  NICHT_GEPRUEFT, REGELN, regelText,
} from '../../src/server/services/finanz/vorabpruefung.js';
import {
  ELEKTRONISCHE_KANAELE, KANAL_TEXT, irgendeinWegVerbunden, type Versandweg,
} from '../../src/server/services/finanz/versand.js';
import {
  BAGATELLGRENZE_PLATZHALTER, STICHTAG_QUELLE,
} from '../../src/server/services/finanz/estg48/grenzen.platzhalter.js';
import { BEDINGUNGEN_PLATZHALTER }
  from '../../src/server/services/finanz/abschlag/bedingungen.platzhalter.js';
import { einbehaltCent } from '../../src/server/services/finanz/abschlag/bedingungen.js';
import { cent, NULL_CENT } from '../../src/server/services/finanz/geld.js';

describe('Ausgabe — Zustände', () => {
  it('kennt genau vier Zustände, ohne in_pruefung', () => {
    /*
     * `ausgabe_status` spiegelt `eingangsrechnung_status` OHNE `in_pruefung`
     * (05-FINANZEN.md §7): eine Ausgabe wird erfasst und freigegeben, nicht
     * in einem Kreditorenlauf geprüft. Ein fünfter Wert hier wäre ein
     * Zustand, den die Datenbank nicht kennt — und dann eine Pille für einen
     * Zustand, der nie eintritt.
     */
    expect([...AUSGABE_STATUS]).toEqual(['erfasst', 'freigegeben', 'gebucht', 'abgelehnt']);
  });

  it('weist unbekannte Zustände ab, auch solche, die plausibel klingen', () => {
    expect(istAusgabeStatus('erfasst')).toBe(true);
    expect(istAusgabeStatus('in_pruefung')).toBe(false);
    expect(istAusgabeStatus('bezahlt')).toBe(false);
    expect(istAusgabeStatus(undefined)).toBe(false);
    expect(istAusgabeStatus(3)).toBe(false);
  });
});

describe('Eigenbeleg — O-185 bleibt eine Frage', () => {
  it('trägt keine Grenze und sagt das', () => {
    expect(EIGENBELEG_PLATZHALTER.grenzeCent).toBeNull();
    expect(EIGENBELEG_PLATZHALTER.istPlatzhalter).toBe(true);
  });

  it('nennt die O-Nummer in der Herkunft, die die Oberfläche wörtlich zeigt', () => {
    expect(EIGENBELEG_PLATZHALTER.herkunft).toContain('O-185');
    expect(EIGENBELEG_PLATZHALTER.herkunft).toMatch(/nicht entschieden/iu);
  });
});

describe('§48 EStG — O-21 bleibt eine Frage', () => {
  it('hat keine Bagatellgrenze und behauptet keine', () => {
    expect(BAGATELLGRENZE_PLATZHALTER.grenzeCent).toBeNull();
    expect(BAGATELLGRENZE_PLATZHALTER.istPlatzhalter).toBe(true);
    expect(BAGATELLGRENZE_PLATZHALTER.herkunft).toContain('O-21');
  });

  it('bewertet gegen das Leistungsende und nicht gegen die Zahlung', () => {
    /*
     * Die Wahl ist eine Entscheidung mit Fundstelle (§4.1) und keine
     * Vorliebe: der Gesetzeswortlaut knüpft an die Zahlung an, SPEC FIN-10
     * an das Leistungsdatum. Ändert jemand die Konstante, soll dieser Test
     * anhalten und nicht die Rechnung.
     */
    expect(STICHTAG_QUELLE).toBe('leistung_bis');
  });
});

describe('Sicherheitseinbehalt — O-20, und der Fehler, der NICHT geworfen wird', () => {
  it('rechnet 0 und wirft nicht', () => {
    /*
     * Hier stolpert eine Oberfläche, die auf einen Fehler wartet:
     * `EinbehaltNichtEntschiedenFehler` ist deklariert und wird nirgends
     * geworfen. Eine Schlussrechnung ohne entschiedenen Einbehalt ist keine
     * kaputte Rechnung, sondern eine ohne Einbehalt.
     */
    const betrag = einbehaltCent(BEDINGUNGEN_PLATZHALTER, {
      auftragssummeNettoCent: cent(1_000_000n),
      schlussNettoCent: cent(800_000n),
    });
    expect(betrag).toBe(NULL_CENT);
  });

  it('nennt die offene Frage in der Herkunft — DAS zeigt die Oberfläche', () => {
    expect(BEDINGUNGEN_PLATZHALTER.einbehalt).toBeNull();
    expect(BEDINGUNGEN_PLATZHALTER.istPlatzhalter).toBe(true);
    expect(BEDINGUNGEN_PLATZHALTER.herkunft).toContain('O-20');
  });
});

describe('Belegtypen und -quellen', () => {
  it('führt FÜNF Quellen, einschliesslich erzeugt', () => {
    /*
     * Der Satz muss dem DB-Enum `beleg_quelle` entsprechen. Fehlte
     * `erzeugt`, verschwände jede von der Plattform erstellte
     * Ausgangsrechnung lautlos aus der Belegliste — kein Fehler, nur eine
     * Liste, in der etwas fehlt, das niemand zählt.
     */
    expect([...BELEG_QUELLEN]).toEqual(['upload', 'email', 'scan', 'api', 'erzeugt']);
    expect(istBelegQuelle('erzeugt')).toBe(true);
    expect(istBelegQuelle('erstellt')).toBe(false);
  });

  it('führt sieben Typen und beschriftet jeden', () => {
    expect(BELEG_TYPEN).toHaveLength(7);
    for (const t of BELEG_TYPEN) {
      expect(TYP_TEXT[t]).toBeTruthy();
      expect(istBelegTyp(t)).toBe(true);
    }
    for (const q of BELEG_QUELLEN) expect(QUELLE_TEXT[q]).toBeTruthy();
  });
});

describe('Vorab-Prüfungen', () => {
  it('nennt für jede Regel Fundstelle, Stufe und Text', () => {
    for (const r of REGELN) {
      const t = regelText(r.regel);
      expect(t.fundstelle).toBeTruthy();
      expect(t.kurz).toBeTruthy();
      expect(t.text.length).toBeGreaterThan(40);
      expect(['fehler', 'warnung']).toContain(t.stufe);
    }
  });

  it('hält FIN-18 als Warnung und die fehlende Herkunft als Fehler', () => {
    /*
     * Die Unterscheidung ist die ganze Aussage dieser Liste: FIN-18 lässt
     * sich mit protokollierter Begründung übergehen, eine Zeile ohne
     * Herkunft nicht — die Festschreibung weist sie ab. Eine Warnung, die
     * wie ein Fehler aussieht, wird weggeklickt; ein Fehler, der wie eine
     * Warnung aussieht, hält niemanden auf.
     */
    expect(regelText('fin18_keine_zeit').stufe).toBe('warnung');
    expect(regelText('entwurf_ohne_quelle').stufe).toBe('fehler');
    expect(regelText('auftrag_ohne_rechnung').stufe).toBe('warnung');
  });

  it('wirft bei einer Regel, die es nicht gibt, statt Text zu erfinden', () => {
    expect(() => regelText('irgendwas' as never)).toThrow(/Unbekannte Vorabprüfungsregel/u);
  });

  it('schreibt die eigenen Grenzen aus, mit O-Nummer', () => {
    expect(NICHT_GEPRUEFT.length).toBeGreaterThan(0);
    const alles = NICHT_GEPRUEFT.map((n) => n.grund).join(' ');
    expect(alles).toContain('O-601');
    expect(alles).toContain('O-602');
  });
});

describe('Versandwege', () => {
  it('kennt vier elektronische Kanäle — Portal und Post sind keine', () => {
    /*
     * `kundenportal` und `post` sind KEIN elektronischer Versand durch die
     * Plattform: das Portal zeigt das Dokument, Papier kuvertiert ein
     * Mensch. Stünden sie hier, verlangte die Seite eine Verbindung für
     * etwas, das keine braucht — und der Auslöser in 0181 liesse sie durch.
     */
    expect([...ELEKTRONISCHE_KANAELE]).toEqual(['peppol', 'zre', 'ozg_re', 'email']);
    expect(KANAL_TEXT['kundenportal']).toBeTruthy();
    expect(KANAL_TEXT['post']).toBeTruthy();
  });

  it('sagt „kein Weg verbunden", solange keiner verbunden ist', () => {
    const wege: readonly Versandweg[] = ELEKTRONISCHE_KANAELE.map((kanal) => ({
      kanal, text: KANAL_TEXT[kanal], verbunden: false, grund: 'offen',
    }));
    expect(irgendeinWegVerbunden(wege)).toBe(false);
    expect(irgendeinWegVerbunden(
      wege.map((w, i) => (i === 3 ? { ...w, verbunden: true, grund: null } : w)),
    )).toBe(true);
  });
});
