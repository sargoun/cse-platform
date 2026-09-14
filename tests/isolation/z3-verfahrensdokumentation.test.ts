/**
 * PR 66 — Z3-Datentraegerueberlassung und Verfahrensdokumentation gegen
 * eine echte Datenbank (ACC-09, ACC-10, LEG-01, D-485).
 *
 *  1. Das Z3-Paket: reproduzierbar (zweimal derselbe Hash), jede Datei mit
 *     Pruefsumme, `index.xml` wohlgeformt, das Journal geht auf (Soll =
 *     Haben, und beides = die Datenbank), die Rechnung steht drin, der
 *     Lieferantenstamm traegt keine IBAN — und die Rechnung der einen
 *     Gesellschaft steht nicht im Paket der anderen.
 *  2. Die Verfahrensdokumentation: liest die lebende Konfiguration (ein
 *     neuer Nummernkreis aendert Inhalt und Hash), nennt Rollen mit ihren
 *     Finanzrechten, die Aufbewahrungsregeln, die Jobs, die
 *     Auftragsverarbeiter; ohne Journal sagt sie das, mit Journal nennt sie
 *     den Stand; wem das Recht fehlt, dem verweigert die Datenbank den
 *     Schemastand.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import {
  INDEX_NAME, LIESMICH_NAME, PRUEFSUMMEN_NAME, TABELLEN, erstelleZ3Paket,
} from '../../src/server/services/buchhaltung/z3.js';
import {
  alsMarkdown, alsText, erstelleVerfahrensdokumentation,
} from '../../src/server/services/buchhaltung/verfahrensdokumentation.js';
import { leseZipEintrag, leseZipVerzeichnis } from '../../src/server/services/archiv/zip.js';
import { leseXml } from '../../src/server/services/finanz/xml-lesen.js';
import { AUFTRAGSVERARBEITER } from '../../src/server/registry/auftragsverarbeiter.js';
import type { JobDefinition } from '../../src/server/jobs/registry.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const cp1252 = new TextDecoder('windows-1252');
const utf8 = new TextDecoder('utf-8');

const JOBS: readonly JobDefinition[] = [{
  schluessel: 'kette_pruefen', bezeichnung: 'Hash-Kette nachrechnen', zeitplan: '15 2 * * *',
  bereich: 'je_mandant', versuche: 1, ausfuehren: () => Promise.resolve({}),
}];
const AUSLIEFERUNG = { commit: 'abc1234', region: 'fra1', umgebung: 'test' };

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzerId ?? benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string): SchreibKontext {
  const m = mandantId ?? f.reinigung;
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzerId ?? benutzer,
    aktiverMandantId: m, mandantIds: [m], abfrage, schreibe: abfrage,
  };
}

async function legeBenutzerAn(email: string, globaleRolle: string | null = 'super_admin'): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, globaleRolle]);
  return u!.id;
}

/** Eine Administration der Reinigung — Mitglied ueber `benutzer_mandant`, ohne globale Rolle. */
async function legeAdministrationAn(): Promise<string> {
  const id = await legeBenutzerAn(`admin-${zufall()}@cse.test`, null);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [id, f.reinigung]);
  return id;
}

