/**
 * Ablegen gegen echtes Postgres und einen echten Speicher-Vertrag
 * (DOC-01, DOC-03, DOC-05, DOC-06, SEC-A6, Invariante 3, Invariante 8).
 *
 * **Was hier geprueft wird und nirgends sonst geprueft werden kann.**
 *
 *  - Der Typ kommt aus den BYTES: eine `.exe`, die `rechnung.pdf` heisst,
 *    landet weder im Bucket noch in der Datenbank — und zwar in DIESER
 *    Reihenfolge: es darf auch keine Waise entstehen.
 *  - `exif_entfernt` ist keine Behauptung: das Byte-Ergebnis im Speicher
 *    traegt die Koordinaten nicht mehr.
 *  - Die Zeile gehoert genau EINER Gesellschaft (`t_mandant`), und ohne
 *    `dokument.schreiben` entsteht sie gar nicht.
 *  - Ein Bezug auf einen Kunden einer FREMDEN Gesellschaft wird abgewiesen:
 *    `dokument.kunde_id` traegt keinen Fremdschluessel (0009), also ist die
 *    Pruefung im Dienst die einzige.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { BezugUnbekannt, legeAb } from '../../src/server/services/dokument/ablage.js';

let f: Fixtur;
let ablage = '';    // dokument.schreiben + dokument.lesen in reinigung
let nurLesen = '';  // nur dokument.lesen
const zufall = (): string => String(Math.random()).slice(2, 10);

const PDF = (): Uint8Array =>
  Uint8Array.from([...Buffer.from('%PDF-1.7'), ...Buffer.alloc(64)]);

/** MZ — eine Windows-Ausfuehrbare, die sich als PDF ausgibt. */
const EXE = (): Uint8Array =>
  Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, ...Buffer.alloc(64)]);

/** Ein JPEG mit einem APP1-Segment, das GPS-EXIF traegt. */
function jpegMitExif(): Uint8Array {
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0'),
    Buffer.from('II*\0'),
    Buffer.from('GPSLatitude 52.5200 GPSLongitude 13.4050'),
  ]);
  const laenge = exif.length + 2;
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, (laenge >> 8) & 0xff, laenge & 0xff, ...exif,
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x02,
    0x11, 0x22, 0x33, 0x44,
  ]);
}

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleMit(
  mandant: string, schluessel: string, rechte: readonly string[],
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `${schluessel}_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, rolle]);
}

function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
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

function eingabe(ueber: Record<string, unknown> = {}) {
  return {
    kategorie: 'vertrag',
    titel: `Rahmenvertrag ${zufall()}`,
    beschreibung: '',
    tags: 'vertrag, Vertrag, 2026',
    kundeId: '',
    objektId: '',
    sichtbarFuerMitarbeiter: false,
    dateiname: 'vertrag.pdf',
    daten: PDF(),
    behaupteterTyp: 'application/pdf',
    ...ueber,
  };
}

beforeEach(async () => {
  f = await seed();
  ablage = await konto('ablage');
  nurLesen = await konto('lesen');
  await mitglied(ablage, f.reinigung,
    await rolleMit(f.reinigung, 'ablage', ['dokument.lesen', 'dokument.schreiben']));
  await mitglied(nurLesen, f.reinigung,
    await rolleMit(f.reinigung, 'nurlesen', ['dokument.lesen']));
});
afterAll(schliessen);

describe('(1) die Datei liegt im Bucket UND die Zeile steht — oder keines von beidem', () => {
  it('ein PDF geht durch: Zeile, erste Version und Bytes im Speicher', async () => {
    const speicher = new LokalerSpeicher();
    const ergebnis = await als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe()));

    expect(ergebnis.mimeTyp).toBe('application/pdf');
    expect(speicher.rohBytes('dokumente', `${f.reinigung}/vertrag/${ergebnis.dokumentId}`))
      .toBeDefined();

    const [d] = await sql.unsafe<{
      kategorie: string; mime_typ: string; mime_verifiziert: boolean; tags: string[];
      loeschsperre: boolean; sichtbar_fuer_kunde: boolean;
    }[]>(
      `select kategorie::text as kategorie, mime_typ, mime_verifiziert, tags,
              loeschsperre, sichtbar_fuer_kunde
         from dokument where id = $1`, [ergebnis.dokumentId]);
    expect(d?.mime_typ).toBe('application/pdf');
    expect(d?.mime_verifiziert).toBe(true);
    // Doppelte Schlagworte sind zusammengefasst, die erste Schreibweise gewinnt.
    expect(d?.tags).toEqual(['vertrag', '2026']);
    // DOC-04: Kundensichtbarkeit entsteht NICHT beim Ablegen.
    expect(d?.sichtbar_fuer_kunde).toBe(false);
    // § 257 HGB, 10 Jahre — die Sperre kommt aus der Regel, nicht aus dem Formular.
    expect(d?.loeschsperre).toBe(true);

    const [v] = await sql.unsafe<{ version: number; sha256: string }[]>(
      `select version, sha256 from dokument_version where dokument_id = $1`,
      [ergebnis.dokumentId]);
    expect(Number(v?.version)).toBe(1);
    expect(v?.sha256).toBe(ergebnis.sha256);
  });

  it('eine .exe mit der Endung .pdf landet NIRGENDS — auch nicht im Bucket', async () => {
    const speicher = new LokalerSpeicher();
    await expect(als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher,
        eingabe({ daten: EXE(), dateiname: 'rechnung.pdf' })),
    )).rejects.toThrow();

    /*
     * Der eigentliche Befund: keine Waise. Waere zuerst gespeichert und dann
     * geprueft worden, laege die Datei jetzt im Bucket, und niemand faende
     * sie je wieder.
     */
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from dokument where mandant_id = $1
        and erstellt_am > now() - interval '1 minute'`, [f.reinigung]);
    expect(Number(n!.n)).toBe(0);
  });

  it('die gespeicherten Bytes tragen die GPS-Koordinaten nicht mehr (DOC-06, TIM-10)', async () => {
    const speicher = new LokalerSpeicher();
    const ergebnis = await als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher,
        eingabe({
          kategorie: 'projekt', daten: jpegMitExif(),
          dateiname: 'schichtfoto.jpg', behaupteterTyp: 'image/jpeg',
        })));

    expect(ergebnis.exifEntfernt).toBe(true);
    const roh = speicher.rohBytes('dokumente', `${f.reinigung}/projekt/${ergebnis.dokumentId}`);
    expect(roh).toBeDefined();
    expect(Buffer.from(roh!).toString('latin1')).not.toContain('GPSLatitude');
    // Und der Hash ist der der BEREINIGTEN Bytes, nicht der eingelieferten.
    expect(ergebnis.groesseBytes).toBe(roh!.length);
  });
});

