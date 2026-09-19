import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * Das Gueltigkeitsfenster einer Mitgliedschaft zaehlt den BERLINER
 * Kalendertag (0169, K-11/§1.8, Invariante 2).
 *
 * **Der Satz, den diese Datei beweist:** ob jemand ein Recht hat, haengt nicht
 * davon ab, in welcher Zeitzone seine Datenbanksitzung zufaellig steht.
 *
 * **Warum das kein Randfall ist.** `benutzer_mandant.gueltig_ab/gueltig_bis`
 * sind `date`. Sechs Funktionen verglichen sie gegen `current_date` — den
 * Kalendertag der SITZUNGSZEITZONE. Die Verbindung laeuft auf UTC; Berlin ist
 * im Sommer UTC+2. Zwischen 00:00 und 02:00 Berliner Zeit galt damit jede
 * Nacht: eine gestern beendete Mitgliedschaft ist noch gueltig, und eine heute
 * beginnende noch nicht. Das erste ist ein Zugriff, der sein Ende ueberlebt.
 *
 * **Warum die Faelle BEIDE Zonen fahren und nicht „die, die gerade abweicht".**
 * Ein Fall, der sich seine Zone nach der Uhr sucht, prueft vormittags etwas
 * anderes als nachmittags — genau deshalb ist der Befund in CI nie
 * aufgeschlagen, obwohl `recruiting.test.ts` ihn die halbe Zeit fing. Hier
 * laufen immer beide: eine Zone vor Berlin, eine dahinter. Was bewiesen wird,
 * ist die Unabhaengigkeit, nicht ein Tag.
 */

/** Eine Zone vor Berlin und eine dahinter — zusammen decken sie jede Stunde ab. */
const ZONEN = ['Etc/GMT-14', 'Etc/GMT+12', 'Europe/Berlin', 'UTC'] as const;

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * Ein Konto mit einer Mitgliedschaft, deren Fenster in BERLINER Tagen gesetzt
 * ist — relativ zu `app.berlin_heute()` und nie zu `current_date`, sonst
 * bestimmte die Zeitzone des Fixturlaufs, was der Fall ueberhaupt behauptet.
 */
async function kontoMitFenster(
  mandantId: string, abVersatz: number, bisVersatz: number | null,
): Promise<string> {
  const email = `fenster-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Fensterprobe', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant
       (benutzer_id, mandant_id, rolle_id, ist_standard, gueltig_ab, gueltig_bis)
     values ($1, $2,
             (select id from rolle where schluessel = 'leitung' and mandant_id is null),
             true,
             app.berlin_heute() + $3::int,
             case when $4::int is null then null else app.berlin_heute() + $4::int end)`,
    [u!.id, mandantId, String(abVersatz), bisVersatz === null ? null : String(bisVersatz)]);
  return u!.id;
}

/** `app.hat_recht` in einer Sitzung, deren Zeitzone gesetzt ist. */
async function rechtInZone(benutzerId: string, zone: string): Promise<boolean> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.reinigung, benutzerId,
      portal: 'intern', readonly: true,
    },
    async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`set local timezone to '${zone}'`);
      const [z] = (await tx.unsafe(
        `select app.hat_recht('objekt.lesen', app.aktiver_mandant()) as ok`,
      )) as unknown as { ok: boolean }[];
      return z!.ok;
    },
  );
}

beforeAll(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('§1 kein Gueltigkeitsfenster haengt mehr an der Sitzungszeitzone', () => {
  it('keine Funktion prueft gueltig_ab/gueltig_bis gegen current_date', async () => {
    const treffer = await sql.unsafe<{ name: string }[]>(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('app', 'kern', 'fin', 'public')
          and p.prosrc ~ 'gueltig_(ab|bis)[^\n]*current_date'
        order by 1`);
    expect(treffer.map((t) => t.name)).toEqual([]);
  });

  it('…und die sechs, die es betraf, fragen wirklich app.berlin_heute()', async () => {
    /*
     * Der Gegen-Check zu §1: ein leerer Katalog — eine Datenbank ohne diese
     * Funktionen — machte den Fall oben gruen, ohne irgendetwas zu beweisen.
     */
    const treffer = await sql.unsafe<{ name: string }[]>(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.prosrc ~ 'gueltig_(ab|bis)[^\n]*berlin_heute'
        order by 1`);
    expect(treffer.map((t) => t.name)).toEqual([
      'app.benutzer_mit_recht',
      'app.darf_gruppenansicht',
      'app.hat_recht_fuer',
      'app.kalender_feed_aufloesen',
      'app.kennwort_anmelden',
      'app.switcher_mandanten',
    ]);
  });

  it('die Vorgabe der Spalte ist der Berliner Tag, nicht current_date', async () => {
    const [z] = await sql.unsafe<{ vorgabe: string }[]>(
      `select column_default as vorgabe
         from information_schema.columns
        where table_name = 'benutzer_mandant' and column_name = 'gueltig_ab'`);
    expect(z!.vorgabe).toContain('berlin_heute');
    expect(z!.vorgabe.toLowerCase()).not.toContain('current_date');
  });
});

describe('§2 eine heute beginnende Mitgliedschaft gilt in jeder Zone', () => {
  it('gibt in allen vier Zonen dieselbe Antwort: ja', async () => {
    const konto = await kontoMitFenster(f.reinigung, 0, null);
    for (const zone of ZONEN) {
      expect(await rechtInZone(konto, zone), `Zone ${zone}`).toBe(true);
    }
  });
});

describe('§3 eine gestern beendete Mitgliedschaft gilt in keiner Zone', () => {
  it('gibt in allen vier Zonen dieselbe Antwort: nein', async () => {
    /*
     * **Die gefaehrliche Richtung.** Mit `current_date` stand die Sitzung auf
     * UTC nachts noch auf gestern — `gueltig_bis >= current_date` war wahr,
     * und ein entzogener Zugang lebte zwei Stunden weiter.
     */
    const konto = await kontoMitFenster(f.reinigung, -30, -1);
    for (const zone of ZONEN) {
      expect(await rechtInZone(konto, zone), `Zone ${zone}`).toBe(false);
    }
  });

  it('…und eine heute endende gilt noch, sonst prueft §3 nur „immer nein"', async () => {
    const konto = await kontoMitFenster(f.reinigung, -30, 0);
    for (const zone of ZONEN) {
      expect(await rechtInZone(konto, zone), `Zone ${zone}`).toBe(true);
    }
  });
});

describe('§4 dasselbe fuer den Bereichsumschalter', () => {
  it('app.switcher_mandanten zeigt den Bereich in jeder Zone', async () => {
    const konto = await kontoMitFenster(f.reinigung, 0, 0);
    for (const zone of ZONEN) {
      const gesehen = await alsApp(
        {
          scope: 'mandant', mandantId: f.reinigung, benutzerId: konto,
          portal: 'intern', readonly: true,
        },
        async (tx: postgres.TransactionSql) => {
          await tx.unsafe(`set local timezone to '${zone}'`);
          const zeilen = (await tx.unsafe(
            `select unnest(app.switcher_mandanten()) as id`)) as unknown as { id: string }[];
          return zeilen.map((z) => z.id);
        },
      );
      expect(gesehen, `Zone ${zone}`).toContain(f.reinigung);
    }
  });
});
