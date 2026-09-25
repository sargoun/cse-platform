import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BEDARF_HOECHSTENS, leadAusBekanntmachung, type Bekanntmachung,
} from '../../src/server/services/crm/lead-radar.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import { istKennung, LEAD_BINDUNG_SATZ } from '../../src/server/services/crm/lead-kette.js';
import {
  ANGEBOT_PILLE, AUFTRAG_PILLE, LEAD_PILLE, RECHNUNG_PILLE,
} from '../../src/lib/vorgang-pille.js';
import { KETTE_TEXTE } from '../../src/lib/i18n/verwaltung/crm-kette.js';
import { ANGEBOT_HAND_TEXTE } from '../../src/lib/i18n/verwaltung/angebot-hand.js';
import { AUFTRAG_TEXTE } from '../../src/lib/i18n/verwaltung/auftrag.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { LEAD_TEXTE } from '../../src/lib/i18n/verwaltung/crm-lead.js';
import {
  betreffAus, LEAD_ZWECK_REGEL, PLATZHALTER_LEAD_ZWECK,
} from '../../src/server/services/crm/lead-kontakt.js';
import {
  MASKE_WERT_HOECHSTENS, maskeMitEingaben, vorbelegt,
} from '../../src/lib/formular/maske.js';
import { rechtName } from '../../src/lib/i18n/rechtname.js';

/**
 * Die Kette Lead → Angebot → Auftrag, ohne Datenbank (V-138, V-139,
 * CRM-05, CRM-07, D-632, D-633).
 *
 * Was hier steht, sind die Regeln, die keine Datenbank brauchen: welche
 * Felder ein Radartreffer an seinen Lead gibt, und dass jede Stufe der Kette
 * für jeden Zustand ein Wort hat — auf Deutsch UND auf Englisch. Ein
 * Zustand ohne Wort landete sonst als roher Schlüssel auf dem Bildschirm.
 * Die Datenbankseite der Kette prüft `tests/isolation/crm-kette.test.ts`.
 */

const BASIS: Bekanntmachung = {
  titel: '  Rückbau und Innenausbau eines Verwaltungsgebäudes ',
  beschreibung: 'Entkernung, Trockenbau, Estrich.',
  vergabestelleName: 'Berliner Immobilienmanagement GmbH',
  vergabestelleOrt: 'Berlin',
  quellId: 'demo-2026-0003',
  wertCent: 1_940_000_00n,
  waehrung: 'EUR',
};

describe('leadAusBekanntmachung — was eine Bekanntmachung an ihren Lead gibt', () => {
  it('Titel, Vergabestelle, Beschreibung mit Quelle, Wert in Euro', () => {
    const l = leadAusBekanntmachung(BASIS);
    expect(l.betreff).toBe('Rückbau und Innenausbau eines Verwaltungsgebäudes');
    expect(l.firmaName).toBe('Berliner Immobilienmanagement GmbH');
    expect(l.bedarf).toBe('Entkernung, Trockenbau, Estrich.\n\nBekanntmachung demo-2026-0003, Berlin.');
    expect(l.geschaetzterWertCent).toBe(1_940_000_00n);
  });

  it('der Mensch darf den Auftraggeber nennen — er gewinnt über die Bekanntmachung', () => {
    expect(leadAusBekanntmachung(BASIS, '  BIM Berlin ').firmaName).toBe('BIM Berlin');
    expect(leadAusBekanntmachung(BASIS, '   ').firmaName)
      .toBe('Berliner Immobilienmanagement GmbH');
  });

  it('ohne Vergabestelle und ohne Eingabe gibt es keinen Lead — keinen erfundenen Namen', () => {
    expect(() => leadAusBekanntmachung({ ...BASIS, vergabestelleName: null }))
      .toThrow(CrmFehler);
    /*
     * Ohne `expect.assertions` prüfte das frühere try/catch NICHTS, wenn keine
     * Ausnahme flog (V-144). Jetzt muss sie fliegen, und mit diesem Grund.
     */
    let fehler: unknown = null;
    try {
      leadAusBekanntmachung({ ...BASIS, vergabestelleName: ' ' });
    } catch (e) {
      fehler = e;
    }
    expect(fehler).toBeInstanceOf(CrmFehler);
    expect((fehler as CrmFehler).grund).toBe('ohne_auftraggeber');
  });

  it('ein Wert in Fremdwährung wandert NICHT — umgerechnet wird nie (O-47)', () => {
    expect(leadAusBekanntmachung({ ...BASIS, waehrung: 'CHF' }).geschaetzterWertCent).toBeNull();
  });

  it('ein Wert ohne Währung ist kein Euro-Betrag', () => {
    expect(leadAusBekanntmachung({ ...BASIS, waehrung: null }).geschaetzterWertCent).toBeNull();
  });

  it('ohne Wert bleibt der Wert leer — nicht null Euro', () => {
    expect(leadAusBekanntmachung({ ...BASIS, wertCent: null }).geschaetzterWertCent).toBeNull();
  });

  it('eine lange Beschreibung wird gekürzt und sagt es, die Quelle bleibt', () => {
    const l = leadAusBekanntmachung({ ...BASIS, beschreibung: 'x'.repeat(BEDARF_HOECHSTENS + 50) });
    expect(l.bedarf.startsWith('x'.repeat(BEDARF_HOECHSTENS))).toBe(true);
    expect(l.bedarf).toContain('…');
    expect(l.bedarf.endsWith('Bekanntmachung demo-2026-0003, Berlin.')).toBe(true);
  });

  it('ohne Titel kein Lead', () => {
    expect(() => leadAusBekanntmachung({ ...BASIS, titel: '  ' })).toThrow(CrmFehler);
  });
});

