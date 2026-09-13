/**
 * Die Gruppendienste gegen die echte Policy (D-475, TEN-05, Invariante 10).
 *
 * Was hier steht, kann kein Kerntest zeigen: dass `app.hat_recht` im
 * Gruppen-Scope je Bereich antwortet, dass eine Zelle ohne Recht `null` ist
 * und nicht die 0, die RLS zurueckgaebe, und dass die sichtbare Menge aus
 * `app.switcher_mandanten()` kommt — eine Leitung mit zwei Mitgliedschaften
 * sieht zwei Zeilen, ein Super-Admin vier.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { withGroupScope, type Sitzung } from '../../src/server/kontext/index.js';
import { gruppenUebersicht, rechteJeBereich } from '../../src/server/services/gruppe/uebersicht.js';
import { gruppenAuslastung } from '../../src/server/services/gruppe/auslastung.js';
import { gruppenOffenePosten } from '../../src/server/services/gruppe/offene-posten.js';

let f: Fixtur;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, globaleRolle: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  // AUT-02: ein Konto mit globaler Rolle wird erst mit zweitem Faktor aktiv.
  if (globaleRolle !== null) {
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  }
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id) values ($1,$2,$2,'aktiv',$3)`,
    [u!.id, email, globaleRolle === null ? null : await rolleId(globaleRolle)]);
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

/** Ein Recht fuer eine Rolle in GENAU EINEM Bereich (0008, Zweig 5). */
async function gewaehre(rolle: string, recht: string, mandantId: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, gewaehrt, mandant_id)
     select $1, b.id, true, $3 from berechtigung b where b.schluessel = $2`,
    [await rolleId(rolle), recht, mandantId]);
}

function gruppe(benutzerId: string): Sitzung {
  return {
    benutzerId, personId: null, aktiverMandantId: null, ansicht: 'gruppe',
    aal: 'aal2', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000002',
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) die sichtbare Menge ist die des Switchers', () => {
  it('ein Super-Admin sieht vier Zeilen, alle Zellen sind Zahlen', async () => {
    const chef = await konto('gruppe-super@cse.test', 'super_admin');
    const u = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(chef), (k) => gruppenUebersicht(k)));
    // Die Harness vergibt keine Sortierung — die Menge zaehlt, nicht die Reihenfolge.
    expect([...u.bereiche.map((b) => b.slug)].sort())
      .toEqual(['bau', 'operations', 'reinigung', 'security']);
    for (const b of u.bereiche) {
      expect(b.auftraegeAktiv).not.toBeNull();
      expect(b.fakturiertJahrCent).not.toBeNull();
      expect(b.freigabenOffen).not.toBeNull();
    }
    // Die Harness stellt Fatima in zwei und Jonas in einer Gesellschaft an (D-09).
    const je = new Map(u.bereiche.map((b) => [b.slug, b.beschaeftigte]));
    expect(je.get('reinigung')).toBe(2);
    expect(je.get('security')).toBe(1);
    expect(je.get('bau')).toBe(0);
    expect(u.summe.bereiche.auftraege).toBe(4);
    expect(typeof u.summe.fakturiertJahrCent).toBe('bigint');
  });

  it('eine Leitung mit zwei Mitgliedschaften sieht zwei Zeilen — nicht vier', async () => {
    const leitung = await konto('gruppe-leitung@cse.test');
    await mitglied(leitung, f.reinigung, 'leitung');
    await mitglied(leitung, f.bau, 'leitung');
    const u = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(leitung), (k) => gruppenUebersicht(k)));
    expect(u.bereiche.map((b) => b.slug).sort()).toEqual(['bau', 'reinigung']);
  });
});

describe('(2) eine Zelle ohne Recht ist null — nicht die Null der Policy', () => {
  it('Recht nur in der Reinigung: dort eine Zahl, im Bau ein Strich', async () => {
    const leitung = await konto('gruppe-zelle@cse.test');
    await mitglied(leitung, f.reinigung, 'leitung');
    await mitglied(leitung, f.bau, 'leitung');
    // `leitung` haelt von Haus aus KEIN gruppe.*-Recht (0008) — genau eines dazu.
    await gewaehre('leitung', 'gruppe.personal.lesen', f.reinigung);

    const u = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(leitung), (k) => gruppenUebersicht(k)));
    const reinigung = u.bereiche.find((b) => b.slug === 'reinigung');
    const bau = u.bereiche.find((b) => b.slug === 'bau');
    expect(reinigung?.beschaeftigte).toBe(2);
    expect(bau?.beschaeftigte).toBeNull();
    // Und wo gar kein Recht steht, steht nirgends eine Zahl.
    expect(reinigung?.auftraegeAktiv).toBeNull();
    expect(bau?.fakturiertJahrCent).toBeNull();
    expect(u.summe.bereiche.auftraege).toBe(0);
    expect(u.summe.auftraegeAktiv).toBe(0);
  });

  it('rechteJeBereich fragt mit dem Mandanten der Zeile, nicht global', async () => {
    const leitung = await konto('gruppe-rechte@cse.test');
    await mitglied(leitung, f.reinigung, 'leitung');
    await mitglied(leitung, f.security, 'leitung');
    await gewaehre('leitung', 'gruppe.auftrag.lesen', f.security);
    const karte = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(leitung), (k) =>
        rechteJeBereich(k, ['gruppe.auftrag.lesen', 'gruppe.crm.lesen'])));
    expect(karte.get(f.security)?.has('gruppe.auftrag.lesen')).toBe(true);
    expect(karte.get(f.reinigung)?.has('gruppe.auftrag.lesen')).toBe(false);
    expect(karte.get(f.security)?.has('gruppe.crm.lesen')).toBe(false);
    // Ein Bereich ausserhalb der Mitgliedschaft kommt gar nicht vor.
    expect(karte.has(f.bau)).toBe(false);
  });
});

describe('(3) die uebrigen Leser laufen im Gruppen-Scope ohne Schreibpfad', () => {
  it('Auslastung und offene Posten antworten leer, nicht mit einem Fehler', async () => {
    const chef = await konto('gruppe-leer@cse.test', 'super_admin');
    const { auslastung, posten } = await sql.begin((tx) =>
      withGroupScope(tx as never, gruppe(chef), async (k) => ({
        auslastung: await gruppenAuslastung(k, '2026-09-14'),
        posten: await gruppenOffenePosten(k, k.mandantIds),
      })));
    expect(auslastung.wochen).toHaveLength(4);
    expect(auslastung.wochen[0]?.montag).toBe('2026-08-24');
    expect(auslastung.wochen[3]?.iso).toBe('2026-W38');
    expect(auslastung.von).toBe('2026-08-24');
    expect(auslastung.bis).toBe('2026-09-20');
    expect(auslastung.personen).toEqual([]);
    expect(posten.bereiche).toHaveLength(4);
    expect(posten.posten).toEqual([]);
    for (const b of posten.bereiche) expect(b.debitorenOffenCent).toBe(0n);
  });
});
