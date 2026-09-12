/**
 * PR 37, die Teile ohne Datenbank: die Saldoformel, die kombinierte Sicht
 * (EMP-15) und die zwei Regeln, die AUSDRUECKLICH keine Antwort liefern
 * (O-18).
 *
 * Die letzten beiden sind die wichtigeren Faelle. Ein Platzhalter, der eine
 * plausible Zahl liefert, ist von einer Entscheidung nicht zu unterscheiden —
 * und niemand fragt nach, weil auf dem Bildschirm etwas Richtiges steht. Die
 * Tests halten deshalb fest, dass beide Regeln WERFEN und nicht rechnen.
 */
import { describe, expect, it } from 'vitest';
import {
  kombiniereKonten, saldoMinuten, type Stundenkonto,
} from '../../src/server/services/zeit/stundenkonto.js';
import {
  SOLLSTUNDEN_OFFEN, SollstundenOffenFehler, sollMinutenOderFehler,
} from '../../src/server/services/zeit/sollstunden.js';
import {
  anspruchOderFehler, URLAUBSANSPRUCH_OFFEN, UrlaubsanspruchOffenFehler,
} from '../../src/server/services/zeit/urlaubskonto.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import { ZeitFehler } from '../../src/server/services/zeit/dauer.js';

function konto(teil: Partial<Stundenkonto>): Stundenkonto {
  return {
    id: 'k', mandantId: 'm', anstellungId: 'a', jahr: 2026, monat: 3,
    sollMinuten: 0, istMinuten: 0, korrekturMinuten: 0,
    saldoVortragMinuten: 0, saldoMinuten: 0, status: 'offen', gesperrtAm: null,
    ...teil,
  };
}

describe('der Saldo ist eine Formel, keine gefuehrte Zahl', () => {
  it('Vortrag + Ist − Soll, mit Vorzeichen', () => {
    expect(saldoMinuten(0, 480, 480)).toBe(0);
    expect(saldoMinuten(120, 480, 600)).toBe(0);
    // Der interessante Fall: ein NEGATIVER Vortrag bleibt negativ. Ein
    // `Math.max(0, …)` waere die stille Loeschung von Minusstunden.
    expect(saldoMinuten(-90, 400, 480)).toBe(-170);
  });
});

describe('EMP-15 — die kombinierte Zahl wird gerechnet, nie gespeichert', () => {
  it('zwei Beschaeftigungen ergeben eine Anzeige und bleiben zwei Konten', () => {
    const reinigung = konto({ id: 'r', anstellungId: 'a1', istMinuten: 600, sollMinuten: 480,
      saldoMinuten: 120 });
    const security = konto({ id: 's', anstellungId: 'a2', istMinuten: 300, sollMinuten: 360,
      saldoMinuten: -60 });

    const zusammen = kombiniereKonten([reinigung, security]);
    expect(zusammen.istMinuten).toBe(900);
    expect(zusammen.sollMinuten).toBe(840);
    expect(zusammen.saldoMinuten).toBe(60);
    // Und die Einzelkonten stehen unveraendert daneben: EMP-15 verlangt
    // BEIDES — die Summe fuer den Menschen, die Trennung fuer die Gesellschaft.
    expect(zusammen.konten).toHaveLength(2);
    expect(zusammen.konten[0]?.saldoMinuten).toBe(120);
    expect(zusammen.konten[1]?.saldoMinuten).toBe(-60);
  });

  it('zwei verschiedene Monate lassen sich nicht zu einer Zahl addieren', () => {
    // Ohne diese Sperre summierte eine Portalansicht mit falschem Filter
    // Maerz und April zu einem Monat, den es nicht gibt.
    expect(() => kombiniereKonten([konto({ monat: 3 }), konto({ monat: 4 })]))
      .toThrow(ZeitFehler);
  });
});

describe('O-18 — die Sollzeit wird nicht geraten', () => {
  const eingabe = {
    anstellungId: 'a', jahr: 2026, monat: 3,
    wochenstunden: milliMenge(40_000n), arbeitszeitmodell: 'vollzeit',
  };

  it('die ausgelieferte Regel antwortet nicht', () => {
    expect(SOLLSTUNDEN_OFFEN.sollMinuten(eingabe)).toBeNull();
  });

  it('und `sollMinutenOderFehler` wirft, statt 0 zu liefern', () => {
    /**
     * Der Unterschied entscheidet den Saldo. Mit `?? 0` waere jede geleistete
     * Minute eine Ueberstunde — eine Zahl, die plausibel aussieht und in jedem
     * Monat falsch ist.
     */
    expect(() => sollMinutenOderFehler(SOLLSTUNDEN_OFFEN, eingabe))
      .toThrow(SollstundenOffenFehler);
  });

  it('eine hinterlegte Regel wird benutzt — die Schnittstelle traegt', () => {
    const regel = { schluessel: 'test', sollMinuten: (): number => 10_080 };
    expect(sollMinutenOderFehler(regel, eingabe)).toBe(10_080);
  });
});

describe('O-18 — der Urlaubsanspruch wird nicht geraten', () => {
  const eingabe = {
    anstellungId: 'a', jahr: 2026, arbeitszeitmodell: 'vollzeit',
    wochenstunden: milliMenge(40_000n), eintritt: '2024-01-01', austritt: null,
  };

  it('die ausgelieferte Regel antwortet nicht', () => {
    expect(URLAUBSANSPRUCH_OFFEN.anspruchTage(eingabe)).toBeNull();
  });

  it('und `anspruchOderFehler` wirft, statt 20 oder 24 einzusetzen', () => {
    // § 3 BUrlG nennt 24 Werktage bei Sechstagewoche. Diese Zahl hier
    // einzusetzen waere eine Aussage ueber einen einklagbaren Anspruch.
    expect(() => anspruchOderFehler(URLAUBSANSPRUCH_OFFEN, eingabe))
      .toThrow(UrlaubsanspruchOffenFehler);
  });

  it('eine hinterlegte Regel wird benutzt', () => {
    const regel = {
      schluessel: 'test',
      anspruchTage: (): ReturnType<typeof milliMenge> => milliMenge(30_000n),
    };
    expect(anspruchOderFehler(regel, eingabe)).toBe(30_000n);
  });
});
