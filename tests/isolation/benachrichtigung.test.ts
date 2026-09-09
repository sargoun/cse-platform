/**
 * PR 11 Akzeptanz (3) — ein `reinigung`-Benutzer bekommt nichts von einer
 * `bau`-Benachrichtigung, auch nicht per direkter id.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;

async function rolleId(s: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [s],
  );
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email],
  );
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)],
  );
}

async function benachrichtige(mandant: string, empfaenger: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into benachrichtigung
       (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
     values ($1,$2,'finanzen.rechnung_faellig','Fällig','Text','/portal/x/1','rechnung','1',true)
     returning id`,
    [mandant, empfaenger],
  );
  return b!.id;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(3) eine fremde Benachrichtigung ist nicht da — auch nicht per id', () => {
  it('der Empfaenger sieht seine, ein anderer sieht sie nicht', async () => {
    const a = await konto('a@cse.test');
    const b = await konto('b@cse.test');
    await mitglied(a, f.reinigung, 'leitung');
    await mitglied(b, f.reinigung, 'leitung');
    const meine = await benachrichtige(f.reinigung, a);

    const alsA = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: a, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from benachrichtigung where id = $1`, [meine]),
    );
    const alsB = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: b, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from benachrichtigung where id = $1`, [meine]),
    );

    // Der Posteingang ist PERSOENLICH. Ein Kollege im selben Bereich sieht ihn
    // nicht — und "nicht da" ist von "gibt es nicht" nicht zu unterscheiden.
    expect(alsA).toHaveLength(1);
    expect(alsB).toHaveLength(0);
  });

  it('der Posteingang ist an den ARBEITSKONTEXT gebunden, nicht an alle Bereiche', async () => {
    /**
     * `app.sichtbare_mandanten()` liefert in `mandant`-Scope genau den aktiven
     * Bereich (K-18/K-20). Eine Benachrichtigung aus `bau` ist also sichtbar,
     * waehrend man in `bau` arbeitet — und nicht, waehrend man in `reinigung`
     * arbeitet.
     *
     * Das ist eine ENGE Auslegung und bewusst dieselbe wie bei jeder anderen
     * Tabelle: der Posteingang folgt dem Arbeitskontext. Ein bereichs-
     * uebergreifender Posteingang waere eine Erweiterung, die jemand
     * entscheidet — nicht eine, die aus einer Policy herausfaellt.
     */
    const a = await konto('wechsler@cse.test');
    await mitglied(a, f.reinigung, 'leitung');
    await mitglied(a, f.bau, 'leitung');
    const ausBau = await benachrichtige(f.bau, a);

    const inReinigung = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: a, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from benachrichtigung where id = $1`, [ausBau]),
    );
    expect(inReinigung).toHaveLength(0);

    const inBau = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: a, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from benachrichtigung where id = $1`, [ausBau]),
    );
    expect(inBau).toHaveLength(1);

    /**
     * Was hier NICHT geprueft wird, und warum: dass ein Entzug der
     * Mitgliedschaft die Zeile unsichtbar macht. Die Policy liest
     * `app.aktiver_mandant()` aus der Sitzung und vertraut ihm — zu Recht, denn
     * K-02 setzt den Wert serverseitig, und `sitzung_mandant_pruefen` weist
     * beim Setzen jeden Bereich ab, zu dem keine lebende Mitgliedschaft
     * besteht (PR 6, dort geprueft). Die Durchsetzung sitzt an der
     * Sitzungsgrenze, nicht in jeder einzelnen Zeilenpolicy — sonst muesste
     * jede Tabelle der Plattform dieselbe Pruefung wiederholen.
     */
    const [z] = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: a, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<{ sichtbar: string[] }[]>(`select app.sichtbare_mandanten() sichtbar`),
    );
    expect(z!.sichtbar).toEqual([f.bau]);
  });

  it('ohne Ziel ist die Zeile gar nicht speicherbar (NOT-03)', async () => {
    const a = await konto('ohne-ziel@cse.test');
    await expect(
      sql.unsafe(
        `insert into benachrichtigung
           (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, sammelbar)
         values ($1,$2,'finanzen.rechnung_faellig','T','X','','rechnung',true)`,
        [f.reinigung, a],
      ),
    ).rejects.toThrow(/ziel|check/iu);
  });

  it('die Praeferenz kann den App-Kanal nicht abschalten', async () => {
    const a = await konto('praef@cse.test');
    await expect(
      sql.unsafe(
        `insert into benachrichtigung_praeferenz (benutzer_id, art, kanaele)
         values ($1,'finanzen.rechnung_faellig','{email}'::benachrichtigung_kanal[])`,
        [a],
      ),
    ).rejects.toThrow(/praeferenz_app_bleibt/u);
  });

  it('eine Nachricht ist mandantengebunden wie alles andere', async () => {
    const a = await konto('nachricht@cse.test');
    await mitglied(a, f.reinigung, 'leitung');
    await sql.unsafe(
      `insert into nachricht (mandant_id, betreff, text) values ($1,'Betreff','Text')`,
      [f.security],
    );
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: a, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from nachricht`),
    );
    expect(gesehen).toHaveLength(0);
  });
});
