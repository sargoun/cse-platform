/**
 * Der Plattformkatalog und der Registrierungsstand des Vergaberadars, ohne
 * Datenbank (V-175, RAD-09, O-07, D-669).
 *
 * Bis V-175 schrieb kein Weg `vergabeplattform` oder
 * `mandant_plattform_registrierung`; die Warnung „nicht freigeschaltet"
 * konnte nie auslösen. Geprüft wird hier, was keine Datenbank braucht: welche
 * Eingaben ein Katalogeintrag und ein Registrierungsstand annehmen, dass jede
 * Abweisung einen Satz in beiden Sprachen hat, und dass die Route den Bereich
 * aus der Sitzung nimmt. Die Datenbankseite prüft
 * `tests/isolation/radar-plattform.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PlattformFehler, REGISTRIERUNG_STAENDE, leseBasisUrl, leseHostmuster, pruefePlattform,
  pruefeRegistrierung, type PlattformFehlerCode,
} from '../../src/server/services/radar/plattform.js';
import { PLATTFORM_PRUEFUNGEN } from '../../src/server/services/radar/vorgang.js';
import { RADAR_PLATTFORM_TEXTE } from '../../src/lib/i18n/verwaltung/radar-plattform.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

function codeVon(fn: () => unknown): PlattformFehlerCode | null {
  try {
    fn();
  } catch (f) {
    if (f instanceof PlattformFehler) return f.code;
    throw f;
  }
  return null;
}

describe('(1) Hostnamen — was der Auslöser vergleicht, und nichts anderes', () => {
  it('getrennt durch Komma, Leerzeichen oder Zeile, klein geschrieben, ohne Dubletten', () => {
    expect(leseHostmuster('Vergabe.Berlin.de, www.dtvp.de\nvergabe.berlin.de'))
      .toEqual(['vergabe.berlin.de', 'www.dtvp.de']);
  });

  it('aus einer eingefügten Adresse wird ihr Host — das ist keine Deutung', () => {
    expect(leseHostmuster('https://www.evergabe-online.de/tenderdetails.html?id=1'))
      .toEqual(['www.evergabe-online.de']);
  });

  it('leer ist erlaubt: dann wird nichts zugeordnet', () => {
    expect(leseHostmuster('  ')).toEqual([]);
    expect(leseHostmuster(null)).toEqual([]);
  });

  it.each(['localhost', 'nur text', 'exa_mple.de', '-vorne.de', 'https://', 'a..b.de'])(
    '„%s" ist kein Hostname', (roh) => {
      expect(codeVon(() => leseHostmuster(roh))).toBe('host_ungueltig');
    });

  it('höchstens zwanzig', () => {
    const viele = Array.from({ length: 21 }, (_, i) => `h${String(i)}.beispiel.de`).join(',');
    expect(codeVon(() => leseHostmuster(viele))).toBe('host_ungueltig');
  });
});

describe('(2) die Adresse der Plattform', () => {
  it('https und http, sonst nichts', () => {
    expect(leseBasisUrl('https://vergabe.berlin.de/')).toBe('https://vergabe.berlin.de/');
    expect(leseBasisUrl('')).toBeNull();
    expect(codeVon(() => leseBasisUrl('ftp://vergabe.berlin.de'))).toBe('url_ungueltig');
    expect(codeVon(() => leseBasisUrl('vergabe.berlin.de'))).toBe('url_ungueltig');
  });

  it('eine Adresse mit Zugangsdaten wird abgewiesen — ein Kennwort gehört nie hierher', () => {
    expect(codeVon(() => leseBasisUrl('https://nutzer:geheim@vergabe.berlin.de/')))
      .toBe('url_ungueltig');
  });
});

describe('(3) ein Katalogeintrag', () => {
  it('braucht einen Namen; der Kurzname ist freiwillig und streng', () => {
    expect(codeVon(() => pruefePlattform({ name: '  ' }))).toBe('name_fehlt');
    expect(pruefePlattform({ name: 'Vergabemarktplatz Berlin' })).toMatchObject({
      name: 'Vergabemarktplatz Berlin', slug: null, hostMuster: [],
      registrierungErforderlich: true,
    });
    expect(pruefePlattform({ name: 'X', slug: 'VMP-Berlin' }).slug).toBe('vmp-berlin');
    expect(codeVon(() => pruefePlattform({ name: 'X', slug: 'v m p' }))).toBe('slug_ungueltig');
  });

  it('„Registrierung erforderlich" ist die Vorgabe und nur ausdrücklich abwählbar', () => {
    expect(pruefePlattform({ name: 'X', registrierungErforderlich: false })
      .registrierungErforderlich).toBe(false);
  });
});

describe('(4) der Registrierungsstand — die CHECKs aus 0145 als Satz', () => {
  it('ein unbekannter Stand wird abgewiesen, jeder bekannte angenommen', () => {
    expect(codeVon(() => pruefeRegistrierung({ status: 'vielleicht' }))).toBe('status_unbekannt');
    for (const status of REGISTRIERUNG_STAENDE) {
      const roh = status === 'registriert' ? { status, registriertAm: '2026-03-01' } : { status };
      expect(pruefeRegistrierung(roh).status).toBe(status);
    }
  });

  it('registriert heisst: seit einem Tag', () => {
    expect(codeVon(() => pruefeRegistrierung({ status: 'registriert' })))
      .toBe('registriert_ohne_datum');
  });

  it('die Gültigkeit endet nicht vor der Registrierung, und ein Datum muss es geben', () => {
    expect(codeVon(() => pruefeRegistrierung({
      status: 'registriert', registriertAm: '2026-03-01', gueltigBis: '2026-02-28',
    }))).toBe('gueltig_vor_start');
    expect(codeVon(() => pruefeRegistrierung({ status: 'beantragt', registriertAm: '2026-02-30' })))
      .toBe('datum_ungueltig');
  });

  it('die verantwortliche Person ist eine Kennung oder niemand', () => {
    expect(codeVon(() => pruefeRegistrierung({
      status: 'unbekannt', verantwortlichBenutzerId: 'chef',
    }))).toBe('verantwortlich_fremd');
    expect(pruefeRegistrierung({ status: 'unbekannt', verantwortlichBenutzerId: ' ' })
      .verantwortlichBenutzerId).toBeNull();
  });
});

describe('(5) jede Abweisung und jeder Stand hat einen Satz — in beiden Sprachen', () => {
  const CODES: readonly PlattformFehlerCode[] = [
    'nur_super_admin', 'name_fehlt', 'slug_ungueltig', 'slug_vergeben', 'url_ungueltig',
    'host_ungueltig', 'text_zu_lang', 'plattform_unbekannt', 'status_unbekannt',
    'datum_ungueltig', 'registriert_ohne_datum', 'gueltig_vor_start', 'verantwortlich_fremd',
    'unbekannte_handlung',
  ];

  it.each(['de', 'en'] as const)('%s', (sprache) => {
    const t = RADAR_PLATTFORM_TEXTE[sprache];
    // Die Abweisungen der Plattformprüfung am Vorgang (api/radar/vorgang) gehören dazu.
    for (const code of [...CODES, 'plattform', 'kein_vorgang']) {
      expect(eigenerEintrag(t.fehler, code), code).toBeDefined();
    }
    for (const stand of REGISTRIERUNG_STAENDE) expect(t.stand[stand], stand).toBeTruthy();
    for (const p of PLATTFORM_PRUEFUNGEN) expect(t.pruefung[p], p).toBeTruthy();
    for (const v of ['angelegt', 'geaendert', 'bestaetigt', 'archiviert', 'registrierung']) {
      expect(eigenerEintrag(t.vermerkt, v), v).toBeDefined();
    }
    // Kein Satz nennt einen rohen Schlüssel.
    for (const satz of [...Object.values(t.fehler), ...Object.values(t.stand)]) {
      expect(satz).not.toMatch(/\b[a-z]+_[a-z_]+\b/u);
    }
  });

  it('beide Sprachen kennen dieselben Schlüssel', () => {
    expect(Object.keys(RADAR_PLATTFORM_TEXTE.en.fehler).sort())
      .toEqual(Object.keys(RADAR_PLATTFORM_TEXTE.de.fehler).sort());
    expect(Object.keys(RADAR_PLATTFORM_TEXTE.en.vermerkt).sort())
      .toEqual(Object.keys(RADAR_PLATTFORM_TEXTE.de.vermerkt).sort());
  });
});

describe('(6) die Route nimmt den Bereich aus der Sitzung und antwortet mit der Seite', () => {
  const route = readFileSync('src/app/api/radar/plattform/route.ts', 'utf8');

  it('kein ?mandant=, der Slug aus app.aktiver_mandant()', () => {
    expect(route).not.toContain("searchParams.get('mandant')");
    expect(route).toContain('select m.slug from mandant m where m.id = app.aktiver_mandant()');
  });

  it('JSON nur ohne Seite: fremder Ursprung und keine Sitzung', () => {
    const codes = [...route.matchAll(/NextResponse\.json\(\{ fehler: '([a-z_]+)'/gu)]
      .map((m) => m[1]);
    expect(new Set(codes)).toEqual(new Set(['fremder_ursprung', 'keine_sitzung']));
    expect(route).toContain('?fehler=${fehler.code}');
  });

  it('die Seite schlägt Schlüssel aus der Adresse nur als eigenen Eintrag nach', () => {
    const seite = readFileSync('src/app/portal/[mandant]/radar/plattformen/page.tsx', 'utf8');
    expect(seite).toContain("eigenerEintrag(t.fehler, suche['fehler'])");
    expect(seite).toContain("eigenerEintrag(t.vermerkt, suche['vermerkt'])");
    expect(seite).toContain('action="/api/radar/plattform"');
  });
});

describe('(7) EINE Frage „freigeschaltet?" für alle Warnungen (V-240)', () => {
  it('Liste, Kennzahl, Plattformseite, Mappe und Gruppe fragen freischaltungSql', () => {
    for (const datei of [
      'src/app/portal/[mandant]/radar/daten.ts',
      'src/app/portal/[mandant]/radar/[id]/mappe/daten.ts',
      'src/server/services/gruppe/radar.ts',
    ]) {
      const quelle = readFileSync(datei, 'utf8');
      expect(quelle, datei).toContain('freischaltungSql(');
      expect(quelle, datei).not.toMatch(/<> 'registriert'/u);
    }
  });

  it('keine Seite vergleicht den Stand noch selbst mit „registriert"', () => {
    for (const seite of [
      'src/app/portal/[mandant]/radar/page.tsx',
      'src/app/portal/[mandant]/radar/[id]/page.tsx',
      'src/app/portal/[mandant]/radar/[id]/mappe/page.tsx',
      'src/app/portal/gruppe/radar/page.tsx',
    ]) {
      expect(readFileSync(seite, 'utf8'), seite).not.toMatch(/registrierung [!=]== 'registriert'/u);
    }
  });

  it('der Registrierungsstand ist ausdrücklich an den aktiven Bereich gebunden — nicht nur an RLS', () => {
    const daten = readFileSync('src/app/portal/[mandant]/radar/daten.ts', 'utf8');
    expect(daten).toContain('and mpr.mandant_id = app.aktiver_mandant()');
    expect(daten).toContain('and m.mandant_id = app.aktiver_mandant()');
    expect(readFileSync('src/app/portal/[mandant]/radar/[id]/mappe/daten.ts', 'utf8'))
      .toContain('and mpr.mandant_id = m.mandant_id');
  });
});
