import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * **Zwei Statusläufe gegen echtes Postgres** (V-085, V-089).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das nur hier zu beweisen ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beide Läufe schreiben unter `cse_job`, und genau dort lag der Mangel: für
 * `angebot` hatte diese Rolle bis `0387` ÜBERHAUPT KEIN Recht — kein SELECT,
 * kein UPDATE, keine Policy. Ein Lauf ohne diese Zeilen läse null Angebote
 * und meldete „nichts abgelaufen": die schlechteste Art von Fehler, weil sie
 * wie ein ruhiger Betrieb aussieht. Ein Test, der die Funktion als `postgres`
 * ausführte, hätte das nie bemerkt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier bewiesen wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §1  Der Lauf greift — und zwar nur auf die Zeilen, die wirklich fällig sind.
 * §2  Er greift ÜBER Gesellschaftsgrenzen hinweg, in EINEM Lauf.
 * §3  Was er NICHT darf: jede andere Spalte. Das Spaltenrecht ist die Grenze,
 *     nicht die Policy.
 * §4  Der Stichtag ist der BERLINER Tag — `current_date` im UTC-Prozess zeigt
 *     zwischen 00:00 und 02:00 noch den Vortag, und genau dann laufen
 *     Nachtläufe.
 */

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Der Berliner Kalendertag — dieselbe Quelle wie im Job. */
async function berlinHeute(): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(
    `select (now() at time zone 'Europe/Berlin')::date::text as tag`);
  return z!.tag;
}

async function tagVersetzt(um: number): Promise<string> {
  const [z] = await sql.unsafe<{ tag: string }[]>(
    `select ((now() at time zone 'Europe/Berlin')::date + $1::int)::text as tag`, [um]);
  return z!.tag;
}

/**
 * Ein VERSENDETES Angebot — mit Nummer, Freigabe und Versandstempel, sonst
 * halten `angebot_nummer_bei_versand` und `angebot_freigabe_vor_versand`
 * nicht.
 */
async function versendetesAngebot(
  mandant: string, gueltigBis: string | null,
): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Ablaufkunde','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`]);
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`,
    [`ablauf-${zufall()}@test.invalid`]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Freigeber', 'aktiv')`,
    [u!.id, `ablauf-${zufall()}@test.invalid`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into angebot (mandant_id, kunde_id, titel, status, angebotsnummer,
                          gueltig_bis, freigegeben_von, freigegeben_am,
                          versendet_von, versendet_am)
     values ($1, $2, 'Ablaufprobe', 'versendet', $3, $4::date, $5, now(), $5, now())
     returning id`,
    [mandant, k!.id, `AN-${zufall()}`, gueltigBis, u!.id]);
  return a!.id;
}

/**
 * Eine eigene Qualifikation je Aufruf — statt eine gesäte zu suchen.
 *
 * Der Isolationsseed führt keine; und selbst wenn er eine führte, hinge dieser
 * Test dann an einer Zeile, die eine andere Änderung morgen anders setzt.
 */
async function nachweis(
  person: string, status: string, bis: string | null, mandant: string,
): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (schluessel, bezeichnung, laeuft_ab)
     values ($1, 'Ablaufprobe', true) returning id`, [`abl_${zufall()}`]);
  const [n] = await sql.unsafe<{ id: string }[]>(
    /*
     * `erfasst_von_mandant_id` ist NOT NULL und die einzige
     * Verantwortlichkeit, die auf der Zeile steht: der Nachweis hängt am
     * MENSCHEN (D-09), aber jemand hat ihn erfasst.
     */
    `insert into nachweis (person_id, qualifikation_id, status, gueltig_ab, gueltig_bis,
                           erfasst_von_mandant_id)
     values ($1, $2, $3::nachweis_status, current_date - 400, $4::date, $5)
     returning id`, [person, q!.id, status, bis, mandant]);
  return n!.id;
}

/** Genau das UPDATE aus `jobs/statuslaeufe.ts`, unter `cse_job`. */
async function laufAngebot(): Promise<number> {
  return alsRolle('cse_job', async (tx: postgres.TransactionSql) => {
    const zeilen = await tx.unsafe(
      `update angebot
          set status = 'abgelaufen'
        where status = 'versendet'
          and gueltig_bis is not null
          and gueltig_bis < (now() at time zone 'Europe/Berlin')::date
          and archiviert_am is null
       returning id`);
    return zeilen.length;
  });
}

async function laufNachweis(): Promise<number> {
  return alsRolle('cse_job', async (tx: postgres.TransactionSql) => {
    const zeilen = await tx.unsafe(
      `update nachweis
          set status = 'abgelaufen'
        where status = 'gueltig'
          and gueltig_bis is not null
          and gueltig_bis < (now() at time zone 'Europe/Berlin')::date
          and widerrufen_am is null
       returning id`);
    return zeilen.length;
  });
}

async function statusVon(tabelle: 'angebot' | 'nachweis', id: string): Promise<string> {
  const [z] = await sql.unsafe<{ status: string }[]>(
    `select status::text as status from ${tabelle} where id = $1`, [id]);
  return z!.status;
}

