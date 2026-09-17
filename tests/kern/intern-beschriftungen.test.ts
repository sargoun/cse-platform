import { describe, expect, it } from 'vitest';
import { NAVIGATION, GRUPPEN_NAVIGATION } from '@/server/registry/navigation';
import { INTERNE_LEISTEN, tableiste } from '@/server/registry/tableiste';
import {
  INTERN_BESCHRIFTUNGEN, INTERN_SPRACHEN, internBeschriftungen, internSprache,
  internSprachwahl, istInternSprache,
} from '@/lib/i18n/intern';
import { PORTAL_SPRACHEN } from '@/lib/i18n/texte';

/**
 * Die Beschriftungen der internen Huelle — gegen die Register geprueft.
 *
 * **Warum dieser Test existiert.** `PortalRahmen` faellt fuer einen
 * Schluessel, den die Karte nicht kennt, auf das deutsche Label des Registers
 * zurueck. Das ist als Verhalten richtig — ein leerer Menuepunkt waere
 * schlimmer — aber es macht die Luecke unsichtbar: der englische Bildschirm
 * zeigt einen deutschen Punkt, niemand bekommt einen Fehler, und es sieht aus
 * wie Absicht. Ein neuer Navigationspunkt muss deshalb hier auffallen, nicht
 * am Bildschirm.
 */

/** Die Schluessel der Kopfzeile — sie stehen in `PortalRahmen`, nicht im Register. */
const HUELLEN_SCHLUESSEL: readonly string[] = [
  'sitzung.label', 'sitzung.bereich', 'sitzung.konto', 'sitzung.website',
  'sitzung.abmelden', 'pfad.label', 'sprache.label',
];

function registerSchluessel(): readonly string[] {
  const aus = new Set<string>(HUELLEN_SCHLUESSEL);
  for (const e of NAVIGATION) aus.add(e.schluessel);
  for (const e of GRUPPEN_NAVIGATION) aus.add(e.schluessel);
  for (const l of INTERNE_LEISTEN) for (const z of tableiste(l).ziele) aus.add(z.schluessel);
  return [...aus].sort();
}

describe('die Beschriftungen der internen Huelle', () => {
  it('kennt jeden Schluessel der Register — in jeder der zwei Sprachen', () => {
    const erwartet = registerSchluessel();
    /* Der Gegen-Check: die Register sind nicht leer, sonst prueft das nichts. */
    expect(erwartet.length).toBeGreaterThan(40);

    for (const sprache of INTERN_SPRACHEN) {
      const fehlend = erwartet.filter((s) => INTERN_BESCHRIFTUNGEN[sprache][s] === undefined);
      expect(fehlend, `${sprache}: ohne Beschriftung`).toEqual([]);
    }
  });

  it('traegt keinen Schluessel, den kein Register kennt', () => {
    const erlaubt = new Set(registerSchluessel());
    for (const sprache of INTERN_SPRACHEN) {
      const ueberzaehlig = Object.keys(INTERN_BESCHRIFTUNGEN[sprache])
        .filter((s) => !erlaubt.has(s));
      expect(ueberzaehlig, `${sprache}: zeigt auf nichts`).toEqual([]);
    }
  });

  it('haelt beide Sprachen auf derselben Schluesselmenge', () => {
    expect(Object.keys(INTERN_BESCHRIFTUNGEN.en).sort())
      .toEqual(Object.keys(INTERN_BESCHRIFTUNGEN.de).sort());
  });

  it('uebersetzt wirklich — Deutsch und Englisch stehen nicht ueberall gleich', () => {
    const gleich = Object.keys(INTERN_BESCHRIFTUNGEN.de)
      .filter((s) => INTERN_BESCHRIFTUNGEN.de[s] === INTERN_BESCHRIFTUNGEN.en[s]);
    /*
     * Einige stehen zu Recht gleich: Produktnamen und Fremdwoerter, die im
     * Deutschen schon englisch sind. Mehr als eine Handvoll hiesse, dass
     * jemand die deutsche Spalte kopiert hat.
     */
    expect(gleich.sort()).toEqual([
      'bank', 'crm', 'datev', 'leads', 'radar', 'recruiting', 'security',
      'sitzung.website',
    ]);
  });

  it('gibt jedem Label einen nicht-leeren Text', () => {
    for (const sprache of INTERN_SPRACHEN) {
      for (const [s, t] of Object.entries(INTERN_BESCHRIFTUNGEN[sprache])) {
        expect(t.trim(), `${sprache}.${s}`).not.toBe('');
      }
    }
  });
});

describe('die Abbildung der vier Portalsprachen auf die zwei internen', () => {
  it('nimmt Englisch als Englisch', () => {
    expect(internSprache('en')).toBe('en');
  });

  it('gibt ar und tr Deutsch, nicht Englisch (D-592)', () => {
    expect(internSprache('ar')).toBe('de');
    expect(internSprache('tr')).toBe('de');
  });

  it('gibt einer fehlenden Angabe Deutsch', () => {
    expect(internSprache(null)).toBe('de');
    expect(internSprache(undefined)).toBe('de');
  });

  it('bildet JEDE der vier Portalsprachen auf eine der zwei ab', () => {
    for (const s of PORTAL_SPRACHEN) {
      expect(istInternSprache(internSprache(s)), s).toBe(true);
    }
  });

  it('liefert fuer jede Portalsprache eine vollstaendige Karte', () => {
    for (const s of [...PORTAL_SPRACHEN, null]) {
      expect(Object.keys(internBeschriftungen(s)).length)
        .toBe(Object.keys(INTERN_BESCHRIFTUNGEN.de).length);
    }
  });
});

describe('die Sprachwahl des Umschalters', () => {
  it('meldet eine Wahl, die der Umschalter nicht anbietet, als fremd', () => {
    expect(internSprachwahl('tr')).toEqual({ aktiv: 'de', fremdeWahl: 'tr' });
    expect(internSprachwahl('ar')).toEqual({ aktiv: 'de', fremdeWahl: 'ar' });
  });

  it('meldet die zwei angebotenen Sprachen nicht als fremd', () => {
    expect(internSprachwahl('de')).toEqual({ aktiv: 'de', fremdeWahl: null });
    expect(internSprachwahl('en')).toEqual({ aktiv: 'en', fremdeWahl: null });
  });

  it('meldet fuer ein Konto ohne Angabe Deutsch und keine fremde Wahl', () => {
    expect(internSprachwahl(null)).toEqual({ aktiv: 'de', fremdeWahl: null });
  });
});
