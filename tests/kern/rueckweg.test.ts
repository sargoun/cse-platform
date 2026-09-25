import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/registry/routen';
import { rueckwegFuer, rueckwegRechte } from '../../src/server/registry/rueckweg';
import {
  BEKANNTE_RUECKZIELE, rueckzielName,
} from '../../src/lib/i18n/verwaltung/rueckziele';
import { pruefeTorAdressen } from './hilfen/tor-adresse';

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

/**
 * (6) **Genau EIN Rückweg je Seite** — die Sperrklinke gegen das Doppelte.
 *
 * Der Umbau auf die Ableitung hatte eine Folge, die zuerst niemand sah: 46
 * Seiten trugen ihren Rückweg weiterhin SELBST, im Inhalt, als
 * `<nav aria-label="Zurück">`. Die Hülle zeichnete daneben den abgeleiteten —
 * und auf jeder dieser Seiten standen plötzlich zwei Pfeile untereinander,
 * die dasselbe sagten. Ein doppelter Ausgang ist schlimmer als ein fehlender:
 * er lässt den Leser prüfen, ob die beiden dasselbe Ziel haben.
 *
 * Die Behebung war, sie alle in die Eigenschaft `zurueck` zu heben. Diese
 * Prüfung hält das fest: **`aria-label="Zurück"` gehört genau einer Datei** —
 * `components/portal/Zurueck.tsx`. Wer es woanders schreibt, baut den zweiten
 * Pfeil wieder ein.
 */
