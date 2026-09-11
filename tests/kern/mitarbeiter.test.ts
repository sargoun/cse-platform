/**
 * PR 39 ohne Datenbank — die Haelften der Zusagen, die Aussagen ueber den
 * CODE sind und nicht ueber Zeilen.
 *
 * Die Datenbankhaelften stehen in `tests/isolation/mitarbeiter.test.ts`. Hier
 * steht, was sich am Baum selbst pruefen laesst: dass es keine Route gibt, die
 * einen Zeiteintrag aendert (EMP-07); dass die Nutzlasten des Portals kein
 * Feld fuehren, das nach Geld klingt (K-05); dass jede Seite der Seitenkarte
 * wirklich existiert; und dass die Wache gegen ihre eigenen Falschtreffer
 * geprueft ist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTEN as API_ROUTEN } from '../../src/server/auth/route-manifest.js';
import { ROUTEN, findeRoute } from '../../src/server/registry/routen.js';
import { DIENSTE } from '../../src/server/registry/dienste.js';
import { tableiste } from '../../src/server/registry/tableiste.js';
import {
  GELD_WOERTER, MITARBEITER_NUTZLASTEN, feldWoerter, istVerbotenesFeld,
} from '../../src/server/services/mitarbeiter/felder.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MEIN = join(WURZEL, 'src/app/portal/mein');

/**
 * Kommentare raus — eine ERWAEHNUNG ist kein Aufruf.
 *
 * Die Docblocks dieser Seiten erklaeren ausdruecklich, dass
 * `korrigiereZeiteintrag` die Korrektur schreibt und nicht das Portal. Eine
 * Wache, die ihre eigene Begruendung als Verstoss meldet, wird abgeschaltet.
 */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1'))
    .join('\n');
}

function dateien(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...dateien(voll));
    else if (/\.tsx?$/u.test(e)) treffer.push(voll);
  }
  return treffer;
}

// ---------------------------------------------------------------------------

