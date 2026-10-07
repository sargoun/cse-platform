/**
 * **Die Angaben einer Gesellschaft pflegen und bestätigen** (V-390, D-804,
 * 0494, TEN-01, TEN-09).
 *
 * Bis 0494 kamen Register, Steuernummern, Anschrift, Bank und Rechtsform nur
 * aus dem Seed oder per SQL. Jetzt gibt es genau einen Weg — zwei Definer mit
 * demselben Tor —, und gemessen wird vor allem, was NICHT geht: ohne
 * `system.mandant_verwalten`, ohne zweiten Faktor, in der Gruppenansicht, am
 * Weg vorbei per UPDATE, mit einem Feld, das nicht pflegbar ist. Dazu die
 * Bestätigung: eine geänderte Angabe ist eine unbestätigte.
 *
 * Die Datei legt sich eine EIGENE Gesellschaft an: die vier aus der Fixtur
 * tragen die Angaben, auf die Rechnungen und Impressum anderer Dateien bauen.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AngabenFehler, bestaetigeAngaben, pruefeAngaben, setzeAngaben, type MandantAngaben,
} from '../../src/server/services/mandant/angaben.js';

let gesellschaft = '';
/** Super-Administration: hält `system.mandant_verwalten` global. */
let chef = '';
/** Eine Administration dieser Gesellschaft — ohne das Recht. */
let admin = '';

async function konto(email: string, global = false): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             case when $3 then (select id from rolle
                                 where schluessel = 'super_admin' and mandant_id is null) end)`,
    [u!.id, email, global]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, gesellschaft]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: gesellschaft, mandantIds: [gesellschaft],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  optionen: { aal?: 'aal1' | 'aal2'; scope?: 'mandant' | 'gruppe' } = {},
): Promise<T> {
  return alsApp({
    scope: optionen.scope ?? 'mandant', mandantId: gesellschaft, mandantIds: [gesellschaft],
    benutzerId, portal: 'intern', readonly: false, aal: optionen.aal ?? 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

async function grund(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (fehler) {
    if (fehler instanceof AngabenFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

const FORMULAR: Readonly<Record<string, string>> = {
  firma: 'Angabentest GmbH',
  rechtsform: 'GmbH',
  istRechtseinheit: 'ja',
  eigenerNummernkreis: 'ja',
  geschaeftsfuehrer: 'Erika Muster',
  handelsregisterGericht: 'Amtsgericht Charlottenburg',
  handelsregisterNummer: 'HRB 299999 B',
  ustId: 'DE123456789',
  strasse: 'Musterstraße 1',
  plz: '10115',
  ort: 'Berlin',
  iban: 'DE02120300000000202051',
};
const ANGABEN: MandantAngaben = pruefeAngaben((feld) => FORMULAR[feld] ?? null);

interface Stand {
  firma: string;
  ust_id: string | null;
  ist_rechtseinheit: boolean | null;
  eigener_nummernkreis: boolean;
  geschaeftsfuehrer: string[];
  iban: string | null;
  bestaetigt: boolean;
}

async function stand(): Promise<Stand> {
  const [z] = await sql.unsafe<Stand[]>(
    `select firma, ust_id, ist_rechtseinheit, eigener_nummernkreis, geschaeftsfuehrer, iban,
            angaben_bestaetigt_am is not null as bestaetigt
       from mandant where id = $1`, [gesellschaft]);
  return z!;
}

beforeAll(async () => {
  await seed();
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into mandant (slug, name, firma) values ('angabentest', 'Angabentest', 'Angabentest')
     on conflict (slug) do update set firma = 'Angabentest'
     returning id`);
  gesellschaft = m!.id;
  chef = await konto('angaben-chef@test.invalid', true);
  admin = await konto('angaben-admin@test.invalid');
});
afterAll(schliessen);

