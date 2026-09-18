/**
 * `gruppenRadar` — die Verdichtung, ohne Datenbank.
 *
 * Die Datenbank liefert Zeilen; was der Dienst daraus macht, steht hier: eine
 * fehlende Berechtigung wird `null` und NICHT 0, eine Bekanntmachung mit zwei
 * interessierten Gesellschaften ist EINE Zeile mit zwei Zellen, ein Vorgang
 * ohne Bewertung geht nicht verloren, und die Reihenfolge richtet sich nach
 * einer ANTEILIGEN Punktzahl — weil zwei Bereiche verschiedene Skalen führen
 * dürfen.
 *
 * **Was hier NICHT geprüft wird und auch nicht kann:** ob RLS die Zeilen
 * überhaupt herausgibt. Das steht in `tests/isolation/gruppe-radar-kalender.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { gruppenRadar, RADAR_RECHT } from '../../src/server/services/gruppe/radar.js';

const R = '11111111-1111-1111-1111-111111111111';
const S = '22222222-2222-2222-2222-222222222222';

const A1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const A2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const A3 = 'aaaaaaaa-0000-0000-0000-000000000003';

interface MatrixZeile {
  ausschreibung_id: string;
  titel: string;
  vergabestelle_name: string | null;
  vergabestelle_ort: string | null;
  cpv_haupt: string | null;
  frist_angebot: Date | null;
  oberhalb_schwellenwert: boolean | null;
  rest_tage: number | null;
  wert_cent: string | null;
  waehrung: string | null;
  plattform_name: string | null;
  plattform_hinweis: string | null;
  mandant_id: string;
  slug: string;
  bereich_name: string;
  punkte: number | null;
  skala_max: number | null;
  ausgeschlossen: boolean | null;
  begruendung: string | null;
  profil_name: string | null;
  ist_platzhalter: boolean | null;
  vorgang_id: string | null;
  vorgang_status: string | null;
  registrierung: string | null;
}

function zelle(teil: Partial<MatrixZeile> & Pick<MatrixZeile, 'ausschreibung_id' | 'mandant_id'>): MatrixZeile {
  const bereich = teil.mandant_id === R
    ? { slug: 'reinigung', bereich_name: 'CSE Dienstleistungen GmbH' }
    : { slug: 'security', bereich_name: 'SSE Security' };
  return {
    titel: 'Unterhaltsreinigung Rathaus',
    vergabestelle_name: 'Bezirksamt Mitte',
    vergabestelle_ort: 'Berlin',
    cpv_haupt: '90911200',
    frist_angebot: new Date('2026-10-01T10:00:00Z'),
    oberhalb_schwellenwert: false,
    rest_tage: 12,
    wert_cent: '250000000',
    waehrung: 'EUR',
    plattform_name: 'Vergabemarktplatz Berlin',
    plattform_hinweis: null,
    punkte: null,
    skala_max: null,
    ausgeschlossen: false,
    begruendung: null,
    profil_name: null,
    ist_platzhalter: false,
    vorgang_id: null,
    vorgang_status: null,
    registrierung: null,
    ...bereich,
    ...teil,
  };
}

interface Vorgabe {
  readonly rechte: Readonly<Record<string, boolean>>;
  readonly matrix?: readonly MatrixZeile[];
  readonly summe?: Readonly<Record<string, number>>;
}

/** Ein Kontext, der auf die FORM der Abfrage antwortet — nicht auf SQL. */
function kontext(v: Vorgabe): LeseKontext {
  const abfrage = async <T,>(sql: string): Promise<readonly T[]> => {
    if (sql.includes('app.hat_recht')) {
      return Object.entries(v.rechte).map(([mandantId, ok]) => ({
        mandant_id: mandantId, recht: RADAR_RECHT, ok,
      })) as T[];
    }
    if (sql.includes('je_vergabe')) {
      return [{
        gesamt: 3, im_blick: 2, mehrfach: 1, offene_fristen: 2, knapp: 1, ...v.summe,
      }] as T[];
    }
    if (sql.includes('ausgewaehlt as')) return (v.matrix ?? []) as T[];
    if (sql.includes('ohne_freischaltung')) {
      return [
        { mandant_id: R, slug: 'reinigung', name: 'CSE Dienstleistungen GmbH',
          bewertet: 3, offene_fristen: 2, knapp: 1, ohne_freischaltung: 1,
          profile_aktiv: 2, profile_platzhalter: 2, in_bearbeitung: 1, eingereicht: 1,
          zuschlag: 1, verworfen: 0, zuschlagswert_cent: '1250000' },
        { mandant_id: S, slug: 'security', name: 'SSE Security',
          bewertet: 1, offene_fristen: 1, knapp: 0, ohne_freischaltung: 0,
          profile_aktiv: 1, profile_platzhalter: 1, in_bearbeitung: 0, eingereicht: 0,
          zuschlag: 0, verworfen: 1, zuschlagswert_cent: '0' },
      ] as T[];
    }
    throw new Error(`Unerwartete Abfrage: ${sql.slice(0, 80)}`);
  };
  return {
    scope: 'gruppe', portal: 'intern', benutzerId: 'b', aktiverMandantId: null,
    mandantIds: [R, S], abfrage,
  };
}