describe('(2) es gibt keinen Weg, der einen Zeiteintrag aendert (EMP-07)', () => {
  it('keine API-Route traegt einen Zeiteintrag im Pfad', () => {
    /**
     * EMP-07 als Eigenschaft der ADRESSLISTE: was es nicht gibt, ruft auch
     * niemand versehentlich auf. `api/zeit/einwand` und
     * `api/zeit/einwand/entscheidung` sind die zwei Wege, die EMP-07 kennt.
     */
    const verdaechtig = API_ROUTEN
      .map((r) => r.pfad)
      .filter((p) => /^api\/(?:mein\/)?zeit(?:eintrag|\/eintrag|en)/u.test(p));
    expect(verdaechtig).toEqual([]);
  });

  it('das Mitarbeiterportal hat genau DREI eigene Schreibrouten, und keine davon ist Zeit', () => {
    /**
     * Die Liste ist die Zusage, nicht ihre Laenge: jede Adresse unter
     * `api/mein/` steht hier namentlich, und eine vierte faellt auf, bevor
     * jemand sie benutzt. PR 42 hat die dritte gebracht — die Kenntnisnahme
     * einer Dienstanweisung (EMP-09) —, und sie ist so wenig eine Zeitroute
     * wie die beiden anderen.
     */
    const meine = API_ROUTEN.filter((r) => r.pfad.startsWith('api/mein/'));
    expect(meine.map((r) => r.pfad).sort())
      .toEqual([
        'api/mein/abwesenheit',
        'api/mein/antraege',
        'api/mein/dienstanweisungen/[id]/kenntnisnahme',
      ]);
  });

  it('die Kenntnisnahme ist Selbstzugriff — ohne Recht, aber mit einem Grund', () => {
    const k = API_ROUTEN.find(
      (r) => r.pfad === 'api/mein/dienstanweisungen/[id]/kenntnisnahme');
    expect(k?.recht).toBeNull();
    // Der Grund ist die Stelle, an der jemand die Entscheidung nachlesen kann.
    expect((k?.grund ?? '').length).toBeGreaterThan(40);
    expect(k?.grund).toContain('EMP-09');
  });

  it('das Einreichen ist Selbstzugriff — ohne Recht, aber mit einem Grund', () => {
    const antrag = API_ROUTEN.find((r) => r.pfad === 'api/mein/antraege');
    expect(antrag?.recht).toBeNull();
    // Der Grund ist die Stelle, an der jemand die Entscheidung nachlesen kann.
    expect((antrag?.grund ?? '').length).toBeGreaterThan(40);
    expect(antrag?.grund).toContain('EMP-10');
  });

  it('die Abwesenheitsmeldung verlangt `zeit.abwesenheit_melden` und ruft `authorize`', () => {
    const abw = API_ROUTEN.find((r) => r.pfad === 'api/mein/abwesenheit');
    expect(abw?.recht).toBe('zeit.abwesenheit_melden');
    const quelle = readFileSync(
      join(WURZEL, 'src/app/api/mein/abwesenheit/route.ts'), 'utf8');
    expect(quelle).toMatch(/\bauthorize\s*\(/u);
    expect(quelle).toContain('zeit.abwesenheit_melden');
  });

  it('unter `/portal/mein/zeiten` steht GENAU EIN Formular — der Einwand', () => {
    const mitFormular = dateien(join(MEIN, 'zeiten'))
      .filter((d) => /<form/u.test(readFileSync(d, 'utf8')))
      .map((d) => d.replace(`${MEIN}/`, ''));
    expect(mitFormular).toEqual(['zeiten/[id]/einwand/page.tsx']);
  });

  it('und dieses Formular zeigt auf die vorhandene Einwandroute, nicht auf eine zweite', () => {
    const quelle = readFileSync(
      join(MEIN, 'zeiten/[id]/einwand/page.tsx'), 'utf8');
    expect(quelle).toContain('action="/api/zeit/einwand"');
  });

  it('keine Seite unter `/portal/mein` ruft eine Schreibfunktion der Zeitdomaene', () => {
    const verdaechtig: string[] = [];
    for (const d of dateien(MEIN)) {
      const inhalt = ohneKommentare(readFileSync(d, 'utf8'));
      // Der Einwand ist der einzige erlaubte Import aus dieser Familie, und er
      // wird in der SEITE nur gelesen (`listeEigeneEinwaende`).
      if (/\b(korrigiereZeiteintrag|beendeZeiteintrag|starteZeiteintrag|entscheideEinwand)\b/u
        .test(inhalt)) {
        verdaechtig.push(d.replace(`${WURZEL}/`, ''));
      }
    }
    expect(verdaechtig).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('(4) die Feldwache kennt ihre eigenen Falschtreffer (K-05)', () => {
  it('erkennt ein Entgeltfeld, auch mit harmlosem Namen', () => {
    for (const name of [
      'stundensatz', 'stundensatzIntern', 'satz', 'tarifgruppe', 'entgeltCent',
      'preis', 'einzelpreisCent', 'betragCent', 'nettoCent', 'kundeId',
      'rechnungsnummer', 'marge', 'kondition',
    ]) {
      expect(istVerbotenesFeld(name), name).toBe(true);
    }
  });

  it('und laesst die deutschen Fachwoerter durch, die „satz" enthalten', () => {
    /**
     * Der Grund, aus dem die Wache Woerter vergleicht und keine Teilketten:
     * `einsatz`, `zusatz` und `ansatz` sind vier Falschtreffer, und eine
     * Wache mit Falschtreffern wird abgeschaltet.
     */
    for (const name of [
      'einsatzId', 'einsatzStatus', 'blockiertEinsatz', 'zusatzTage',
      'rechenansatz', 'nettoMinuten', 'bruttoMinuten', 'anteilNettoMinuten',
      'pauseMinuten', 'zeitabweichungBeginnSek', 'sollMinuten',
    ]) {
      expect(istVerbotenesFeld(name), name).toBe(false);
    }
  });

  it('zerlegt Binnengrossschreibung und Unterstriche gleich', () => {
    expect(feldWoerter('anteilBruttoMinuten')).toEqual(['anteil', 'brutto', 'minuten']);
    expect(feldWoerter('anteil_brutto_minuten')).toEqual(['anteil', 'brutto', 'minuten']);
  });

  it('`netto` ohne Zeiteinheit ist verboten, mit Zeiteinheit erlaubt', () => {
    // Die eine Regel, an der die Wache haengt: eine Schicht hat netto und
    // brutto in MINUTEN, eine Rechnung in Cent.
    expect(istVerbotenesFeld('nettoBetrag')).toBe(true);
    expect(istVerbotenesFeld('netto')).toBe(true);
    expect(istVerbotenesFeld('nettoMinuten')).toBe(false);
  });

  it('jede festgeschriebene Feldliste ist selbst sauber', () => {
    const verdaechtig: string[] = [];
    for (const [name, felder] of Object.entries(MITARBEITER_NUTZLASTEN)) {
      expect(felder.length, name).toBeGreaterThan(0);
      expect(new Set(felder).size, `${name} hat doppelte Felder`).toBe(felder.length);
      for (const f of felder) if (istVerbotenesFeld(f)) verdaechtig.push(`${name}.${f}`);
    }
    expect(verdaechtig).toEqual([]);
  });

  it('die Wortliste ist nicht leer — sonst bestuende die Probe ueber nichts', () => {
    expect(GELD_WOERTER.length).toBeGreaterThan(5);
    expect(GELD_WOERTER).toContain('stundensatz');
  });
});

// ---------------------------------------------------------------------------

describe('die Seiten der Seitenkarte gibt es wirklich', () => {
  /** Die Routen, die dieser PR baut — Pfad fuer Pfad aus §7. */
  const GEBAUT: readonly string[] = [
    '/portal/mein',
    '/portal/mein/schichten',
    '/portal/mein/schichten/[zuordnungId]',
    '/portal/mein/zeiten',
    '/portal/mein/zeiten/[id]',
    '/portal/mein/zeiten/[id]/einwand',
    '/portal/mein/stundenkonto',
    '/portal/mein/monatsnachweis',
    '/portal/mein/urlaub',
    '/portal/mein/antraege',
    '/portal/mein/antraege/neu',
    '/portal/mein/abwesenheit/neu',
    '/portal/mein/nachweise',
    '/portal/mein/dienstanweisungen',
    '/portal/mein/dienstanweisungen/[id]',
  ];

  it('jede gebaute Route steht in der Seitenkarte', () => {
    const fehlend = GEBAUT.filter((p) => !ROUTEN.some((r) => r.pfad === p));
    expect(fehlend).toEqual([]);
  });

  it('und jede hat eine Seitendatei im App-Router-Baum', () => {
    const vorhanden = new Set(
      dateien(MEIN)
        .filter((d) => d.endsWith('page.tsx'))
        .map((d) => `/portal/mein${d.slice(MEIN.length).replace(/\/page\.tsx$/u, '')}`)
        .map((p) => (p === '/portal/mein' ? p : p)),
    );
    const fehlend = GEBAUT.filter((p) => !vorhanden.has(p));
    expect(fehlend).toEqual([]);
  });

  it('jede gebaute Route ist Selbstzugriff oder das eine Meldungsrecht', () => {
    for (const p of GEBAUT) {
      const r = findeRoute(p);
      expect(r, p).toBeDefined();
      const bewachung = r!.bewachung;
      if (bewachung.art === 'recht') {
        // Genau eine Ausnahme, und sie steht in §7: die Abwesenheitsmeldung.
        expect(bewachung.lesen, p).toEqual(['zeit.abwesenheit_melden']);
      } else {
        expect(bewachung.art, p).toBe('selbst');
      }
    }
  });

  it('der Scope jeder gebauten Route ist PER oder PER→M1 — nie M1 und nie GRP', () => {
    for (const p of GEBAUT) {
      const r = findeRoute(p);
      expect(['PER', 'PER→M1'], `${p}: ${r?.scope ?? '—'}`).toContain(r?.scope);
    }
  });

  it('die Tab-Leiste des Portals fuehrt fuenf Ziele, und alle fuehren irgendwohin', () => {
    const leiste = tableiste('mitarbeiter');
    expect(leiste.ziele).toHaveLength(5);
    for (const z of leiste.ziele) {
      const ziel = z.pfad.startsWith('/')
        ? z.pfad
        : (z.pfad === '' ? '/portal/mein' : `/portal/mein/${z.pfad}`);
      // Ein Menuepunkt, der auf 404 fuehrt, ist schlechter als keiner.
      expect(findeRoute(ziel), ziel).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------

describe('das Dienstregister kennt die Dienste des Portals', () => {
  it('jeder Dienst unter `mitarbeiter/` ist eingetragen', () => {
    const imBaum = readdirSync(join(WURZEL, 'src/server/services/mitarbeiter'))
      .filter((d) => d.endsWith('.ts'))
      .map((d) => `mitarbeiter/${d.replace(/\.ts$/u, '')}`);
    const bekannt = new Set(DIENSTE.map((d) => d.pfad));
    expect(imBaum.filter((p) => !bekannt.has(p))).toEqual([]);
  });

  it('und KEINER davon schreibt', () => {
    /**
     * Die Zusage von EMP-07 und K-18 als Eigenschaft des Registers: die
     * Schreibwege des Menschen sind der Einwand, der Antrag und die
     * Abwesenheitsmeldung — alle drei in bereits eingetragenen Fachdiensten.
     * Ein vierter, im Portaldienst angelegter waere genau der, der an ihnen
     * vorbeifuehrt.
     */
    const schreibend = DIENSTE
      .filter((d) => d.pfad.startsWith('mitarbeiter/') && d.schreibend)
      .map((d) => d.pfad);
    expect(schreibend).toEqual([]);
  });
});
