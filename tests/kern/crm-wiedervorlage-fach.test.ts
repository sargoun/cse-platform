/**
 * Fristen in Berliner Kalendertagen — die Einteilung der Wiedervorlagen und
 * die Gültigkeit einer §48b-Bescheinigung AM LEISTUNGSDATUM (CRM-04, FIN-10,
 * Invariante 2, K-11).
 *
 * **Was diese Datei beweist:**
 *
 *  1. `fachFuer` vergleicht Kalendertage, nicht Zeitpunkte — und ist damit
 *     unabhängig von der Zone des Läufers. Der Läufer steht auf UTC
 *     (`vitest.config.ts`), und genau das ist der Punkt: ein Test, der nur in
 *     `Europe/Berlin` grün ist, beweist nichts über die Umrechnung.
 *  2. Die Grenzen sind scharf: gestern ist überfällig, heute ist heute,
 *     Sonntag ist diese Woche, Montag ist später.
 *  3. Die Sommerzeitumstellung verschiebt keine Einteilung — weil der Tag aus
 *     der Datenbank kommt und hier keine Stunde gerechnet wird.
 *  4. `gruppiere` lässt kein Fach weg, auch kein leeres, und verliert keine
 *     Zeile.
 *  5. `bescheinigungAm` antwortet zum STICHTAG: eine abgelaufene deckt den
 *     Tag, an dem sie galt; ein Widerruf wirkt ab seinem Tag und nicht
 *     rückwirkend.
 *  6. Die unbeschränkte Bescheinigung gewinnt gegen die auftragsbezogene —
 *     sonst entschiede die Sortierung.
 */
import { describe, expect, it } from 'vitest';
import {
  FAECHER, fachFuer, gruppiere,
  type WiedervorlageZeile, type Zeitanker,
} from '../../src/server/services/crm/wiedervorlage.js';
import {
  bescheinigungAm, type BescheinigungZeile,
} from '../../src/server/services/finanz/kunde-steuer.js';

/** Mittwoch, 17. September 2026. Die Woche endet am Sonntag, dem 20. */
const ANKER: Zeitanker = { heute: '2026-09-17', wochenende: '2026-09-20' };

function zeile(tag: string, id = tag): WiedervorlageZeile {
  return {
    id, betreff: `Wiedervorlage ${id}`, typ: 'aufgabe', kanal: null, inhalt: null,
    lead_id: null, lead_betreff: null, kunde_id: null, kunde_name: null,
    ansprechpartner_id: null, ansprechpartner: null,
    zustaendig_benutzer_id: null, zustaendig: null,
    faellig_tag: tag, faellig_text: `${tag} 09:00`, erinnerung_text: null,
  };
}

describe('fachFuer · die vier Fächer und ihre scharfen Grenzen', () => {
  it('gestern ist überfällig', () => {
    expect(fachFuer('2026-09-16', ANKER)).toBe('ueberfaellig');
  });

  it('vorletztes Jahr ist überfällig — nicht „später"', () => {
    // Der Fehler, den ein Zeichenkettenvergleich machen KÖNNTE, wenn das
    // Format nicht `YYYY-MM-DD` wäre: `9` > `17` lexikographisch.
    expect(fachFuer('2024-12-31', ANKER)).toBe('ueberfaellig');
  });

  it('heute ist heute', () => {
    expect(fachFuer('2026-09-17', ANKER)).toBe('heute');
  });

  it('morgen ist diese Woche', () => {
    expect(fachFuer('2026-09-18', ANKER)).toBe('diese_woche');
  });

  it('der Sonntag ist noch diese Woche — die Grenze schliesst ihn ein', () => {
    expect(fachFuer('2026-09-20', ANKER)).toBe('diese_woche');
  });

  it('der Montag danach ist später', () => {
    expect(fachFuer('2026-09-21', ANKER)).toBe('spaeter');
  });

  it('ein Tag im nächsten Jahr ist später', () => {
    expect(fachFuer('2027-01-02', ANKER)).toBe('spaeter');
  });
});

describe('Sommerzeit · die Einteilung kennt keine Stunden', () => {
  /*
   * Diese drei Fälle sind der Grund, warum `fachFuer` Kalendertage vergleicht
   * und nicht `Date`-Objekte: an der Umstellungsnacht hat der Tag 23 bzw. 25
   * Stunden, und jede Rechnung „Fälligkeit minus jetzt in Millisekunden"
   * verschiebt dort die Einteilung um einen Tag.
   */
  const frueh: Zeitanker = { heute: '2026-03-29', wochenende: '2026-03-29' };
  it('am Tag der Vorstellung (23 Stunden) bleibt heute heute', () => {
    expect(fachFuer('2026-03-29', frueh)).toBe('heute');
    expect(fachFuer('2026-03-28', frueh)).toBe('ueberfaellig');
    expect(fachFuer('2026-03-30', frueh)).toBe('spaeter');
  });

  const rueck: Zeitanker = { heute: '2026-10-25', wochenende: '2026-10-25' };
  it('am Tag der Rückstellung (25 Stunden) ebenso', () => {
    expect(fachFuer('2026-10-25', rueck)).toBe('heute');
    expect(fachFuer('2026-10-24', rueck)).toBe('ueberfaellig');
    expect(fachFuer('2026-10-26', rueck)).toBe('spaeter');
  });

  it('der Läufer steht auf UTC — und das Ergebnis hängt nicht daran', () => {
    // `vitest.config.ts` setzt `TZ=UTC`. Diese Zusage hält nur, weil hier
    // keine einzige Zeitzonenumrechnung passiert.
    expect(process.env['TZ']).toBe('UTC');
  });
});

