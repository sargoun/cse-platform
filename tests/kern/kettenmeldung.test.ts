/**
 * **Die Meldung „Hashkette gebrochen"** (V-286, O-357, D-811) — der Teil ohne
 * Datenbank: was die Art sagt, wohin sie führt und dass sie nie wartet.
 *
 * Empfänger, Zustellung und das Gedächtnis je Bruch prüft
 * `tests/isolation/kette-job.test.ts` an echtem Postgres.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ART_FREISTELLUNG_LAEUFT_AB, ART_KETTE_GEBROCHEN, registriereWaechterArten,
} from '../../src/server/services/waechter/benachrichtigung.js';
import { erzeuge, findeArt, leereArten } from '../../src/server/benachrichtigung/registry.js';
import { UEBERSICHT_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/uebersicht.js';
import { KONTO_BENACHRICHTIGUNG_TEXTE } from '../../src/lib/i18n/konto.js';

const daten = {
  nummer: 'RE-00002', kreis: 'Rechnungen', position: 2, grund: 'nutzlast_veraendert',
};

describe('V-286 — die Art der Kettenmeldung', () => {
  beforeEach(leereArten);

  it('steht neben den drei Wachen aus Dienstplan und Bau, als eigene Art', () => {
    const arten = registriereWaechterArten();
    expect(arten.map((a) => a.schluessel)).toContain(ART_KETTE_GEBROCHEN);
    // Fünf seit V-388: der Hinweis vor dem Ablauf der eigenen § 48b-Bescheinigung (D-846).
    expect(arten.map((a) => a.schluessel)).toContain(ART_FREISTELLUNG_LAEUFT_AB);
    expect(arten).toHaveLength(5);
    expect(findeArt(ART_KETTE_GEBROCHEN)).toBeDefined();
  });

  it('nennt Rechnung, Kreis, Position und den Grund im Satz der Hashketten-Ansicht', () => {
    registriereWaechterArten();
    const b = erzeuge(ART_KETTE_GEBROCHEN, {
      mandantId: 'm1', mandantSlug: 'reinigung', objektTyp: 'rechnung', objektId: 'r1', daten,
    });
    expect(b.titel).toContain('RE-00002');
    expect(b.text).toContain('Kreis Rechnungen, Position 2');
    expect(b.text).toContain(UEBERSICHT_TEXTE.de.bruchGrund.nutzlast_veraendert);
    expect(b.ziel).toBe('/portal/reinigung/finanzen/hashkette');
  });

  it('ist nie sammelbar — „alert immediately" (SPEC §14)', () => {
    registriereWaechterArten();
    expect(findeArt(ART_KETTE_GEBROCHEN)?.sammelbar).toBe(false);
  });

  it('ohne Gesellschaft kein Ziel, und ohne Ziel keine Meldung (NOT-03)', () => {
    registriereWaechterArten();
    expect(() => erzeuge(ART_KETTE_GEBROCHEN, {
      mandantId: 'm1', objektTyp: 'rechnung', objektId: 'r1', daten,
    })).toThrow();
  });

  it('ein unbekannter Grund steht als Kennung da, statt zu verschwinden', () => {
    registriereWaechterArten();
    const b = erzeuge(ART_KETTE_GEBROCHEN, {
      mandantId: 'm1', mandantSlug: 'reinigung', objektTyp: 'rechnung', objektId: 'r1',
      daten: { ...daten, grund: 'neuer_grund' },
    });
    expect(b.text).toContain('neuer_grund');
  });

  it('die Einstellungsseite kennt Art und Modul beim Namen', () => {
    const de = KONTO_BENACHRICHTIGUNG_TEXTE.de;
    expect(de.art['kette_gebrochen']).toBe('Rechnungs-Hashkette gebrochen');
    expect(de.modul['finanzen']).toBe('Finanzen');
  });
});