/** Entzieht der Systemrolle ein Recht in genau dieser Gesellschaft (der `○`-Fall aus §12). */
async function entziehe(rolle: string, recht: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, false
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2`,
    [rolle, recht, mandantId]);
}

async function macheFakturierfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            telefon = '+49 30 5550100', email = 'rechnung@cse.test',
            rechnung_kontakt_name = 'Buchhaltung',
            elektronische_adresse = 'DE123456789', elektronische_adresse_schema = '9930',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B',
            iban = 'DE02120300000000202051'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

async function richteKontenEin(mandantId: string, kunde: string): Promise<void> {
  await sql.unsafe(
    `insert into datev_konfiguration
       (mandant_id, kontenrahmen, sachkontenlaenge, wj_beginn_monat, wj_beginn_tag,
        ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'skr03'::kontenrahmen, 4, 1, 1, true, 'system', 'job:test')
     on conflict (mandant_id) do nothing`, [mandantId]);
  const [ust19] = await sql.unsafe<{ id: string }[]>(
    `select id from steuersatz_gruppe where schluessel = 'ust_19'`);
  const zuordnung = async (typ: string, konto: string, zusatz: {
    gruppe?: string; schluessel?: string; kunde?: string;
  } = {}): Promise<void> => {
    await sql.unsafe(
      `insert into konto_mapping
         (mandant_id, kontenrahmen, schluessel_typ, steuersatz_gruppe_id,
          erloeskonto_schluessel, kunde_id, konto, gueltig_von, ist_platzhalter,
          erstellt_von_art, erstellt_von_dienst)
       values ($1, 'skr03'::kontenrahmen, $2::konto_schluessel_typ, $3, $4, $5, $6,
               '2020-01-01', false, 'system', 'job:test')`,
      [mandantId, typ, zusatz.gruppe ?? null, zusatz.schluessel ?? null,
        zusatz.kunde ?? null, konto]);
  };
  await zuordnung('erloes_leistung', '8400', { schluessel: 'standard', gruppe: ust19!.id });
  await zuordnung('steuer_gruppe', '1776', { gruppe: ust19!.id });
  await zuordnung('debitor_kunde', '10001', { kunde });
}

/** Eine festgeschriebene 19-%-Rechnung ueber 1.000,00 netto: Nummer, Kettenglied, Buchungszeilen. */
async function festgeschrieben(preisCent = 100_000n): Promise<{ id: string; nummer: string }> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = kontextAus(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung "Süd"',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`, [neu] as never[]);
    await tx.unsafe(
      `update rechnungsposition set erloeskonto_schluessel = 'standard'
        where rechnung_id = $1 and netto_cent is not null`, [neu] as never[]);
    return neu;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(kontextAus(tx), id));
  const [r] = await sql.unsafe<{ nummer: string }[]>(`select nummer from rechnung where id = $1`, [id]);
  return { id, nummer: r!.nummer };
}

async function heuteJahr(): Promise<number> {
  const [z] = await sql.unsafe<{ jahr: number }[]>(`select extract(year from app.berlin_heute())::int as jahr`);
  return z!.jahr;
}

