import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  REITER, reiterZeilen, zaehler, type ReiterSchluessel,
} from '../../src/server/services/objekt/umfeld.js';

/**
 * **Was an einem Objekt hängt — unter der Policy gezählt** (V-044, OPS-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das eine Isolationsprüfung ist und keine Kernprüfung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Neun Unterabfragen über neun Tabellen, jede mit ihrer eigenen Policy, ihren
 * eigenen Spaltenrechten und ihren eigenen Spaltennamen. Genau diese Sorte
 * Abfrage scheitert nicht beim Übersetzen, sondern erst an der Datenbank —
 * mit „permission denied for table" oder „column does not exist", und zwar
 * auf der Seite eines Menschen, der ein Objekt öffnet.
 *
 * `zeit-stundenkonto` und `lieferant-anlegen` haben dieselbe Lehre schon
 * einmal bezahlt: ein Dienst, den nur eine Kernprüfung gesehen hat, ist ein
 * Dienst, dessen Rechte niemand geprüft hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Gezählt wird, was DIESE Sitzung sehen darf.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Zähler ausserhalb der Policy behauptete eine Menge, deren Zeilen die
 * Liste darunter nicht zeigt — und das ist schlimmer als kein Zähler: die
 * Zahl sagt „da ist etwas", die Liste sagt „nichts", und der Mensch sucht
 * den Fehler bei sich.
 */

let f: Fixtur;
let leitung = '';
let objektId = '';
let fremdesObjekt = '';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function objekt(mandantId: string, nummer: string): Promise<string> {
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, hausnummer,
                         plz, ort)
     values ($1, $2, 'Probeobjekt', 'Kurfürstendamm', '201', '10719', 'Berlin')
     returning id`, [mandantId, nummer]);
  return o!.id;
}

beforeAll(async () => {
  f = await seed();
  leitung = await konto('umfeld-leitung@test.invalid', f.reinigung, 'leitung');
  /*
   * Alle Reiterrechte auf einmal — geprüft wird hier die ABFRAGE, nicht die
   * Rechteentscheidung. Dass ein Reiter ohne Recht gar nicht erst erscheint,
   * hält `tests/kern/objekt-reiter.test.ts` und das Tor der Seite.
   */
  for (const r of REITER.map((x) => x.recht).filter((x): x is string => x !== null)) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = 'objekt.lesen'), $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.reinigung]);

  objektId = await objekt(f.reinigung, 'OBJ-9901');
  fremdesObjekt = await objekt(f.security, 'OBJ-9902');
});
afterAll(schliessen);

function imKontext<T>(fn: (k: {
  abfrage<R>(sql: string, werte?: readonly unknown[]): Promise<readonly R[]>;
}) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: leitung,
      portal: 'intern' as const, readonly: true,
    },
    async (tx: postgres.TransactionSql) => fn({
      abfrage: async <R,>(anweisung: string, werte?: readonly unknown[]) =>
        (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly R[],
    }),
  ) as Promise<T>;
}

describe('§1 der Zähler läuft unter der Policy durch', () => {
  it('neun Zahlen in einer Abfrage, ohne permission denied', async () => {
    const z = await imKontext((k) => zaehler(k, objektId));
    for (const r of REITER) {
      if (r.schluessel === 'uebersicht') continue;
      expect(z[r.schluessel], `${r.schluessel} fehlt im Zähler`).toBeTypeOf('number');
    }
  });

  it('ein frisches Objekt zählt überall null', async () => {
    const z = await imKontext((k) => zaehler(k, objektId));
    expect(Object.values(z).every((n) => n === 0), JSON.stringify(z)).toBe(true);
  });

  /**
   * **Ein fremdes Objekt zählt nicht mit.** Die Zahl käme sonst aus einer
   * Gesellschaft, die diese Sitzung nicht sieht — und eine Zahl ohne Zeilen
   * ist die Auskunft, die AUT-06 gerade verweigert.
   */
  it('ein Objekt einer anderen Gesellschaft ergibt überall null', async () => {
    const z = await imKontext((k) => zaehler(k, fremdesObjekt));
    expect(Object.values(z).every((n) => n === 0), JSON.stringify(z)).toBe(true);
  });
});

describe('§2 jede Reiterabfrage läuft', () => {
  for (const r of REITER) {
    if (r.schluessel === 'uebersicht' || r.schluessel === 'raumbuch') continue;
    it(`\`${r.schluessel}\` antwortet ohne Fehler`, async () => {
      const zeilen = await imKontext(
        (k) => reiterZeilen(k, objektId, r.schluessel as ReiterSchluessel));
      expect(Array.isArray(zeilen)).toBe(true);
    });
  }

  it('`uebersicht` und `raumbuch` haben keine eigene Liste', async () => {
    expect(await imKontext((k) => reiterZeilen(k, objektId, 'uebersicht'))).toEqual([]);
    expect(await imKontext((k) => reiterZeilen(k, objektId, 'raumbuch'))).toEqual([]);
  });
});

describe('§3 was da ist, wird gezählt und gezeigt', () => {
  it('ein Revier an diesem Objekt erscheint in Zahl und Liste', async () => {
    await sql.unsafe(
      `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten,
                           aktiv_ab, erstellt_von_art, erstellt_von)
       values ($1, $2, 'Treppenhaus A', 90, current_date, 'mensch', $3)`,
      [f.reinigung, objektId, leitung]);

    const z = await imKontext((k) => zaehler(k, objektId));
    expect(z.reviere).toBe(1);

    const zeilen = await imKontext((k) => reiterZeilen(k, objektId, 'reviere'));
    expect(zeilen.map((x) => x.text)).toEqual(['Treppenhaus A']);
  });

  /** Aufgelöst heisst: nicht mehr hier. Es steht in der Spur, nicht in der Zahl. */
  it('ein archiviertes Revier zählt nicht mehr mit', async () => {
    await sql.unsafe(
      `update revier set archiviert_am = now() where objekt_id = $1`, [objektId]);
    const z = await imKontext((k) => zaehler(k, objektId));
    expect(z.reviere).toBe(0);
    expect(await imKontext((k) => reiterZeilen(k, objektId, 'reviere'))).toEqual([]);
  });
});
