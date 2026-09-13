/**
 * PR 59 — die Belegverknuepfung gegen eine echte Datenbank (ACC-03, DOC-04,
 * § 147 AO).
 *
 * Die vier Saetze der Abnahme aus `08-PR-PLAN.md`:
 *
 *  1. Jede Buchungszeile loest **genau ein Dokument** auf; eine Zeile ohne
 *     eines steht als unvollstaendig und **blockiert den Export**.
 *  2. Das Dokument aus der Zeile ist **byte-identisch** mit dem archivierten
 *     Original, und es wird ueber eine **signierte URL** geoeffnet.
 *  3. Ein Dokument, auf das eine Buchung zeigt, **laesst sich nicht loeschen**.
 *  4. Das Exportpaket paart jede Buchung mit ihrer Datei nach Manifest.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { LokalerSpeicher, SIGNATUR_SEKUNDEN } from '../../src/server/storage/adapter.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  archiviereRechnungsbeleg, offeneArchivierungen, type ArchivKontext,
} from '../../src/server/services/buchhaltung/belegarchiv.js';
import { exportPaket, type PaketZeile }
  from '../../src/server/services/buchhaltung/exportpaket.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage & ArchivKontext {
  const lauf = async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
    (await tx.unsafe(anweisung, werte as never[])) as readonly T[];
  return { aktiverMandantId: f.reinigung, abfrage: lauf, schreibe: lauf };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
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

/**
 * Kontenrahmen und Zuordnung — im Betrieb O-05, hier Vorrichtung.
 *
 * **Ohne sie stuende jede Zeile ohnehin auf der Unvollstaendigkeitsliste**,
 * und zwar wegen des fehlenden Kontos. Der Test wollte dann beweisen, dass
 * der Beleg die Liste leert, und bewiese nur, dass sie voll bleibt.
 */
async function richteKontenEin(mandantId: string, kundeId: string): Promise<void> {
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
  await zuordnung('debitor_kunde', '10001', { kunde: kundeId });
}

/** Eine festgeschriebene 19-%-Rechnung mit Erlösschlüssel. */
async function festgeschrieben(preisCent = 100_000n): Promise<string> {
  const id = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const neu = await legeEntwurfAn(d, {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: neu, bezeichnung: 'Unterhaltsreinigung',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(preisCent), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    await tx.unsafe(`update rechnung set zahlungsmittel_code = '58' where id = $1`,
      [neu] as never[]);
    await tx.unsafe(
      `update rechnungsposition set erloeskonto_schluessel = 'standard'
        where rechnung_id = $1 and netto_cent is not null`, [neu] as never[]);
    return neu;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), id));
  return id;
}

/**
 * Der Zeitraum, in dem die Zeilen dieser Rechnung wirklich liegen.
 *
 * `belegdatum` ist das Rechnungsdatum, und das setzt `finalisiere` aus der
 * Serveruhr (Invariante 5) — nicht aus dem Leistungszeitraum. Ein fest
 * hingeschriebener August haette hier je nach Testtag gepasst oder nicht,
 * und die Exportsperre saehe null Zeilen und liesse durch: ein gruener Test,
 * der nichts prueft.
 */
async function zeitraum(rechnungId: string): Promise<{ von: string; bis: string }> {
  const [z] = await sql.unsafe<{ von: string; bis: string }[]>(
    `select min(belegdatum)::text as von, max(belegdatum)::text as bis
       from buchungssatz where rechnung_id = $1`, [rechnungId]);
  return { von: z!.von, bis: z!.bis };
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`beleg-${zufall()}@cse.test`);
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
// (1) Eine Zeile ohne Dokument steht auf der Liste und sperrt den Export
// ---------------------------------------------------------------------------