/** Eine CSV aus dem Paket als Zeilen von Feldern (die Felder sind maskiert, wie geschrieben). */
function csvZeilen(bytes: Uint8Array): readonly (readonly string[])[] {
  return cp1252.decode(bytes).split('\r\n').filter((z) => z !== '')
    .map((z) => z.split(';').map((feld) => (feld.startsWith('"') ? feld.slice(1, -1).replace(/""/gu, '"') : feld)));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`z3-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort,
                        ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
                        elektronische_adresse, elektronische_adresse_schema)
     values ($1, $2, 'behoerde', 'Bezirksamt Musterberg', 'Musterplatz', '1', '10178',
             'Berlin', true, true, '991-12345-67', '991-12345-67', '0204')
     returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
  await richteKontenEin(f.reinigung, kundeId);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) das Z3-Paket', () => {
  it('ist reproduzierbar, prueft sich selbst, geht auf und traegt die Rechnung — ohne IBAN', async () => {
    const r = await festgeschrieben();
    const jahr = await heuteJahr();
    const a = await alsApp(sitzung(), (tx) => erstelleZ3Paket(kontextAus(tx), jahr));
    const b = await alsApp(sitzung(), (tx) => erstelleZ3Paket(kontextAus(tx), jahr));
    expect(a.zipSha256).toBe(b.zipSha256);
    expect(a.zipSha256).toMatch(/^[0-9a-f]{64}$/u);

    /* Jede Tabelle, index.xml, LIESMICH.txt, pruefsummen.txt — nichts sonst. */
    const verzeichnis = leseZipVerzeichnis(a.zip);
    const pfade = verzeichnis.map((e) => e.pfad);
    expect(pfade).toEqual([...TABELLEN.map((t) => `${t.name}.csv`), INDEX_NAME, LIESMICH_NAME, PRUEFSUMMEN_NAME].sort());
    const dateien = new Map(verzeichnis.map((e) => [e.pfad, leseZipEintrag(a.zip, e)]));

    /* pruefsummen.txt stimmt fuer jede Datei (das Format von `sha256sum -c`). */
    const pruefsummen = utf8.decode(dateien.get(PRUEFSUMMEN_NAME)!).trim().split('\n');
    expect(pruefsummen).toHaveLength(pfade.length - 1);
    for (const zeile of pruefsummen) {
      const [hash, pfad] = zeile.split('  ');
      expect(sha256(dateien.get(pfad!)!), pfad).toBe(hash);
    }
    for (const t of a.tabellen) expect(sha256(dateien.get(t.datei)!)).toBe(t.sha256);

    /* index.xml ist wohlgeformt und fuehrt jede Tabelle. */
    const xml = utf8.decode(dateien.get(INDEX_NAME)!);
    expect(xml).toContain('<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">');
    const wurzel = leseXml(xml.split('\n').filter((z) => !z.startsWith('<!DOCTYPE')).join('\n'));
    const media = wurzel.kinder.find((k) => k.name === 'Media')!;
    expect(media.kinder.filter((k) => k.name === 'Table')).toHaveLength(TABELLEN.length);
    expect(wurzel.kinder.find((k) => k.name === 'DataSupplier')?.kinder.find((k) => k.name === 'Name')?.text)
      .toBe('CSE Dienstleistungen GmbH');

    /* Die Rechnung steht drin — mit Nummer, Kunde, Betrag in Dezimalkomma und Kettenglied. */
    const rechnungen = csvZeilen(dateien.get('rechnungen.csv')!);
    const kopf = rechnungen[0]!;
    const zeile = rechnungen.slice(1).find((z) => z[kopf.indexOf('id')] === r.id);
    expect(zeile).toBeDefined();
    expect(zeile![kopf.indexOf('nummer')]).toBe(r.nummer);
    expect(zeile![kopf.indexOf('kunde_name')]).toBe('Bezirksamt Musterberg');
    expect(zeile![kopf.indexOf('netto')]).toBe('1000,00');
    expect(zeile![kopf.indexOf('brutto')]).toBe('1190,00');
    expect(zeile![kopf.indexOf('hash')]).toMatch(/^[0-9a-f]{64}$/u);
    const positionen = csvZeilen(dateien.get('rechnungspositionen.csv')!);
    const pKopf = positionen[0]!;
    const position = positionen.slice(1).find((z) => z[pKopf.indexOf('rechnung_id')] === r.id);
    expect(position![pKopf.indexOf('bezeichnung')]).toBe('Unterhaltsreinigung "Süd"');
    expect(position![pKopf.indexOf('menge')]).toBe('1,000');

    /* Das Journal geht auf: Soll = Haben, und beides = die Datenbank. */
    const buchungen = csvZeilen(dateien.get('buchungen.csv')!);
    const bKopf = buchungen[0]!;
    const summe = (seite: string): bigint => buchungen.slice(1)
      .filter((z) => z[bKopf.indexOf('soll_haben')] === seite)
      .reduce((s, z) => s + BigInt(z[bKopf.indexOf('umsatz')]!.replace(',', '')), 0n);
    expect(buchungen.length).toBeGreaterThan(1);
    expect(summe('soll')).toBe(summe('haben'));
    const [db] = await sql.unsafe<{ soll: string; haben: string }[]>(
      `select coalesce(sum(umsatz_cent) filter (where soll_haben = 'soll'), 0)::text as soll,
              coalesce(sum(umsatz_cent) filter (where soll_haben = 'haben'), 0)::text as haben
         from buchungssatz where mandant_id = $1 and belegdatum between $2::date and $3::date`,
      [f.reinigung, a.von, a.bis]);
    expect(summe('soll')).toBe(BigInt(db!.soll));
    expect(summe('haben')).toBe(BigInt(db!.haben));
    expect(a.tabellen.find((t) => t.name === 'buchungen')?.zeilen).toBe(buchungen.length - 1);

    /* Unvollstaendige Zeilen: dieselbe Zahl wie die Datenbank — und LIESMICH nennt sie. */
    const [offen] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from app.export_unvollstaendig($1::uuid, $2::date, $3::date)`,
      [f.reinigung, a.von, a.bis]);
    expect(a.unvollstaendig).toBe(offen!.n);
    const liesmich = utf8.decode(dateien.get(LIESMICH_NAME)!);
    expect(liesmich).toContain(`ohne Beleg oder ohne Konto: ${String(offen!.n)}`);
    expect(liesmich).toContain('keine Berechnung von Steuern oder Löhnen (D-06)');
    expect(liesmich).toContain('PLATZHALTER');

    /* Der Lieferantenstamm ohne IBAN; der Kundenstamm mit dem Kunden. */
    expect(csvZeilen(dateien.get('lieferanten.csv')!)[0]).not.toContain('iban');
    const kunden = csvZeilen(dateien.get('kunden.csv')!);
    expect(kunden.slice(1).some((z) => z[kunden[0]!.indexOf('id')] === kundeId)).toBe(true);
    /* Umlaute ueberleben Windows-1252; nichts wurde ersetzt. */
    expect(a.ersetzteZeichen).toBe(0);
  });

  it('die Rechnung der einen Gesellschaft steht nicht im Paket der anderen', async () => {
    const r = await festgeschrieben();
    const jahr = await heuteJahr();
    const bau = await alsApp(sitzung(f.bau), (tx) => erstelleZ3Paket(kontextAus(tx, f.bau), jahr));
    const verzeichnis = leseZipVerzeichnis(bau.zip);
    const rechnungen = cp1252.decode(leseZipEintrag(bau.zip, verzeichnis.find((e) => e.pfad === 'rechnungen.csv')!));
    expect(rechnungen).not.toContain(r.id);
    expect(rechnungen).not.toContain(r.nummer);
    expect(bau.firma).not.toBe('CSE Dienstleistungen GmbH');
  });
});

