/**
 * PR 18 Akzeptanz (2) und (4) — was sich ohne Datenbank beweisen laesst.
 *
 * (1) und (3) brauchen echte Zeilen und stehen in
 * `tests/isolation/kennzahlen.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  KachelFehler, kacheln, leereKacheln, registriereKachel, sichtbareKacheln,
  type Kachel,
} from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import { belegteModule } from '../../src/server/services/bericht/dashboard.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';

const gueltig = (ueber: Partial<Kachel> = {}): Kachel => ({
  schluessel: 'test_kachel',
  label: 'Test',
  modul: 'crm',
  recht: 'crm.lesen',
  ton: 'info',
  zaehlung: 'select count(*)::int as wert from lead where mandant_id = any($1)',
  zeilen: 'select id from lead where mandant_id = any($1)',
  ziel: () => '/portal/x/crm/leads',
  ...ueber,
});

afterEach(leereKacheln);

describe('(2) eine Kachel ohne Abfrage oder Linkziel lässt sich nicht registrieren', () => {
  it('ohne Linkziel — DSH-04', () => {
    // Eine Kachel, die 14 zeigt und nirgendwohin führt, lässt genau die Frage
    // offen, die sie ausgelöst hat: WELCHE vierzehn?
    expect(() => registriereKachel(gueltig({ ziel: () => '' })))
      .toThrow(KachelFehler);
    expect(() => registriereKachel(gueltig({ ziel: () => 'crm/leads' })))
      .toThrow(/ziel/u);
  });

  it('ohne Zählung', () => {
    expect(() => registriereKachel(gueltig({ zaehlung: 'select 1' })))
      .toThrow(/zaehlung|wert/u);
  });

  it('eine Zählung ohne Spalte `wert`', () => {
    expect(() => registriereKachel(gueltig({ zaehlung: 'select count(*) from lead' })))
      .toThrow(KachelFehler);
  });

  it('ohne Zeilenabfrage — sonst ist Zahl vs. Liste nicht prüfbar', () => {
    expect(() => registriereKachel(gueltig({ zeilen: '  ' }))).toThrow(KachelFehler);
  });

  it('ohne Label', () => {
    expect(() => registriereKachel(gueltig({ label: '' }))).toThrow(KachelFehler);
  });

  it('zweimal derselbe Schlüssel', () => {
    registriereKachel(gueltig());
    expect(() => registriereKachel(gueltig())).toThrow(/bereits registriert/u);
  });

  it('eine vollständige Kachel geht durch', () => {
    // Ohne diese Zusage bestünde der Test auch, wenn ALLES scheiterte.
    expect(() => registriereKachel(gueltig())).not.toThrow();
  });
});

describe('die heutigen Kacheln sind vollständig und rechtlich verankert', () => {
  it('sieben Kacheln, wie der Plan sie nennt', () => {
    const angelegt = registriereBerichtKacheln();
    expect(angelegt.length).toBe(7);
    expect(kacheln().map((k) => k.schluessel).sort()).toEqual([
      'anstellungen', 'benutzer_aktiv', 'leads_ueber_sla', 'letzte_aktivitaet',
      'neue_leads', 'offene_wiedervorlagen', 'personen',
    ]);
  });

  it('jedes genannte Recht hat eine Katalogzeile (K-19)', () => {
    registriereBerichtKacheln();
    const bekannt = new Set(KATALOG.map((k) => k.schluessel));
    for (const k of kacheln()) {
      // Ein Recht ohne Katalogzeile antwortet `false` — die Kachel wäre für
      // JEDE Rolle unsichtbar, und niemand bekäme einen Fehler.
      expect(bekannt.has(k.recht), `${k.schluessel} → ${k.recht}`).toBe(true);
    }
  });

  it('jede Kachel filtert über $1 — sonst ändert der Bereichswechsel sie nicht', () => {
    registriereBerichtKacheln();
    for (const k of kacheln()) {
      expect(k.zaehlung, k.schluessel).toContain('$1');
      expect(k.zeilen, k.schluessel).toContain('$1');
    }
  });
});

describe('(4) ein Modul, das nicht gemergt ist, hat KEINE Kachel', () => {
  it('nur Module, die es gibt', () => {
    registriereBerichtKacheln();
    /**
     * `0` heisst in einem Dashboard "es gibt keine offenen Rechnungen".
     * "Noch nicht gebaut" heisst etwas völlig anderes, und wer die beiden
     * verwechselt, plant auf einer Zahl, die es nicht gibt.
     */
    expect(belegteModule()).toEqual(['bericht', 'crm', 'personal', 'system']
      .filter((m) => belegteModule().includes(m)));
    for (const nichtGebaut of ['finanzen', 'zahlung', 'mahnung', 'vergabe', 'radar']) {
      expect(belegteModule(), `${nichtGebaut} ist noch nicht gemergt`)
        .not.toContain(nichtGebaut);
    }
  });
});

describe('was der Benutzer nicht darf, erscheint gar nicht (AUT-06)', () => {
  it('ohne `crm.lesen` sind die CRM-Kacheln abwesend, nicht ausgegraut', () => {
    registriereBerichtKacheln();
    const ohneCrm = sichtbareKacheln((r) => r !== 'crm.lesen');
    expect(ohneCrm.map((k) => k.schluessel)).not.toContain('neue_leads');
    // Eine ausgegraute Kachel verriete die Existenz der Zahl.
    expect(ohneCrm.length).toBeGreaterThan(0);
  });

  it('ohne jedes Recht bleibt keine Kachel übrig', () => {
    registriereBerichtKacheln();
    expect(sichtbareKacheln(() => false)).toEqual([]);
  });
});
