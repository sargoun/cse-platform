/**
 * Die Bekanntgabe des Dienstplans, ohne Datenbank (TIM-01, NOT-01, NOT-03,
 * O-710 … O-713).
 *
 * **Die Saetze, die diese Datei beweist:**
 *
 *  1. Der Zeitraum wird GEPRUEFT und nicht verbogen. Ein verkehrtes oder
 *     unlesbares Fenster ist keine Bekanntgabe „aller Schichten"; ein Fenster
 *     ueber zehn Jahre ist ein Tippfehler, den man nicht wiedergutmachen kann,
 *     weil er je Person eine Meldung erzeugt.
 *  2. Die Zeitraumart ist ein PLATZHALTER (O-710) mit einer geschlossenen
 *     Liste — ein unbekannter Wert wird abgewiesen, statt in die Spalte zu
 *     wandern und dort auf die Antwort zu warten.
 *  3. Die Benachrichtigungsart ist registriert und hat ein aufloesbares Ziel
 *     (NOT-03). Eine Meldung ohne Ziel ist eine Mitteilung ueber ein Problem,
 *     das man nicht ansehen kann — sie scheitert bei der ERZEUGUNG.
 *  4. Das Ziel ist der EIGENE Plan (`/portal/mein/schichten`) und traegt
 *     kein Bereichssegment: `/portal/mein/…` ist Personen-Scope, und eine
 *     Adresse mit `[mandant]` darin fuehrte auf 404 (`slugTor`).
 *  5. Der Datumstext ist deutsch und rechnet NICHT in Zonen: ein Berliner
 *     Kalendertag ist eine Zeichenkette, und aus ihr eine `Date` zu machen,
 *     um sie zu formatieren, waere der Weg, auf dem der 1. zum 31. wird.
 */
import { describe, expect, it } from 'vitest';
import {
  UMFAENGE, VeroeffentlichungFehler, deutschesDatum, pruefeZeitraum, zeitraumText,
} from '../../src/server/services/dienstplan/veroeffentlichung.js';
import {
  ART_PLAN_VEROEFFENTLICHT, ZIEL_MEINE_SCHICHTEN, registriereDienstplanArten,
} from '../../src/server/services/dienstplan/benachrichtigung.js';
import { erzeuge, findeArt, leereArten } from '../../src/server/benachrichtigung/registry.js';

describe('der Zeitraum wird geprueft', () => {
  it('eine Woche mit Berliner Grenzen geht durch', () => {
    expect(pruefeZeitraum('2026-09-21', '2026-09-27', 'woche')).toBe('woche');
  });

  it('ein Tag ist ein zulaessiger Zeitraum', () => {
    expect(pruefeZeitraum('2026-09-21', '2026-09-21', 'freier_zeitraum'))
      .toBe('freier_zeitraum');
  });

  it('ein verkehrtes Fenster wirft, statt alles zu bedeuten', () => {
    expect(() => pruefeZeitraum('2026-09-27', '2026-09-21', 'woche'))
      .toThrow(VeroeffentlichungFehler);
  });

  it('ein unlesbares Datum wirft', () => {
    expect(() => pruefeZeitraum('21.09.2026', '2026-09-27', 'woche'))
      .toThrow(VeroeffentlichungFehler);
  });

  /**
   * Die Wache gegen den Tippfehler, nicht eine Geschaeftsregel: 366 Tage
   * stehen auch als `dv_zeitraum_begrenzt` in 0265, damit beide Linien
   * dieselbe Grenze kennen.
   */
  it('mehr als ein Jahr wird abgewiesen — je Person eine Meldung', () => {
    expect(() => pruefeZeitraum('2026-01-01', '2028-01-01', 'freier_zeitraum'))
      .toThrow(VeroeffentlichungFehler);
    // Genau 366 Tage Abstand bleibt zulaessig (das Schaltjahr 2028).
    expect(pruefeZeitraum('2028-01-01', '2029-01-01', 'freier_zeitraum'))
      .toBe('freier_zeitraum');
  });

  it('eine unbekannte Zeitraumart wird abgewiesen (O-710 ist offen, nicht beliebig)', () => {
    expect(() => pruefeZeitraum('2026-09-21', '2026-09-27', 'quartal'))
      .toThrow(VeroeffentlichungFehler);
  });

  it('die Liste der kandidierenden Arten ist die des CHECK in 0265', () => {
    expect([...UMFAENGE]).toStrictEqual(['woche', 'monat', 'freier_zeitraum']);
  });

  it('der Fehler traegt 400 — eine Eingabe, kein Serverfehler', () => {
    expect(new VeroeffentlichungFehler('x').status).toBe(400);
  });
});

