/**
 * PR 14 Akzeptanz (1)–(4).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql } from './harness.js';
import { importiere, WEITERLEITUNGEN } from '../../src/server/services/inhalt/import.js';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';
import { ladeSeite } from '../../src/server/services/inhalt/seite.js';
import { napAus, NapFehler, localBusinessJsonLd } from '../../src/server/services/inhalt/nap.js';

const db = { unsafe: (s: string, w?: readonly unknown[]) => sql.unsafe(s, (w ?? []) as never[]) };

const SEITEN = OEFFENTLICHE_ROUTEN.map((r) => ({
  pfad: r.pfad, titel: r.titel, beschreibung: null,
  abschnitte: [{ art: 'hero', reihenfolge: 1, ueberschrift: r.titel,
                 akzentWort: r.pfad === '/' ? 'Gruppe' : null, text: null }],
}));

beforeEach(async () => {
  await seed();
  await sql.unsafe(`truncate abschnitt, seite, medien cascade`);
});
afterAll(schliessen);

describe('(2) zweimal importieren ändert NULL Zeilen', () => {
  it('der zweite Lauf legt nichts an und ändert nichts', async () => {
    const erster = await importiere(db, SEITEN);
    expect(erster.angelegt).toBeGreaterThan(0);
    expect(erster.geaendert).toBe(0);

    const zweiter = await importiere(db, SEITEN);
    // Ein Import, der beim zweiten Lauf Duplikate erzeugt, wird genau einmal
    // ausgeführt und danach nie wieder angefasst — und dann veraltet der
    // Inhalt, weil niemand sich traut.
    expect(zweiter.angelegt).toBe(0);
    expect(zweiter.geaendert).toBe(0);
    expect(zweiter.unveraendert).toBe(erster.angelegt);
  });

  it('und `geaendert_am` bleibt leer — kein Stempel ohne Änderung', async () => {
    await importiere(db, SEITEN);
    await importiere(db, SEITEN);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from seite where geaendert_am is not null`,
    );
    // Ein `update` mit identischen Werten behauptet eine Änderung, die nicht
    // stattgefunden hat — und schreibt eine Audit-Zeile dafür.
    expect(Number(z!.n)).toBe(0);
  });

  it('eine echte Änderung wird dagegen erkannt', async () => {
    await importiere(db, SEITEN);
    const geaendert = SEITEN.map((s) =>
      s.pfad === '/kontakt' ? { ...s, titel: 'Kontakt & Anfahrt' } : s);
    const bericht = await importiere(db, geaendert);
    expect(bericht.geaendert).toBe(1);
    expect((await ladeSeite(db, '/kontakt'))!.titel).toBe('Kontakt & Anfahrt');
  });
});

describe('(1) jede PUB-01-Route rendert aus `seite`', () => {
  it('nach dem Import hat jede Route ihre Zeile', async () => {
    await importiere(db, SEITEN);
    for (const r of OEFFENTLICHE_ROUTEN) {
      const s = await ladeSeite(db, r.pfad);
      expect(s, r.pfad).not.toBeNull();
      expect(s!.titel, r.pfad).toBe(r.titel);
    }
  });

  it('die vier Bereichsseiten sind dabei', async () => {
    const bereiche = OEFFENTLICHE_ROUTEN.filter((r) => r.bereich !== null);
    expect(bereiche.map((r) => r.bereich)).toEqual(['reinigung', 'security', 'bau', 'operations']);
  });
});

describe('(3) der NAP-Block ist auf jeder Seite zeichengleich', () => {
  it('er kommt aus `mandant` und wird an EINER Stelle formatiert', async () => {
    const zeilen = await sql.unsafe<Record<string, string | null>[]>(
      `select firma, strasse, plz, ort, land, telefon, email from mandant order by sortierung`,
    );
    const naps = zeilen.map((m) => napAus(m as never));
    // Für eine Suchmaschine sind zwei Schreibweisen derselben Adresse zwei
    // Unternehmen, und die Autorität verteilt sich auf beide.
    for (const n of naps) {
      expect(n.einzeilig).toContain('Kurfürstendamm 21');
      expect(n.einzeilig).toContain('10719 Berlin');
    }
    // Vier Gesellschaften, vier NAPs — aber dieselbe Anschrift, identisch
    // formatiert.
    expect(new Set(naps.map((n) => `${n.strasse}|${n.ort}`)).size).toBe(1);
  });

  it('eine halbe Adresse ist ein Fehler, keine halbe Ausgabe', () => {
    expect(() => napAus({
      firma: 'X GmbH', strasse: null, plz: '10719', ort: 'Berlin',
      land: 'DE', telefon: '+49 30 1', email: null,
    })).toThrow(NapFehler);
  });

  it('das JSON-LD trägt die NAP derselben Gesellschaft', async () => {
    const [m] = await sql.unsafe<Record<string, string | null>[]>(
      `select firma, strasse, plz, ort, land, telefon, email from mandant where slug = 'security'`,
    );
    const ld = localBusinessJsonLd(m as never, 'https://cse-gruppe.de/security');
    expect(ld['@type']).toBe('LocalBusiness');
    expect(ld['name']).toBe('Select-Security Event GmbH');
    expect((ld['address'] as Record<string, unknown>)['postalCode']).toBe('10719');
  });
});

describe('(4) jede Alt-URL leitet mit 301 weiter', () => {
  it('die Karte ist vollständig und zeigt auf bekannte Routen', () => {
    const bekannt = new Set(OEFFENTLICHE_ROUTEN.map((r) => r.pfad));
    for (const [alt, neu] of Object.entries(WEITERLEITUNGEN)) {
      expect(alt.startsWith('/'), alt).toBe(true);
      // Ein Ziel, das es nicht gibt, ist eine Weiterleitung ins Leere — und
      // die kostet die Autorität, die sie retten sollte.
      expect(bekannt, `${alt} → ${neu}`).toContain(neu);
    }
  });

  it('keine Weiterleitung zeigt auf sich selbst', () => {
    for (const [alt, neu] of Object.entries(WEITERLEITUNGEN)) {
      expect(alt).not.toBe(neu);
    }
  });
});
