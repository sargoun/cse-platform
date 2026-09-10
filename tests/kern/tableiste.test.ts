/**
 * Die Tab-Leisten (SEITENKARTE §11.2).
 *
 * Die Zusage ist eine Zahl: **genau fünf Ziele je Portal**. Sie steht im
 * Dokument, und ohne diese Datei stünde sie nur dort — eine sechste Zeile
 * fiele beim Bauen niemandem auf und auf einem Telefon jedem.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OHNE_MEHR, TABLEISTEN, leisteFuer, tabZiel, tableiste, type LeistenSchluessel,
} from '../../src/server/registry/tableiste.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { familie, findeRoute } from '../../src/server/registry/routen.js';

const WURZEL = resolve(import.meta.dirname, '../..');

const SCHLUESSEL: readonly LeistenSchluessel[] = [
  'intern_global', 'intern_admin', 'intern_leitung', 'mitarbeiter', 'kunde', 'gruppe',
];

describe('§11.2 — genau fünf Ziele je Portal', () => {
  it('alle sechs Leisten sind da', () => {
    expect(TABLEISTEN.map((l) => l.schluessel).sort()).toEqual([...SCHLUESSEL].sort());
  });

  for (const s of SCHLUESSEL) {
    it(`${s}: fünf, nicht vier und nicht sechs`, () => {
      expect(tableiste(s).ziele).toHaveLength(5);
    });
  }

  it('kein Ziel steht zweimal in derselben Leiste', () => {
    for (const l of TABLEISTEN) {
      const schluessel = l.ziele.map((z) => z.schluessel);
      expect(new Set(schluessel).size, l.schluessel).toBe(schluessel.length);
    }
  });

  it('jedes Ziel hat eine Beschriftung und ein Symbol', () => {
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        expect(z.label, `${l.schluessel}.${z.schluessel}`).not.toBe('');
        expect(z.symbol, `${l.schluessel}.${z.schluessel}`).not.toBe('');
      }
    }
  });
});

describe('die Arbeiter- und die Gruppenleiste tragen KEIN `Mehr`', () => {
  it('so wie §11.2 es sagt', () => {
    /**
     * "Ein sechstes Ziel hinter einem Menü ist ein Ziel, das eine Arbeiterin
     * im Treppenhaus nicht findet." Die Zusage ist die Abwesenheit des
     * Menüpunkts — und Abwesenheit prüft man, sonst kehrt sie zurück.
     */
    for (const s of OHNE_MEHR) {
      expect(tableiste(s).ziele.map((z) => z.schluessel), s).not.toContain('mehr');
    }
  });

  it('die drei internen Leisten dagegen schon', () => {
    for (const s of ['intern_global', 'intern_admin', 'intern_leitung'] as const) {
      expect(tableiste(s).ziele.at(-1)?.schluessel, s).toBe('mehr');
    }
  });
});

describe('jedes Recht einer Leiste gibt es im Katalog (K-19)', () => {
  const bekannt = new Set(KATALOG.map((k) => k.schluessel));

  it('sonst wäre das Ziel für jede Rolle unsichtbar', () => {
    const fehlend: string[] = [];
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        if (z.recht !== null && !bekannt.has(z.recht)) {
          fehlend.push(`${l.schluessel}.${z.schluessel} → ${z.recht}`);
        }
      }
    }
    // `app.hat_recht` antwortet auf einen unbekannten Schlüssel `false`: das
    // Ziel erschiene nie, und niemand sähe warum.
    expect(fehlend).toEqual([]);
  });
});

