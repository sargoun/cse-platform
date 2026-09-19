/**
 * Die Pruefliste des Auftragsabschlusses — gegen Routenregister und
 * Rechtekatalog gehalten.
 *
 * **Warum es diese Datei gibt.** Drei der acht Befunde trugen ein `zielRecht`,
 * das der Berechtigungskatalog gar nicht kennt (`leistungsnachweis.lesen`,
 * `aufmass.lesen`, `nachtrag.lesen`), und zwei ein `ziel`, das es als Route
 * nicht gibt (`reinigung/nachweise`, `bau/aufmasse`). Auf der Seite fiel das
 * nicht auf, sondern wurde still zum Gegenteil: `haeltRechte` legt nur die
 * UEBERGEBENEN Schluessel in seine Karte, ein unbekannter ist also `undefined`,
 * `undefined !== true` ist wahr — und jeder Benutzer las „Ihnen fehlt
 * leistungsnachweis.lesen", auch `super_admin`. Ein Verweis, der nie erscheint,
 * sieht aus wie eine Rechtepruefung und ist ein Tippfehler.
 *
 * Geprueft wird ohne Datenbank: `befundeAus` ist die reine Haelfte von
 * `ladePruefliste` und nimmt die Zeile, die `fin.auftrag_abschluss_befunde`
 * liefert.
 */
import { describe, expect, it } from 'vitest';
import {
  befundeAus, PRUEFLISTE_ZIELRECHTE, type BefundeZeile,
} from '../../src/server/services/auftrag/abschluss.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { ROUTEN } from '../../src/server/registry/routen.generiert.js';

/** Eine Zeile mit lauter Einsen — der Inhalt spielt hier keine Rolle. */
const ZEILE: BefundeZeile = {
  zeit_ohne_freigabe: '1', zeit_ohne_abrechnung: '1', erfasste_minuten: '60',
  nachweise_ohne_rechnung: '1', rechnungen_entwurf: '1', aufmasse_offen: '1',
  nachtraege_offen: '1', leistungen_laufend: '1', ohne_abrechnungsart: '1',
};

const BEFUNDE = befundeAus(ZEILE);
const RECHTE = new Set(KATALOG.map((k) => k.schluessel));

describe('Die Pruefliste des Auftragsabschlusses', () => {
  it('nennt acht Befunde mit eindeutigen Schluesseln', () => {
    expect(BEFUNDE).toHaveLength(8);
    expect(new Set(BEFUNDE.map((b) => b.schluessel)).size).toBe(8);
  });

  /** Solange O-730 offen ist, sperrt KEINER — das ist eine Aussage, kein Zufall. */
  it('keiner sperrt den Abschluss, solange O-730 offen ist', () => {
    expect(BEFUNDE.every((b) => !b.sperrt)).toBe(true);
  });

  it('jedes zielRecht steht im Berechtigungskatalog', () => {
    for (const b of BEFUNDE) {
      if (b.zielRecht === null) continue;
      expect(RECHTE.has(b.zielRecht), `${b.schluessel} → ${b.zielRecht}`).toBe(true);
    }
  });

  /**
   * Die Seite fragt GENAU diese Liste ab. Steht ein Recht in einem Befund und
   * nicht hier, ist es auf der Seite `undefined` — und damit fuer JEDEN „fehlt".
   */
  it('jedes zielRecht steht in PRUEFLISTE_ZIELRECHTE', () => {
    for (const b of BEFUNDE) {
      if (b.zielRecht === null) continue;
      expect([...PRUEFLISTE_ZIELRECHTE], b.schluessel).toContain(b.zielRecht);
    }
  });

  it('und PRUEFLISTE_ZIELRECHTE fuehrt nichts, was kein Befund nennt', () => {
    const genannt = new Set(BEFUNDE.map((b) => b.zielRecht).filter((r) => r !== null));
    for (const r of PRUEFLISTE_ZIELRECHTE) expect([...genannt]).toContain(r);
  });

  /**
   * Das Ziel ist ein Pfad UNTER `/portal/[mandant]/`, und das Recht daneben
   * muss das sein, mit dem diese Route bewacht ist — nicht das Modul, in dem
   * sie liegt. `/reinigung/leistungsnachweise` wacht mit `nachweis.lesen`,
   * nicht mit `reinigung.lesen`.
   */
  it('jedes Ziel ist eine Route, und ihr Leserecht ist das genannte', () => {
    for (const b of BEFUNDE) {
      if (b.ziel === null) continue;
      const pfad = `/portal/[mandant]/${b.ziel}`;
      const route = ROUTEN.find((r) => r.pfad === pfad);
      expect(route, `${b.schluessel} → ${pfad}`).toBeDefined();
      const bewachung = route!.bewachung as { art: string; lesen?: readonly string[] };
      expect(bewachung.art, pfad).toBe('recht');
      expect(bewachung.lesen ?? [], pfad).toContain(b.zielRecht);
    }
  });
});
