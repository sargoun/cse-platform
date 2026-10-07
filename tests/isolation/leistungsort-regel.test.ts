/**
 * Die Regel zum Leistungsort ist eine Einstellung je Gesellschaft (V-373,
 * O-933, D-836).
 *
 * Bis hierher war sie eine Zeile im Code (`OBJEKT_KUNDE_REGEL`, `frei`).
 * Jetzt setzt jede Gesellschaft `frei` oder `gleich` unter Einstellungen ›
 * Rechnungen, und `legeEntwurfAn` und `aendereEntwurfKopf` lesen sie. Geprüft
 * wird hier der ganze Weg: Voreinstellung, Setzen mit Protokoll, Befolgen in
 * beiden Diensten, Schreibrecht — und dass die eine Gesellschaft die andere
 * nicht bindet.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { legeEntwurfAn, type Abfrage } from '../../src/server/services/finanz/rechnung.js';
import { aendereEntwurfKopf } from '../../src/server/services/finanz/entwurf.js';
import {
  leseLeistungsortRegel, setzeLeistungsortRegel,
} from '../../src/server/services/finanz/leistungsort-regel.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let admin: string;
let fibu: string;
const zufall = (): string => String(Math.random()).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function alsKontext(tx: postgres.TransactionSql, mandant: string, benutzer: string)
  : SchreibKontext {
  const abfrage = async <T,>(anweisung: string, werte?: readonly unknown[])
    : Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

function sitzung(mandantId: string, benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

async function konto(email: string, global: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, global]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolleId: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1, $2, $3)`,
    [benutzer, mandant, rolleId]);
}

async function kunde(mandant: string, name: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, $3, 'Karl-Marx-Allee', '31', '10178', 'Berlin') returning id`,
    [mandant, `K-${zufall()}`, name]);
  return k!.id;
}

async function objekt(mandant: string, kundeId: string | null): Promise<string> {
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Wohnhaus Mitte', 'Teststr. 7', '10115', 'Berlin') returning id`,
    [mandant, kundeId, `O-${zufall()}`]);
  return o!.id;
}

async function entwurf(mandant: string, kundeId: string, objektId: string | null)
  : Promise<string> {
  return alsApp(sitzung(mandant, admin), (tx) => legeEntwurfAn(alsDienst(tx), {
    kundeId, objektId, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
    zahlungszielTage: 30,
  }));
}

async function setze(mandant: string, art: 'frei' | 'gleich', wer = admin) {
  return alsApp(sitzung(mandant, wer), (tx) =>
    setzeLeistungsortRegel(alsKontext(tx, mandant, wer), art));
}

let verwaltung: string;
let eigentuemer: string;
let objektDerVerwaltung: string;
let objektDesEigentuemers: string;
let objektOhneKunden: string;

beforeEach(async () => {
  f = await seed();
  admin = await konto(`lo-admin-${zufall()}@cse.test`, 'super_admin');
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'admin' and mandant_id is null`);
  await mitglied(admin, f.reinigung, a!.id);
  await mitglied(admin, f.bau, a!.id);

  /* Eine Buchhaltung mit den Rechten der Administration — ohne die Einstellungen. */
  fibu = await konto(`lo-fibu-${zufall()}@cse.test`, null);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Buchhaltung', 'mandant', 'intern') returning id`,
    [f.reinigung, `fibu_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1::uuid, rb.berechtigung_id, $2::uuid, true
       from rolle_berechtigung rb
       join rolle x on x.id = rb.rolle_id and x.schluessel = 'admin' and x.mandant_id is null
       join berechtigung b on b.id = rb.berechtigung_id
      where rb.gewaehrt and b.schluessel not like 'system.einstellung%'`,
    [r!.id, f.reinigung]);
  await mitglied(fibu, f.reinigung, r!.id);

  verwaltung = await kunde(f.reinigung, 'Hausverwaltung Mitte');
  eigentuemer = await kunde(f.reinigung, 'Eigentümergemeinschaft Teststr. 7');
  objektDerVerwaltung = await objekt(f.reinigung, verwaltung);
  objektDesEigentuemers = await objekt(f.reinigung, eigentuemer);
  objektOhneKunden = await objekt(f.reinigung, null);
});
afterAll(schliessen);