describe('(1) ohne Beleg keine Exportdatei', () => {
  it('die frisch gebuchte Zeile steht als unvollstaendig — mit Grund', async () => {
    const id = await festgeschrieben();

    const offen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ grund: string }[]>(
        `select distinct grund from buchungssatz_unvollstaendig where rechnung_id = $1`,
        [id] as never[]));

    expect(offen.length).toBeGreaterThan(0);
    expect(offen.map((z) => z.grund).join(' ')).toMatch(/Beleg fehlt/u);
  });

  it('und die Sperre verweigert den Zeitraum, mit der Zahl im Satz', async () => {
    const id = await festgeschrieben();
    const { von, bis } = await zeitraum(id);

    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `select app.export_sperre_pruefen($1, $2::date, $3::date)`,
      [f.reinigung, von, bis] as never[])))
      .rejects.toThrow(/Buchungszeile\(n\) ohne Beleg oder ohne Konto/u);
  });

  it('nach dem Archivlauf ist der Zeitraum frei', async () => {
    const id = await festgeschrieben();

    const speicher = new LokalerSpeicher();
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    expect(ergebnis.grund).toBe('archiviert');
    expect(ergebnis.zeilen).toBeGreaterThan(0);

    const rest = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from buchungssatz_unvollstaendig
          where rechnung_id = $1`, [id] as never[]));
    expect(rest[0]?.n).toBe('0');

    // Und die Sperre laesst durch — kein Wurf.
    const { von, bis } = await zeitraum(id);
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `select app.export_sperre_pruefen($1, $2::date, $3::date)`,
      [f.reinigung, von, bis] as never[]));
  });

  it('jede Zeile der Rechnung traegt DENSELBEN Beleg — genau einen', async () => {
    const id = await festgeschrieben();
    const speicher = new LokalerSpeicher();
    await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    const zeilen = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ beleg_id: string | null }[]>(
        `select beleg_id from buchungssatz where rechnung_id = $1`, [id] as never[]));

    expect(zeilen.length).toBeGreaterThan(1);
    expect(new Set(zeilen.map((z) => z.beleg_id)).size).toBe(1);
    expect(zeilen[0]?.beleg_id).not.toBeNull();
  });

  it('ein zweiter Lauf legt nichts zweites ab', async () => {
    const id = await festgeschrieben();
    const speicher = new LokalerSpeicher();
    const erst = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));
    const zweit = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    expect(zweit.grund).toBe('schon_archiviert');
    expect(zweit.belegId).toBe(erst.belegId);

    const [anzahl] = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from beleg where belegnummer is not null`));
    expect(anzahl?.n).toBe('1');
  });

  it('eine Rechnung im Entwurf wird nicht archiviert', async () => {
    const entwurf = await alsApp(sitzung(), async (tx) => legeEntwurfAn(alsDienst(tx), {
      kundeId, leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    }));
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), new LokalerSpeicher(), entwurf));
    expect(ergebnis.grund).toBe('nicht_festgeschrieben');
  });
});

// ---------------------------------------------------------------------------
// (2) Das archivierte Dokument, byte-identisch und nur signiert erreichbar
// ---------------------------------------------------------------------------

describe('(2) das Dokument aus der Zeile', () => {
  it('die abgelegten Bytes sind das PDF, und ihr SHA-256 steht am Beleg', async () => {
    const id = await festgeschrieben();
    const speicher = new LokalerSpeicher();
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    const [ort] = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ bucket: string; objekt_schluessel: string; datei_sha256: string }[]>(
        `select d.bucket, d.objekt_schluessel, b.datei_sha256
           from buchungssatz bs
           join beleg b on b.id = bs.beleg_id and b.mandant_id = bs.mandant_id
           join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
          where bs.rechnung_id = $1
          limit 1`, [id] as never[]));

    expect(ort?.bucket).toBe('archiv');
    const bytes = await speicher.hole('archiv', ort!.objekt_schluessel);

    // PDF, nicht irgendetwas: die Magic Bytes.
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    // Und byte-identisch zu dem, was der Beleg behauptet.
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ort!.datei_sha256);
    expect(ergebnis.sha256).toBe(ort!.datei_sha256);
  });

  it('erreichbar ist es nur signiert, und die Signatur laeuft ab', async () => {
    const id = await festgeschrieben();
    const speicher = new LokalerSpeicher();
    await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    const [ort] = await alsApp(sitzung(), async (tx) =>
      tx.unsafe<{ objekt_schluessel: string }[]>(
        `select d.objekt_schluessel
           from rechnung r
           join beleg b    on b.id = r.beleg_id    and b.mandant_id = r.mandant_id
           join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
          where r.id = $1`, [id] as never[]));

    const url = await speicher.signierteUrl('archiv', ort!.objekt_schluessel);
    // Kein Pfad ohne Signatur — und die Frist steht an EINER Stelle (DOC-03).
    expect(url).toMatch(/[?&](token|signature|expires|ablauf)=/u);
    expect(SIGNATUR_SEKUNDEN).toBe(15 * 60);
  });
});

