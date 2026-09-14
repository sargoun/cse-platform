/**
 * PR 67 — Jahrespaket und Lohnexport gegen eine echte Datenbank (ACC-11,
 * ACC-12, D-06, D-486).
 *
 *  1. Das Jahrespaket: reproduzierbar; traegt die Tabellen, die Monatszahlen,
 *     das Ausgangsbuch, den registrierten DATEV-Stapel MIT Datei (Hash =
 *     Export), das Pruefbuendel MIT Beleg (Hash = Beleg), die
 *     Verfahrensdokumentation ohne Abrufzeit, Pruefsummen fuer alles. Ohne
 *     Speicher fehlen die Dateien und das LIESMICH sagt es; im Manifestlauf
 *     wird nichts geholt und nichts gepackt.
 *  2. Der Lohnexport: je Beschaeftigung das Konto des Monats mit Korrektur,
 *     die Abwesenheit mit „unklar" statt geratenem „bezahlt", drei Tabellen,
 *     Platzhalter benannt (O-27); die Beschaeftigung der anderen
 *     Gesellschaft (D-09: dieselbe Person, zwei Anstellungen) steht nicht
 *     darin.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, type Speicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import { archiviereRechnungsbeleg } from '../../src/server/services/buchhaltung/belegarchiv.js';
import { erzeugeDatevExport } from '../../src/server/services/buchhaltung/datev/export.js';
import { erstelleJahrespaket } from '../../src/server/services/buchhaltung/jahrespaket.js';
import { erstelleLohnexport } from '../../src/server/services/zeit/lohnexport.js';
import { bucheKorrektur, eroeffneKonto } from '../../src/server/services/zeit/stundenkonto.js';
import { leseZipEintrag, leseZipVerzeichnis } from '../../src/server/services/archiv/zip.js';
import type { JobDefinition } from '../../src/server/jobs/registry.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const cp1252 = new TextDecoder('windows-1252');
const utf8 = new TextDecoder('utf-8');
const STUNDE = new Date('2026-09-01T10:00:00Z');

const JOBS: readonly JobDefinition[] = [{
  schluessel: 'kette_pruefen', bezeichnung: 'Hash-Kette nachrechnen', zeitplan: '15 2 * * *',
  bereich: 'je_mandant', versuche: 1, ausfuehren: () => Promise.resolve({}),
}];
const DOKU = { jobs: JOBS, auslieferung: { commit: 'abc1234', region: 'fra1', umgebung: 'test' } };

/** Ein Speicher, der nicht da ist — wie in einer Umgebung ohne Zugangsdaten. */
const KEIN_SPEICHER: Speicher = {
  verbunden: false,
  lege: () => Promise.reject(new Error('nicht verbunden')),
  hole: () => Promise.reject(new Error('nicht verbunden')),
  entferne: () => Promise.reject(new Error('nicht verbunden')),
  signierteUrl: () => Promise.reject(new Error('nicht verbunden')),
};

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string): SchreibKontext {
  const m = mandantId ?? f.reinigung;
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: m, mandantIds: [m], abfrage, schreibe: abfrage,
  };
}

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

