/**
 * **Die Gewährleistungsfrist des Bauprojekts kommt an den Auftrag** (V-341,
 * O-68, D-792, D-828) — an echtem Postgres.
 *
 * Die Abnahme rechnet die Frist und schreibt sie an das Projekt; das
 * Kundenportal zeigt die des Auftrags. Geprüft wird: der Abschluss ohne
 * eigene Angabe übernimmt Frist und Abnahmetag aus der echten Abnahme
 * (`protokolliereAbnahme`), eine Angabe in der Maske geht vor, ein Projekt
 * ohne Abnahme gibt nichts her, und ein Auftrag ohne Projekt bleibt, wie er
 * war.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { protokolliereAbnahme } from '../../src/server/services/bau/abnahme.js';
import {
  projektFrist, schliesseAuftragAb,
} from '../../src/server/services/auftrag/abschluss.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(): Promise<string> {
  const email = `frist-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null),
             current_date - 1)`, [u!.id, f.bau]);
  return u!.id;
}

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const fuehre = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: leitung,
    aktiverMandantId: f.bau, mandantIds: [f.bau],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.bau, benutzerId: leitung,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

/** Kunde → Auftrag → (Projekt). */
async function auftrag(mitProjekt: boolean): Promise<{ auftrag: string; projekt: string | null }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Bauherr Süd') returning id`,
    [f.bau, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Süd',$4,'2026-01-01') returning id`,
    [f.bau, `AU-${zufall()}`, k!.id, leitung] as never[]);
  if (!mitProjekt) return { auftrag: a!.id, projekt: null };
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, status, auftragssumme_netto_cent)
     values ($1,$2,$3,'Rohbau Süd',$4,'hochbau','vob_b','in_arbeit',10000000)
     returning id`, [f.bau, a!.id, `P-${zufall()}`, k!.id] as never[]);
  return { auftrag: a!.id, projekt: p!.id };
}

async function nimmAb(projekt: string, am: string): Promise<void> {
  await als((k) => protokolliereAbnahme(k, {
    projektId: projekt, art: 'foermlich', abnahmeAm: am, leistungsumfang: null,
    abgenommen: true, verweigerungGrund: null,
    vorbehaltVertragsstrafe: false, vorbehaltMaengel: false, vorbehaltText: null,
    teilnehmer: ['Bauleitung AN', 'Bauleitung AG'], maengel: [],
  }));
}

async function fristAmAuftrag(id: string): Promise<{ abnahme: string | null; bis: string | null }> {
  const [z] = await sql.unsafe<{ abnahme: string | null; bis: string | null }[]>(
    `select abnahme_am::text as abnahme, gewaehrleistung_bis::text as bis
       from auftrag where id = $1`, [id]);
  return z!;
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto();
});
afterAll(schliessen);

describe('V-341 — die Projektfrist ist die Auftragsfrist (O-68)', () => {
  it('ohne eigene Angabe übernimmt der Abschluss Frist und Abnahmetag der Abnahme', async () => {
    const a = await auftrag(true);
    await nimmAb(a.projekt!, '2026-09-10');
    // VOB/B → vier Jahre ab Abnahme (D-782), gerechnet von der Abnahme selbst.
    expect(await als((k) => projektFrist(k, a.auftrag)))
      .toEqual({ abnahmeAm: '2026-09-10', gewaehrleistungBis: '2030-09-10' });
    await als((k) => schliesseAuftragAb(k, a.auftrag, {}));
    expect(await fristAmAuftrag(a.auftrag)).toEqual({ abnahme: '2026-09-10', bis: '2030-09-10' });
  });

  it('eine Angabe in der Maske geht vor', async () => {
    const a = await auftrag(true);
    await nimmAb(a.projekt!, '2026-09-10');
    await als((k) => schliesseAuftragAb(k, a.auftrag, {
      abnahmeAm: '2026-09-12', gewaehrleistungBis: '2031-09-12',
    }));
    expect(await fristAmAuftrag(a.auftrag)).toEqual({ abnahme: '2026-09-12', bis: '2031-09-12' });
  });

  it('ohne Abnahme am Projekt und ohne Projekt gibt es nichts zu übernehmen', async () => {
    const ohneAbnahme = await auftrag(true);
    expect(await als((k) => projektFrist(k, ohneAbnahme.auftrag))).toBeNull();
    await als((k) => schliesseAuftragAb(k, ohneAbnahme.auftrag, {}));
    expect(await fristAmAuftrag(ohneAbnahme.auftrag)).toEqual({ abnahme: null, bis: null });

    const ohneProjekt = await auftrag(false);
    await als((k) => schliesseAuftragAb(k, ohneProjekt.auftrag, {}));
    expect(await fristAmAuftrag(ohneProjekt.auftrag)).toEqual({ abnahme: null, bis: null });
  });
});
