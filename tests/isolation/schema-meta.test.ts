/**
 * PR 3 acceptance (5) and (6) — the meta-tests.
 *
 * These walk `information_schema` and `pg_catalog` rather than reading the
 * migration files, so a table added later without RLS fails the build even if
 * nobody remembers this file exists. That is the point: the rules have to
 * outlive the people who wrote them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql } from './harness.js';
import { NUR_UEBER_DEFINER } from '../../src/server/db/schema/rls.js';

/**
 * Tabellen, die BEWUSST keine Policy tragen (siehe `schema/rls.ts`). Der
 * Eintrag dort ist die Begruendung; hier steht nur, dass die Ausnahme
 * registriert sein muss — eine Tabelle ohne Policy und ohne Eintrag ist eine,
 * bei der jemand sie vergessen hat.
 */
const DEFINER_ONLY = new Set(NUR_UEBER_DEFINER.map((d) => d.tabelle));

afterAll(async () => {
  await schliessen();
});

describe('(5) every mandant_id table carries RLS, FORCE and a policy', () => {
  it('enumerates information_schema and finds no gap', async () => {
    const tabellen = await sql.unsafe<
      { relname: string; rls: boolean; force: boolean; policies: string }[]
    >(`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             (select count(*)::text from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and exists (select 1 from information_schema.columns col
                      where col.table_schema = 'public'
                        and col.table_name = c.relname
                        and col.column_name = 'mandant_id')
       order by 1`);

    expect(tabellen.length).toBeGreaterThan(0);
    for (const t of tabellen) {
      expect(t.rls, `${t.relname}: RLS ist aus`).toBe(true);
      // Without FORCE the OWNER bypasses its own policies, so every test that
      // runs as the owner passes and production learns otherwise first.
      expect(t.force, `${t.relname}: FORCE fehlt`).toBe(true);
      if (DEFINER_ONLY.has(t.relname)) {
        // Bewusst ohne Policy — und dann auch ohne Grant, sonst waere die
        // Ausnahme ein Loch statt einer Verengung.
        expect(Number(t.policies), `${t.relname}: als definer-only registriert, hat aber eine Policy`)
          .toBe(0);
        continue;
      }
      expect(Number(t.policies), `${t.relname}: keine Policy`).toBeGreaterThan(0);
    }
  });

  it('no application role holds BYPASSRLS — a single one makes every policy decorative', async () => {
    const rollen = await sql.unsafe<{ rolname: string; rolbypassrls: boolean }[]>(
      `select rolname, rolbypassrls from pg_roles where rolname like 'cse\\_%' order by 1`,
    );
    expect(rollen).toHaveLength(6);
    expect(rollen.filter((r) => r.rolbypassrls)).toEqual([]);
  });

  it('the K-05 column is absent from cse_app grants — not revoked afterwards', async () => {
    // A table-wide GRANT followed by a column REVOKE does nothing in Postgres.
    // The column must never be in the grant, and this asserts that directly.
    const spalten = await sql.unsafe<{ column_name: string }[]>(`
      select column_name from information_schema.column_privileges
       where grantee = 'cse_app' and table_name = 'anstellung' and privilege_type = 'SELECT'
       order by 1`);
    const namen = spalten.map((s) => s.column_name);
    expect(namen).toContain('personalnummer');
    expect(namen).not.toContain('stundensatz_intern');
  });
});

describe('(6) costed things hang off anstellung, facts about the human off person', () => {
  it('every FK to person or anstellung follows the D-09 rule', async () => {
    const fks = await sql.unsafe<
      { quelle: string; spalte: string; ziel: string }[]
    >(`
      select src.relname as quelle, att.attname as spalte, tgt.relname as ziel
        from pg_constraint con
        join pg_class src on src.oid = con.conrelid
        join pg_class tgt on tgt.oid = con.confrelid
        join unnest(con.conkey) as k(attnum) on true
        join pg_attribute att on att.attrelid = src.oid and att.attnum = k.attnum
       where con.contype = 'f' and tgt.relname in ('person','anstellung')`);

    for (const fk of fks) {
      if (fk.ziel === 'person') {
        expect(fk.spalte, `${fk.quelle}.${fk.spalte} → person`).toMatch(/person_id$/u);
      }
      if (fk.ziel === 'anstellung') {
        expect(fk.spalte, `${fk.quelle}.${fk.spalte} → anstellung`).toMatch(/anstellung_id$/u);
      }
    }
    // The D-09 case itself: anstellung points at person, person points at nothing.
    expect(fks.some((f) => f.quelle === 'anstellung' && f.ziel === 'person')).toBe(true);
    expect(fks.some((f) => f.quelle === 'person')).toBe(false);
  });

  it('person carries no mandant_id at all — the dual-employed human is ONE row', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='person'`,
    );
    expect(spalten.map((s) => s.column_name)).not.toContain('mandant_id');
  });

  it('anstellung declares the three parent uniques its children need (K-16)', async () => {
    const uniques = await sql.unsafe<{ conname: string; spalten: string }[]>(`
      select con.conname,
             (select string_agg(att.attname, ',' order by att.attname)
                from unnest(con.conkey) k(attnum)
                join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as spalten
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
       where c.relname = 'anstellung' and con.contype = 'u'`);
    const mengen = uniques.map((u) => u.spalten);
    expect(mengen).toContain('id,mandant_id');
    expect(mengen).toContain('id,person_id');
    expect(mengen).toContain('mandant_id,personalnummer');
  });
});

describe('the K-04 ceiling fails CLOSED when the portal is not bound', () => {
  it('an unbound portal reads nothing, rather than everything', async () => {
    const f = await seed();
    // A session that forgot to bind the ceiling resolves to `mitarbeiter`, and
    // with no person bound that matches no row. Forgetting the ceiling denies
    // access; it never opens it.
    const zeilen = await alsApp({ scope: 'mandant', mandantId: f.reinigung }, (tx) =>
      tx`select id from anstellung`,
    );
    expect(zeilen).toHaveLength(0);
  });
});
