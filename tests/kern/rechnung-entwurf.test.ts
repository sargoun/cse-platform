/**
 * **Der Rechnungsentwurf nach dem Anlegen** — was sich ohne Datenbank prüfen
 * lässt (V-204, V-205, V-206; D-697 … D-699).
 *
 *  - Der Leistungszeitpunkt einer Maske, dieselben zwei Zweige wie §14 Abs. 4
 *    Nr. 6 UStG und `rechnung_leistungszeitpunkt` (0075).
 *  - Die Vorabprüfung verweist für Zeitraum, Vereinnahmung und Zahlungsziel
 *    auf den KOPF des Entwurfs — und der Anker reist als `hash`, nicht als
 *    `%23` im Pfad.
 *  - Jede Abweisung, die diese Masken erreichen kann, hat einen Satz in
 *    beiden Sprachen. Die Liste der Gründe ist hier TYPGEPRÜFT: kommt ein
 *    Grund dazu, bricht `tsc`, bis er einen Satz hat.
 *  - Jedes Formular des Rechnungsblatts an `/api/rechnungen` trägt den
 *    Rückweg — ohne ihn bekäme der Browser JSON (D-599).
 *
 * Das Verhalten gegen Postgres prüft `tests/isolation/rechnung-entwurf.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  grundOhneLeistungszeitpunkt, MATERIAL_PREISREGEL,
} from '../../src/server/services/finanz/entwurf.js';
import {
  ENTWURF_RECHNUNGSARTEN, istEntwurfRechnungsart, istVorauszahlung, type RechnungFehler,
} from '../../src/server/services/finanz/rechnung.js';
import type { QuellenFehler } from '../../src/server/services/finanz/positionsquelle.js';
import type { AbrechnungGrund } from '../../src/server/services/finanz/abrechnungsart/index.js';
import { REGELN, type PruefEingabe } from '../../src/server/services/finanz/ustg14.js';
import { alsVerweis } from '../../src/lib/verweis.js';
import { RECHNUNG_ENTWURF_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/rechnung-entwurf.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

const WURZEL = join(import.meta.dirname, '..', '..');

describe('der Leistungszeitpunkt einer Maske (§14 Abs. 4 Nr. 6 UStG)', () => {
  const z = (rechnungsart: string, von: string | null, bis: string | null,
    vereinnahmung: string | null = null) => grundOhneLeistungszeitpunkt({
    rechnungsart, leistungVon: von, leistungBis: bis, vereinnahmungGeplantAm: vereinnahmung,
  });

  it('ein vollständiger Zeitraum trägt jede Art', () => {
    for (const art of ENTWURF_RECHNUNGSARTEN) {
      expect(z(art, '2026-08-01', '2026-08-31')).toBeNull();
    }
  });

  it('die Vereinnahmung trägt nur Abschlag und Anzahlung', () => {
    expect(z('abschlag', null, null, '2026-09-15')).toBeNull();
    expect(z('anzahlung', null, null, '2026-09-15')).toBeNull();
    expect(z('standard', null, null, '2026-09-15')).toBe('leistungszeitpunkt_fehlt');
    expect(z('schluss', null, null, '2026-09-15')).toBe('leistungszeitpunkt_fehlt');
  });

  it('ein halber Zeitraum ist keiner, ein verkehrter ist ein eigener Grund', () => {
    expect(z('standard', '2026-08-01', null)).toBe('leistungszeitpunkt_fehlt');
    expect(z('abschlag', null, '2026-08-31', '2026-09-15')).toBe('leistungszeitpunkt_fehlt');
    expect(z('standard', '2026-08-31', '2026-08-01')).toBe('zeitraum_verkehrt');
    expect(z('standard', null, null)).toBe('leistungszeitpunkt_fehlt');
  });
});

describe('die Rechnungsarten eines Entwurfs', () => {
  it('„storno" entsteht nur aus einem Storno, nie aus einer Maske', () => {
    expect(istEntwurfRechnungsart('storno')).toBe(false);
    expect(ENTWURF_RECHNUNGSARTEN).toEqual(['standard', 'abschlag', 'anzahlung', 'schluss']);
    expect(ENTWURF_RECHNUNGSARTEN.filter(istVorauszahlung)).toEqual(['abschlag', 'anzahlung']);
  });

  it('der Materialpreis bleibt offen, bis O-931 beantwortet ist', () => {
    expect(MATERIAL_PREISREGEL).toEqual({ art: 'offen', frage: 'O-931' });
  });
});

describe('die Vorabprüfung verweist auf den Kopf des Entwurfs (V-204)', () => {
  const eingabe = {
    rechnungId: 'r-1', mandantSlug: 'reinigung', kundeId: 'k-1',
  } as unknown as PruefEingabe;

  it.each(['leistungszeitpunkt', 'vereinnahmung', 'zahlungsziel'])(
    '%s → …/rechnungen/r-1#kopf', (feld) => {
      const regel = REGELN.find((r) => r.feld === feld);
      expect(regel?.link?.(eingabe)).toBe('/portal/reinigung/finanzen/rechnungen/r-1#kopf');
    });

  it('der Anker reist als hash, nicht im Pfad', () => {
    expect(alsVerweis('/portal/a/finanzen/rechnungen/r#kopf'))
      .toEqual({ pathname: '/portal/a/finanzen/rechnungen/r', hash: 'kopf' });
    expect(alsVerweis('/portal/a/crm/kunden/k')).toEqual({ pathname: '/portal/a/crm/kunden/k' });
    expect(alsVerweis('/portal/a#')).toEqual({ pathname: '/portal/a' });
  });
});

/*
 * Jeder Grund, den `POST /api/rechnungen` einer Maske zurückgeben kann.
 * `Record<…, true>` erzwingt die Vollständigkeit beim Typprüfen.
 */
