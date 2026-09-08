/**
 * Der Seed macht die Plattform benutzbar — und sagt, was noch fehlt.
 *
 * Der Test laeuft den Seed und prueft danach das, worauf es ankommt: dass eine
 * Nummer gezogen werden KANN, und dass die Rechnungsnummer es ausdruecklich
 * nicht kann, solange O-134 offen ist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { alsApp, DB_URL, schliessen, sql } from './harness.js';
import { NummernkreisFehler, vergebeNummer } from '../../src/server/services/finanz/nummernkreis.js';

const WURZEL = resolve(import.meta.dirname, '../..');

beforeAll(() => {
  // Frisch aufsetzen und seeden — der Seed ist Teil der Zusage, nicht Beiwerk.
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'up'],
    { cwd: WURZEL, encoding: 'utf8' });
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
    [join(WURZEL, 'src/server/db/seed/index.ts')],
    { cwd: WURZEL, encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB_URL } });
}, 180_000);
afterAll(schliessen);

async function mandant(slug: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`select id from mandant where slug = ${slug}`;
  return m!.id;
}

describe('nach dem Seed ist die Plattform benutzbar', () => {
  it('vier Bereiche, und `operations` traegt O-01 als NULL', async () => {
    const zeilen = await sql<{ slug: string; ist_rechtseinheit: boolean | null }[]>`
      select slug, ist_rechtseinheit from mandant order by sortierung`;
    expect(zeilen.map((z) => z.slug))
      .toEqual(['reinigung', 'security', 'bau', 'operations']);
    // NULL ist der einzige neutrale Wert: `true` oder `false` waere eine
    // stille Entscheidung ueber eine offene Frage.
    expect(zeilen[3]!.ist_rechtseinheit).toBeNull();
  });

  it('ein Super-Admin existiert, mit hinterlegtem zweitem Faktor', async () => {
    const [b] = await sql<{ status: string; hat: boolean }[]>`
      select b.status, app.hat_zweiten_faktor(b.id) hat
        from benutzer b where b.email = 'admin@cse-gruppe.de'`;
    expect(b!.status).toBe('aktiv');
    // Ohne Faktor liesse `benutzer_2fa_pflicht` das Konto gar nicht aktiv
    // werden — und `ist_super_admin()` verlangt zusaetzlich eine aal2-Sitzung.
    expect(b!.hat).toBe(true);
  });

  it('der D-09-Fall steht drin: ein Mensch, zwei Gesellschaften, zwei Sätze', async () => {
    const zeilen = await sql<{ mandant_id: string; stundensatz_intern: string }[]>`
      select a.mandant_id, a.stundensatz_intern
        from anstellung a join person p on p.id = a.person_id
       where p.vorname = 'Fatima' order by a.personalnummer`;
    expect(zeilen).toHaveLength(2);
    expect(new Set(zeilen.map((z) => z.mandant_id)).size).toBe(2);
    expect(zeilen.map((z) => Number(z.stundensatz_intern))).toEqual([1450, 1780]);
  });

  it('ein Leistungsnachweis lässt sich SOFORT nummerieren', async () => {
    const m = await mandant('reinigung');
    const gezogen = await alsApp(
      { scope: 'mandant', mandantId: m, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
    );
    expect(gezogen.formatiert).toBe('LN-2026-00001');
  });

  it('eine RECHNUNG dagegen nicht — der Kreis ist ein Platzhalter (O-134)', async () => {
    // Genau das ist die Antwort auf eine offene Frage, kein Mangel: eine
    // vergebene Rechnungsnummer nimmt man nicht zurueck.
    const [k] = await sql<{ ist_platzhalter: boolean }[]>`
      select ist_platzhalter from nummernkreis
       where kreis_typ = 'ausgangsrechnung' and mandant_id = ${await mandant('reinigung')}`;
    expect(k!.ist_platzhalter).toBe(true);
  });

  it('und sobald jemand die Maske bestätigt, geht es — der Seed-Pfad steht offen', async () => {
    const m = await mandant('reinigung');
    // Als Eigentuemer, ohne angemeldeten Benutzer: der Weg, den 0013
    // ausdruecklich kennt. Ein Editor waere es nur mit Benutzer.
    await sql`
      update nummernkreis set ist_platzhalter = false, zuruecksetzung = 'jaehrlich'
       where mandant_id = ${m} and kreis_typ = 'ausgangsrechnung'`;

    const [k] = await sql<{ ist_platzhalter: boolean }[]>`
      select ist_platzhalter from nummernkreis
       where mandant_id = ${m} and kreis_typ = 'ausgangsrechnung'`;
    expect(k!.ist_platzhalter).toBe(false);

    // Gezogen wird sie trotzdem nicht von der Anwendung — der Rechnungskreis
    // laeuft ueber fin.rechnung_nummer_ziehen (PR 46).
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: m, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'ausgangsrechnung' }).catch((e: unknown) => e),
    );
    expect((fehler as NummernkreisFehler).grund).toBe('definer_kreis');
  });

  it('jede Agent-Richtlinie steht auf `auto_erlaubt = false`', async () => {
    const zeilen = await sql<{ auto_erlaubt: boolean }[]>`
      select auto_erlaubt from agent_richtlinie`;
    expect(zeilen.length).toBeGreaterThan(0);
    // Invariante 7 als Vorgabe, nicht als Ausnahme.
    expect(zeilen.every((z) => !z.auto_erlaubt)).toBe(true);
  });
});
