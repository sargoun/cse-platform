/**
 * Jede Zahl führt zu ihren Zeilen — die Ziele der Kacheln und der
 * Gruppenübersicht (DSH-01, DSH-04, V-149, V-150, D-643, D-644).
 *
 * **Die Befunde.** (a) „Offene Wiedervorlagen" zählte alle Zuständigen und
 * führte auf die Liste in der Vorgabe „nur meine". (b) „Aktivität (7 Tage)"
 * zählte `lead_aktivitaet` und führte auf die Kundenliste. (c) „Angebote
 * offen" in der Gruppenübersicht war eine nackte Zahl. Und DSH-01: für
 * Aufträge, Bauprojekte, Angebote, Forderungen und Aufgaben gab es gar keine
 * Kachel, obwohl die Module gebaut waren.
 *
 * Geprüft wird hier ohne Datenbank: dass jedes Ziel eine Route des Manifests
 * ist, dass es den Filter trägt, der die gezählte Menge zeigt, und dass Kachel,
 * Liste und Gruppenübersicht dieselbe Werteliste benutzen. Dass Zahl und Zeilen
 * an echten Daten übereinstimmen, prüft `tests/isolation/kennzahlen.test.ts`
 * für JEDE Kachel.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kacheln, leereKacheln } from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import { ROUTEN, findeRoute, leserechte } from '../../src/server/registry/routen.js';
import {
  ANGEBOT_OFFEN, ANGEBOT_STATUS, AUFTRAG_AKTIV, AUFTRAG_STATUS, FRIST_UEBERSCHRITTEN, LEAD_NEU,
  LEAD_STATUS, PROJEKT_IN_ARBEIT, PROJEKT_STATUS, angebotFilterAus, angebotStaende,
  auftragStatusAus, fristUeberschrittenSql, leadFristAus, leadStatusAus, projektStatusAus,
  sqlWerte,
} from '../../src/server/services/bericht/mengen.js';
import { KENNZAHL_TEXTE } from '../../src/lib/i18n/verwaltung/kennzahlen.js';
import {
  SUMMEN_ZIELE, UEBERSICHT_RECHTE, UEBERSICHT_ZIELE, UEBERSICHT_ZIELRECHTE, uebersichtZiel,
  type UebersichtSpalte,
} from '../../src/server/services/gruppe/uebersicht.js';
import { OFFENE_ZUSTAENDE } from '../../src/server/services/kern/aufgabe.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

afterEach(leereKacheln);

const BEREICH = { mandantId: 'm', mandantSlug: 'reinigung', mandantIds: ['m'] };
const GRUPPE = { mandantId: null, mandantSlug: null, mandantIds: ['m', 'n'] };

/** Passt eine konkrete Adresse (ohne Abfrage und Anker) auf ein Muster des Manifests? */
function imManifest(adresse: string): boolean {
  const teile = (adresse.split(/[?#]/u)[0] ?? '').split('/').filter((t) => t !== '');
  return ROUTEN.some((r) => {
    const m = r.pfad.split('/').filter((t) => t !== '');
    return m.length === teile.length && m.every((seg, i) => seg.startsWith('[') || seg === teile[i]);
  });
}

function kachel(schluessel: string) {
  const k = kacheln().find((x) => x.schluessel === schluessel);
  expect(k, schluessel).toBeDefined();
  return k!;
}

describe('jedes Ziel ist eine Route, die es gibt', () => {
  it('im Bereich und in der Gruppe', () => {
    registriereBerichtKacheln();
    for (const k of kacheln()) {
      expect(imManifest(k.ziel(BEREICH)), `${k.schluessel} → ${k.ziel(BEREICH)}`).toBe(true);
      expect(imManifest(k.ziel(GRUPPE)), `${k.schluessel} → ${k.ziel(GRUPPE)}`).toBe(true);
    }
  });
});

describe('(a)(b) V-149 — die Ziele zeigen die gezählte Menge', () => {
  it('„Offene Wiedervorlagen" öffnet die Liste mit allen Zuständigen', () => {
    registriereBerichtKacheln();
    expect(kachel('offene_wiedervorlagen').ziel(BEREICH))
      .toBe('/portal/reinigung/crm/wiedervorlagen?wer=alle');
    // Die Liste liest genau diesen Parameter.
    expect(lies('src/app/portal/[mandant]/crm/wiedervorlagen/page.tsx'))
      .toContain("suche.wer !== 'alle'");
  });

  it('„Aktivität (7 Tage)" führt auf die Aktivitätsliste, nicht auf die Kunden', () => {
    registriereBerichtKacheln();
    const k = kachel('letzte_aktivitaet');
    expect(k.ziel(BEREICH)).toBe('/portal/reinigung/crm/aktivitaet');
    // Dieselbe Frist in Kachel und Liste.
    expect(k.zaehlung).toContain("interval '7 days'");
    const dienst = lies('src/server/services/crm/verlauf.ts');
    expect(dienst).toMatch(/AKTIVITAET_TAGE = 7;/u);
    expect(dienst).toContain('from lead_aktivitaet la');
  });
});

describe('(c) V-149/V-150/V-152 — die Gruppenübersicht verweist mit dem Filter', () => {
  const seite = lies('src/app/portal/gruppe/page.tsx');

  it('jede Zelle und jede Summe führt auf eine Route, deren Recht die Zelle verlangt', () => {
    /*
     * V-152 (AUT-06): eine Zelle ist nur dort eine Zahl, wo die Sitzung
     * `UEBERSICHT_RECHTE[spalte]` und `UEBERSICHT_ZIELRECHTE[spalte]` hält —
     * dann darf sie auch die Liste dahinter öffnen. „Forderungen offen" zählte
     * mit `gruppe.zahlung.lesen` und führte auf eine Seite mit
     * `gruppe.buchhaltung.lesen`.
     */
    const geprueft = (spalte: UebersichtSpalte, ziel: string): void => {
      const route = findeRoute(ziel);
      expect(route, `${spalte} → ${ziel}`).toBeDefined();
      const gehalten = new Set([UEBERSICHT_RECHTE[spalte], UEBERSICHT_ZIELRECHTE[spalte]]);
      for (const r of leserechte(route!)) {
        expect(gehalten.has(r), `${spalte} → ${ziel} verlangt ${r}`).toBe(true);
      }
    };
    for (const spalte of Object.keys(UEBERSICHT_ZIELE) as UebersichtSpalte[]) {
      geprueft(spalte, uebersichtZiel(UEBERSICHT_ZIELE[spalte], 'reinigung'));
    }
    for (const spalte of Object.keys(SUMMEN_ZIELE) as (keyof typeof SUMMEN_ZIELE)[]) {
      geprueft(spalte, uebersichtZiel(SUMMEN_ZIELE[spalte], null));
    }
    expect(UEBERSICHT_ZIELRECHTE.forderungen).toBe('gruppe.buchhaltung.lesen');
  });

  it('die Ziele tragen den Filter der gezählten Menge', () => {
    expect(uebersichtZiel(UEBERSICHT_ZIELE.auftraege, 'reinigung'))
      .toBe(`/portal/gruppe/auftraege?status=${AUFTRAG_AKTIV}&bereich=reinigung`);
    expect(uebersichtZiel(UEBERSICHT_ZIELE.angebote, 'bau'))
      .toBe('/portal/gruppe/angebote?status=offen&bereich=bau');
    expect(uebersichtZiel(UEBERSICHT_ZIELE.projekte, 'bau'))
      .toBe(`/portal/gruppe/projekte?status=${PROJEKT_IN_ARBEIT}&bereich=bau`);
    // V-152: „Neue Anfragen" zählt `status = 'neu'` und führte auf die ganze Pipeline.
    expect(uebersichtZiel(UEBERSICHT_ZIELE.leads, 'security'))
      .toBe(`/portal/gruppe/leads?status=${LEAD_NEU}&bereich=security`);
    // Der Anker bleibt am Ende, der Bereich kommt davor.
    expect(uebersichtZiel(UEBERSICHT_ZIELE.einsatz, 'reinigung'))
      .toBe('/portal/gruppe/auslastung?bereich=reinigung#im-einsatz');
    // V-152: die Summenkachel „Aufträge aktiv" führte auf alle nicht archivierten Aufträge.
    expect(uebersichtZiel(SUMMEN_ZIELE.auftraege, null))
      .toBe(`/portal/gruppe/auftraege?status=${AUFTRAG_AKTIV}`);
    expect(uebersichtZiel(SUMMEN_ZIELE.fakturiert, null)).toBe('/portal/gruppe/finanzen');
    // Die Seite benutzt genau diese Ziele — keine eigene Schreibweise daneben.
    expect(seite).toContain('uebersichtZiel(UEBERSICHT_ZIELE[spalte], slug)');
    expect(seite).toContain('uebersichtZiel(SUMMEN_ZIELE[z.schluessel], null)');
    expect(seite).not.toMatch(/href="\/portal\/gruppe\//u);
    expect(seite).not.toMatch(/b\.angeboteOffen === null \? <KeinRecht \/> : b\.angeboteOffen/u);
    // Und die Listen lesen den Filter.
    expect(lies('src/app/portal/gruppe/auftraege/page.tsx')).toContain('auftragStatusAus(');
    expect(lies('src/app/portal/gruppe/projekte/page.tsx')).toContain('projektStatusAus(');
    expect(lies('src/app/portal/gruppe/angebote/page.tsx')).toContain('angebotFilterAus(');
    expect(lies('src/app/portal/gruppe/leads/page.tsx')).toContain('leadStatusAus(');
    expect(lies('src/app/portal/gruppe/auslastung/page.tsx')).toContain('id="im-einsatz"');
  });

  it('V-152: eine Summe ohne einen einzigen lesbaren Bereich ist ein Strich ohne Verweis', () => {
    expect(seite).toMatch(/z\.bereiche === 0 \? \(/u);
    expect(seite).toContain('wert="—"');
  });

  it('V-152: die Übersicht spricht die Sprache der Sitzung — keine deutsche Spalte daneben', () => {
    // Jeder Spaltenkopf und jede Summenbeschriftung kommt aus KENNZAHL_TEXTE.
    expect(seite).not.toMatch(/kopf: ['`"]/u);
    expect(seite).not.toMatch(/label=\{`[A-ZÄÖÜ]/u);
    expect(seite).not.toMatch(/label: '[A-ZÄÖÜ]/u);
    expect(seite).not.toContain('>Gruppenübersicht<');
    const de = KENNZAHL_TEXTE.de;
    const en = KENNZAHL_TEXTE.en;
    for (const k of Object.keys(de) as (keyof typeof de)[]) {
      expect(en[k], `en fehlt: ${String(k)}`).toBeDefined();
    }
    expect(en.gruppeTitel).not.toBe(de.gruppeTitel);
    expect(en.gruppeFakturiert(2026)).toBe('Invoiced 2026');
    expect(de.anteil(2, 4)).toBe(' · 2 von 4 Bereichen');
  });

  it('die Gruppenübersicht zählt mit denselben Werten wie die Listen', () => {
    const dienst = lies('src/server/services/gruppe/uebersicht.ts');
    expect(dienst)
      .toContain('[ANGEBOT_OFFEN, PROJEKT_IN_ARBEIT, AUFTRAG_AKTIV, OFFENE_ZUSTAENDE, LEAD_NEU]');
    expect(dienst).not.toContain("'entwurf', 'in_pruefung', 'versendet'");
    expect(dienst).not.toContain("l.status = 'neu'");
    expect(imManifest('/portal/gruppe/angebote')).toBe(true);
    expect(imManifest('/portal/gruppe/aufgaben')).toBe(true);
    // Die Gruppenliste der Aufgaben filtert mit derselben Werteliste.
    expect(lies('src/server/services/gruppe/aufgaben.ts'))
      .toContain('[mandantIds, OFFENE_ZUSTAENDE, GRUPPEN_AUFGABEN_GRENZE]');
  });
});

describe('V-150 — DSH-01: die gebauten Module haben ihre Kachel', () => {
  it.each([
    // V-152: auch die beiden CRM-Kacheln führen mit ihrem Filter.
    ['neue_leads', 'crm.lesen', '/portal/reinigung/crm/leads?status=neu'],
    ['leads_ueber_sla', 'crm.lesen', '/portal/reinigung/crm/leads?frist=ueberschritten'],
    ['auftraege_aktiv', 'auftrag.lesen', '/portal/reinigung/auftraege?status=aktiv'],
    ['projekte_in_arbeit', 'bau.lesen', '/portal/reinigung/bau/projekte?status=in_arbeit'],
    ['angebote_offen', 'angebot.lesen', '/portal/reinigung/angebote?status=offen'],
    ['forderungen_offen', 'buchhaltung.lesen',
      '/portal/reinigung/buchhaltung/offene-posten?art=debitor'],
    ['aufgaben_offen', 'aufgabe.lesen', '/portal/reinigung/aufgaben'],
  ])('%s — Recht %s, Ziel %s', (schluessel, recht, ziel) => {
    registriereBerichtKacheln();
    const k = kachel(schluessel);
    expect(k.recht).toBe(recht);
    expect(k.ziel(BEREICH)).toBe(ziel);
  });

  it('in der Gruppe führen die neuen Kacheln auf die Gruppenlisten', () => {
    registriereBerichtKacheln();
    expect(kachel('auftraege_aktiv').ziel(GRUPPE)).toBe('/portal/gruppe/auftraege?status=aktiv');
    expect(kachel('projekte_in_arbeit').ziel(GRUPPE)).toBe('/portal/gruppe/projekte?status=in_arbeit');
    expect(kachel('angebote_offen').ziel(GRUPPE)).toBe('/portal/gruppe/angebote?status=offen');
    expect(kachel('forderungen_offen').ziel(GRUPPE)).toBe('/portal/gruppe/offene-posten');
    expect(kachel('aufgaben_offen').ziel(GRUPPE)).toBe('/portal/gruppe/aufgaben');
    expect(kachel('neue_leads').ziel(GRUPPE)).toBe(`/portal/gruppe/leads?status=${LEAD_NEU}`);
    expect(kachel('leads_ueber_sla').ziel(GRUPPE))
      .toBe(`/portal/gruppe/leads?frist=${FRIST_UEBERSCHRITTEN}`);
  });

  it('Kachel und Liste benutzen dieselbe Werteliste', () => {
    registriereBerichtKacheln();
    expect(kachel('auftraege_aktiv').zaehlung).toContain(`status = '${AUFTRAG_AKTIV}'`);
    expect(kachel('projekte_in_arbeit').zaehlung).toContain(`status = '${PROJEKT_IN_ARBEIT}'`);
    expect(kachel('angebote_offen').zaehlung).toContain(`status in (${sqlWerte(ANGEBOT_OFFEN)})`);
    // Die offenen Posten: dieselbe Bedingung wie `postenListe`.
    const posten = lies('src/server/services/buchhaltung/offene-posten.ts');
    expect(posten).toContain('op.ausgeglichen_am is null and op.offen_cent > 0');
    expect(kachel('forderungen_offen').zaehlung).toContain('ausgeglichen_am is null and offen_cent > 0');
    // Die Aufgaben: dieselbe Menge wie `nurOffene` in `kern/aufgabe.ts` —
    // die Kachel baut ihr Prädikat aus `OFFENE_ZUSTAENDE`, die Liste schreibt
    // dieselben drei Stände aus.
    expect([...OFFENE_ZUSTAENDE]).toEqual(['offen', 'in_arbeit', 'wartend']);
    expect(lies('src/server/services/kern/aufgabe.ts'))
      .toContain("a.status in ('offen','in_arbeit','wartend')");
    expect(kachel('aufgaben_offen').zaehlung)
      .toContain(`status in (${sqlWerte(OFFENE_ZUSTAENDE)})`);
  });

  it('die Bereichslisten lesen den Filter der Kachel — und holen die Zeilen aus dem Dienst', () => {
    /*
     * Ob die Liste dieselben Zeilen zeigt wie die Kachel, prüft
     * `tests/isolation/kennzahlen-listen.test.ts` an echten Zeilen (V-152).
     * Hier steht nur die Verdrahtung: die Seite liest den Filter gegen die
     * Werteliste und fragt den Dienst, keine eigene Abfrage.
     */
    const auftraege = lies('src/app/portal/[mandant]/auftraege/page.tsx');
    const angebote = lies('src/app/portal/[mandant]/angebote/page.tsx');
    const leads = lies('src/app/portal/[mandant]/crm/leads/page.tsx');
    expect(auftraege).toContain('auftragStatusAus(');
    expect(auftraege).toContain('listeAuftraege(kontext, status)');
    expect(angebote).toContain('angebotFilterAus(');
    expect(angebote).toContain('listeAngebote(kontext, filter)');
    expect(leads).toContain('leadStatusAus(');
    expect(leads).toContain('leadFristAus(');
    expect(leads).toContain('listeLeads(kontext, filter)');
    expect(lies('src/app/portal/[mandant]/bau/projekte/page.tsx')).toContain('projektStatusAus(');
    for (const seite of [auftraege, angebote, leads]) expect(seite).not.toMatch(/\bfrom (auftrag|angebot|lead)\b/u);
    // Kein innerer Join auf den Kunden (D-644 Punkt 2) — unabhängig vom Zeilenumbruch.
    expect(lies('src/server/services/bau/lv.ts'))
      .toMatch(/left\s+join\s+kunde\s+k\s+on\s+k\.id\s*=\s*p\.kunde_id/u);
  });

  it('jede Kachel hat ihren Namen in beiden Sprachen (D-592)', () => {
    registriereBerichtKacheln();
    for (const s of ['de', 'en'] as const) {
      for (const k of kacheln()) {
        expect(KENNZAHL_TEXTE[s].kacheln[k.schluessel], `${s}: ${k.schluessel}`).toBeTruthy();
      }
    }
    // Der deutsche Name ist derselbe wie im Register — eine Wahrheit.
    for (const k of kacheln()) expect(KENNZAHL_TEXTE.de.kacheln[k.schluessel]).toBe(k.label);
  });
});

describe('mengen.ts — Filter nur aus der Werteliste', () => {
  it('ein bekannter Stand geht durch, ein fremdes Wort nicht', () => {
    expect(auftragStatusAus('aktiv')).toBe('aktiv');
    expect(auftragStatusAus("aktiv' or 1=1 --")).toBeNull();
    expect(auftragStatusAus(['aktiv'])).toBeNull();
    expect(projektStatusAus('in_arbeit')).toBe('in_arbeit');
    expect(projektStatusAus('laufend')).toBeNull();
    expect(angebotFilterAus('offen')).toBe('offen');
    expect(angebotFilterAus('versendet')).toBe('versendet');
    expect(angebotFilterAus('alle')).toBeNull();
  });

  it('„offen" meint genau die drei Stände vor einer Entscheidung', () => {
    expect(angebotStaende('offen')).toEqual(['entwurf', 'in_pruefung', 'versendet']);
    expect(angebotStaende('abgelehnt')).toEqual(['abgelehnt']);
    expect(angebotStaende(null)).toBeNull();
  });

  it('die Wertelisten entsprechen den Aufzählungen der Migrationen', () => {
    const aus = (datei: string, typ: string): readonly string[] => {
      const sql = lies(`drizzle/${datei}`);
      // `\s+`: 0017 richtet die Namen mit mehreren Leerzeichen aus.
      const m = new RegExp(`create type ${typ}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, 'u').exec(sql);
      return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/gu)].map((x) => x[1] ?? '');
    };
    expect([...AUFTRAG_STATUS]).toEqual(aus('0025_auftrag.sql', 'auftrag_status'));
    expect([...PROJEKT_STATUS]).toEqual(aus('0071_lv_position.sql', 'projekt_status'));
    expect([...ANGEBOT_STATUS]).toEqual(aus('0024_angebot.sql', 'angebot_status'));
    expect([...LEAD_STATUS]).toEqual(aus('0017_lead.sql', 'lead_status'));
  });

  it('V-152: Leadstand und Frist — nur aus der Werteliste, und ein Prädikat für Kachel und Liste', () => {
    expect(leadStatusAus('neu')).toBe('neu');
    expect(leadStatusAus("neu' or 1=1 --")).toBeNull();
    expect(leadStatusAus(['neu'])).toBeNull();
    expect(leadFristAus('ueberschritten')).toBe('ueberschritten');
    expect(leadFristAus('abgelaufen')).toBeNull();
    expect(LEAD_NEU).toBe('neu');
    const kachelSql = (s: string): string => kacheln().find((k) => k.schluessel === s)!.zaehlung;
    registriereBerichtKacheln();
    expect(kachelSql('leads_ueber_sla')).toContain(fristUeberschrittenSql(''));
    expect(kachelSql('neue_leads')).toContain(`status = '${LEAD_NEU}'`);
    const listen = lies('src/server/services/bericht/listen.ts');
    expect(listen).toContain("fristUeberschrittenSql('l.')");
  });

  it('sqlWerte nimmt nur Aufzählungswerte', () => {
    expect(sqlWerte(['a', 'b_c'])).toBe("'a', 'b_c'");
    expect(() => sqlWerte(["x'; drop table lead; --"])).toThrow();
  });
});
