/**
 * Das Nachweisregister gegen die echte Datenbank (SEC-02, SEC-03, EMP-08).
 *
 * Zwei Dinge, die nur hier zu pruefen sind:
 *
 * **Die Warnung gehoert zu EINEM Ablaufdatum.** `nachweis_warnung` haelt das
 * Datum fest, auf das sich die Stufe bezieht. Wird ein Nachweis verlaengert,
 * stehen die alten Quittungen weiter da — und duerfen fuer das NEUE Datum
 * nicht mehr zaehlen, sonst laege das Register still darueber, dass noch
 * niemand gewarnt wurde.
 *
 * **Die Mandantenwand laeuft ueber den MENSCHEN**, nicht ueber die
 * Beschaeftigung: ein Nachweis haengt an `person_id` (D-09), sichtbar ist er,
 * wo die Person beschaeftigt ist. Eine Person ohne Beschaeftigung im aktiven
 * Bereich taucht nicht auf — auch nicht mit ihrem § 34a-Nachweis.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import {
  lageVon, leseNachweis, leseRegister, leseWarnungen,
} from '../../src/app/portal/[mandant]/personal/nachweise/daten.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein fester Stichtag — „heute" waere ein Test, der im Winter anders faellt. */
const STICHTAG = '2026-06-15';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function leitung(mandant: string): Promise<string> {
  const email = `nachweis-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId('leitung')] as never[]);
  return u!.id;
}

async function qualifikation(opts: {
  mandant: string; schluessel: string; sperrt: boolean; stufen?: readonly number[];
}): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                laeuft_ab, warnung_tage, blockiert_einsatz)
     values ($1, $2, $3, 'gesetzlich', true, $4::int[], $5)
     returning id`,
    [opts.mandant, opts.schluessel, `Probe ${opts.schluessel}`,
      `{${(opts.stufen ?? [60, 30, 7]).join(',')}}`, opts.sperrt] as never[]);
  return q!.id;
}

