/**
 * PR 64 — das GoBD-Archiv gegen eine echte Datenbank (ACC-06, DOC-07,
 * DOC-08, LEG-01, D-483).
 *
 *  1. Ein archivierter Finanzbeleg ist NICHT loeschbar: nicht aus der
 *     Anwendung (der eine Loeschweg weist ab, und das Objekt bleibt liegen),
 *     nicht per SQL als `cse_app`, nicht als `cse_job`, nicht als
 *     Eigentuemer — und TRUNCATE auch nicht.
 *  2. Die Frist beginnt mit dem Schluss des Kalenderjahrs, in dem das
 *     Dokument ENTSTAND (§ 147 Abs. 4 AO) — nicht mit dem Tag der Ablage.
 *     Zehn Jahre fuer jede Finanzkategorie; der Entstehungstag ist
 *     unveraenderlich, die Frist wird nie kuerzer.
 *  3. Regeln je Gesellschaft: setzbar unter dem Recht, nie unter der
 *     gesetzlichen Untergrenze — im Dienst UND im Ausloeser; die
 *     Plattformzeilen bleiben unberuehrt; die Grenze der Gesellschaft ist
 *     die Grenze der Regel.
 *  4. Das Pruefbuendel eines Jahrgangs enthaelt jede Rechnung, ihr PDF und
 *     ihre Buchungszeilen, stimmt mit dem Ausgangsbuch ueberein, ist
 *     reproduzierbar — und entsteht nicht, solange eine Zeile ohne Beleg ist
 *     oder eine Datei nicht mehr ihren Hash hat.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, SupabaseSpeicher } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import { archiviereRechnungsbeleg } from '../../src/server/services/buchhaltung/belegarchiv.js';
import {
  PruefbuendelFehler, erstellePruefbuendel, packePruefbuendel,
} from '../../src/server/services/buchhaltung/pruefbuendel.js';
import { leseZipEintrag, leseZipVerzeichnis } from '../../src/server/services/archiv/zip.js';
import {
  AufbewahrungFehler, liesAufbewahrung, setzeAufbewahrung,
} from '../../src/server/services/dokument/aufbewahrung.js';
import { LoeschungFehler, loescheDokument } from '../../src/server/services/dokument/loeschung.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

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

/** Eine festgeschriebene 19-%-Rechnung mit Erloesschluessel. */
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

/** Archiviert in DIESEM Speicher — derselbe, der spaeter packt. */
async function archiviert(speicher: LokalerSpeicher, preisCent = 100_000n) {
  const rechnung = await festgeschrieben(preisCent);
  const e = await alsApp(sitzung(), (tx) => archiviereRechnungsbeleg(kontextAus(tx), speicher, rechnung));
  const [d] = await sql.unsafe<{ bucket: string; schluessel: string; entstanden: string; bis: string | null }[]>(
    `select bucket, objekt_schluessel as schluessel, entstanden_am::text as entstanden,
            aufbewahrung_bis::text as bis
       from dokument where id = $1`, [e.dokumentId]);
  return { rechnung, dokumentId: e.dokumentId!, belegId: e.belegId!, sha256: e.sha256!, ort: d! };
}

async function heuteJahr(): Promise<number> {
  const [z] = await sql.unsafe<{ jahr: number }[]>(`select extract(year from app.berlin_heute())::int as jahr`);
  return z!.jahr;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`archiv-${zufall()}@cse.test`);
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

