/**
 * Die zweite Fassung eines Dokuments — gegen echtes Postgres und einen
 * echten Speicher-Vertrag (DOC-05, DOC-06, V-219, D-713, Invariante 8).
 *
 * **Der Befund.** `dokument_version` war seit 0009 als Kette angelegt, jeder
 * Schreiber setzte `version = 1`, und es gab keinen Weg zu einer zweiten
 * Fassung. Geprüft wird hier, was die Kette ausmacht und was nur gegen
 * Postgres und den Speicher prüfbar ist:
 *
 *  - die neue Fassung ist eine NEUE Zeile mit eigenem Objekt; die alte bleibt
 *    Zeile UND Datei (nichts überschrieben, nichts gelöscht);
 *  - das Dokument zeigt danach auf die neueste (Schlüssel, Typ, Größe);
 *  - die Datei geht durch dieselbe Prüfkette wie beim Ablegen;
 *  - Rechnung, Beleg und Buchhaltung bekommen keine — im Dienst UND in der
 *    Datenbank (`kern.dokument_fassung_pruefen`, 0470);
 *  - die Kette ist lückenlos, auch an der Route vorbei.
 */
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import {
  FassungFehler, fassungSchluessel, ladeFassungen, legeAb, legeFassungAn,
} from '../../src/server/services/dokument/ablage.js';

let f: Fixtur;
let ablage = '';    // dokument.schreiben + dokument.lesen in reinigung
let nurLesen = '';  // nur dokument.lesen
const zufall = (): string => String(Math.random()).slice(2, 10);

const PDF = (inhalt = ''): Uint8Array =>
  Uint8Array.from([...Buffer.from('%PDF-1.7'), ...Buffer.from(inhalt), ...Buffer.alloc(64)]);

/** Ein JPEG mit einem APP1-Segment, das GPS-EXIF trägt. */
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

/** Ein Vertrag, abgelegt über den ECHTEN Weg — mit erster Fassung in der Kette. */
async function vertrag(speicher: LokalerSpeicher, kategorie = 'vertrag'): Promise<string> {
  const e = await als(ablage, (tx) => legeAb(kontextAus(tx, ablage, f.reinigung), speicher, {
    kategorie, titel: `Rahmenvertrag ${zufall()}`, beschreibung: '', tags: '',
    kundeId: '', objektId: '', sichtbarFuerMitarbeiter: false,
    dateiname: 'vertrag.pdf', daten: PDF('fassung-1'), behaupteterTyp: 'application/pdf',
  }));
  return e.dokumentId;
}

function neueFassung(
  speicher: LokalerSpeicher, dokumentId: string, daten: Uint8Array,
  wer = ablage, typ = 'application/pdf',
) {
  return als(wer, (tx) => legeFassungAn(kontextAus(tx, wer, f.reinigung), speicher, dokumentId, {
    dateiname: 'neu.pdf', daten, behaupteterTyp: typ,
  }));
}

beforeEach(async () => {
  f = await seed();
  ablage = await konto('fassung');
  nurLesen = await konto('lesen');
  await mitglied(ablage, f.reinigung,
    await rolleMit(f.reinigung, 'ablage', ['dokument.lesen', 'dokument.schreiben']));
  await mitglied(nurLesen, f.reinigung,
    await rolleMit(f.reinigung, 'leser', ['dokument.lesen']));
});
afterAll(schliessen);

