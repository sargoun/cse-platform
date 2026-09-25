/**
 * Der Nachtlauf `wetter_zuordnung` heftet das Wetter an (V-183, D-677; BAU-08
 * „Weather auto-attached from DWD open data") — an echtem Postgres, als
 * `cse_job` mit gebundenem Mandanten, wie im Betrieb.
 *
 * **Der Befund.** `hefteWetterAn` lief nur auf Knopfdruck, einen Lauf gab es
 * nicht, und `cse_job` durfte `bautagebuch` weder lesen noch schreiben.
 *
 * Geprueft wird:
 *  1. ein offener Tag von gestern ohne Wetter bekommt es — mit
 *     `geaendert_von_art = 'system'` und ohne Benutzer;
 *  2. ein abgeschlossener Tag, ein Tag mit Wetter von Hand und der heutige
 *     Tag bleiben, wie sie sind; auch eine Policy-Umgehung am Dienst vorbei
 *     ueberschreibt kein vorhandenes Wetter (0468);
 *  3. ohne verbundene Quelle geschieht nichts — gezaehlt wird, geschrieben
 *     nicht;
 *  4. der Lauf sieht nur die Tage der Gesellschaft, deren Sitzung er bindet.
 *
 * Die Quelle ist ein DOPPEL (`WetterDoppel`), und es heisst so: nichts geht
 * nach draussen, und kein Wert steht ausserhalb dieses Tests.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { alsJobSitzung } from '../../src/server/jobs/sitzung.js';
import {
  NichtVerbundenerWetterPort, type WetterMessung, type WetterPort,
} from '../../src/server/versand/dwd.js';
import { ordneWetterZu, type KontextLauf } from '../../src/server/services/bau/wetter.js';
import { legeBautagAn, schliesseBautag } from '../../src/server/services/bau/bautagebuch.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

class WetterDoppel implements WetterPort {
  readonly verbunden = true;
  readonly bezeichnung = 'WetterDoppel (Test)' as const;
  anfragen = 0;
  beobachtungen(anfrage: { readonly tag: string }): Promise<readonly WetterMessung[]> {
    this.anfragen += 1;
    const messung = (stunde: string, temperaturC: number): WetterMessung => ({
      stationId: '00433', stationName: 'Berlin-Tempelhof',
      breitengrad: 52.4675, laengengrad: 13.4021, entfernungKm: 0,
      beobachtetAm: `${anfrage.tag}T${stunde}:00:00.000Z`, temperaturC,
      niederschlagMm: 0.2, windMs: 2.6, qualitaetsniveau: null, quelle: 'dwd',
      quelleUrl: 'https://opendata.example.invalid/00433-BEOB.csv',
      abgerufenAm: `${anfrage.tag}T23:00:00.000Z`,
    });
    return Promise.resolve([messung('06', 11.5), messung('12', 17.25), messung('18', 14)]);
  }
}

interface Baustelle { readonly projekt: string; readonly benutzer: string }

async function baustelle(mandant: string): Promise<Baustelle> {
  const email = `wetter-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [u!.id, mandant]);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Bauherr') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort,
                         geo_lat, geo_lon)
     values ($1,$2,$3,'Baustelle','Musterweg','13403','Berlin',52.56,13.33) returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum, objekt_id)
     values ($1,$2,$3,'projekt','aktiv','Rohbau',$4,'2026-01-01',$5) returning id`,
    [mandant, `AU-${zufall()}`, k!.id, u!.id, o!.id]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, objekt_id, wetter_station_id)
     values ($1,$2,$3,'Rohbau',$4,'hochbau','vob_b',$5,'00433') returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id, o!.id]);
  return { projekt: p!.id, benutzer: u!.id };
}

/** Als Bauleitung (`cse_app`), wie die Seite den Tag anlegt. */
function alsBauleitung<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) => {
    await tx.unsafe(`set local role cse_app`);
    for (const [name, wert] of [
      ['app.scope', 'mandant'], ['app.mandant_id', mandant], ['app.mandant_ids', mandant],
      ['app.benutzer_id', benutzer], ['app.person_id', ''], ['app.readonly', 'off'],
      ['app.portal', 'intern'], ['app.akteur_typ', 'mensch'], ['app.aal', 'aal2'],
    ] as const) {
      await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
    }
    const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[];
    return fn({
      scope: 'mandant', portal: 'intern', benutzerId: benutzer,
      aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
    });
  }) as Promise<T>;
}

/** Der Lauf, wie `jobs/wetterZuordnung.ts` ihn baut: `cse_job`, Mandant gebunden. */
function jobLauf(mandant: string): KontextLauf {
  return (arbeit, optionen) => alsJobSitzung(sql, mandant, (db) => arbeit({
    scope: 'mandant', portal: 'intern', benutzerId: '',
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage: db.abfrage.bind(db), schreibe: db.abfrage.bind(db),
  }), { nurLesen: !optionen.schreibend });
}