describe('(1) die Super-Administration pflegt — und das Protokoll hält es fest', () => {
  it('schreibt die Angaben und meldet „geändert"', async () => {
    expect(await als(chef, (k) => setzeAngaben(k, ANGABEN))).toBe(true);
    const s = await stand();
    expect(s.firma).toBe('Angabentest GmbH');
    expect(s.ust_id).toBe('DE123456789');
    expect(s.ist_rechtseinheit).toBe(true);
    expect(s.eigener_nummernkreis).toBe(true);
    expect(s.geschaeftsfuehrer).toEqual(['Erika Muster']);
    expect(s.iban).toBe('DE02120300000000202051');
  });

  it('dieselben Angaben noch einmal sind „unverändert", kein Fehler', async () => {
    expect(await als(chef, (k) => setzeAngaben(k, ANGABEN))).toBe(false);
  });

  it('jede Änderung steht im Protokoll, mit der Person, die sie gemacht hat (TEN-09)', async () => {
    const [z] = await sql.unsafe<{ n: string; akteur: string | null }[]>(
      `select count(*)::text as n, max(akteur_id::text) as akteur
         from audit_log
        where aktion = 'mandant.update' and objekt_typ = 'mandant' and objekt_id = $1`,
      [gesellschaft]);
    expect(Number(z!.n)).toBeGreaterThan(0);
    expect(z!.akteur).toBe(chef);
  });
});

describe('(2) eine geänderte Angabe ist eine unbestätigte', () => {
  it('bestätigen setzt den Zeitpunkt', async () => {
    await als(chef, (k) => bestaetigeAngaben(k));
    expect((await stand()).bestaetigt).toBe(true);
  });

  it('unverändert absenden lässt die Bestätigung stehen', async () => {
    expect(await als(chef, (k) => setzeAngaben(k, ANGABEN))).toBe(false);
    expect((await stand()).bestaetigt).toBe(true);
  });

  it('eine Änderung nimmt sie zurück', async () => {
    expect(await als(chef, (k) => setzeAngaben(k, { ...ANGABEN, ort: 'Potsdam', plz: '14467' })))
      .toBe(true);
    expect((await stand()).bestaetigt).toBe(false);
  });
});

describe('(3) was nicht geht', () => {
  it('eine Administration ohne system.mandant_verwalten', async () => {
    expect(await grund(als(admin, (k) => setzeAngaben(k, ANGABEN)))).toBe('nicht_erlaubt');
    expect(await grund(als(admin, (k) => bestaetigeAngaben(k)))).toBe('nicht_erlaubt');
  });

  it('die Super-Administration ohne zweiten Faktor', async () => {
    expect(await grund(als(chef, (k) => setzeAngaben(k, ANGABEN), { aal: 'aal1' })))
      .toBe('nicht_erlaubt');
  });

  it('in der Gruppenansicht (Invariante 10)', async () => {
    expect(await grund(als(chef, (k) => setzeAngaben(k, ANGABEN), { scope: 'gruppe' })))
      .toBe('nicht_erlaubt');
  });

  it('am Weg vorbei: cse_app schreibt mandant nicht', async () => {
    await expect(alsApp({
      scope: 'mandant', mandantId: gesellschaft, mandantIds: [gesellschaft],
      benutzerId: chef, portal: 'intern', readonly: false, aal: 'aal2',
    }, (tx) => tx.unsafe(`update mandant set firma = 'Umweg GmbH' where id = $1`, [gesellschaft])))
      .rejects.toThrow(/permission denied/u);
  });

  it('ein Feld, das nicht pflegbar ist, weist die Funktion ab', async () => {
    await expect(als(chef, (k) => k.schreibe(
      `select app.mandant_angaben_setzen($1::text::jsonb)`,
      [JSON.stringify({ firma: 'Angabentest GmbH', slug: 'umbenannt' })])))
      .rejects.toThrow(/Unbekanntes Feld: slug/u);
  });

  it('der CHECK bleibt die letzte Linie — mit dem Satz, den der Dienst vorher sagt', async () => {
    /* An `pruefeAngaben` vorbei: ein Kreis ohne Rechtseinheit. */
    expect(await grund(als(chef, (k) => setzeAngaben(k, {
      ...ANGABEN, istRechtseinheit: null, eigenerNummernkreis: true,
    })))).toBe('kreis_ohne_rechtseinheit');
    expect(await grund(als(chef, (k) => setzeAngaben(k, {
      ...ANGABEN, ustId: null, steuernummer: null,
    })))).toBe('ustg14_unvollstaendig');
  });
});
