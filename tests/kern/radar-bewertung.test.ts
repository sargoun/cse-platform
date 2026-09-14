/**
 * RAD-05 — die Rangfolge im Vergaberadar rechnet CODE, nicht ein Modell.
 *
 * Was hier geprüft wird, ist genau das, was ein Sprachmodell nicht leisten
 * könnte: **dieselbe Eingabe ergibt dieselbe Ausgabe**, jede Punktzahl hat
 * eine Zeile, die sie erklärt, und kein Kriterium erfindet eine Zahl, die
 * niemand entschieden hat. Die Gewichte selbst sind Platzhalter (O-15) — die
 * Tests hängen deshalb an den Regeln und an den Grenzen, nicht an „35".
 */
import { describe, expect, it } from 'vitest';
import {
  REGEL_VERSION, bewerte, eingabenHash, ganzeTage,
  type BewertungsBekanntmachung, type BewertungsProfil,
} from '../../src/server/services/radar/bewertung.js';

const JETZT = new Date('2026-09-14T10:00:00Z');

function profil(teil: Partial<BewertungsProfil> = {}): BewertungsProfil {
  return {
    id: 'profil-1', version: 1, name: 'Unterhaltsreinigung Berlin',
    cpv: [{ cpvCode: '90910000', praefixLaenge: 8, gewichtung: 100, wirkung: 'positiv' }],
    nutsPraefixe: ['DE3'],
    positivKeywords: ['Unterhaltsreinigung'],
    negativKeywords: [],
    negativWirkung: 'abzug',
    wertMinCent: null, wertMaxCent: null, waehrung: 'EUR',
    fristMinTage: null, oberhalbSchwellenwert: null,
    skalaMax: 100, gewichtung: {},
    ...teil,
  };
}

function bekanntmachung(teil: Partial<BewertungsBekanntmachung> = {}): BewertungsBekanntmachung {
  return {
    id: 'a-1',
    titel: 'Unterhaltsreinigung mehrerer Dienstgebäude',
    beschreibung: 'Laufende Reinigung, Los 1',
    cpvHaupt: '90910000-9',
    cpvWeitere: [],
    nutsCodes: ['DE300'],
    wertCent: null, waehrung: null,
    fristAngebot: new Date('2026-10-14T10:00:00Z'),
    oberhalbSchwellenwert: null,
    ...teil,
  };
}

describe('die Bewertung ist deterministisch (RAD-05)', () => {
  /**
   * **Der Kern der Zusage.** Zweimal dasselbe rechnen und zwei verschiedene
   * Zahlen bekommen, wäre der Moment, in dem die Liste ihren Wert verliert:
   * niemand könnte einer Reihenfolge widersprechen, die morgen anders ist.
   */
  it('zweimal dieselbe Eingabe ergibt dieselbe Punktzahl, denselben Satz, denselben Hash', () => {
    const a = bewerte(bekanntmachung(), profil(), JETZT);
    const b = bewerte(bekanntmachung(), profil(), JETZT);
    expect(a.punkte).toBe(b.punkte);
    expect(a.begruendung).toBe(b.begruendung);
    expect(a.eingabenHash).toBe(b.eingabenHash);
    expect(a.regelVersion).toBe(REGEL_VERSION);
  });

  /**
   * Die Reihenfolge, in der die Datenbank Mengen liefert, ist nicht zugesagt.
   * Hinge der Hash daran, entstünde bei jedem Lauf eine neue Bewertungszeile —
   * und die Tabelle wüchse, ohne dass sich etwas geändert hätte.
   */
  it('die Reihenfolge von CPV-Zeilen, Stichwörtern und NUTS-Codes ändert den Hash nicht', () => {
    const p1 = profil({
      cpv: [
        { cpvCode: '90910000', praefixLaenge: 8, gewichtung: 100, wirkung: 'positiv' },
        { cpvCode: '90911200', praefixLaenge: 8, gewichtung: 80, wirkung: 'positiv' },
      ],
      positivKeywords: ['Unterhaltsreinigung', 'Glasreinigung'],
    });
    const p2 = profil({
      cpv: [
        { cpvCode: '90911200', praefixLaenge: 8, gewichtung: 80, wirkung: 'positiv' },
        { cpvCode: '90910000', praefixLaenge: 8, gewichtung: 100, wirkung: 'positiv' },
      ],
      positivKeywords: ['Glasreinigung', 'Unterhaltsreinigung'],
    });
    expect(eingabenHash(bekanntmachung({ nutsCodes: ['DE300', 'DE400'] }), p1, REGEL_VERSION))
      .toBe(eingabenHash(bekanntmachung({ nutsCodes: ['DE400', 'DE300'] }), p2, REGEL_VERSION));
  });

  /** Eine geänderte Profilversion IST eine andere Eingabe — sonst bliebe eine nachgeschärfte Suche wirkungslos. */
  it('eine neue Profilversion ergibt einen neuen Hash', () => {
    expect(eingabenHash(bekanntmachung(), profil({ version: 1 }), REGEL_VERSION))
      .not.toBe(eingabenHash(bekanntmachung(), profil({ version: 2 }), REGEL_VERSION));
  });

  /** Der Code liest keine Uhr: derselbe Zeitpunkt herein, dasselbe Ergebnis heraus. */
  it('der Zeitpunkt kommt herein und wird nicht gelesen', () => {
    const frueh = bewerte(bekanntmachung(), profil(), new Date('2026-09-14T00:00:00Z'));
    const spaet = bewerte(bekanntmachung(), profil(), new Date('2026-09-14T23:00:00Z'));
    /* Beide sehen dieselbe Restfrist in ganzen Tagen — der Unterschied liegt allein am Parameter. */
    expect(frueh.punkte).toBe(spaet.punkte);
  });
});

