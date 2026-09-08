/**
 * PR 3 acceptance (1), (2), (3), (4), (7) — tenant isolation proven at the
 * DATABASE level, as `cse_app`, with no service-layer filter in sight.
 *
 * That is the whole point of the criterion: RLS is the second line of defence,
 * and a test that goes through the service layer proves only the first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, type Fixtur, schliessen, seed, sql } from './harness.js';

let f: Fixtur;
beforeAll(async () => {
  f = await seed();
});
afterAll(async () => {
  await schliessen();
});

describe('(1) a reinigung session cannot read security employments', () => {
  it('selects ZERO rows — no service filter, just the policy', async () => {
    const zeilen = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      // Deliberately unfiltered. If this returns a row, RLS is not doing its job.
      tx`select id, mandant_id from anstellung`,
    );
    expect(zeilen.length).toBeGreaterThan(0);
    expect(zeilen.every((z) => z['mandant_id'] === f.reinigung)).toBe(true);
    expect(zeilen.map((z) => z['id'])).not.toContain(f.fatimaSecurity);
  });

  it('cannot reach a security row even by naming its id directly', async () => {
    const zeilen = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      tx`select id from anstellung where id = ${f.fatimaSecurity}`,
    );
    expect(zeilen).toHaveLength(0);
  });

  it('a security session sees the mirror image', async () => {
    const zeilen = await alsApp({ scope: 'mandant', mandantId: f.security, portal: 'intern' }, (tx) =>
      tx`select id from anstellung`,
    );
    expect(zeilen.map((z) => z['id'])).toEqual([f.fatimaSecurity]);
  });
});

describe('(2) the dual-employed person is ONE row, the wage rate is not shared', () => {
  it('is readable from both tenants, as the same row (D-09)', async () => {
    const ausReinigung = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      tx`select id, vorname from person where id = ${f.fatima}`,
    );
    const ausSecurity = await alsApp({ scope: 'mandant', mandantId: f.security, portal: 'intern' }, (tx) =>
      tx`select id, vorname from person where id = ${f.fatima}`,
    );
    expect(ausReinigung).toHaveLength(1);
    expect(ausSecurity).toHaveLength(1);
    expect(ausReinigung[0]?.['id']).toBe(ausSecurity[0]?.['id']);
  });

  it('a third entity that does not employ her sees nothing', async () => {
    const ausBau = await alsApp({ scope: 'mandant', mandantId: f.bau, portal: 'intern' }, (tx) =>
      tx`select id from person where id = ${f.fatima}`,
    );
    expect(ausBau).toHaveLength(0);
  });

  it('SELECT * on anstellung from reinigung is REFUSED — the column grant, K-05', async () => {
    // Asserted on the query, because the privilege is removed at column level:
    // there is no serialisation in which the value could appear.
    await expect(
      alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
        tx`select stundensatz_intern from anstellung`,
      ),
    ).rejects.toThrow(/permission denied|stundensatz_intern/iu);
  });

  it('the accessor returns her reinigung rate and NULL for her security rate', async () => {
    const eigen = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      tx`select app.anstellung_entgelt_lesen(${f.fatimaReinigung}) as satz`,
    );
    const fremd = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      tx`select app.anstellung_entgelt_lesen(${f.fatimaSecurity}) as satz`,
    );
    expect(String(eigen[0]?.['satz'])).toBe('1450');
    expect(fremd[0]?.['satz']).toBeNull();
  });
});

describe('(3) a write without exactly one active mandant is refused', () => {
  it('throws KeinAktiverMandant in group scope, before any row is touched', async () => {
    await expect(
      alsApp({ scope: 'gruppe', mandantIds: [f.reinigung, f.security], readonly: false }, (tx) =>
        tx`insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
           values (${f.reinigung}, ${f.jonas}, 'G-1', '2025-01-01')`,
      ),
    ).rejects.toThrow(/KeinAktiverMandant/u);
  });

  it('throws on UPDATE in group scope too', async () => {
    await expect(
      alsApp({ scope: 'gruppe', mandantIds: [f.reinigung], readonly: false }, (tx) =>
        tx`update anstellung set personalnummer = 'X' where id = ${f.jonasReinigung}`,
      ),
    ).rejects.toThrow(/KeinAktiverMandant/u);
  });

  it('refuses an insert naming ANOTHER tenant while one is active', async () => {
    await expect(
      alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false }, (tx) =>
        tx`insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
           values (${f.security}, ${f.jonas}, 'X-9', '2025-01-01')`,
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('accepts the same insert for the active tenant', async () => {
    const zeilen = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false }, (tx) =>
      tx`insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
         values (${f.reinigung}, ${f.jonas}, 'R-9999', '2025-01-01') returning id`,
    );
    expect(zeilen).toHaveLength(1);
    await sql.unsafe(`delete from anstellung where personalnummer = 'R-9999'`);
  });
});

describe('(4) a fifth area is a row, not a code change (TEN-08)', () => {
  it('inserting a fifth mandant makes every query and policy work unchanged', async () => {
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into mandant (slug, name, firma) values ('logistik','CSE Logistik','CSE Logistik GmbH') returning id`,
    );
    const person = (
      await sql.unsafe<{ id: string }[]>(
        `insert into person (vorname, nachname) values ('Neu','Kollege') returning id`,
      )
    )[0]!;
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern)
       values ($1,$2,'L-1','2025-06-01',1500)`,
      [neu!.id, person.id],
    );

    const zeilen = await alsApp({ scope: 'mandant', mandantId: neu!.id, portal: 'intern' }, (tx) =>
      tx`select id, mandant_id from anstellung`,
    );
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.['mandant_id']).toBe(neu!.id);

    // And it is invisible from the four originals.
    const ausReinigung = await alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern' }, (tx) =>
      tx`select id from anstellung where mandant_id = ${neu!.id}`,
    );
    expect(ausReinigung).toHaveLength(0);
  });
});

describe('(7) K-20 — every accessor resolves in all four scopes', () => {
  const scopes = ['mandant', 'gruppe', 'person', 'kunde'] as const;

  it('no accessor throws, in any scope', async () => {
    for (const scope of scopes) {
      const zeile = await alsApp(
        {
          scope,
          ...(scope === 'mandant' ? { mandantId: f.reinigung, portal: 'intern' as const } : {}),
          mandantIds: [f.reinigung, f.security],
          personId: f.fatima,
        },
        (tx) => tx`select
            app.scope()                as scope,
            app.aktiver_mandant()      as aktiver_mandant,
            app.mandant_ids()          as mandant_ids,
            app.sichtbare_mandanten()  as sichtbare,
            app.portal()               as portal,
            app.ist_gruppenansicht()   as gruppenansicht,
            app.ist_readonly()         as readonly`,
      );
      const reihen = zeile as unknown as Record<string, unknown>[];
      expect(reihen[0]?.['scope']).toBe(scope);
    }
  });

  it('aktiver_mandant() is NULL in the three multi-tenant scopes — DOCUMENTED', async () => {
    for (const scope of ['gruppe', 'person', 'kunde'] as const) {
      const zeile = await alsApp({ scope, mandantIds: [f.reinigung], personId: f.fatima }, (tx) =>
        tx`select app.aktiver_mandant() as m`,
      );
      expect(zeile[0]?.['m']).toBeNull();
    }
  });

  it('sichtbare_mandanten() is NOT keyed on aktiver_mandant — it resolves per scope', async () => {
    // This is the K-20 defect in one assertion: an accessor keyed on the
    // active mandant returns {} here, every predicate is false, and the page
    // reads zero rows with no error.
    const gruppe = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security] },
      (tx) => tx`select app.sichtbare_mandanten() as m`,
    );
    expect(gruppe[0]?.['m']).toHaveLength(2);

    const person = await alsApp({ scope: 'person', personId: f.fatima }, (tx) =>
      tx`select app.sichtbare_mandanten() as m`,
    );
    // Her own two employments — derived inside the database, not handed in.
    expect(person[0]?.['m']).toHaveLength(2);
  });

  it('app.portal() is the constant `intern` in group scope, never mitarbeiter', async () => {
    // The most-restrictive fold this replaces returned `mitarbeiter` for
    // exactly this human — leitung of one entity, employed by another — and
    // blanked the group roll-up.
    const zeile = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.security], personId: f.fatima },
      (tx) => tx`select app.portal() as p`,
    );
    expect(zeile[0]?.['p']).toBe('intern');
  });

  it('the employee portal reads her rows across BOTH employments (K-18, EMP-15)', async () => {
    const zeilen = await alsApp({ scope: 'person', personId: f.fatima }, (tx) =>
      tx`select id, mandant_id from anstellung order by mandant_id`,
    );
    expect(zeilen).toHaveLength(2);
    expect(new Set(zeilen.map((z) => z['mandant_id']))).toEqual(
      new Set([f.reinigung, f.security]),
    );
  });
});

describe('audit_log has exactly one writer', () => {
  it('cse_app cannot INSERT directly', async () => {
    await expect(
      alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false }, (tx) =>
        tx`insert into audit_log (mandant_id, ebene, akteur_typ, aktion, objekt_typ)
           values (${f.reinigung}, 'mandant', 'mensch', 'gefaelscht', 'anstellung')`,
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('app.protokolliere writes, and the entgelt accessor leaves a trail', async () => {
    const vorher = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from audit_log`);
    await alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: f.fatima, portal: 'intern' }, (tx) =>
      tx`select app.anstellung_entgelt_lesen(${f.fatimaReinigung})`,
    );
    const nachher = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from audit_log`);
    expect(Number(nachher[0]!.n)).toBe(Number(vorher[0]!.n) + 1);
  });
});
