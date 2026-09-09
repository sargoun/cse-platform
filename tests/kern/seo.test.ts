/**
 * PR 16 Akzeptanz (4) — Sitemap, `llms.txt` und der kanonische Host.
 *
 * Die Pruefungen hier fassen die Quellen an, nicht die ausgelieferten Dateien:
 * `tests/e2e/seo.spec.ts` holt `/sitemap.xml`, `/robots.txt` und `/llms.txt`
 * am laufenden Server ab. Beides zusammen — sonst prueft man entweder eine
 * Funktion, die niemand aufruft, oder eine Datei, deren Zustandekommen
 * niemand kennt.
 */
import { describe, expect, it } from 'vitest';
import { AUSGESCHLOSSEN, istAusgeschlossen, sitemapEintraege }
  from '../../src/server/services/inhalt/sitemap.js';
import { llmsTxt } from '../../src/server/services/inhalt/llms.js';
import { kanonischeBasis, istKanonischEntschieden, KeinHostFehler }
  from '../../src/lib/domains.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

const NAP = {
  firma: 'CSE Dienstleistungen GmbH', strasse: 'Kurfürstendamm 21', plz: '10719',
  ort: 'Berlin', land: 'DE', telefon: '+49 30 555 0100', email: 'kontakt@cse.test',
};

describe('(4) die Sitemap nennt veröffentlichte Seiten und schliesst /dev/* aus', () => {
  const zeilen = [
    { pfad: '/', geaendert: new Date('2026-01-01T00:00:00Z') },
    { pfad: '/kontakt', geaendert: new Date('2026-01-02T00:00:00Z') },
    { pfad: '/dev/website', geaendert: new Date('2026-01-03T00:00:00Z') },
    { pfad: '/portal/reinigung', geaendert: new Date('2026-01-04T00:00:00Z') },
  ];
  const db = { unsafe: async () => zeilen };

  it('die Entwicklungsfläche steht NICHT drin', async () => {
    const eintraege = await sitemapEintraege(db);
    expect(eintraege.map((e) => e.pfad)).toEqual(['/', '/kontakt']);
  });

  it('und der Ausschluss trifft den Pfad SELBST, nicht nur seine Kinder', () => {
    // `/dev` ohne Schrägstrich wäre sonst durchgerutscht, und genau so wird
    // eine Übersichtsseite versehentlich indexiert.
    expect(istAusgeschlossen('/dev')).toBe(true);
    expect(istAusgeschlossen('/dev/website')).toBe(true);
    // Ein Pfad, der nur SO ANFÄNGT, ist ein anderer Pfad.
    expect(istAusgeschlossen('/development')).toBe(false);
    expect(istAusgeschlossen('/kontakt')).toBe(false);
  });

  it('robots.txt und Sitemap filtern nach DERSELBEN Liste', () => {
    for (const p of AUSGESCHLOSSEN) expect(istAusgeschlossen(`${p}/x`)).toBe(true);
    expect(AUSGESCHLOSSEN).toContain('/dev');
  });
});

describe('llms.txt: EINE Schreibweise je Anschrift, und kein erfundenes Dach', () => {
  const bereiche = [
    { slug: 'reinigung', mandant: NAP, kurzbeschreibung: 'Gebäudereinigung' },
    {
      slug: 'security',
      mandant: { ...NAP, firma: 'Select-Security Event GmbH' },
      kurzbeschreibung: null,
    },
  ];

  it('der Kopf trägt den Auftrittsnamen der Gruppe, nicht die erste Gesellschaft', () => {
    const text = llmsTxt('CSE Gruppe', null, bereiche, [], 'https://beispiel.test');
    expect(text.startsWith('# CSE Gruppe')).toBe(true);
    // Ein Sprachmodell übernimmt genau solche Dateien als Fakten. "Die erste
    // GmbH ist die Gruppe" wäre keine Ungenauigkeit, sondern eine falsche
    // Aussage über die Firmenstruktur.
    expect(text).not.toContain('# CSE Dienstleistungen GmbH');
  });

  it('ohne gepflegten Rechtsträger steht KEINE Gruppenanschrift darin (O-206)', () => {
    const text = llmsTxt('CSE Gruppe', null, bereiche, [], 'https://beispiel.test');
    const kopf = text.split('## Gesellschaften')[0]!;
    expect(kopf).not.toContain('Kurfürstendamm');
  });

  it('jede Gesellschaft steht mit ZEICHENGLEICHER Anschrift', () => {
    const text = llmsTxt('CSE Gruppe', null, bereiche, [], 'https://beispiel.test');
    // Zwei Schreibweisen derselben Adresse sind für eine Suchmaschine zwei
    // Unternehmen, und die Autorität verteilt sich auf beide.
    const treffer = text.match(/Kurfürstendamm 21, 10719 Berlin/gu) ?? [];
    expect(treffer.length).toBe(bereiche.length);
  });

  it('eine unvollständige Anschrift bricht die Datei, statt sie halb auszuliefern', () => {
    expect(() => llmsTxt(
      'CSE Gruppe', null,
      [{ slug: 'x', mandant: { ...NAP, telefon: null }, kurzbeschreibung: null }],
      [], 'https://beispiel.test',
    )).toThrow();
  });
});

describe('O-08: der kanonische Host wird nicht geraten', () => {
  it('ohne Umgebungsvariable gilt der Host der Anfrage', () => {
    expect(kanonischeBasis('cse-gruppe.de', {})).toBe('https://cse-gruppe.de');
    expect(istKanonischEntschieden({})).toBe(false);
  });

  it('die Umgebung schlägt den Anfrage-Host', () => {
    const u = { CSE_KANONISCHE_BASIS: 'https://gewaehlt.de/' };
    expect(kanonischeBasis('etwas-anderes.de', u)).toBe('https://gewaehlt.de');
    expect(istKanonischEntschieden(u)).toBe(true);
  });

  it('localhost bekommt http — sonst zeigt jede Sitemap im Test auf https', () => {
    expect(kanonischeBasis('localhost:3000', {})).toBe('http://localhost:3000');
  });

  it('ohne beides wird NICHT geraten, sondern geworfen', () => {
    // Eine erfundene kanonische URL sagt der Suchmaschine, die echte Seite
    // stehe woanders — schlechter als gar keine Angabe.
    expect(() => kanonischeBasis(null, {})).toThrow(KeinHostFehler);
  });

  it('im Code steht keine geratene Domain', () => {
    const quelle = OEFFENTLICHE_ROUTEN.map((r) => r.pfad).join(' ');
    expect(quelle).not.toMatch(/https?:\/\//u);
  });
});