describe('(1) Loeschen ist unmoeglich — auf jeder Ebene', () => {
  it('der eine Loeschweg weist ab, und das Objekt bleibt im Speicher', async () => {
    const speicher = new LokalerSpeicher();
    const a = await archiviert(speicher);
    await expect(alsApp(sitzung(), (tx) =>
      loescheDokument(kontextAus(tx), speicher, { dokumentId: a.dokumentId, grund: 'Aufraeumen nach Test' })))
      .rejects.toSatisfy((e: unknown) => e instanceof LoeschungFehler && e.grund === 'gesperrt');
    expect(speicher.rohBytes(a.ort.bucket as 'archiv', a.ort.schluessel)).toBeDefined();
    const [z] = await sql.unsafe<{ geloescht: string | null }[]>(
      `select geloescht_am::text as geloescht from dokument where id = $1`, [a.dokumentId]);
    expect(z?.geloescht).toBeNull();
  });

  it('SQL als cse_app: kein DELETE-Recht', async () => {
    const a = await archiviert(new LokalerSpeicher());
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(`delete from dokument where id = $1`, [a.dokumentId] as never[])))
      .rejects.toThrow(/permission denied/u);
  });

  it('SQL als cse_job: auch der naechtliche Lauf loescht nichts', async () => {
    const a = await archiviert(new LokalerSpeicher());
    await expect(alsRolle('cse_job', (tx) => tx.unsafe(`delete from dokument where id = $1`, [a.dokumentId] as never[])))
      .rejects.toThrow(/permission denied/u);
  });

  it('SQL als Eigentuemer: der Ausloeser weist ab — Zeile, Version, Beleg, und TRUNCATE', async () => {
    const a = await archiviert(new LokalerSpeicher());
    await expect(sql.unsafe(`delete from dokument where id = $1`, [a.dokumentId])).rejects.toThrow(/gesperrt/u);
    await expect(sql.unsafe(`delete from dokument_version where dokument_id = $1`, [a.dokumentId])).rejects.toThrow(/gesperrt/u);
    await expect(sql.unsafe(`delete from beleg where id = $1`, [a.belegId])).rejects.toThrow(/gesperrt/u);
    // TRUNCATE: Postgres weist zuerst wegen der Fremdschluessel ab, dahinter steht
    // der Statement-Ausloeser (unveraenderbarkeit.test §1 prueft ihn ohne FK).
    await expect(sql.unsafe(`truncate dokument`)).rejects.toThrow(/gesperrt|cannot truncate/u);
    const [n] = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from dokument where id = $1`, [a.dokumentId]);
    expect(n?.n).toBe('1');
  });

  it('das weiche Loeschen per SQL scheitert ebenso — Loeschsperre und Buchungsbezug', async () => {
    const a = await archiviert(new LokalerSpeicher());
    await expect(sql.unsafe(
      `update dokument set geloescht_am = now(), loeschgrund = 'Test' where id = $1`, [a.dokumentId]))
      .rejects.toThrow(/Aufbewahrungspflicht|beruft sich/u);
  });
});

describe('(2) der Beginn der Frist: das Kalenderjahr des Entstehens', () => {
  async function dokument(kategorie: string, entstanden: string | null): Promise<{ bis: string | null; entstanden: string; sperre: boolean }> {
    const id = crypto.randomUUID();
    await sql.unsafe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                             groesse_bytes, bucket, objekt_schluessel, exif_entfernt, entstanden_am)
       values ($1, $2, $3::dokument_kategorie, 'Fristprobe', 'application/pdf', true, 100,
               'dokumente', $4, true, $5::date)`,
      [id, f.reinigung, kategorie, `${f.reinigung}/${kategorie}/${id}`, entstanden]);
    const [z] = await sql.unsafe<{ bis: string | null; entstanden: string; sperre: boolean }[]>(
      `select aufbewahrung_bis::text as bis, entstanden_am::text as entstanden, loeschsperre as sperre
         from dokument where id = $1`, [id]);
    return z!;
  }

  it('ein Dezemberbeleg, im Folgejahr abgelegt, rechnet ab dem Dezember-Jahr', async () => {
    const z = await dokument('beleg', '2025-12-15');
    expect(z.entstanden).toBe('2025-12-15');
    expect(z.bis).toBe('2035-12-31');
    expect(z.sperre).toBe(true);
  });

  it('ohne Entstehungstag gilt der Berliner Tag der Ablage', async () => {
    const jahr = await heuteJahr();
    const z = await dokument('rechnung', null);
    expect(z.entstanden.slice(0, 4)).toBe(String(jahr));
    expect(z.bis).toBe(`${String(jahr + 10)}-12-31`);
  });

  it('jede Finanzkategorie: zehn Jahre, gesperrt', async () => {
    for (const k of ['rechnung', 'buchhaltung', 'beleg']) {
      const z = await dokument(k, '2026-03-03');
      expect(z.bis, k).toBe('2036-12-31');
      expect(z.sperre, k).toBe(true);
    }
  });

  it('das archivierte Rechnungs-PDF traegt das Rechnungsdatum als Entstehungstag', async () => {
    const a = await archiviert(new LokalerSpeicher());
    const [r] = await sql.unsafe<{ datum: string }[]>(
      `select rechnungsdatum::text as datum from rechnung where id = $1`, [a.rechnung]);
    expect(a.ort.entstanden).toBe(r!.datum);
    expect(a.ort.bis).toBe(`${String(Number(r!.datum.slice(0, 4)) + 10)}-12-31`);
  });

  it('der Entstehungstag ist eine Tatsache, die Frist wird nie kuerzer', async () => {
    const a = await archiviert(new LokalerSpeicher());
    await expect(sql.unsafe(`update dokument set entstanden_am = '2020-01-01' where id = $1`, [a.dokumentId]))
      .rejects.toThrow(/Entstehungstag/u);
    await expect(sql.unsafe(`update dokument set aufbewahrung_bis = '2027-12-31' where id = $1`, [a.dokumentId]))
      .rejects.toThrow(/verkuerzt/u);
    await expect(sql.unsafe(`update dokument set aufbewahrung_bis = null where id = $1`, [a.dokumentId]))
      .rejects.toThrow(/verkuerzt/u);
    // Laenger geht — eine Gesellschaft darf mehr aufbewahren.
    await sql.unsafe(`update dokument set aufbewahrung_bis = '2099-12-31' where id = $1`, [a.dokumentId]);
  });
});

