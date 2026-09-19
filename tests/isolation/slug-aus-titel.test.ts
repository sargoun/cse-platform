import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql } from './harness.js';

/**
 * `app.slug_aus_titel` — der URL-Schlüssel aus einem deutschen Titel (0170).
 *
 * **Warum diese Datei existiert.** Der Slug steht in einer Adresse, die ein
 * Kunde weitergibt und eine Suchmaschine aufnimmt. Ein Fehler darin ist nicht
 * hässlich, sondern dauerhaft: die Adresse wird EINMAL vergeben und danach dem
 * Titel nicht mehr nachgeführt, weil sonst jeder eingehende Verweis bricht.
 * Was hier falsch herauskommt, bleibt falsch.
 *
 * **Der Fall, der wirklich passiert ist.** Diese Datenbank läuft mit
 * `datcollate = 'C'`, und in `C` senkt `lower()` nur ASCII: `lower('Ä')` ist
 * `'Ä'`. Die erste Fassung ersetzte nur die kleinen Umlaute und verliess sich
 * auf `lower()` — aus „Grüße & Ärger" wurde `gruesse-und-rger`, weil
 * `[^a-z0-9]` das übrig gebliebene `Ä` wegwarf. Kein Fehler, keine Warnung,
 * nur eine Adresse mit einem fehlenden Buchstaben.
 */

/*
 * Der Seed laeuft, obwohl kein Fall seine Zeilen liest: die Funktion und die
 * beiden Ausloeser kommen aus einer MIGRATION, und der Aufbau der Datenbank
 * ist genau das, was hier geprueft wird. Ohne ihn liefe der Fall gegen eine
 * leere Huelle und waere gruen, weil es nichts gibt, woran er scheitern kann.
 */
beforeAll(async () => { await seed(); });
afterAll(async () => { await schliessen(); });

async function slug(titel: string): Promise<string> {
  const [z] = await sql.unsafe<{ s: string }[]>(
    `select app.slug_aus_titel($1) as s`, [titel]);
  return z!.s;
}

describe('§1 die deutschen Sonderzeichen', () => {
  it('schreibt die KLEINEN Umlaute zweistellig aus', async () => {
    expect(await slug('Grüße für München')).toBe('gruesse-fuer-muenchen');
    expect(await slug('Öffnung')).toBe('oeffnung');
  });

  it('verliert die GROSSEN Umlaute nicht (C-Kollation, lower() senkt nur ASCII)', async () => {
    expect(await slug('Änderung der Öffnungszeiten')).toBe('aenderung-der-oeffnungszeiten');
    expect(await slug('Über uns')).toBe('ueber-uns');
    expect(await slug('ÄÖÜ')).toBe('aeoeue');
  });

  it('macht aus ß ein ss — in beiden Schreibweisen', async () => {
    expect(await slug('Straße')).toBe('strasse');
    expect(await slug('STRAẞE')).toBe('strasse');
  });

  it('macht aus dem Und-Zeichen ein Wort, keinen Bindestrich', async () => {
    /*
     * `Bau & Ausbau` als `bau-ausbau` liest sich wie zwei Wörter, `bau-und-ausbau`
     * wie der Titel. Der Unterschied steht in der Adresse, die jemand vorliest.
     */
    expect(await slug('Bau & Ausbau')).toBe('bau-und-ausbau');
  });
});

describe('§2 die Form, die der CHECK verlangt', () => {
  const FORM = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

  it('gibt nie einen führenden, folgenden oder doppelten Bindestrich', async () => {
    for (const t of ['  Hallo  ', '--Hallo--', 'Hallo -- Welt', '!!! Hallo !!!']) {
      const s = await slug(t);
      expect(s, t).toMatch(FORM);
    }
  });

  it('gibt für einen Titel ganz ohne Buchstaben einen brauchbaren Rückfall', async () => {
    /*
     * Leer wäre die Adresse `/projekte/` — also die Liste, nicht der Eintrag.
     * Ein Rückfall ist hier besser als ein Fehler, weil der eindeutige Index
     * die zweite Zeile ohnehin abweist und die Redaktion dann etwas eintippt.
     */
    expect(await slug('?!@')).toBe('eintrag');
    expect(await slug('   ')).toBe('eintrag');
  });

  it('hält JEDE Ausgabe an die Form des CHECK — auch bei Unfug', async () => {
    const proben = [
      'Objektschutz für die Messewoche 2026',
      'C++ und C#', '100 % sauber', 'Ärzte/Praxen: Sonderreinigung',
      'Tür-zu-Tür', 'a', 'Ä', 'ß',
    ];
    for (const t of proben) {
      expect(await slug(t), t).toMatch(FORM);
    }
  });
});

describe('§3 der Auslöser füllt, überschreibt aber nie', () => {
  it('setzt den Slug beim Einfügen, wenn keiner mitkommt', async () => {
    const [m] = await sql.unsafe<{ id: string }[]>(
      `select id from mandant where slug = 'reinigung'`);
    const [r] = await sql.unsafe<{ slug: string }[]>(
      `insert into referenz (mandant_id, titel) values ($1::uuid, $2) returning slug`,
      [m!.id, 'Neue Hälfte & Größe']);
    expect(r!.slug).toBe('neue-haelfte-und-groesse');
  });

  it('lässt einen mitgegebenen Slug stehen — die Adresse folgt dem Titel nicht', async () => {
    const [m] = await sql.unsafe<{ id: string }[]>(
      `select id from mandant where slug = 'reinigung'`);
    const [r] = await sql.unsafe<{ slug: string }[]>(
      `insert into referenz (mandant_id, titel, slug) values ($1::uuid, $2, $3) returning slug`,
      [m!.id, 'Ein ganz anderer Titel', 'die-alte-adresse']);
    expect(r!.slug).toBe('die-alte-adresse');
  });

  it('weist zwei gleiche Slugs derselben Gesellschaft ab, statt still zu nummerieren', async () => {
    const [m] = await sql.unsafe<{ id: string }[]>(
      `select id from mandant where slug = 'reinigung'`);
    await sql.unsafe(
      `insert into referenz (mandant_id, titel, slug) values ($1::uuid, 'A', 'doppelt')`,
      [m!.id]);
    await expect(sql.unsafe(
      `insert into referenz (mandant_id, titel, slug) values ($1::uuid, 'B', 'doppelt')`,
      [m!.id],
    )).rejects.toThrow(/referenz_slug_uk/u);
  });

  it('lässt denselben Slug in einer ANDEREN Gesellschaft zu (Invariante 3)', async () => {
    const zeilen = await sql.unsafe<{ id: string }[]>(
      `select id from mandant where slug in ('security','bau') order by slug`);
    for (const m of zeilen) {
      await sql.unsafe(
        `insert into referenz (mandant_id, titel, slug) values ($1::uuid, 'X', 'geteilt')`,
        [m.id]);
    }
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from referenz where slug = 'geteilt'`);
    expect(z!.n).toBe(2);
  });
});