describe('(6) der Rückweg steht genau einmal — in der Hülle', () => {
  it('keine Portalseite zeichnet ihren eigenen Rückweg', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const alle: string[] = [];
    const gehe = (verzeichnis: string): void => {
      for (const eintrag of readdirSync(verzeichnis)) {
        const voll = join(verzeichnis, eintrag);
        if (statSync(voll).isDirectory()) gehe(voll);
        else if (voll.endsWith('.tsx')) alle.push(voll);
      }
    };
    gehe('src/app/portal');

    /*
     * Gesucht wird das ZUGAENGLICHKEITS-Etikett, nicht das Wort „Zurueck":
     * ein Knopf „Zurueck zur Liste" mitten im Inhalt ist etwas anderes als
     * ein zweiter Ausgang oben. `Zurueck.tsx` selbst traegt es zu Recht, und
     * es liegt nicht unter `src/app/`.
     */
    const traeger = alle.filter((d) => readFileSync(d, 'utf8').includes('aria-label="Zurück"'));
    expect(traeger).toEqual([]);
  });

  it('die Hülle zieht den Rückweg aus der Eigenschaft ODER aus der Ableitung', () => {
    const quelle = readFileSync('src/components/portal/PortalRahmen.tsx', 'utf8');
    /*
     * Die Reihenfolge ist die Aussage: `zurueck` schlaegt die Ableitung. Eine
     * Huelle, die BEIDE zeichnete, waere derselbe doppelte Pfeil — nur an
     * einer Stelle statt an 46.
     */
    expect(quelle).toMatch(/zurueck !== undefined \?\s*\(?\s*<Zurueck/u);
    expect(quelle).toMatch(/:\s*abgeleitet !== null &&\s*\(?\s*<Zurueck/u);
  });
});

/**
 * (7) **Das Tor bekommt die ADRESSE, nicht das Muster** (V-248).
 *
 * Fünfzehn Seiten riefen `portalZugang`/`mandantTor` mit dem Muster ihrer Route —
 * `/portal/${mandant}/agenten/[agent]/aufgaben/[id]` — statt mit der Adresse,
 * die aufgerufen wurde. Für die Wache war das gleich (ein `[…]` im Muster
 * passt auf alles), für alles, was das Tor daraus BAUT, nicht: der
 * abgeleitete Rückweg zeigte wörtlich auf `…/agenten/[agent]/aufgaben`, und
 * genauso wären der Sprung nach dem Bereichswechsel und das `weiter=` nach
 * der Zwei-Faktor-Anmeldung auf einer Adresse mit eckigen Klammern gelandet.
 * Gefunden hat es der Verweislauf der Browsersuite (`verweise.spec.ts`,
 * leitung und admin · reinigung: 404).
 */
describe('(7) das Tor bekommt die Adresse, nicht das Muster', () => {
  it('aus einem Muster wird kein Rückweg — ein Pfeil auf „[agent]" wäre ein 404', () => {
    expect(rueckwegFuer('/portal/reinigung/agenten/[agent]/aufgaben/[id]')).toBeNull();
    expect(rueckwegFuer('/portal/reinigung/agenten/[agent]/protokoll')).toBeNull();
    expect(rueckwegFuer('/portal/reinigung/finanzen/zahlungen/[id]')).toBeNull();
  });

  it('aus der echten Adresse wird der echte Vorfahr', () => {
    const lauf = rueckwegFuer(
      '/portal/reinigung/agenten/akquise/aufgaben/a1b2c3d4-0000-0000-0000-000000000000');
    expect(lauf?.ziel).toBe('/portal/reinigung/agenten/akquise/aufgaben');
    expect(lauf?.muster).toBe('/portal/[mandant]/agenten/[agent]/aufgaben');

    const protokoll = rueckwegFuer('/portal/reinigung/agenten/akquise/protokoll');
    expect(protokoll?.ziel).toBe('/portal/reinigung/agenten/akquise');
  });

  it('keine Seite ruft das Tor mit einem Muster-Segment', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const alle: string[] = [];
    const gehe = (verzeichnis: string): void => {
      for (const eintrag of readdirSync(verzeichnis)) {
        const voll = join(verzeichnis, eintrag);
        if (statSync(voll).isDirectory()) gehe(voll);
        else if (voll.endsWith('.tsx') || voll.endsWith('.ts')) alle.push(voll);
      }
    };
    gehe('src/app');

    /*
     * Die beiden Eingänge: `portalZugang` und `mandantTor` (der ruft
     * `portalZugang` mit demselben Pfad). Gesucht wird ein Literal als
     * erstes Argument, in dem ein Segment `[…]` steht — `${id}` ist die
     * Adresse, `[id]` das Muster.
     */
    const muster = /\b(?:portalZugang|mandantTor)\(\s*[`'"][^`'"]*\/\[[^\]/]+\]/u;
    const treffer = alle.filter((d) => muster.test(readFileSync(d, 'utf8')));
    expect(treffer).toEqual([]);
  });

  /*
   * **Alle fünf Eingänge, und durch Variablen hindurch** (V-255, D-747).
   *
   * Die Zeilensuche darüber erfasst nur `portalZugang`/`mandantTor` mit einem
   * Literal als erstem Argument. `meinPortal`, `kundePortal`, `gruppenTor`
   * und die 160 Aufrufe mit einer Variablen (`const pfad = …`) sah sie nicht.
   * Gäbe dort jemand ein Muster weiter, blendete `rueckwegFuer` den Pfeil
   * still aus — der Verweislauf fände nichts mehr —, aber Sprachumschalter,
   * Wechselblatt und `weiter=` bekämen das Muster trotzdem. Deshalb liest
   * diese Prüfung den Syntaxbaum (`hilfen/tor-adresse.ts`) und meldet auch,
   * was sie NICHT auflösen kann.
   */
  it('jedes der fünf Tore bekommt eine Adresse — auch über Variablen und Weiterreicher', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dateien: [string, string][] = [];
    const gehe = (verzeichnis: string): void => {
      for (const eintrag of readdirSync(verzeichnis)) {
        const voll = join(verzeichnis, eintrag);
        if (statSync(voll).isDirectory()) gehe(voll);
        else if (voll.endsWith('.tsx') || voll.endsWith('.ts')) {
          dateien.push([voll, readFileSync(voll, 'utf8')]);
        }
      }
    };
    gehe('src/app');

    const { befunde, aufrufe } = pruefeTorAdressen(dateien);
    // Die Prüfung sieht die Aufrufe überhaupt — sonst wäre „keine Befunde" billig.
    expect(aufrufe).toBeGreaterThan(300);
    expect(befunde.map((b) => `${b.datei}:${String(b.zeile)} ${b.art}: ${b.text}`)).toEqual([]);
  });

  it('die Gegenprobe: jeder Weg eines Musters ins Tor wird gefunden', () => {
    const art = (...dateien: [string, string][]): readonly string[] =>
      pruefeTorAdressen(dateien).befunde.map((b) => `${b.datei} ${b.art}`);

    // Ein Literal an jedem der drei Eingänge, die die Zeilensuche nicht kannte.
    expect(art(['a.tsx', `meinPortal('/portal/mein/schichten/[zuordnungId]/wachbuch', lade);`]))
      .toEqual(['a.tsx muster']);
    expect(art(['a.tsx', 'kundePortal(`/portal/kunde/rechnungen/[id]`, lade);']))
      .toEqual(['a.tsx muster']);
    expect(art(['a.tsx', `gruppenTor(offen ? '/portal/gruppe/a' : '/portal/gruppe/[x]');`]))
      .toEqual(['a.tsx muster']);

    // Durch eine Variable hindurch.
    expect(art(['a.tsx', [
      'export default async function S({ params }) {',
      '  const { mandant, id } = await params;',
      '  const pfad = `/portal/${mandant}/agenten/[agent]/aufgaben/${id}`;',
      '  return portalZugang(pfad);',
      '}',
    ].join('\n')])).toEqual(['a.tsx muster']);

    // Über einen Weiterreicher, der den Pfad nur einsetzt — gemeldet am Aufrufer.
    expect(art(
      ['rahmen.tsx', [
        'export async function Rahmen({ mandant, unterpfad }) {',
        '  const pfad = `/portal/${mandant}/recruiting/${unterpfad}`;',
        '  return mandantTor(pfad, mandant);',
        '}',
      ].join('\n')],
      ['seite.tsx', 'const x = <Rahmen mandant={m} unterpfad={`stellen/[id]`} />;'],
    )).toEqual(['seite.tsx muster']);

    // Jeder eingesetzte Parameter wird bis zu seinen Aufrufern verfolgt — ein Wert
    // aus der Anfrage ist dort ein Wert, ein Literal mit `[…]` ein Muster.
    const blatt: [string, string] = ['blatt.tsx',
      'export async function Blatt({ ziel }) { return gruppenTor(`/portal/gruppe/${ziel}`); }'];
    expect(art(blatt, ['seite.tsx', 'const x = <Blatt ziel="berichte/[bericht]" />;']))
      .toEqual(['seite.tsx muster']);
    expect(art(blatt, ['seite.tsx', [
      'export default async function S({ params }) {',
      '  const { bericht } = await params;',
      '  return <Blatt ziel={bericht} />;',
      '}',
    ].join('\n')])).toEqual([]);

    // Was sich nicht auflösen lässt, wird gemeldet und nicht übergangen.
    expect(art(['a.tsx', 'mandantTor(pfadFuer(id), mandant);'])).toEqual(['a.tsx unpruefbar']);
    expect(art(['a.tsx', 'for (const pfad of SEITEN) await portalZugang(pfad);']))
      .toEqual(['a.tsx unpruefbar']);

    // Und die Adresse selbst ist kein Befund — auch nicht ihre Weitergabe im Tor.
    expect(art(
      ['a.tsx', 'mandantTor(`/portal/${mandant}/objekte/${id}`, mandant);'],
      ['b.tsx', 'export async function meinPortal(pfad, laden) { return portalZugang(pfad); }'],
      ['c.tsx', `const pfad = '/portal/mein/zeiten'; meinPortal(pfad, lade);`],
    )).toEqual([]);
  });
});
