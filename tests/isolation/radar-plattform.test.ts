/**
 * Der Plattformkatalog und der Registrierungsstand gegen eine echte
 * Datenbank (V-175, RAD-09, O-07, D-669, 0420).
 *
 * Was hier fallen würde, fiele leise: ein Katalog, den nur der Seed füllen
 * kann; eine Plattform, die heute eingetragen wird und die Bekanntmachungen
 * von gestern nie erreicht — genau die, deren Frist schon läuft; ein
 * Registrierungsstand, der in eine fremde Gesellschaft schreibt; eine
 * Warnung, die deshalb nie auslöst.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  PlattformFehler, aenderePlattform, archivierePlattform, bestaetigePlattform, legePlattformAn,
  setzeRegistrierung,
} from '../../src/server/services/radar/plattform.js';
import {
  VorgangFehler, setzePlattformPruefung, setzeVorgangsstand,
} from '../../src/server/services/radar/vorgang.js';

let f: Fixtur;
let chef = '';
let admin = '';
let fremd = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(globaleRolle: string | null): Promise<string> {
  const email = `rp-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Plattformprobe', 'aktiv',
             (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, email, globaleRolle] as never[]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [benutzer, mandant, rolle] as never[]);
}

function kontextAus(tx: postgres.TransactionSql, mandant: string, benutzer: string): SchreibKontext {
  const abfrage = async <T,>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

/** Eine Sitzung im internen Portal, mit zweitem Faktor (`app.ist_super_admin` verlangt ihn). */
function als<T>(
  benutzer: string, mandant: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
    readonly: false, portal: 'intern',
  }, async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(kontextAus(tx, mandant, benutzer));
  });
}

