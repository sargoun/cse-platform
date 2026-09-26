import { describe, expect, it } from 'vitest';
import {
  GRUPPEN_NAVIGATION, KUNDEN_NAVIGATION, NAVI_GRUPPEN, NAVIGATION,
} from '@/server/registry/navigation';
import { INTERN_BESCHRIFTUNGEN, INTERN_SPRACHEN } from '@/lib/i18n/intern';

/**
 * Die Gliederung der Gesellschaftsleiste (DESIGN-PLAN §4, D-616).
 *
 * **Warum diese Datei existiert.** Der Befund des Mandanten — „ich finde
 * nichts, alles ist ineinander" — hatte eine mechanische Ursache: 32 flache
 * Eintraege ohne Gruppenfeld. Die Gliederung behebt das; ohne Wache verfaellt
 * sie in dem Tempo, in dem Punkte dazukommen. Ein neuer Eintrag ohne Gruppe
 * faellt wortlos ans Ende der Leiste, und das sieht aus wie eine Entscheidung
 * — derselbe Ausfallmodus, den die Uebersetzungsklinke fuer Texte schliesst.
 */
describe('die Leiste ist gegliedert, und sie bleibt es', () => {
  it('JEDER Eintrag der Gesellschaftsleiste traegt eine Gruppe', () => {
    const ohne = NAVIGATION.filter((e) => e.gruppe === undefined).map((e) => e.schluessel);
    expect(ohne, 'ohne Gruppe faellt der Punkt ans Ende und niemand merkt es').toEqual([]);
  });

  it('und nur eine aus dem geschlossenen Satz', () => {
    const erlaubt = new Set<string>(NAVI_GRUPPEN);
    const fremd = NAVIGATION
      .filter((e) => e.gruppe !== undefined && !erlaubt.has(e.gruppe))
      .map((e) => `${e.schluessel} -> ${String(e.gruppe)}`);
    expect(fremd).toEqual([]);
  });

  /*
   * Eine Gruppe ohne Punkte waere eine leere Ueberschrift. Sie faellt am
   * Bildschirm nicht auf — die Leiste rendert sie einfach nicht — und bliebe
   * als toter Schluessel samt zwei Uebersetzungen stehen.
   */
  it('jede Gruppe traegt mindestens einen Punkt', () => {
    const leer = NAVI_GRUPPEN.filter(
      (g) => !NAVIGATION.some((e) => e.gruppe === g));
    expect(leer, 'leere Gruppe: entweder fuellen oder streichen').toEqual([]);
  });

  it('jede Gruppe hat eine Beschriftung in BEIDEN Sprachen', () => {
    for (const sprache of INTERN_SPRACHEN) {
      const fehlend = NAVI_GRUPPEN
        .filter((g) => INTERN_BESCHRIFTUNGEN[sprache][`leiste.${g}`] === undefined);
      expect(fehlend, `${sprache}: Gruppe ohne Beschriftung`).toEqual([]);
    }
  });

  /*
   * Die Gruppen- und die Kundenleiste haben 18 und 11 Eintraege; eine
   * Gliederung waere dort eine Ueberschrift ueber zwei Punkten. Dass sie
   * KEINE tragen, ist damit eine Entscheidung und kein Rueckstand — und
   * dieser Fall haelt sie fest.
   */
  it('die Gruppen- und die Kundenleiste bleiben flach — mit Absicht', () => {
    expect(GRUPPEN_NAVIGATION.filter((e) => e.gruppe !== undefined)).toEqual([]);
    expect(KUNDEN_NAVIGATION.filter((e) => e.gruppe !== undefined)).toEqual([]);
  });

  it('die Reihenfolge der Gruppen ist die Anzeigereihenfolge — vom Haeufigsten', () => {
    expect([...NAVI_GRUPPEN]).toEqual([
      'heute', 'kunden', 'einsatz', 'personal', 'geld', 'aussen', 'werkzeuge',
    ]);
  });
});
