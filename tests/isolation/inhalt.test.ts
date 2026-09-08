/**
 * PR 13 Akzeptanz (1) — eine Textaenderung ist ein UPDATE, kein Deployment.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql } from './harness.js';
import { InhaltFehler, ladeSeite, pruefeSeite } from '../../src/server/services/inhalt/seite.js';

const db = { unsafe: (s: string, w?: readonly unknown[]) => sql.unsafe(s, (w ?? []) as never[]) };

beforeEach(async () => {
  // Der Inhalt haengt an keinem Mandanten der Fixtur; `seed()` setzt nur die
  // Grundlage zurueck, damit die Seiten nicht aus dem vorigen Test stammen.
  await seed();
  await sql.unsafe(`truncate abschnitt, seite, medien cascade`);
});
afterAll(schliessen);

async function medium(alt = 'Ein Foto der Crew bei der Arbeit.'): Promise<string> {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into medien (pfad, alt_text, ist_platzhalter) values ('/p/b.svg',$1,true) returning id`,
    [alt],
  );
  return m!.id;
}

async function seite(pfad: string, titel: string): Promise<string> {
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into seite (pfad, titel, status, veroeffentlicht_am)
     values ($1,$2,'veroeffentlicht',now()) returning id`, [pfad, titel],
  );
  return s!.id;
}

describe('(1) der Inhalt kommt aus der Datenbank, nicht aus dem Code', () => {
  it('eine Textänderung wirkt sofort — ohne Deployment', async () => {
    const s = await seite('/', 'Startseite');
    await sql.unsafe(
      `insert into abschnitt (seite_id, art, reihenfolge, ueberschrift, akzent_wort, text, medien_id)
       values ($1,'hero',1,'Vier Gewerke, eine','Gruppe','Erster Text',$2)`,
      [s, await medium()],
    );

    const vorher = await ladeSeite(db, '/');
    expect(vorher!.abschnitte[0]!.text).toBe('Erster Text');

    await sql.unsafe(`update abschnitt set text = 'Geänderter Text' where seite_id = $1`, [s]);

    const nachher = await ladeSeite(db, '/');
    expect(nachher!.abschnitte[0]!.text).toBe('Geänderter Text');
  });

  it('ein Entwurf ist oeffentlich unsichtbar', async () => {
    await sql.unsafe(`insert into seite (pfad, titel, status) values ('/geheim','Geheim','entwurf')`);
    expect(await ladeSeite(db, '/geheim')).toBeNull();
  });

  it('die Abschnitte kommen in ihrer Reihenfolge', async () => {
    const s = await seite('/leistungen', 'Leistungen');
    for (const [nr, art] of [[3, 'kontakt'], [1, 'hero'], [2, 'text']] as const) {
      await sql.unsafe(
        `insert into abschnitt (seite_id, art, reihenfolge) values ($1,$2::abschnitt_art,$3)`,
        [s, art, nr],
      );
    }
    const geladen = await ladeSeite(db, '/leistungen');
    expect(geladen!.abschnitte.map((a) => a.art)).toEqual(['hero', 'text', 'kontakt']);
  });

  it('ein Bild ohne Alternativtext ist gar nicht speicherbar', async () => {
    // Für einen Screenreader ist das keine Abbildung, sondern eine Lücke.
    await expect(
      sql.unsafe(`insert into medien (pfad, alt_text) values ('/x.svg','')`),
    ).rejects.toThrow(/alt_text|check/iu);
  });

  it('ein veroeffentlichter Zustand ohne Datum ebenso wenig', async () => {
    await expect(
      sql.unsafe(`insert into seite (pfad, titel, status) values ('/x','X','veroeffentlicht')`),
    ).rejects.toThrow(/seite_status_stimmig/u);
  });
});

describe('DESIGN §2 wird beim Rendern durchgesetzt, nicht gehofft', () => {
  it('zwei Hero-Abschnitte sind ein Fehler — die Schreibschrift erscheint einmal', () => {
    expect(() => pruefeSeite({
      id: 's', pfad: '/', titel: 'T', beschreibung: null,
      abschnitte: [
        { id: 'a', art: 'hero', reihenfolge: 1, ueberschrift: null, akzentWort: null,
          text: null, medium: null, daten: {} },
        { id: 'b', art: 'hero', reihenfolge: 2, ueberschrift: null, akzentWort: null,
          text: null, medium: null, daten: {} },
      ],
    })).toThrow(InhaltFehler);
  });

  it('zwei rote Akzentwörter ebenso — zwei sind kein Akzent mehr', () => {
    expect(() => pruefeSeite({
      id: 's', pfad: '/', titel: 'T', beschreibung: null,
      abschnitte: [
        { id: 'a', art: 'hero', reihenfolge: 1, ueberschrift: 'X', akzentWort: 'Gruppe',
          text: null, medium: null, daten: {} },
        { id: 'b', art: 'text', reihenfolge: 2, ueberschrift: 'Y', akzentWort: 'Berlin',
          text: null, medium: null, daten: {} },
      ],
    })).toThrow(/Akzentwörter/u);
  });

  it('eine gültige Seite geht durch', () => {
    expect(() => pruefeSeite({
      id: 's', pfad: '/', titel: 'T', beschreibung: null,
      abschnitte: [
        { id: 'a', art: 'hero', reihenfolge: 1, ueberschrift: 'X', akzentWort: 'Gruppe',
          text: null, medium: { pfad: '/p.svg', alt: 'Ein Bild', platzhalter: true }, daten: {} },
      ],
    })).not.toThrow();
  });
});
