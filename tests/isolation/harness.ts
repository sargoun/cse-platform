/**
 * The isolation harness. Every test here runs against a REAL Postgres with
 * RLS on and FORCE set, as the `cse_app` role — never as the owner, because
 * an owner without FORCE bypasses its own policies and every assertion below
 * would pass for the wrong reason.
 */
import postgres from 'postgres';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { workerUrl } from './parallel.js';

/**
 * Die Datenbank DIESES Arbeiters (D-424): `cse_test_w<VITEST_POOL_ID>`.
 *
 * Vitest gibt jedem Arbeiter eine Nummer, `global-setup.ts` hat fuer jede
 * Nummer einen Klon der migrierten `cse_test` angelegt. Zwei Dateien in zwei
 * Arbeitern sehen einander damit nie — was `fileParallelism: false` bisher
 * dadurch erreichte, dass es nur einen Arbeiter gab.
 */
export const BASIS_URL = process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';
export const DB_URL = workerUrl(BASIS_URL, process.env['VITEST_POOL_ID']);

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
 * bereich, Portal, 2FA-Pflicht. Sie stehen hier, weil das Zuruecksetzen in
 * `seed()` sie mitnimmt und jeder Test sie wieder braucht.
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

/** Die Abwesenheitsarten aus `0073` §6.22 — Schlüssel, Label, drei Flaggen. */
const ABWESENHEITSARTEN:
readonly (readonly [string, string, boolean, boolean, boolean])[] = [
  ['urlaub', 'Urlaub', true, true, false],
  ['krankheit', 'Krankheit', false, true, true],
  ['kind_krank', 'Kind krank', false, true, true],
  ['unbezahlt', 'Unbezahlte Freistellung', false, false, false],
  ['fortbildung', 'Fortbildung', false, true, false],
  ['freizeitausgleich', 'Freizeitausgleich', false, false, false],
  ['sonstige', 'Sonstige', false, false, false],
];

