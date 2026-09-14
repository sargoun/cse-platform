/**
 * PR 12 Akzeptanz (6) und die Kette.
 *
 * Die Kettennummer wird unter `SELECT … FOR UPDATE` gezogen — dieselbe
 * Mechanik wie die Rechnungsnummer, und aus demselben Grund: ohne
 * serialisierte Gesamtordnung gabeln zwei gleichzeitige Freigebende die Kette,
 * und die naechtliche Verifikation meldet an jedem geschaeftigen Tag einen
 * Bruch.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { alsApp, DB_URL, schliessen, seed, sql, type Fixtur } from './harness.js';

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

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('die Freigabekette ist eine LINIE, keine Gabelung', () => {
  it('200 gleichzeitige Zuege ergeben 200 Nummern, lueckenlos', async () => {
    const pool = postgres(DB_URL, { max: 20, onnotice: () => {} });
    try {
      const nummern = await Promise.all(
        Array.from({ length: 200 }, () =>
          pool.begin(async (tx) => {
            const z = await tx.unsafe(
              `select kette_nr from app.freigabe_kette_ziehen($1)`, [f.reinigung],
            ) as { kette_nr: string }[];
            return Number(z[0]!.kette_nr);
          }) as Promise<number>),
      );
      expect(new Set(nummern).size).toBe(200);
      expect(Math.max(...nummern) - Math.min(...nummern) + 1).toBe(200);
    } finally {
      await pool.end({ timeout: 5 });
    }
  }, 60_000);

  it('jeder Mandant hat seine eigene Kette', async () => {
    const [a] = await sql.unsafe<{ kette_nr: string }[]>(
      `select kette_nr from app.freigabe_kette_ziehen($1)`, [f.reinigung],
    );
    const [b] = await sql.unsafe<{ kette_nr: string }[]>(
      `select kette_nr from app.freigabe_kette_ziehen($1)`, [f.security],
    );
    expect(Number(a!.kette_nr)).toBe(1);
    expect(Number(b!.kette_nr)).toBe(1);
  });

  it('die erste Nummer hat 64 Nullen als Vorgaenger', async () => {
    const [z] = await sql.unsafe<{ vorheriger_hash: string }[]>(
      `select vorheriger_hash from app.freigabe_kette_ziehen($1)`, [f.bau],
    );
    expect(z!.vorheriger_hash).toBe('0'.repeat(64));
  });
});

describe('ein Snapshot ist unveraenderlich (K-13)', () => {
  async function freigabeMitSnapshot(): Promise<{ freigabe: string; snapshot: string }> {
    const mensch = await konto('freigeber@cse.test');
    await mitglied(mensch, f.reinigung, 'leitung');
    const [fr] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
       values ($1,'email_senden','genehmigt',$2,now()) returning id`,
      [f.reinigung, mensch],
    );
    const [k] = await sql.unsafe<{ kette_nr: string; vorheriger_hash: string }[]>(
      `select * from app.freigabe_kette_ziehen($1)`, [f.reinigung],
    );
    const [sn] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe_snapshot
         (mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash, vorheriger_hash,
          hash, entscheidung, entschieden_von)
       values ($1,$2,$3,'{"a":1}'::jsonb,$4,$5,$6,'genehmigt',$7) returning id`,
      [f.reinigung, fr!.id, k!.kette_nr, 'a'.repeat(64), k!.vorheriger_hash,
       'b'.repeat(64), mensch],
    );
    return { freigabe: fr!.id, snapshot: sn!.id };
  }

  it('ein UPDATE wird abgewiesen', async () => {
    const { snapshot } = await freigabeMitSnapshot();
    await expect(
      sql.unsafe(`update freigabe_snapshot set nutzlast = '{"a":2}'::jsonb where id = $1`, [snapshot]),
    ).rejects.toThrow(/unveraenderlich/u);
  });

  it('ein DELETE ebenfalls — die Zeile bezeugt eine Entscheidung', async () => {
    const { snapshot } = await freigabeMitSnapshot();
    await expect(sql.unsafe(`delete from freigabe_snapshot where id = $1`, [snapshot]))
      .rejects.toThrow(/Hard delete|gesperrt/u);
  });

  /**
   * **Mit Entscheider**, seit 0136 — sonst greift `fs_entscheider_ausser_bei_frist`
   * (Invariante 7) zuerst, und dieser Fall pruefte nicht mehr, was er meint.
   * Der Gegenstand hier ist die Eindeutigkeit der KETTENNUMMER; dass eine
   * Entscheidung einen Menschen braucht, steht in §6 als eigener Fall.
   */
  it('zwei Snapshots mit derselben Kettennummer sind nicht speicherbar', async () => {
    const { freigabe } = await freigabeMitSnapshot();
    const [b] = await sql.unsafe<{ id: string }[]>(
      `select entschieden_von as id from freigabe_snapshot
        where freigabe_id = $1 limit 1`, [freigabe]);
    await expect(
      sql.unsafe(
        `insert into freigabe_snapshot
           (mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash, vorheriger_hash,
            hash, entscheidung, entschieden_von)
         values ($1,$2,1,'{}'::jsonb,$3,$3,$3,'genehmigt',$4)`,
        [f.reinigung, freigabe, 'c'.repeat(64), b!.id],
      ),
    ).rejects.toThrow(/freigabe_snapshot_kette_uk|fs_erst_uk|duplicate/iu);
  });
});

describe('(6) jede Entscheidung ist nachvollziehbar', () => {
  it('eine genehmigte Freigabe ohne benannten Menschen ist nicht speicherbar', async () => {
    // Invariante 7 verlangt einen Menschen, nicht einen Zustand.
    await expect(
      sql.unsafe(
        `insert into freigabe (mandant_id, aktion, status) values ($1,'email_senden','genehmigt')`,
        [f.reinigung],
      ),
    ).rejects.toThrow(/freigabe_genehmigt_hat_menschen/u);
  });

  it('eine Richtlinie mit auto_erlaubt fuer Angebote ist auf DATENBANKEBENE unmoeglich', async () => {
    // Nicht nur im Code: ein Skript, das die Zeile direkt setzt, kommt auch
    // nicht durch.
    await expect(
      sql.unsafe(
        `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
         values ($1,'angebot_senden',true)`,
        [f.reinigung],
      ),
    ).rejects.toThrow(/kein_auto_angebot/u);
  });

  it('ohne Richtlinienzeile gibt es keine Erlaubnis — und der Default ist false', async () => {
    const [z] = await sql.unsafe<{ auto_erlaubt: boolean }[]>(
      `insert into agent_richtlinie (mandant_id, aktion) values ($1,'email_senden')
       returning auto_erlaubt`,
      [f.reinigung],
    );
    // Eine Zeile, die versehentlich angelegt wird, erlaubt nichts.
    expect(z!.auto_erlaubt).toBe(false);
  });

  it('die Freigaben eines fremden Bereichs sind unsichtbar', async () => {
    const mensch = await konto('fremd@cse.test');
    await mitglied(mensch, f.reinigung, 'leitung');
    await sql.unsafe(
      `insert into freigabe (mandant_id, aktion) values ($1,'email_senden')`, [f.security],
    );
    const gesehen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: mensch, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<unknown[]>(`select id from freigabe`),
    );
    expect(gesehen).toHaveLength(0);
  });
});