async function nachweis(opts: {
  person: string; qualifikation: string; mandant: string;
  gueltigAb: string; gueltigBis: string | null;
  status?: 'gueltig' | 'abgelaufen' | 'widerrufen';
}): Promise<string> {
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1, $2, $3::date, $4::date, $5::nachweis_status, $6)
     returning id`,
    [opts.person, opts.qualifikation, opts.gueltigAb, opts.gueltigBis,
      opts.status ?? 'gueltig', opts.mandant] as never[]);
  return n!.id;
}

function kontextAus(tx: postgres.TransactionSql, mandant: string, benutzer: string): LeseKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage,
  };
}

function sitzung(mandant: string, benutzer: string): Parameters<typeof alsApp>[0] {
  return { scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
    portal: 'intern', readonly: false };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('die Lage einer Zeile folgt den Stufen der Qualifikation', () => {
  it('abgelaufen, kritisch, im Vorwarnfenster, gültig — an einem festen Stichtag', async () => {
    const b = await leitung(f.reinigung);
    const q = await qualifikation({
      mandant: f.reinigung, schluessel: `stufen_${zufall()}`, sperrt: false });
    // Vier Ablaufdaten um den 15.06.2026: -3, +5, +40, +200 Tage.
    for (const bis of ['2026-06-12', '2026-06-20', '2026-07-25', '2027-01-01']) {
      const [p] = await sql.unsafe<{ id: string }[]>(
        `insert into person (vorname, nachname) values ('Probe', $1) returning id`,
        [`Lage-${bis}`] as never[]);
      await sql.unsafe(
        `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
         values ($1, $2, $3, '2024-01-01'::date, 'aktiv')`,
        [f.reinigung, p!.id, `N-${zufall()}`] as never[]);
      await nachweis({
        person: p!.id, qualifikation: q, mandant: f.reinigung,
        gueltigAb: '2024-01-01', gueltigBis: bis });
    }

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseRegister(kontextAus(tx, f.reinigung, b), STICHTAG));
    const nach = (bis: string) => zeilen.find((z) => z.gueltigBis === bis)!;

    expect(nach('2026-06-12').restTage).toBe(-3);
    expect(lageVon(nach('2026-06-12'))).toBe('abgelaufen');
    // 5 Tage: unter der kleinsten Stufe (7) — kritisch.
    expect(lageVon(nach('2026-06-20'))).toBe('kritisch');
    // 40 Tage: unter 60, über 30 — im Vorwarnfenster.
    expect(lageVon(nach('2026-07-25'))).toBe('warnung');
    // 200 Tage: ausserhalb jeder Stufe.
    expect(lageVon(nach('2027-01-01'))).toBe('gueltig');
  });

  it('ein unbefristeter Nachweis ist nie dringend', async () => {
    const b = await leitung(f.reinigung);
    const q = await qualifikation({
      mandant: f.reinigung, schluessel: `unbefristet_${zufall()}`, sperrt: true });
    await nachweis({
      person: f.jonas, qualifikation: q, mandant: f.reinigung,
      gueltigAb: '2024-01-01', gueltigBis: null });

    const [z] = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseRegister(kontextAus(tx, f.reinigung, b), STICHTAG));
    expect(z!.restTage).toBeNull();
    expect(lageVon(z!)).toBe('unbefristet');
  });
});

describe('die Quittung gehört zu dem Ablaufdatum, für das sie gemeldet wurde', () => {
  it('eine Warnung zum ALTEN Datum zählt nach der Verlängerung nicht mehr', async () => {
    const b = await leitung(f.reinigung);
    const q = await qualifikation({
      mandant: f.reinigung, schluessel: `quittung_${zufall()}`, sperrt: false });
    const id = await nachweis({
      person: f.jonas, qualifikation: q, mandant: f.reinigung,
      gueltigAb: '2024-01-01', gueltigBis: '2026-07-01' });
    await sql.unsafe(
      `insert into nachweis_warnung (nachweis_id, person_id, stufe_tage, gueltig_bis)
       values ($1, $2, 30, '2026-07-01'::date)`, [id, f.jonas] as never[]);

    const vorher = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseNachweis(kontextAus(tx, f.reinigung, b), STICHTAG, id));
    expect(vorher!.gemeldeteStufen).toEqual([30]);

    // Verlängert: dasselbe Dokument, neues Ablaufdatum.
    await sql.unsafe(
      `update nachweis set gueltig_bis = '2027-07-01'::date where id = $1`, [id]);

    const danach = await alsApp(sitzung(f.reinigung, b), async (tx) => ({
      zeile: await leseNachweis(kontextAus(tx, f.reinigung, b), STICHTAG, id),
      quittungen: await leseWarnungen(kontextAus(tx, f.reinigung, b), id),
    }));
    /**
     * DAS ist die Zusage: für das neue Datum hat niemand gewarnt. Zählte die
     * Spalte die alte Quittung mit, läge das Register still darüber, dass die
     * Vorwarnung für den neuen Ablauf noch aussteht.
     */
    expect(danach.zeile!.gemeldeteStufen).toEqual([]);
    // Das Quittungsbuch selbst behält die alte Zeile — gelöscht wird nichts.
    expect(danach.quittungen).toHaveLength(1);
    expect(danach.quittungen[0]!.gueltigBis).toBe('2026-07-01');
  });
});

describe('sichtbar ist, wer hier beschäftigt ist (D-09, K-02)', () => {
  it('der Nachweis einer fremden Person steht nicht im Register', async () => {
    const b = await leitung(f.reinigung);
    const q = await qualifikation({
      mandant: f.security, schluessel: `fremd_${zufall()}`, sperrt: true });
    // Ein Mensch OHNE Beschäftigung in der Reinigung.
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Fremde', 'Person') returning id`);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1, $2, $3, '2024-01-01'::date, 'aktiv')`,
      [f.security, p!.id, `S-${zufall()}`] as never[]);
    await nachweis({
      person: p!.id, qualifikation: q, mandant: f.security,
      gueltigAb: '2024-01-01', gueltigBis: '2027-01-01' });

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseRegister(kontextAus(tx, f.reinigung, b), STICHTAG));
    expect(zeilen.map((z) => z.personId)).not.toContain(p!.id);
  });

  /**
   * Der § 34a-Fall aus D-09 §6 — und die Bedingung, an der er haengt.
   *
   * Die Planerin in der Reinigung MUSS den § 34a-Nachweis eines auch bei der
   * Security beschaeftigten Menschen sehen. Das funktioniert, weil die
   * Qualifikation eine PLATTFORMWEITE Katalogzeile ist (`mandant_id is null`,
   * §6.16): `q_lesen` gibt sie jedem frei, der Nachweis haengt am Menschen
   * (D-09), und `app.person_sichtbar` entscheidet ueber die Person.
   *
   * Der Gegenfall steht direkt darunter und ist kein Fehler, sondern die
   * Grenze: eine Qualifikation, die sich EINE Gesellschaft selbst angelegt
   * hat, ist die Anforderung dieser Gesellschaft — und ihr Nachweis geht die
   * andere nichts an.
   */
  it('ein plattformweiter Nachweis der doppelt beschäftigten Person schon — einmal, nicht zweimal', async () => {
    const b = await leitung(f.reinigung);
    const [q] = await sql.unsafe<{ id: string }[]>(
      `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                  laeuft_ab, warnung_tage, blockiert_einsatz)
       values (null, $1, 'Sachkunde §34a (Probe)', 'gesetzlich', true,
               '{60,30,7}', true)
       returning id`, [`global_${zufall()}`] as never[]);
    // Erfasst hat ihn die SECURITY — sichtbar ist er trotzdem.
    await nachweis({
      person: f.fatima, qualifikation: q!.id, mandant: f.security,
      gueltigAb: '2024-01-01', gueltigBis: '2027-01-01' });

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseRegister(kontextAus(tx, f.reinigung, b), STICHTAG));
    const treffer = zeilen.filter((z) => z.personId === f.fatima);
    // EINMAL, obwohl der Mensch zwei Beschaeftigungen hat: der Nachweis haengt
    // an der Person, nicht an der Anstellung (D-09, Invariante 9). Ein Join
    // ueber `anstellung` — „nur fuer die Personalnummer" — ergaebe hier zwei
    // Zeilen und spaeter zwei Wahrheiten.
    expect(treffer).toHaveLength(1);
    expect(treffer[0]!.blockiertEinsatz).toBe(true);
  });

  it('eine Qualifikation der anderen Gesellschaft bleibt deren Sache', async () => {
    const b = await leitung(f.reinigung);
    const q = await qualifikation({
      mandant: f.security, schluessel: `eigen_${zufall()}`, sperrt: true });
    await nachweis({
      person: f.fatima, qualifikation: q, mandant: f.security,
      gueltigAb: '2024-01-01', gueltigBis: '2027-01-01' });

    const zeilen = await alsApp(sitzung(f.reinigung, b), (tx) =>
      leseRegister(kontextAus(tx, f.reinigung, b), STICHTAG));
    expect(zeilen.filter((z) => z.personId === f.fatima)).toHaveLength(0);
  });
});
