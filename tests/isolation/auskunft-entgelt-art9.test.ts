/**
 * Die Art.-15-Auskunft liest den internen Stundensatz und — auf ausdrückliche
 * Mitgabe — die Art der Abwesenheiten (V-332, O-642, O-643, D-855).
 *
 * **Der Befund.** Beide Angaben fehlten still: der Stundensatz ist `cse_app`
 * entzogen (K-05), die Art einer Abwesenheit auch (Art. 9, 0073); die
 * Auskunft nannte Anstellung und Abwesenheiten ohne sie.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Mit `personal.entgelt_lesen` steht jeder datierte Satz in Euro da —
 *     und ohne das Recht ist der Abschnitt gesperrt, die Auskunft
 *     unvollständig, nicht still lückenhaft.
 *  2. Die Art der Abwesenheiten steht ohne Mitgabe als „nicht mitgegeben" da
 *     (nicht gesperrt, nicht leer, die Auskunft vollständig); mit Mitgabe
 *     stehen Art, AU-Tatsache und Bemerkung darin; mit Mitgabe ohne
 *     `zeit.abwesenheit_grund_lesen` ist der Abschnitt gesperrt.
 *  3. Jeder Abruf steht im Protokoll — einmal je Abschnitt, mit dem Zweck.
 *  4. Am Dienst vorbei: ohne das Fachrecht werfen beide Definer 42501.
 *  5. Die elf Abschnitte des Personenzweigs (V-334, O-648, D-856) stehen als
 *     eigene Abschnitte da — der Sammelabschnitt „offen" ist weg —, lesen
 *     echte Zeilen und geben keine Geheimnisse aus.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { ladeZuordnung } from '../../src/server/services/datenschutz/anfrage.js';
import {
  ART9_ZURUECKGEHALTEN, erstelleAuskunft, type Auskunft, type AuskunftOptionen,
} from '../../src/server/services/datenschutz/auskunft.js';
import { cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';

let f: Fixtur;
let dsb = '';     // super_admin — hält jedes Recht
let schmal = '';  // leitung + Auskunftsrecht — kein Entgelt, kein Grund
let anfrage = '';

async function konto(email: string, global: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $2, 'aktiv',
             case when $3::text is null then null
                  else (select id from rolle where schluessel = $3 and mandant_id is null) end)`,
    [u!.id, email, global]);
  return u!.id;
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

function imKontext<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId, portal: 'intern', readonly: false },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(alsKontext(tx, benutzerId));
    }) as Promise<T>;
}

function auskunft(wer: string, optionen: AuskunftOptionen = {}): Promise<Auskunft> {
  return imKontext(wer, async (k) => {
    const z = await ladeZuordnung(k as LeseKontext, null, anfrage);
    return erstelleAuskunft(k as LeseKontext, anfrage, z, new Date(), optionen);
  });
}

const abschnitt = (a: Auskunft, schluessel: string) => {
  const s = a.abschnitte.find((x) => x.schluessel === schluessel);
  expect(s, schluessel).toBeDefined();
  return s!;
};

beforeAll(async () => {
  f = await seed();
  dsb = await konto('dsb@auskunft.test', 'super_admin');
  schmal = await konto('schmal@auskunft.test');
  for (const [b, rolle] of [[dsb, 'admin'], [schmal, 'leitung']] as const) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
      [b, f.reinigung, rolle]);
  }
  // `schmal` bekommt das Auskunftsrecht — und weder Entgelt noch Grund.
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = 'datenschutz.auskunft_erstellen'), $1, true)`,
    [f.reinigung]);

  // Zwei datierte Sätze an Fatimas Reinigungs-Beschäftigung.
  await sql.unsafe(
    `insert into anstellung_kondition (mandant_id, anstellung_id, gilt_ab, gilt_bis, stundensatz_intern_cent)
     values ($1, $2, '2025-01-01', '2025-12-31', 1450), ($1, $2, '2026-01-01', null, 1575)`,
    [f.reinigung, f.fatimaReinigung]);
  // Eine Krankheit mit AU und Bemerkung — ein Gesundheitsdatum.
  await sql.unsafe(
    `insert into abwesenheit (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
                              tage_angerechnet, status, au_bescheinigung_vorliegt, au_bis, bemerkung)
     values ($1, $2, (select id from abwesenheitsart where schluessel = 'krankheit' and mandant_id is null),
             '2026-03-02', '2026-03-04', 3, 'erfasst', true, '2026-03-04', 'AU per Post')`,
    [f.reinigung, f.fatimaReinigung]);

  const [a] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage (mandant_id, art, name, email, person_id)
     values ($1, 'auskunft', 'Fatima Yildiz', 'fatima@auskunft.test', $2) returning id`,
    [f.reinigung, f.fatima])) as unknown as { id: string }[];
  anfrage = a!.id;
});
afterAll(schliessen);

describe('(1) der interne Stundensatz', () => {
  it('mit dem Recht: jeder datierte Satz in Euro', async () => {
    const a = await auskunft(dsb);
    const s = abschnitt(a, 'entgelt');
    expect(s.gesperrt).toBe(false);
    expect(s.kopf).toEqual(['Personalnummer', 'Gilt ab', 'Gilt bis', 'Stundensatz (intern)', 'Quelle']);
    expect(s.zeilen.map((z) => z[3])).toEqual([
      formatiereGeld(cent(1450n)), formatiereGeld(cent(1575n)),
    ]);
    expect(s.zeilen.map((z) => z[4])).toEqual(['Kondition', 'Kondition']);
    expect(a.vollstaendig).toBe(true);
  });

  it('ohne das Recht: gesperrt, und die Auskunft ist unvollständig', async () => {
    const a = await auskunft(schmal);
    const s = abschnitt(a, 'entgelt');
    expect(s.gesperrt).toBe(true);
    expect(s.zeilen).toEqual([]);
    expect(a.fehlendeRechte).toContain('personal.entgelt_lesen');
    expect(a.vollstaendig).toBe(false);
  });
});

describe('(2) die Art der Abwesenheiten — nur auf ausdrückliche Mitgabe', () => {
  it('ohne Mitgabe: benannt, nicht gesperrt, nicht gelesen — und ihr Recht fehlt nicht', async () => {
    const a = await auskunft(dsb);
    const s = abschnitt(a, 'abwesenheitsgrund');
    expect(s.zurueckgehalten).toBe(ART9_ZURUECKGEHALTEN);
    expect(s.gesperrt).toBe(false);
    expect(s.zeilen).toEqual([]);
    expect(a.art9Mitgegeben).toBe(false);
    const ohne = await auskunft(schmal);
    expect(ohne.fehlendeRechte).not.toContain('zeit.abwesenheit_grund_lesen');
  });

  it('mit Mitgabe: Art, AU-Tatsache und Bemerkung stehen darin', async () => {
    const a = await auskunft(dsb, { art9: true });
    const s = abschnitt(a, 'abwesenheitsgrund');
    expect(s.zurueckgehalten).toBeNull();
    expect(a.art9Mitgegeben).toBe(true);
    const zeile = s.zeilen.find((z) => z.includes('Krankheit'));
    expect(zeile, 'die Krankheit steht da').toBeDefined();
    expect(zeile![s.kopf.indexOf('AU-Bescheinigung')]).toBe('ja');
    expect(zeile![s.kopf.indexOf('Bemerkung')]).toBe('AU per Post');
    // Und die Prüfsumme unterscheidet die zwei Auskünfte.
    expect(a.sha256).not.toBe((await auskunft(dsb)).sha256);
  });

  it('mit Mitgabe, aber ohne das Recht: gesperrt', async () => {
    const a = await auskunft(schmal, { art9: true });
    expect(abschnitt(a, 'abwesenheitsgrund').gesperrt).toBe(true);
    expect(a.fehlendeRechte).toContain('zeit.abwesenheit_grund_lesen');
  });
});

describe('(3) jeder Abruf steht im Protokoll', () => {
  it('Entgelt und Grund — je einmal, an der Person, mit dem Zweck', async () => {
    const vorher = await sql.unsafe<{ aktion: string; n: number }[]>(
      `select aktion, count(*)::int as n from audit_log
        where objekt_typ = 'person' and objekt_id = $1
          and aktion in ('entgelt.gelesen', 'personal.abwesenheitsgrund_gelesen')
        group by aktion`, [f.fatima]);
    await auskunft(dsb, { art9: true });
    const nachher = await sql.unsafe<{ aktion: string; n: number; zweck: string | null }[]>(
      `select aktion, count(*)::int as n,
              max(coalesce(nachher ->> 'zweck', nachher ->> 'rechtsgrundlage')) as zweck
         from audit_log
        where objekt_typ = 'person' and objekt_id = $1
          and aktion in ('entgelt.gelesen', 'personal.abwesenheitsgrund_gelesen')
        group by aktion order by aktion`, [f.fatima]);
    const zahl = (z: readonly { aktion: string; n: number }[], aktion: string) =>
      z.find((x) => x.aktion === aktion)?.n ?? 0;
    expect(zahl(nachher, 'entgelt.gelesen') - zahl(vorher, 'entgelt.gelesen')).toBe(1);
    expect(zahl(nachher, 'personal.abwesenheitsgrund_gelesen')
      - zahl(vorher, 'personal.abwesenheitsgrund_gelesen')).toBe(1);
    expect(nachher.every((z) => z.zweck === 'Art. 15 DSGVO')).toBe(true);
  });
});

describe('(4) am Dienst vorbei', () => {
  it('ohne das Fachrecht werfen beide Definer 42501', async () => {
    for (const funktion of ['app.auskunft_entgelt', 'app.auskunft_abwesenheitsgruende']) {
      const e = await imKontext(schmal, (k) => k.abfrage(`select * from ${funktion}($1::uuid)`, [f.fatima]))
        .then(() => null, (x: unknown) => x as { code?: string });
      expect(e?.code, funktion).toBe('42501');
    }
  });
});

describe('(5) die elf Abschnitte des Personenzweigs (V-334, D-856)', () => {
  const ELF = [
    'einsatz_zuordnung', 'zeitnachweis', 'team_mitglied', 'bewacher_eintrag',
    'arbeitszeit_verstoss', 'planungs_konflikt', 'nachweis_warnung', 'da_pflicht',
    'benutzer', 'checkin_token', 'offline_ereignis',
  ];

  it('jeder steht als eigener Abschnitt da, keiner gesperrt — und der Sammelabschnitt ist weg', async () => {
    const a = await auskunft(dsb);
    const schluessel = a.abschnitte.map((x) => x.schluessel);
    for (const s of ELF) {
      expect(schluessel, s).toContain(s);
      expect(abschnitt(a, s).gesperrt, s).toBe(false);
      expect(abschnitt(a, s).offen, s).toBeNull();
    }
    expect(schluessel).not.toContain('personenzweig_offen');
    expect(a.abschnitte.filter((x) => x.offen === 'O-648')).toEqual([]);
  });

  it('er liest echte Zeilen — eine Teamzugehörigkeit mit dem Namen des Teams', async () => {
    const [t] = await sql.unsafe<{ id: string }[]>(
      `insert into team (mandant_id, name) values ($1, 'Glasreinigung Nord') returning id`,
      [f.reinigung]);
    await sql.unsafe(
      `insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id, rolle)
       values ($1, $2, $3, $4, 'Vorarbeiterin')`, [f.reinigung, t!.id, f.fatimaReinigung, f.fatima]);
    const s = abschnitt(await auskunft(dsb), 'team_mitglied');
    expect(s.zeilen.map((z) => [z[0], z[1]])).toContainEqual(['Glasreinigung Nord', 'Vorarbeiterin']);
  });

  it('keine Geheimnisse: kein Markenwert, keine Rohnutzlast', () => {
    return auskunft(dsb).then((a) => {
      const marke = abschnitt(a, 'checkin_token');
      expect(marke.kopf.join(' ')).not.toMatch(/hash|Marke\b|token/iu);
      const offline = abschnitt(a, 'offline_ereignis');
      expect(offline.kopf.join(' ')).not.toMatch(/Nutzlast/iu);
    });
  });

  it('ohne Fachrecht gesperrt — hier ohne die Check-in-Verwaltung', async () => {
    // Die Leitung hält alle neun Fachrechte; in DIESER Gesellschaft entzogen (schlägt die Vorgabe).
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = 'zeit.checkin_verwalten'), $1, false)`,
      [f.reinigung]);
    const a = await auskunft(schmal);
    const gesperrt = a.abschnitte.filter((x) => ELF.includes(x.schluessel) && x.gesperrt)
      .map((x) => x.schluessel);
    expect(gesperrt).toEqual(['checkin_token']);
    expect(abschnitt(a, 'checkin_token').zeilen).toEqual([]);
    expect(a.fehlendeRechte).toContain('zeit.checkin_verwalten');
    expect(a.vollstaendig).toBe(false);
  });
});