async function tagVor(tage: number): Promise<string> {
  const [z] = await sql.unsafe<{ d: string }[]>(
    `select to_char(app.berlin_heute() - $1::int, 'YYYY-MM-DD') as d`, [tage]);
  return z!.d;
}

async function wetter(id: string): Promise<{
  wetter_quelle: string; geaendert_von_art: string | null; geaendert_von: string | null;
  temperatur_max_c: string | null;
}> {
  const [z] = await sql.unsafe<{
    wetter_quelle: string; geaendert_von_art: string | null; geaendert_von: string | null;
    temperatur_max_c: string | null;
  }[]>(
    `select wetter_quelle::text, geaendert_von_art::text, geaendert_von,
            temperatur_max_c::text
       from bautagebuch where id = $1`, [id]);
  return z!;
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) der offene Tag von gestern bekommt sein Wetter — als System', () => {
  it('angeheftet, geaendert_von_art = system, kein Benutzer', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const tag = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));

    const quelle = new WetterDoppel();
    const ergebnis = await ordneWetterZu(jobLauf(f.bau), quelle);
    expect(ergebnis).toMatchObject({ verbunden: true, offen: 1, angeheftet: 1 });
    expect(await wetter(tag)).toEqual({
      wetter_quelle: 'dwd', geaendert_von_art: 'system', geaendert_von: null,
      temperatur_max_c: '17.3',
    });

    /* Ein zweiter Lauf findet nichts mehr — und fragt die Quelle nicht noch einmal. */
    const zweiter = await ordneWetterZu(jobLauf(f.bau), quelle);
    expect(zweiter).toMatchObject({ offen: 0, angeheftet: 0 });
    expect(quelle.anfragen).toBe(1);
  });
});

describe('(2) was der Lauf nicht anfasst', () => {
  it('abgeschlossen, von Hand, heute — bleiben, wie sie sind', async () => {
    const bau = await baustelle(f.bau);
    const [vorgestern, gestern, heute] = [await tagVor(2), await tagVor(1), await tagVor(0)];
    const zu = await alsBauleitung(f.bau, bau.benutzer, async (k) => {
      const id = await legeBautagAn(k, { projektId: bau.projekt, datum: vorgestern });
      await schliesseBautag(k, id);
      return id;
    });
    const hand = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    await sql.unsafe(`update bautagebuch set wetter_quelle = 'manuell' where id = $1`, [hand]);
    const jetzt = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: heute }));

    const quelle = new WetterDoppel();
    const ergebnis = await ordneWetterZu(jobLauf(f.bau), quelle);
    expect(ergebnis).toMatchObject({
      verbunden: true, offen: 0, angeheftet: 0, abgeschlossenOhneWetter: 1,
    });
    expect(quelle.anfragen).toBe(0);
    expect((await wetter(zu)).wetter_quelle).toBe('keine');
    expect((await wetter(hand)).wetter_quelle).toBe('manuell');
    expect((await wetter(jetzt)).wetter_quelle).toBe('keine');
  });

  it('auch am Dienst vorbei ueberschreibt cse_job kein vorhandenes Wetter (0468)', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const hand = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    await sql.unsafe(`update bautagebuch set wetter_quelle = 'manuell' where id = $1`, [hand]);
    const zeilen = await jobLauf(f.bau)((k) => k.schreibe<{ id: string }>(
      `update bautagebuch set wetter_quelle = 'keine' where id = $1 returning id`, [hand]),
    { schreibend: true });
    expect(zeilen).toHaveLength(0);
    expect((await wetter(hand)).wetter_quelle).toBe('manuell');
  });
});

describe('(3) ohne verbundene Quelle geschieht nichts', () => {
  it('gezaehlt ja, gefragt und geschrieben nein', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const tag = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    const ergebnis = await ordneWetterZu(jobLauf(f.bau), new NichtVerbundenerWetterPort());
    expect(ergebnis).toEqual({
      verbunden: false, offen: 1, angeheftet: 0, befunde: {}, abgeschlossenOhneWetter: 0,
    });
    expect(await wetter(tag)).toMatchObject({ wetter_quelle: 'keine', geaendert_von_art: null });
  });
});

describe('(4) je Mandant', () => {
  it('der Lauf fuer die Reinigung sieht die Bautage des Baus nicht', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const tag = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    const quelle = new WetterDoppel();
    const ergebnis = await ordneWetterZu(jobLauf(f.reinigung), quelle);
    expect(ergebnis).toMatchObject({ offen: 0, angeheftet: 0 });
    expect(quelle.anfragen).toBe(0);
    expect((await wetter(tag)).wetter_quelle).toBe('keine');
  });
});
