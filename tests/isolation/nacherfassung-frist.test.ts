/**
 * **Die Frist der Nacherfassung** (V-321, O-165, D-810, 0506, § 17 Abs. 1
 * MiLoG).
 *
 * Eine Nacherfassung nahm die Plattform ohne Blick auf den Abstand zum
 * Arbeitstag an. Jetzt: mehr als sieben Kalendertage danach, und die Leitung
 * der Gesellschaft bekommt einen Hinweis — einmal, ohne den, der erfasst hat,
 * und ohne Verbot. Geprüft an echtem Postgres: der Abstand aus der Datenbank,
 * die Empfänger, die Art, und dass eine pünktliche Nacherfassung und eine
 * andere Korrekturart nichts melden.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  NACHERFASSUNG_FRIST_TAGE, korrigiereZeiteintrag,
} from '../../src/server/services/zeit/korrektur.js';
import { ART_NACHERFASSUNG_SPAET } from '../../src/server/services/zeit/benachrichtigung.js';

let f: Fixtur;
let planer = '';
let leitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(praefix: string, rolle: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null),
             current_date - 1)`,
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(b: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: b,
           portal: 'intern', readonly: false }, fn);

/**
 * Ein abgeschlossener Eintrag, `tageZurueck` Berliner Tage vor heute, 08:00
 * bis 12:00 — und das neue Ende fünf Stunden nach Beginn, unabhängig von der
 * Uhrzeit, zu der der Test läuft.
 */
async function eintrag(tageZurueck: number): Promise<{ id: string; neuesEnde: Date }> {
  const [z] = await sql.unsafe<{ id: string; beginn: Date }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art)
     values ($1, $2, $3,
             ((((now() at time zone 'Europe/Berlin')::date - $4::int) + time '08:00')
               at time zone 'Europe/Berlin'),
             ((((now() at time zone 'Europe/Berlin')::date - $4::int) + time '12:00')
               at time zone 'Europe/Berlin'),
             0, 'import', 'import', 'import', 'import', 'abgeschlossen', 'system')
     returning id, beginn_zeitpunkt as beginn`,
    [f.reinigung, f.jonasReinigung, f.jonas, tageZurueck] as never[]);
  return { id: z!.id, neuesEnde: new Date(new Date(z!.beginn).getTime() + 5 * 3_600_000) };
}

async function meldungen(): Promise<{ empfaenger_id: string; ziel: string; sammelbar: boolean }[]> {
  return sql.unsafe(
    `select empfaenger_id, ziel, sammelbar from benachrichtigung where art = $1`,
    [ART_NACHERFASSUNG_SPAET]);
}

beforeEach(async () => {
  f = await seed();
  planer = await konto('planer', 'admin');
  leitung = await konto('leitung', 'leitung');
});
afterAll(schliessen);

describe('V-321 — Nacherfassung nach mehr als sieben Tagen', () => {
  it('die Frist ist die des § 17 Abs. 1 MiLoG (O-165)', () => {
    expect(NACHERFASSUNG_FRIST_TAGE).toBe(7);
  });

  it('zehn Tage danach: geschrieben, und die Leitung bekommt genau einen Hinweis', async () => {
    const id = await eintrag(10);
    const ergebnis = await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id.id, art: 'nacherfassung', grundKategorie: 'vergessen_auszustempeln',
      begruendung: 'Ende nachgetragen.', durchgefuehrtVon: planer,
      endeZeitpunkt: id.neuesEnde,
    }));
    expect(ergebnis.spaetTage).toBe(10);
    const m = await meldungen();
    expect(m.map((z) => z.empfaenger_id)).toEqual([leitung]);
    expect(m[0]!.ziel).toBe(`/portal/reinigung/zeiten/${ergebnis.neueFassungId}`);
    expect(m[0]!.sammelbar).toBe(true);
  });

  it('pünktlich nacherfasst meldet nichts — und eine andere Korrekturart auch nicht', async () => {
    const frisch = await eintrag(7);
    const a = await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: frisch.id, art: 'nacherfassung', grundKategorie: 'vergessen_auszustempeln',
      begruendung: 'Ende nachgetragen.', durchgefuehrtVon: planer,
      endeZeitpunkt: frisch.neuesEnde,
    }));
    expect(a.spaetTage).toBeNull();
    const alt = await eintrag(30);
    const b = await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: alt.id, art: 'zeit_korrektur', grundKategorie: 'geraet_defekt',
      begruendung: 'Terminal aus.', durchgefuehrtVon: planer,
      endeZeitpunkt: alt.neuesEnde,
    }));
    expect(b.spaetTage).toBeNull();
    expect(await meldungen()).toEqual([]);
  });

  it('wer selbst Leitung ist und nacherfasst, meldet es nicht sich selbst', async () => {
    const id = await eintrag(12);
    await als(leitung, (tx) => korrigiereZeiteintrag(kontextAus(tx, leitung), {
      zeiteintragId: id.id, art: 'nacherfassung', grundKategorie: 'sonstiges',
      begruendung: 'Nachgetragen.', durchgefuehrtVon: leitung,
      endeZeitpunkt: id.neuesEnde,
    }));
    expect((await meldungen()).map((z) => z.empfaenger_id)).not.toContain(leitung);
  });

  it('der Definer meldet keine fremde Korrektur', async () => {
    const id = await eintrag(20);
    const e = await als(planer, (tx) => korrigiereZeiteintrag(kontextAus(tx, planer), {
      zeiteintragId: id.id, art: 'nacherfassung', grundKategorie: 'sonstiges',
      begruendung: 'Nachgetragen.', durchgefuehrtVon: planer,
      endeZeitpunkt: id.neuesEnde,
    }));
    const [k] = await sql.unsafe<{ id: string }[]>(
      `select id from zeiteintrag_korrektur where ersatz_zeiteintrag_id = $1`, [e.neueFassungId]);
    const zweiter = await konto('zweiter', 'admin');
    const [n] = (await als(zweiter, (tx) => tx.unsafe(
      `select app.nacherfassung_spaet_melden($1::uuid, 7, 'T', 'X', '/portal/reinigung') as n`,
      [k!.id]))) as unknown as { n: number }[];
    expect(n!.n).toBe(0);
  });
});
