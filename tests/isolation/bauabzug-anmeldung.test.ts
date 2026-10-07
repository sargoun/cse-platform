/**
 * Die Bauabzugsteuer-Anmeldung nach § 48a EStG, vorbereitet — gegen echte
 * Tabellen, Auslöser und Policies (FIN-10, V-315, O-187, D-847).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Der Einbehalt einer gebuchten Eingangsrechnung gehört in die Monate
 *     ihrer ZAHLUNGEN, anteilig — zwei Raten in zwei Monaten, zwei Zeilen.
 *  2. Eine stornierte Zahlung zählt nicht; was keiner Zahlung zugeordnet ist,
 *     steht als offen da.
 *  3. Eine Rechnung ohne Einbehalt und eine nicht bauabzugsteuerpflichtige
 *     tauchen nicht auf.
 *  4. Ohne `zahlung.lesen` sind die Zahlungen unsichtbar: alles steht offen,
 *     nichts wird einem Monat zugeschrieben.
 *  5. Der Kalender nennt die Frist am 10. des Folgemonats (Quelle `bauabzug`),
 *     mit dem Weg auf das Blatt.
 */
import { existsSync } from 'node:fs';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import { ladeBauabzugUebersicht } from '../../src/server/services/finanz/estg48/anmeldung.js';
import { kalenderZeilen } from '../../src/server/services/kalender/eintraege.js';

let f: Fixtur;
let benutzer: string;
let lieferantId: string;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

/** Die Sitzung, die die Definer-Auslöser der Eingangsrechnung erwarten (wie 0182). */
async function mitSitzung<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [f.bau]);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    return fn(tx);
  }) as Promise<T>;
}

async function legeBelegAn(): Promise<string> {
  const schluessel = `mandant/${f.bau}/beleg/${zufall()}.pdf`;
  const hash = 'c'.repeat(64);
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
     values ($1,'buchhaltung','Bauleistung',$2,'application/pdf',true,2048,'2026-08-31',true)
     returning id`, [f.bau, schluessel]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
    [f.bau, d!.id, schluessel, hash]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, seiten, belegdatum,
                        erstellt_von_art, erstellt_von)
     values ($1,$2,'eingangsrechnung','upload',$3,$4,$5,1,'2026-08-31','mensch',$6)
     returning id`, [f.bau, `B-${zufall()}`, d!.id, v!.id, hash, benutzer]);
  return b!.id;
}

/**
 * Eine GEBUCHTE Eingangsrechnung über `brutto` mit `einbehalt` — das Buchen
 * eröffnet den Kreditorposten über brutto minus Einbehalt (0123).
 */
