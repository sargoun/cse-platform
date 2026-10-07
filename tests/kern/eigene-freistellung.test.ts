/**
 * Die eigene Freistellungsbescheinigung der Gesellschaft (V-388, O-130, D-846)
 * — was ohne Datenbank entschieden wird.
 *
 * Was die Datenbank hält — die eigene ohne Kunde und Lieferant (0531), der
 * Steuerfall der Ausgangsrechnung mit IHR statt mit der des Kunden, der
 * Beleg, der sie nennt, und der Nachtlauf —, steht in
 * `tests/isolation/steuerfall.test.ts` und `tests/isolation/freistellung.test.ts`
 * (8, 9). Hier:
 *
 *  1. Die Stufen des Hinweises: 60, 30, 7 Tage — die kleinste, die passt.
 *  2. Wer erinnert wird: nicht mit Nachfolgerin, nicht nach einem Widerruf,
 *     und eine Lücke von einem Tag ist keine Nachfolge.
 *  3. Die Art der Meldung: Satz, Ziel, Name — und sie steht im Register.
 *  4. Die Verdrahtung: Steuerfall, Beleg, Formular und Seed.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ABLAUF_STUFEN, ablaufStufe, eigeneAblaeufe, type EigeneBescheinigung,
} from '../../src/server/services/finanz/freistellung-ablauf.js';
import {
  ART_FREISTELLUNG_LAEUFT_AB, registriereWaechterArten,
} from '../../src/server/services/waechter/benachrichtigung.js';
import { erzeuge, leereArten } from '../../src/server/benachrichtigung/registry.js';
import { KONTO_BENACHRICHTIGUNG_TEXTE } from '../../src/lib/i18n/konto.js';
import { FREISTELLUNG_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/freistellungen.js';

const B = (mehr: Partial<EigeneBescheinigung> = {}): EigeneBescheinigung => ({
  id: 'a', nummer: 'FB-1', gueltigVon: '2025-01-01', gueltigBis: '2026-11-30',
  widerrufenAm: null, umfang: 'unbeschraenkt', auftragId: null, ...mehr,
});

describe('die Stufen des Hinweises (Voreinstellung O-130)', () => {
  it('60, 30, 7 — die kleinste, die die Tage noch enthält', () => {
    expect(ABLAUF_STUFEN).toEqual([60, 30, 7]);
    expect(ablaufStufe(61)).toBeNull();
    expect(ablaufStufe(60)).toBe(60);
    expect(ablaufStufe(31)).toBe(60);
    expect(ablaufStufe(30)).toBe(30);
    expect(ablaufStufe(8)).toBe(30);
    expect(ablaufStufe(7)).toBe(7);
    expect(ablaufStufe(0)).toBe(7);
  });

  it('abgelaufen oder keine ganze Zahl: keine', () => {
    expect(ablaufStufe(-1)).toBeNull();
    expect(ablaufStufe(1.5)).toBeNull();
    expect(ablaufStufe(Number.NaN)).toBeNull();
  });
});

describe('wer erinnert wird', () => {
  const heute = '2026-10-07';

  it('ohne Nachfolgerin: mit Tagen und Stufe', () => {
    expect(eigeneAblaeufe([B()], heute)).toEqual([
      { id: 'a', nummer: 'FB-1', gueltigBis: '2026-11-30', tage: 54, stufe: 60 },
    ]);
  });

  it('eine Nachfolgerin ab dem Tag danach beendet den Hinweis', () => {
    const neu = B({ id: 'b', nummer: 'FB-2', gueltigVon: '2026-12-01', gueltigBis: '2029-11-30' });
    expect(eigeneAblaeufe([B(), neu], heute)).toEqual([]);
  });

  it('eine Lücke von einem Tag ist keine Nachfolge', () => {
    const neu = B({ id: 'b', nummer: 'FB-2', gueltigVon: '2026-12-02', gueltigBis: '2029-11-30' });
    expect(eigeneAblaeufe([B(), neu], heute).map((l) => l.id)).toEqual(['a']);
  });

  it('eine widerrufene Nachfolgerin zählt nicht — eine widerrufene Bescheinigung erinnert nicht', () => {
    const neu = B({ id: 'b', gueltigVon: '2026-11-01', gueltigBis: '2029-11-30',
      widerrufenAm: '2026-11-15' });
    expect(eigeneAblaeufe([B(), neu], heute).map((l) => l.id)).toEqual(['a']);
    expect(eigeneAblaeufe([B({ widerrufenAm: '2026-10-20' })], heute)).toEqual([]);
  });

  it('eine auftragsbezogene folgt nur einer für denselben Auftrag', () => {
    const alt = B({ umfang: 'auftragsbezogen', auftragId: 'A1' });
    const fremd = B({ id: 'b', umfang: 'auftragsbezogen', auftragId: 'A2',
      gueltigVon: '2026-11-01', gueltigBis: '2027-11-30' });
    const gleich = B({ id: 'c', umfang: 'auftragsbezogen', auftragId: 'A1',
      gueltigVon: '2026-11-01', gueltigBis: '2027-11-30' });
    expect(eigeneAblaeufe([alt, fremd], heute).map((l) => l.id)).toEqual(['a']);
    expect(eigeneAblaeufe([alt, gleich], heute).map((l) => l.id)).not.toContain('a');
  });

  it('weit vor dem Ablauf oder schon abgelaufen: nichts', () => {
    expect(eigeneAblaeufe([B({ gueltigBis: '2026-12-07' })], heute)).toEqual([]);
    expect(eigeneAblaeufe([B({ gueltigBis: '2026-10-06' })], heute)).toEqual([]);
  });
});

describe('die Art der Meldung', () => {
  beforeEach(() => { leereArten(); });

  it('steht im Register, nennt Nummer, Tag und die Folge, und führt auf die Pflege', () => {
    expect(registriereWaechterArten().map((a) => a.schluessel)).toContain(ART_FREISTELLUNG_LAEUFT_AB);
    const b = erzeuge(ART_FREISTELLUNG_LAEUFT_AB, {
      mandantId: 'm1', mandantSlug: 'bau', objektTyp: 'freistellungsbescheinigung', objektId: 'f1',
      daten: { nummer: 'FB-9', bis: '30.11.2026', tage: 54 },
    });
    expect(b.titel).toContain('FB-9');
    expect(b.text).toContain('30.11.2026');
    expect(b.text).toContain('15 %');
    expect(b.ziel).toBe('/portal/bau/finanzen/freistellungen');
    expect(KONTO_BENACHRICHTIGUNG_TEXTE.de.art['freistellung_laeuft_ab']).toBeTruthy();
  });
});

describe('die Verdrahtung', () => {
  it('der Steuerfall der Ausgangsrechnung liest die EIGENE, nicht die des Kunden', () => {
    const steuerfall = readFileSync('src/server/services/finanz/steuerfall.ts', 'utf8');
    expect(steuerfall).toContain('and kunde_id is null and lieferant_id is null');
  });

  it('der Beleg nennt die eigene, die befreit hat — nicht mehr fest `null`', () => {
    const rechnung = readFileSync('src/server/services/finanz/rechnung.ts', 'utf8');
    expect(rechnung).not.toContain('      freistellungsbescheinigung: null,\n');
    expect(rechnung).toContain('freistellungsbescheinigung: kopf.fsb_nummer === null ? null');
    expect(rechnung).toContain('and fsb.kunde_id is null and fsb.lieferant_id is null');
  });

  it('das Formular erfasst die eigene und die eines Lieferanten — die eines Kunden nicht', () => {
    const seite = readFileSync('src/app/portal/[mandant]/finanzen/freistellungen/page.tsx', 'utf8');
    expect(seite).toContain('name="traeger" value="eigene"');
    expect(seite).toContain('name="traeger" value="lieferant"');
    expect(seite).not.toContain('name="traeger" value="kunde"');
    for (const sprache of ['de', 'en'] as const) {
      const t = FREISTELLUNG_TEXTE[sprache];
      expect(t.ablaufHinweis('FB-1', '30.11.2026', 54)).toContain('FB-1');
      expect(t.eigeneFehlt).toContain('O-130');
      expect(t.voreinstellung).toContain('O-130');
    }
  });

  it('0531 lässt die eigene zu, und der Seed führt sie vor', () => {
    const migration = readFileSync('drizzle/0531_eigene_freistellung.sql', 'utf8');
    expect(migration).toContain('num_nonnulls(kunde_id, lieferant_id) <= 1');
    const seed = readFileSync('src/server/db/seed/crm.ts', 'utf8');
    expect(seed).toContain("'DEMO-48b-EIGEN'");
  });
});