describe('istKennung — nur eine Kennung geht an die Datenbank', () => {
  it('nimmt eine UUID, weist alles andere ab', () => {
    expect(istKennung('0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b')).toBe(true);
    expect(istKennung('0b6f3c1e')).toBe(false);
    expect(istKennung("'; drop table lead; --")).toBe(false);
    expect(istKennung(undefined)).toBe(false);
    expect(istKennung(null)).toBe(false);
  });
});

/** Die Werte eines Enum-Typs, wie die Migrationen sie anlegen und erweitern. */
function enumWerte(typ: string): readonly string[] {
  const verzeichnis = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const werte: string[] = [];
  for (const datei of readdirSync(verzeichnis).filter((d) => d.endsWith('.sql')).sort()) {
    const text = readFileSync(join(verzeichnis, datei), 'utf8');
    const anlage = new RegExp(`create type ${typ}\\s+as enum\\s*\\(([^)]*)\\)`, 'u').exec(text);
    if (anlage !== null) {
      for (const m of (anlage[1] ?? '').matchAll(/'([^']+)'/gu)) werte.push(m[1] ?? '');
    }
    for (const m of text.matchAll(new RegExp(`alter type ${typ} add value (?:if not exists )?'([^']+)'`, 'gu'))) {
      werte.push(m[1] ?? '');
    }
  }
  return werte;
}