// ---------------------------------------------------------------------------
// (3) Der Beleg einer Buchung geht nicht weg
// ---------------------------------------------------------------------------

describe('(3) das Dokument bleibt, solange die Buchung steht', () => {
  async function archiviert(): Promise<{ rechnung: string; dokument: string }> {
    const rechnung = await festgeschrieben();
    const ergebnis = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), new LokalerSpeicher(), rechnung));
    return { rechnung, dokument: ergebnis.dokumentId! };
  }

  it('das weiche Loeschen nennt die Buchungszeile als Grund', async () => {
    const { dokument } = await archiviert();
    await expect(sql.unsafe(
      `update dokument set geloescht_am = now(), geloescht_von = $2,
                           loeschgrund = 'Testlauf'
        where id = $1`, [dokument, benutzer]))
      .rejects.toThrow(/beruft sich darauf/u);
  });

  it('und das harte Loeschen scheitert ohnehin — auch als Eigentuemer', async () => {
    const { dokument } = await archiviert();
    await expect(sql.unsafe(`delete from dokument where id = $1`, [dokument]))
      .rejects.toThrow();
  });

  it('der Beleg selbst laesst sich nicht hart loeschen', async () => {
    const { rechnung } = await archiviert();
    const [b] = await sql.unsafe<{ beleg_id: string }[]>(
      `select beleg_id from rechnung where id = $1`, [rechnung]);
    await expect(sql.unsafe(`delete from beleg where id = $1`, [b!.beleg_id]))
      .rejects.toThrow();
  });

  it('und der Zeiger auf der Rechnung wird nicht ausgetauscht', async () => {
    const { rechnung } = await archiviert();
    const zweite = await festgeschrieben(50_000n);
    const fremd = await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), new LokalerSpeicher(), zweite));

    await expect(sql.unsafe(
      `update rechnung set beleg_id = $2 where id = $1`, [rechnung, fremd.belegId]))
      .rejects.toThrow(/wird nicht ausgetauscht/u);
  });
});

// ---------------------------------------------------------------------------
// (4) Das Exportpaket paart jede Buchung mit ihrer Datei
// ---------------------------------------------------------------------------

describe('(4) das Paket und sein Manifest', () => {
  it('jede Buchungszeile im Zeitraum steht mit ihrer Datei im Manifest', async () => {
    const id = await festgeschrieben();
    const speicher = new LokalerSpeicher();
    await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), speicher, id));

    const { von, bis } = await zeitraum(id);
    const paket = await alsApp(sitzung(), async (tx) =>
      exportPaket(alsDienst(tx), f.reinigung, von, bis));

    expect(paket.zeilen.length).toBeGreaterThan(0);
    for (const z of paket.zeilen as readonly PaketZeile[]) {
      expect(z.dateiPfad).not.toBeNull();
      expect(z.sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    // Ein Manifesteintrag je VERSCHIEDENER Datei, nicht je Zeile.
    expect(paket.dateien.length).toBe(1);
    expect(paket.dateien[0]?.zeilen).toBe(paket.zeilen.length);
  });

  it('und ohne abgelegten Beleg entsteht gar kein Paket', async () => {
    const id = await festgeschrieben();
    const { von, bis } = await zeitraum(id);

    await expect(alsApp(sitzung(), async (tx) =>
      exportPaket(alsDienst(tx), f.reinigung, von, bis)))
      .rejects.toThrow(/ohne Beleg oder ohne Konto/u);
  });
});

// ---------------------------------------------------------------------------
// Die Arbeitsliste des Laufs
// ---------------------------------------------------------------------------

describe('der Archivlauf sieht genau die offenen', () => {
  it('eine festgeschriebene ohne Beleg steht drauf, eine archivierte nicht', async () => {
    const id = await festgeschrieben();
    const vorher = await alsApp(sitzung(), async (tx) =>
      offeneArchivierungen(alsDienst(tx)));
    expect(vorher).toContain(id);

    await alsApp(sitzung(), async (tx) =>
      archiviereRechnungsbeleg(alsDienst(tx), new LokalerSpeicher(), id));

    const nachher = await alsApp(sitzung(), async (tx) =>
      offeneArchivierungen(alsDienst(tx)));
    expect(nachher).not.toContain(id);
  });
});