describe('die sechs Kriterien (RAD-04, RAD-05)', () => {
  it('CPV-Praefix: 45000000 bei Laenge 2 faengt den ganzen Hochbau', () => {
    const e = bewerte(
      bekanntmachung({ cpvHaupt: '45210000-2', titel: 'Neubau', beschreibung: null, nutsCodes: [] }),
      profil({
        cpv: [{ cpvCode: '45000000', praefixLaenge: 2, gewichtung: 100, wirkung: 'positiv' }],
        nutsPraefixe: [], positivKeywords: [],
      }),
      JETZT,
    );
    const cpv = e.aufschluesselung.find((z) => z.regel === 'cpv');
    expect(cpv?.treffer).toBe(true);
    expect(cpv?.rohWert).toBe('45000000');
  });

  it('die Pruefziffer hinter dem Bindestrich entscheidet nichts', () => {
    const mit = bewerte(bekanntmachung({ cpvHaupt: '90910000-9' }), profil(), JETZT);
    const ohne = bewerte(bekanntmachung({ cpvHaupt: '90910000' }), profil(), JETZT);
    expect(mit.punkte).toBe(ohne.punkte);
  });

  it('die Region trifft ueber das Praefix: DE3 faengt DE300', () => {
    const e = bewerte(bekanntmachung({ nutsCodes: ['DE300'] }), profil({ nutsPraefixe: ['DE3'] }), JETZT);
    expect(e.aufschluesselung.find((z) => z.regel === 'region')?.treffer).toBe(true);
    const daneben = bewerte(
      bekanntmachung({ nutsCodes: ['DE712'] }), profil({ nutsPraefixe: ['DE3'] }), JETZT);
    expect(daneben.aufschluesselung.find((z) => z.regel === 'region')?.treffer).toBe(false);
  });

  it('Stichwoerter werden ohne Ruecksicht auf Gross- und Kleinschreibung gesucht', () => {
    const e = bewerte(
      bekanntmachung({ titel: 'UNTERHALTSREINIGUNG Rathaus', beschreibung: null }),
      profil(), JETZT);
    expect(e.aufschluesselung.find((z) => z.regel === 'stichwort')?.treffer).toBe(true);
  });

  /**
   * **Die Grenze, an der ein „plausibler Wert" teuer wird.** Eine Bekanntmachung
   * in Fremdwährung wird NICHT umgerechnet (O-47). Sie verschwindet aber auch
   * nicht: sie steht in der Liste, und der Satz sagt, warum der Wert nicht zählt.
   */
  it('Fremdwaehrung wird nicht umgerechnet, sondern benannt', () => {
    const e = bewerte(
      bekanntmachung({ wertCent: 50_000_00n, waehrung: 'CHF' }),
      profil({ wertMinCent: 10_000_00n, wertMaxCent: 100_000_00n }), JETZT);
    expect(e.wertKriterium).toBe('fremdwaehrung');
    expect(e.ausgeschlossen).toBe(false);
    expect(e.begruendung).toContain('O-47');
    expect(e.aufschluesselung.find((z) => z.regel === 'wert')?.punkte).toBe(0);
  });

  it('ohne Auftragswert bleibt das Wertkriterium unbewertet — und sagt es', () => {
    const e = bewerte(bekanntmachung({ wertCent: null }),
      profil({ wertMinCent: 1000n, wertMaxCent: 2000n }), JETZT);
    expect(e.wertKriterium).toBe('ohne_wert');
    expect(e.begruendung).toContain('keinen Auftragswert');
  });

  it('ein Wert im Rahmen zaehlt, einer darueber nicht', () => {
    const drin = bewerte(bekanntmachung({ wertCent: 50_000_00n, waehrung: 'EUR' }),
      profil({ wertMinCent: 10_000_00n, wertMaxCent: 100_000_00n }), JETZT);
    const drueber = bewerte(bekanntmachung({ wertCent: 500_000_00n, waehrung: 'EUR' }),
      profil({ wertMinCent: 10_000_00n, wertMaxCent: 100_000_00n }), JETZT);
    expect(drin.punkte).toBeGreaterThan(drueber.punkte);
    expect(drueber.aufschluesselung.find((z) => z.regel === 'wert')?.text).toContain('Obergrenze');
  });

  /** RAD-06 nennt fünf Tage; unter der Mindestfrist des Profils kostet es das ganze Kriterium. */
  it('die Restfrist steht in Tagen im Satz, und eine kurze kostet Punkte', () => {
    const knapp = bewerte(
      bekanntmachung({ fristAngebot: new Date('2026-09-16T10:00:00Z') }), profil(), JETZT);
    const reichlich = bewerte(
      bekanntmachung({ fristAngebot: new Date('2026-11-14T10:00:00Z') }), profil(), JETZT);
    expect(knapp.begruendung).toContain('2 Tage');
    expect(knapp.punkte).toBeLessThan(reichlich.punkte);
  });

  it('eine abgelaufene Frist zaehlt nicht mehr, schliesst aber nicht aus', () => {
    const e = bewerte(
      bekanntmachung({ fristAngebot: new Date('2026-09-01T10:00:00Z') }), profil(), JETZT);
    expect(e.aufschluesselung.find((z) => z.regel === 'frist')?.punkte).toBe(0);
    expect(e.ausgeschlossen).toBe(false);
    expect(e.begruendung).toContain('abgelaufen');
  });
});