describe('(1) die Kette wächst, und nichts wird überschrieben', () => {
  it('Fassung 2 ist eine neue Zeile mit eigenem Objekt — Fassung 1 bleibt Zeile und Datei', async () => {
    const speicher = new LokalerSpeicher();
    const id = await vertrag(speicher);
    const [v1] = await sql.unsafe<{ objekt_schluessel: string; sha256: string }[]>(
      `select objekt_schluessel, sha256 from dokument_version where dokument_id = $1`, [id]);

    const neu = PDF('fassung-2 mit Nachtrag');
    const e = await neueFassung(speicher, id, neu);
    expect(e.version).toBe(2);
    expect(e.sha256).toBe(createHash('sha256').update(neu).digest('hex'));

    const kette = await sql.unsafe<{ version: number; objekt_schluessel: string; sha256: string }[]>(
      `select version, objekt_schluessel, sha256 from dokument_version
        where dokument_id = $1 order by version`, [id]);
    expect(kette.map((k) => k.version)).toEqual([1, 2]);
    expect(kette[0]).toMatchObject({ objekt_schluessel: v1!.objekt_schluessel, sha256: v1!.sha256 });
    expect(kette[1]!.objekt_schluessel).toBe(fassungSchluessel(f.reinigung, 'vertrag', id, 2));
    expect(kette[1]!.objekt_schluessel).not.toBe(v1!.objekt_schluessel);

    /* Beide Dateien liegen im Speicher — die alte unverändert. */
    const alt = speicher.rohBytes('dokumente', v1!.objekt_schluessel);
    expect(alt).toBeDefined();
    expect(createHash('sha256').update(alt!).digest('hex')).toBe(v1!.sha256);
    expect(speicher.rohBytes('dokumente', kette[1]!.objekt_schluessel)).toBeDefined();

    /* Das Dokument zeigt auf die neueste. */
    const [d] = await sql.unsafe<{ objekt_schluessel: string; groesse_bytes: string }[]>(
      `select objekt_schluessel, groesse_bytes::text from dokument where id = $1`, [id]);
    expect(d!.objekt_schluessel).toBe(kette[1]!.objekt_schluessel);
    expect(Number(d!.groesse_bytes)).toBe(neu.length);

    /* Und die dritte folgt der zweiten. */
    expect((await neueFassung(speicher, id, PDF('fassung-3'))).version).toBe(3);
    const liste = await als(nurLesen, (tx) =>
      ladeFassungen(kontextAus(tx, nurLesen, f.reinigung), id));
    expect(liste.map((z) => z.version)).toEqual([3, 2, 1]);
    expect(liste[0]!.tag).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('die Fassung geht durch die Prüfkette: EXIF entfernt, Typ aus dem Inhalt', async () => {
    const speicher = new LokalerSpeicher();
    const id = await vertrag(speicher);
    const e = await neueFassung(speicher, id, jpegMitExif(), ablage, 'image/jpeg');
    expect(e.mimeTyp).toBe('image/jpeg');
    const [v] = await sql.unsafe<{ objekt_schluessel: string }[]>(
      `select objekt_schluessel from dokument_version where dokument_id = $1 and version = 2`,
      [id]);
    const bytes = speicher.rohBytes('dokumente', v!.objekt_schluessel)!;
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('GPSLatitude');

    /* Ein Inhalt, der dem behaupteten Typ widerspricht, kommt nicht hinein. */
    await expect(neueFassung(speicher, id, PDF('x'), ablage, 'image/png')).rejects.toThrow();
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument_version where dokument_id = $1`, [id]);
    expect(n!.n).toBe('2');
  });

  it('der Grund steht im Prüfprotokoll — mit Fassung und Prüfsumme', async () => {
    const speicher = new LokalerSpeicher();
    const id = await vertrag(speicher);
    const e = await neueFassung(speicher, id, PDF('protokoll'));
    const [z] = await sql.unsafe<{ nachher: Record<string, unknown> }[]>(
      `select nachher from audit_log
        where objekt_typ = 'dokument' and objekt_id = $1 and aktion = 'dokument.fassung_abgelegt'`,
      [id]);
    expect(z!.nachher).toMatchObject({ version: 2, sha256: e.sha256 });
  });
});

describe('(2) was keine neue Fassung bekommt', () => {
  it('Rechnung, Beleg und Buchhaltung — im Dienst', async () => {
    const speicher = new LokalerSpeicher();
    for (const kategorie of ['rechnung', 'beleg', 'buchhaltung']) {
      const id = await vertrag(speicher, kategorie);
      await expect(neueFassung(speicher, id, PDF(kategorie)))
        .rejects.toMatchObject({ grund: 'kategorie_gesperrt' });
    }
  });

  /**
   * **Die zweite Linie** (0470). Wer an der Route vorbei eine Fassung schreibt,
   * trifft denselben Riegel — und auch die Lücke in der Kette fällt auf.
   */
  it('an der Route vorbei: die Datenbank sperrt die Kategorie und die Lücke', async () => {
    const speicher = new LokalerSpeicher();
    const rechnung = await vertrag(speicher, 'rechnung');
    const vertragId = await vertrag(speicher);
    const roh = (id: string, version: number) => als(ablage, (tx) => tx.unsafe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1, $2, $3, $4, $5, 72, 'application/pdf')`,
      [f.reinigung, id, version, `t/${zufall()}`, 'a'.repeat(64)]));
    await expect(roh(rechnung, 2)).rejects.toThrow(/keine neue\s+Fassung/u);
    await expect(roh(vertragId, 3)).rejects.toThrow(/lueckenlos/u);
    await expect(roh(vertragId, 2)).resolves.toBeDefined();
  });

  it('ein Dokument ohne erste Fassung bekommt keine zweite', async () => {
    const speicher = new LokalerSpeicher();
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, bucket, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
                             entstanden_am)
       values ($1, 'vertrag', 'Altbestand', 'dokumente', $2, 'application/pdf', true, 72,
               true, current_date)
       returning id`, [f.reinigung, `alt/${zufall()}.pdf`]);
    await expect(neueFassung(speicher, d!.id, PDF('neu')))
      .rejects.toMatchObject({ grund: 'ohne_kette' });
  });

  it('ohne dokument.schreiben keine Fassung, und eine fremde Gesellschaft ist „nicht gefunden"', async () => {
    const speicher = new LokalerSpeicher();
    const id = await vertrag(speicher);
    await expect(neueFassung(speicher, id, PDF('ohne Recht'), nurLesen)).rejects.toThrow();
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument_version where dokument_id = $1`, [id]);
    expect(n!.n).toBe('1');

    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, bucket, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
                             entstanden_am)
       values ($1, 'vertrag', 'Fremd', 'dokumente', $2, 'application/pdf', true, 72, true,
               current_date)
       returning id`, [f.security, `fremd/${zufall()}.pdf`]);
    await expect(neueFassung(speicher, fremd!.id, PDF('fremd')))
      .rejects.toBeInstanceOf(FassungFehler);
  });

  it('ohne verbundenen Speicher entsteht nichts', async () => {
    const speicher = new LokalerSpeicher();
    const id = await vertrag(speicher);
    const aus = { ...speicher, verbunden: false } as unknown as LokalerSpeicher;
    await expect(neueFassung(aus, id, PDF('nicht verbunden'))).rejects.toThrow(/nicht verbunden/u);
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from dokument_version where dokument_id = $1`, [id]);
    expect(n!.n).toBe('1');
  });
});