/** Die drei Antragsarten aus `0074` §6.28, die EMP-10 nennt. */
const ANTRAGSARTEN:
readonly (readonly [string, string, boolean, boolean, boolean, boolean, boolean])[] = [
  ['urlaub', 'Urlaubsantrag', true, true, false, false, true],
  ['krankmeldung', 'Krankmeldung', true, true, false, false, true],
  ['schichttausch', 'Schichttausch', false, false, true, true, false],
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
 *
 * **Geleert wird mit `DELETE`, nicht mit `TRUNCATE` — seit D-424.** Bis dahin
 * stand hier `truncate audit_log, anstellung, person, mandant restart identity
 * cascade` (plus `auth.users cascade` und `kern.anmeldeversuch`). Der Cascade
 * erreicht rund 150 Tabellen, und TRUNCATE gibt JEDER davon und jedem ihrer
 * Indexe eine neue Datei — gemessen eine Sekunde je Aufruf, ob die Tabellen
 * voll sind oder leer. `seed()` laeuft vor fast jedem der 1266 Tests; das
 * waren zwanzig Minuten Dateiverwaltung je Lauf. In einem Test sind fast alle
 * dieser Tabellen leer, und eine leere Tabelle kostet als `exists` einen
 * Bruchteil einer Millisekunde. Der Block unten liest dieselbe Menge aus dem
 * Katalog — ueber genau die Fremdschluessel, denen auch CASCADE folgt —,
 * loescht nur, wo Zeilen stehen, und setzt die Sequenzen dieser Tabellen
 * zurueck wie RESTART IDENTITY: 0,1 s statt 1 s, mit demselben Ergebnis.
 * `replica` bleibt dabei aus demselben Grund gesetzt wie oben: die Wachen
 * gegen Loeschen (Invariante 8), die Fremdschluessel und die Audit-Ausloeser
 * schweigen nur dort, und nur bis zum Ende dieser Transaktion.
 */

/**
 * Die Wurzeln des Zuruecksetzens — dieselben, die der TRUNCATE nannte.
 *
 * `cascade` erreichte ueber die FKs auf `mandant` auch `rolle`, `benutzer`,
 * `benutzer_mandant`, `benutzer_sitzung` und `nummernkreis` — und damit die
 * fuenf Systemrollen, die die Migration setzt. Sie werden in `seed()` wieder
 * gesetzt: sie sind Stammdaten der Plattform, nicht Fixture-Daten, und ohne
 * sie hat kein Konto eine Rolle. `kern.anmeldeversuch` haengt an keinem
 * Mandanten und steht deshalb ausdruecklich hier: ohne diese Wurzel tragen
 * sich Fehlversuche von Test zu Test weiter, bis eine Sperre in einem Test
 * zuschlaegt, der sie nicht ausloest.
 */
const RESET_WURZELN = [
  ['public', 'audit_log'], ['public', 'anstellung'], ['public', 'person'], ['public', 'mandant'],
  ['auth', 'users'], ['kern', 'anmeldeversuch'],
] as const;

const LEEREN = `
do $$
declare t record; s record; voll boolean;
begin
  for t in
    with recursive r(oid) as (
      select c.oid from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where (ns.nspname, c.relname) in (${RESET_WURZELN.map(([ns, r]) => `('${ns}','${r}')`).join(',')})
      union
      select con.conrelid from pg_constraint con join r on con.confrelid = r.oid
       where con.contype = 'f')
    select ns.nspname, c.relname, c.oid
      from r join pg_class c on c.oid = r.oid join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind in ('r', 'p')
  loop
    execute format('select exists (select 1 from %I.%I)', t.nspname, t.relname) into voll;
    if voll then
      execute format('delete from %I.%I', t.nspname, t.relname);
    end if;
    -- RESTART IDENTITY: die Sequenzen, die Spalten dieser Tabelle gehoeren
    -- (serial: deptype a, identity: deptype i) — und nur die, die je gezogen
    -- wurden; eine unbenutzte steht schon am Anfang. Die Pruefung steht im
    -- Rumpf und nicht in der Abfrage: der Planer darf pg_sequence_last_value
    -- vor dem relkind-Filter auswerten, und auf der TOAST-Tabelle (auch
    -- deptype i) wirft sie "is not a sequence".
    for s in
      select sq.oid, sq.relname, sn.nspname
        from pg_depend d
        join pg_class sq on sq.oid = d.objid and sq.relkind = 'S'
        join pg_namespace sn on sn.oid = sq.relnamespace
       where d.refobjid = t.oid and d.deptype in ('a', 'i')
    loop
      if pg_sequence_last_value(s.oid) is not null then
        execute format('alter sequence %I.%I restart', s.nspname, s.relname);
      end if;
    end loop;
  end loop;
end $$`;

export async function seed(): Promise<Fixtur> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(LEEREN);

    /**
     * `dokument_aufbewahrung.mandant_id` zeigt auf `mandant`, also nimmt das
     * Zuruecksetzen oben auch die PLATTFORM-Zeilen mit (`mandant_id IS NULL`).
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
    /**
     * Die beiden Personal-Kataloge aus `0073`/`0074`.
     *
     * Sie kommen mit der MIGRATION und nicht aus dem Seed — und das
     * Zuruecksetzen oben nimmt sie trotzdem mit, weil beide über `mandant_id`
     * an `mandant` hängen (auch die Zeilen mit `mandant_id IS NULL`: geleert
     * wird die Tabelle, nicht nur die verweisenden Zeilen). Ohne diese
     * Schleife scheitert jeder Abwesenheitstest an einem Fremdschlüssel — und
     * zwar mit einer Meldung, die nach einem Fehler im Dienst aussieht.
     *
     * `bezahlt` bleibt NULL, wie ausgeliefert (O-139): ein Test, der die
     * Lohnfrage beantwortet bekommt, ohne sie zu stellen, prüft eine Plattform,
     * die es nicht gibt.
     */
    for (const [schluessel, bezeichnung, urlaub, stunden, gesundheit] of ABWESENHEITSARTEN) {
      await tx.unsafe(
        `insert into abwesenheitsart (mandant_id, schluessel, bezeichnung,
                                      zaehlt_auf_urlaubskonto,
                                      erzeugt_stundenkonto_bewegung,
                                      ist_gesundheitsbezogen)
         values (null, $1, $2, $3, $4, $5)`,
        [schluessel, bezeichnung, urlaub, stunden, gesundheit] as never[],
      );
    }
    for (const [schluessel, bezeichnung, zeitraum, art, einsatz, partner, erzeugt]
      of ANTRAGSARTEN) {
      await tx.unsafe(
        `insert into antragsart (mandant_id, schluessel, bezeichnung, erfordert_zeitraum,
                                 erfordert_abwesenheitsart, erfordert_einsatz,
                                 erfordert_tauschpartner, erzeugt_abwesenheit, ist_system)
         values (null, $1, $2, $3, $4, $5, $6, $7, true)`,
        [schluessel, bezeichnung, zeitraum, art, einsatz, partner, erzeugt] as never[],
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
     * Zuruecksetzen oben mitgeleert; die Rollen bekommen ausserdem neue ids. Ohne
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

    /**
     * Mit Anschrift und Telefon: der NAP-Block (PUB-08) kommt aus diesen
     * Spalten, und eine Fixtur ohne sie prueft eine Seite, die es so nicht
     * gibt.
     */
    const mandant = async (slug: string, name: string, firma: string): Promise<string> =>
      eins(
        `insert into mandant (slug, name, firma, strasse, plz, ort, land, telefon, email)
         values ($1,$2,$3,'Kurfürstendamm 21','10719','Berlin','DE','+49 30 555 0100',$4)
         returning id`,
        [slug, name, firma, `kontakt@${slug}.cse-gruppe.de`],
      );

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
