/**
 * `migration_lauf` und `migration_zeile` gegen die echte Datenbank
 * (ROADMAP Phase 10, O-128, 0202).
 *
 * **Die FORM steht, der Parser nicht** — und genau das prueft diese Datei:
 * dass der Lauf seine Zusagen haelt, bevor es etwas zu importieren gibt. Ein
 * Uebernahmelauf ist der Nachweis, WOHER ein historischer Zeit- oder
 * Buchungsdatensatz kommt; ohne ihn ist eine uebernommene Zeile eine
 * Behauptung ueber die Vergangenheit.
 *
 * Vier Zusagen:
 *
 *  - **Jeder Zustand hat seinen Menschen.** `uebernommen` ohne Zeitpunkt,
 *    `verworfen` ohne Namen — beides ist bei der Uebernahme historischer
 *    Lohn- und Buchdaten ein GoBD-Befund, also haelt es ein `CHECK`.
 *  - **Dieselbe Datei zweimal ist ein Nichtereignis** (Pruefsumme je Quelle).
 *  - **Die Zeile gehoert zum Lauf DERSELBEN Gesellschaft** — zusammengesetzt
 *    als Fremdschluessel (K-16), nicht nur ueber RLS.
 *  - **Kein DELETE.** Verworfen wird ueber den Zustand.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);
const SHA = (): string => `${zufall()}`.padEnd(64, 'a').slice(0, 64)
  .replace(/[^0-9a-f]/gu, 'b');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(
  mandant: string, rolle = 'admin', module: readonly string[] | null = null,
): Promise<string> {
  const email = `migration-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [u!.id, mandant, await rolleId(rolle),
      module === null ? null : `{${module.join(',')}}`] as never[]);
  return u!.id;
}

async function lauf(mandant: string, o: {
  quelle?: string; sha?: string; datei?: string;
} = {}): Promise<string> {
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into migration_lauf
       (mandant_id, quelle, datei_name, datei_sha256, datei_groesse_bytes, bemerkung)
     values ($1, $2, $3, $4, 4096, 'O-128 offen') returning id`,
    [mandant, o.quelle ?? 'aplano', o.datei ?? 'export.csv', o.sha ?? SHA()] as never[]);
  return l!.id;
}

beforeEach(async () => {
  f = await seed();
});

afterAll(async () => {
  await schliessen();
});

describe('Der Zustand und sein Mensch', () => {
  it('ein neuer Lauf ist ein Entwurf und zaehlt nichts', async () => {
    const id = await lauf(f.reinigung);
    const [l] = await sql.unsafe<{
      status: string; zeilen_gesamt: number; zeilen_gueltig: number;
    }[]>(`select status, zeilen_gesamt, zeilen_gueltig from migration_lauf where id = $1`,
      [id]);
    expect(l?.status).toBe('entwurf');
    expect(l?.zeilen_gesamt).toBe(0);
    expect(l?.zeilen_gueltig).toBe(0);
  });

  it('„uebernommen" ohne Zeitpunkt wird abgewiesen', async () => {
    const id = await lauf(f.reinigung);
    await expect(sql.unsafe(
      `update migration_lauf set status = 'uebernommen' where id = $1`, [id] as never[],
    )).rejects.toThrow(/ml_status_belegt/u);
  });

  it('„verworfen" ohne Namen wird abgewiesen', async () => {
    const id = await lauf(f.reinigung);
    await expect(sql.unsafe(
      `update migration_lauf set status = 'verworfen', verworfen_am = now()
        where id = $1`, [id] as never[],
    )).rejects.toThrow(/ml_verworfen_paarweise/u);
  });

  it('der vollstaendige Weg geht: geprueft, dann uebernommen', async () => {
    const id = await lauf(f.reinigung);
    const mensch = await konto(f.reinigung);
    await sql.unsafe(
      `update migration_lauf
          set status = 'geprueft', geprueft_am = now(), geprueft_von = $2,
              zeilen_gesamt = 10, zeilen_gueltig = 9, zeilen_fehlerhaft = 1
        where id = $1`, [id, mensch] as never[]);
    await expect(sql.unsafe(
      `update migration_lauf set status = 'uebernommen',
              uebernommen_am = now(), uebernommen_von = $2
        where id = $1`, [id, mensch] as never[],
    )).resolves.toBeDefined();
  });

  it('die Zaehler muessen aufgehen — sonst ist der Bericht eine Behauptung', async () => {
    const id = await lauf(f.reinigung);
    await expect(sql.unsafe(
      `update migration_lauf set zeilen_gesamt = 5, zeilen_gueltig = 4,
              zeilen_fehlerhaft = 3 where id = $1`, [id] as never[],
    )).rejects.toThrow(/ml_zaehler_summe/u);
  });

  it('eine Pruefsumme, die keine ist, wird abgewiesen', async () => {
    await expect(lauf(f.reinigung, { sha: 'kein-hash' }))
      .rejects.toThrow(/ml_sha256/u);
  });

  it('eine unbekannte Quelle wird abgewiesen', async () => {
    await expect(lauf(f.reinigung, { quelle: 'sage' })).rejects.toThrow(/ml_quelle/u);
  });
});

describe('Dieselbe Datei zweimal ist ein Nichtereignis', () => {
  it('gleiche Quelle und gleiche Pruefsumme: abgewiesen', async () => {
    const sha = SHA();
    await lauf(f.reinigung, { sha });
    await expect(lauf(f.reinigung, { sha }))
      .rejects.toThrow(/migration_lauf_datei_uk/u);
  });

  it('dieselbe Datei aus einer ANDEREN Quelle ist ein eigener Lauf', async () => {
    const sha = SHA();
    await lauf(f.reinigung, { sha, quelle: 'aplano' });
    await expect(lauf(f.reinigung, { sha, quelle: 'excel' })).resolves.toBeTruthy();
  });

  it('und in einer anderen Gesellschaft ebenso', async () => {
    const sha = SHA();
    await lauf(f.reinigung, { sha });
    await expect(lauf(f.bau, { sha })).resolves.toBeTruthy();
  });
});

describe('Die Rohzeile gehoert zum Lauf derselben Gesellschaft (K-16)', () => {
  it('ein Lauf aus einem fremden Bereich ist strukturell ausgeschlossen', async () => {
    const fremd = await lauf(f.bau);
    await expect(sql.unsafe(
      `insert into migration_zeile (mandant_id, lauf_id, zeilennummer, roh)
       values ($1, $2, 1, '{"a":1}'::jsonb)`, [f.reinigung, fremd] as never[],
    )).rejects.toThrow(/mz_lauf_fk/u);
  });

  it('eine Zeilennummer kommt je Lauf nur einmal', async () => {
    const id = await lauf(f.reinigung);
    await sql.unsafe(
      `insert into migration_zeile (mandant_id, lauf_id, zeilennummer, roh)
       values ($1, $2, 1, '{"a":1}'::jsonb)`, [f.reinigung, id] as never[]);
    await expect(sql.unsafe(
      `insert into migration_zeile (mandant_id, lauf_id, zeilennummer, roh)
       values ($1, $2, 1, '{"a":2}'::jsonb)`, [f.reinigung, id] as never[],
    )).rejects.toThrow(/migration_zeile_uk/u);
  });

  it('ein Ziel ohne Zeitpunkt wird abgewiesen', async () => {
    const id = await lauf(f.reinigung);
    await expect(sql.unsafe(
      `insert into migration_zeile (mandant_id, lauf_id, zeilennummer, roh, ziel_tabelle)
       values ($1, $2, 2, '{"a":1}'::jsonb, 'zeiteintrag')`,
      [f.reinigung, id] as never[],
    )).rejects.toThrow(/mz_ziel_paarweise/u);
  });
});

describe('Die Rechte (0202)', () => {
  it('system.einstellung_verwalten liest und schreibt', async () => {
    const benutzer = await konto(f.reinigung, 'admin', ['system']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const angelegt = await tx.unsafe(
          `insert into migration_lauf
             (mandant_id, quelle, datei_name, datei_sha256, datei_groesse_bytes)
           values (app.aktiver_mandant(), 'lexware', 'buch.csv', $1, 99)
           returning id`, [SHA()] as never[]) as unknown[];
        const gelesen = await tx.unsafe(`select quelle from migration_lauf`) as unknown[];
        return { angelegt, gelesen };
      },
    );
    expect(befund.angelegt).toHaveLength(1);
    expect(befund.gelesen).toHaveLength(1);
  });

  it('ohne das Recht: nichts sichtbar', async () => {
    await lauf(f.reinigung);
    const benutzer = await konto(f.reinigung, 'leitung', ['objekt']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select quelle from migration_lauf`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('der Lauf eines fremden Bereichs bleibt unsichtbar (Invariante 3)', async () => {
    await lauf(f.bau);
    const benutzer = await konto(f.reinigung, 'admin', ['system']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select quelle from migration_lauf`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('weder Arbeiter- noch Kundenportal sehen einen Uebernahmelauf (K-04)', async () => {
    await lauf(f.reinigung);
    const benutzer = await konto(f.reinigung, 'admin', ['system']);
    for (const portal of ['mitarbeiter', 'kunde'] as const) {
      const zeilen = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
          portal, readonly: false },
        (tx) => tx.unsafe(`select quelle from migration_lauf`),
      ) as unknown[];
      expect(zeilen, portal).toHaveLength(0);
    }
  });

  it('in der Gruppenansicht wird nichts angelegt (Invariante 10)', async () => {
    const benutzer = await konto(f.reinigung, 'admin', ['system']);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: benutzer,
        readonly: true },
      (tx) => tx.unsafe(
        `insert into migration_lauf
           (mandant_id, quelle, datei_name, datei_sha256, datei_groesse_bytes)
         values ($1, 'excel', 'x.csv', $2, 1)`, [f.reinigung, SHA()] as never[]),
    )).rejects.toThrow();
  });

  it('cse_app aendert die Datei und ihre Pruefsumme nicht mehr', async () => {
    await lauf(f.reinigung);
    const benutzer = await konto(f.reinigung, 'admin', ['system']);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`update migration_lauf set datei_sha256 = $1`, [SHA()] as never[]),
    )).rejects.toThrow();
  });
});

describe('Kein DELETE (Invariante 8)', () => {
  it('weder Lauf noch Zeile', async () => {
    const id = await lauf(f.reinigung);
    await sql.unsafe(
      `insert into migration_zeile (mandant_id, lauf_id, zeilennummer, roh)
       values ($1, $2, 1, '{"a":1}'::jsonb)`, [f.reinigung, id] as never[]);
    await expect(sql.unsafe(
      `delete from migration_zeile where lauf_id = $1`, [id] as never[])).rejects.toThrow();
    await expect(sql.unsafe(
      `delete from migration_lauf where id = $1`, [id] as never[])).rejects.toThrow();
  });

  it('cse_app hat das Recht gar nicht', async () => {
    for (const tabelle of ['migration_lauf', 'migration_zeile']) {
      const [g] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from information_schema.table_privileges
          where table_name = $1 and grantee = 'cse_app'
            and privilege_type in ('DELETE', 'TRUNCATE')`, [tabelle]);
      expect(g?.n, tabelle).toBe('0');
    }
  });
});
