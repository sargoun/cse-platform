/**
 * **Die Module einer Administration** (AUT-01, V-164, D-658, 0416).
 *
 * `benutzer_mandant.module` wirkt seit 0008 als Schnittmenge in
 * `app.hat_recht_fuer` — und niemand konnte sie setzen. Jede Administration
 * hielt alle Module ihrer Rolle. 0416 baut den einen Weg dorthin und sperrt
 * den Anwendungsweg an der Spalte vorbei.
 *
 * Gemessen wird vor allem, was NICHT geht: das eigene Konto erweitern, ohne
 * Recht, ohne zweiten Faktor, in einer fremden Gesellschaft, an einer Rolle,
 * die keine Administration ist, mit einem Modul, das es nicht gibt — und der
 * Umweg über das UPDATE, das `t_bm_entziehen` (0102) jeder Kontoverwaltung
 * gibt. Seit 0419 (V-168, D-662) auch die Umwege über die ZEILE: entziehen
 * und ohne Liste neu anlegen, wiederbeleben, umwidmen (§4).
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { eigeneDatenbank } from './eigene-datenbank.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ModulZuweisungFehler, administrationenMitModulen, modulKatalog, setzeMitgliedschaftModule,
} from '../../src/server/services/system/mitgliedschaft-module.js';

let f: Fixtur;
/** Hält `system.module_zuweisen` — die Plattformverwaltung. */
let chef = '';
/** Eine Administration der Reinigung: das Ziel. */
let admin = '';
let adminBm = '';
/** Eine Leitung der Reinigung — keine Administration. */
let leitungBm = '';
/** Eine Administration der Security: fremde Gesellschaft. */
let fremdBm = '';

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
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<string> {
  const [bm] = await sql.unsafe<{ id: string }[]>(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))
     returning id`, [benutzer, mandant, rolle]);
  return bm!.id;
}

function kontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  optionen: { aal?: 'aal1' | 'aal2'; scope?: 'mandant' | 'gruppe' } = {},
): Promise<T> {
  return alsApp({
    scope: optionen.scope ?? 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
    benutzerId, portal: 'intern', readonly: false, aal: optionen.aal ?? 'aal2',
  }, (tx) => fn(kontext(tx, benutzerId))) as Promise<T>;
}

async function setze(
  benutzerId: string, bm: string, module: readonly string[] | null,
  optionen: { aal?: 'aal1' | 'aal2'; scope?: 'mandant' | 'gruppe' } = {},
): Promise<boolean> {
  return (await als(benutzerId, (k) => setzeMitgliedschaftModule(
    k, { mitgliedschaftId: bm, module }), optionen)).geaendert;
}

async function grund(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (fehler) {
    if (fehler instanceof ModulZuweisungFehler) return fehler.grund;
    throw fehler;
  }
  return 'kein_fehler';
}

async function recht(benutzerId: string, schluessel: string): Promise<boolean> {
  return als(benutzerId, async (k) => {
    const [z] = await k.abfrage<{ ok: boolean }>(
      `select app.hat_recht($1, $2::uuid) as ok`, [schluessel, f.reinigung]);
    return z!.ok;
  });
}

/**
 * Bindet `system.module_zuweisen` fuer die Rolle `admin` in der Reinigung —
 * so, wie O-76 es einmal tun koennte — und nimmt es danach wieder.
 */
async function mitAdminRecht<T>(fn: () => Promise<T>): Promise<T> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'admin' and mandant_id is null),
             (select id from berechtigung where schluessel = 'system.module_zuweisen'),
             $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.reinigung]);
  try {
    return await fn();
  } finally {
    await sql.unsafe(
      `update rolle_berechtigung set gewaehrt = false
        where rolle_id = (select id from rolle where schluessel = 'admin' and mandant_id is null)
          and berechtigung_id = (select id from berechtigung
                                  where schluessel = 'system.module_zuweisen')
          and mandant_id = $1`, [f.reinigung]);
  }
}

async function module(bm: string): Promise<readonly string[] | null> {
  const [z] = await sql.unsafe<{ module: string[] | null }[]>(
    `select module from benutzer_mandant where id = $1`, [bm]);
  return z!.module;
}

beforeAll(async () => {
  f = await seed();
  chef = await konto('modul-chef@test.invalid', true);
  await mitglied(chef, f.reinigung, 'admin');
  admin = await konto('modul-admin@test.invalid');
  adminBm = await mitglied(admin, f.reinigung, 'admin');
  const leitung = await konto('modul-leitung@test.invalid');
  leitungBm = await mitglied(leitung, f.reinigung, 'leitung');
  const fremd = await konto('modul-fremd@test.invalid');
  fremdBm = await mitglied(fremd, f.security, 'admin');
});
afterAll(schliessen);

describe('(1) die Schnittmenge wirkt — und jetzt laesst sie sich setzen', () => {
  it('admin mit module = {crm}: crm.lesen ja, finanzen.lesen nein', async () => {
    expect(await recht(admin, 'finanzen.lesen'), 'vorher: alle Module der Rolle').toBe(true);

    expect(await setze(chef, adminBm, ['crm'])).toBe(true);
    expect(await module(adminBm)).toEqual(['crm']);
    expect(await recht(admin, 'crm.lesen')).toBe(true);
    expect(await recht(admin, 'finanzen.lesen')).toBe(false);
    expect(await recht(admin, 'system.benutzer_lesen'),
      'auch System gilt nur, wenn es gewaehlt ist').toBe(false);
  });

  it('dieselbe Menge noch einmal: unveraendert, kein Fehler', async () => {
    expect(await setze(chef, adminBm, ['crm'])).toBe(false);
  });

  it('sortiert und ohne Doppel gespeichert — dieselbe Menge ist dieselbe Zeile', async () => {
    expect(await setze(chef, adminBm, ['finanzen', 'crm', 'crm'])).toBe(true);
    expect(await module(adminBm)).toEqual(['crm', 'finanzen']);
    expect(await setze(chef, adminBm, ['crm', 'finanzen'])).toBe(false);
  });

  it('NULL heisst wieder „alle Module der Rolle"', async () => {
    expect(await setze(chef, adminBm, null)).toBe(true);
    expect(await module(adminBm)).toBeNull();
    expect(await recht(admin, 'finanzen.lesen')).toBe(true);
  });

  it('jede Aenderung steht im Protokoll, mit vorher und nachher', async () => {
    await setze(chef, adminBm, ['bericht', 'crm']);
    const [z] = await sql.unsafe<{
      akteur_id: string; vorher: { module: string[] | null }; nachher: { module: string[] };
    }[]>(
      `select akteur_id::text as akteur_id, vorher, nachher from audit_log
        where aktion = 'system.module_zugewiesen' and objekt_id = $1
        order by id desc limit 1`, [adminBm]);
    expect(z!.akteur_id).toBe(chef);
    expect(z!.vorher.module).toBeNull();
    expect(z!.nachher.module).toEqual(['bericht', 'crm']);
    await setze(chef, adminBm, null);
  });

  it('die Auswahl der Seite kommt aus dem Katalog', async () => {
    const katalog = await als(chef, (k) => modulKatalog(k));
    expect(katalog).toContain('crm');
    expect(katalog).toContain('finanzen');
    expect([...katalog].sort()).toEqual(katalog);
  });

  it('die Uebersicht nennt jede Administration dieser Gesellschaft mit ihrer Liste', async () => {
    await setze(chef, adminBm, ['crm']);
    const liste = await als(chef, (k) => administrationenMitModulen(k));
    const ziel = liste.find((a) => a.mitgliedschaftId === adminBm);
    expect(ziel?.benutzerId).toBe(admin);
    expect(ziel?.module).toEqual(['crm']);
    expect(liste.some((a) => a.mitgliedschaftId === leitungBm), 'keine Leitung').toBe(false);
    expect(liste.some((a) => a.mitgliedschaftId === fremdBm), 'keine fremde Gesellschaft')
      .toBe(false);
    await setze(chef, adminBm, null);
  });
});

describe('(2) was NICHT geht', () => {
  it('ein Modul, das es nicht gibt', async () => {
    expect(await grund(setze(chef, adminBm, ['crm', 'lohnbuchhaltung'])))
      .toBe('unbekanntes_modul');
    expect(await module(adminBm)).toBeNull();
  });

  it('eine leere Liste — dafuer gibt es den Entzug', async () => {
    expect(await grund(setze(chef, adminBm, []))).toBe('keine_module');
  });

  it('eine Rolle, die keine Administration ist', async () => {
    expect(await grund(setze(chef, leitungBm, ['crm']))).toBe('nur_admin');
  });

  it('eine Mitgliedschaft einer fremden Gesellschaft sieht aus wie keine', async () => {
    expect(await grund(setze(chef, fremdBm, ['crm']))).toBe('nicht_gefunden');
    expect(await grund(setze(chef, '00000000-0000-4000-8000-000000000000', ['crm'])))
      .toBe('nicht_gefunden');
  });

  it('ohne system.module_zuweisen — auch nicht fuer eine Administration', async () => {
    const zweiter = await konto('modul-zweiter@test.invalid');
    await mitglied(zweiter, f.reinigung, 'admin');
    expect(await grund(setze(zweiter, adminBm, ['crm']))).toBe('nicht_erlaubt');
  });

  it('ohne zweiten Faktor nicht (K-15)', async () => {
    expect(await grund(setze(chef, adminBm, ['crm'], { aal: 'aal1' }))).toBe('nicht_erlaubt');
  });

  it('nicht in der Gruppenansicht (Invariante 10)', async () => {
    expect(await grund(setze(chef, adminBm, ['crm'], { scope: 'gruppe' })))
      .toBe('nicht_erlaubt');
  });

  it('nicht am eigenen Konto — wer seine Liste erweitern kann, hat keine', async () => {
    await mitAdminRecht(async () => {
      expect(await grund(setze(admin, adminBm, null))).toBe('eigenes_konto');
    });
  });

  /**
   * **Niemand vergibt mehr, als er selbst haelt.** Zwei beschraenkte
   * Administrationen mit `system.module_zuweisen` koennten einander sonst
   * ueber Kreuz alles geben — die Selbstsperre allein haelt das nicht auf.
   */
  it('eine beschraenkte Administration vergibt nur ihre eigenen Module', async () => {
    const dritter = await konto('modul-dritter@test.invalid');
    const dritterBm = await mitglied(dritter, f.reinigung, 'admin');
    await setze(chef, dritterBm, ['crm', 'system']);
    await setze(chef, adminBm, ['crm']);
    await mitAdminRecht(async () => {
      expect(await grund(setze(dritter, adminBm, ['finanzen']))).toBe('ueber_eigene_module');
      expect(await grund(setze(dritter, adminBm, ['crm', 'finanzen'])))
        .toBe('ueber_eigene_module');
      expect(await grund(setze(dritter, adminBm, null)), '„alle" nur, wer alle haelt')
        .toBe('ueber_eigene_module');
      expect(await module(adminBm), 'nichts geschrieben').toEqual(['crm']);
      /* Innerhalb der eigenen Liste geht es — die Regel sperrt nur das Mehr. */
      expect(await setze(dritter, adminBm, ['crm', 'system'])).toBe(true);
      expect(await module(adminBm)).toEqual(['crm', 'system']);
    });
    await setze(chef, adminBm, null);
  });

  it('die Plattformverwaltung (globale Rolle) ist nicht beschraenkt', async () => {
    /* `chef` traegt eine Mitgliedschaft MIT Liste — die globale Rolle gilt trotzdem. */
    const chefBm = await sql.unsafe<{ id: string }[]>(
      `select id from benutzer_mandant where benutzer_id = $1 and mandant_id = $2`,
      [chef, f.reinigung]);
    await sql.unsafe(`update benutzer_mandant set module = '{crm}' where id = $1`,
      [chefBm[0]!.id]);
    try {
      expect(await setze(chef, adminBm, ['finanzen'])).toBe(true);
      expect(await setze(chef, adminBm, null)).toBe(true);
    } finally {
      await sql.unsafe(`update benutzer_mandant set module = null where id = $1`,
        [chefBm[0]!.id]);
    }
  });

  /**
   * **Der Umweg.** `t_bm_entziehen` (0102) gibt jeder Kontoverwaltung ein
   * UPDATE auf die ganze Zeile. Ohne den Ausloeser aus 0416 setzte eine
   * Administration mit `system.benutzer_verwalten` ihre eigene Liste mit
   * einer Anweisung auf NULL.
   */
  it('kein direktes UPDATE der Spalte aus dem Anwendungsweg', async () => {
    await setze(chef, adminBm, ['crm']);
    await expect(als(chef, (k) => k.schreibe(
      `update benutzer_mandant set module = null where id = $1`, [adminBm])))
      .rejects.toThrow(/mitgliedschaft_module_setzen/u);
    expect(await module(adminBm)).toEqual(['crm']);
    await setze(chef, adminBm, null);
  });

  /**
   * **Der INSERT-Zweig des Ausloesers — und nur er** (V-168). Hier stand ein
   * INSERT fuer `f.bau` mit `.rejects.toThrow()` ohne Meldung: die Sitzung
   * steht in der Reinigung, `t_bm_schreiben` verlangt den aktiven Mandanten,
   * und welcher Grund den Wurf ausloeste, sagte die Pruefung nicht. Jetzt: im
   * AKTIVEN Mandanten, fuer ein Konto ohne lebende Mitgliedschaft dort, mit
   * einer Rolle, die 0419 nicht sperrt — und die Gegenprobe ohne Liste geht
   * durch. Es bleibt nur die Liste als Grund.
   */
  it('kein INSERT mit Liste aus dem Anwendungsweg — die Gegenprobe ohne Liste geht durch', async () => {
    const neu = await konto('modul-insert@test.invalid');
    const LEITUNG = `(select id from rolle where schluessel = 'leitung' and mandant_id is null)`;
    await expect(als(chef, (k) => k.schreibe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
       values ($1, $2, ${LEITUNG}, '{crm}')`, [neu, f.reinigung])))
      .rejects.toThrow(/mitgliedschaft_module_setzen/u);
    await als(chef, (k) => k.schreibe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, ${LEITUNG})`, [neu, f.reinigung]));
    const [z] = await sql.unsafe<{ module: string[] | null }[]>(
      `select module from benutzer_mandant
        where benutzer_id = $1 and mandant_id = $2 and entzogen_am is null`, [neu, f.reinigung]);
    expect(z, 'die Gegenprobe legt die Mitgliedschaft an').toBeDefined();
    expect(z!.module).toBeNull();
  });

  it('der Ausloeser prueft auch Seed und Migration — ein falsches Modul kommt nirgends hinein', async () => {
    await expect(sql.unsafe(
      `update benutzer_mandant set module = '{nichtda}' where id = $1`, [adminBm]))
      .rejects.toThrow(/Unbekannte Module/u);
  });
});

/**
 * **Der Seed fuehrt es vor** (Definition of done): die Vertriebsadministration
 * der Reinigung traegt eine Liste, und die Rechte folgen ihr — am ECHTEN
 * Seed, nicht an einer Fixtur dieser Datei.
 */
describe('(3) der Seed: admin.vertrieb haelt nur seine Module', () => {
  const eigen = eigeneDatenbank('cse_modul_seed');
  let benutzer = '';
  let reinigung = '';

  beforeAll(async () => {
    eigen.baueAuf();
    const [z] = await eigen.sql<{ id: string; mandant_id: string; module: string[] | null }[]>`
      select b.id, bm.mandant_id, bm.module
        from benutzer b
        join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
       where b.email = 'admin.vertrieb@cse-gruppe.de'`;
    expect(z, 'Seed-Konto admin.vertrieb fehlt').toBeDefined();
    expect(z!.module).toEqual(
      ['angebot', 'auftrag', 'bericht', 'crm', 'kalkulation', 'katalog', 'objekt']);
    benutzer = z!.id;
    reinigung = z!.mandant_id;
  }, 240_000);

  async function haelt(schluessel: string): Promise<boolean> {
    return eigen.alsApp({
      scope: 'mandant', mandantId: reinigung, mandantIds: [reinigung], benutzerId: benutzer,
      portal: 'intern', readonly: false, aal: 'aal2',
    }, async (tx) => {
      const [z] = (await tx.unsafe(`select app.hat_recht($1, $2::uuid) as ok`,
        [schluessel, reinigung])) as unknown as { ok: boolean }[];
      return z!.ok;
    });
  }

  it.each(['crm.lesen', 'angebot.schreiben', 'auftrag.lesen', 'objekt.lesen'])(
    'haelt %s', async (schluessel) => {
      expect(await haelt(schluessel)).toBe(true);
    });

  it.each(['finanzen.lesen', 'personal.lesen', 'system.benutzer_lesen', 'zeit.lesen'])(
    'haelt %s NICHT — das Modul ist nicht zugewiesen', async (schluessel) => {
      expect(await haelt(schluessel)).toBe(false);
    });
});

/**
 * **Keine Administration am Anwendungsweg vorbei** (V-168, D-662, 0419).
 *
 * Der Ausloeser aus 0416 sperrt nur das SETZEN einer Liste. Mit
 * `system.benutzer_verwalten` gab es drei Umwege zu einer Administration mit
 * allen Modulen der Rolle — ohne `system.module_zuweisen` und ohne die Decke
 * der eigenen Module: entziehen und ohne Liste neu anlegen, eine entzogene
 * wiederbeleben, eine andere Mitgliedschaft umwidmen. Heute nimmt sie kein
 * Code; die zweite Linie soll halten, wenn einmal einer es tut.
 */
describe('(4) keine Administration am Anwendungsweg vorbei (0419)', () => {
  const ADMIN = `(select id from rolle where schluessel = 'admin' and mandant_id is null)`;
  const WEG = /verwaltungskonto_einladen/u;

  async function lebt(bm: string): Promise<boolean> {
    const [z] = await sql.unsafe<{ lebt: boolean }[]>(
      `select entzogen_am is null as lebt from benutzer_mandant where id = $1`, [bm]);
    return z!.lebt;
  }

  it('entziehen und ohne Liste neu anlegen hebt die Beschraenkung nicht auf', async () => {
    await setze(chef, adminBm, ['crm']);
    await expect(als(chef, async (k) => {
      await k.schreibe(
        `update benutzer_mandant set entzogen_am = now(), entzugsgrund = 'Umweg'
          where id = $1`, [adminBm]);
      await k.schreibe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
         values ($1, $2, ${ADMIN})`, [admin, f.reinigung]);
    })).rejects.toThrow(WEG);
    /* Die Transaktion ist zurueckgerollt: die Zeile lebt, die Beschraenkung steht. */
    expect(await lebt(adminBm)).toBe(true);
    expect(await module(adminBm)).toEqual(['crm']);
    expect(await recht(admin, 'finanzen.lesen')).toBe(false);
    await setze(chef, adminBm, null);
  });

  it('eine entzogene Administration laesst sich nicht wiederbeleben', async () => {
    const frueher = await konto('modul-frueher@test.invalid');
    const [bm] = await sql.unsafe<{ id: string }[]>(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, entzogen_am, entzugsgrund)
       values ($1, $2, ${ADMIN}, now(), 'frueher') returning id`, [frueher, f.reinigung]);
    await expect(als(chef, (k) => k.schreibe(
      `update benutzer_mandant set entzogen_am = null, entzugsgrund = null where id = $1`,
      [bm!.id]))).rejects.toThrow(WEG);
    expect(await lebt(bm!.id)).toBe(false);
  });

  it('eine Leitung wird nicht per UPDATE zur Administration', async () => {
    await expect(als(chef, (k) => k.schreibe(
      `update benutzer_mandant set rolle_id = ${ADMIN} where id = $1`, [leitungBm])))
      .rejects.toThrow(WEG);
    const [z] = await sql.unsafe<{ schluessel: string }[]>(
      `select r.schluessel from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
        where bm.id = $1`, [leitungBm]);
    expect(z!.schluessel).toBe('leitung');
  });

  it('auch die Plattformverwaltung legt eine Administration nicht direkt an', async () => {
    const neu = await konto('modul-direkt@test.invalid');
    await expect(als(chef, (k) => k.schreibe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1, $2, ${ADMIN})`,
      [neu, f.reinigung]))).rejects.toThrow(WEG);
  });

  it('entziehen bleibt moeglich, und eine lebende Administration laesst sich weiter pflegen', async () => {
    const weg = await konto('modul-weg@test.invalid');
    const bm = await mitglied(weg, f.reinigung, 'admin');
    await als(chef, (k) => k.schreibe(
      `update benutzer_mandant set gueltig_bis = '2099-12-31' where id = $1`, [bm]));
    await als(chef, (k) => k.schreibe(
      `update benutzer_mandant set entzogen_am = now(), entzugsgrund = 'Probe' where id = $1`,
      [bm]));
    const [z] = await sql.unsafe<{ gueltig_bis: string }[]>(
      `select gueltig_bis::text as gueltig_bis from benutzer_mandant where id = $1`, [bm]);
    expect(z!.gueltig_bis).toBe('2099-12-31');
    expect(await lebt(bm)).toBe(false);
  });

  it('die Sperre gilt dem Anwendungsweg — der Eigentuemer (Seed, Migration) legt weiter an', async () => {
    const seedKonto = await konto('modul-seedweg@test.invalid');
    expect(await lebt(await mitglied(seedKonto, f.reinigung, 'admin'))).toBe(true);
  });
});
