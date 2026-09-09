/**
 * PR 11 Akzeptanz (1), (2), (4), (5).
 *
 * Alle vier sind Eigenschaften der Registrierung und der Erzeugung — sie
 * greifen, bevor eine Zeile entsteht, und lassen sich deshalb ohne Datenbank
 * pruefen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ArtFehler, ZielFehler, arten, erzeuge, findeArt, leereArten, registriereArt,
  teileFuerZusammenfassung, type ArtDefinition, type BenachrichtigungsKontext,
} from '../../src/server/benachrichtigung/registry.js';

const KONTEXT: BenachrichtigungsKontext = {
  mandantId: 'm1', objektTyp: 'rechnung', objektId: 'r1', daten: { nummer: 'RE-2026-00001' },
};

function art(teil: Partial<ArtDefinition> = {}): ArtDefinition {
  return {
    schluessel: 'finanzen.rechnung_faellig',
    titel: () => 'Rechnung fällig',
    text: (k) => `Die Rechnung ${String(k.daten['nummer'])} ist fällig.`,
    ziel: (k) => `/portal/reinigung/rechnungen/${k.objektId}`,
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: true,
    ...teil,
  };
}

beforeEach(leereArten);

describe('(1) ohne aufloesbares Ziel entsteht die Benachrichtigung gar nicht (NOT-03)', () => {
  it('ein Zielaufloeser, der null liefert, scheitert bei der ERZEUGUNG', () => {
    registriereArt(art({ ziel: () => null }));
    // Nicht beim Klick, sondern jetzt: eine Mitteilung ueber ein Problem, das
    // man nicht ansehen kann, ist schlimmer als keine.
    expect(() => erzeuge('finanzen.rechnung_faellig', KONTEXT)).toThrow(ZielFehler);
  });

  it('ein leeres Ziel ebenso', () => {
    registriereArt(art({ ziel: () => '' }));
    expect(() => erzeuge('finanzen.rechnung_faellig', KONTEXT)).toThrow(ZielFehler);
  });

  it('mit Ziel entsteht sie, und traegt Titel, Text und Pfad', () => {
    registriereArt(art());
    const b = erzeuge('finanzen.rechnung_faellig', KONTEXT);
    expect(b.titel).toBe('Rechnung fällig');
    expect(b.text).toContain('RE-2026-00001');
    expect(b.ziel).toBe('/portal/reinigung/rechnungen/r1');
  });

  it('eine unbekannte Art ist ein Fehler, keine stille Nichtzustellung', () => {
    expect(() => erzeuge('gibt.esnicht', KONTEXT)).toThrow(ArtFehler);
  });
});

describe('(2) eine abgeschaltete E-Mail wirkt in DERSELBEN Anfrage', () => {
  it('app bleibt, email geht weg', () => {
    registriereArt(art());
    const ohneMail = erzeuge('finanzen.rechnung_faellig', KONTEXT, {
      'finanzen.rechnung_faellig': ['app'],
    });
    expect(ohneMail.kanaele).toEqual(['app']);
  });

  it('und der In-App-Posteingang laesst sich nicht abschalten', () => {
    registriereArt(art());
    // Er ist das Protokoll dessen, was jemandem mitgeteilt wurde. Abgeschaltet
    // wird der Push nach draussen, nicht der Eintrag.
    const versuch = erzeuge('finanzen.rechnung_faellig', KONTEXT, {
      'finanzen.rechnung_faellig': ['email'],
    });
    expect(versuch.kanaele).toContain('app');
    expect(versuch.kanaele).toContain('email');
  });

  it('ohne Praeferenz gelten die Vorgabekanaele der Art', () => {
    registriereArt(art());
    expect(erzeuge('finanzen.rechnung_faellig', KONTEXT).kanaele).toEqual(['app', 'email']);
  });
});

describe('(4) jede registrierte Art hat Titel, Text und Zielaufloeser auf Deutsch', () => {
  it('die Registrierung verlangt alle drei', () => {
    registriereArt(art());
    registriereArt(art({ schluessel: 'zeit.antrag_offen', sammelbar: false }));

    for (const a of arten()) {
      const titel = a.titel(KONTEXT);
      const text = a.text(KONTEXT);
      expect(titel.length, a.schluessel).toBeGreaterThan(3);
      expect(text.length, a.schluessel).toBeGreaterThan(10);
      expect(a.ziel(KONTEXT), a.schluessel).not.toBeNull();
      expect(a.kanaeleVorgabe.length, a.schluessel).toBeGreaterThan(0);
    }
  });

  it('ein Schluessel ohne <modul>.<ereignis> wird abgewiesen', () => {
    expect(() => registriereArt(art({ schluessel: 'kaputt' }))).toThrow(/modul/u);
  });

  it('eine Art ohne Vorgabekanal erreichte niemanden — abgewiesen', () => {
    expect(() => registriereArt(art({ kanaeleVorgabe: [] }))).toThrow(/Vorgabekanal/u);
  });

  it('derselbe Schluessel zweimal ist ein Fehler', () => {
    registriereArt(art());
    expect(() => registriereArt(art())).toThrow(/bereits registriert/u);
  });
});

describe('(5) eine Freigabeanfrage geht nie in eine Zusammenfassung', () => {
  it('sammelbare werden gebuendelt, nicht sammelbare sofort zugestellt', () => {
    registriereArt(art());
    registriereArt(art({ schluessel: 'freigabe.angefordert', sammelbar: false }));

    const alle = [
      erzeuge('finanzen.rechnung_faellig', KONTEXT),
      erzeuge('freigabe.angefordert', KONTEXT),
      erzeuge('finanzen.rechnung_faellig', KONTEXT),
    ];
    const { sofort, sammlung } = teileFuerZusammenfassung(alle);

    // Invariante 7 haengt daran, dass jemand die Anfrage sieht, solange sie
    // noch etwas aendert. Warten hat hier dieselbe Wirkung wie Nichtstun.
    expect(sofort.map((b) => b.art)).toEqual(['freigabe.angefordert']);
    expect(sammlung).toHaveLength(2);
  });

  it('die Sammelbarkeit ist eine Eigenschaft der ART, nicht der Zeile', () => {
    registriereArt(art({ schluessel: 'freigabe.angefordert', sammelbar: false }));
    expect(findeArt('freigabe.angefordert')!.sammelbar).toBe(false);
    // Sie laesst sich beim Erzeugen nicht uebersteuern — es gibt keinen Weg,
    // eine Freigabe doch noch in die Sammlung zu schieben.
    expect(erzeuge('freigabe.angefordert', KONTEXT).sammelbar).toBe(false);
  });
});