/** Die O-05-Stammdaten vollstaendig UND bestaetigt — im Betrieb macht das ein Mensch. */
async function stammdatenBestaetigen(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update datev_konfiguration
        set berater_nummer = '1234567', mandanten_nummer = '55555',
            kontenrahmen = 'skr03'::kontenrahmen, sachkontenlaenge = 4,
            wj_beginn_monat = 1, wj_beginn_tag = 1,
            versteuerungsart = 'soll'::versteuerungsart, extf_version = '700'
      where mandant_id = $1`, [mandantId]);
  await sql.unsafe(
    `update datev_konfiguration set ist_platzhalter = false where mandant_id = $1`, [mandantId]);
}

async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = kontextAus(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
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
  return id;
}

/** Archiviert in DIESEM Speicher, dann der DATEV-Stapel ueber den Zeitraum der Rechnung. */
async function jahrgangMitStapel(speicher: LokalerSpeicher) {
  const rechnung = await festgeschrieben();
  const e = await alsApp(sitzung(), (tx) => archiviereRechnungsbeleg(kontextAus(tx), speicher, rechnung));
  await stammdatenBestaetigen(f.reinigung);
  const [z] = await sql.unsafe<{ von: string; bis: string }[]>(
    `select min(belegdatum)::text as von, max(belegdatum)::text as bis from buchungssatz where rechnung_id = $1`,
    [rechnung]);
  const stapel = await alsApp(sitzung(), (tx) =>
    erzeugeDatevExport(kontextAus(tx), speicher, z!.von, z!.bis, STUNDE, 'Test'));
  return { rechnung, belegSha256: e.sha256!, stapel, jahr: Number(z!.von.slice(0, 4)) };
}

function entraege(zip: Uint8Array): Map<string, Uint8Array> {
  return new Map(leseZipVerzeichnis(zip).map((e) => [e.pfad, leseZipEintrag(zip, e)]));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`jahr-${zufall()}@cse.test`);
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

describe('(1) das Jahrespaket', () => {
  it('traegt Tabellen, Monatszahlen, Stapel mit Datei, Buendel mit Beleg und Dokumentation — reproduzierbar, mit Pruefsummen', async () => {
    const speicher = new LokalerSpeicher();
    const j = await jahrgangMitStapel(speicher);
    const a = await alsApp(sitzung(), (tx) => erstelleJahrespaket(kontextAus(tx), speicher, j.jahr, DOKU));
    const b = await alsApp(sitzung(), (tx) => erstelleJahrespaket(kontextAus(tx), speicher, j.jahr, DOKU));
    expect(a.zipSha256).toBe(b.zipSha256);
    expect(a.zip).not.toBeNull();
    const dateien = entraege(a.zip!);
    const pfade = [...dateien.keys()];

    /* Pruefsummen fuer jede Datei. */
    const pruefsummen = utf8.decode(dateien.get('pruefsummen.txt')!).trim().split('\n');
    expect(pruefsummen).toHaveLength(pfade.length - 1);
    for (const zeile of pruefsummen) {
      const [hash, pfad] = zeile.split('  ');
      expect(sha256(dateien.get(pfad!)!), pfad).toBe(hash);
    }

    /* Tabellen und Auswertungen. */
    expect(pfade.filter((p) => p.startsWith('daten/'))).toHaveLength(14);
    expect(cp1252.decode(dateien.get('daten/rechnungen.csv')!)).toContain(j.rechnung);
    const monate = cp1252.decode(dateien.get('auswertung/monatszahlen.csv')!).trim().split('\r\n');
    expect(monate).toHaveLength(13);
    expect(monate[0]).toContain('monat;von;bis;erloese;rechnungen;aufwand');
    expect(cp1252.decode(dateien.get('auswertung/rechnungsausgangsbuch.csv')!).trim().split('\r\n').length).toBeGreaterThan(1);
    expect(pfade).toContain('auswertung/offene-posten-debitoren.csv');
    expect(pfade).toContain('auswertung/altersstruktur.csv');

    /* Der registrierte Stapel — als Zeile und als Datei mit demselben Hash wie der Export. */
    const stapel = cp1252.decode(dateien.get('datev/stapel.csv')!).trim().split('\r\n');
    expect(stapel).toHaveLength(2);
    expect(stapel[1]).toContain(j.stapel.exportId);
    expect(stapel[1]).toContain(j.stapel.sha256);
    const extf = pfade.find((p) => p.startsWith('datev/EXTF_'));
    expect(extf).toBeDefined();
    expect(sha256(dateien.get(extf!)!)).toBe(j.stapel.sha256);
    expect(stapel[1]).toContain(extf!);
    expect(a.zahlen.zeilenOhneStapel).toBe(0);
    expect(a.zahlen.datevDateien).toBe(1);

    /* Das Pruefbuendel mit Beleg. */
    const manifest = JSON.parse(utf8.decode(dateien.get('pruefbuendel/manifest.json')!)) as Record<string, unknown>;
    expect(manifest['art']).toBe('cse-pruefbuendel');
    const beleg = pfade.find((p) => p.startsWith('pruefbuendel/belege/'));
    expect(beleg).toBeDefined();
    expect(sha256(dateien.get(beleg!)!)).toBe(j.belegSha256);
    expect(a.zahlen.belegeImPaket).toBe(1);
    expect(a.sperre).toBeNull();

    /* Die Dokumentation ohne Uhr; das LIESMICH ehrlich. */
    const vd = utf8.decode(dateien.get('verfahrensdokumentation.md')!);
    expect(vd).toContain('# Verfahrensdokumentation — CSE Dienstleistungen GmbH');
    expect(vd).not.toContain('Abgerufen am');
    const liesmich = utf8.decode(dateien.get('LIESMICH.txt')!);
    expect(liesmich).toContain('Zeilen ohne Stapel: 0');
    expect(liesmich).toContain('(D-06)');
    expect(a.hinweise.join(' ')).not.toContain('nicht verbunden');
  });

  it('ohne Speicher: Listen und Manifest, keine Dateien — und das LIESMICH sagt es; im Manifestlauf kein ZIP', async () => {
    const j = await jahrgangMitStapel(new LokalerSpeicher());
    const ohne = await alsApp(sitzung(), (tx) => erstelleJahrespaket(kontextAus(tx), KEIN_SPEICHER, j.jahr, DOKU));
    const pfade = [...entraege(ohne.zip!).keys()];
    expect(pfade.some((p) => p.startsWith('datev/EXTF_'))).toBe(false);
    expect(pfade.some((p) => p.startsWith('pruefbuendel/belege/'))).toBe(false);
    expect(pfade).toContain('datev/stapel.csv');
    expect(pfade).toContain('pruefbuendel/manifest.json');
    expect(ohne.hinweise.filter((h) => h.includes('nicht verbunden'))).toHaveLength(2);
    expect(ohne.zahlen.datevDateien).toBe(0);
    expect(ohne.zahlen.belegeImPaket).toBe(0);
    expect(ohne.zahlen.belege).toBe(1);

    const manifestlauf = await alsApp(sitzung(), (tx) =>
      erstelleJahrespaket(kontextAus(tx), new LokalerSpeicher(), j.jahr, DOKU, { nurManifest: true }));
    expect(manifestlauf.zip).toBeNull();
    expect(manifestlauf.zipSha256).toBeNull();
    expect(manifestlauf.dateien.map((d) => d.pfad)).toContain('LIESMICH.txt');
  });
});

describe('(2) der Lohnexport', () => {
  async function monatVon(anstellungId: string): Promise<{ monat: string; jahr: number; m: number; personalnummer: string }> {
    const [z] = await sql.unsafe<{ monat: string; personalnummer: string }[]>(
      `select to_char(greatest(an.eintritt, app.berlin_heute()), 'YYYY-MM') as monat, an.personalnummer
         from anstellung an where an.id = $1`, [anstellungId]);
    return { monat: z!.monat, jahr: Number(z!.monat.slice(0, 4)), m: Number(z!.monat.slice(5, 7)), personalnummer: z!.personalnummer };
  }

  it('Konto mit Korrektur, Abwesenheit (Fortbildung) mit „unklar", drei Tabellen, Platzhalter benannt — reproduzierbar', async () => {
    const { monat, jahr, m, personalnummer } = await monatVon(f.jonasReinigung);
    await alsApp(sitzung(), async (tx) => {
      const k = kontextAus(tx);
      await eroeffneKonto(k, { anstellungId: f.jonasReinigung, jahr, monat: m, sollMinuten: 9360 });
      await bucheKorrektur(k, { anstellungId: f.jonasReinigung, jahr, monat: m, minuten: 120, begruendung: 'Nachtrag aus dem Test' });
    });
    await sql.unsafe(
      `insert into abwesenheit (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, status,
                                tage_angerechnet, genehmigt_von, genehmigt_am)
       values ($1, $2, (select id from abwesenheitsart where schluessel = 'fortbildung' and mandant_id is null),
               ($3 || '-10')::date, ($3 || '-11')::date, 'genehmigt', 2, $4, now())`,
      [f.reinigung, f.jonasReinigung, monat, benutzer]);

    const a = await alsApp(sitzung(), (tx) => erstelleLohnexport(kontextAus(tx), monat));
    const b = await alsApp(sitzung(), (tx) => erstelleLohnexport(kontextAus(tx), monat));
    expect(a.zipSha256).toBe(b.zipSha256);
    expect(a.format.istPlatzhalter).toBe(true);
    expect(a.format.zielsystem).toBeNull();

    const jonas = a.zeilen.find((z) => z.anstellungId === f.jonasReinigung);
    expect(jonas).toBeDefined();
    expect(jonas!.personalnummer).toBe(personalnummer);
    expect(jonas!.konto).toBe('offen');
    expect(jonas!.sollMinuten).toBe(9360);
    expect(jonas!.korrekturMinuten).toBe(120);
    expect(jonas!.bewegungen.korrektur).toBe(120);
    const urlaub = a.abwesenheiten.find((x) => x.anstellungId === f.jonasReinigung);
    expect(urlaub?.art).toBe('fortbildung');
    expect(urlaub?.bezahlt).toBeNull();
    expect(urlaub?.lohnart).toBeNull();
    expect(urlaub?.tageAngerechnet).toBe('2,000');
    expect(a.zahlen.abwesenheitenBezahltUnklar).toBeGreaterThanOrEqual(1);
    expect(a.zahlen.vorlaeufig).toBeGreaterThanOrEqual(1);
    expect(a.hinweise.join(' ')).toContain('nicht gesperrt');
    expect(a.hinweise.join(' ')).toContain('O-27');

    const dateien = entraege(a.zip);
    expect([...dateien.keys()].sort()).toEqual(['LIESMICH.txt', 'abwesenheiten.csv', 'monate.csv', 'pruefsummen.txt', 'zeiten.csv']);
    const monate = utf8.decode(dateien.get('monate.csv')!);
    expect(monate).toContain(`"${personalnummer}"`);
    expect(monate).toContain(';"offen";9360;"156,00";');
    expect(utf8.decode(dateien.get('abwesenheiten.csv')!)).toContain('"fortbildung";"Fortbildung"');
    const liesmich = utf8.decode(dateien.get('LIESMICH.txt')!);
    expect(liesmich).toContain('PLATZHALTER');
    expect(liesmich).toContain('(O-27)');
    expect(liesmich).toContain('(D-06)');
    for (const zeile of utf8.decode(dateien.get('pruefsummen.txt')!).trim().split('\n')) {
      const [hash, pfad] = zeile.split('  ');
      expect(sha256(dateien.get(pfad!)!), pfad).toBe(hash);
    }
  });

  it('die Beschaeftigung der anderen Gesellschaft steht nicht darin — dieselbe Person, zwei Anstellungen (D-09)', async () => {
    const { monat } = await monatVon(f.fatimaReinigung);
    const [pn] = await sql.unsafe<{ reinigung: string; security: string }[]>(
      `select (select personalnummer from anstellung where id = $1) as reinigung,
              (select personalnummer from anstellung where id = $2) as security`,
      [f.fatimaReinigung, f.fatimaSecurity]);
    const reinigung = await alsApp(sitzung(), (tx) => erstelleLohnexport(kontextAus(tx), monat));
    expect(reinigung.zeilen.some((z) => z.anstellungId === f.fatimaReinigung)).toBe(true);
    expect(reinigung.zeilen.some((z) => z.anstellungId === f.fatimaSecurity)).toBe(false);
    const monate = utf8.decode(entraege(reinigung.zip).get('monate.csv')!);
    expect(monate).toContain(`"${pn!.reinigung}"`);
    if (pn!.security !== pn!.reinigung) expect(monate).not.toContain(`"${pn!.security}"`);

    const security = await alsApp(sitzung(f.security), (tx) => erstelleLohnexport(kontextAus(tx, f.security), monat));
    expect(security.zeilen.some((z) => z.anstellungId === f.fatimaSecurity)).toBe(true);
    expect(security.zeilen.some((z) => z.anstellungId === f.jonasReinigung)).toBe(false);
    expect(security.firma).not.toBe(reinigung.firma);
  });
});