async function bekanntmachung(url: string, tage = 20): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, quell_url,
                                frist_angebot)
     values ('oeffentlichevergabe', $1, 'Unterhaltsreinigung Bezirksamt', 'de', $2, $3,
             now() + ($4 || ' days')::interval)
     returning id`, [`rp-${zufall()}`, `${zufall()}${zufall()}`, url, tage]);
  return a!.id;
}

async function plattformVon(ausschreibung: string): Promise<string | null> {
  const [z] = await sql.unsafe<{ id: string | null }[]>(
    `select vergabeplattform_id::text as id from ausschreibung where id = $1`, [ausschreibung]);
  return z?.id ?? null;
}

async function fehlerVon(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => null, (e: unknown) => e);
}

beforeEach(async () => {
  f = await seed();
  chef = await konto('super_admin');
  await mitglied(chef, f.reinigung, 'admin');
  admin = await konto(null);
  await mitglied(admin, f.reinigung, 'admin');
  fremd = await konto(null);
  await mitglied(fremd, f.security, 'admin');
});
afterAll(schliessen);

describe('(1) den Katalog pflegt die Super-Administration — und nur sie', () => {
  it('eine Mandanten-Administration bekommt einen Satz, keinen Eintrag', async () => {
    const e = await fehlerVon(als(admin, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Plattform ${zufall()}` })));
    expect(e).toBeInstanceOf(PlattformFehler);
    expect((e as PlattformFehler).code).toBe('nur_super_admin');
  });

  it('und der Definer weist sie ebenso ab, wenn jemand an Dienst und Seite vorbei ruft', async () => {
    const e = await fehlerVon(als(admin, f.reinigung, (k) =>
      k.schreibe(`select app.radar_plattform_nachordnen()`)));
    expect(String((e as Error).message)).toMatch(/Super-Administration/u);
  });

  it('die Super-Administration trägt ein — als Platzhalter, bis sie bestätigt', async () => {
    const name = `Vergabemarktplatz ${zufall()}`;
    const { plattformId } = await als(chef, f.reinigung, (k) => legePlattformAn(k, {
      name, betreiber: 'Land Berlin', basisUrl: 'https://vergabe.beispiel.de/',
      registrierungDauerHinweis: 'laut Betreiber einige Werktage',
    }));
    const [z] = await sql.unsafe<{ slug: string; platzhalter: boolean; erforderlich: boolean }[]>(
      `select slug, ist_platzhalter as platzhalter,
              registrierung_erforderlich as erforderlich
         from vergabeplattform where id = $1`, [plattformId]);
    expect(z).toMatchObject({ platzhalter: true, erforderlich: true });
    expect(z!.slug).toMatch(/^vergabemarktplatz-/u);

    await als(chef, f.reinigung, (k) => bestaetigePlattform(k, plattformId));
    const [b] = await sql.unsafe<{ platzhalter: boolean }[]>(
      `select ist_platzhalter as platzhalter from vergabeplattform where id = $1`, [plattformId]);
    expect(b!.platzhalter).toBe(false);

    const [log] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where objekt_id = $1 and aktion in ('radar.plattform_angelegt', 'radar.plattform_bestaetigt')`,
      [plattformId]);
    expect(log!.n).toBe(2);
  });

  it('ein vergebener Kurzname wird ein Satz, kein 23505', async () => {
    const slug = `rp-${zufall()}`;
    await als(chef, f.reinigung, (k) => legePlattformAn(k, { name: 'Erste', slug }));
    const e = await fehlerVon(als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: 'Zweite', slug })));
    expect((e as PlattformFehler).code).toBe('slug_vergeben');
  });
});

describe('(2) eine neue Plattform erreicht auch die Bekanntmachungen von gestern', () => {
  it('schon eingelesen, ohne Plattform — nach dem Eintragen mit Plattform', async () => {
    const host = `vergabe-${zufall()}.example.org`;
    const alt = await bekanntmachung(`https://www.${host}/notice/1`);
    const fremdeAdresse = await bekanntmachung(`https://anders-${zufall()}.example.org/x`);
    expect(await plattformVon(alt)).toBeNull();

    const { plattformId, zugeordnet } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Plattform ${zufall()}`, hostMuster: host }));
    expect(zugeordnet).toBeGreaterThanOrEqual(1);
    expect(await plattformVon(alt)).toBe(plattformId);
    // Eine Adresse, die zu keinem Host passt, bleibt ohne — geraten wird nicht.
    expect(await plattformVon(fremdeAdresse)).toBeNull();

    // Und eine NEUE Bekanntmachung ordnet der Auslöser beim Einlesen selbst zu.
    expect(await plattformVon(await bekanntmachung(`https://${host}/notice/2`))).toBe(plattformId);
  });

  it('ein nachgetragener Hostname ordnet beim Ändern nach — eine vorhandene Zuordnung bleibt', async () => {
    const hostA = `a-${zufall()}.example.org`;
    const hostB = `b-${zufall()}.example.org`;
    const { plattformId: erste } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Erste ${zufall()}`, hostMuster: hostA }));
    const aufA = await bekanntmachung(`https://${hostA}/1`);
    const aufB = await bekanntmachung(`https://${hostB}/1`);
    expect(await plattformVon(aufA)).toBe(erste);
    expect(await plattformVon(aufB)).toBeNull();

    const { plattformId: zweite } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Zweite ${zufall()}` }));
    const e = await als(chef, f.reinigung, (k) =>
      aenderePlattform(k, zweite, { name: 'Zweite, geändert', hostMuster: `${hostA}, ${hostB}` }));
    expect(e.zugeordnet).toBeGreaterThanOrEqual(1);
    expect(await plattformVon(aufB)).toBe(zweite);
    expect(await plattformVon(aufA)).toBe(erste);
  });

  it('archiviert: nichts wird gelöscht, neues wird nicht mehr zugeordnet', async () => {
    const host = `arch-${zufall()}.example.org`;
    const { plattformId } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Archiv ${zufall()}`, hostMuster: host }));
    const vorher = await bekanntmachung(`https://${host}/1`);
    await als(chef, f.reinigung, (k) => archivierePlattform(k, plattformId));
    expect(await plattformVon(vorher)).toBe(plattformId);
    expect(await plattformVon(await bekanntmachung(`https://${host}/2`))).toBeNull();
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from vergabeplattform where id = $1`, [plattformId]);
    expect(z!.n).toBe(1);
  });
});

describe('(3) der Registrierungsstand gehört der Gesellschaft, die ihn setzt', () => {
  async function plattform(): Promise<string> {
    const { plattformId } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Stand ${zufall()}` }));
    return plattformId;
  }

  it('anlegen und ändern ist EINE Zeile — mit Vorher und Nachher im Protokoll', async () => {
    const p = await plattform();
    await als(admin, f.reinigung, (k) => setzeRegistrierung(k, p, {
      status: 'beantragt', benutzerkennung: 'cse-einkauf', verantwortlichBenutzerId: admin,
    }));
    await als(admin, f.reinigung, (k) => setzeRegistrierung(k, p, {
      status: 'registriert', benutzerkennung: 'cse-einkauf', registriertAm: '2026-09-01',
      gueltigBis: '2027-08-31', verantwortlichBenutzerId: admin,
    }));
    const zeilen = await sql.unsafe<{
      status: string; kennung: string; seit: string; bis: string; bestaetigt: boolean;
    }[]>(
      `select status::text as status, benutzerkennung as kennung,
              registriert_am::text as seit, gueltig_bis::text as bis,
              zuletzt_bestaetigt_am is not null as bestaetigt
         from mandant_plattform_registrierung
        where vergabeplattform_id = $1 and mandant_id = $2`, [p, f.reinigung]);
    expect(zeilen).toEqual([{
      status: 'registriert', kennung: 'cse-einkauf', seit: '2026-09-01', bis: '2027-08-31',
      bestaetigt: true,
    }]);
    const [log] = await sql.unsafe<{ vorher: { status: string } | null; nachher: { status: string } }[]>(
      `select vorher, nachher from audit_log where aktion = 'radar.plattform_registrierung'
        order by id desc limit 1`);
    expect(log?.vorher?.status).toBe('beantragt');
    expect(log?.nachher.status).toBe('registriert');
  });

  it('die Warnung greift: ohne Freischaltung zählt die offene Bekanntmachung, danach nicht', async () => {
    const host = `warn-${zufall()}.example.org`;
    const { plattformId } = await als(chef, f.reinigung, (k) =>
      legePlattformAn(k, { name: `Warnung ${zufall()}`, hostMuster: host }));
    await bekanntmachung(`https://${host}/offen`);
    const ohneFreischaltung = async (): Promise<number> => (await als(admin, f.reinigung, (k) =>
      k.abfrage<{ n: number }>(
        `select count(*)::int as n from ausschreibung a
           left join mandant_plattform_registrierung m
                  on m.vergabeplattform_id = a.vergabeplattform_id and m.geloescht_am is null
                 and m.mandant_id = app.aktiver_mandant()
          where a.vergabeplattform_id = $1 and a.frist_angebot > now()
            and coalesce(m.status::text, 'unbekannt') <> 'registriert'`, [plattformId])))[0]!.n;
    expect(await ohneFreischaltung()).toBe(1);
    await als(admin, f.reinigung, (k) => setzeRegistrierung(k, plattformId, {
      status: 'registriert', registriertAm: '2026-09-01' }));
    expect(await ohneFreischaltung()).toBe(0);
  });

  it('eine andere Gesellschaft sieht und ändert diesen Stand nicht (Invariante 3)', async () => {
    const p = await plattform();
    await als(admin, f.reinigung, (k) => setzeRegistrierung(k, p, {
      status: 'registriert', registriertAm: '2026-09-01' }));
    await als(fremd, f.security, (k) => setzeRegistrierung(k, p, { status: 'beantragt' }));
    const zeilen = await sql.unsafe<{ mandant: string; status: string }[]>(
      `select mandant_id::text as mandant, status::text as status
         from mandant_plattform_registrierung where vergabeplattform_id = $1
        order by status`, [p]);
    expect(zeilen).toEqual([
      { mandant: f.security, status: 'beantragt' },
      { mandant: f.reinigung, status: 'registriert' },
    ]);
  });

  it('verantwortlich ist nur, wer hier arbeitet — ein Satz statt eines Auslöserfehlers', async () => {
    const p = await plattform();
    const e = await fehlerVon(als(admin, f.reinigung, (k) => setzeRegistrierung(k, p, {
      status: 'beantragt', verantwortlichBenutzerId: fremd })));
    expect((e as PlattformFehler).code).toBe('verantwortlich_fremd');
  });

  it('„registriert" ohne Datum und eine archivierte Plattform werden abgewiesen', async () => {
    const p = await plattform();
    expect(((await fehlerVon(als(admin, f.reinigung, (k) =>
      setzeRegistrierung(k, p, { status: 'registriert' })))) as PlattformFehler).code)
      .toBe('registriert_ohne_datum');
    await als(chef, f.reinigung, (k) => archivierePlattform(k, p));
    expect(((await fehlerVon(als(admin, f.reinigung, (k) =>
      setzeRegistrierung(k, p, { status: 'beantragt' })))) as PlattformFehler).code)
      .toBe('plattform_unbekannt');
  });
});