const OPTIONEN = { knappTage: 5 } as const;

describe('gruppenRadar — je Gesellschaft', () => {
  it('mit Recht in beiden Bereichen: Zahlen, Summen und Geld als bigint', async () => {
    const radar = await gruppenRadar(kontext({ rechte: { [R]: true, [S]: true } }), OPTIONEN);
    expect(radar.bereiche.map((b) => b.slug)).toEqual(['reinigung', 'security']);
    expect(radar.bereiche[0]?.bewertet).toBe(3);
    expect(radar.bereiche[0]?.zuschlagswertCent).toBe(1_250_000n);
    expect(radar.summe.bereiche).toBe(2);
    expect(radar.summe.ohneFreischaltung).toBe(1);
    expect(radar.summe.zuschlagswertCent).toBe(1_250_000n);
  });

  it('ohne Recht in einem Bereich: dort NULL, nicht 0 — und die Summe sagt, über wie viele', async () => {
    const radar = await gruppenRadar(kontext({ rechte: { [R]: true, [S]: false } }), OPTIONEN);
    const security = radar.bereiche[1];
    expect(security?.bewertet).toBeNull();
    expect(security?.ohneFreischaltung).toBeNull();
    expect(security?.zuschlagswertCent).toBeNull();
    // Eine 0 hier hiesse „dort ist nichts los" — das ist der ganze Unterschied.
    expect(security?.verworfen).toBeNull();
    expect(radar.summe.bereiche).toBe(1);
  });

  it('die Kennzahlen kommen aus der SUMMENABFRAGE, nicht aus der abgeschnittenen Liste', async () => {
    // Die Liste ist leer (kein Treffer unter der Anzeigegrenze), die Zaehlung
    // nicht: eine verpasste Frist ist verpasst, ob sie auf Seite eins stand.
    const radar = await gruppenRadar(
      kontext({ rechte: { [R]: true, [S]: true }, matrix: [], summe: { knapp: 7 } }), OPTIONEN);
    expect(radar.zeilen).toHaveLength(0);
    expect(radar.summe.knapp).toBe(7);
  });
});

