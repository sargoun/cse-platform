/**
 * Eine Bewerbung aus dem Postfach gegen echtes Postgres (REC-03, REC-07,
 * V-224, D-718).
 *
 * **Der Befund.** REC-03 verlangt den Eingang über ein Postfach; es gab
 * weder einen Anschluss noch einen Weg von Hand, und `bewerbung_quelle =
 * 'mail'` setzte niemand. Geprüft wird: die Frist steht wie beim Formular
 * (Berliner Tag + Einstellung), die Herkunft bleibt `mail` — mit und ohne
 * Stelle (0472) —, eine fremde oder geschlossene Stelle wird abgewiesen, und
 * das Postfach behauptet keine Post, die es nicht holt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { erfasseBewerbungAusPostfach } from '../../src/server/services/recruiting/postfach.js';
import { aufbewahrungTage } from '../../src/server/services/recruiting/dienst.js';
import { POSTFACH_ADRESSE, seedPostfach } from '../../src/server/db/seed/postfach.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string): Promise<string> {
  const email = `postfach-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung Postfach','aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId('leitung')]);
  return u!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

function als<T>(fn: (k: SchreibKontext) => Promise<T>, mandant = f.reinigung): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: leitung,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, leitung, mandant)));
}

async function stelle(mandant: string, geschlossen = false): Promise<string> {
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into stelle (mandant_id, titel, beschreibung, status, geschlossen_am,
                         geschlossen_grund)
     values ($1, 'Reinigungskraft', 'Unterhaltsreinigung.', 'entwurf',
             case when $2 then now() else null end,
             case when $2 then 'Besetzt' else null end) returning id`, [mandant, geschlossen]);
  return s!.id;
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung);
});
afterAll(schliessen);

describe('(1) von Hand erfasst — mit Herkunft und Frist', () => {
  it('ohne Stelle: Quelle mail, Frist = Berliner Tag + Einstellung, Protokoll', async () => {
    const id = await als((k) => erfasseBewerbungAusPostfach(k, {
      stelleId: null, name: ' Mehmet Yılmaz ', email: 'M.Yilmaz@Beispiel.test',
      telefon: '  ', nachricht: 'Ich bewerbe mich initiativ.',
    }));
    const tage = await als((k) => aufbewahrungTage(k));
    const [b] = await sql.unsafe<{
      quelle: string; name: string; email: string; telefon: string | null; frist_stimmt: boolean;
    }[]>(
      `select quelle::text as quelle, name, email, telefon,
              aufbewahrung_bis = (app.berlin_heute() + $2::int) as frist_stimmt
         from bewerbung where id = $1`, [id, tage]);
    expect(b).toEqual({
      quelle: 'mail', name: 'Mehmet Yılmaz', email: 'm.yilmaz@beispiel.test', telefon: null,
      frist_stimmt: true,
    });
    const [p] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log where objekt_typ = 'bewerbung' and objekt_id = $1
          and aktion = 'recruiting.bewerbung_aus_postfach'`, [id]);
    expect(p!.n).toBe(1);
  });

  it('mit Stelle: die Herkunft bleibt mail', async () => {
    const s = await stelle(f.reinigung);
    const id = await als((k) => erfasseBewerbungAusPostfach(k, {
      stelleId: s, name: 'Anna Schmidt', email: 'anna@beispiel.test', telefon: null,
      nachricht: null,
    }));
    const [b] = await sql.unsafe<{ quelle: string; stelle: string }[]>(
      `select quelle::text as quelle, stelle_id::text as stelle from bewerbung where id = $1`, [id]);
    expect(b).toEqual({ quelle: 'mail', stelle: s });
  });
});

describe('(2) was abgewiesen wird', () => {
  it('eine geschlossene oder fremde Stelle, eine unlesbare Adresse', async () => {
    const zu = await stelle(f.reinigung, true);
    const fremd = await stelle(f.security);
    for (const s of [zu, fremd]) {
      await expect(als((k) => erfasseBewerbungAusPostfach(k, {
        stelleId: s, name: 'X', email: 'x@beispiel.test', telefon: null, nachricht: null,
      }))).rejects.toMatchObject({ grund: 'stelle_unbekannt' });
    }
    await expect(als((k) => erfasseBewerbungAusPostfach(k, {
      stelleId: null, name: 'X', email: 'keine-adresse', telefon: null, nachricht: null,
    }))).rejects.toMatchObject({ grund: 'unvollstaendig' });
  });

  it('die Datenbank hält die Herkunft: initiativ nie mit, Karriereseite nie ohne Stelle (0472)', async () => {
    const s = await stelle(f.reinigung);
    await expect(sql.unsafe(
      `insert into bewerbung (mandant_id, stelle_id, name, email, quelle, aufbewahrung_bis)
       values ($1, $2, 'X', 'x@beispiel.test', 'initiativ', current_date + 1)`,
      [f.reinigung, s])).rejects.toThrow(/bewerbung_quelle_und_stelle/u);
    await expect(sql.unsafe(
      `insert into bewerbung (mandant_id, name, email, quelle, aufbewahrung_bis)
       values ($1, 'X', 'x@beispiel.test', 'karriereseite', current_date + 1)`,
      [f.reinigung])).rejects.toThrow(/bewerbung_quelle_und_stelle/u);
  });
});

describe('(3) der Seed', () => {
  it('legt eine Bewerbung aus dem Postfach über den Dienst an — einmal', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    expect(await seedPostfach(sql, ids, false)).toEqual({ erfasst: 0 });
    expect(await seedPostfach(sql, ids, true)).toEqual({ erfasst: 1 });
    const [b] = await sql.unsafe<{ quelle: string }[]>(
      `select quelle::text as quelle from bewerbung where email = $1`, [POSTFACH_ADRESSE]);
    expect(b!.quelle).toBe('mail');
    expect(await seedPostfach(sql, ids, true)).toEqual({ erfasst: 0 });
  });
});