describe('(3) Regeln je Gesellschaft — mit gesetzlicher Untergrenze', () => {
  const setze = (e: { kategorie: string; jahre: number | null; loeschsperre?: boolean; grundlage?: string }, mandantId?: string) =>
    alsApp(sitzung(mandantId), (tx) => setzeAufbewahrung(kontextAus(tx, mandantId), {
      kategorie: e.kategorie, jahre: e.jahre, loeschsperre: e.loeschsperre ?? true,
      grundlage: e.grundlage ?? 'Beschluss der Geschäftsführung vom 01.09.2026',
    }));

  it('unter der Untergrenze: der Dienst sagt es, und der Ausloeser haelt es auch ohne Dienst', async () => {
    await expect(setze({ kategorie: 'rechnung', jahre: 9 }))
      .rejects.toSatisfy((e: unknown) => e instanceof AufbewahrungFehler && e.grund === 'untergrenze');
    await expect(setze({ kategorie: 'angebot', jahre: 5 }))
      .rejects.toSatisfy((e: unknown) => e instanceof AufbewahrungFehler && e.grund === 'untergrenze');
    await expect(sql.unsafe(
      `insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre, grundlage, ist_platzhalter)
       values ($1, 'beleg', 9, true, 'Test', false)`, [f.reinigung]))
      .rejects.toThrow(/Mindestfrist/u);
    await expect(sql.unsafe(
      `insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre, grundlage, ist_platzhalter)
       values ($1, 'rechnung', 12, false, 'Test', false)`, [f.reinigung]))
      .rejects.toThrow(/Loeschsperre/u);
  });

  it('laenger geht: die Regel der Gesellschaft gilt fuer neue Dokumente — mit Spur', async () => {
    const z = await setze({ kategorie: 'rechnung', jahre: 12 });
    expect(z.quelle).toBe('gesellschaft');
    expect(z.jahre).toBe(12);
    expect(z.istPlatzhalter).toBe(false);
    const regeln = await alsApp(sitzung(), (tx) => liesAufbewahrung(kontextAus(tx)));
    expect(regeln.find((r) => r.kategorie === 'rechnung')?.jahre).toBe(12);
    expect(regeln.find((r) => r.kategorie === 'beleg')?.quelle).toBe('plattform');

    const id = crypto.randomUUID();
    await sql.unsafe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ, mime_verifiziert,
                             groesse_bytes, bucket, objekt_schluessel, exif_entfernt, entstanden_am)
       values ($1, $2, 'rechnung', 'Zwoelf Jahre', 'application/pdf', true, 100, 'dokumente', $3, true, '2026-02-02')`,
      [id, f.reinigung, `${f.reinigung}/rechnung/${id}`]);
    const [d] = await sql.unsafe<{ bis: string }[]>(`select aufbewahrung_bis::text as bis from dokument where id = $1`, [id]);
    expect(d?.bis).toBe('2038-12-31');

    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'dokument.aufbewahrung_gesetzt' and objekt_id = 'rechnung' and mandant_id = $1`, [f.reinigung]);
    expect(spur?.n).toBe('1');

    // Noch einmal setzen aendert die Zeile, legt keine zweite an.
    await setze({ kategorie: 'rechnung', jahre: 15 });
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument_aufbewahrung where mandant_id = $1 and kategorie = 'rechnung'`, [f.reinigung]);
    expect(n?.n).toBe('1');
  });

  it('eine offene Frist bleibt gesperrt; die Plattformzeile bleibt unberuehrt; die Nachbarin sieht nichts', async () => {
    const z = await setze({ kategorie: 'mitarbeiter', jahre: null, loeschsperre: false });
    expect(z.loeschsperre).toBe(true);

    const geaendert = await alsApp(sitzung(), (tx) =>
      tx.unsafe(`update dokument_aufbewahrung set jahre = 11 where mandant_id is null and kategorie = 'beleg'`));
    expect(geaendert.count).toBe(0);
    const [p] = await sql.unsafe<{ jahre: number }[]>(
      `select jahre from dokument_aufbewahrung where mandant_id is null and kategorie = 'beleg'`);
    expect(p?.jahre).toBe(10);

    await setze({ kategorie: 'kunde', jahre: 8 });
    const nachbarin = await alsApp(sitzung(f.security), (tx) => liesAufbewahrung(kontextAus(tx, f.security)));
    expect(nachbarin.find((r) => r.kategorie === 'kunde')).toMatchObject({ jahre: 6, quelle: 'plattform' });
  });
});

describe('(4) das Pruefbuendel eines Jahrgangs', () => {
  it('enthaelt jede Rechnung, ihr PDF und ihre Buchungszeilen — reproduzierbar, gegen das Ausgangsbuch', async () => {
    const speicher = new LokalerSpeicher();
    const a = await archiviert(speicher, 100_000n);
    const b = await archiviert(speicher, 250_000n);
    const jahr = await heuteJahr();

    const eins = await alsApp(sitzung(), (tx) => erstellePruefbuendel(kontextAus(tx), jahr));
    expect(eins.bezeichnung).toBe(String(jahr));
    expect(eins.rechnungen.map((r) => r.rechnungId).sort()).toEqual([a.rechnung, b.rechnung].sort());
    expect(eins.ohneBeleg).toBe(0);
    expect(eins.ohneBuchung).toBe(0);
    expect(eins.rechnungen.every((r) => r.buchungszeilen > 0)).toBe(true);
    expect(eins.sperre).toBeNull();
    expect(eins.paket?.dateien.map((d) => d.sha256).sort()).toEqual([a.sha256, b.sha256].sort());
    expect(eins.ausgangsbuch.ok).toBe(true);
    expect(eins.ausgangsbuch.kreise[0]?.anzahl).toBe(2);
    // Das Manifest ist kanonisches JSON mit Hash — und ohne Uhr.
    const manifest = JSON.parse(new TextDecoder().decode(eins.manifest)) as Record<string, unknown>;
    expect(manifest['art']).toBe('cse-pruefbuendel');
    expect(manifest['hinweis']).toMatch(/keine Berechnung von Steuern oder Löhnen/u);
    expect((manifest['dateien'] as unknown[]).length).toBe(2);

    const zwei = await alsApp(sitzung(), (tx) => erstellePruefbuendel(kontextAus(tx), jahr));
    expect(zwei.manifestSha256).toBe(eins.manifestSha256);

    const zip1 = await packePruefbuendel(eins, speicher);
    const zip2 = await packePruefbuendel(zwei, speicher);
    expect(Buffer.from(zip1).equals(Buffer.from(zip2))).toBe(true);
    const verzeichnis = leseZipVerzeichnis(zip1);
    expect(verzeichnis.map((e) => e.pfad).filter((p) => p.startsWith('belege/')).length).toBe(2);
    expect(verzeichnis.some((e) => e.pfad === 'manifest.json')).toBe(true);
    for (const d of eins.paket!.dateien) {
      const eintrag = verzeichnis.find((e) => e.pfad === d.pfad);
      expect(eintrag, d.pfad).toBeDefined();
      expect(sha256(leseZipEintrag(zip1, eintrag!))).toBe(d.sha256);
    }
    expect(sha256(leseZipEintrag(zip1, verzeichnis.find((e) => e.pfad === 'manifest.json')!))).toBe(eins.manifestSha256);
  });

  it('eine Rechnung ohne Beleg sperrt das Buendel — das Manifest sagt es, das ZIP entsteht nicht', async () => {
    const speicher = new LokalerSpeicher();
    await archiviert(speicher);
    const ohne = await festgeschrieben(50_000n);   // festgeschrieben, aber nicht archiviert
    const jahr = await heuteJahr();
    const b = await alsApp(sitzung(), (tx) => erstellePruefbuendel(kontextAus(tx), jahr));
    expect(b.rechnungen.find((r) => r.rechnungId === ohne)?.belegId).toBeNull();
    expect(b.ohneBeleg).toBe(1);
    expect(b.sperre?.offen).toBeGreaterThan(0);
    expect(b.paket).toBeNull();
    await expect(packePruefbuendel(b, speicher))
      .rejects.toSatisfy((e: unknown) => e instanceof PruefbuendelFehler && e.grund === 'gesperrt');
  });

  it('ohne verbundenen Speicher: Manifest ja, ZIP nein', async () => {
    const speicher = new LokalerSpeicher();
    await archiviert(speicher);
    const jahr = await heuteJahr();
    const b = await alsApp(sitzung(), (tx) => erstellePruefbuendel(kontextAus(tx), jahr));
    expect(b.manifest.length).toBeGreaterThan(100);
    await expect(packePruefbuendel(b, new SupabaseSpeicher('', '')))
      .rejects.toSatisfy((e: unknown) => e instanceof PruefbuendelFehler && e.grund === 'nicht_verbunden');
  });

  it('eine Datei, die nicht mehr ihren Hash traegt, wird nicht gepackt', async () => {
    const speicher = new LokalerSpeicher();
    const a = await archiviert(speicher);
    await speicher.lege(a.ort.bucket as 'archiv', a.ort.schluessel, new TextEncoder().encode('%PDF-1.4 manipuliert'));
    const jahr = await heuteJahr();
    const b = await alsApp(sitzung(), (tx) => erstellePruefbuendel(kontextAus(tx), jahr));
    await expect(packePruefbuendel(b, speicher))
      .rejects.toSatisfy((e: unknown) => e instanceof PruefbuendelFehler && e.grund === 'integritaet');
  });

  it('von der Security aus ist der Jahrgang der Reinigung leer (Invariante 3)', async () => {
    await archiviert(new LokalerSpeicher());
    const jahr = await heuteJahr();
    const b = await alsApp(sitzung(f.security), (tx) => erstellePruefbuendel(kontextAus(tx, f.security), jahr));
    expect(b.rechnungen).toEqual([]);
  });
});