describe('gruppenRadar — die Matrix', () => {
  it('zwei Bereiche zu einer Bekanntmachung sind EINE Zeile mit zwei Zellen', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A1, mandant_id: R, punkte: 18, skala_max: 20,
                profil_name: 'Reinigung Berlin', vorgang_status: 'in_bearbeitung',
                registrierung: 'registriert' }),
        zelle({ ausschreibung_id: A1, mandant_id: S, punkte: 9, skala_max: 20,
                profil_name: 'Objektschutz' }),
      ],
    }), OPTIONEN);

    expect(radar.zeilen).toHaveLength(1);
    const z = radar.zeilen[0]!;
    expect(z.zellen.map((c) => c.slug)).toEqual(['reinigung', 'security']);
    expect(z.zellen[0]?.punkte).toBe(18);
    expect(z.zellen[1]?.punkte).toBe(9);
    expect(z.imBlick).toEqual(['reinigung', 'security']);
    expect(z.mehrfach).toBe(true);
  });

  it('eine ausgeschlossene Bewertung ist NICHT „im Blick" — und ein verworfener Vorgang auch nicht', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A1, mandant_id: R, punkte: 0, skala_max: 20,
                ausgeschlossen: true, begruendung: 'Region ausserhalb' }),
        zelle({ ausschreibung_id: A1, mandant_id: S, punkte: 11, skala_max: 20,
                vorgang_status: 'verworfen' }),
      ],
    }), OPTIONEN);
    const z = radar.zeilen[0]!;
    // Die Security hat eine gueltige Bewertung — der verworfene Vorgang nimmt
    // sie nicht zurueck, die Bewertung zaehlt.
    expect(z.imBlick).toEqual(['security']);
    expect(z.mehrfach).toBe(false);
  });

  it('ein Vorgang OHNE Bewertung geht nicht verloren', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A2, mandant_id: R, punkte: null, skala_max: null,
                vorgang_status: 'eingereicht', registrierung: 'registriert' }),
      ],
    }), OPTIONEN);
    expect(radar.zeilen).toHaveLength(1);
    const z = radar.zeilen[0]!;
    expect(z.zellen[0]?.vorgangStatus).toBe('eingereicht');
    expect(z.zellen[0]?.punkte).toBeNull();
    expect(z.imBlick).toEqual(['reinigung']);
  });

  it('ohne Recht ist die Zelle NICHT SICHTBAR — nicht leer', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: false },
      matrix: [
        zelle({ ausschreibung_id: A1, mandant_id: R, punkte: 18, skala_max: 20 }),
        // Diese Zeile kaeme unter echter RLS gar nicht zurueck; kaeme sie doch,
        // bliebe sie unsichtbar.
        zelle({ ausschreibung_id: A1, mandant_id: S, punkte: 20, skala_max: 20 }),
      ],
    }), OPTIONEN);
    const z = radar.zeilen[0]!;
    expect(z.zellen[1]?.sichtbar).toBe(false);
    expect(z.zellen[1]?.punkte).toBeNull();
    expect(z.imBlick).toEqual(['reinigung']);
  });

  it('die Rangzahl ist ANTEILIG — 7 von 10 schlägt 8 von 20', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A1, mandant_id: R, punkte: 7, skala_max: 10 }),
        zelle({ ausschreibung_id: A2, mandant_id: S, punkte: 8, skala_max: 20,
                titel: 'Wachdienst Depot' }),
      ],
    }), OPTIONEN);
    const a1 = radar.zeilen.find((z) => z.ausschreibungId === A1)!;
    const a2 = radar.zeilen.find((z) => z.ausschreibungId === A2)!;
    expect(a1.besteQuote).toBeCloseTo(0.7);
    expect(a2.besteQuote).toBeCloseTo(0.4);
  });

  it('eine Fremdwährung wird MARKIERT und nicht umgerechnet (O-47)', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A3, mandant_id: R, waehrung: 'CHF',
                wert_cent: '9007199254740993', punkte: 5, skala_max: 10 }),
      ],
    }), OPTIONEN);
    const z = radar.zeilen[0]!;
    expect(z.fremdwaehrung).toBe(true);
    expect(z.waehrung).toBe('CHF');
    // Ueber 2^53: als Number waere die letzte Stelle weg (Invariante 1).
    expect(z.wertCent).toBe(9_007_199_254_740_993n);
  });

  it('EUR ist keine Fremdwährung, und eine fehlende Währungsangabe auch nicht', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [
        zelle({ ausschreibung_id: A1, mandant_id: R, waehrung: 'EUR', punkte: 5, skala_max: 10 }),
        zelle({ ausschreibung_id: A2, mandant_id: S, waehrung: null, wert_cent: null,
                titel: 'Ohne Wert' }),
      ],
    }), OPTIONEN);
    expect(radar.zeilen.find((z) => z.ausschreibungId === A1)?.fremdwaehrung).toBe(false);
    expect(radar.zeilen.find((z) => z.ausschreibungId === A2)?.fremdwaehrung).toBe(false);
  });

  it('die Reihenfolge der Zellen ist die der Bereiche — auch wenn eine fehlt', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [zelle({ ausschreibung_id: A1, mandant_id: S, punkte: 4, skala_max: 10 })],
    }), OPTIONEN);
    const z = radar.zeilen[0]!;
    expect(z.zellen.map((c) => c.slug)).toEqual(['reinigung', 'security']);
    // Die Reinigung hat keinen Bezug — Recht ja, Bewertung nein.
    expect(z.zellen[0]?.sichtbar).toBe(true);
    expect(z.zellen[0]?.punkte).toBeNull();
    expect(z.zellen[0]?.vorgangStatus).toBeNull();
  });

  it('ein Bereichsfilter schneidet die Zellen mit — die Auswahl ist die Seite', async () => {
    const radar = await gruppenRadar(kontext({
      rechte: { [R]: true, [S]: true },
      matrix: [zelle({ ausschreibung_id: A1, mandant_id: R, punkte: 18, skala_max: 20 })],
    }), { ...OPTIONEN, mandantIds: [R] });
    expect(radar.zeilen[0]?.zellen.map((c) => c.slug)).toEqual(['reinigung']);
    expect(radar.summe.bereiche).toBe(1);
  });
});
