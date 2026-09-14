/**
 * Der Wissensindex gegen eine echte Datenbank (AGT-06, 0151).
 *
 *  1. **Die Dimension ist Schema, keine Einstellung** — ein Vektor mit
 *     falscher Länge kommt gar nicht erst hinein.
 *  2. **Vorgabe `vertraulich`**, und eine Herabstufung trägt einen Namen.
 *  3. **Keine Gruppenansicht.** Eine Ähnlichkeitssuche über vier
 *     Gesellschaften wäre „zeig mir den Vertrag der Schwester".
 *  4. Die Anwendungsrolle baut den Index nicht — das tut der Job.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { EINBETTUNG_DIMENSION, einbettungsStand } from '../../src/server/config/rag.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Ein Vektor der richtigen Länge — Inhalt egal, Länge nicht. */
function vektor(laenge = EINBETTUNG_DIMENSION): string {
  return `[${Array.from({ length: laenge }, (_, i) => (i % 7) / 10).join(',')}]`;
}

async function legeKontoAn(mandantId: string, rolle = 'admin'): Promise<string> {
  const mail = `wi-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [mail]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Wissenstest','aktiv')`,
    [u!.id, mail]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzerId ?? benutzer, portal: 'intern' as const, readonly: false,
  };
}

async function legeChunkAn(mandantId: string, teil: {
  quelle?: string; text?: string; index?: number;
} = {}): Promise<string> {
  const [z] = await alsRolle('cse_job', async (tx: postgres.TransactionSql) =>
    tx.unsafe(
      `insert into wissens_chunk
         (mandant_id, quelle_typ, quelle_id, quelle_tabelle, chunk_index, text,
          embedding, embedding_modell, embedding_dim, quell_hash)
       values ($1::uuid, $2::wissens_quelle_typ, gen_random_uuid(), 'vertrag', $3::int, $4,
               $5::vector, 'text-embedding-3-small', $6::int, $7)
       returning id`,
      [mandantId, teil.quelle ?? 'vertrag', teil.index ?? 0,
        teil.text ?? 'Die Kündigungsfrist beträgt drei Monate zum Quartalsende.',
        vektor(), EINBETTUNG_DIMENSION, zufall()]),
  ) as readonly { id: string }[];
  return z!.id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeKontoAn(f.reinigung);
  await sql.unsafe(`delete from wissens_chunk`);
});

afterAll(schliessen);

describe('(1) Die Dimension ist Schema', () => {
  it('ein Vektor der falschen Laenge kommt nicht hinein', async () => {
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into wissens_chunk
         (mandant_id, quelle_typ, quelle_id, quelle_tabelle, chunk_index, text,
          embedding, embedding_modell, embedding_dim, quell_hash)
       values ($1::uuid,'vertrag',gen_random_uuid(),'vertrag',0,'x',
               $2::vector,'falsch',$3::int,'h')`,
      [f.reinigung, vektor(8), 8])))
      .rejects.toThrow();
  });

  it('ein Vektor der richtigen Laenge geht durch', async () => {
    const id = await legeChunkAn(f.reinigung);
    expect(id).toBeDefined();
  });

  it('der Index kann gar nicht auf eine andere Dimension gestellt werden', async () => {
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into wissens_chunk
         (mandant_id, quelle_typ, quelle_id, quelle_tabelle, chunk_index, text,
          embedding, embedding_modell, embedding_dim, quell_hash)
       values ($1::uuid,'vertrag',gen_random_uuid(),'vertrag',0,'x',
               $2::vector,'anderes-modell',768,'h')`,
      [f.reinigung, vektor()])))
      .rejects.toThrow(/wc_dimension/u);
  });
});

