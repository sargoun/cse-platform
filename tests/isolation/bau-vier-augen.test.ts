/**
 * **Vier Augen für Bau-Rechtserklärungen** (V-383, O-260, 0496, D-800/D-805).
 *
 * Behinderungsanzeige (§ 6 Abs. 1 VOB/B) und Nachtragseinreichung (§ 2 VOB/B)
 * gehen nach einer genehmigten Freigabe hinaus. Wer sie vorgelegt hat
 * (`erstellt_von`), gibt sie nicht selbst frei — der Auslöser hält das an der
 * Freigabe selbst fest, für jeden Weg, der genehmigt. Andere Aktionen sind
 * nicht betroffen, und eine zweite Person darf genehmigen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let verfasser = '';
let zweite = '';

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function vorgelegt(aktion: string, von: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, erstellt_von)
     values ($1, $2, 'offen', $3) returning id`, [f.bau, aktion, von]);
  return z!.id;
}

async function genehmige(freigabe: string, von: string): Promise<void> {
  await sql.unsafe(
    `update freigabe set status = 'genehmigt', freigegeben_von = $2, freigegeben_am = now()
      where id = $1`, [freigabe, von]);
}

beforeAll(async () => {
  f = await seed();
  verfasser = await konto('vier-augen-verfasser@test.invalid');
  zweite = await konto('vier-augen-zweite@test.invalid');
});
afterAll(schliessen);

describe('V-383 — wer vorlegt, gibt nicht selbst frei', () => {
  it.each(['behinderung_senden', 'nachtrag_einreichen'])(
    '%s: die eigene Genehmigung weist der Auslöser ab', async (aktion) => {
      const id = await vorgelegt(aktion, verfasser);
      await expect(genehmige(id, verfasser)).rejects.toThrow(/Vier-Augen-Prinzip/u);
    });

  it.each(['behinderung_senden', 'nachtrag_einreichen'])(
    '%s: eine zweite Person genehmigt', async (aktion) => {
      const id = await vorgelegt(aktion, verfasser);
      await genehmige(id, zweite);
      const [z] = await sql.unsafe<{ status: string }[]>(
        `select status::text as status from freigabe where id = $1`, [id]);
      expect(z!.status).toBe('genehmigt');
    });

  it('auch eine gleich genehmigt angelegte Freigabe derselben Person geht nicht', async () => {
    await expect(sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am, erstellt_von)
       values ($1, 'behinderung_senden', 'genehmigt', $2, now(), $2)`, [f.bau, verfasser]))
      .rejects.toThrow(/Vier-Augen-Prinzip/u);
  });

  it('andere Aktionen sind nicht betroffen', async () => {
    const id = await vorgelegt('social_veroeffentlichen', verfasser);
    await genehmige(id, verfasser);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from freigabe where id = $1`, [id]);
    expect(z!.status).toBe('genehmigt');
  });
});
