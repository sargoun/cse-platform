/**
 * Was der Vergaberadar „gefunden" hat — die erste Stufe von REP-06 (V-269,
 * D-762, O-941).
 *
 * **Der Befund, den diese Datei festhält.** Die Pipeline zählte jede nicht
 * ausgeschlossene Bewertung als Fund. Bewertet wird aber jede Bekanntmachung
 * gegen jedes Profil, und ausgeschlossen wird fast nie — „gefunden" war je
 * Gesellschaft das ganze Einlesevolumen, samt der Streusalzlieferung, die
 * der Seed ausdrücklich als „eine, die kein Profil trifft" anlegt.
 *
 * Geprüft wird deshalb an der ECHTEN Bewertung (`bewerte`) mit den ECHTEN
 * Vorlagen des Seeds: welche Bekanntmachung für welche Gesellschaft ein Fund
 * ist. Dass die SQL-Bedingung (`fundSql`) dasselbe sagt, prüft
 * `tests/isolation/bericht.test.ts` (5) gegen Zeilen der Datenbank.
 */
import { describe, expect, it } from 'vitest';
import {
  bewerte, type BewertungsBekanntmachung, type BewertungsProfil, type RegelTreffer,
} from '../../src/server/services/radar/bewertung.js';
import {
  FUND_PLATZHALTER, fundSql, istFund,
} from '../../src/server/services/radar/fund.platzhalter.js';
import { SKALA_MAX_PLATZHALTER } from '../../src/server/services/radar/gewichte.platzhalter.js';
import {
  BEKANNTMACHUNGEN, PROFIL_NUTS, PROFILE, type ProfilVorlage, type Vorlage,
} from '../../src/server/db/seed/radar.js';

const JETZT = new Date('2026-09-14T10:00:00Z');
const TAG_MS = 86_400_000;

/** Eine Seed-Vorlage so, wie `bewerteLauf` sie aus der Datenbank liest. */
function alsBekanntmachung(v: Vorlage): BewertungsBekanntmachung {
  return {
    id: v.quellId,
    titel: v.titel,
    beschreibung: v.beschreibung,
    cpvHaupt: v.cpv,
    cpvWeitere: v.cpvWeitere,
    nutsCodes: v.nuts,
    wertCent: v.wertCent,
    waehrung: v.waehrung,
    /* Der Seed legt sechs Stunden auf die Tage (siehe `fristInTagen`). */
    fristAngebot: v.fristInTagen === null
      ? null : new Date(JETZT.getTime() + v.fristInTagen * TAG_MS + 6 * 3_600_000),
    oberhalbSchwellenwert: v.oberhalb,
  };
}

/**
 * Ein Seed-Profil so, wie die Datenbank es anlegt. Was der Seed nicht setzt,
 * sind die Spaltenvorgaben aus `0145_radar.sql`: Negativwirkung `abzug`,
 * Währung EUR, keine Mindestfrist, keine Seite des Schwellenwerts, die Skala
 * des Platzhalters, keine eigene Gewichtung, jede CPV-Zeile `positiv`.
 */
function alsProfil(p: ProfilVorlage): BewertungsProfil {
  return {
    id: `seed-${p.mandant}`, version: 1, name: p.name,
    cpv: p.cpv.map((c) => ({ cpvCode: c.code, praefixLaenge: c.laenge, wirkung: 'positiv' })),
    nutsPraefixe: PROFIL_NUTS,
    positivKeywords: p.positiv,
    negativKeywords: p.negativ,
    negativWirkung: 'abzug',
    wertMinCent: p.minCent, wertMaxCent: p.maxCent, waehrung: 'EUR',
    fristMinTage: null, oberhalbSchwellenwert: null,
    skalaMax: SKALA_MAX_PLATZHALTER, gewichtung: {},
  };
}

/** Was der Radar bewertet: nur aktive Bekanntmachungen (`lauf.ts`). */
const AKTIV = BEKANNTMACHUNGEN.filter((v) => v.aufgehoben !== true);