describe('Ausschluss ist eine Entscheidung des Profils, nie des Codes', () => {
  it('ein Negativ-Stichwort zieht ab — ausgeschlossen wird nur, wer es so eingestellt hat (O-191)', () => {
    const b = bekanntmachung({ titel: 'Baureinigung nach Rohbau', beschreibung: null });
    const abzug = bewerte(b, profil({ negativKeywords: ['Baureinigung'], negativWirkung: 'abzug' }), JETZT);
    const aus = bewerte(b, profil({ negativKeywords: ['Baureinigung'], negativWirkung: 'ausschluss' }), JETZT);
    expect(abzug.ausgeschlossen, 'die sichere Vorgabe ist der Abzug').toBe(false);
    expect(aus.ausgeschlossen).toBe(true);
    expect(aus.ausschlussGrund).toContain('Baureinigung');
    expect(aus.punkte).toBe(0);
  });

  it('ein CPV-Code mit Wirkung „ausschluss" schliesst aus und nennt sich', () => {
    const e = bewerte(
      bekanntmachung({ cpvHaupt: '45210000' }),
      profil({ cpv: [{ cpvCode: '45210000', praefixLaenge: 8, gewichtung: 100, wirkung: 'ausschluss' }] }),
      JETZT);
    expect(e.ausgeschlossen).toBe(true);
    expect(e.punkte).toBe(0);
    expect(e.begruendung).toContain('45210000');
  });
});

describe('die Punktzahl bleibt in ihrer Skala', () => {
  it('kein Ergebnis liegt unter null oder ueber skala_max', () => {
    const alles = bewerte(
      bekanntmachung({ wertCent: 50_000_00n, waehrung: 'EUR', oberhalbSchwellenwert: true }),
      profil({ wertMinCent: 1n, wertMaxCent: 999_999_99n, oberhalbSchwellenwert: true,
        positivKeywords: ['Unterhaltsreinigung', 'Reinigung', 'Dienstgebäude'] }),
      JETZT);
    expect(alles.punkte).toBeLessThanOrEqual(100);
    expect(alles.punkte).toBeGreaterThanOrEqual(0);

    const nichts = bewerte(
      bekanntmachung({ titel: 'Lieferung von Streusalz', beschreibung: null, cpvHaupt: '14400000',
        nutsCodes: ['DE712'] }),
      profil({ negativKeywords: ['Streusalz'] }), JETZT);
    expect(nichts.punkte).toBeGreaterThanOrEqual(0);
  });

  it('eine eigene Skala im Profil begrenzt das Ergebnis', () => {
    const e = bewerte(bekanntmachung(), profil({ skalaMax: 10 }), JETZT);
    expect(e.skalaMax).toBe(10);
    expect(e.punkte).toBeLessThanOrEqual(10);
  });

  /** Jede Zeile der Aufschlüsselung steht auch im Satz — sonst wäre die Begründung eine Behauptung. */
  it('jede Regel steht in der Aufschluesselung und im Satz', () => {
    const e = bewerte(bekanntmachung({ oberhalbSchwellenwert: false }),
      profil({ oberhalbSchwellenwert: true }), JETZT);
    const regeln = e.aufschluesselung.map((z) => z.regel);
    expect(regeln).toContain('cpv');
    expect(regeln).toContain('region');
    expect(regeln).toContain('stichwort');
    expect(regeln).toContain('wert');
    expect(regeln).toContain('frist');
    expect(regeln).toContain('schwellenwert');
    for (const zeile of e.aufschluesselung) {
      expect(e.begruendung, zeile.regel).toContain(zeile.text);
    }
  });
});

describe('ganze Tage', () => {
  it('rundet ab: ein halber Tag ist keiner', () => {
    expect(ganzeTage(new Date('2026-09-14T10:00:00Z'), new Date('2026-09-15T09:00:00Z'))).toBe(0);
    expect(ganzeTage(new Date('2026-09-14T10:00:00Z'), new Date('2026-09-15T10:00:00Z'))).toBe(1);
  });
});
