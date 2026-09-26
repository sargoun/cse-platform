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
 *     nicht; und der REGISTRIERTE Lauf meldet genau das im Laufprotokoll
 *     (`verbunden: false`, `befund: 'nicht_verbunden'`);
 *  4. der Lauf sieht nur die Tage der Gesellschaft, deren Sitzung er bindet —
 *     geprueft an der Policy selbst (`j_wetter_lesen`, `j_wetter_projekt`,
 *     `j_wetter_anheften`), ohne den Mandantenfilter des Dienstes, der sonst
 *     jede Policy verdeckte;
 *  5. gezaehlt wird, was geschrieben wurde: wird der Tag waehrend des Abrufs
 *     geschlossen oder von Hand mit Wetter versehen, steht „nicht_offen" bzw.
 *     „schon_belegt" im Ergebnis, nicht „angeheftet"; ein geschlossener Tag
 *     fragt die Quelle gar nicht erst;
 *  6. was die Tagesseite fuer ihr Versprechen braucht
 *     (`leseWetterVoraussetzung`): Koordinaten am Objekt, Station am Projekt.
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
import {
  hefteWetterAn, leseWetterVoraussetzung, ordneWetterZu, WETTER_ZUORDNUNG_TAGE,
  type KontextLauf,
} from '../../src/server/services/bau/wetter.js';
import { legeBautagAn, schliesseBautag } from '../../src/server/services/bau/bautagebuch.js';
import { registriereWetterZuordnung } from '../../src/server/jobs/wetterZuordnung.js';
import { leereRegister } from '../../src/server/jobs/registry.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

class WetterDoppel implements WetterPort {
  readonly verbunden = true;
  readonly bezeichnung = 'WetterDoppel (Test)' as const;
  anfragen = 0;
  /**
   * Was WAEHREND des Abrufs geschieht — der Abruf beim DWD dauert bis zu 30 s,
   * und in dieser Zeit schliesst die Bauleitung ihren Tag oder traegt Wetter
   * von Hand ein. Laeuft in einer eigenen Verbindung und ist committet, bevor
   * die Antwort zurueckkommt.
   */
  waehrenddessen: (() => Promise<void>) | null = null;
  async beobachtungen(anfrage: { readonly tag: string }): Promise<readonly WetterMessung[]> {
    this.anfragen += 1;
    if (this.waehrenddessen !== null) await this.waehrenddessen();
    const messung = (stunde: string, temperaturC: number): WetterMessung => ({
      stationId: '00433', stationName: 'Berlin-Tempelhof',
      breitengrad: 52.4675, laengengrad: 13.4021, entfernungKm: 0,
      beobachtetAm: `${anfrage.tag}T${stunde}:00:00.000Z`, temperaturC,
      niederschlagMm: 0.2, windMs: 2.6, qualitaetsniveau: null, quelle: 'dwd',
      quelleUrl: 'https://opendata.example.invalid/00433-BEOB.csv',
      abgerufenAm: `${anfrage.tag}T23:00:00.000Z`,
    });
    return [messung('06', 11.5), messung('12', 17.25), messung('18', 14)];
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

  it('die Policies selbst binden an den Mandanten — ohne den Filter des Dienstes', async () => {
    /*
     * Der Fall oben bliebe gruen, wenn `j_wetter_lesen` `using (true)` hiesse:
     * `ordneWetterZu` filtert die Kandidaten selbst mit `b.mandant_id = $1`.
     * Hier fragt `cse_job` ohne jeden Mandantenfilter nach genau dieser Zeile.
     */
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const tag = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    const sieht = (mandant: string) => jobLauf(mandant)(async (k) => ({
      tage: (await k.abfrage<{ n: number }>(
        `select count(*)::int as n from bautagebuch where id = $1`, [tag]))[0]?.n,
      projekte: (await k.abfrage<{ n: number }>(
        `select count(*)::int as n from projekt where id = $1`, [bau.projekt]))[0]?.n,
    }), { schreibend: false });
    /* Die Gegenprobe: an den Bau gebunden sieht er beides — die Rechte reichen also. */
    expect(await sieht(f.bau)).toEqual({ tage: 1, projekte: 1 });
    expect(await sieht(f.reinigung)).toEqual({ tage: 0, projekte: 0 });

    const geschrieben = await jobLauf(f.reinigung)((k) => k.schreibe<{ id: string }>(
      `update bautagebuch set wetter_quelle = 'keine' where id = $1 returning id`, [tag]),
    { schreibend: true });
    expect(geschrieben).toHaveLength(0);
  });
});

