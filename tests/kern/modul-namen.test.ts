/**
 * **Die Namen der Module und das Formular der Modulzuweisung** (AUT-01,
 * V-164, D-658).
 *
 * `benutzer_mandant.module` traegt Schluessel (`crm`, `finanzen`,
 * `oeffentlich`); auf dem Bildschirm stehen ihre Namen. Diese Datei haelt die
 * Namensliste gegen den Rechtekatalog: ein neues Modul ohne Namen faellt hier
 * auf und nicht als roher Schluessel auf dem Benutzerblatt.
 */
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import {
  MODUL_NAMEN, MODUL_ZUWEISUNG_TEXTE, modulName,
} from '../../src/lib/i18n/verwaltung/einstellungen/module-zuweisung.js';
import {
  MELDEBARE_GRUENDE, zuweisungAusFormular,
} from '../../src/server/services/system/mitgliedschaft-module.js';

const KATALOG_MODULE = [...new Set(KATALOG.map((e) => e.modul))].sort();

describe('jedes Modul des Katalogs hat einen Namen — in beiden Sprachen', () => {
  it('der Katalog hat ueberhaupt Module (sonst bestuende die Probe leer)', () => {
    expect(KATALOG_MODULE.length).toBeGreaterThan(30);
  });

  it.each(KATALOG_MODULE)('%s', (modul) => {
    const wort = MODUL_NAMEN[modul];
    expect(wort, `kein Name fuer ${modul}`).toBeDefined();
    expect(wort!.de.trim()).not.toBe('');
    expect(wort!.en.trim()).not.toBe('');
    expect(modulName(modul, 'de')).toBe(wort!.de);
    expect(modulName(modul, 'en')).toBe(wort!.en);
  });

  it('keine Namen fuer Module, die es nicht gibt', () => {
    expect(Object.keys(MODUL_NAMEN).sort()).toEqual(KATALOG_MODULE);
  });

  it('ein unbekanntes Modul wird lesbar, nicht leer', () => {
    expect(modulName('neues_modul', 'de')).toBe('Neues modul');
    expect(modulName('neues_modul', 'en')).toBe('Neues modul');
  });
});

describe('das Formular sagt, was es meint', () => {
  it('„alle" heisst NULL — alle Module der Rolle', () => {
    expect(zuweisungAusFormular('alle', ['crm', 'finanzen'])).toBeNull();
  });

  it('eine Auswahl wird sortiert, ohne Doppel und ohne Leeres', () => {
    expect(zuweisungAusFormular('auswahl', ['finanzen', ' crm ', 'crm', '']))
      .toEqual(['crm', 'finanzen']);
  });

  it('eine leere Auswahl bleibt leer — kein stilles „alles"', () => {
    expect(zuweisungAusFormular('auswahl', [])).toEqual([]);
    /* Auch ein fehlender Umfang ist KEIN „alle". */
    expect(zuweisungAusFormular('', ['crm'])).toEqual(['crm']);
  });
});

describe('jede Rueckmeldung hat einen Satz, in beiden Sprachen', () => {
  const STAENDE = ['module_gesetzt', 'module_unveraendert', ...MELDEBARE_GRUENDE];

  it.each(STAENDE)('%s', (stand) => {
    expect(MODUL_ZUWEISUNG_TEXTE.de.meldung[stand], `de: ${stand}`).toBeTruthy();
    expect(MODUL_ZUWEISUNG_TEXTE.en.meldung[stand], `en: ${stand}`).toBeTruthy();
  });

  it('„nicht_erlaubt" hat KEINEN Satz — es ist die 404 aller Routen (AUT-06)', () => {
    expect(MELDEBARE_GRUENDE).not.toContain('nicht_erlaubt');
    expect(MODUL_ZUWEISUNG_TEXTE.de.meldung['nicht_erlaubt']).toBeUndefined();
    expect(MODUL_ZUWEISUNG_TEXTE.en.meldung['nicht_erlaubt']).toBeUndefined();
  });
});
