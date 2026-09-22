import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/registry/routen';
import { rueckwegFuer, rueckwegRechte } from '../../src/server/registry/rueckweg';
import {
  BEKANNTE_RUECKZIELE, rueckzielName,
} from '../../src/lib/i18n/verwaltung/rueckziele';

/**
 * Der Rückweg — abgeleitet statt geschrieben (DESIGN §5, D-613, V-108).
 *
 * **Was diese Datei festhält.** Der Mandant hat den Fehler selbst gefunden:
 * er klickte in der Beschäftigungsliste auf eine Person und stand auf einem
 * Blatt ohne Ausgang. Gemessen: von 311 Seiten unter `/portal/[mandant]`
 * trugen **zwei** einen Rückweg.
 *
 * Die Behebung ist eine Ableitung und keine Sammelbearbeitung — also muss die
 * Ableitung geprüft werden, und zwar an allen Routen, nicht an einer
 * Stichprobe. Eine Ableitung, die für 250 Adressen stimmt und für sechs auf
 * einen 404 zeigt, ist schlechter als keine: sechs Pfeile, die ins Leere
 * führen, verraten nach AUT-06 die Existenz dessen, was sie nicht zeigen.
 */

const beispiel = (muster: string): string =>
  muster.replace('[mandant]', 'reinigung')
    .replace(/\[[^\]]+\]/gu, 'a1b2c3d4-0000-0000-0000-000000000000');

const MANDANT = ROUTEN.filter((r) => r.pfad.startsWith('/portal/[mandant]'));

describe('(1) jedes Ziel ist eine Adresse, die es WIRKLICH gibt', () => {
  it('kein abgeleiteter Rückweg zeigt auf eine Route, die das Register nicht kennt', () => {
    /*
     * Der teuerste Fehlschlag dieser Ableitung waere ein Pfeil auf einen 404.
     * Geprueft wird deshalb gegen das MUSTER im Register, nicht gegen eine
     * Zeichenkette.
     */
    const muster = new Set(ROUTEN.map((r) => r.pfad));
    const fehler: string[] = [];
    for (const r of MANDANT) {
      const z = rueckwegFuer(beispiel(r.pfad));
      if (z === null) continue;
      if (!muster.has(z.muster)) fehler.push(`${r.pfad} -> ${z.muster}`);
    }
    expect(fehler).toEqual([]);
  });

  it('das Ziel ist immer ein echter VORFAHR, nie die Seite selbst', () => {
    const fehler: string[] = [];
    for (const r of MANDANT) {
      const pfad = beispiel(r.pfad);
      const z = rueckwegFuer(pfad);
      if (z === null) continue;
      if (!pfad.startsWith(`${z.ziel}/`)) fehler.push(`${pfad} -> ${z.ziel}`);
    }
    expect(fehler).toEqual([]);
  });
});

describe('(2) jedes Ziel hat einen NAMEN, kein „Zurück"', () => {
  it('kein abgeleitetes Segment fällt auf die Rückfallbeschriftung', () => {
    /*
     * DESIGN §5: „Was dort steht, aus Sicht des ZIELS: „Alle Anstellungen",
     * nicht „Zurueck"." Die Rueckfallbeschriftung existiert, damit ein morgen
     * hinzukommendes Segment einen Rueckweg bekommt statt keinen — gebraucht
     * werden darf sie nie.
     */
    const fehlend = new Set<string>();
    for (const r of MANDANT) {
      const z = rueckwegFuer(beispiel(r.pfad));
      if (z === null || z.segment.startsWith('[')) continue;
      if (!BEKANNTE_RUECKZIELE.has(z.segment)) fehlend.add(z.segment);
    }
    expect([...fehlend]).toEqual([]);
  });

  it('ein Datensatz-Ziel heisst „Übersicht", kein erfundener Name', () => {
    expect(rueckzielName('[id]', 'de')).toBe('Übersicht');
    expect(rueckzielName('[aufmassId]', 'en')).toBe('Overview');
  });

  it('und jede Beschriftung gibt es in BEIDEN Sprachen', () => {
    const leer: string[] = [];
    for (const s of BEKANNTE_RUECKZIELE) {
      for (const sp of ['de', 'en'] as const) {
        if (rueckzielName(s, sp).trim() === '') leer.push(`${s}/${sp}`);
      }
    }
    expect(leer).toEqual([]);
  });
});

describe('(3) wo KEINER hingehört, steht auch keiner', () => {
  it('die Portalwurzel und die Modulwurzeln tragen keinen', () => {
    expect(rueckwegFuer('/portal/reinigung')).toBeNull();
    expect(rueckwegFuer('/portal/reinigung/objekte')).toBeNull();
    expect(rueckwegFuer('/portal')).toBeNull();
    expect(rueckwegFuer('/')).toBeNull();
  });

  it('eine Adresse ausserhalb des Portals bekommt keinen', () => {
    expect(rueckwegFuer('/unternehmen/reinigung')).toBeNull();
    expect(rueckwegFuer('/auth/login')).toBeNull();
  });
});

describe('(4) die beiden Fälle aus dem Befund des Mandanten', () => {
  it('von der Person zurück zur Beschäftigungsliste', () => {
    const z = rueckwegFuer('/portal/reinigung/personal/anstellungen/abc-123');
    expect(z?.ziel).toBe('/portal/reinigung/personal/anstellungen');
    expect(z === undefined || z === null ? '' : rueckzielName(z.segment, 'de'))
      .toBe('Beschäftigungen');
  });

  it('vom Stundenkonto zurück auf die Person', () => {
    const z = rueckwegFuer('/portal/reinigung/personal/anstellungen/abc-123/stundenkonto');
    expect(z?.ziel).toBe('/portal/reinigung/personal/anstellungen/abc-123');
    expect(z === undefined || z === null ? '' : rueckzielName(z.segment, 'de'))
      .toBe('Übersicht');
  });
});

describe('(5) die Rechte des Ziels sind abfragbar (AUT-06)', () => {
  it('ein Ziel mit Rechtebewachung nennt seine Leserechte', () => {
    const z = rueckwegFuer('/portal/reinigung/personal/anstellungen/abc-123');
    expect(z).not.toBeNull();
    /*
     * Die Zahl selbst ist nicht der Punkt — der Punkt ist, dass die Liste aus
     * dem Register kommt und nicht leer ist. Waere sie immer leer, pruefte
     * das Tor nichts und der Pfeil stuende ueberall.
     */
    expect(rueckwegRechte(z?.muster ?? '').length).toBeGreaterThan(0);
  });

  it('jede Rechteliste nennt nur Schlüssel, die das Register kennt', () => {
    const schluessel = new Set(
      ROUTEN.flatMap((r) => (r.bewachung.art === 'recht' ? r.bewachung.lesen : [])),
    );
    const fremd: string[] = [];
    for (const r of MANDANT) {
      const z = rueckwegFuer(beispiel(r.pfad));
      if (z === null) continue;
      for (const s of rueckwegRechte(z.muster)) if (!schluessel.has(s)) fremd.push(s);
    }
    expect(fremd).toEqual([]);
  });
});
