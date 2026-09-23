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
import { ROUTEN } from '../../src/server/registry/routen.js';
import {
  ANGEBOT_OFFEN, ANGEBOT_STATUS, AUFTRAG_AKTIV, AUFTRAG_STATUS, PROJEKT_IN_ARBEIT,
  PROJEKT_STATUS, angebotFilterAus, angebotStaende, auftragStatusAus, projektStatusAus,
  sqlWerte,
} from '../../src/server/services/bericht/mengen.js';
import { KENNZAHL_TEXTE } from '../../src/lib/i18n/verwaltung/kennzahlen.js';
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

describe('(c) V-149/V-150 — die Gruppenübersicht verweist mit dem Filter', () => {
  const seite = lies('src/app/portal/gruppe/page.tsx');

  it('„Angebote offen" ist keine nackte Zahl mehr', () => {
    expect(seite).toContain("liste('angebote?status=offen', b)");
    expect(seite).not.toMatch(/b\.angeboteOffen === null \? <KeinRecht \/> : b\.angeboteOffen/u);
    expect(imManifest('/portal/gruppe/angebote')).toBe(true);
  });

  it('Aufträge, Projekte und „Im Einsatz" führen auf ihre gefilterte Liste', () => {
    expect(seite).toContain('liste(`auftraege?status=${AUFTRAG_AKTIV}`, b)');
    expect(seite).toContain('liste(`projekte?status=${PROJEKT_IN_ARBEIT}`, b)');
    expect(seite).toContain('/portal/gruppe/auslastung?bereich=${b.slug}#im-einsatz');
    expect(seite).toContain("liste('aufgaben', b)");
    expect(imManifest('/portal/gruppe/aufgaben')).toBe(true);
    // Und die Listen lesen den Filter.
    expect(lies('src/app/portal/gruppe/auftraege/page.tsx')).toContain('auftragStatusAus(');
    expect(lies('src/app/portal/gruppe/projekte/page.tsx')).toContain('projektStatusAus(');
    expect(lies('src/app/portal/gruppe/angebote/page.tsx')).toContain('angebotFilterAus(');
    expect(lies('src/app/portal/gruppe/auslastung/page.tsx')).toContain('id="im-einsatz"');
  });

  it('die Gruppenübersicht zählt mit denselben Werten wie die Listen', () => {
    const dienst = lies('src/server/services/gruppe/uebersicht.ts');
    expect(dienst).toContain('[ANGEBOT_OFFEN, PROJEKT_IN_ARBEIT, AUFTRAG_AKTIV, OFFENE_ZUSTAENDE]');
    expect(dienst).not.toContain("'entwurf', 'in_pruefung', 'versendet'");
    // Die Gruppenliste der Aufgaben filtert mit derselben Werteliste.
    expect(lies('src/server/services/gruppe/aufgaben.ts'))
      .toContain('[mandantIds, OFFENE_ZUSTAENDE, GRUPPEN_AUFGABEN_GRENZE]');
  });
});

describe('V-150 — DSH-01: die gebauten Module haben ihre Kachel', () => {
  it.each([
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

  it('die Bereichslisten lesen den Filter der Kachel', () => {
    expect(lies('src/app/portal/[mandant]/auftraege/page.tsx')).toContain('auftragStatusAus(');
    expect(lies('src/app/portal/[mandant]/angebote/page.tsx')).toContain('angebotFilterAus(');
    expect(lies('src/app/portal/[mandant]/bau/projekte/page.tsx')).toContain('projektStatusAus(');
    // Kein innerer Join auf den Kunden mehr: ohne `crm.lesen` fiele die Zeile
    // aus der Liste, die Kachel zählte sie trotzdem.
    expect(lies('src/app/portal/[mandant]/auftraege/page.tsx'))
      .toContain('left join kunde k on k.id = a.kunde_id');
    expect(lies('src/app/portal/[mandant]/angebote/page.tsx'))
      .toContain('left join kunde k on k.id = a.kunde_id');
    expect(lies('src/server/services/bau/lv.ts'))
      .toContain('left join kunde k on k.id = p.kunde_id and k.mandant_id = p.mandant_id\n      where p.archiviert_am is null\n        and ($1::text is null');
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
      const m = new RegExp(`create type ${typ} as enum\\s*\\(([^)]*)\\)`, 'u').exec(sql);
      return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/gu)].map((x) => x[1] ?? '');
    };
    expect([...AUFTRAG_STATUS]).toEqual(aus('0025_auftrag.sql', 'auftrag_status'));
    expect([...PROJEKT_STATUS]).toEqual(aus('0071_lv_position.sql', 'projekt_status'));
    expect([...ANGEBOT_STATUS]).toEqual(aus('0024_angebot.sql', 'angebot_status'));
  });

  it('sqlWerte nimmt nur Aufzählungswerte', () => {
    expect(sqlWerte(['a', 'b_c'])).toBe("'a', 'b_c'");
    expect(() => sqlWerte(["x'; drop table lead; --"])).toThrow();
  });
});
