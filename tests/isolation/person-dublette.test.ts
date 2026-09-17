/**
 * Personendubletten gegen echtes Postgres: Zeiger, Aufloeser, Vorgang
 * (D-09, LEG-09, Invariante 8, Invariante 9, 01-KERN §6.13, 0194).
 *
 * **Warum eine Zusammenfuehrung keine Zeile umhaengt — und warum das geprueft
 * wird.** 50 Tabellen haben einen Fremdschluessel auf `person`, die
 * Zeitdomaene traegt `person_id` denormalisiert in zusammengesetzten
 * Fremdschluesseln OHNE `on update cascade`, und ein Teil der Kindzeilen ist
 * eingefroren. Die naheliegende Umsetzung — `update anstellung set person_id =
 * <ueberlebender>` — scheitert an genau diesen Kindzeilen, und eine, die es
 * dennoch versucht, laesst eine halbe Zusammenfuehrung zurueck. Die Tests
 * unten halten fest, dass der Zeiger die Identitaet traegt und die Geschichte
 * unangetastet bleibt.
 *
 * **Und warum der Aufloeser dazugehoert.** Ohne `app.person_kanonisch` zeigt
 * die Plattform nach dem Zusammenfuehren weiter zwei Menschen — und
 * ArbZG-Grenzen, die nach Invariante 9 je PERSON aggregieren, aggregieren
 * weiter falsch. Der Zeiger allein ist die halbe Haelfte.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let darfMergen = '';
let darfNicht = '';
/** Die Dublette von Fatima — angelegt je Test, mit eigener Beschaeftigung. */
let dublette = '';
let dubletteAnstellung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleMit(
  mandant: string, schluessel: string, rechte: readonly string[],
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `${schluessel}_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

beforeEach(async () => {
  f = await seed();
  darfMergen = await konto('merge');
  darfNicht = await konto('planung');
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [darfMergen, f.reinigung, await rolleMit(f.reinigung, 'merge', [
      'personal.lesen', 'personal.schreiben', 'personal.zusammenfuehren',
    ])]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [darfNicht, f.reinigung, await rolleMit(f.reinigung, 'planung', [
      'personal.lesen', 'personal.schreiben',
    ])]);

  /*
   * Der Seed hat KEINE Dublette (12 Personen, eine mit zwei Beschaeftigungen —
   * das ist D-09, keine Dublette). Ohne diesen Fall ist die Seite unpruefbar.
   */
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Fatma', 'Yildiz') returning id`);
  dublette = p!.id;
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
     values ($1, $2, 'R-1099', '2024-03-01', 'aktiv') returning id`,
    [f.reinigung, dublette]);
  dubletteAnstellung = a!.id;
});
afterAll(schliessen);

describe('(1) der Zeiger gehoert dem Vorgang, nicht der Maske', () => {
  it('`cse_app` kann `zusammengefuehrt_in_person_id` nicht schreiben', async () => {
    const [z] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_column_privilege('cse_app', 'person',
                                   'zusammengefuehrt_in_person_id', 'UPDATE') as ok`);
    expect(z?.ok).toBe(false);
    await expect(
      als(darfMergen, (tx) =>
        tx`update person set zusammengefuehrt_in_person_id = ${f.fatima}
            where id = ${dublette}`),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('lesen darf sie jeder, der die Person sieht — sonst waere der Hinweis unmoeglich', async () => {
    const [z] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_column_privilege('cse_app', 'person',
                                   'zusammengefuehrt_in_person_id', 'SELECT') as ok`);
    expect(z?.ok).toBe(true);
  });
});

describe('(2) app.person_zusammenfuehren', () => {
  it('setzt den Zeiger und schreibt eine Auditzeile mit beiden Kennungen', async () => {
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt angelegt')`);

    const [zeile] = await sql.unsafe<{ ziel: string | null }[]>(
      `select zusammengefuehrt_in_person_id as ziel from person where id = $1`, [dublette]);
    expect(zeile?.ziel).toBe(f.fatima);

    const [audit] = await sql.unsafe<{ objekt: string; nachher: unknown }[]>(
      `select objekt_id as objekt, nachher from audit_log
        where aktion = 'personal.person_zusammengefuehrt' order by erstellt_am desc limit 1`);
    expect(audit?.objekt).toBe(dublette);
    expect(JSON.stringify(audit?.nachher)).toContain(f.fatima);
    expect(JSON.stringify(audit?.nachher)).toContain('Doppelt angelegt');
  });

  it('OHNE `personal.zusammenfuehren` wirft sie', async () => {
    await expect(
      als(darfNicht, (tx) =>
        tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'egal')`),
    ).rejects.toThrow(/nicht berechtigt/u);
  });

  it('ohne Begruendung wirft sie', async () => {
    await expect(
      als(darfMergen, (tx) =>
        tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, '   ')`),
    ).rejects.toThrow(/ohne Begründung/u);
  });

  it('eine Zusammenfuehrung wird nicht ueberschrieben (Invariante 8)', async () => {
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt')`);
    await expect(
      als(darfMergen, (tx) =>
        tx`select app.person_zusammenfuehren(${dublette}, ${f.jonas}, 'Nochmal')`),
    ).rejects.toThrow(/bereits zusammengeführt/u);
  });

  it('ein Mensch aus einer FREMDEN Gesellschaft wird abgewiesen — mit Begruendung (O-611)', async () => {
    /*
     * `fatimaSecurity` gehoert der Schwestergesellschaft. Aus der Reinigung
     * darueber zu entscheiden hiesse, ueber einen Menschen zu entscheiden, den
     * diese Gesellschaft nicht fuehrt — und die Regel dafuer ist offen. Der
     * Satz nennt den Grund statt „nicht gefunden".
     */
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Fatma', 'Yilidz') returning id`);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
       values ($1, $2, 'S-9099', '2024-03-01')`, [f.security, fremd!.id]);
    await expect(
      als(darfMergen, (tx) =>
        tx`select app.person_zusammenfuehren(${fremd!.id}, ${f.fatima}, 'Dublette')`),
    ).rejects.toThrow(/O-611/u);
  });

  it('in der Gruppenansicht fuehrt niemand zusammen (Invariante 10)', async () => {
    await expect(
      alsApp(
        {
          scope: 'gruppe', mandantIds: [f.reinigung, f.security],
          benutzerId: darfMergen, readonly: true,
        },
        (tx) => tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Dublette')`),
    ).rejects.toThrow(/aktive Gesellschaft|Gruppenansicht/u);
  });
});