describe('jede Stufe der Kette hat für jeden Zustand ein Wort', () => {
  it('die Enum-Werte werden überhaupt gefunden', () => {
    expect(enumWerte('lead_quelle')).toEqual(
      ['webformular', 'vergabe_radar', 'manuell', 'empfehlung', 'akquise']);
    expect(enumWerte('lead_status').length).toBe(6);
    expect(enumWerte('angebot_status').length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['lead_status', LEAD_PILLE],
    ['angebot_status', ANGEBOT_PILLE],
    ['auftrag_status', AUFTRAG_PILLE],
    ['rechnung_status', RECHNUNG_PILLE],
  ] as const)('%s → Pille', (typ, pille) => {
    expect(enumWerte(typ).filter((w) => pille[w] === undefined)).toEqual([]);
  });

  it.each(['de', 'en'] as const)('jede Leadquelle hat eine Beschriftung (%s)', (sprache) => {
    const t = KETTE_TEXTE[sprache];
    expect(enumWerte('lead_quelle').filter((w) => t.quelleWerte[w] === undefined)).toEqual([]);
    expect(enumWerte('dokument_kategorie').filter((w) => t.kategorieWerte[w] === undefined))
      .toEqual([]);
    expect(enumWerte('aktivitaet_typ').filter((w) => t.typWerte[w] === undefined)).toEqual([]);
    expect(enumWerte('aktivitaet_richtung').filter((w) => t.richtungWerte[w] === undefined))
      .toEqual([]);
    expect(enumWerte('kunde_typ').filter((w) => t.artWerte[w] === undefined)).toEqual([]);
  });

  it('beide Sprachen kennen dieselben Fehlerschlüssel — keiner fällt auf einen rohen Schlüssel', () => {
    expect(Object.keys(KETTE_TEXTE.en.fehler).sort())
      .toEqual(Object.keys(KETTE_TEXTE.de.fehler).sort());
    expect(Object.keys(KETTE_TEXTE.en.maskeFehler).sort())
      .toEqual(Object.keys(KETTE_TEXTE.de.maskeFehler).sort());
  });

  it('jede Abweisung von /api/auftrag hat einen Satz in der Maske', () => {
    /*
     * Die Route schickt diese Schlüssel an `/auftraege/neu` zurück (D-599);
     * die Nummernkreisgründe stehen in `NummernkreisFehler`, die Gründe der
     * Zahlen und des Bezugs in `pruefeAuftragsangaben`/`pruefeAuftragsbezug`
     * (V-172, V-173), die der Anfrage in `pruefeLeadBindung` (V-138).
     *
     * Die Maske schlägt in DIESER Reihenfolge nach: die Sätze des Auftrags,
     * dann die der Maske der Kette, dann die der Kette — genau diese Kette
     * prüft der Test, in beiden Sprachen.
     */
    const route = readFileSync(fileURLToPath(
      new URL('../../src/app/api/auftrag/route.ts', import.meta.url)), 'utf8');
    const schluessel = [
      ...route.matchAll(/zurMaske\('([a-z_]+)'\)/gu),
      ...route.matchAll(/grund: '([a-z_]+)'/gu),
    ].map((m) => m[1] ?? '');
    expect(schluessel.length).toBeGreaterThanOrEqual(2);
    const nummernkreis = ['kein_kreis', 'platzhalter', 'geschlossen', 'definer_kreis',
      'maske_ungueltig'];
    const angaben = ['keine_zahl', 'ausserhalb_bereich', 'wert_ungueltig'];
    const bezug = ['unvollstaendig', 'datum_ungueltig', 'laufzeit_vor_start',
      'kunde_unbekannt', 'objekt_unbekannt', 'verantwortlich_fremd'];
    const lead = Object.keys(LEAD_BINDUNG_SATZ);
    for (const sprache of ['de', 'en'] as const) {
      const satz = (grund: string): string | undefined =>
        eigenerEintrag(AUFTRAG_TEXTE[sprache].fehler, grund)
        ?? eigenerEintrag(KETTE_TEXTE[sprache].maskeFehler, grund)
        ?? eigenerEintrag(KETTE_TEXTE[sprache].fehler, grund);
      for (const s of [...schluessel, ...nummernkreis, ...angaben, ...bezug, ...lead]) {
        expect(satz(s), `${sprache}: ${s}`).toBeDefined();
      }
    }
  });

  it('jeder Grund der Lead-Bindung hat einen Satz — im Dienst, auf dem Blatt und in der Maske', () => {
    for (const grund of Object.keys(LEAD_BINDUNG_SATZ)) {
      expect(KETTE_TEXTE.de.fehler[grund], grund).toBeDefined();
      expect(KETTE_TEXTE.en.fehler[grund], grund).toBeDefined();
      expect(ANGEBOT_HAND_TEXTE.de.fehler[grund], grund).toBeDefined();
      expect(ANGEBOT_HAND_TEXTE.en.fehler[grund], grund).toBeDefined();
    }
  });
});

/**
 * **Mit welchem Zweck ein ausgehender Kontakt durch das UWG-Tor geht**
 * (V-141, D-635, O-907). Bis V-141 schrieb die Route JEDE ausgehende
 * Aktivität als `vertraglich`. Solange nur Web-Leads einen Kontakt hatten,
 * stimmte das; seit jeder Lead einen bekommen kann, wäre es ein Weg am
 * Werbetor vorbei — ein recherchiertes Akquiseziel liesse sich als
 * „Antwort" anrufen.
 */
describe('der Zweck eines ausgehenden Kontakts folgt der Herkunft (O-907)', () => {
  it('Webformular antwortet vertraglich, Akquise ist Werbung — beides entschieden', () => {
    expect(PLATZHALTER_LEAD_ZWECK.zweckAusgehend('webformular'))
      .toEqual({ zweck: 'vertraglich', offen: false });
    expect(PLATZHALTER_LEAD_ZWECK.zweckAusgehend('akquise'))
      .toEqual({ zweck: 'werbung', offen: false });
  });

  it.each(['manuell', 'empfehlung', 'vergabe_radar'])(
    '%s geht bis zur Antwort den restriktiven Weg — und sagt, dass es offen ist', (quelle) => {
      expect(PLATZHALTER_LEAD_ZWECK.zweckAusgehend(quelle))
        .toEqual({ zweck: 'werbung', offen: true });
    });

  it('keine Herkunft ausser dem Webformular ist lockerer als Werbung — auch eine unbekannte', () => {
    for (const quelle of [...enumWerte('lead_quelle'), 'erfunden', '']) {
      const { zweck } = PLATZHALTER_LEAD_ZWECK.zweckAusgehend(quelle);
      expect(zweck, quelle).toBe(quelle === 'webformular' ? 'vertraglich' : 'werbung');
    }
  });

  it('die Regel, die gilt, ist bis O-907 der Platzhalter', () => {
    expect(LEAD_ZWECK_REGEL).toBe(PLATZHALTER_LEAD_ZWECK);
  });
});

describe('betreffAus — der Betreff, den das Formular nicht fragt', () => {
  it('nimmt den gegebenen, sonst die erste Zeile, gekürzt auf 80 Zeichen', () => {
    expect(betreffAus('egal', '  Rückruf  ')).toBe('Rückruf');
    expect(betreffAus('Erste Zeile\nzweite Zeile')).toBe('Erste Zeile');
    expect(betreffAus('x'.repeat(90))).toBe(`${'x'.repeat(79)}…`);
    expect(betreffAus('y'.repeat(80))).toBe('y'.repeat(80));
  });
});

describe('jede Abweisung am Ansprechpartner hat einen Satz — in beiden Sprachen', () => {
  /** Die Gründe, die `lead-kontakt.ts` wirft — aus dem Quelltext, nicht abgetippt. */
  function gruende(): readonly string[] {
    const text = readFileSync(fileURLToPath(
      new URL('../../src/server/services/crm/lead-kontakt.ts', import.meta.url)), 'utf8');
    const gefunden = new Set<string>();
    for (const teil of text.split('new CrmFehler(').slice(1)) {
      const aufruf = teil.slice(0, teil.indexOf(');'));
      // Ein Vergleich (`zweck === 'werbung' ? …`) nennt keinen Grund, er wählt einen.
      for (const m of aufruf.matchAll(/(?<!=== )'([a-z_]+)'/gu)) gefunden.add(m[1] ?? '');
    }
    return [...gefunden].sort();
  }

  it('die Gründe werden überhaupt gefunden', () => {
    expect(gruende()).toEqual(expect.arrayContaining([
      'kein_kontakt', 'kontakt_fremd', 'nachname_fehlt', 'uwg', 'uwg_werbung']));
  });

  it.each(['de', 'en'] as const)('%s: jeder Grund steht am Kontakt, im Leadblatt oder in der Kette', (s) => {
    const texte = LEAD_TEXTE[s];
    const kette = KETTE_TEXTE[s];
    const ohneSatz = gruende().filter((g) => texte.kontaktFehler[g] === undefined
      && texte.fehler[g] === undefined && kette.fehler[g] === undefined);
    expect(ohneSatz).toEqual([]);
  });

  it('beide Sprachen kennen dieselben Schlüssel am Kontakt', () => {
    expect(Object.keys(LEAD_TEXTE.en.kontaktFehler).sort())
      .toEqual(Object.keys(LEAD_TEXTE.de.kontaktFehler).sort());
    expect(Object.keys(LEAD_TEXTE.en.fehler).sort())
      .toEqual(Object.keys(LEAD_TEXTE.de.fehler).sort());
  });
});

/**
 * **Eine abgewiesene Maske kommt mit ihren Eingaben zurück** (V-143, D-637).
 * `/api/auftrag` schickte nur `?lead=` und den Grund zurück; wer sich bei
 * den Wochenstunden vertippte, fing mit zehn leeren Feldern von vorn an.
 */
describe('maskeMitEingaben / vorbelegt — die Eingaben reisen in der Adresse', () => {
  it('trägt die Werte, lässt leere weg und setzt den Grund zuletzt', () => {
    const ziel = maskeMitEingaben('/portal/reinigung/auftraege/neu', 'keine_zahl', {
      lead: 'abc', bezeichnung: ' Glasreinigung ', wochenstundenSoll: 'zwölf', laufzeitBis: '',
      objektId: null, beschreibung: undefined,
    });
    const url = new URL(ziel, 'https://cse.test');
    expect(url.pathname).toBe('/portal/reinigung/auftraege/neu');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lead: 'abc', bezeichnung: 'Glasreinigung', wochenstundenSoll: 'zwölf', fehler: 'keine_zahl',
    });
  });

  it('eine Eingabe namens fehler überschreibt den Grund nicht', () => {
    const url = new URL(maskeMitEingaben('/m', 'unvollstaendig', { fehler: 'erfunden' }),
      'https://cse.test');
    expect(url.searchParams.getAll('fehler')).toEqual(['unvollstaendig']);
  });

  it('kürzt jeden Wert — eine Adresse mit zehn Seiten weist mancher Proxy ab', () => {
    const url = new URL(maskeMitEingaben('/m', 'x', { beschreibung: 'y'.repeat(5000) }),
      'https://cse.test');
    expect(url.searchParams.get('beschreibung')).toHaveLength(MASKE_WERT_HOECHSTENS);
    expect(vorbelegt({ a: 'z'.repeat(5000) }, 'a')).toHaveLength(MASKE_WERT_HOECHSTENS);
  });

  it('vorbelegt nimmt nur einen einzelnen Text', () => {
    expect(vorbelegt({ a: 'eins' }, 'a')).toBe('eins');
    expect(vorbelegt({ a: ['eins', 'zwei'] }, 'a')).toBeUndefined();
    expect(vorbelegt({}, 'a')).toBeUndefined();
  });
});

