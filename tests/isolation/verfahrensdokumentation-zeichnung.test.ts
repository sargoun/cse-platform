/**
 * Der Zeichnungsvermerk der Verfahrensdokumentation gegen eine echte
 * Datenbank (V-316, O-188, D-837, 0526).
 *
 *  1. Zeichnen schreibt eine Zeile mit dem Hash und Schemastand der eben
 *     erzeugten Fassung; Zeichner und Zeit setzt die Datenbank, nicht der
 *     Aufrufer — und eine Zeile steht im Prüfprotokoll.
 *  2. Der Stand folgt der Fassung: gezeichnet ist aktuell; ein neuer
 *     Nummernkreis ändert den Hash, und der Stand sagt „Inhalt geändert";
 *     eine zweite Zeichnung macht ihn wieder aktuell, der Verlauf hält beide.
 *  3. Eine Zeichnung bleibt: kein Ändern, kein Löschen — auch nicht für den
 *     Eigentümer der Tabelle.
 *  4. Rechte: lesen darf, wer die Dokumentation lesen darf; zeichnen nur, wer
 *     `buchhaltung_konfiguration.verwalten` hält, und nicht in einer
 *     lesenden Sitzung.
 *  5. Die eine Gesellschaft sieht die Zeichnungen der anderen nicht, und das
 *     Kundenportal sieht keine.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { erstelleVerfahrensdokumentation } from '../../src/server/services/buchhaltung/verfahrensdokumentation.js';
import {
  ZeichnungFehler, fassungVon, ladeZeichnungen, ladeZeichnungsvermerk, zeichne,
} from '../../src/server/services/buchhaltung/verfahrensdokumentation-zeichnung.js';
import type { JobDefinition } from '../../src/server/jobs/registry.js';

let f: Fixtur;
let chef: string;
let leser: string;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

const JOBS: readonly JobDefinition[] = [];
const AUSLIEFERUNG = { commit: 'abc1234', region: 'fra1', umgebung: 'test' };
const HASH = 'c'.repeat(64);

function sitzung(mandantId: string, benutzerId: string, readonly = false) {
  return { scope: 'mandant' as const, mandantId, benutzerId, portal: 'intern' as const, readonly };
}

function kontext(tx: postgres.TransactionSql, mandant: string, benutzer: string): SchreibKontext {
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function konto(email: string, name: string, global: string | null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, $3, 'aktiv',
             (select id from rolle where schluessel = $4 and mandant_id is null))`,
    [u!.id, email, name, global]);
  return u!.id;
}

/** Eine eigene Rolle der Reinigung, die genau die genannten Rechte hält. */
async function rolleMit(rechte: readonly string[]): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, 'Prüfung', 'mandant', 'intern') returning id`,
    [f.reinigung, `pruefung_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1::uuid, b.id, $2::uuid, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, f.reinigung, rechte]);
  return r!.id;
}