describe('(3) kein Selbstbezug, keine Ketten', () => {
  it('ein Mensch ist keine Dublette von sich selbst', async () => {
    await expect(
      sql.unsafe(
        `update person set zusammengefuehrt_in_person_id = id where id = $1`, [dublette]),
    ).rejects.toThrow(/keine Dublette von sich selbst/u);
  });

  it('eine Kette A → B → C ist ausgeschlossen', async () => {
    /*
     * Beide Richtungen: das Zeigen AUF eine zusammengefuehrte Zeile und das
     * Zusammenfuehren einer Zeile, auf die schon jemand zeigt. Die zweite fehlt
     * in der naheliegenden Umsetzung — und genau sie erzeugt die Kette.
     */
    const [dritte] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Fatime', 'Yildiz') returning id`);
    await sql.unsafe(
      `update person set zusammengefuehrt_in_person_id = $2 where id = $1`,
      [dublette, f.fatima]);

    await expect(
      sql.unsafe(`update person set zusammengefuehrt_in_person_id = $2 where id = $1`,
        [dritte!.id, dublette]),
    ).rejects.toThrow(/schon zusammengeführt/u);

    await expect(
      sql.unsafe(`update person set zusammengefuehrt_in_person_id = $2 where id = $1`,
        [f.fatima, dritte!.id]),
    ).rejects.toThrow(/führende Zeile/u);
  });
});

describe('(4) der Aufloeser (Invariante 9)', () => {
  it('`app.person_kanonisch` loest den Zeiger auf — und laesst eine freie Zeile in Ruhe', async () => {
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt')`);
    const zeilen = await als(darfMergen, (tx) =>
      tx`select app.person_kanonisch(${dublette}) as aus_dublette,
                app.person_kanonisch(${f.fatima})  as aus_fuehrend,
                app.person_kanonisch(${f.jonas})   as unberuehrt`);
    expect(zeilen[0]?.['aus_dublette']).toBe(f.fatima);
    expect(zeilen[0]?.['aus_fuehrend']).toBe(f.fatima);
    expect(zeilen[0]?.['unberuehrt']).toBe(f.jonas);
  });

  it('`app.person_identitaeten` liefert BEIDE Kennungen — von jeder Seite gefragt', async () => {
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt')`);
    for (const start of [dublette, f.fatima]) {
      const zeilen = await als(darfMergen, (tx) =>
        tx`select t as id from app.person_identitaeten(${start}) as t`);
      const ids = zeilen.map((z) => z['id']).sort();
      expect(ids, `von ${start} aus`).toEqual([dublette, f.fatima].sort());
    }
  });
});

describe('(5) die Geschichte bleibt, wo sie entstanden ist', () => {
  it('die Beschaeftigung der Dublette bleibt bei der Dublette', async () => {
    /*
     * Das ist die Zusage, nicht ein Mangel: `anstellung.person_id`
     * umzuschreiben scheitert an den Kindzeilen mit zusammengesetztem
     * Fremdschluessel `(anstellung_id, person_id)`, und die eingefrorenen
     * Kindzeilen (`zeiteintrag`, `wachbuch_eintrag`, …) weisen ein UPDATE
     * ohnehin ab. Die Identitaet traegt der Zeiger, die Kosten tragen die
     * Beschaeftigungen — und `anstellung_id` ist der Schluessel, an dem alles
     * Kostenwirksame haengt (Invariante 9).
     */
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt')`);
    const [zeile] = await sql.unsafe<{ person: string }[]>(
      `select person_id as person from anstellung where id = $1`, [dubletteAnstellung]);
    expect(zeile?.person).toBe(dublette);
  });

  it('und die veraltete Zeile bleibt LESBAR — nichts wird geloescht (Invariante 8)', async () => {
    await als(darfMergen, (tx) =>
      tx`select app.person_zusammenfuehren(${dublette}, ${f.fatima}, 'Doppelt')`);
    const zeilen = await als(darfMergen, (tx) =>
      tx`select id, vorname, nachname, zusammengefuehrt_in_person_id as ziel
           from person where id = ${dublette}`);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.['ziel']).toBe(f.fatima);
  });
});
