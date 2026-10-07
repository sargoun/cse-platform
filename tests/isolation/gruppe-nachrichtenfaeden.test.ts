/**
 * **Die Gruppenansicht liest keine Nachrichtenfäden** (V-379, O-651, 0495,
 * D-799/D-805).
 *
 * 0011 gab `nachricht` mit `gruppe.nachricht.lesen` an die Gruppenansicht
 * frei; eine Seite dafür gab es nie, die Policy wirkte nur auf direkte
 * Abfragen. Die Voreinstellung zu O-651 sagt: die Gruppenleitung liest keine
 * Nachrichtenfäden (TEN-05). Gemessen wird, dass eine Super-Administration —
 * die den Schlüssel hält — in der Gruppenansicht null Zeilen sieht, dass die
 * Decke restriktiv auf allen drei Nachrichtentischen steht und dass die
 * permissive Gruppenpolicy weg ist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let chef = '';

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('faeden-chef@test.invalid') returning id`);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'faeden-chef@test.invalid', 'faeden-chef', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id]);
  chef = u!.id;
  for (const mandant of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into nachricht (mandant_id, betreff, koerper, richtung)
       values ($1, 'Vertragsentwurf', 'Wortlaut einer Schwestergesellschaft', 'intern')`,
      [mandant]);
  }
});
afterAll(schliessen);

describe('V-379 — die Gruppenansicht sieht null Nachrichten', () => {
  it('auch die Super-Administration, die gruppe.nachricht.lesen hält', async () => {
    const gesehen = await alsApp({
      scope: 'gruppe', mandantIds: [f.reinigung, f.security, f.bau, f.operations],
      benutzerId: chef, portal: 'intern', readonly: true, aal: 'aal2',
    }, (tx) => tx.unsafe<{ id: string }[]>(`select id from nachricht`));
    expect(gesehen).toHaveLength(0);
  });

  it('die Decke steht restriktiv auf allen drei Nachrichtentischen', async () => {
    const decken = await sql.unsafe<{ tablename: string; permissive: string }[]>(
      `select tablename, permissive from pg_policies
        where policyname = 'p_gruppe_kein_personenbezug'
          and tablename in ('nachricht', 'nachricht_anhang', 'nachricht_empfaenger')
        order by tablename`);
    expect(decken.map((d) => d.tablename))
      .toEqual(['nachricht', 'nachricht_anhang', 'nachricht_empfaenger']);
    expect(decken.every((d) => d.permissive === 'RESTRICTIVE')).toBe(true);
  });

  it('die permissive Gruppenpolicy aus 0011 ist weg', async () => {
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from pg_policies
        where tablename = 'nachricht' and policyname = 't_nachricht_gruppe'`);
    expect(z!.n).toBe(0);
  });
});
