/**
 * PR 7 Akzeptanz (7) — der K-19-Katalogtest.
 *
 * `app.hat_recht()` antwortet für einen unbekannten Schlüssel `false` (D-17).
 * Das ist richtig und es ist gefährlich: ein Tippfehler wird kein Fehler,
 * sondern ein **dauerhaft leerer Bildschirm**. Diese Datei ist die einzige
 * Stelle, an der so ein Tippfehler laut wird.
 *
 * Zwei Richtungen, und beide zählen:
 *  - jeder Schlüssel im Code hat eine Katalogzeile;
 *  - jede Katalogzeile wird irgendwann benutzt (siehe NOCH_UNBENUTZT unten).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { AKTIONEN, MODULE, erzeugeDatei, ZIEL, zerlege } from '../../scripts/katalog/extrahiere.js';
import { blockAus, erzeugeSeed, MIGRATION } from '../../scripts/katalog/seed-sql.js';
import { funde } from '../../scripts/katalog/benutzung.js';
import { NOCH_UNBENUTZT } from './katalog-unbenutzt.js';

const SCHLUESSEL = new Set(KATALOG.map((e) => e.schluessel));

describe('(7) K-19 — kein Schlüssel ohne Katalogzeile, keine Katalogzeile ohne Zweck', () => {
  it('der erzeugte Katalog ist aktuell gegenüber dem Dokument', () => {
    // Das Dokument ist die Quelle (K-19). Weicht die erzeugte Datei ab, hat
    // jemand am Katalog vorbei entschieden.
    expect(readFileSync(ZIEL, 'utf8')).toBe(erzeugeDatei());
  });

  it('und der Seed-Block in 0008 ist derselbe Katalog', () => {
    expect(blockAus(readFileSync(MIGRATION, 'utf8'))).toBe(erzeugeSeed());
  });

  it('jeder Rechteschlüssel im Code hat eine Katalogzeile', () => {
    const fehlend = funde().filter((f) => !SCHLUESSEL.has(f.schluessel));
    expect(
      fehlend.map((f) => `${f.schluessel} (${f.datei})`),
      'Ein Schlüssel ohne Katalogzeile ist ein dauerhaft leerer Bildschirm, kein Fehler',
    ).toEqual([]);
  });

  it('die Prüfung findet überhaupt Schlüssel — sonst prüft sie nichts', () => {
    // Ohne diese Zusage bestünde die vorige Prüfung auf einer leeren Menge.
    expect(funde().length).toBeGreaterThan(5);
  });

  it('jede Katalogzeile ist benutzt — oder steht in der eingefrorenen Warteliste', () => {
    /**
     * Die andere Richtung. Bei 7 % gebauter Plattform ist der grösste Teil des
     * Katalogs noch von keinem Code berührt, und das ist kein Defekt — die
     * Rechte gehören zu Modulen, die in Phase 4 bis 9 landen.
     *
     * Statt die Prüfung abzuschalten, ist die Warteliste **eingefroren** und
     * die Zusage lautet: die Menge der unbenutzten Schlüssel ist eine
     * TEILMENGE davon. Sie darf schrumpfen, nie wachsen. Ein neu erfundener
     * Schlüssel, den niemand benutzt, steht nicht auf der Liste und bricht den
     * Build — genau der Fall, den die Vorgabe meint.
     */
    const benutzt = new Set(funde().map((f) => f.schluessel));
    const unbenutzt = KATALOG.map((e) => e.schluessel).filter((s) => !benutzt.has(s));
    const eingefroren = new Set(NOCH_UNBENUTZT);
    expect(
      unbenutzt.filter((s) => !eingefroren.has(s)),
      'Neu und unbenutzt: entweder benutzen oder bewusst auf die Warteliste setzen',
    ).toEqual([]);
  });

  it('die Warteliste enthält keine Schlüssel, die es nicht mehr gibt', () => {
    // Sonst behauptet sie eine Abdeckung für Zeilen, die verschwunden sind.
    expect(NOCH_UNBENUTZT.filter((s) => !SCHLUESSEL.has(s))).toEqual([]);
  });
});

describe('der Katalog ist in sich stimmig (K-19, K-21)', () => {
  it('das erste Segment IST das Modul — ausnahmslos', () => {
    for (const e of KATALOG) {
      expect(e.modul, e.schluessel).toBe(e.schluessel.split('.')[0]);
      expect(MODULE, e.schluessel).toContain(e.modul);
    }
  });

  it('jede Aktion steht im Vokabular von §7.2', () => {
    for (const e of KATALOG) {
      expect(AKTIONEN, `${e.schluessel} → ${e.aktion}`).toContain(e.aktion);
    }
  });

  it('die Schlüsselform hält den CHECK der Tabelle aus', () => {
    for (const e of KATALOG) {
      expect(e.schluessel, e.schluessel).toMatch(/^[a-z_]+(\.[a-z_]+){1,2}$/u);
    }
  });

  it('die Gruppenschlüssel sind vollständig entfaltet', () => {
    // §12.1: eine Zeile je Modul, mechanisch. Fehlt eine, ist genau diese
    // Gruppenlesung dauerhaft leer.
    for (const modul of MODULE.filter((m) => m !== 'gruppe')) {
      expect(SCHLUESSEL, modul).toContain(`gruppe.${modul}.lesen`);
    }
    // Und die zwei mit Objektsilbe, die die Grammatik von §7.2 erst zulässt.
    expect(SCHLUESSEL).toContain('gruppe.system.audit_lesen');
    expect(SCHLUESSEL).toContain('gruppe.dienstplan.arbzg_lesen');
    // Kein `gruppe.gruppe.lesen` — das benennt nichts.
    expect(SCHLUESSEL).not.toContain('gruppe.gruppe.lesen');
  });

  it('zerlege() liest die Grammatik von §7.2, auch mit Objektsilbe', () => {
    expect(zerlege('crm.lesen')).toEqual({ modul: 'crm', objekt: 'crm', aktion: 'lesen' });
    expect(zerlege('personal.entgelt_lesen'))
      .toEqual({ modul: 'personal', objekt: 'entgelt', aktion: 'lesen' });
    expect(zerlege('gruppe.dienstplan.arbzg_lesen'))
      .toEqual({ modul: 'gruppe', objekt: 'dienstplan_arbzg', aktion: 'lesen' });
    expect(zerlege('gruppe.finanzen.lesen'))
      .toEqual({ modul: 'gruppe', objekt: 'finanzen', aktion: 'lesen' });
  });

  it('47 Module, 42 Aktionen — die Listen sind die Definition, die Zahl die Prüfsumme', () => {
    expect(MODULE).toHaveLength(47);
    expect(AKTIONEN).toHaveLength(42);
    expect(new Set(MODULE).size).toBe(47);
    expect(new Set(AKTIONEN).size).toBe(42);
    // `ziehen` ist nicht optional: ohne sie kann keine Rechnung, kein
    // Leistungsnachweis und kein Wachbucheintrag je nummeriert werden.
    expect(AKTIONEN).toContain('ziehen');
    for (const pflicht of ['lesen', 'schreiben', 'loeschen', 'pruefen', 'freigeben',
                           'exportieren', 'verwalten']) {
      expect(AKTIONEN, pflicht).toContain(pflicht);
    }
  });
});