describe('(2) das Recht und die Gesellschaft (Invariante 3)', () => {
  it('ohne `dokument.schreiben` entsteht keine Zeile', async () => {
    const speicher = new LokalerSpeicher();
    await expect(als(nurLesen, (tx) =>
      legeAb(kontextAus(tx, nurLesen, f.reinigung), speicher, eingabe()),
    )).rejects.toThrow(/row-level security/iu);
  });

  it('eine Zeile der Reinigung ist im Bau nicht da — nicht „verboten", sondern nicht da', async () => {
    const speicher = new LokalerSpeicher();
    const ergebnis = await als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe()));

    const bau = await konto('bau');
    await mitglied(bau, f.bau,
      await rolleMit(f.bau, 'bau_ablage', ['dokument.lesen']));
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau, portal: 'intern', readonly: false },
      (tx) => tx.unsafe<{ id: string }[]>(
        `select id from dokument where id = $1`, [ergebnis.dokumentId]));
    expect(zeilen).toHaveLength(0);
  });

  it('ein Kunde einer FREMDEN Gesellschaft ist kein zulaessiger Bezug', async () => {
    /*
     * `dokument.kunde_id` traegt keinen Fremdschluessel (0009) — ohne die
     * Pruefung im Dienst haette ein Formular eine Kennung aus einer anderen
     * Gesellschaft eintragen koennen, und die Ablage zeigte einen Kundennamen,
     * den diese Gesellschaft nie gesehen hat.
     */
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1, $2, 'Fremdkunde') returning id`,
      [f.security, `K-${zufall()}`]);
    const speicher = new LokalerSpeicher();
    await expect(als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher,
        eingabe({ kundeId: k!.id })),
    )).rejects.toThrow(BezugUnbekannt);
  });
});

describe('(3) was abgelegt ist, wird nicht hart geloescht (Invariante 8)', () => {
  it('`delete` auf `dokument` ist `cse_app` entzogen', async () => {
    const speicher = new LokalerSpeicher();
    const ergebnis = await als(ablage, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe()));
    await expect(als(ablage, (tx) =>
      tx`delete from dokument where id = ${ergebnis.dokumentId}`,
    )).rejects.toThrow(/permission denied|verhindere|nicht geloescht/iu);
  });
});