async function mitglied(benutzer: string, mandant: string, rolleId: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1, $2, $3)`,
    [benutzer, mandant, rolleId]);
}

/** Erzeugt die Dokumentation und zeichnet sie — in EINER Transaktion, wie die Route. */
async function zeichneJetzt(mandant: string, wer: string, funktion = 'Geschäftsführung') {
  return alsApp(sitzung(mandant, wer), async (tx) => {
    const k = kontext(tx, mandant, wer);
    const doku = await erstelleVerfahrensdokumentation(k, { jobs: JOBS, auslieferung: AUSLIEFERUNG });
    const z = await zeichne(k, fassungVon(doku), { funktion, bemerkung: '  ', gesehen: doku.sha256 });
    return { doku, id: z.id };
  });
}

async function vermerk(mandant: string, wer: string) {
  return alsApp(sitzung(mandant, wer), async (tx) => {
    const k = kontext(tx, mandant, wer);
    const doku = await erstelleVerfahrensdokumentation(k, { jobs: JOBS, auslieferung: AUSLIEFERUNG });
    return { doku, ...(await ladeZeichnungsvermerk(k, fassungVon(doku))) };
  });
}

beforeEach(async () => {
  f = await seed();
  chef = await konto(`vdz-chef-${zufall()}@cse.test`, 'Gisela Geschäftsführung', 'super_admin');
  leser = await konto(`vdz-leser-${zufall()}@cse.test`, 'Lea Lesend', null);
  await mitglied(leser, f.reinigung, await rolleMit(['buchhaltung_konfiguration.lesen']));
});
afterAll(schliessen);

describe('(1) zeichnen', () => {
  it('schreibt Hash und Schemastand der erzeugten Fassung; Zeichner und Zeit setzt die Datenbank', async () => {
    const { doku, id } = await zeichneJetzt(f.reinigung, chef, '  Geschäftsführung  ');
    const [z] = await sql.unsafe<{
      sha256: string; schemastand: string | null; funktion: string; bemerkung: string | null;
      gezeichnet_von: string; jetzt: boolean; mandant_id: string;
    }[]>(
      `select sha256, schemastand, funktion, bemerkung, gezeichnet_von::text, mandant_id::text,
              gezeichnet_am between now() - interval '1 minute' and now() + interval '1 minute' as jetzt
         from verfahrensdokumentation_zeichnung where id = $1`, [id]);
    expect(z).toEqual({
      sha256: doku.sha256, schemastand: doku.schemastand?.migration ?? null,
      funktion: 'Geschäftsführung', bemerkung: null,
      gezeichnet_von: chef, mandant_id: f.reinigung, jetzt: true,
    });

    const protokoll = await sql.unsafe<{ mandant_id: string; akteur_id: string; sha256: string; funktion: string }[]>(
      `select mandant_id::text, akteur_id::text, nachher ->> 'sha256' as sha256,
              nachher ->> 'funktion' as funktion
         from audit_log
        where aktion = 'buchhaltung.verfahrensdokumentation_gezeichnet'
          and objekt_typ = 'verfahrensdokumentation_zeichnung' and objekt_id = $1`, [id]);
    expect(protokoll).toEqual([
      { mandant_id: f.reinigung, akteur_id: chef, sha256: doku.sha256, funktion: 'Geschäftsführung' },
    ]);
  });

  it('Zeichner und Zeit kann der Aufrufer nicht setzen — die Spalten sind ihm nicht gewährt', async () => {
    await expect(alsApp(sitzung(f.reinigung, chef), (tx) => tx.unsafe(
      `insert into verfahrensdokumentation_zeichnung
         (mandant_id, sha256, schemastand, funktion, gezeichnet_von, gezeichnet_am)
       values ($1, $2, null, 'Geschäftsführung', $3, now() - interval '400 days')`,
      [f.reinigung, HASH, leser])))
      .rejects.toThrow(/permission denied/u);
  });

  it('ohne Funktion, mit zu langer Funktion oder Bemerkung: ein Grund, keine Zeile', async () => {
    const versuch = (funktion: string, bemerkung: string | null = null) =>
      alsApp(sitzung(f.reinigung, chef), (tx) =>
        zeichne(kontext(tx, f.reinigung, chef), { sha256: HASH, schemastand: null },
          { funktion, bemerkung, gesehen: HASH }));
    await expect(versuch('  GF ')).rejects.toSatisfy(
      (e: unknown) => e instanceof ZeichnungFehler && e.grund === 'funktion_fehlt');
    await expect(versuch('x'.repeat(201))).rejects.toSatisfy(
      (e: unknown) => e instanceof ZeichnungFehler && e.grund === 'funktion_zu_lang');
    await expect(versuch('Geschäftsführung', 'y'.repeat(2001))).rejects.toSatisfy(
      (e: unknown) => e instanceof ZeichnungFehler && e.grund === 'bemerkung_zu_lang');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from verfahrensdokumentation_zeichnung where mandant_id = $1`, [f.reinigung]);
    expect(n!.n).toBe(0);
  });

  it('die Datenbank hält dieselben Grenzen, auch an der Route vorbei', async () => {
    await expect(alsApp(sitzung(f.reinigung, chef), (tx) => tx.unsafe(
      `insert into verfahrensdokumentation_zeichnung (mandant_id, sha256, funktion)
       values ($1, $2, '  ab  ')`, [f.reinigung, HASH])))
      .rejects.toThrow(/vdz_funktion_benannt/u);
    await expect(alsApp(sitzung(f.reinigung, chef), (tx) => tx.unsafe(
      `insert into verfahrensdokumentation_zeichnung (mandant_id, sha256, funktion)
       values ($1, 'kein-hash', 'Geschäftsführung')`, [f.reinigung])))
      .rejects.toThrow(/vdz_sha256_form/u);
  });
});

