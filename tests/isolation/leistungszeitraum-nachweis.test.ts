/**
 * Der Leistungszeitraum aus den gegengezeichneten Leistungsnachweisen gegen
 * eine echte Datenbank (V-337, O-54, D-838).
 *
 * Die Nachweise entstehen über den echten Weg — Entwurf, Vorlage,
 * Unterschrift des Kunden (`reinigung/leistungsnachweis.ts`) —, denn erst die
 * Unterschrift setzt `signiert`, und nur ein unterschriebener Nachweis zählt.
 *
 *  1. Zwei Nachweise über die Monatsgrenze: die Augustzeile trägt die Tage
 *     des ersten, die Septemberzeile die des zweiten — beschnitten, nie über
 *     den Monat hinaus.
 *  2. Ein Monat ohne unterschriebenen Nachweis blockiert, und nur er: ein
 *     vorgelegter Nachweis zählt nicht, einer ohne Leistungszeile auch nicht.
 *  3. Der beschnittene August sperrt den September nicht (V-207): die zweite
 *     Rechnung über den September entsteht.
 *  4. Eine zeilenbezogene Vereinbarung zählt nur die Nachweise ihrer Zeile.
 *  5. Ohne das Recht, Nachweise zu lesen, sagt der Befund das.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { legeEntwurfAn, type Abfrage } from '../../src/server/services/finanz/rechnung.js';
import {
  berechneAbrechnung, bestueckeAusAbrechnungsart,
} from '../../src/server/services/finanz/abrechnungsart/index.js';
import {
  bereiteUnterschriftVor, erstelleEntwurf, legeVor, signiere,
} from '../../src/server/services/reinigung/leistungsnachweis.js';

let f: Fixtur;
let chef: string;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function kontext(tx: postgres.TransactionSql, mandant: string, benutzer: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

function sitzung(mandantId: string, benutzerId = chef) {
  return { scope: 'mandant' as const, mandantId, benutzerId, portal: 'intern' as const, readonly: false };
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

interface Bau {
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly unterhalt: string;
  readonly glas: string;
}

/** Ein Auftrag mit zwei Leistungszeilen auf einem Objekt der Reinigung. */
async function baue(): Promise<Bau> {
  const m = f.reinigung;
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Hausverwaltung Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [m, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Mitte','Teststr. 7','10115','Berlin') returning id`,
    [m, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'dauerauftrag','aktiv','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [m, `AU-${zufall()}`, k!.id, o!.id, chef] as never[]);
  const zeile = async (nr: number, bezeichnung: string): Promise<string> => {
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                     bezeichnung, einheit, einzelpreis_cent, steuersatz_bp,
                                     steuer_kennzeichen, gueltig_ab)
       values ($1,$2,$3,$4,$5,'monat',189000,1900,'regelsatz','2026-01-01') returning id`,
      [m, a!.id, nr, o!.id, bezeichnung] as never[]);
    return l!.id;
  };
  return {
    kunde: k!.id, objekt: o!.id, auftrag: a!.id,
    unterhalt: await zeile(1, 'Unterhaltsreinigung'), glas: await zeile(2, 'Glasreinigung'),
  };
}

/** Eine Monatspauschale nach Leistungsnachweis — auftragsweit oder für eine Zeile. */
async function vereinbarung(bau: Bau, zeile: string | null = null): Promise<string> {
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into vertrag_abrechnung
       (mandant_id, auftrag_id, auftrag_leistung_id, abrechnungsart, parameter,
        pauschale_netto_cent, abrechnungsintervall, leistungszeitraum_modus, gueltig_ab)
     values ($1,$2,$3::uuid,'monatspauschale','{"teilmonat":"keine"}'::jsonb,189000,
             'monatlich','nach_leistungsnachweis','2026-01-01')
     returning id`,
    [f.reinigung, bau.auftrag, zeile] as never[]);
  return v!.id;
}

/**
 * Ein Nachweis über `von`–`bis`; `zeile` nennt die Leistungszeile in der
 * Position (oder keine). `unterschreiben` false: nur vorgelegt.
 */
async function nachweis(
  bau: Bau, von: string, bis: string,
  opts: { zeile?: string | null; unterschreiben?: boolean } = {},
): Promise<string> {
  return alsApp(sitzung(f.reinigung), async (tx) => {
    const k = kontext(tx, f.reinigung, chef);
    const id = await erstelleEntwurf(k, {
      objektId: bau.objekt, kundeId: bau.kunde, von, bis,
      positionen: [{
        bezeichnung: `Unterhaltsreinigung ${von} bis ${bis}`, menge: '5.000', einheit: 'Durchgang',
        einzelpreisCent: null, quelle: 'manuell',
        auftragLeistungId: opts.zeile === undefined ? bau.unterhalt : opts.zeile,
      }],
    });
    await legeVor(k, id);
    if (opts.unterschreiben !== false) {
      const vorschau = await bereiteUnterschriftVor(k, id);
      await signiere(k, {
        nachweisId: id, rolle: 'auftraggeber', unterzeichnerName: 'Frau Özdemir',
        bestaetigtePruefsumme: vorschau.pruefsumme,
      });
    }
    return id;
  });
}

async function rechne(bau: Bau, von: string, bis: string, zeile: string | null = null, wer = chef) {
  return alsApp(sitzung(f.reinigung, wer), (tx) => berechneAbrechnung(alsDienst(tx), {
    auftragId: bau.auftrag, auftragLeistungId: zeile, periode: { von, bis },
  }));
}

let bau: Bau;

beforeEach(async () => {
  f = await seed();
  chef = await konto(`lz-chef-${zufall()}@cse.test`, 'super_admin');
  const [admin] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'admin' and mandant_id is null`);
  await mitglied(chef, f.reinigung, admin!.id);
  bau = await baue();
});
afterAll(schliessen);

describe('(1) zwei Nachweise über die Monatsgrenze', () => {
  it('die Augustzeile trägt die Tage des ersten, die Septemberzeile die des zweiten', async () => {
    await vereinbarung(bau);
    await nachweis(bau, '2026-08-20', '2026-08-31');
    await nachweis(bau, '2026-09-01', '2026-09-10');
    const e = await rechne(bau, '2026-08-01', '2026-09-30');
    expect(e.befunde.filter((b) => b.art === 'fehler')).toEqual([]);
    expect(e.positionen.map((p) => [p.bezeichnung, p.leistungVon, p.leistungBis, p.nettoCent]))
      .toEqual([
        ['Monatspauschale August 2026', '2026-08-20', '2026-08-31', 189_000n],
        ['Monatspauschale September 2026', '2026-09-01', '2026-09-10', 189_000n],
      ]);
  });

  it('ein Nachweis über die Monatsgrenze wird je Monat beschnitten', async () => {
    await vereinbarung(bau);
    await nachweis(bau, '2026-08-25', '2026-09-05');
    const e = await rechne(bau, '2026-08-01', '2026-09-30');
    expect(e.befunde.filter((b) => b.art === 'fehler')).toEqual([]);
    expect(e.positionen.map((p) => [p.leistungVon, p.leistungBis])).toEqual([
      ['2026-08-25', '2026-08-31'], ['2026-09-01', '2026-09-05'],
    ]);
  });
});

describe('(2) ein Monat ohne unterschriebenen Nachweis blockiert — und nur er', () => {
  it('vorgelegt zählt nicht, ohne Leistungszeile zählt nicht', async () => {
    await vereinbarung(bau);
    await nachweis(bau, '2026-08-20', '2026-08-31');
    await nachweis(bau, '2026-10-01', '2026-10-15', { unterschreiben: false });
    await nachweis(bau, '2026-10-01', '2026-10-10', { zeile: null });

    const august = await rechne(bau, '2026-08-01', '2026-08-31');
    expect(august.befunde.filter((b) => b.art === 'fehler')).toEqual([]);
    expect(august.positionen).toHaveLength(1);

    const oktober = await rechne(bau, '2026-10-01', '2026-10-31');
    const fehler = oktober.befunde.filter((b) => b.art === 'fehler');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]).toMatchObject({ feld: 'leistungszeitraum_modus', offeneFrage: 'O-54' });
    expect(fehler[0]!.textDe).toContain('01.10.2026 bis 31.10.2026');
    expect(oktober.positionen).toEqual([]);

    // Über beide Monate: nur der Oktober wird genannt.
    const beide = await rechne(bau, '2026-08-01', '2026-10-31');
    const genannt = beide.befunde.filter((b) => b.feld === 'leistungszeitraum_modus');
    expect(genannt.map((b) => b.textDe.match(/\d{2}\.\d{2}\.\d{4} bis \d{2}\.\d{2}\.\d{4}/u)?.[0]))
      .toEqual(['01.09.2026 bis 30.09.2026', '01.10.2026 bis 31.10.2026']);
  });
});

describe('(3) der beschnittene August sperrt den September nicht (V-207)', () => {
  it('die zweite Rechnung über den September entsteht; der August ein zweites Mal nicht', async () => {
    await vereinbarung(bau);
    await nachweis(bau, '2026-08-25', '2026-09-05');
    const ersterEntwurf = await alsApp(sitzung(f.reinigung), async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, {
        kundeId: bau.kunde, objektId: bau.objekt, auftragId: bau.auftrag,
        leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
      });
      await bestueckeAusAbrechnungsart(d, id, {
        auftragId: bau.auftrag, periode: { von: '2026-08-01', bis: '2026-08-31' }, rechnungId: id,
      });
      return id;
    });
    const [zeile] = await sql.unsafe<{ von: string; bis: string }[]>(
      `select to_char(leistung_von, 'YYYY-MM-DD') as von, to_char(leistung_bis, 'YYYY-MM-DD') as bis
         from rechnungsposition where rechnung_id = $1`, [ersterEntwurf]);
    expect(zeile).toEqual({ von: '2026-08-25', bis: '2026-08-31' });

    const september = await rechne(bau, '2026-09-01', '2026-09-30');
    expect(september.befunde.filter((b) => b.art === 'fehler')).toEqual([]);
    expect(september.positionen.map((p) => [p.leistungVon, p.leistungBis]))
      .toEqual([['2026-09-01', '2026-09-05']]);

    const nochmalAugust = await rechne(bau, '2026-08-01', '2026-08-31');
    expect(nochmalAugust.befunde.some((b) => b.feld === 'leistung_von' && b.art === 'fehler'))
      .toBe(true);
  });
});

describe('(4) eine zeilenbezogene Vereinbarung zählt nur die Nachweise ihrer Zeile', () => {
  it('ein Nachweis der Unterhaltsreinigung trägt die Glasreinigung nicht', async () => {
    await vereinbarung(bau, bau.glas);
    await nachweis(bau, '2026-08-20', '2026-08-31');
    const ohne = await rechne(bau, '2026-08-01', '2026-08-31', bau.glas);
    expect(ohne.befunde.some((b) => b.feld === 'leistungszeitraum_modus' && b.art === 'fehler'))
      .toBe(true);

    await nachweis(bau, '2026-08-03', '2026-08-07', { zeile: bau.glas });
    const mit = await rechne(bau, '2026-08-01', '2026-08-31', bau.glas);
    expect(mit.befunde.filter((b) => b.art === 'fehler')).toEqual([]);
    expect(mit.positionen.map((p) => [p.leistungVon, p.leistungBis]))
      .toEqual([['2026-08-03', '2026-08-07']]);
  });
});

describe('(5) ohne das Recht, Nachweise zu lesen', () => {
  it('sagt der Befund das Recht — und rechnet nichts', async () => {
    await vereinbarung(bau);
    await nachweis(bau, '2026-08-20', '2026-08-31');
    /* Eine Buchhaltung mit den Rechten der Administration — ohne Nachweise. */
    const fibu = await konto(`lz-fibu-${zufall()}@cse.test`, null);
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
        where rb.gewaehrt and b.schluessel <> 'nachweis.lesen'`,
      [r!.id, f.reinigung]);
    await mitglied(fibu, f.reinigung, r!.id);

    const e = await rechne(bau, '2026-08-01', '2026-08-31', null, fibu);
    const fehler = e.befunde.filter((b) => b.feld === 'leistungszeitraum_modus');
    expect(fehler).toHaveLength(1);
    expect(fehler[0]!.textDe).toContain('Sie zu lesen verlangt das Recht');
    expect(e.positionen).toEqual([]);
  });
});