describe('V-373 — die Voreinstellung: frei', () => {
  it('ohne Einstellung darf der Leistungsort einem anderen Kunden gehören', async () => {
    const stand = await alsApp(sitzung(f.reinigung, admin), (tx) =>
      leseLeistungsortRegel(alsDienst(tx)));
    expect(stand).toEqual({ regel: { art: 'frei', frage: 'O-933' }, gesetzt: false });
    // Die Hausverwaltung empfängt die Rechnung für das Haus der Eigentümer.
    await expect(entwurf(f.reinigung, verwaltung, objektDesEigentuemers))
      .resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('V-373 — gleich: nur Objekte des Rechnungsempfängers', () => {
  it('setzen schreibt die Einstellung und eine Protokollzeile mit altem und neuem Wert', async () => {
    expect(await setze(f.reinigung, 'gleich')).toEqual({ geaendert: true });
    const [e] = await sql.unsafe<{ wert: { art: string } }[]>(
      `select wert from mandant_einstellung
        where mandant_id = $1 and schluessel = 'rechnung.leistungsort_regel'`, [f.reinigung]);
    expect(e!.wert).toEqual({ art: 'gleich' });
    const protokoll = await sql.unsafe<{ vorher: unknown; nachher: unknown }[]>(
      `select vorher, nachher from audit_log
        where aktion = 'rechnung.leistungsort_regel_gesetzt' and mandant_id = $1`,
      [f.reinigung]);
    expect(protokoll).toEqual([{ vorher: { art: null }, nachher: { art: 'gleich' } }]);

    // Derselbe Wert noch einmal: nichts geändert, keine zweite Zeile.
    expect(await setze(f.reinigung, 'gleich')).toEqual({ geaendert: false });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where aktion = 'rechnung.leistungsort_regel_gesetzt' and mandant_id = $1`,
      [f.reinigung]);
    expect(n!.n).toBe(1);
  });

  it('legeEntwurfAn weist das Objekt eines anderen Kunden ab — das eigene und das ohne Kunden nicht', async () => {
    await setze(f.reinigung, 'gleich');
    await expect(entwurf(f.reinigung, verwaltung, objektDesEigentuemers))
      .rejects.toMatchObject({ name: 'RechnungFehler', grund: 'objekt_passt_nicht' });
    await expect(entwurf(f.reinigung, verwaltung, objektDerVerwaltung))
      .resolves.toMatch(/^[0-9a-f-]{36}$/u);
    await expect(entwurf(f.reinigung, verwaltung, objektOhneKunden))
      .resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('aendereEntwurfKopf befolgt dieselbe Regel', async () => {
    const id = await entwurf(f.reinigung, verwaltung, objektDerVerwaltung);
    await setze(f.reinigung, 'gleich');
    const kopf = {
      objektId: objektDesEigentuemers, auftragId: null, rechnungsart: 'standard',
      leistungVon: '2026-08-01', leistungBis: '2026-08-31', vereinnahmungGeplantAm: null,
      zahlungszielTage: 30, zahlungsmittelCode: null, kopftext: null, fusstext: null,
    };
    await expect(alsApp(sitzung(f.reinigung, admin), (tx) =>
      aendereEntwurfKopf(alsDienst(tx), id, kopf)))
      .rejects.toMatchObject({ name: 'RechnungFehler', grund: 'objekt_passt_nicht' });
    // Zurück auf frei: dieselbe Änderung geht durch.
    await setze(f.reinigung, 'frei');
    await expect(alsApp(sitzung(f.reinigung, admin), (tx) =>
      aendereEntwurfKopf(alsDienst(tx), id, kopf))).resolves.toBeDefined();
  });

  it('die Regel gilt für die Gesellschaft, die sie setzt — nicht für die anderen', async () => {
    await setze(f.reinigung, 'gleich');
    const stand = await alsApp(sitzung(f.bau, admin), (tx) =>
      leseLeistungsortRegel(alsDienst(tx)));
    expect(stand.gesetzt).toBe(false);
    expect(stand.regel.art).toBe('frei');
  });
});

describe('V-373 — wer setzt, wer befolgt', () => {
  it('ohne system.einstellung_verwalten lässt die Datenbank das Setzen nicht zu', async () => {
    await expect(setze(f.reinigung, 'gleich', fibu)).rejects.toThrow(/row-level security/u);
  });

  it('wer die Einstellungen nicht lesen darf, befolgt die Regel trotzdem', async () => {
    await setze(f.reinigung, 'gleich');
    const stand = await alsApp(sitzung(f.reinigung, fibu), (tx) =>
      leseLeistungsortRegel(alsDienst(tx)));
    expect(stand).toEqual({ regel: { art: 'gleich', frage: 'O-933' }, gesetzt: true });
    await expect(alsApp(sitzung(f.reinigung, fibu), (tx) => legeEntwurfAn(alsDienst(tx), {
      kundeId: verwaltung, objektId: objektDesEigentuemers,
      leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
    }))).rejects.toMatchObject({ name: 'RechnungFehler', grund: 'objekt_passt_nicht' });
  });

  it('eine kaputte Zeile macht die Regel weder strenger noch lockerer: es gilt die Voreinstellung', async () => {
    await sql.unsafe(
      `insert into mandant_einstellung (mandant_id, schluessel, wert, beschreibung,
                                        gesetzt_von_grundlage, erstellt_von)
       values ($1, 'rechnung.leistungsort_regel', '{"art":"streng"}'::jsonb, 'Test',
               'Test', $2)`, [f.reinigung, admin]);
    const stand = await alsApp(sitzung(f.reinigung, admin), (tx) =>
      leseLeistungsortRegel(alsDienst(tx)));
    expect(stand).toEqual({ regel: { art: 'frei', frage: 'O-933' }, gesetzt: false });
  });
});