async function gebuchteRechnung(
  bruttoCent: bigint, einbehaltCent: bigint, pflichtig = true,
): Promise<{ id: string; posten: string }> {
  const beleg = await legeBelegAn();
  const steuer = (bruttoCent * 19n + 59n) / 119n;
  const netto = bruttoCent - steuer;
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, titel, zusammenfassung, risiko,
                           payload_hash, erstellt_von, freigegeben_von, freigegeben_am)
     values ($1,'eingangsrechnung_buchen','genehmigt','Probe','Probe','niedrig',
             repeat('b',64),$2,$2,now())
     returning id`, [f.bau, benutzer]);
  const id = await mitSitzung(async (tx) => {
    const [r] = await tx.unsafe<{ id: string }[]>(
      `insert into eingangsrechnung
         (mandant_id, lieferant_id, beleg_id, rechnungsnummer_lieferant,
          rechnungsdatum, leistungsdatum, netto_cent, steuer_cent, brutto_cent,
          bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp, bauabzugsteuer_cent,
          faellig_am, status, freigabe_id, freigegeben_von, freigegeben_am,
          erstellt_von_art, erstellt_von)
       values ($1,$2,$3,$4,'2026-08-05','2026-08-05',$5,$6,$7,$8,1500,$9,'2026-09-05',
               'freigegeben',$10,$11,now(),'mensch',$11)
       returning id`,
      [f.bau, lieferantId, beleg, `R-${zufall()}`, netto.toString(), steuer.toString(),
        bruttoCent.toString(), pflichtig, einbehaltCent.toString(), fr!.id, benutzer] as never[]);
    await tx.unsafe(
      `insert into eingangsrechnung_steuer
         (mandant_id, eingangsrechnung_id, steuersatz_gruppe_id, satz_bp, kategorie,
          netto_cent, steuer_cent, erstellt_von_art, erstellt_von)
       select $1, $2, g.id, g.satz_bp, g.kategorie, $3::bigint, $4::bigint, 'mensch', $5
         from steuersatz_gruppe g where g.schluessel = 'ust_19'`,
      [f.bau, r!.id, netto.toString(), steuer.toString(), benutzer] as never[]);
    await tx.unsafe(
      `update eingangsrechnung set status = 'gebucht', gebucht_am = now() where id = $1`, [r!.id]);
    return r!.id;
  });
  const [op] = await sql.unsafe<{ id: string }[]>(
    `select id from offener_posten where eingangsrechnung_id = $1 and art = 'kreditor'`, [id]);
  return { id, posten: op!.id };
}

/** Eine Zahlung an den Lieferanten auf den Posten — Richtung `ausgang`. */
async function zahle(posten: string, betragCent: bigint, tag: string): Promise<string> {
  return mitSitzung(async (tx) => {
    const [z] = await tx.unsafe<{ id: string }[]>(
      `insert into zahlung (mandant_id, richtung, betrag_cent, zahlungsdatum, zahlungsmittel,
                            erstellt_von_art, erstellt_von)
       values ($1,'ausgang',$2,$3::date,'ueberweisung','mensch',$4) returning id`,
      [f.bau, betragCent.toString(), tag, benutzer] as never[]);
    await tx.unsafe(
      `insert into zahlung_zuordnung (mandant_id, zahlung_id, offener_posten_id, art, betrag_cent,
                                      erstellt_von_art, erstellt_von)
       values ($1,$2,$3,'zahlung',$4,'mensch',$5)`,
      [f.bau, z!.id, posten, betragCent.toString(), benutzer] as never[]);
    return z!.id;
  });
}

function kontextAus(tx: postgres.TransactionSql, wer: string): LeseKontext {
  const abfrage = async <T>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: wer,
    aktiverMandantId: f.bau, mandantIds: [f.bau], abfrage,
  } as LeseKontext;
}

async function uebersicht(wer = benutzer) {
  return alsApp(
    { scope: 'mandant', mandantId: f.bau, mandantIds: [f.bau], benutzerId: wer,
      portal: 'intern', readonly: true },
    async (tx) => ladeBauabzugUebersicht(kontextAus(tx, wer)));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'eingangsrechnung_beleg', null, 2026, 'Eingangsbelege', true,
             'EB-{jahr}-{nr:5}', 'jaehrlich', '2026-01-01', false, 'system', 'job:test')`,
    [f.bau]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, steuernummer, status,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1,$2,'Gerüstbau Probe GmbH','27/123/45678','aktiv','system','test') returning id`,
    [f.bau, `L-${zufall()}`]);
  lieferantId = l!.id;
});
afterAll(schliessen);

describe('(1) der Monat ist der der Zahlung, anteilig', () => {
  it('zwei Raten in zwei Monaten: zwei Zeilen, zusammen der Einbehalt, Frist je Monat', async () => {
    // 10.000,00 € brutto, 1.500,00 € einbehalten → Posten 8.500,00 €.
    const r = await gebuchteRechnung(1_000_000n, 150_000n);
    await zahle(r.posten, 425_000n, '2026-08-20');
    await zahle(r.posten, 425_000n, '2026-09-02');

    const u = await uebersicht();
    expect(u.offen).toEqual([]);
    expect(u.zeilen.map((z) => ({ monat: z.monat, einbehalt: z.einbehaltCent, frist: z.frist,
      lieferant: z.lieferant, steuernummer: z.steuernummer, rechnungen: z.rechnungen })))
      .toEqual([
        { monat: '2026-09', einbehalt: 75_000n, frist: '2026-10-12',
          lieferant: 'Gerüstbau Probe GmbH', steuernummer: '27/123/45678', rechnungen: 1 },
        { monat: '2026-08', einbehalt: 75_000n, frist: '2026-09-10',
          lieferant: 'Gerüstbau Probe GmbH', steuernummer: '27/123/45678', rechnungen: 1 },
      ]);
  });
});

describe('(2) Storno und Offenes', () => {
  it('eine stornierte Zahlung zählt nicht — ihr Anteil steht wieder offen', async () => {
    const r = await gebuchteRechnung(1_000_000n, 150_000n);
    const z = await zahle(r.posten, 850_000n, '2026-08-20');
    await mitSitzung(async (tx) => {
      await tx.unsafe(
        `update zahlung set storniert_am = now(), storno_grund = 'Fehlbuchung, falscher Posten'
          where id = $1`, [z]);
    });
    const u = await uebersicht();
    expect(u.zeilen).toEqual([]);
    expect(u.offen.map((o) => o.offenCent)).toEqual([150_000n]);
  });

  it('eine Teilzahlung: ihr Anteil im Monat, der Rest offen', async () => {
    const r = await gebuchteRechnung(1_000_000n, 150_000n);
    await zahle(r.posten, 85_000n, '2026-08-20');
    const u = await uebersicht();
    expect(u.zeilen.map((z) => z.einbehaltCent)).toEqual([15_000n]);
    expect(u.offen.map((o) => o.offenCent)).toEqual([135_000n]);
  });
});

describe('(3) nur, wo einbehalten wurde', () => {
  it('ohne Einbehalt oder ohne Pflicht: keine Zeile, nichts offen', async () => {
    const ohne = await gebuchteRechnung(1_000_000n, 0n);
    await zahle(ohne.posten, 1_000_000n, '2026-08-20');
    const nichtPflichtig = await gebuchteRechnung(500_000n, 0n, false);
    await zahle(nichtPflichtig.posten, 500_000n, '2026-08-21');
    const u = await uebersicht();
    expect(u.zeilen).toEqual([]);
    expect(u.offen).toEqual([]);
  });
});

describe('(4) ohne zahlung.lesen sind die Zahlungen unsichtbar', () => {
  it('alles offen, nichts einem Monat zugeschrieben', async () => {
    const r = await gebuchteRechnung(1_000_000n, 150_000n);
    await zahle(r.posten, 850_000n, '2026-08-20');
    const email = `leitung-${zufall()}@cse.test`;
    const [u0] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
      [u0!.id, email] as never[]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
      [u0!.id, f.bau]);
    // Die Leitung hält eingang.lesen nicht von Haus aus (bindbar, 0008) — hier gebunden.
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select (select id from rolle where schluessel = 'leitung' and mandant_id is null),
              b.id, $1, true from berechtigung b where b.schluessel = 'eingang.lesen'`, [f.bau]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select (select id from rolle where schluessel = 'leitung' and mandant_id is null),
              b.id, $1, false from berechtigung b where b.schluessel = 'zahlung.lesen'`, [f.bau]);
    const u = await uebersicht(u0!.id);
    expect(u.zeilen).toEqual([]);
    expect(u.offen.map((o) => o.offenCent)).toEqual([150_000n]);
  });
});

describe('(5) die Frist im Kalender', () => {
  it('am 10. des Folgemonats (nächster Werktag), mit dem Weg auf das Blatt', async () => {
    const r = await gebuchteRechnung(1_000_000n, 150_000n);
    await zahle(r.posten, 850_000n, '2026-09-15');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, mandantIds: [f.bau], benutzerId: benutzer,
        portal: 'intern', readonly: true },
      async (tx) => kalenderZeilen(kontextAus(tx, benutzer), {
        zeitraum: { von: '2026-10-01', bis: '2026-10-31', bezeichnung: 'Oktober' },
      }));
    const frist = zeilen.filter((z) => z.quelle === 'bauabzug');
    expect(frist).toHaveLength(1);
    expect(frist[0]).toMatchObject({
      beginn: '2026-10-12', ganztaegig: true, weg: '/portal/bau/finanzen/bauabzug',
    });
    // Der Weg führt auf eine Seite, die es gibt (wie bei jeder Quelle, kalender.test.ts).
    expect(existsSync('src/app/portal/[mandant]/finanzen/bauabzug/page.tsx')).toBe(true);

    // Im persönlichen Kalender steht sie nicht: sie gehört der Gesellschaft (D-517).
    const eigene = await alsApp(
      { scope: 'mandant', mandantId: f.bau, mandantIds: [f.bau], benutzerId: benutzer,
        portal: 'intern', readonly: true },
      async (tx) => kalenderZeilen(kontextAus(tx, benutzer), {
        zeitraum: { von: '2026-10-01', bis: '2026-10-31', bezeichnung: 'Oktober' },
        nurBenutzerId: benutzer,
      }));
    expect(eigene.filter((z) => z.quelle === 'bauabzug')).toEqual([]);
  });
});
