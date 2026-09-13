/**
 * Die Befunde aus der Durchsicht von PR #9, die in der Datenbank sitzen
 * (Migration 0130).
 *
 * Alle haben dieselbe Form: eine Prüfung, die es gibt, greift eine Stelle zu
 * kurz — und keiner davon fällt im Betrieb sofort auf. Genau deshalb steht
 * hier je einer, der ihn festhält.
 *
 * Die beiden Zahlungsbefunde (Richtung, Gegenpartei) und der §48-Einbehalt
 * stehen in `zahlung.test.ts`, wo ihre Vorrichtung schon steht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

/** Eine Jobsitzung wie `alsJobSitzung` sie bindet — Rolle `cse_job`. */
async function alsJob<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_job`);
    for (const [k, v] of [
      ['app.scope', 'mandant'], ['app.mandant_id', mandantId],
      ['app.mandant_ids', mandantId], ['app.benutzer_id', ''], ['app.person_id', ''],
      ['app.portal', 'intern'], ['app.akteur_typ', 'system'], ['app.readonly', 'off'],
    ]) {
      await tx.unsafe(`select set_config($1, $2, true)`, [k!, v!] as never[]);
    }
    return fn(tx);
  }) as Promise<T>;
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Prüfung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function legeKundeAn(mandantId: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer,
                        plz, ort)
     values ($1, $2, 'firma', 'Nachweis GmbH', 'Weg', '1', '10178', 'Berlin')
     returning id`, [mandantId, `K-${zufall()}`]);
  return k!.id;
}

/** Ein Dokument mit einer Version — als Eigentümer, ohne Umweg über den Upload. */
async function legeDokumentAn(mandantId: string): Promise<{ id: string; version: string }> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                           groesse_bytes, bucket, objekt_schluessel, exif_entfernt)
     values ($1, 'buchhaltung', 'Nachweis', 'application/pdf', true, 1024,
             'dokumente', $2, true)
     returning id`, [mandantId, `${mandantId}/buchhaltung/${zufall()}`]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1, $2, 1, $3, repeat('a', 64), 1024, 'application/pdf')
     returning id`, [mandantId, d!.id, `${mandantId}/buchhaltung/${zufall()}`]);
  return { id: d!.id, version: v!.id };
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`pruefung-${zufall()}@cse.test`);
});
afterAll(schliessen);

describe('(1) Ein Nachweis gehört der Gesellschaft, die ihn führt (K-02)', () => {
  it('ein §13b-Status nimmt kein Dokument einer FREMDEN Gesellschaft', async () => {
    const fremd = await legeDokumentAn(f.security);
    const kunde = await legeKundeAn(f.reinigung);

    await expect(sql.unsafe(
      `insert into kunde_bauleistender_status
         (mandant_id, kunde_id, leistungsart, ist_bauleistender, gilt_ab, grundlage,
          dokument_id, erstellt_von_art, erstellt_von_dienst)
       values ($1, $3, 'bau', true, date '2026-01-01', 'USt 1 TG', $2,
               'system', 'job:test')`,
      [f.reinigung, fremd.id, kunde])).rejects.toThrow(/violates foreign key constraint/u);
  });

  it('das eigene dagegen schon — sonst prüfte der Fall die Spalte, nicht die Grenze', async () => {
    const eigen = await legeDokumentAn(f.reinigung);
    const kunde = await legeKundeAn(f.reinigung);
    await sql.unsafe(
      `insert into kunde_bauleistender_status
         (mandant_id, kunde_id, leistungsart, ist_bauleistender, gilt_ab, grundlage,
          dokument_id, erstellt_von_art, erstellt_von_dienst)
       values ($1, $3, 'bau', true, date '2026-01-01', 'USt 1 TG', $2,
               'system', 'job:test')`,
      [f.reinigung, eigen.id, kunde]);

    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from kunde_bauleistender_status where mandant_id = $1`,
      [f.reinigung]);
    expect(n?.n).toBe('1');
  });

  it('und eine Freistellungsbescheinigung nimmt keinen fremden Lieferanten', async () => {
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lieferant (mandant_id, lieferantennummer, name, plz, ort, status,
                              erstellt_von_art, erstellt_von_dienst)
       values ($1, $2, 'Fremdbau GmbH', '10115', 'Berlin', 'aktiv', 'system', 'job:test')
       returning id`, [f.security, `L-${zufall()}`]);

    await expect(sql.unsafe(
      `insert into freistellungsbescheinigung
         (mandant_id, lieferant_id, bescheinigung_nummer, finanzamt,
          gueltig_von, gueltig_bis, umfang, erstellt_von_art, erstellt_von_dienst)
       values ($1, $2, 'FB-2026-0001', 'Finanzamt Berlin Mitte',
               date '2026-01-01', date '2026-12-31', 'unbeschraenkt', 'system', 'job:test')`,
      [f.reinigung, l!.id])).rejects.toThrow(/violates foreign key constraint/u);
  });
});