describe('(3b) der registrierte Lauf — ohne DWD steht das im Laufprotokoll', () => {
  it('verbunden: false, befund: nicht_verbunden, und gezaehlt, was er angefasst haette',
    async () => {
      const vorher = process.env['DWD_OPENDATA_BASE'];
      delete process.env['DWD_OPENDATA_BASE'];
      leereRegister();
      try {
        const bau = await baustelle(f.bau);
        const gestern = await tagVor(1);
        const tag = await alsBauleitung(f.bau, bau.benutzer,
          (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
        const lauf = registriereWetterZuordnung(sql);
        const protokoll = await lauf.ausfuehren({ mandantId: f.bau, laufId: 'lauf', versuch: 1 });
        expect(protokoll).toMatchObject({
          verbunden: false, befund: 'nicht_verbunden', offen: 1, angeheftet: 0,
          fenster_tage: WETTER_ZUORDNUNG_TAGE, abgeschlossen_ohne_wetter: 0, ohne_wetter: {},
        });
        /* Die Quelle heisst, wie sie heisst — der nicht verbundene Port, kein Doppel. */
        expect(protokoll['quelle']).toBe('DWD Open Data');
        expect((await wetter(tag)).wetter_quelle).toBe('keine');

        /* Ohne Mandanten laeuft er nicht — er ist je_mandant. */
        await expect(lauf.ausfuehren({ mandantId: null, laufId: 'lauf', versuch: 1 }))
          .rejects.toThrow(/je_mandant/u);
      } finally {
        leereRegister();
        if (vorher !== undefined) process.env['DWD_OPENDATA_BASE'] = vorher;
      }
    });
});

describe('(5) gezaehlt wird, was geschrieben wurde', () => {
  it('waehrend des Abrufs geschlossen: nicht_offen, nichts angeheftet', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const tag = await alsBauleitung(f.bau, bau.benutzer,
      (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
    const quelle = new WetterDoppel();
    quelle.waehrenddessen = () =>
      alsBauleitung(f.bau, bau.benutzer, (k) => schliesseBautag(k, tag));

    const ergebnis = await ordneWetterZu(jobLauf(f.bau), quelle);
    expect(ergebnis).toMatchObject({
      verbunden: true, offen: 1, angeheftet: 0, befunde: { nicht_offen: 1 },
    });
    expect(quelle.anfragen).toBe(1);
    expect(await wetter(tag)).toMatchObject({ wetter_quelle: 'keine', temperatur_max_c: null });
  });

  it('waehrenddessen von Hand eingetragen: schon_belegt — und das Wetter von Hand bleibt',
    async () => {
      const bau = await baustelle(f.bau);
      const gestern = await tagVor(1);
      const tag = await alsBauleitung(f.bau, bau.benutzer,
        (k) => legeBautagAn(k, { projektId: bau.projekt, datum: gestern }));
      const quelle = new WetterDoppel();
      quelle.waehrenddessen = async () => {
        await sql.unsafe(`update bautagebuch set wetter_quelle = 'manuell' where id = $1`, [tag]);
      };

      const ergebnis = await ordneWetterZu(jobLauf(f.bau), quelle);
      expect(ergebnis).toMatchObject({ angeheftet: 0, befunde: { schon_belegt: 1 } });
      expect((await wetter(tag)).wetter_quelle).toBe('manuell');
    });

  it('ein geschlossener Tag fragt die Quelle gar nicht erst — auch am Knopf', async () => {
    const bau = await baustelle(f.bau);
    const gestern = await tagVor(1);
    const quelle = new WetterDoppel();
    const befund = await alsBauleitung(f.bau, bau.benutzer, async (k) => {
      const id = await legeBautagAn(k, { projektId: bau.projekt, datum: gestern });
      await schliesseBautag(k, id);
      return hefteWetterAn(k, { bautagebuchId: id }, quelle);
    });
    expect(befund).toMatchObject({ art: 'nicht_offen', beobachtungen: 0 });
    expect(quelle.anfragen).toBe(0);
  });
});

describe('(6) was die Tagesseite fuer ihr Versprechen braucht', () => {
  it('Koordinaten am Objekt und Station am Projekt — jede fehlende Angabe benannt', async () => {
    const bau = await baustelle(f.bau);
    const lies = () => alsBauleitung(f.bau, bau.benutzer,
      (k) => leseWetterVoraussetzung(k, bau.projekt));
    expect(await lies()).toEqual({ koordinaten: true, station: true });

    await sql.unsafe(`update projekt set wetter_station_id = null where id = $1`, [bau.projekt]);
    expect(await lies()).toEqual({ koordinaten: true, station: false });

    await sql.unsafe(
      `update objekt set geo_lat = null, geo_lon = null
        where id = (select objekt_id from projekt where id = $1)`, [bau.projekt]);
    expect(await lies()).toEqual({ koordinaten: false, station: false });

    /* Ein Projekt, das diese Sitzung nicht sieht, verspricht nichts. */
    expect(await alsBauleitung(f.bau, bau.benutzer, (k) => leseWetterVoraussetzung(
      k, '00000000-0000-4000-8000-000000000000'))).toBeNull();
  });
});