describe('die Formularwege der Kette antworten mit Seite und Satz (D-599, D-637)', () => {
  const quelle = (pfad: string): string => readFileSync(fileURLToPath(
    new URL(`../../src/app/api/${pfad}`, import.meta.url)), 'utf8');

  it('/api/angebot schickt das Raumbuch mit Grund zurück — und die Seite kennt jeden Grund', () => {
    const route = quelle('angebot/route.ts');
    // Beide Abweisungen des Raumbuchs gehen über `zurueck`, nicht als JSON an den Browser.
    expect(route).toMatch(/ergebnis\.art === 'ungueltig' \|\| ergebnis\.art === 'leer'/u);
    for (const grund of ['angebot_unvollstaendig', 'nichts_zu_kalkulieren']) {
      expect(route, grund).toContain(`'${grund}'`);
      expect(KETTE_TEXTE.de.maskeFehler[grund], grund).toBeDefined();
      expect(KETTE_TEXTE.en.maskeFehler[grund], grund).toBeDefined();
    }
  });

  it('/api/auftrag gibt die Eingaben mit zurück und ruft den geprüften Dienst', () => {
    const route = quelle('auftrag/route.ts');
    expect(route).toContain('maskeMitEingaben(');
    expect(route).toContain('legeAuftragDirektAn(');
    // Die Nummer zieht nur noch der Dienst — NACH der Prüfung der Anfrage.
    expect(route).not.toContain('vergebeNummer(');
  });
});

