/**
 * Einen Nummernkreis freigeben und den Nachfolger zum Jahreswechsel eröffnen
 * (V-284, O-134, O-352, D-779, D-848) — was ohne Datenbank entschieden wird.
 *
 * Was die Datenbank hält — Rechte, Policies, die Festschreibung vor und nach
 * der Freigabe, die Grammatik der Maske am Dienst vorbei, die Kette über die
 * Jahresgrenze —, steht in `tests/isolation/nummernkreis-freigabe.test.ts`
 * und `tests/isolation/nummernkreis-wechsel.test.ts`. Hier:
 *
 *  1. Die Lage im Jahreswechsel und die erste Nummer des neuen Jahres.
 *  2. Die Grammatik der Maske — und dass sie dieselbe ist wie in 0532 und
 *     nichts durchlässt, woran `formatiereNummer` scheitert.
 *  3. Das Jahr der Freigabe, die Vorschau, der Vorbehalt im Namen.
 *  4. Die Wörter in beiden Sprachen und die Verdrahtung.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { DIENSTE } from '../../src/server/registry/dienste.js';
import { formatiereNummer } from '../../src/server/services/finanz/nummernkreis.js';
import {
  ersteNummer, wechselLage, type WechselGrund,
} from '../../src/server/services/finanz/nummernkreis-wechsel.js';
import {
  behauptetVorbehalt, ersteFreigegebeneNummer, freigabeJahr, maskenMangel,
  vorgeschlageneBezeichnung, type FreigabeGrund, type MaskenMangel,
} from '../../src/server/services/finanz/nummernkreis-freigabe.js';
import { WECHSEL_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/nummernkreis-wechsel.js';
import { FREIGABE_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/nummernkreis-freigabe.js';
import { UEBERSICHT_TEXTE } from '../../src/lib/i18n/verwaltung/finanzen/uebersicht.js';

const MIGRATION = readFileSync('drizzle/0532_nummernkreis_freigabe_jahreswechsel.sql', 'utf8');
const ROUTE = readFileSync('src/app/api/finanzen/nummernkreise/route.ts', 'utf8');
const SEITE = readFileSync('src/app/portal/[mandant]/finanzen/nummernkreise/page.tsx', 'utf8');
const VOREINSTELLUNG = 'Ausgangsrechnungen (Voreinstellung RE-{jahr}-{nr:5} — zur Freigabe, O-134)';

describe('(1) der Jahreswechsel', () => {
  const kreis = (mehr: Partial<Parameters<typeof wechselLage>[0]>): Parameters<typeof wechselLage>[0] => ({
    zuruecksetzung: 'jaehrlich', jahr: 2026, geschlossen: false, platzhalter: false, ...mehr,
  });

  it('fällig erst, wenn das Jahr eines offenen, freigegebenen, jährlichen Kreises vergangen ist', () => {
    expect(wechselLage(kreis({}), 2026)).toBe('laeuft');
    expect(wechselLage(kreis({}), 2027)).toBe('faellig');
    expect(wechselLage(kreis({ jahr: 2024 }), 2027)).toBe('faellig');
    expect(wechselLage(kreis({ zuruecksetzung: 'nie', jahr: 0 }), 2027)).toBe('fortlaufend');
    expect(wechselLage(kreis({ zuruecksetzung: null }), 2027)).toBe('fortlaufend');
    expect(wechselLage(kreis({ geschlossen: true }), 2027)).toBe('geschlossen');
  });

  it('ein Platzhalter wird freigegeben, nicht fortgesetzt — auch wenn sein Jahr vergangen ist', () => {
    expect(wechselLage(kreis({ platzhalter: true }), 2027)).toBe('platzhalter');
    expect(wechselLage(kreis({ platzhalter: true, geschlossen: true }), 2027)).toBe('geschlossen');
  });

  it('die erste Nummer des neuen Jahres steht auf der Maske', () => {
    expect(ersteNummer('RE-{jahr}-{nr:5}', 2027)).toBe('RE-2027-00001');
    expect(ersteNummer('{jahr}/{nr:4}', 2027)).toBe('2027/0001');
  });
});

describe('(2) die Grammatik der Maske', () => {
  const GUELTIG: readonly (readonly [string, 'jaehrlich' | 'nie'])[] = [
    ['RE-{jahr}-{nr:5}', 'jaehrlich'], ['{jahr}/{nr:4}', 'jaehrlich'], ['R.E_{jahr}-{nr}', 'jaehrlich'],
    ['RE-{nr:6}', 'nie'], ['AR/{nr:9}', 'nie'], ['{nr}', 'nie'],
  ];
  const MANGEL: readonly (readonly [string, 'jaehrlich' | 'nie', MaskenMangel])[] = [
    ['', 'nie', 'leer'],
    [`RE-${'X'.repeat(40)}-{nr}`, 'nie', 'zu_lang'],
    ['RE-{jahr}', 'jaehrlich', 'nr_fehlt'],
    ['RE-{jahr}-{nr:10}', 'jaehrlich', 'nr_breite'],
    ['RE-{jahr}-{nr:0}', 'jaehrlich', 'nr_breite'],
    ['RE-{jahr}-{nr}-{nr:2}', 'jaehrlich', 'nr_mehrfach'],
    ['RE-{nr:5}', 'jaehrlich', 'jahr_fehlt'],
    ['RE-{jahr}-{nr:5}', 'nie', 'jahr_ohne_ruecksetzung'],
    ['RE {jahr}-{nr:5}', 'jaehrlich', 'zeichen'],
    ['RE-{monat}-{jahr}-{nr:3}', 'jaehrlich', 'zeichen'],
    ['RE-{jahr}-{nr:5}{', 'jaehrlich', 'zeichen'],
    ['RÉ-{jahr}-{nr:5}', 'jaehrlich', 'zeichen'],
  ];

  it('was taugt, hat keinen Mangel — und formatiereNummer scheitert an keiner', () => {
    for (const [maske, r] of GUELTIG) {
      expect(maskenMangel(maske, r), maske).toBeNull();
      expect(() => formatiereNummer(maske, 1, r === 'jaehrlich' ? 2026 : 0), maske).not.toThrow();
    }
  });

  it('was nicht taugt, nennt seinen Mangel', () => {
    for (const [maske, r, mangel] of MANGEL) expect(maskenMangel(maske, r), maske).toBe(mangel);
  });

  it('dieselbe Grammatik steht in der Datenbankfunktion (0532)', () => {
    expect(MIGRATION).toContain(String.raw`regexp_matches(v_maske, '\{nr(:[1-9])?\}', 'g')) <> 1`);
    expect(MIGRATION).toContain(String.raw`'\{nr(:[1-9])?\}|\{jahr\}', '', 'g') !~ '^[A-Za-z0-9/_.-]*$'`);
    expect(MIGRATION).toContain(`(p_zuruecksetzung = 'jaehrlich') <> (strpos(v_maske, '{jahr}') > 0)`);
    expect(MIGRATION).toContain('length(v_maske) not between 1 and 40');
  });
});

describe('(3) das Jahr, die Vorschau, der Name', () => {
  it('jährlich ab dem laufenden Jahr (ein vorgemerktes späteres bleibt), fortlaufend 0', () => {
    expect(freigabeJahr(2026, 'jaehrlich', 2026)).toBe(2026);
    expect(freigabeJahr(2025, 'jaehrlich', 2026)).toBe(2026);
    expect(freigabeJahr(2027, 'jaehrlich', 2026)).toBe(2027);
    expect(freigabeJahr(0, 'jaehrlich', 2026)).toBe(2026);
    expect(freigabeJahr(2026, 'nie', 2026)).toBe(0);
  });

  it('die erste Nummer nach der Freigabe — oder keine, wenn die Maske nicht taugt', () => {
    expect(ersteFreigegebeneNummer('RE-{jahr}-{nr:5}', 'jaehrlich', 2025, 2026)).toBe('RE-2026-00001');
    expect(ersteFreigegebeneNummer('AR/{nr:6}', 'nie', 2026, 2026)).toBe('AR/000001');
    expect(ersteFreigegebeneNummer('RE-{nr:5}', 'jaehrlich', 2026, 2026)).toBeNull();
  });

  it('der Vorbehalt im Namen — und der Vorschlag ohne ihn', () => {
    expect(behauptetVorbehalt(VOREINSTELLUNG)).toBe(true);
    expect(behauptetVorbehalt('Ausgangsrechnungen (Demo — Voreinstellung, O-134)')).toBe(true);
    expect(behauptetVorbehalt('Platzhalter Rechnungen')).toBe(true);
    expect(behauptetVorbehalt('Rechnungen (Maske unbestaetigt)')).toBe(true);
    expect(behauptetVorbehalt('Ausgangsrechnungen')).toBe(false);
    expect(behauptetVorbehalt('Demontage und Rückbau')).toBe(false);
    expect(vorgeschlageneBezeichnung(VOREINSTELLUNG)).toBe('Ausgangsrechnungen');
    expect(vorgeschlageneBezeichnung('Eingangsbelege')).toBe('Eingangsbelege');
    expect(vorgeschlageneBezeichnung('(nur Klammer)')).toBe('(nur Klammer)');
    expect(behauptetVorbehalt(vorgeschlageneBezeichnung(VOREINSTELLUNG))).toBe(false);
  });
});

describe('(4) Wörter und Verdrahtung', () => {
  const FREIGABE_GRUENDE: readonly FreigabeGrund[] = [
    'nicht_gefunden', 'geschlossen', 'schon_freigegeben', 'maske_unbestaetigt', 'maske_ungueltig',
    'ruecksetzung_ungueltig', 'bezeichnung_fehlt', 'bezeichnung_vorbehalt', 'schon_vorhanden',
    'kein_recht',
  ];
  const WECHSEL_GRUENDE: readonly WechselGrund[] = [
    'nicht_gefunden', 'geschlossen', 'platzhalter', 'fortlaufend', 'laeuft_noch',
    'maske_unbestaetigt', 'schon_vorhanden', 'kein_recht',
  ];

  it('jeder Grund und jeder Mangel hat einen Satz — in beiden Sprachen', () => {
    for (const sprache of ['de', 'en'] as const) {
      const f = FREIGABE_TEXTE[sprache];
      for (const g of FREIGABE_GRUENDE) expect(f.fehler[g].length, `${sprache} ${g}`).toBeGreaterThan(10);
      for (const m of Object.values(f.mangel)) expect(m.length).toBeGreaterThan(10);
      expect(f.voreinstellung).toContain('O-134');
      const w = WECHSEL_TEXTE[sprache];
      for (const g of WECHSEL_GRUENDE) expect(w.fehler[g].length, `${sprache} ${g}`).toBeGreaterThan(10);
      // Die Übersicht verspricht keinen Knopf mehr, der „folgt".
      expect(UEBERSICHT_TEXTE[sprache].jahreswechselTitel).not.toMatch(/nicht auslösbar|not triggerable/u);
      expect(UEBERSICHT_TEXTE[sprache].wechselNach).toContain('V-284');
    }
  });

  it('die Voreinstellungen stehen am Ort ihrer Verwendung', () => {
    expect(readFileSync('src/server/services/finanz/nummernkreis-freigabe.ts', 'utf8'))
      .toContain('// TODO(client, O-134): Voreinstellung');
    expect(readFileSync('src/server/services/finanz/nummernkreis-wechsel.ts', 'utf8'))
      .toContain('// TODO(client, O-352): Voreinstellung');
  });

  it('ein Recht für beide Handlungen — Route, Dienste, Datenbank', () => {
    expect(ROUTEN.find((r) => r.pfad === 'api/finanzen/nummernkreise')?.recht)
      .toBe('nummernkreis.verwalten');
    for (const pfad of ['finanz/nummernkreis-freigabe', 'finanz/nummernkreis-wechsel']) {
      expect(DIENSTE.find((d) => d.pfad === pfad), pfad).toMatchObject({
        schreibend: true, schreibRecht: 'nummernkreis.verwalten',
      });
    }
    for (const fn of ['fin.nummernkreis_freigeben(uuid, text, text, text, boolean)',
      'fin.nummernkreis_nachfolger_eroeffnen(uuid, boolean)']) {
      expect(MIGRATION).toContain(`alter function ${fn} owner to cse_definer;`);
      expect(MIGRATION).toContain(`revoke all on function ${fn} from public;`);
      expect(MIGRATION).toContain(`grant execute on function ${fn} to cse_app;`);
    }
    expect(MIGRATION.match(/app\.hat_recht\('nummernkreis\.verwalten', app\.aktiver_mandant\(\)\)/gu))
      .toHaveLength(2);
    // cse_app bekommt keine Spalte dazu — der Weg sind die zwei Funktionen.
    expect(MIGRATION).not.toMatch(/grant update[^;]*to cse_app/u);
  });

  it('Formular und Route nennen dieselben Felder', () => {
    for (const feld of ['aktion', 'kreis', 'maske', 'ruecksetzung', 'bezeichnung', 'bestaetigt',
      'vorgaenger', 'maske_bestaetigt']) {
      expect(SEITE, feld).toContain(`name="${feld}"`);
      expect(ROUTE, feld).toContain(`'${feld}'`);
    }
    expect(SEITE).toContain('value="freigeben"');
    expect(SEITE).toContain('value="nachfolger"');
    expect(SEITE).toContain('action="/api/finanzen/nummernkreise"');
    // Zähler und Hash kommen nie aus dem Formular.
    expect(SEITE).not.toMatch(/name="(naechste_nummer|genesis_hash|letzter_hash|jahr)"/u);
    // Der Widerspruch an der Zeile und die Abweisung der Freigabe: dieselbe Regel.
    expect(SEITE).toContain('!k.istPlatzhalter && behauptetVorbehalt(k.bezeichnung)');
  });
});