const RECHNUNG_GRUENDE: Readonly<Record<RechnungFehler['grund'], true>> = {
  nicht_gefunden: true, kein_entwurf: true, nicht_festgeschrieben: true,
  ohne_positionen: true, kein_zahlungsziel: true, kein_kreis: true, schon_storniert: true,
  unbekannte_einheit: true, unbekannte_steuergruppe: true, mehrdeutige_steuergruppe: true,
  basismenge_ungueltig: true, kopf_nicht_uebernehmbar: true, leistungszeitpunkt_fehlt: true,
  quelle_passt_nicht: true, auftrag_passt_nicht: true, rechnungsart_unbekannt: true,
  zeitraum_verkehrt: true, zuordnung_gebunden: true,
};
const QUELLEN_GRUENDE: Readonly<Record<QuellenFehler['grund'], true>> = {
  ohne_quelle: true, quelle_fehlt: true, schon_abgerechnet: true, anteil_fehlt: true,
  nicht_uebernommen: true,
};
const ABRECHNUNG_GRUENDE: Readonly<Record<AbrechnungGrund, true>> = {
  keine_abrechnungsart: true, parameter_offen: true, unbekannte_abrechnungsart: true,
  kein_preis: true, keine_menge: true, aufmass_nicht_abrechenbar: true,
  unbekannte_einheit: true, mehrdeutige_steuergruppe: true, ausserhalb_lv: true,
  nichts_abzurechnen: true, auftrag_passt_nicht: true, befund_blockiert: true,
  schon_uebernommen: true,
};
const ROUTE_GRUENDE = [
  'ungueltig', 'unvollstaendig', 'kennung_ungueltig', 'fertigstellung_ungueltig',
  'rechnungsart_unbekannt',
];
/*
 * Gründe, die auf DIESEN Masken nicht erreichbar sind: sie gehören zur
 * Festschreibung und zum Storno, die eigene Adressen und Seiten haben.
 */
const ANDERSWO = new Set([
  'nicht_festgeschrieben', 'ohne_positionen', 'kein_zahlungsziel', 'kein_kreis',
  'schon_storniert', 'kopf_nicht_uebernehmbar', 'nicht_uebernommen',
]);

describe('jede Abweisung hat einen Satz — in beiden Sprachen', () => {
  const alle = [...new Set([
    ...Object.keys(RECHNUNG_GRUENDE), ...Object.keys(QUELLEN_GRUENDE),
    ...Object.keys(ABRECHNUNG_GRUENDE), ...ROUTE_GRUENDE,
  ])].filter((g) => !ANDERSWO.has(g));

  it.each(['de', 'en'] as const)('%s', (sprache) => {
    const t = RECHNUNG_ENTWURF_TEXTE[sprache];
    const ohne = alle.filter((g) => (eigenerEintrag(t.fehler, g) ?? '').trim() === '');
    expect(ohne).toEqual([]);
  });

  it('beide Sprachen führen dieselben Schlüssel', () => {
    const { de, en } = RECHNUNG_ENTWURF_TEXTE;
    expect(Object.keys(en.fehler).sort()).toEqual(Object.keys(de.fehler).sort());
    expect(Object.keys(en.hinweis).sort()).toEqual(Object.keys(de.hinweis).sort());
    expect(Object.keys(en.aufmassStatus).sort()).toEqual(Object.keys(de.aufmassStatus).sort());
  });

  it('jeder Zustand eines Aufmaßblatts hat eine Beschriftung (0072)', () => {
    const zustaende = ['entwurf', 'vorgelegt', 'gegengezeichnet', 'einseitig_festgestellt',
      'abgelehnt', 'storniert'];
    for (const s of zustaende) {
      expect(eigenerEintrag(RECHNUNG_ENTWURF_TEXTE.de.aufmassStatus, s)).toBeTruthy();
      expect(eigenerEintrag(RECHNUNG_ENTWURF_TEXTE.en.aufmassStatus, s)).toBeTruthy();
    }
  });
});

describe('jedes Formular an /api/rechnungen trägt seinen Rückweg (D-599)', () => {
  it.each([
    'src/app/portal/[mandant]/finanzen/rechnungen/[id]/page.tsx',
    'src/app/portal/[mandant]/finanzen/rechnungen/neu/page.tsx',
  ])('%s', (datei) => {
    const text = readFileSync(join(WURZEL, datei), 'utf8');
    const formulare = text.split('action={`/api/rechnungen?mandant=').length - 1;
    const rueckwege = text.split('name="zurueck"').length - 1;
    expect(formulare).toBeGreaterThan(0);
    expect(rueckwege).toBe(formulare);
  });
});
