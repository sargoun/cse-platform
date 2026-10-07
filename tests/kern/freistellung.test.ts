/**
 * Die Pflege der Freistellungsbescheinigungen nach § 48b EStG — Stand, Weg,
 * Recht und Wörter (FIN-10, V-283, O-604, D-845).
 *
 * Was die Datenbank hält — Erfassen, Widerruf, Beleg unter der RLS von
 * `freistellungsbescheinigung` und dem Auslöser aus 0530 —, steht in
 * `tests/isolation/freistellung.test.ts`. Hier:
 *
 *  1. Der Stand an einem Tag: künftig, gültig, abgelaufen, widerrufen — der
 *     Widerruf ab seinem Tag einschliesslich.
 *  2. Die Route steht im Manifest mit dem Recht, das die Policy verlangt,
 *     und kennt genau drei Handlungen; der Dienst steht im Register.
 *  3. Jeder Grund des Dienstes hat einen Satz in beiden Sprachen; jedes
 *     Ergebnis der Route auch.
 *  4. Die Seiten führen hin: die Finanzübersicht und die Steuerseite der
 *     Eingangsrechnung, die nicht mehr „der Schreibweg folgt" sagt.
 *  5. Die Voreinstellung steht am Dienst (`TODO(client, O-604)`), und 0530
 *     hält die Kernfelder fest.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { DIENSTE } from '../../src/server/registry/dienste.js';
import { FREISTELLUNG_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/freistellungen.js';
import { EINGANGSRECHNUNGEN_TEXTE }
  from '../../src/lib/i18n/verwaltung/finanzen/eingangsrechnungen.js';
import { UEBERSICHT_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/uebersicht.js';
import {
  FreistellungFehler, freistellungStand, type FreistellungGrund,
} from '../../src/server/services/finanz/freistellung.js';

const ROUTE = readFileSync('src/app/api/finanzen/freistellungen/route.ts', 'utf8');
const DIENST = readFileSync('src/server/services/finanz/freistellung.ts', 'utf8');
const SEITE = readFileSync('src/app/portal/[mandant]/finanzen/freistellungen/page.tsx', 'utf8');
const MIGRATION = readFileSync('drizzle/0530_freistellung_fest.sql', 'utf8');

describe('der Stand an einem Tag', () => {
  const b = { gueltigVon: '2026-03-01', gueltigBis: '2026-12-31', widerrufenAm: null };

  it('künftig vor dem ersten Tag, gültig bis einschliesslich dem letzten, dann abgelaufen', () => {
    expect(freistellungStand(b, '2026-02-28')).toBe('kuenftig');
    expect(freistellungStand(b, '2026-03-01')).toBe('gueltig');
    expect(freistellungStand(b, '2026-12-31')).toBe('gueltig');
    expect(freistellungStand(b, '2027-01-01')).toBe('abgelaufen');
  });

  it('widerrufen ab dem Tag des Widerrufs — davor galt sie (nie rückwirkend)', () => {
    const w = { ...b, widerrufenAm: '2026-10-07' };
    expect(freistellungStand(w, '2026-10-06')).toBe('gueltig');
    expect(freistellungStand(w, '2026-10-07')).toBe('widerrufen');
    expect(freistellungStand(w, '2027-06-01')).toBe('widerrufen');
  });
});

describe('Route und Register', () => {
  it('steht im Manifest mit finanzen.schreiben — dem Recht der WITH-CHECK-Hälfte (0118)', () => {
    expect(ROUTEN.find((r) => r.pfad === 'api/finanzen/freistellungen')?.recht)
      .toBe('finanzen.schreiben');
    expect(ROUTE).toContain("recht: 'finanzen.schreiben'");
    expect(DIENSTE.find((d) => d.pfad === 'finanz/freistellung')).toMatchObject({
      modul: 'finanzen', schreibend: true, schreibRecht: 'finanzen.schreiben',
    });
  });

  it('kennt genau drei Handlungen, und jedes Ergebnis hat einen Satz', () => {
    const handlungen = [...ROUTE.matchAll(/aktion === '([a-z]+)'/gu)].map((m) => m[1]).sort();
    expect(handlungen).toEqual(['anlegen', 'beleg', 'widerrufen']);
    const ergebnisse = [...ROUTE.matchAll(/return \{ aktion: '([a-z]+)' \}/gu)].map((m) => m[1]);
    for (const sprache of ['de', 'en'] as const) {
      expect(Object.keys(FREISTELLUNG_TEXTE[sprache].erfolg).sort())
        .toEqual([...ergebnisse].sort());
    }
  });

  it('jede Handlung der Seite geht an diese Route, mit Rückweg', () => {
    for (const aktion of ['anlegen', 'widerrufen', 'beleg']) {
      expect(SEITE).toContain(`name="aktion" value="${aktion}"`);
    }
    expect(SEITE.match(/action="\/api\/finanzen\/freistellungen"/gu)?.length).toBe(3);
    expect(SEITE.match(/name="zurueck" value=\{pfad\}/gu)?.length).toBe(3);
  });
});

describe('die Wörter', () => {
  const GRUENDE: readonly FreistellungGrund[] = [
    'traeger_fehlt', 'traeger_unbekannt', 'nummer_fehlt', 'nummer_vergeben',
    'finanzamt_fehlt', 'zeitraum_ungueltig', 'auftrag_fehlt', 'auftrag_unbekannt',
    'nicht_gefunden', 'schon_widerrufen', 'widerruf_rueckwirkend', 'widerruf_nach_ablauf',
    'beleg_unbekannt', 'beleg_vorhanden',
  ];

  it('jeder Grund des Dienstes hat einen Satz — deutsch und englisch', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(Object.keys(FREISTELLUNG_TEXTE[sprache].fehler).sort())
        .toEqual([...GRUENDE].sort());
      for (const g of GRUENDE) {
        expect(FREISTELLUNG_TEXTE[sprache].fehler[g], `${sprache}: ${g}`).toBeTruthy();
        expect(DIENST, `der Dienst wirft ${g}`).toContain(`'${g}'`);
      }
    }
  });

  it('ein Konflikt ist 409, ein Fehlen 404, eine Eingabe 422', () => {
    expect(new FreistellungFehler('nummer_vergeben', '').status).toBe(409);
    expect(new FreistellungFehler('schon_widerrufen', '').status).toBe(409);
    expect(new FreistellungFehler('beleg_vorhanden', '').status).toBe(409);
    expect(new FreistellungFehler('nicht_gefunden', '').status).toBe(404);
    expect(new FreistellungFehler('widerruf_rueckwirkend', '').status).toBe(422);
  });

  it('die Voreinstellung nennt O-604 — und der Dienst trägt sie als TODO', () => {
    for (const sprache of ['de', 'en'] as const) {
      expect(FREISTELLUNG_TEXTE[sprache].voreinstellung).toContain('O-604');
      expect(FREISTELLUNG_TEXTE[sprache].stand.widerrufen).toBeTruthy();
      expect(FREISTELLUNG_TEXTE[sprache].belege(2)).toContain('2');
    }
    expect(DIENST).toContain('// TODO(client, O-604): Voreinstellung');
  });
});

describe('die Seiten führen hin', () => {
  it('die Finanzübersicht hat eine Karte in beiden Sprachen', () => {
    expect(readFileSync('src/app/portal/[mandant]/finanzen/page.tsx', 'utf8'))
      .toContain("pfad: 'finanzen/freistellungen'");
    for (const sprache of ['de', 'en'] as const) {
      expect(UEBERSICHT_TEXTE[sprache].karten['finanzen/freistellungen'].titel)
        .toContain('Freistellungsbescheinigungen');
    }
  });

  it('die Steuerseite verweist auf die Pflege — mit finanzen.lesen — und vertröstet nicht mehr', () => {
    const steuer = readFileSync(
      'src/app/portal/[mandant]/finanzen/eingangsrechnungen/[id]/steuer/page.tsx', 'utf8');
    expect(steuer).toContain('/finanzen/freistellungen');
    expect(steuer).toContain('darf[RECHT_FINANZEN_LESEN] === true ? (');
    for (const sprache of ['de', 'en'] as const) {
      const t = EINGANGSRECHNUNGEN_TEXTE[sprache];
      expect(t.pflegeBetont).toContain('O-604');
      expect(`${t.pflegeBetont} ${t.pflegeOrt}`).not.toMatch(/folgt|follows/u);
    }
  });
});

describe('0530 hält die Bescheinigung fest', () => {
  it('Kernfelder, Widerruf einmal und nicht rückwirkend, Beleg einmal', () => {
    for (const spalte of ['kunde_id', 'lieferant_id', 'bescheinigung_nummer', 'finanzamt',
      'gueltig_von', 'gueltig_bis', 'umfang', 'auftrag_id']) {
      expect(MIGRATION).toContain(`new.${spalte} is distinct from old.${spalte}`);
    }
    expect(MIGRATION).toContain('new.widerrufen_am < app.berlin_heute()');
    expect(MIGRATION).toContain('before update on freistellungsbescheinigung');
  });
});
