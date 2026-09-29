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
    await expect(als(leser, f.reinigung, (k) => legeTerminAn(k, termin({ titel: 'Ohne Recht' }))))
      .rejects.toThrow(/row-level security policy for table "kalender_eintrag"/u);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from kalender_eintrag where titel = 'Ohne Recht'`);
    expect(n!.n, 'keine Zeile').toBe(0);
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

/** Die Nacht der Rückstellung im nächsten Jahr — letzter Sonntag im Oktober. */
function rueckstellungsnacht(): string {
  const jahr = new Date().getUTCFullYear() + 1;
  const ende = new Date(Date.UTC(jahr, 9, 31));
  return `${String(jahr)}-10-${String(31 - ende.getUTCDay()).padStart(2, '0')}`;
}

describe('(2) ändern', () => {
  /**
   * **Eine unveränderte Zeit bleibt, wie sie gespeichert ist** (V-267, D-760
   * Nr. 10). Der Termin liegt in der ZWEITEN 02:30 der Rückstellungsnacht;
   * das Formular zeigt „02:30", und `planEingabe` löst das als die erste auf.
   * Wer nur den Ort ändert, schickt die Zeiten unverändert zurück — und der
   * Termin rückte ohne die Regel eine Stunde vor.
   */
  it('nur der Ort ändert sich: ein Termin der zweiten 02:30 bleibt, wo er war', async () => {
    const tag = rueckstellungsnacht();
    const zweite = new Date(`${tag}T01:30:00Z`);
    const id = await als(leitung, f.reinigung, (k) => legeTerminAn(k, termin({
      beginn: zweite, ende: new Date(zweite.getTime() + STUNDE),
    })));
    const zeiten = leseTerminZeiten({
      ganztaegig: false, beginn: `${tag}T02:30`, ende: `${tag}T03:30`,
    });
    expect(zeiten.beginn.toISOString(), 'das Formular allein hiesse: die erste 02:30')
      .toBe(`${tag}T00:30:00.000Z`);
    await als(leitung, f.reinigung, (k) => aendereTermin(k, id, termin({
      ort: 'Treffpunkt Pforte', ...zeiten,
    })));
    const [z] = await sql.unsafe<{ beginn: Date; ende: Date; ort: string }[]>(
      `select beginn, ende, ort from kalender_eintrag where id = $1`, [id]);
    expect(z!.ort).toBe('Treffpunkt Pforte');
    expect(z!.beginn.toISOString()).toBe(zweite.toISOString());
    expect(z!.ende.toISOString()).toBe(new Date(zweite.getTime() + STUNDE).toISOString());
  });

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

  /**
   * **Niemand verliert still seine Teilnahme** (V-267, D-760). Das Formular
   * auf `/kalender/[id]` bietet die angemeldete Person nicht an — sie schickt
   * also nie sich selbst mit. Vorher ersetzte die Auswahl die Teilnehmenden
   * ganz, und wer als Eingeladene Ort oder Zeit änderte, war danach nicht
   * mehr Teilnehmerin: der Termin fiel aus „Nur meine" und aus ihrem
   * Abonnement.
   */
  it('eine Teilnehmerin ändert den Ort — und bleibt Teilnehmerin', async () => {
    const kollegin = await konto(f.reinigung, 'leitung', 'Kollegin');
    const id = await als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ teilnehmer: [kollegin] })));
    /* Genau, was ihr Formular schickt: die Führung steht nicht zur Wahl, sie selbst auch nicht. */
    await als(kollegin, f.reinigung, (k) => aendereTermin(k, id, termin({
      ort: 'Raum 2', titel: 'Begehung (Raum geändert)', teilnehmer: [],
    })));
    const [z] = await sql.unsafe<{ teilnehmer: string[]; ort: string; besitzer: string }[]>(
      `select teilnehmer::text[] as teilnehmer, ort, besitzer_benutzer_id::text as besitzer
         from kalender_eintrag where id = $1`, [id]);
    expect(z!.ort).toBe('Raum 2');
    expect(z!.besitzer).toBe(leitung);
    expect([...z!.teilnehmer].sort()).toEqual([leitung, kollegin].sort());
    /* Und sie sieht ihn weiter unter „Nur meine" (t_kalender_eigene). */
    const [tage] = await sql.unsafe<{ von: string; bis: string }[]>(
      `select app.berlin_heute()::text as von, (app.berlin_heute() + 5)::text as bis`);
    const zeilen = await als(kollegin, f.reinigung, (k) => kalenderZeilen(k, {
      zeitraum: { von: tage!.von, bis: tage!.bis, bezeichnung: 'Test' }, nurBenutzerId: kollegin,
    }));
    expect(zeilen.some((x) => x.id === id)).toBe(true);
  });

  it('ohne system.benutzer_lesen bleiben alle Teilnehmenden, wie sie waren', async () => {
    const b = await konto(f.reinigung, 'leitung', 'B');
    const c = await konto(f.reinigung, 'leitung', 'C');
    const id = await als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ teilnehmer: [b, c] })));
    /* Eine Rolle, die Termine setzt, aber die Namen der anderen nicht lesen darf. */
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, 'Termine ohne Namen', 'mandant', 'intern') returning id`,
      [f.reinigung, `termine_${zufall()}`]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b
        where b.schluessel in ('kalender.lesen', 'kalender.schreiben')`, [r!.id, f.reinigung]);
    const email = `termin-ohne-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,'Ohne Namen','aktiv')`,
      [u!.id, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [u!.id, f.reinigung, r!.id]);

    await als(u!.id, f.reinigung, (k) => aendereTermin(k, id, termin({
      titel: 'Begehung, neuer Titel', teilnehmer: [],
    })));
    const [z] = await sql.unsafe<{ teilnehmer: string[]; titel: string }[]>(
      `select teilnehmer::text[] as teilnehmer, titel from kalender_eintrag where id = $1`, [id]);
    expect(z!.titel).toBe('Begehung, neuer Titel');
    expect([...z!.teilnehmer].sort()).toEqual([leitung, b, c].sort());
  });

  it('wer angeboten war und abgewählt wird, fällt heraus — und das Protokoll sagt es', async () => {
    const b = await konto(f.reinigung, 'leitung', 'B');
    const c = await konto(f.reinigung, 'leitung', 'C');
    const id = await als(leitung, f.reinigung,
      (k) => legeTerminAn(k, termin({ teilnehmer: [b, c] })));
    /* Wer ausgeschieden ist, steht nicht mehr zur Wahl — und bleibt deshalb stehen. */
    await sql.unsafe(
      `update benutzer_mandant set entzogen_am = now()
        where benutzer_id = $1 and mandant_id = $2`, [c, f.reinigung]);
    await als(leitung, f.reinigung, (k) => aendereTermin(k, id, termin({ teilnehmer: [] })));
    const [z] = await sql.unsafe<{ teilnehmer: string[] }[]>(
      `select teilnehmer::text[] as teilnehmer from kalender_eintrag where id = $1`, [id]);
    expect([...z!.teilnehmer].sort()).toEqual([leitung, c].sort());
    const [p] = await sql.unsafe<{ vorher: { teilnehmer: string[] }; nachher: { teilnehmer: string[] } }[]>(
      `select vorher, nachher from audit_log
        where objekt_typ = 'kalender_eintrag' and objekt_id = $1
          and aktion = 'kalender.termin_geaendert'`, [id]);
    expect([...p!.vorher.teilnehmer].sort()).toEqual([leitung, b, c].sort());
    expect([...p!.nachher.teilnehmer].sort()).toEqual([leitung, c].sort());
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

describe('(4) der Seed legt Termine über den Dienst an — ändert einen und sagt einen ab', () => {
  it('Besprechung, Kundentermin, eine Änderung und eine Absage mit Grund; ein zweiter Lauf legt nichts nach', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    expect(await seedTermine(sql, ids, false)).toEqual({ angelegt: 0, geaendert: 0, abgesagt: 0 });
    const erster = await seedTermine(sql, ids, true);
    expect(erster).toEqual({ angelegt: 3, geaendert: 1, abgesagt: 1 });
    /* Geändert über den Dienst — das Protokoll kennt vorher und nachher. */
    const [p] = await sql.unsafe<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> }[]>(
      `select a.vorher, a.nachher from audit_log a
         join kalender_eintrag k on k.id::text = a.objekt_id
        where a.aktion = 'kalender.termin_geaendert' and k.mandant_id = $1
          and k.beschreibung like '%' || $2 || '%'`, [f.reinigung, TERMIN_KENNZEICHEN]);
    expect(p).toBeDefined();
    expect(new Date(String(p!.nachher['beginn'])).getTime()
      - new Date(String(p!.vorher['beginn'])).getTime()).toBe(STUNDE);
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
    expect(await seedTermine(sql, ids, true)).toEqual({ angelegt: 0, geaendert: 0, abgesagt: 0 });
  });
});
