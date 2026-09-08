/**
 * The isolation harness. Every test here runs against a REAL Postgres with
 * RLS on and FORCE set, as the `cse_app` role — never as the owner, because
 * an owner without FORCE bypasses its own policies and every assertion below
 * would pass for the wrong reason.
 */
import postgres from 'postgres';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';

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

/**
 * Run a callback as an arbitrary role, with no session GUCs bound.
 *
 * PR 4's first acceptance is about roles rather than tenants — `DELETE` has to
 * fail for `cse_app`, for `cse_job` and for the owner, and the three fail for
 * three different reasons. A helper that only ever produced `cse_app` would
 * make the other two untestable.
 */
export async function alsRolle<T>(
  rolle: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    if (rolle !== '') await tx.unsafe(`set local role ${rolle}`);
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

/**
 * Die fünf Systemrollen aus `0007` (AUT-01) — Schlüssel, Label, Geltungs-
 * bereich, Portal, 2FA-Pflicht. Sie stehen hier, weil `truncate … cascade`
 * sie mitnimmt und jeder Test sie wieder braucht.
 */
const STANDARDROLLEN: readonly (readonly [string, string, string, string, boolean])[] = [
  ['super_admin', 'Super-Administration', 'global', 'intern', true],
  ['admin', 'Administration', 'mandant', 'intern', true],
  ['leitung', 'Leitung', 'mandant', 'intern', false],
  ['mitarbeiter', 'Mitarbeitende', 'mandant', 'mitarbeiter', false],
  ['kunde', 'Kundenzugang', 'mandant', 'kunde', false],
];

/** Die Plattform-Aufbewahrungsregeln aus `0009` (DOC-07). */
const AUFBEWAHRUNG_VORGABE: readonly (readonly [string, number | null, boolean, string, boolean])[] = [
  ['rechnung', 10, true, '§ 147 AO, § 14b UStG — 10 Jahre', false],
  ['buchhaltung', 10, true, '§ 147 AO, § 257 HGB — 10 Jahre', false],
  ['beleg', 10, true, '§ 147 AO — Buchungsbelege, 10 Jahre', false],
  ['vertrag', 10, true, '§ 257 HGB — mit Rechnungsbezug 10 Jahre', false],
  ['angebot', 6, false, '§ 257 HGB — 6 Jahre', false],
  ['kunde', 6, false, '§ 257 HGB — 6 Jahre', false],
  ['mitarbeiter', null, true, 'offen (O-25)', true],
  ['projekt', null, true, 'offen (O-25)', true],
  ['unternehmen', null, true, 'offen (O-25)', true],
];

/**
 * Seeds the four areas and the D-09 case, as the owner (migrations do this).
 *
 * PR 4 locks the registered tables against `DELETE` **and** `TRUNCATE`, so the
 * harness can no longer reset by emptying them — which is the point of
 * invariant 8 and not a problem to route around. `session_replication_role =
 * replica` is the one escape, and it is the right one: superuser-only, so no
 * application role can reach it, and explicit, so a reader sees exactly where
 * the protection was stood down and for how long.
 *
 * It runs in ONE transaction with `SET LOCAL`, and that is load-bearing. The
 * pool holds four connections; a plain `SET` followed by a `RESET` can land on
 * two different ones, leaving a connection in replica mode for the rest of the
 * run. Every trigger then silently stops firing on whichever queries happen to
 * pick it — which is how this was found, as an audit row that was not written
 * and a `geaendert_am` the caller was allowed to keep.
 *
 * Seeding inside it also leaves `audit_log` empty at the start of every test.
 * Setup that audits itself makes "exactly one audit row" unassertable.
 */
export async function seed(): Promise<Fixtur> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    // `cascade` erreicht über die FKs auf `mandant` auch `rolle`, `benutzer`,
    // `benutzer_mandant`, `benutzer_sitzung` und `nummernkreis` — und damit
    // die fünf Systemrollen, die die Migration setzt. Sie werden unten wieder
    // gesetzt: sie sind Stammdaten der Plattform, nicht Fixture-Daten, und
    // ohne sie hat kein Konto eine Rolle.
    await tx.unsafe(`truncate audit_log, anstellung, person, mandant restart identity cascade`);
    await tx.unsafe(`truncate auth.users cascade`);
    // `kern.anmeldeversuch` hängt an keinem Mandanten — `cascade` erreicht es
    // nicht, und ohne diese Zeile tragen sich Fehlversuche von Test zu Test
    // weiter, bis eine Sperre in einem Test zuschlägt, der sie nicht auslöst.
    await tx.unsafe(`truncate kern.anmeldeversuch`);

    /**
     * `dokument_aufbewahrung.mandant_id` zeigt auf `mandant`, also nimmt das
     * `cascade` oben auch die PLATTFORM-Zeilen mit (`mandant_id IS NULL`).
     * Ohne sie faende `app.aufbewahrung_regel` nichts, und jedes Dokument
     * landete mit offener Frist und gesetzter Loeschsperre — sicher, aber
     * nicht das, was die Tests pruefen wollen.
     */
    for (const [kategorie, jahre, sperre, grundlage, platzhalter] of AUFBEWAHRUNG_VORGABE) {
      await tx.unsafe(
        `insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre,
                                            grundlage, ist_platzhalter)
         values (null, $1, $2, $3, $4, $5)`,
        [kategorie, jahre, sperre, grundlage, platzhalter] as never[],
      );
    }
    for (const [schluessel, bezeichnung, bereich, portal, zweiFaktor] of STANDARDROLLEN) {
      await tx.unsafe(
        `insert into rolle (schluessel, bezeichnung, geltungsbereich, portal, erfordert_2fa, ist_system)
         values ($1,$2,$3::rolle_geltungsbereich,$4,$5,true)`,
        [schluessel, bezeichnung, bereich, portal, zweiFaktor] as never[],
      );
    }

    /**
     * Und die Plattform-Vorgaben (`mandant_id IS NULL`) aus §12.
     *
     * `rolle_berechtigung` hängt über `mandant_id` an `mandant` und wird vom
     * `cascade` oben mitgeleert; die Rollen bekommen ausserdem neue ids. Ohne
     * diese Schleife hält nach dem ersten `seed()` niemand mehr irgendein
     * Recht, und jeder Test danach prüft eine Plattform, in der nichts geht.
     */
    const paare = KATALOG.flatMap((e) => e.gebunden.map((r) => [r, e.schluessel]));
    if (paare.length > 0) {
      await tx.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         select r.id, b.id, null, true
           from unnest($1::text[], $2::text[]) as v(rolle, schluessel)
           join rolle r on r.schluessel = v.rolle and r.mandant_id is null
           join berechtigung b on b.schluessel = v.schluessel`,
        [paare.map((x) => x[0]), paare.map((x) => x[1])] as never[],
      );
    }

    const eins = async (anweisung: string, werte: readonly unknown[]): Promise<string> =>
      (await tx.unsafe<{ id: string }[]>(anweisung, werte as never[]))[0]!.id;

    const mandant = async (slug: string, name: string, firma: string): Promise<string> =>
      eins(`insert into mandant (slug, name, firma) values ($1,$2,$3) returning id`, [
        slug, name, firma,
      ]);

    const person = async (v: string, n: string): Promise<string> =>
      eins(`insert into person (vorname, nachname) values ($1,$2) returning id`, [v, n]);

    const anstellung = async (m: string, p: string, nr: string, satz: number): Promise<string> =>
      eins(
        `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, stundensatz_intern)
         values ($1,$2,$3,'2024-01-01',$4) returning id`,
        [m, p, nr, satz],
      );

    // Sequential, not Promise.all: one transaction is one connection, and
    // concurrent statements on it interleave into a single pipeline anyway.
    const r = await mandant('reinigung', 'CSE Dienstleistung', 'CSE Dienstleistungen GmbH');
    const s = await mandant('security', 'SSE Security', 'Select-Security Event GmbH');
    const b = await mandant('bau', 'REALTIME Service', 'REALTIME Service GmbH');
    const o = await mandant('operations', 'CSE Operations', 'CSE Operations');

    const fatima = await person('Fatima', 'Yildiz');
    const jonas = await person('Jonas', 'Berger');

    return {
      reinigung: r,
      security: s,
      bau: b,
      operations: o,
      fatima,
      // The same human, two employments, two entities, two rates (D-09).
      fatimaReinigung: await anstellung(r, fatima, 'R-1001', 1450),
      fatimaSecurity: await anstellung(s, fatima, 'S-2001', 1780),
      jonas,
      jonasReinigung: await anstellung(r, jonas, 'R-1002', 1400),
    };
  }) as Promise<Fixtur>;
}

export async function schliessen(): Promise<void> {
  await sql.end({ timeout: 5 });
}
