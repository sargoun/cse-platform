import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { setzeHauptkontakt } from '../../src/server/services/crm/aendern.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';

/**
 * **Der Hauptkontakt lässt sich bestimmen** (V-097, CRM-02).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ansprechpartner.ist_hauptkontakt` steht seit `0020` da, ein partieller
 * eindeutiger Index hält genau einen je Kunde, das Kontaktblatt zeigt das
 * Etikett — und gesetzt wurde die Spalte NUR beim Anlegen des allerersten
 * Kontakts. Wer den Hauptkontakt wechseln wollte, weil die Objektleiterin
 * gewechselt hat, konnte es nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Index ist NICHT aufgeschoben. Setzte man erst den neuen Hauptkontakt,
 * fiele die Eindeutigkeit, solange der alte noch steht — und die Meldung wäre
 * „duplicate key value violates unique constraint" an einer Stelle, an der
 * niemand danach sucht. Die Reihenfolge löschen-dann-setzen ist der ganze
 * Punkt, und sie lässt sich nur hier beweisen.
 */

let f: Fixtur;
let leitung = '';
let kundeId = '';
let zweiterKunde = '';
let anna = '';
let bert = '';
let fremd = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

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

async function kunde(mandant: string, name: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,$3,'Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`, name]);
  return k!.id;
}

async function kontakt(
  mandant: string, kundeRef: string, nachname: string, haupt = false,
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, ist_hauptkontakt)
     values ($1,$2,'Kim',$3,$4) returning id`, [mandant, kundeRef, nachname, haupt]);
  return a!.id;
}

beforeAll(async () => {
  f = await seed();
  leitung = await konto('hauptkontakt@test.invalid', f.reinigung, 'leitung');
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = 'crm.schreiben'), $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.reinigung]);
  kundeId = await kunde(f.reinigung, 'Bezirksamt Mitte');
  zweiterKunde = await kunde(f.reinigung, 'Hafen Spandau GmbH');
  anna = await kontakt(f.reinigung, kundeId, 'Anders', true);
  bert = await kontakt(f.reinigung, kundeId, 'Berger');
  fremd = await kontakt(f.reinigung, zweiterKunde, 'Sommer');
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  o: { readonly readonly?: boolean } = {},
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: leitung,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => {
      const lauf = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: lauf, schreibe: lauf,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function haupt(kundeRef: string): Promise<readonly string[]> {
  const zeilen = await sql.unsafe<{ id: string }[]>(
    `select id from ansprechpartner
      where kunde_id = $1 and ist_hauptkontakt and archiviert_am is null
      order by nachname`, [kundeRef]);
  return zeilen.map((z) => z.id);
}

describe('§1 der Wechsel', () => {
  it('setzt den neuen und LÖSCHT den alten — in einem Zug', async () => {
    expect(await haupt(kundeId)).toEqual([anna]);
    await imKontext((k) => setzeHauptkontakt(k, kundeId, bert));
    /*
     * Genau EINER. Der partielle eindeutige Index liesse zwei gar nicht zu —
     * fiele die Reihenfolge, wäre die Meldung „duplicate key value violates
     * unique constraint" an einer Stelle, an der niemand danach sucht.
     */
    expect(await haupt(kundeId)).toEqual([bert]);
  });

  it('zweimal denselben setzen ändert nichts und wirft nicht', async () => {
    await imKontext((k) => setzeHauptkontakt(k, kundeId, bert));
    expect(await haupt(kundeId)).toEqual([bert]);
  });

  it('ein anderer Kunde bleibt unberührt', async () => {
    await imKontext((k) => setzeHauptkontakt(k, zweiterKunde, fremd));
    expect(await haupt(zweiterKunde)).toEqual([fremd]);
    expect(await haupt(kundeId)).toEqual([bert]);
  });
});

describe('§2 was nicht geht', () => {
  it('ein Kontakt eines ANDEREN Kunden wird abgewiesen — und nichts gelöscht', async () => {
    const vorher = await haupt(kundeId);
    await expect(imKontext((k) => setzeHauptkontakt(k, kundeId, fremd)))
      .rejects.toThrow(CrmFehler);
    /*
     * Das ist der Grund für die Prüfung VOR dem Löschen: sonst stünde der
     * Kunde nach einem Tippfehler ohne Hauptkontakt da, und die Meldung
     * erklärte nicht, dass der alte dabei verlorenging.
     */
    expect(await haupt(kundeId)).toEqual(vorher);
  });

  it('ein ausgeschiedener Kontakt wird es nicht', async () => {
    const weg = await kontakt(f.reinigung, kundeId, 'Weggang');
    await sql.unsafe(
      `update ansprechpartner set ausgeschieden_am = now() where id = $1`, [weg]);
    await expect(imKontext((k) => setzeHauptkontakt(k, kundeId, weg)))
      .rejects.toThrow(/ausgeschieden/u);
  });

  it('in der Nur-Lese-Bindung geschieht nichts', async () => {
    await expect(imKontext((k) => setzeHauptkontakt(k, kundeId, anna),
      { readonly: true })).rejects.toThrow();
  });
});