describe('(2) die Verfahrensdokumentation', () => {
  it('liest die lebende Konfiguration — und ein neuer Nummernkreis aendert Inhalt und Hash', async () => {
    await festgeschrieben();
    const eingabe = { jobs: JOBS, auslieferung: AUSLIEFERUNG };
    const a = await alsApp(sitzung(), (tx) => erstelleVerfahrensdokumentation(kontextAus(tx), eingabe));
    const b = await alsApp(sitzung(), (tx) => erstelleVerfahrensdokumentation(kontextAus(tx), eingabe));
    expect(a.sha256).toBe(b.sha256);
    expect(a.firma).toBe('CSE Dienstleistungen GmbH');
    expect(a.abschnitte.map((x) => x.nummer)).toEqual(
      ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '3.1', '3.2', '3.3', '3.4', '4.1', '4.2', '4.3', '5']);

    const abschnitt = (nummer: string) => a.abschnitte.find((x) => x.nummer === nummer)!;
    /* 1.1 Gesellschaft aus der Datenbank. */
    expect(abschnitt('1.1').absaetze.join(' ')).toContain('HRB 12345 B');
    expect(abschnitt('1.1').absaetze.join(' ')).toContain('DE123456789');
    /* 1.3 jeder Auftragsverarbeiter, ohne erfundenes Vertragsdatum. */
    expect(abschnitt('1.3').tabelle?.zeilen.map((z) => z[0])).toEqual(AUFTRAGSVERARBEITER.map((x) => x.dienst));
    expect(abschnitt('1.3').tabelle?.zeilen.every((z) => z[4] === 'nicht hinterlegt')).toBe(true);
    /* 2.1 der Nummernkreis mit seiner Maske und dem Kettenstand. */
    expect(abschnitt('2.1').tabelle?.zeilen.some((z) => z[2] === 'RE-{nr:5}' && z[3] === 'ja')).toBe(true);
    expect(abschnitt('2.1').bestand?.join(' ')).toMatch(/Kettenglieder: [1-9]\d* in 1 Kreis/u);
    expect(abschnitt('2.1').bestand?.join(' ')).toContain('nächste Nummer 2');
    /* Der Bestand steht daneben, nicht im Hash: ein Abruf mehr im Protokoll aendert ihn nicht. */
    expect(utf8.decode(a.kanonisch)).not.toContain('Kettenglieder:');
    expect(utf8.decode(a.kanonisch)).not.toContain('Protokoll dieser Gesellschaft');
    expect(abschnitt('3.2').bestand?.[0]).toMatch(/^Protokoll dieser Gesellschaft: [1-9]\d* Einträge/u);
    /* 2.3 Kontenrahmen als Platzhalter, Zuordnungen gezaehlt. */
    expect(abschnitt('2.3').absaetze.join(' ')).toContain('SKR03');
    expect(abschnitt('2.3').absaetze.join(' ')).toContain('Platzhalter (O-05)');
    expect(abschnitt('2.3').absaetze.join(' ')).toContain('erloes_leistung 1');
    /* 2.5 neun Aufbewahrungsregeln, keine unter zehn Jahren fuer Rechnungen. */
    expect(abschnitt('2.5').tabelle?.zeilen).toHaveLength(9);
    expect(abschnitt('2.5').tabelle?.zeilen.find((z) => z[0] === 'rechnung')?.[1]).toBe('10');
    /* 3.3 die Jobs, wie hereingegeben. */
    expect(abschnitt('3.3').tabelle?.zeilen).toEqual([['kette_pruefen', 'Hash-Kette nachrechnen', '15 2 * * *', 'je_mandant', '1']]);
    /* 4.1 die Administration mit ihren Finanzrechten; die Super-Administration hat ein Mitglied (uns). */
    const admin = abschnitt('4.1').tabelle?.zeilen.find((z) => z[0] === 'admin');
    expect(admin?.[7]).toContain('buchhaltung.lesen');
    expect(admin?.[7]).toContain('buchhaltung.exportieren');
    expect(admin?.[7]).not.toContain('buchhaltung_konfiguration.verwalten');
    /* Ohne Journal: kein erfundener Stand, sondern ein offener Punkt. */
    expect(a.schemastand).toBeNull();
    expect(a.offen.join(' ')).toContain('kein Migrationsjournal');
    expect(abschnitt('5').absaetze.join(' ')).toContain('O-05');

    const markdown = alsMarkdown(a);
    expect(markdown).toContain('# Verfahrensdokumentation — CSE Dienstleistungen GmbH');
    expect(markdown).toContain('## 2. Anwenderdokumentation — die Verfahren');
    expect(markdown).toContain('| Kreis | Bezeichnung | Maske |');
    expect(markdown).toContain(`\`${a.sha256}\``);
    expect(alsText(a)).toContain('3. TECHNISCHE SYSTEMDOKUMENTATION');

    /* Ein zweiter Nummernkreis: die Dokumentation aendert sich, der Hash auch. */
    await sql.unsafe(
      `insert into nummernkreis
         (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
          zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 'eingangsrechnung_beleg', null, 0, 'Eingangsbelege', true, 'EB-{nr:6}', 'nie',
               '2026-01-01', true, 'system', 'job:test')`, [f.reinigung]);
    const c = await alsApp(sitzung(), (tx) => erstelleVerfahrensdokumentation(kontextAus(tx), eingabe));
    expect(c.sha256).not.toBe(a.sha256);
    expect(c.abschnitte.find((x) => x.nummer === '2.1')?.tabelle?.zeilen.some((z) => z[2] === 'EB-{nr:6}')).toBe(true);
    expect(c.offen.join(' ')).toContain('Nummernkreis ist ein Platzhalter');
  });

  it('nennt den Schemastand, wo ein Journal gefuehrt wird', async () => {
    await sql.unsafe(`create table if not exists __drizzle_migrations
      (name text primary key, angewendet_am timestamptz not null default now())`);
    try {
      await sql.unsafe(`insert into __drizzle_migrations (name) values ('0001_rollen_und_mandant.sql'), ('0142_migrationsstand.sql')
                        on conflict do nothing`);
      await sql.unsafe(`grant select on __drizzle_migrations to cse_definer`);
      const d = await alsApp(sitzung(), (tx) =>
        erstelleVerfahrensdokumentation(kontextAus(tx), { jobs: JOBS, auslieferung: AUSLIEFERUNG }));
      expect(d.schemastand?.migration).toBe('0142_migrationsstand.sql');
      expect(d.migrationen).toBe(2);
      expect(d.offen.join(' ')).not.toContain('kein Migrationsjournal');
      expect(alsMarkdown(d)).toContain('zuletzt 0142_migrationsstand.sql am ');
    } finally {
      await sql.unsafe(`drop table if exists __drizzle_migrations`);
    }
  });

  it('wem das Recht fehlt, dem verweigert die Datenbank den Schemastand', async () => {
    const admin = await legeAdministrationAn();
    await entziehe('admin', 'buchhaltung_konfiguration.lesen', f.reinigung);
    await expect(alsApp(sitzung(undefined, admin), (tx) =>
      erstelleVerfahrensdokumentation(kontextAus(tx, undefined, admin), { jobs: JOBS, auslieferung: AUSLIEFERUNG })))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /Verfahrensdokumentation|privilege/u.test(e.message));
  });
});
