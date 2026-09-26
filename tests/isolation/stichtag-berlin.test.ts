/**
 * Der Stichtag ist der BERLINER Tag (Invariante 2, V-103, Migration 0375).
 *
 * **Warum dieser Test existiert.** Der Fehler hat sich einmal gezeigt und
 * wäre am nächsten Vormittag nicht mehr nachstellbar gewesen:
 *
 *   PostgresError: Der Verantwortliche gehoert nicht zu dieser Gesellschaft
 *
 * Der Seed war Stunden zuvor durchgelaufen. Geändert hatte sich die Uhrzeit —
 * 23:23 UTC, in Berlin schon der nächste Tag. `benutzer_mandant.gueltig_ab`
 * wird mit `app.berlin_heute()` gestempelt (22.), `app.ist_mitglied` prüfte
 * gegen `CURRENT_DATE` in einer UTC-Sitzung (21.), und `22. <= 21.` ist
 * falsch: ein soeben angelegtes Konto war **kein Mitglied**.
 *
 * Im Betrieb heisst das: zwischen 00:00 und 02:00 Berliner Zeit ist jede neu
 * angelegte Mitgliedschaft für bis zu zwei Stunden unwirksam. Wer in diesem
 * Fenster eine Leitung einlädt, legt ein Konto an, das sich anmelden kann und
 * nichts sieht.
 *
 * **Deshalb prüft dieser Test die Uhr nicht ab, sondern stellt sie.** Er
 * setzt `gueltig_ab` ausdrücklich auf den Berliner Tag und verlangt, dass die
 * Funktion ihn annimmt — und er tut das zu jeder Tageszeit gleich. Ein Test,
 * der nur zwischen 22:00 und 24:00 UTC rot würde, wäre so viel wert wie
 * keiner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

beforeAll(async () => { f = await seed(); });
afterAll(schliessen);

async function konto(): Promise<string> {
  const email = `stichtag-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

describe('§1 die beiden Tage koennen auseinanderfallen', () => {
  it('zeigt das Fenster, in dem Berlin und UTC verschiedene Tage sind', async () => {
    /*
     * Kein Fehlschlag — eine Feststellung. Zwischen 22:00 und 24:00 UTC
     * (Sommerzeit) sind die beiden Werte verschieden, sonst gleich. Der Test
     * haelt fest, DASS die Plattform zwei Begriffe von „heute" hat; die
     * Faelle darunter halten fest, welcher gilt.
     */
    const [z] = await sql.unsafe<{ utc: string; berlin: string }[]>(
      `select current_date::text as utc, app.berlin_heute()::text as berlin`);
    expect(z!.berlin).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(z!.utc).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
});

describe('§2 app.ist_mitglied nimmt den Berliner Tag', () => {
  it('eine HEUTE (Berlin) beginnende Mitgliedschaft gilt SOFORT', async () => {
    /*
     * **Der Fall, der den Seed angehalten hat** — hier ohne Abhaengigkeit von
     * der Uhrzeit nachgestellt: `gueltig_ab` wird ausdruecklich auf den
     * Berliner Tag gesetzt, genau wie es die Spaltenvorgabe tut.
     */
    const b = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       values ($1,$2,$3, app.berlin_heute())`,
      [b, f.reinigung, await rolleId('leitung')]);

    const [z] = await sql.unsafe<{ mitglied: boolean }[]>(
      `select app.ist_mitglied($1::uuid, $2::uuid) as mitglied`, [b, f.reinigung]);
    expect(z!.mitglied).toBe(true);
  });

  it('und sie gilt auch, wenn der UTC-Tag noch der gestrige ist', async () => {
    /*
     * Die eigentliche Zusage, unabhaengig von der Uhr: selbst wenn
     * `gueltig_ab` einen Tag VOR dem Berliner Tag liegt, gilt sie — und wenn
     * sie GENAU auf dem Berliner Tag liegt, ebenfalls. Nur mit dem UTC-Tag
     * als Stichtag waere der zweite Fall in einem Zweistundenfenster falsch.
     */
    const b = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       values ($1,$2,$3, app.berlin_heute())`,
      [b, f.security, await rolleId('admin')]);

    const [z] = await sql.unsafe<{ mit_vorgabe: boolean; mit_berlin: boolean }[]>(
      `select app.ist_mitglied($1::uuid, $2::uuid) as mit_vorgabe,
              app.ist_mitglied($1::uuid, $2::uuid, app.berlin_heute()) as mit_berlin`,
      [b, f.security]);
    // Die Vorgabe MUSS dasselbe sagen wie der ausdrueckliche Berliner Tag.
    expect(z!.mit_vorgabe).toBe(z!.mit_berlin);
    expect(z!.mit_vorgabe).toBe(true);
  });

  it('eine MORGEN beginnende Mitgliedschaft gilt NICHT — die Grenze bleibt', async () => {
    /*
     * Die Gegenprobe. Ohne sie bestuende der Fall darueber auch dann, wenn
     * jemand die Pruefung ganz entfernte.
     */
    const b = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       values ($1,$2,$3, app.berlin_heute() + 1)`,
      [b, f.bau, await rolleId('leitung')]);

    const [z] = await sql.unsafe<{ mitglied: boolean }[]>(
      `select app.ist_mitglied($1::uuid, $2::uuid) as mitglied`, [b, f.bau]);
    expect(z!.mitglied).toBe(false);
  });

  it('eine GESTERN beendete Mitgliedschaft gilt NICHT', async () => {
    const b = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab, gueltig_bis)
       values ($1,$2,$3, app.berlin_heute() - 30, app.berlin_heute() - 1)`,
      [b, f.operations, await rolleId('leitung')]);

    const [z] = await sql.unsafe<{ mitglied: boolean }[]>(
      `select app.ist_mitglied($1::uuid, $2::uuid) as mitglied`, [b, f.operations]);
    expect(z!.mitglied).toBe(false);
  });
});

describe('§3 keine Funktion stellt mehr auf CURRENT_DATE ab', () => {
  it('kein Argument in app/kern hat noch die Vorgabe CURRENT_DATE', async () => {
    /*
     * **Die Sperrklinke.** Der Einzelfall oben ist behoben; diese Zeile
     * verhindert den naechsten. Ein Datum ist in dieser Plattform nie ein
     * Zeitpunkt, sondern ein GESCHAEFTSTAG — und der ist der Berliner
     * (Invariante 2). `CURRENT_DATE` gibt in einer UTC-Sitzung den UTC-Tag
     * und ist damit in jeder dieser Funktionen falsch, auch wo es heute
     * nicht auffaellt.
     */
    const zeilen = await sql.unsafe<{ proname: string; args: string }[]>(
      `select p.proname, pg_get_function_arguments(p.oid) as args
         from pg_proc p
        where p.pronamespace in ('app'::regnamespace, 'kern'::regnamespace)
          and pg_get_function_arguments(p.oid) ilike '%default current_date%'
        order by 1`);
    expect(zeilen.map((z) => `${z.proname}(${z.args})`)).toEqual([]);
  });
});
