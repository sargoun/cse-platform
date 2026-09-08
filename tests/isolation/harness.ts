/**
 * The isolation harness. Every test here runs against a REAL Postgres with
 * RLS on and FORCE set, as the `cse_app` role — never as the owner, because
 * an owner without FORCE bypasses its own policies and every assertion below
 * would pass for the wrong reason.
 */
import postgres from 'postgres';

export const DB_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres@localhost:55432/cse_test';

export type Scope = 'mandant' | 'gruppe' | 'person' | 'kunde';

export interface Sitzung {
  readonly scope: Scope;
  readonly mandantId?: string;
  readonly mandantIds?: readonly string[];
  readonly personId?: string;
  readonly benutzerId?: string;
  readonly readonly?: boolean;
  /**
   * The K-04 ceiling, bound when the scope is entered — by the wrapper, from
   * the membership's `rolle.portal`. Left unset it resolves to the
   * fail-closed `mitarbeiter`, which is deliberate and asserted below.
   */
  readonly portal?: 'intern' | 'mitarbeiter' | 'kunde';
}

export const sql = postgres(DB_URL, { max: 4, onnotice: () => {} });

/**
 * Run a callback inside a transaction as `cse_app`, with the session GUCs set
 * the way the session helpers would set them.
 *
 * The mandant is set from the SESSION, never from an argument the caller
 * supplies to a query (K-02, invariant 3).
 */
export async function alsApp<T>(
  sitzung: Sitzung,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    await tx.unsafe(`select set_config('app.scope', $1, true)`, [sitzung.scope]);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [sitzung.mandantId ?? '']);
    await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [
      (sitzung.mandantIds ?? []).join(','),
    ]);
    await tx.unsafe(`select set_config('app.person_id', $1, true)`, [sitzung.personId ?? '']);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [sitzung.benutzerId ?? '']);
    await tx.unsafe(`select set_config('app.readonly', $1, true)`, [
      sitzung.readonly === false ? 'off' : 'on',
    ]);
    // In mandant scope the wrapper binds the portal from the active
    // membership's role. In the other three it is a constant of the scope and
    // app.portal() ignores this GUC entirely.
    await tx.unsafe(`select set_config('app.portal', $1, true)`, [sitzung.portal ?? '']);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    return fn(tx);
  }) as Promise<T>;
}

export interface Fixtur {
  readonly reinigung: string;
  readonly security: string;
  readonly bau: string;
  readonly operations: string;
  /** The dual-employed human — the D-09 case. */
  readonly fatima: string;
  readonly fatimaReinigung: string;
  readonly fatimaSecurity: string;
  /** Employed by cleaning only. */
  readonly jonas: string;
  readonly jonasReinigung: string;
}

/** Seeds the four areas and the D-09 case, as the owner (migrations do this). */
export async function seed(): Promise<Fixtur> {
  await sql.unsafe(`truncate audit_log, anstellung, person, mandant restart identity cascade`);

  const [r, s, b, o] = await Promise.all(
    [
      ['reinigung', 'CSE Dienstleistung', 'CSE Dienstleistungen GmbH'],
      ['security', 'SSE Security', 'Select-Security Event GmbH'],
      ['bau', 'REALTIME Service', 'REALTIME Service GmbH'],
      ['operations', 'CSE Operations', 'CSE Operations'],
    ].map(async ([slug, name, firma]) => {
      const rows = await sql.unsafe<{ id: string }[]>(
        `insert into mandant (slug, name, firma) values ($1,$2,$3) returning id`,
        [slug!, name!, firma!],
      );
      return rows[0]!.id;
    }),
  );

  const person = async (v: string, n: string): Promise<string> =>
    (
      await sql.unsafe<{ id: string }[]>(
        `insert into person (vorname, nachname) values ($1,$2) returning id`,
        [v, n],
      )
    )[0]!.id;

  const anstellung = async (
    mandant: string,
    pers: string,
    nr: string,
    satz: number,
  ): Promise<string> =>
    (
      await sql.unsafe<{ id: string }[]>(
        `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern)
         values ($1,$2,$3,'2024-01-01',$4) returning id`,
        [mandant, pers, nr, satz],
      )
    )[0]!.id;

  const fatima = await person('Fatima', 'Yildiz');
  const jonas = await person('Jonas', 'Berger');

  return {
    reinigung: r!,
    security: s!,
    bau: b!,
    operations: o!,
    fatima,
    // The same human, two employments, two entities, two rates (D-09).
    fatimaReinigung: await anstellung(r!, fatima, 'R-1001', 1450),
    fatimaSecurity: await anstellung(s!, fatima, 'S-2001', 1780),
    jonas,
    jonasReinigung: await anstellung(r!, jonas, 'R-1002', 1400),
  };
}

export async function schliessen(): Promise<void> {
  await sql.end({ timeout: 5 });
}