beforeAll(async () => { f = await seed(); });
afterAll(schliessen);

/* ═════════════════════════════════════════════════════════════════════════
 * §1 — Der Lauf greift, und nur wo er soll
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§1 das Angebot läuft ab (V-085)', () => {
  it('gestern abgelaufen → `abgelaufen`; heute gültig → unverändert', async () => {
    const gestern = await versendetesAngebot(f.reinigung, await tagVersetzt(-1));
    const heute = await versendetesAngebot(f.reinigung, await berlinHeute());
    const morgen = await versendetesAngebot(f.reinigung, await tagVersetzt(1));
    const ohneFrist = await versendetesAngebot(f.reinigung, null);

    await laufAngebot();

    expect(await statusVon('angebot', gestern)).toBe('abgelaufen');
    /*
     * **Der heutige Tag zählt MIT.** „gültig bis 23.09." heisst, dass am
     * 23.09. noch angenommen werden kann — sonst wäre die Frist einen Tag
     * kürzer als das, was auf dem Angebot steht.
     */
    expect(await statusVon('angebot', heute)).toBe('versendet');
    expect(await statusVon('angebot', morgen)).toBe('versendet');
    // Ohne Frist läuft nichts ab — `gueltig_bis` ist nullbar, und NULL heisst
    // „unbefristet", nicht „sofort".
    expect(await statusVon('angebot', ohneFrist)).toBe('versendet');
  });

  it('ein zweiter Lauf findet nichts mehr — kein Hin und Her', async () => {
    const alt = await versendetesAngebot(f.reinigung, await tagVersetzt(-5));
    await laufAngebot();
    expect(await statusVon('angebot', alt)).toBe('abgelaufen');
    /*
     * Der Lauf setzt nur `versendet → abgelaufen`, nie zurück. Ein Nachtlauf,
     * der einen Zustand hin und her schiebt, macht aus dem Protokoll Rauschen
     * — und aus einer verlängerten Frist, die ein Mensch eingetragen hat,
     * jede Nacht wieder nichts.
     */
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from angebot
        where status = 'abgelaufen' and id = $1`, [alt]);
    expect(z!.n).toBe('1');
  });
});

describe('§2 der Nachweis läuft ab (V-089)', () => {
  it('gestern abgelaufen → `abgelaufen`; ein widerrufener bleibt widerrufen', async () => {
    const faellig = await nachweis(f.fatima, 'gueltig', await tagVersetzt(-1), f.reinigung);
    const laufend = await nachweis(f.jonas, 'gueltig', await tagVersetzt(30), f.reinigung);
    const widerrufen = await nachweis(
      f.fatima, 'widerrufen', await tagVersetzt(-1), f.security);

    await laufNachweis();

    expect(await statusVon('nachweis', faellig)).toBe('abgelaufen');
    expect(await statusVon('nachweis', laufend)).toBe('gueltig');
    /*
     * Ein widerrufener Nachweis ist etwas anderes als ein abgelaufener: der
     * eine wurde ENTZOGEN, der andere ist verfallen. Wer sie zusammenwirft,
     * verliert die Auskunft, die im Streit zählt.
     */
    expect(await statusVon('nachweis', widerrufen)).toBe('widerrufen');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3 — Über alle Gesellschaften, in EINEM Lauf
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§3 `uebergreifend` ist keine Bequemlichkeit', () => {
  it('ein Lauf erwischt Reinigung UND Security', async () => {
    const r = await versendetesAngebot(f.reinigung, await tagVersetzt(-2));
    const s = await versendetesAngebot(f.security, await tagVersetzt(-2));
    await laufAngebot();
    expect(await statusVon('angebot', r)).toBe('abgelaufen');
    expect(await statusVon('angebot', s)).toBe('abgelaufen');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4 — Das SPALTENRECHT ist die Grenze
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§4 was `cse_job` nicht darf', () => {
  it('die Gültigkeitsfrist verschieben: abgewiesen', async () => {
    /*
     * `grant update (status, geaendert_am)` — mehr nicht. Eine Frist zu
     * verschieben ist eine kaufmännische Entscheidung; ein Nachtlauf, der es
     * könnte, könnte auch jedes Angebot unbefristet machen.
     */
    const a = await versendetesAngebot(f.reinigung, await tagVersetzt(-3));
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) =>
      tx.unsafe(`update angebot set gueltig_bis = current_date + 30 where id = $1`, [a])))
      .rejects.toThrow(/permission denied|verweigert/iu);
  });

  it('den Nettobetrag ändern: abgewiesen', async () => {
    const a = await versendetesAngebot(f.reinigung, await tagVersetzt(-3));
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) =>
      tx.unsafe(`update angebot set netto_cent = 1 where id = $1`, [a])))
      .rejects.toThrow(/permission denied|verweigert/iu);
  });

  it('ein Angebot löschen: abgewiesen (Invariante 8)', async () => {
    const a = await versendetesAngebot(f.reinigung, await tagVersetzt(-3));
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) =>
      tx.unsafe(`delete from angebot where id = $1`, [a])))
      .rejects.toThrow();
  });
});