describe('(1b) gezeichnet wird nur die Fassung, die der Mensch gesehen hat', () => {
  it('hat sich die Dokumentation seit dem Öffnen geändert, wird nichts gezeichnet', async () => {
    /* Die Seite zeigte diese Fassung … */
    const gesehen = (await vermerk(f.reinigung, chef)).doku.sha256;
    /* … dann ändert jemand die Konfiguration (ein neuer Nummernkreis). */
    await sql.unsafe(
      `insert into nummernkreis
         (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
          zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 'eingangsrechnung_beleg', null, 0, 'Eingangsbelege', true, 'EB-{nr:6}', 'nie',
               '2026-01-01', true, 'system', 'job:test')`, [f.reinigung]);
    await expect(alsApp(sitzung(f.reinigung, chef), async (tx) => {
      const k = kontext(tx, f.reinigung, chef);
      const doku = await erstelleVerfahrensdokumentation(k, { jobs: JOBS, auslieferung: AUSLIEFERUNG });
      return zeichne(k, fassungVon(doku), { funktion: 'Geschäftsführung', gesehen });
    })).rejects.toSatisfy(
      (e: unknown) => e instanceof ZeichnungFehler && e.grund === 'fassung_geaendert');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from verfahrensdokumentation_zeichnung where mandant_id = $1`,
      [f.reinigung]);
    expect(n!.n).toBe(0);
  });
});

describe('(2) der Stand folgt der Fassung', () => {
  it('ungezeichnet → aktuell → Inhalt geändert → wieder aktuell; der Verlauf hält beide, die jüngste zuerst', async () => {
    expect((await vermerk(f.reinigung, chef)).stand).toEqual({ art: 'ungezeichnet' });

    const erste = await zeichneJetzt(f.reinigung, chef);
    const nachher = await vermerk(f.reinigung, chef);
    expect(nachher.stand.art).toBe('aktuell');
    expect(nachher.zeichnungen).toHaveLength(1);
    expect(nachher.zeichnungen[0]).toMatchObject({
      id: erste.id, sha256: erste.doku.sha256, funktion: 'Geschäftsführung', bemerkung: null,
      gezeichnetVon: 'Gisela Geschäftsführung',
    });
    const [heute] = await sql.unsafe<{ tag: string }[]>(`select app.berlin_heute()::text as tag`);
    expect(nachher.zeichnungen[0]!.gezeichnetTag).toBe(heute!.tag);
    expect(nachher.zeichnungen[0]!.gezeichnetAm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);

    /* Ein neuer Nummernkreis ändert die Dokumentation und ihren Hash. */
    await sql.unsafe(
      `insert into nummernkreis
         (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
          zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
       values ($1, 'eingangsrechnung_beleg', null, 0, 'Eingangsbelege', true, 'EB-{nr:6}', 'nie',
               '2026-01-01', true, 'system', 'job:test')`, [f.reinigung]);
    const geaendert = await vermerk(f.reinigung, chef);
    expect(geaendert.doku.sha256).not.toBe(erste.doku.sha256);
    expect(geaendert.stand.art).toBe('inhalt_geaendert');

    const zweite = await zeichneJetzt(f.reinigung, chef, 'Prokura');
    const wieder = await vermerk(f.reinigung, chef);
    expect(wieder.stand.art).toBe('aktuell');
    expect(wieder.zeichnungen.map((z) => z.id)).toEqual([zweite.id, erste.id]);
  });

  it('eine Zeichnung, die ein Jahr alt ist, ist fällig — auch wenn die Fassung dieselbe ist', async () => {
    const { id } = await zeichneJetzt(f.reinigung, chef);
    // Nur der Eigentümer kommt an den Auslöser vorbei — hier, um die Uhr zu stellen.
    await sql.unsafe(`alter table verfahrensdokumentation_zeichnung disable trigger trg_vdz_unveraenderlich`);
    try {
      await sql.unsafe(
        `update verfahrensdokumentation_zeichnung set gezeichnet_am = now() - interval '1 year 1 day'
          where id = $1`, [id]);
    } finally {
      await sql.unsafe(`alter table verfahrensdokumentation_zeichnung enable trigger trg_vdz_unveraenderlich`);
    }
    const v = await vermerk(f.reinigung, chef);
    expect(v.stand.art).toBe('turnus_abgelaufen');
  });
});

describe('(3) eine Zeichnung bleibt', () => {
  it('kein Ändern und kein Löschen — auch nicht für den Eigentümer der Tabelle', async () => {
    const { id } = await zeichneJetzt(f.reinigung, chef);
    await expect(alsApp(sitzung(f.reinigung, chef), (tx) => tx.unsafe(
      `update verfahrensdokumentation_zeichnung set funktion = 'Niemand' where id = $1`, [id])))
      .rejects.toThrow(/permission denied/u);
    await expect(alsApp(sitzung(f.reinigung, chef), (tx) => tx.unsafe(
      `delete from verfahrensdokumentation_zeichnung where id = $1`, [id])))
      .rejects.toThrow(/permission denied/u);
    await expect(sql.unsafe(
      `update verfahrensdokumentation_zeichnung set funktion = 'Niemand' where id = $1`, [id]))
      .rejects.toThrow(/Eine Zeichnung bleibt/u);
    await expect(sql.unsafe(`delete from verfahrensdokumentation_zeichnung where id = $1`, [id]))
      .rejects.toThrow();
    const [z] = await sql.unsafe<{ funktion: string }[]>(
      `select funktion from verfahrensdokumentation_zeichnung where id = $1`, [id]);
    expect(z?.funktion).toBe('Geschäftsführung');
  });
});

describe('(4) Rechte', () => {
  it('wer nur lesen darf, sieht den Verlauf — und kann nicht zeichnen', async () => {
    await zeichneJetzt(f.reinigung, chef);
    const gesehen = await alsApp(sitzung(f.reinigung, leser), (tx) =>
      ladeZeichnungen(kontext(tx, f.reinigung, leser)));
    expect(gesehen).toHaveLength(1);
    await expect(zeichneJetzt(f.reinigung, leser))
      .rejects.toThrow(/row-level security/u);
  });

  it('wer die Dokumentation nicht lesen darf, sieht auch keine Zeichnung', async () => {
    await zeichneJetzt(f.reinigung, chef);
    const fremd = await konto(`vdz-fremd-${zufall()}@cse.test`, 'Fritz Fremd', null);
    await mitglied(fremd, f.reinigung, await rolleMit(['crm.lesen']));
    const gesehen = await alsApp(sitzung(f.reinigung, fremd), (tx) =>
      ladeZeichnungen(kontext(tx, f.reinigung, fremd)));
    expect(gesehen).toEqual([]);
  });

  it('eine lesende Sitzung zeichnet nicht, auch mit dem Recht', async () => {
    await expect(alsApp(sitzung(f.reinigung, chef, true), (tx) =>
      zeichne(kontext(tx, f.reinigung, chef), { sha256: HASH, schemastand: null },
        { funktion: 'Geschäftsführung', gesehen: HASH })))
      .rejects.toThrow();
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from verfahrensdokumentation_zeichnung`);
    expect(n!.n).toBe(0);
  });
});