describe('jedes Ziel führt auf eine Route, die es in der Karte gibt', () => {
  const wurzel: Readonly<Record<LeistenSchluessel, string>> = {
    intern_global: '/portal/reinigung',
    intern_admin: '/portal/reinigung',
    intern_leitung: '/portal/reinigung',
    mitarbeiter: '/portal/mein',
    kunde: '/portal/kunde',
    gruppe: '/portal/gruppe',
  };

  it('kein Tab zeigt auf eine Adresse, die das Tor nicht kennt', () => {
    const tot: string[] = [];
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        if (z.schluessel === 'mehr') continue;
        const ziel = tabZiel(wurzel[l.schluessel], z);
        if (findeRoute(ziel) === undefined) tot.push(`${l.schluessel}.${z.schluessel} → ${ziel}`);
      }
    }
    /**
     * Ein Tab, der ins Leere führt, ist schlimmer als kein Tab: er ist ein
     * sichtbares Versprechen, das beim Antippen 404 gibt — und zwar auf dem
     * Gerät, auf dem am wenigsten Geduld da ist.
     */
    expect(tot).toEqual([]);
  });

  /**
   * Die zweite Haelfte derselben Frage — und die WICHTIGERE.
   *
   * Die Pruefung darueber fragt das Manifest. Das Manifest ist ein Dokument;
   * ausgeliefert wird, was im App-Router liegt. Ein Ziel kann im Manifest
   * stehen, das Tor passieren und trotzdem 404 geben, weil es keine
   * `page.tsx` gibt, die es bedient — genau das war der Zustand: `auftraege`,
   * `dienstplan/woche` und `finanzen` standen in der Karte und in der Leiste,
   * eine Seite hatte keines von ihnen.
   *
   * Geprueft wird deshalb gegen das DATEISYSTEM: fuer jedes Ziel muss es
   * entweder eine genaue Seite geben oder einen Catch-all, der es abdeckt.
   */
  const APP = join(WURZEL, 'src/app');

  /** Die Segmente aller `page.tsx` unter `src/app/portal`, ohne Gruppenordner. */
  function seitenMuster(verzeichnis: string, praefix: readonly string[] = []):
  readonly (readonly string[])[] {
    const treffer: (readonly string[])[] = [];
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (statSync(voll).isDirectory()) {
        // `(gruppe)` ist ein Routengruppen-Ordner und erscheint nicht in der URL.
        const teil = /^\(.*\)$/u.test(eintrag) ? praefix : [...praefix, eintrag];
        treffer.push(...seitenMuster(voll, teil));
      } else if (eintrag === 'page.tsx' || eintrag === 'page.ts') {
        treffer.push(praefix);
      }
    }
    return treffer;
  }

  /** Bedient dieses Seitenmuster diese konkrete URL? */
  function bedient(muster: readonly string[], url: readonly string[]): boolean {
    for (let i = 0; i < muster.length; i += 1) {
      const m = muster[i]!;
      // `[[...rest]]` und `[...rest]` schlucken den Rest — der optionale auch nichts.
      if (/^\[\[\.\.\..+\]\]$/u.test(m)) return true;
      if (/^\[\.\.\..+\]$/u.test(m)) return url.length > i;
      if (url[i] === undefined) return false;
      if (/^\[.+\]$/u.test(m)) continue;
      if (m !== url[i]) return false;
    }
    return muster.length === url.length;
  }

  it('und jedes Ziel wird von einer ECHTEN Seite bedient, nicht nur vom Manifest', () => {
    const muster = seitenMuster(APP);
    const ohneSeite: string[] = [];
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        if (z.schluessel === 'mehr') continue;
        const ziel = tabZiel(wurzel[l.schluessel], z);
        const url = ziel.split('/').filter((t) => t !== '');
        if (!muster.some((m) => bedient(m, url))) {
          ohneSeite.push(`${l.schluessel}.${z.schluessel} → ${ziel}`);
        }
      }
    }
    expect(ohneSeite, 'Ein Tab ohne Seite ist ein sichtbares Versprechen auf 404')
      .toEqual([]);
  });

  it('und die Pruefung ist scharf — ein erfundenes Ziel faellt durch', () => {
    // Ohne diese Zeile bestuende die Pruefung auch dann, wenn `bedient`
    // versehentlich alles bejaht.
    const muster = seitenMuster(APP);
    expect(muster.some((m) => bedient(m, ['nicht', 'im', 'portal']))).toBe(false);
  });

  it('und jedes Ziel liegt in der Familie seiner Leiste', () => {
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        if (z.schluessel === 'mehr') continue;
        const ziel = tabZiel(wurzel[l.schluessel], z);
        /**
         * Ein Kundentab, der in das interne Portal zeigt, wäre die K-04-Decke
         * von innen ausgehebelt — durch die Navigation. `konto` ist die eine
         * Ausnahme: es liest die eigenen Zeilen über `benutzer_id` und ist
         * aus jedem Portal erlaubt (§1.3 `USR`).
         */
        expect(['konto', l.familie], `${l.schluessel}.${z.schluessel} → ${ziel}`)
          .toContain(familie(ziel));
      }
    }
  });
});

describe('welche Leiste eine Sitzung bekommt', () => {
  it('nach Portal UND Rolle — admin und leitung sind nicht dasselbe', () => {
    expect(leisteFuer('intern', 'mandant', 'admin')).toBe('intern_admin');
    expect(leisteFuer('intern', 'mandant', 'leitung')).toBe('intern_leitung');
    expect(leisteFuer('intern', 'mandant', 'super_admin')).toBe('intern_global');
    // Der Unterschied ist nicht kosmetisch: `admin` bekommt Freigaben,
    // `leitung` die Zeiterfassung.
    expect(tableiste('intern_admin').ziele[3]?.schluessel).toBe('freigaben');
    expect(tableiste('intern_leitung').ziele[2]?.schluessel).toBe('zeiten');
  });

  it('die Gruppenansicht schlägt das Portal — sie ist ein eigener Scope', () => {
    expect(leisteFuer('intern', 'gruppe', 'admin')).toBe('gruppe');
  });

  it('Arbeiter und Kunde bekommen ihre eigene, unabhängig von der Rolle', () => {
    expect(leisteFuer('mitarbeiter', 'person', null)).toBe('mitarbeiter');
    expect(leisteFuer('kunde', 'kunde', null)).toBe('kunde');
  });
});
