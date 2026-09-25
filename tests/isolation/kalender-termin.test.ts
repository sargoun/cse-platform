/**
 * Eigene Termine im Kalender: anlegen, ändern, absagen (CAL-01, V-221, D-715)
 * — gegen echtes Postgres.
 *
 * **Der Befund.** `kalender_eintrag` kannte seit 0160 Besprechung,
 * Kundentermin und sonstigen Termin; kein Bildschirm und keine Route legte
 * einen an, änderte ihn oder sagte ihn ab, und `abgesagt_am` setzte niemand.
 *
 * Geprüft wird, was nur gegen die Datenbank prüfbar ist: die Policies
 * (`t_kalender_schreiben`, 0160), die Grenze zur fremden Quelle
 * (Wiedervorlage, Gespräch), die Absage als Zustand mit Grund, das
 * Prüfprotokoll, der Seed und der Kalender, der liest.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  aendereTermin, legeTerminAn, leseTerminZeiten, sageTerminAb, type TerminEingabe,
} from '../../src/server/services/kalender/termin.js';
import { kalenderZeilen } from '../../src/server/services/kalender/eintraege.js';
import { seedTermine, TERMIN_KENNZEICHEN } from '../../src/server/db/seed/termine.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);
const STUNDE = 3600 * 1000;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string, name = 'Leitung Termin'): Promise<string> {
  const email = `termin-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$3,'aktiv')`,
    [u!.id, email, name]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

function als<T>(
  wer: string, mandant: string, fn: (k: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: wer,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, wer, mandant), tx));
}

function termin(ueber: Partial<TerminEingabe> = {}): TerminEingabe {
  const beginn = new Date(Math.floor((Date.now() + 2 * 24 * STUNDE) / 60000) * 60000);
  return {
    art: 'kundentermin', titel: 'Begehung Kurfürstendamm 21', beschreibung: 'Mit Hausverwaltung',
    ort: 'Kurfürstendamm 21', beginn, ende: new Date(beginn.getTime() + STUNDE),
    ganztaegig: false, teilnehmer: [], ...ueber,
  };
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung, 'leitung');
});
afterAll(schliessen);

describe('(1) anlegen', () => {
  it('in der Gesellschaft der Sitzung, geführt von der anlegenden Person, mit Teilnehmenden', async () => {
    const kollegin = await konto(f.reinigung, 'leitung', 'Kollegin');
    const id = await als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ teilnehmer: [kollegin] })));
    const [z] = await sql.unsafe<{
      mandant_id: string; besitzer: string; teilnehmer: string[]; art: string;
    }[]>(
      `select mandant_id::text, besitzer_benutzer_id::text as besitzer,
              teilnehmer::text[] as teilnehmer, art::text as art
         from kalender_eintrag where id = $1`, [id]);
    expect(z).toMatchObject({ mandant_id: f.reinigung, besitzer: leitung, art: 'kundentermin' });
    expect([...z!.teilnehmer].sort()).toEqual([leitung, kollegin].sort());
  });

  it('niemand aus einer anderen Gesellschaft nimmt teil', async () => {
    const fremd = await konto(f.security, 'leitung', 'Fremd');
    await expect(als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ teilnehmer: [fremd] }))))
      .rejects.toMatchObject({ grund: 'teilnehmer_unbekannt' });
  });

  it('ohne kalender.schreiben legt niemand an — der Dienst läuft in die Policy', async () => {
    const leser = await konto(f.reinigung, 'mitarbeiter', 'Nur lesen');
    await expect(als(leser, f.reinigung, (k) => legeTerminAn(k, termin()))).rejects.toThrow();
  });

  it('ganztägig über die Umstellungsnacht: 25 Stunden, gespeichert als zwei Instants', async () => {
    const jahr = new Date().getUTCFullYear() + 1;
    const ende = new Date(Date.UTC(jahr, 9, 31));
    const tag = `${String(jahr)}-10-${String(31 - ende.getUTCDay()).padStart(2, '0')}`;
    const zeiten = leseTerminZeiten({ ganztaegig: true, vonTag: tag });
    const id = await als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ ganztaegig: true, ...zeiten })));
    const [z] = await sql.unsafe<{ stunden: number }[]>(
      `select extract(epoch from ende - beginn)::int / 3600 as stunden
         from kalender_eintrag where id = $1`, [id]);
    expect(z!.stunden).toBe(25);
  });
});

describe('(2) ändern', () => {
  it('Zeiten und Titel ändern sich, die Führung bleibt, das Protokoll kennt vorher und nachher', async () => {
    const id = await als(leitung, f.reinigung, (k) => legeTerminAn(k, termin()));
    const zweite = await konto(f.reinigung, 'leitung', 'Zweite Leitung');
    const neu = termin({ titel: 'Begehung verschoben', art: 'besprechung' });
    const spaeter = new Date(neu.beginn.getTime() + 24 * STUNDE);
    await als(zweite, f.reinigung, (k) => aendereTermin(k, id, {
      ...neu, beginn: spaeter, ende: new Date(spaeter.getTime() + 2 * STUNDE),
    }));
    const [z] = await sql.unsafe<{
      titel: string; besitzer: string; teilnehmer: string[]; minuten: number;
    }[]>(
      `select titel, besitzer_benutzer_id::text as besitzer, teilnehmer::text[] as teilnehmer,
              extract(epoch from ende - beginn)::int / 60 as minuten
         from kalender_eintrag where id = $1`, [id]);
    expect(z).toMatchObject({ titel: 'Begehung verschoben', besitzer: leitung, minuten: 120 });
    expect(z!.teilnehmer).toContain(leitung);
    const [p] = await sql.unsafe<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> }[]>(
      `select vorher, nachher from audit_log
        where objekt_typ = 'kalender_eintrag' and objekt_id = $1
          and aktion = 'kalender.termin_geaendert'`, [id]);
    expect(p!.vorher['titel']).toBe('Begehung Kurfürstendamm 21');
    expect(p!.nachher['titel']).toBe('Begehung verschoben');
  });

  it('eine Wiedervorlage und ein Gespräch ändert man an ihrer Quelle, nicht hier', async () => {
    for (const art of ['wiedervorlage', 'bewerbungsgespraech']) {
      const [w] = await sql.unsafe<{ id: string }[]>(
        `insert into kalender_eintrag (mandant_id, art, titel, beginn, ende)
         values ($1, $2::kalender_art, 'Fremde Quelle', now() + interval '1 day',
                 now() + interval '25 hours') returning id`, [f.reinigung, art]);
      await expect(als(leitung, f.reinigung, (k) => aendereTermin(k, w!.id, termin())))
        .rejects.toMatchObject({ grund: 'fremde_art' });
      await expect(als(leitung, f.reinigung, (k) => sageTerminAb(k, w!.id, 'weg')))
        .rejects.toMatchObject({ grund: 'fremde_art' });
    }
  });

  it('ein Termin einer anderen Gesellschaft ist unbekannt (AUT-06)', async () => {
    const id = await als(leitung, f.reinigung, (k) => legeTerminAn(k, termin()));
    const fremd = await konto(f.security, 'leitung', 'Fremd');
    await expect(als(fremd, f.security, (k) => aendereTermin(k, id, termin())))
      .rejects.toMatchObject({ grund: 'nicht_gefunden' });
  });
});

describe('(3) absagen — der Termin bleibt stehen', () => {
  it('mit Grund und Zeitpunkt der Datenbank; danach ändert ihn niemand mehr', async () => {
    const id = await als(leitung, f.reinigung, (k) => legeTerminAn(k, termin()));
    await expect(als(leitung, f.reinigung, (k) => sageTerminAb(k, id, '  ')))
      .rejects.toMatchObject({ grund: 'ohne_grund' });
    await als(leitung, f.reinigung, (k) => sageTerminAb(k, id, 'Kunde hat verschoben'));
    const [z] = await sql.unsafe<{ grund: string; frisch: boolean }[]>(
      `select abgesagt_grund as grund, abgesagt_am > now() - interval '1 minute' as frisch
         from kalender_eintrag where id = $1`, [id]);
    expect(z).toEqual({ grund: 'Kunde hat verschoben', frisch: true });
    await expect(als(leitung, f.reinigung, (k) => aendereTermin(k, id, termin())))
      .rejects.toMatchObject({ grund: 'abgesagt' });
    await expect(als(leitung, f.reinigung, (k) => sageTerminAb(k, id, 'noch einmal')))
      .rejects.toMatchObject({ grund: 'abgesagt' });
    const [p] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where objekt_typ = 'kalender_eintrag' and objekt_id = $1
          and aktion = 'kalender.termin_abgesagt'`, [id]);
    expect(p!.n).toBe(1);
  });

  it('der Kalender zeigt die Absage — die Zeile verschwindet nicht', async () => {
    const id = await als(leitung, f.reinigung, (k) => legeTerminAn(k, termin()));
    await als(leitung, f.reinigung, (k) => sageTerminAb(k, id, 'Entfällt'));
    const [tage] = await sql.unsafe<{ von: string; bis: string }[]>(
      `select app.berlin_heute()::text as von, (app.berlin_heute() + 5)::text as bis`);
    const zeilen = await als(leitung, f.reinigung, (k) => kalenderZeilen(k, {
      zeitraum: { von: tage!.von, bis: tage!.bis, bezeichnung: 'Test' },
    }));
    expect(zeilen.find((z) => z.id === id)?.abgesagt).toBe(true);
  });
});

describe('(4) der Seed legt Termine über den Dienst an — auch einen abgesagten', () => {
  it('Besprechung, Kundentermin und eine Absage mit Grund; ein zweiter Lauf legt nichts nach', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    expect(await seedTermine(sql, ids, false)).toEqual({ angelegt: 0, abgesagt: 0 });
    const erster = await seedTermine(sql, ids, true);
    expect(erster.angelegt).toBe(3);
    expect(erster.abgesagt).toBe(1);
    const zeilen = await sql.unsafe<{ art: string; abgesagt: boolean; besitzer: string | null }[]>(
      `select art::text as art, abgesagt_am is not null as abgesagt,
              besitzer_benutzer_id::text as besitzer
         from kalender_eintrag
        where mandant_id = $1 and beschreibung like '%' || $2 || '%'`,
      [f.reinigung, TERMIN_KENNZEICHEN]);
    expect(zeilen.length).toBe(erster.angelegt);
    expect(new Set(zeilen.map((z) => z.art))).toEqual(new Set(['besprechung', 'kundentermin']));
    expect(zeilen.filter((z) => z.abgesagt).length).toBe(1);
    /* Geführt von EINEM Menschen — dem, in dessen Sitzung der Seed den Dienst rief. */
    expect(new Set(zeilen.map((z) => z.besitzer)).size).toBe(1);
    expect(zeilen[0]!.besitzer).not.toBeNull();
    expect(await seedTermine(sql, ids, true)).toEqual({ angelegt: 0, abgesagt: 0 });
  });
});