describe('(5) Gesellschaften und Kundenportal', () => {
  it('die Bau sieht die Zeichnung der Reinigung nicht und kann nicht für sie zeichnen', async () => {
    await zeichneJetzt(f.reinigung, chef);
    const bau = await alsApp(sitzung(f.bau, chef), (tx) => ladeZeichnungen(kontext(tx, f.bau, chef)));
    expect(bau).toEqual([]);
    const v = await vermerk(f.bau, chef);
    expect(v.stand).toEqual({ art: 'ungezeichnet' });
    await expect(alsApp(sitzung(f.bau, chef), (tx) => tx.unsafe(
      `insert into verfahrensdokumentation_zeichnung (mandant_id, sha256, funktion)
       values ($1, $2, 'Geschäftsführung')`, [f.reinigung, HASH])))
      .rejects.toThrow(/row-level security/u);
  });

  it('im Kundenportal ist die Tabelle leer', async () => {
    await zeichneJetzt(f.reinigung, chef);
    const [n] = await alsApp(
      { scope: 'kunde' as const, mandantIds: [f.reinigung], benutzerId: chef, portal: 'kunde' as const, readonly: true },
      (tx) => tx.unsafe<{ n: number }[]>(`select count(*)::int as n from verfahrensdokumentation_zeichnung`));
    expect(n!.n).toBe(0);
  });
});