describe('gruppiere · kein Fach fehlt, keine Zeile geht verloren', () => {
  const zeilen = [
    zeile('2026-09-10', 'alt'),
    zeile('2026-09-17', 'heute'),
    zeile('2026-09-19', 'woche'),
    zeile('2026-11-01', 'spaeter'),
  ];

  it('alle vier Fächer stehen in der Antwort, in der Reihenfolge der Dringlichkeit', () => {
    expect(gruppiere(zeilen, ANKER).map((g) => g.fach)).toEqual([...FAECHER]);
  });

  it('jede Zeile steht in genau einem Fach', () => {
    const gruppen = gruppiere(zeilen, ANKER);
    const ids = gruppen.flatMap((g) => g.zeilen.map((z) => z.id));
    expect(ids).toHaveLength(zeilen.length);
    expect(new Set(ids).size).toBe(zeilen.length);
  });

  it('ein leeres Fach bleibt drin — „null überfällig" ist die Auskunft', () => {
    const gruppen = gruppiere([zeile('2026-11-01')], ANKER);
    const ueberfaellig = gruppen.find((g) => g.fach === 'ueberfaellig');
    expect(ueberfaellig).toBeDefined();
    expect(ueberfaellig?.zeilen).toHaveLength(0);
  });

  it('eine leere Liste ergibt vier leere Fächer und keinen Fehler', () => {
    const gruppen = gruppiere([], ANKER);
    expect(gruppen).toHaveLength(4);
    expect(gruppen.every((g) => g.zeilen.length === 0)).toBe(true);
  });
});

describe('§ 48b EStG · gültig AM LEISTUNGSDATUM, nicht heute', () => {
  function bes(teil: Partial<BescheinigungZeile> = {}): BescheinigungZeile {
    return {
      id: 'b1', bescheinigung_nummer: 'FSB-1', finanzamt: 'FA Kreuzberg',
      gueltig_von: '2026-01-01', gueltig_bis: '2026-06-30',
      widerrufen_am: null, umfang: 'unbeschraenkt', auftrag_id: null,
      auftragsnummer: null, dokument_id: null, ...teil,
    };
  }

  it('sie deckt einen Tag in ihrem Zeitraum', () => {
    expect(bescheinigungAm([bes()], '2026-03-15')?.id).toBe('b1');
  });

  it('am ersten und am letzten Tag gilt sie — die Grenzen schliessen ein', () => {
    expect(bescheinigungAm([bes()], '2026-01-01')).not.toBeNull();
    expect(bescheinigungAm([bes()], '2026-06-30')).not.toBeNull();
  });

  it('einen Tag davor und einen danach nicht', () => {
    expect(bescheinigungAm([bes()], '2025-12-31')).toBeNull();
    expect(bescheinigungAm([bes()], '2026-07-01')).toBeNull();
  });

  it('eine ABGELAUFENE deckt weiterhin den Tag, an dem sie galt', () => {
    // Genau der Fehler, den ein Blick auf „heute" macht: die Rechnung über
    // März würde beim nächsten Ablauf rückwirkend umgedeutet.
    expect(bescheinigungAm([bes()], '2026-03-15')).not.toBeNull();
  });

  it('ein Widerruf wirkt AB seinem Tag, nicht rückwirkend', () => {
    const w = [bes({ widerrufen_am: '2026-04-01' })];
    expect(bescheinigungAm(w, '2026-03-31')).not.toBeNull();
    expect(bescheinigungAm(w, '2026-04-01')).toBeNull();
    expect(bescheinigungAm(w, '2026-05-01')).toBeNull();
  });

  it('eine auftragsbezogene deckt nur ihren Auftrag', () => {
    const a = [bes({ umfang: 'auftragsbezogen', auftrag_id: 'A-1' })];
    expect(bescheinigungAm(a, '2026-03-15', 'A-1')).not.toBeNull();
    expect(bescheinigungAm(a, '2026-03-15', 'A-2')).toBeNull();
    expect(bescheinigungAm(a, '2026-03-15')).toBeNull();
  });

  it('die unbeschränkte gewinnt gegen die auftragsbezogene', () => {
    // Stünden beide, wäre die Antwort sonst von der Sortierung abhängig.
    const beide = [
      bes({ id: 'auftrag', umfang: 'auftragsbezogen', auftrag_id: 'A-1' }),
      bes({ id: 'frei', umfang: 'unbeschraenkt' }),
    ];
    expect(bescheinigungAm(beide, '2026-03-15', 'A-1')?.id).toBe('frei');
  });

  it('keine Bescheinigung ergibt `null`, nicht einen Fehler', () => {
    expect(bescheinigungAm([], '2026-03-15')).toBeNull();
  });
});
