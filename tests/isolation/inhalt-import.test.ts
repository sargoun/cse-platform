/**
 * PR 14 Akzeptanz (1)–(4).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql } from './harness.js';
import { importiere, WEITERLEITUNGEN } from '../../src/server/services/inhalt/import.js';
import { weiterleitungenMitSprachen } from '../../src/lib/weiterleitungen.js';
import { findeRoute } from '../../src/server/registry/routen.js';
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
    /**
     * Bekannt heisst: eine INHALTSSEITE oder eine Route der Seitenkarte.
     *
     * Beide Universen zaehlen, weil beide Adressen sind, die ausgeliefert
     * werden. Nur die Inhaltsseiten zu pruefen hiesse, `/angebot` fuer
     * unbekannt zu halten — die Seite gibt es, sie steht nur in
     * `04-SEITENKARTE.md` statt in `seite`. Der Test waere dann nicht
     * strenger, sondern falsch.
     */
    const inhalt = new Set(OEFFENTLICHE_ROUTEN.map((r) => r.pfad));
    for (const [alt, neu] of Object.entries(WEITERLEITUNGEN)) {
      expect(alt.startsWith('/'), alt).toBe(true);
      // Ein Ziel, das es nicht gibt, ist eine Weiterleitung ins Leere — und
      // die kostet die Autorität, die sie retten sollte.
      const gibtEs = inhalt.has(neu) || findeRoute(neu) !== undefined;
      expect(gibtEs, `${alt} → ${neu}`).toBe(true);
    }
  });

  it('und die Quellen zeigen auf NICHTS — sonst waere die Seite noch da', () => {
    // Die Gegenrichtung: eine Quelle, die es als Seite weiterhin gibt, wuerde
    // von `zieheAbgeloesteZurueck` bei jedem Import zurueckgezogen.
    const inhalt = new Set(OEFFENTLICHE_ROUTEN.map((r) => r.pfad));
    for (const alt of Object.keys(WEITERLEITUNGEN)) {
      expect(inhalt.has(alt), `${alt} ist Quelle UND Inhaltsseite`).toBe(false);
    }
  });

  it('der englische Zweig wird abgeleitet und faellt nie ins Deutsche', () => {
    const alle = weiterleitungenMitSprachen();
    const en = alle.filter((w) => w.quelle.startsWith('/en/'));
    expect(en.length).toBeGreaterThan(0);
    for (const w of en) {
      // Sonst haette die Weiterleitung dem Besucher die Sprache genommen — er
      // hat sie nicht gewechselt.
      expect(w.ziel.startsWith('/en/'), `${w.quelle} → ${w.ziel}`).toBe(true);
    }
    // Die `.html`-Adressen der alten Website bekommen keinen Zwilling.
    expect(alle.some((w) => w.quelle === '/en/index.html')).toBe(false);
  });

  it('keine Weiterleitung zeigt auf sich selbst', () => {
    for (const [alt, neu] of Object.entries(WEITERLEITUNGEN)) {
      expect(alt).not.toBe(neu);
    }
  });
});

describe('abgeloeste Adressen ueberleben einen erneuten Import nicht', () => {
  /**
   * Der Befund: der Import legt an und aendert, er nimmt nie etwas weg. Eine
   * Datenbank, in der `/reinigung` einmal veroeffentlicht wurde, behielt die
   * Zeile auch, nachdem die Adresse `/unternehmen/reinigung` geworden war —
   * erreichbar, in der Sitemap, und fuer die Suchmaschine zwei Adressen mit
   * demselben Inhalt.
   */
  it('eine veroeffentlichte `/reinigung` wird beim naechsten Lauf zurueckgezogen',
    async () => {
      await sql`
        insert into seite (pfad, sprache, titel, status, veroeffentlicht_am)
        values ('/reinigung', 'de', 'Alte Adresse', 'veroeffentlicht', now())`;

      const bericht = await importiere(db, SEITEN, 'de');
      expect(bericht.abgeloest).toBeGreaterThanOrEqual(1);

      const [zeile] = await sql<{ n: number }[]>`
        select count(*)::int as n from seite
         where pfad = '/reinigung' and geloescht_am is null`;
      expect(zeile!.n).toBe(0);
    });

  it('und keine der GEPFLEGTEN Seiten wird dabei angefasst', async () => {
    // Die Gegenrichtung. Ohne sie bestuende der Test oben auch dann, wenn der
    // Import kurzerhand alles zurueckzieht. `beforeEach` leert die Tabellen,
    // also wird hier neu importiert statt auf den vorigen Test zu bauen.
    await sql`
      insert into seite (pfad, sprache, titel, status, veroeffentlicht_am)
      values ('/reinigung', 'de', 'Alte Adresse', 'veroeffentlicht', now())`;
    await importiere(db, SEITEN, 'de');

    const [zeile] = await sql<{ n: number }[]>`
      select count(*)::int as n from seite
       where sprache = 'de' and geloescht_am is null`;
    expect(zeile!.n).toBe(SEITEN.length);
  });

  it('eine Adresse, die Seite UND Weiterleitungsquelle waere, bricht den Import',
    async () => {
      /**
       * Sonst zoege ein spaeter eingetragener Umzug, dessen Quelle noch eine
       * gepflegte Seite ist, diese Seite bei JEDEM Lauf zurueck — still,
       * wiederholt, und sichtbar erst beim Aufruf der Website.
       */
      // Eine Quelle, die der `seite_pfad_check` auch zulaesst — sonst
      // scheiterte der Import an der Spalte, bevor die Wache greift, und der
      // Test bestuende aus dem falschen Grund.
      const quelle = '/reinigung';
      expect(Object.keys(WEITERLEITUNGEN)).toContain(quelle);
      await expect(importiere(
        db,
        [{ pfad: quelle, titel: 'Kollision', beschreibung: null, abschnitte: [] }],
        'de',
      )).rejects.toThrow(/Weiterleitungs-QUELLE/u);
    });
});