describe('der Datumstext rechnet in keiner Zone', () => {
  it('ein Berliner Kalendertag wird zu TT.MM.JJJJ', () => {
    expect(deutschesDatum('2026-09-21')).toBe('21.09.2026');
  });

  /**
   * Der Grenzfall, an dem eine Zonenrechnung auffiele: der 1. Januar. Wer
   * `new Date('2027-01-01')` formatiert und in UTC laeuft (Vercel tut das),
   * schreibt hier den 31.12.2026.
   */
  it('der 1. Januar bleibt der 1. Januar', () => {
    expect(deutschesDatum('2027-01-01')).toBe('01.01.2027');
  });

  it('was kein Kalendertag ist, bleibt unveraendert statt geraten zu werden', () => {
    expect(deutschesDatum('naechste Woche')).toBe('naechste Woche');
  });

  it('ein Zeitraum ueber einen Tag nennt den Tag nur einmal', () => {
    expect(zeitraumText('2026-09-21', '2026-09-21')).toBe('21.09.2026');
  });

  it('sonst steht „bis" dazwischen', () => {
    expect(zeitraumText('2026-09-21', '2026-09-27')).toBe('21.09.2026 bis 27.09.2026');
  });
});

describe('die Benachrichtigungsart dienstplan.plan_veroeffentlicht (NOT-01, NOT-03)', () => {
  const kontext = {
    mandantId: 'm-1',
    mandantSlug: 'reinigung',
    objektTyp: 'dienstplan_veroeffentlichung',
    objektId: 'v-1',
    daten: { zeitraum: '21.09.2026 bis 27.09.2026', schichten: 3, gesellschaft: 'Reinigung' },
  };

  it('ist nach dem Registrieren bekannt', () => {
    leereArten();
    registriereDienstplanArten();
    expect(findeArt(ART_PLAN_VEROEFFENTLICHT)).toBeDefined();
  });

  it('das Registrieren ist idempotent (D-493)', () => {
    leereArten();
    registriereDienstplanArten();
    expect(() => registriereDienstplanArten()).not.toThrow();
  });

  it('Titel und Text nennen den Zeitraum und die Zahl der eigenen Schichten', () => {
    leereArten();
    registriereDienstplanArten();
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, kontext);
    expect(b.titel).toContain('21.09.2026 bis 27.09.2026');
    expect(b.text).toContain('3 Schichten');
    expect(b.text).toContain('Reinigung');
    // Der Hinweis auf die Nachtschicht steht drin, weil genau dort gezaehlt
    // wird: 22:00–06:00 steht am Abend des Beginns.
    expect(b.text).toContain('Europe/Berlin');
  });

  it('bei genau einer Schicht steht „1 Schicht" und nicht „1 Schichten"', () => {
    leereArten();
    registriereDienstplanArten();
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, { ...kontext, daten: { ...kontext.daten, schichten: 1 } });
    expect(b.text).toContain('1 Schicht ');
    expect(b.text).not.toContain('1 Schichten');
  });

  /**
   * NOT-03 in seiner harten Form: das Ziel steht, es ist Personen-Scope, und
   * es traegt KEIN `[mandant]`-Segment. Ein Ziel aus dem Slug fuehrte auf
   * 404, weil `/portal/mein/…` keinen Bereich kennt.
   */
  it('das Ziel ist der eigene Plan und traegt kein Bereichssegment', () => {
    leereArten();
    registriereDienstplanArten();
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, kontext);
    expect(b.ziel).toBe(ZIEL_MEINE_SCHICHTEN);
    expect(b.ziel).toBe('/portal/mein/schichten');
    expect(b.ziel).not.toContain('reinigung');
  });

  it('auch OHNE Slug im Kontext bleibt das Ziel aufloesbar', () => {
    leereArten();
    registriereDienstplanArten();
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, { ...kontext, mandantSlug: null });
    expect(b.ziel).toBe(ZIEL_MEINE_SCHICHTEN);
  });

  /**
   * Nicht sammelbar: ein Dienstplan, den man am Einsatztag in einer
   * Tageszusammenfassung liest, ist einer, den man zu spaet liest.
   */
  it('ist nicht sammelbar', () => {
    leereArten();
    registriereDienstplanArten();
    expect(erzeuge(ART_PLAN_VEROEFFENTLICHT, kontext).sammelbar).toBe(false);
  });

  /**
   * Der In-App-Posteingang laesst sich nicht abschalten — er ist das
   * Protokoll dessen, was jemandem mitgeteilt wurde.
   */
  it('der Posteingang bleibt Kanal, auch wenn der Benutzer nichts will', () => {
    leereArten();
    registriereDienstplanArten();
    const b = erzeuge(ART_PLAN_VEROEFFENTLICHT, kontext, { [ART_PLAN_VEROEFFENTLICHT]: [] });
    expect(b.kanaele).toStrictEqual(['app']);
  });

  it('der Schluessel ist zusammengesetzt, damit der Rechtekatalog ihn nicht liest (K-19)', () => {
    // `dienstplan.plan_veroeffentlicht` sieht wie ein Rechteschluessel aus;
    // deshalb steht er im Quelltext als `${DIENSTPLAN}.plan_veroeffentlicht`
    // und nicht als Literal. Hier wird nur die Form geprueft.
    expect(ART_PLAN_VEROEFFENTLICHT).toBe('dienstplan.plan_veroeffentlicht');
  });
});