describe('(4) die Plattformprüfung am Vorgang', () => {
  it('ohne Vorgang ein Satz; mit Vorgang gespeichert, mit Serverzeit — „unbekannt" ohne', async () => {
    const a = await bekanntmachung(`https://pruef-${zufall()}.example.org/1`);
    const ohne = await fehlerVon(als(admin, f.reinigung, (k) =>
      setzePlattformPruefung(k, a, 'nicht_registriert')));
    expect(ohne).toBeInstanceOf(VorgangFehler);
    expect((ohne as VorgangFehler).code).toBe('kein_vorgang');

    await als(admin, f.reinigung, (k) => setzeVorgangsstand(k, {
      ausschreibungId: a, status: 'geprueft', grund: null }));
    await als(admin, f.reinigung, (k) => setzePlattformPruefung(k, a, 'nicht_registriert'));
    const stand = async () => (await sql.unsafe<{ p: string; am: boolean; status: string }[]>(
      `select plattform_pruefung::text as p, plattform_geprueft_am is not null as am,
              status::text as status
         from ausschreibung_vorgang where ausschreibung_id = $1 and mandant_id = $2`,
      [a, f.reinigung]))[0];
    // Der Stand bleibt, wie er war — die Prüfung setzt keinen.
    expect(await stand()).toEqual({ p: 'nicht_registriert', am: true, status: 'geprueft' });

    await als(admin, f.reinigung, (k) => setzePlattformPruefung(k, a, 'unbekannt'));
    expect(await stand()).toEqual({ p: 'unbekannt', am: false, status: 'geprueft' });

    const falsch = await fehlerVon(als(admin, f.reinigung, (k) =>
      setzePlattformPruefung(k, a, 'vielleicht')));
    expect((falsch as VorgangFehler).code).toBe('plattform');
  });
});