describe('(2) Eine Freigabe gilt für IHRE Aktion (K-13)', () => {
  /**
   * Der Befund: `app.freigabe_genehmigt` fragte nur nach Mandant und Status.
   * Wer eine genehmigte Freigabe für `mahnung_senden` in der Hand hatte,
   * konnte damit eine Eingangsrechnung buchen — eine Zustimmung zu einem
   * Brief öffnete eine Zahlungsverpflichtung.
   */
  async function legeFreigabeAn(aktion: string): Promise<string> {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am,
                             begruendung, erstellt_von)
       values ($1, $2, 'genehmigt', $3, now(), 'Prüffall', $3)
       returning id`, [f.reinigung, aktion, benutzer]);
    return z!.id;
  }

  it('die dreiargumentige Fassung unterscheidet die Aktionen', async () => {
    const fuerMahnung = await legeFreigabeAn('mahnung_senden');

    const [passt] = await alsApp(sitzung(), async (tx) => tx.unsafe<{ ok: boolean }[]>(
      `select app.freigabe_genehmigt($1, app.aktiver_mandant(), 'mahnung_senden') as ok`,
      [fuerMahnung] as never[]));
    expect(passt?.ok, 'für ihre eigene Aktion gilt sie').toBe(true);

    const [passtNicht] = await alsApp(sitzung(), async (tx) => tx.unsafe<{ ok: boolean }[]>(
      `select app.freigabe_genehmigt($1, app.aktiver_mandant(),
                                     'eingangsrechnung_buchen') as ok`,
      [fuerMahnung] as never[]));
    expect(passtNicht?.ok, 'für eine andere nicht').toBe(false);
  });

  it('die zweiargumentige Fassung gibt es nicht mehr', async () => {
    /*
     * Sie stehen zu lassen hiesse, das Loch offen zu lassen und daneben ein
     * Schild aufzustellen: der nächste Auslöser nähme die kürzere Signatur,
     * weil sie da ist und weil sie reicht — bis sie es nicht mehr tut.
     */
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'app' and p.proname = 'freigabe_genehmigt'
          and p.pronargs = 2`);
    expect(n?.n).toBe('0');
  });
});

describe('(3) Der nächtliche Mahnlauf hat die Rechte, die er braucht (FIN-15)', () => {
  /**
   * Der Befund: `jobs/mahnlauf.ts` fährt als `cse_job` und liest `mahnstufe`,
   * schreibt `mahnung` und `mahnung_position`. 0125 gab der Rolle von diesen
   * dreien nichts, drei Lesespalten und drei Lesespalten. JEDER nächtliche
   * Lauf wäre mit „permission denied" gescheitert — um vier Uhr morgens, und
   * die Buchhaltung hätte sich gewundert, warum nie ein Vorschlag da ist.
   *
   * Das ist die teuerste Sorte Fehler: einer, der eine NICHT-Handlung
   * erzeugt.
   */
  it('cse_job liest die Mahnstufen', async () => {
    await sql.unsafe(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              gebuehr_cent, zinsberechnung, zins_methode, gueltig_ab,
                              ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 1, 'Zahlungserinnerung', 7, 0, 'keine', 'act_365', date '2020-01-01',
               true, 'system', 'job:test')`, [f.reinigung]);

    const zeilen = await alsJob(f.reinigung, async (tx) =>
      tx.unsafe(`select id, stufe, gebuehr_cent from mahnstufe`));
    expect(zeilen.length).toBeGreaterThan(0);
  });

  it('und legt einen Entwurf samt Position an', async () => {
    const [stufe] = await sql.unsafe<{ id: string }[]>(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              gebuehr_cent, zinsberechnung, zins_methode, gueltig_ab,
                              ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 2, 'Erste Mahnung', 14, 500, 'keine', 'act_365', date '2020-01-01',
               true, 'system', 'job:test')
       returning id`, [f.reinigung]);
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer,
                          plz, ort)
       values ($1, $2, 'firma', 'Mahnfall GmbH', 'Weg', '1', '10178', 'Berlin')
       returning id`, [f.reinigung, `K-${zufall()}`]);

    const [m] = await alsJob(f.reinigung, async (tx) => tx.unsafe<{ id: string }[]>(
      `insert into mahnung
         (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum, zahlbar_bis,
          forderung_cent, gebuehr_cent, zinsen_cent, gesamt_cent,
          erstellt_von_art, erstellt_von_dienst)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, 2,
               date '2026-09-13', date '2026-09-27',
               119000, 500, 0, 119500, 'system', 'fin/mahnung/lauf')
       returning id`, [k!.id, stufe!.id] as never[]));

    expect(m?.id, 'der Nachtlauf legt den Entwurf an').toBeDefined();
  });

  it('aber er gibt nichts frei — das ist eine menschliche Handlung (Invariante 7)', async () => {
    const [stufe] = await sql.unsafe<{ id: string }[]>(
      `insert into mahnstufe (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit,
                              gebuehr_cent, zinsberechnung, zins_methode, gueltig_ab,
                              ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 3, 'Zweite Mahnung', 28, 1000, 'keine', 'act_365', date '2020-01-01',
               true, 'system', 'job:test')
       returning id`, [f.reinigung]);
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer,
                          plz, ort)
       values ($1, $2, 'firma', 'Mahnfall Zwei GmbH', 'Weg', '2', '10178', 'Berlin')
       returning id`, [f.reinigung, `K-${zufall()}`]);
    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mahnung
         (mandant_id, kunde_id, mahnstufe_id, stufe, mahndatum, zahlbar_bis,
          forderung_cent, gebuehr_cent, zinsen_cent, gesamt_cent,
          erstellt_von_art, erstellt_von_dienst)
       values ($1, $2, $3, 3, date '2026-09-13', date '2026-09-27',
               119000, 1000, 0, 120000, 'system', 'fin/mahnung/lauf')
       returning id`, [f.reinigung, k!.id, stufe!.id]);

    await expect(alsJob(f.reinigung, async (tx) => tx.unsafe(
      `update mahnung set status = 'freigegeben' where id = $1`,
      [m!.id] as never[]))).rejects.toThrow(/permission denied/u);
  });
});