describe('die Sätze der Kette nennen Rechte beim Namen, nicht beim Schlüssel (V-144)', () => {
  it.each(['de', 'en'] as const)('%s: kein Satz der Kette zeigt einen rohen Rechteschlüssel', (s) => {
    const t = KETTE_TEXTE[s];
    const saetze = [...Object.values(t.fehler), ...Object.values(t.maskeFehler), t.ohneRecht,
      t.rechnungenOhneAuftragsrecht];
    for (const satz of saetze) expect(satz, satz).not.toMatch(/\b[a-z_]+\.(?:lesen|schreiben)\b/u);
    expect(t.fehler['kein_schreibrecht']).toContain(rechtName('crm.schreiben', s));
  });

  it('„ohne Recht" ist ein deutscher Satz', () => {
    expect(KETTE_TEXTE.de.ohneRecht).toBe('Das sieht, wer dieses Recht hält:');
  });
});

describe('die Pillen der Kette stehen an EINER Stelle (V-144)', () => {
  it('keine Seite der Kette führt eine eigene Abbildung mehr', () => {
    const seiten = [
      'angebote/page.tsx', 'auftraege/page.tsx', 'finanzen/rechnungen/page.tsx',
      'crm/leads/page.tsx', 'crm/leads/[id]/page.tsx', 'crm/kunden/[id]/page.tsx',
    ];
    for (const seite of seiten) {
      const text = readFileSync(fileURLToPath(new URL(
        `../../src/app/portal/[mandant]/${seite}`, import.meta.url)), 'utf8');
      expect(text, seite).not.toMatch(/Record<string, PillZustand>> = \{/u);
      expect(text, seite).toContain("from '@/lib/vorgang-pille'");
    }
  });
});