describe('(2) Vertraulich ist die Vorgabe', () => {
  it('eine neue Passage ist vertraulich, ohne dass jemand es sagt', async () => {
    const id = await legeChunkAn(f.reinigung);
    const [z] = await sql.unsafe<{ v: string }[]>(
      `select vertraulichkeit::text as v from wissens_chunk where id = $1`, [id]);
    expect(z!.v).toBe('vertraulich');
  });

  it('eine Herabstufung ohne Namen wird abgewiesen', async () => {
    const id = await legeChunkAn(f.reinigung);
    await expect(sql.unsafe(
      `update wissens_chunk set vertraulichkeit = 'normal' where id = $1`, [id]))
      .rejects.toThrow(/wc_klassifikation_belegt/u);
  });

  it('mit Namen und Zeitpunkt geht sie', async () => {
    const id = await legeChunkAn(f.reinigung);
    await sql.unsafe(
      `update wissens_chunk set vertraulichkeit = 'normal',
              klassifiziert_von = $2, klassifiziert_am = now()
        where id = $1`, [id, benutzer]);
    const [z] = await sql.unsafe<{ v: string; von: string }[]>(
      `select vertraulichkeit::text as v, klassifiziert_von as von
         from wissens_chunk where id = $1`, [id]);
    expect(z!.v).toBe('normal');
    expect(z!.von).toBe(benutzer);
  });
});

describe('(3) Die Waende — hier besonders', () => {
  it('eine fremde Gesellschaft findet die Passage nicht, auch nicht per Aehnlichkeit', async () => {
    await legeChunkAn(f.reinigung);
    const fremder = await legeKontoAn(f.security);

    /* Genau die Abfrage, die ein RAG-Werkzeug stellt — ohne Mandantenfilter. */
    const treffer = await alsApp(sitzung(f.security, fremder),
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `select id, text from wissens_chunk order by embedding <=> $1::vector limit 10`,
        [vektor()]));
    expect(treffer, 'RLS faengt die Aehnlichkeitssuche ab').toHaveLength(0);
  });

  it('es gibt KEINE Gruppenansicht auf den Index', async () => {
    await legeChunkAn(f.reinigung);
    const zeilen = await alsRolle('cse_app', async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`select set_config('app.scope','gruppe',true)`);
      await tx.unsafe(`select set_config('app.mandant_id','',true)`);
      await tx.unsafe(`select set_config('app.mandant_ids',$1,true)`,
        [[f.reinigung, f.security].join(',')]);
      await tx.unsafe(`select set_config('app.benutzer_id',$1,true)`, [benutzer]);
      await tx.unsafe(`select set_config('app.readonly','on',true)`);
      return tx.unsafe(`select id from wissens_chunk`);
    });
    expect(zeilen,
      '„zeig mir aehnliche Klauseln" waere gruppenweit „zeig mir den Vertrag der Schwester"')
      .toHaveLength(0);
  });

  it('die Anwendungsrolle baut den Index nicht', async () => {
    await expect(alsApp(sitzung(), async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into wissens_chunk
         (mandant_id, quelle_typ, quelle_id, quelle_tabelle, chunk_index, text,
          embedding, embedding_modell, embedding_dim, quell_hash)
       values ($1::uuid,'vertrag',gen_random_uuid(),'vertrag',0,'x',
               $2::vector,'m',$3::int,'h')`,
      [f.reinigung, vektor(), EINBETTUNG_DIMENSION])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  it('die eigene Gesellschaft liest ihre Passagen', async () => {
    await legeChunkAn(f.reinigung);
    const treffer = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select id from wissens_chunk order by embedding <=> $1::vector limit 10`,
        [vektor()]));
    expect(treffer).toHaveLength(1);
  });
});

describe('(4) Ohne Anbieter wird nichts indiziert', () => {
  it('der Stand sagt, was fehlt — und indiziert nicht ersatzweise', () => {
    const vorher = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const stand = einbettungsStand();
    expect(stand.verbunden).toBe(false);
    expect(stand.hinweis).toContain('OPENAI_API_KEY');
    if (vorher !== undefined) process.env['OPENAI_API_KEY'] = vorher;
  });

  it('ein Schluessel ohne bestaetigte EU-Verarbeitung reicht nicht (D-04)', () => {
    const vorherSchluessel = process.env['OPENAI_API_KEY'];
    const vorherRegion = process.env['OPENAI_REGION'];
    process.env['OPENAI_API_KEY'] = 'sk-test';
    delete process.env['OPENAI_REGION'];
    const stand = einbettungsStand();
    expect(stand.verbunden, 'Vertraege dreier deutscher Gesellschaften').toBe(false);
    expect(stand.hinweis).toContain('EU');
    if (vorherSchluessel === undefined) delete process.env['OPENAI_API_KEY'];
    else process.env['OPENAI_API_KEY'] = vorherSchluessel;
    if (vorherRegion !== undefined) process.env['OPENAI_REGION'] = vorherRegion;
  });
});
