/**
 * Die Abwesenheitsmeldung der Arbeiterin: doppelt, verkehrt herum oder mit
 * einer Bescheinigung vor dem ersten Tag — jedes Mal ein Grund, nie eine
 * rohe 500 (V-188, EMP-10).
 *
 * Geprüft wird der Dienst im ECHTEN Schreibweg des Portals gegen die echte
 * Datenbank: `ab_keine_dublette` (23P01) und `ab_au_bis` (23514) aus 0073
 * sind genau die Abweisungen, die vorher durch die Route fielen. Die Route
 * selbst prüft `tests/kern/meldung-rueckweg.test.ts`.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import { mandantDerAnstellung } from '../../src/server/services/zeit/einwand.js';
import {
  AuBisVorBeginn, meldeAbwesenheit,
} from '../../src/server/services/abwesenheit/index.js';
import { ZeitraumFehler } from '../../src/server/services/abwesenheit/tage.js';
import { datenbankGrund } from '../../src/app/api/mein/formular.js';

let f: Fixtur;
let fatimaKonto: string;
let krank: string;
const SITZUNG = '00000000-0000-0000-0000-0000000003b8';

beforeEach(async () => {
  f = await seed();
  const email = `meldung-${String(Math.random()).slice(2, 10)}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  fatimaKonto = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [fatimaKonto, email, f.fatima]);
  const [rolle] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [fatimaKonto, f.reinigung, rolle!.id]);
  const [art] = await sql.unsafe<{ id: string }[]>(
    `select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null`);
  krank = art!.id;
  // O-139 für diese Prüfung beantwortet — sonst weist `pruefeArt` vorher ab.
  await sql.unsafe(`update abwesenheitsart set bezahlt = true where id = $1`, [krank]);
});

afterAll(async () => { await schliessen(); });

async function melde(von: string, bis: string, auBis: string | null = null): Promise<unknown> {
  try {
    await sql.begin(async (tx: postgres.TransactionSql) => {
      const sitzung: Sitzung = {
        benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId: f.reinigung,
        ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
      };
      const mandantId = await withPersonScope(tx as never, sitzung, async (k) =>
        mandantDerAnstellung(k, f.fatimaReinigung));
      return withTenant(tx as never,
        { ...sitzung, aktiverMandantId: mandantId }, (k: SchreibKontext) =>
          meldeAbwesenheit(k, {
            anstellungId: f.fatimaReinigung, abwesenheitsartId: krank, von, bis,
            auBescheinigungVorliegt: auBis !== null, auBis,
          }));
    });
    return null;
  } catch (fehler) {
    return fehler;
  }
}

async function anzahl(): Promise<number> {
  const [z] = await sql.unsafe<{ n: string }[]>(
    `select count(*)::text as n from abwesenheit where anstellung_id = $1`, [f.fatimaReinigung]);
  return Number(z?.n ?? '-1');
}

describe('V-188: die Meldung der Arbeiterin wird abgewiesen, nicht abgestürzt', () => {
  it('eine Bescheinigung vor dem ersten Tag: der Dienst sagt es VOR der Datenbank', async () => {
    const fehler = await melde('2029-03-02', '2029-03-04', '2029-03-01');
    expect(fehler).toBeInstanceOf(AuBisVorBeginn);
    expect((fehler as AuBisVorBeginn).grund).toBe('au_bis_vor_von');
    expect(await anzahl()).toBe(0);
    // Am ersten Tag selbst endet sie gültig — `ab_au_bis` verlangt `au_bis >= von`.
    expect(await melde('2029-03-02', '2029-03-04', '2029-03-02')).toBeNull();
    expect(await anzahl()).toBe(1);
  });

  it('„Bis" vor „Von" kommt als Grund des Dienstes', async () => {
    const fehler = await melde('2029-03-04', '2029-03-02');
    expect(fehler).toBeInstanceOf(ZeitraumFehler);
    expect((fehler as ZeitraumFehler).grund).toBe('zeitraum_verkehrt');
  });

  it('dieselbe Meldung zweimal: die Datenbank weist ab, und die Route kennt den Code', async () => {
    expect(await melde('2029-03-02', '2029-03-04')).toBeNull();
    const zweite = await melde('2029-03-03', '2029-03-05');
    expect((zweite as { code?: string }).code).toBe('23P01');
    // Vorher: kein `status` → `throw` → 500. Jetzt: „ueberlappt" für die Maske.
    expect(datenbankGrund(zweite)).toBe('ueberlappt');
    expect(await anzahl()).toBe(1);
  });

  it('die zweite Linie bleibt: `ab_au_bis` weist ab, wenn jemand am Dienst vorbeischreibt', async () => {
    let gefangen: unknown = null;
    try {
      await sql.unsafe(
        `insert into abwesenheit (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
                                  status, au_bis)
         values ($1, $2, $3, '2029-04-02', '2029-04-03', 'erfasst', '2029-04-01')`,
        [f.reinigung, f.fatimaReinigung, krank]);
    } catch (fehler) {
      gefangen = fehler;
    }
    expect((gefangen as { code?: string }).code).toBe('23514');
    expect(datenbankGrund(gefangen)).toBe('ungueltige_eingabe');
  });
});