function funde(mandant: ProfilVorlage['mandant']): readonly string[] {
  const p = PROFILE.find((x) => x.mandant === mandant)!;
  return AKTIV.filter((v) => istFund(bewerte(alsBekanntmachung(v), alsProfil(p), JETZT)))
    .map((v) => v.quellId);
}

describe('der Seed: jede Gesellschaft findet ihr Gewerk — und das Streusalz niemand', () => {
  it('die Streusalzlieferung ist für kein Profil ein Fund, obwohl jedes sie bewertet', () => {
    const streusalz = AKTIV.find((v) => v.titel.includes('Streusalz'))!;
    for (const p of PROFILE) {
      const e = bewerte(alsBekanntmachung(streusalz), alsProfil(p), JETZT);
      /* Bewertet, nicht ausgeschlossen, mit Punkten — genau der alte Fund. */
      expect(e.ausgeschlossen, p.name).toBe(false);
      expect(e.punkte, p.name).toBeGreaterThan(0);
      /* Die Region trifft (DE300 im Gebiet DE3) — und begründet trotzdem keinen. */
      expect(e.aufschluesselung.find((z) => z.regel === 'region')?.treffer, p.name).toBe(true);
      expect(istFund(e), p.name).toBe(false);
    }
  });

  it('die Reinigung findet ihre drei Reinigungen, nicht Objektschutz und Rückbau', () => {
    expect(funde('reinigung')).toEqual(['demo-2026-0001', 'demo-2026-0004', 'demo-2026-0005']);
  });

  it('die Security findet den Objektschutz, der Bau den Rückbau — sonst nichts', () => {
    expect(funde('security')).toEqual(['demo-2026-0002']);
    expect(funde('bau')).toEqual(['demo-2026-0003']);
  });
});

/** Eine Zeile der Aufschlüsselung, soweit die Fundregel sie liest. */
function zeile(regel: RegelTreffer['regel'], treffer: boolean) {
  return { regel, treffer };
}

describe('istFund — die Leistung muss treffen', () => {
  it('ein CPV- oder Stichworttreffer ist ein Fund', () => {
    expect(istFund({ ausgeschlossen: false, aufschluesselung: [zeile('cpv', true)] })).toBe(true);
    expect(istFund({ ausgeschlossen: false, aufschluesselung: [zeile('stichwort', true)] }))
      .toBe(true);
  });

  it('Region, Wert, Frist und Schwellenwert allein sind keiner', () => {
    expect(istFund({
      ausgeschlossen: false,
      aufschluesselung: [
        zeile('cpv', false), zeile('region', true), zeile('stichwort', false),
        zeile('wert', true), zeile('frist', true), zeile('schwellenwert', true),
      ],
    })).toBe(false);
  });

  it('eine ausgeschlossene Bewertung ist nie ein Fund, auch mit CPV-Treffer', () => {
    expect(istFund({ ausgeschlossen: true, aufschluesselung: [zeile('cpv', true)] })).toBe(false);
  });

  it('eine Bewertung ohne Aufschlüsselung ist keiner', () => {
    expect(istFund({ ausgeschlossen: false, aufschluesselung: [] })).toBe(false);
  });
});

describe('der Platzhalter ist als solcher beschriftet und an einer Stelle austauschbar', () => {
  it('die Lesart nennt ihre offene Frage', () => {
    expect(FUND_PLATZHALTER.name).toContain('O-941');
    expect([...FUND_PLATZHALTER.regeln].sort()).toEqual(['cpv', 'stichwort']);
  });

  it('eine andere Lesart geht durch dieselbe Funktion', () => {
    const nurRegion = { name: 'nur Region', regeln: ['region'] as const };
    expect(istFund({ ausgeschlossen: false, aufschluesselung: [zeile('region', true)] }, nurRegion))
      .toBe(true);
  });

  it('die SQL-Bedingung fragt dieselben zwei Dinge: nicht ausgeschlossen, Regel trifft', () => {
    const bedingung = fundSql('b', '$4');
    expect(bedingung).toContain('not b.ausgeschlossen');
    expect(bedingung).toContain("r ->> 'regel' = any ($4::text[])");
    expect(bedingung).toContain("r ->> 'treffer' = 'true'");
  });
});
