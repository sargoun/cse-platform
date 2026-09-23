import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, SupabaseSpeicher, type Speicher } from '../../src/server/storage/adapter.js';
import {
  MarkenbildFehler, eigenesMarkenbild, entferneMarkenbild, oeffentlichesMarkenbild,
  setzeMarkenbild, type MarkenbildEingabe,
} from '../../src/server/services/mandant/markenbild.js';

/**
 * **Logo, Avatar und Titelbild gegen echtes Postgres** (V-100, D-622, 0393).
 *
 * Geprüft wird, was nur hier zu prüfen ist:
 *
 *  - Ein Bild landet im Speicher UND in der Zeile — oder in keinem von beiden.
 *    Bei jedem „nein" (kein Alternativtext, falscher Typ, nicht verbunden,
 *    kein Recht) bleiben Zeile und Speicher unberührt.
 *  - Ortsdaten eines PNG gehen nicht mit (TIM-10 gilt auch für ein Titelbild).
 *  - „Entfernen" nimmt die Zuordnung weg und lässt die Datei liegen.
 *  - Die Website bekommt ein Bild nur aus einer VERÖFFENTLICHTEN Identität —
 *    auch wenn der Leser, wie der Renderer, die Zeile sonst sehen dürfte.
 */

let f: Fixtur;
let chef = '';
let leitung = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

/** 1×1 PNG. */
const PNG = hex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000d49444154789c6378cc26fc1f0004c801fc6a07bf6c0000000049454e44ae426082');
/** 1×1 PNG mit einem tEXt-Block „GPS 52.5,13.4". */
const PNG_MIT_ORT = hex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000d744558744750530035322e352c31332e340d3daf0f'
  + '0000000d49444154789c63606060f80f00010401005fe5c34b0000000049454e44ae426082');
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `marke-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

/**
 * Die Super-Administration — die einzige Rolle, die `system.identitaet_verwalten`
 * per Vorgabe hält (0008). Sie ist eine GLOBALE Rolle (`benutzer.globale_rolle_id`)
 * und braucht den zweiten Faktor.
 */
async function superAdmin(): Promise<string> {
  const email = `marke-sa-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Marke', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

/** Die Identitätszeile — im Seed feuert der Anlageauslöser nicht (siehe mandant-identitaet.test.ts). */
async function identitaet(mandant: string, token: string): Promise<void> {
  await sql.unsafe(
    `insert into mandant_identitaet (mandant_id, kurzname, identitaets_token)
     values ($1, $2, $3) on conflict (mandant_id) do nothing`,
    [mandant, `Kurz ${token}`, token] as never[]);
}

function kontext(tx: postgres.TransactionSql, benutzerId: string, mandant: string): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage: lauf, schreibe: lauf,
  };
}

function als<T>(benutzer: string, fn: (k: SchreibKontext) => Promise<T>,
  mandant = f.reinigung): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, benutzerId: benutzer, portal: 'intern',
      readonly: false, aal: 'aal2' },
    (tx) => fn(kontext(tx, benutzer, mandant)),
  );
}

interface Zeile {
  logo_hell_pfad: string | null; logo_alt: string | null;
  avatar_pfad: string | null; avatar_alt: string | null;
  cover_pfad: string | null; cover_alt: string | null;
}

async function zeile(mandant = f.reinigung): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select logo_hell_pfad, logo_alt, avatar_pfad, avatar_alt, cover_pfad, cover_alt
       from mandant_identitaet where mandant_id = $1`, [mandant]);
  return z!;
}

async function grund(speicher: Speicher, e: MarkenbildEingabe, wer = chef): Promise<string | null> {
  try {
    await als(wer, (k) => setzeMarkenbild(k, speicher, e));
    return null;
  } catch (fehler: unknown) {
    if (fehler instanceof MarkenbildFehler) return fehler.grund;
    throw fehler;
  }
}

beforeEach(async () => {
  f = await seed();
  await identitaet(f.reinigung, 'area-reinigung');
  await identitaet(f.bau, 'area-bau');
  chef = await superAdmin();
  leitung = await konto(f.reinigung, 'leitung');
});

afterAll(async () => {
  await schliessen();
});

describe('§1 ein Bild landet im Speicher UND in der Zeile', () => {
  it('ein Titelbild als PNG: Pfad aus dem Inhalt, Alternativtext, Datei im Behälter marke', async () => {
    const speicher = new LokalerSpeicher();
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, speicher, {
      art: 'cover', daten: PNG, alt: 'Treppenhaus im Gegenlicht',
    }));
    const z = await zeile();
    expect(z.cover_pfad).toBe(schluessel);
    expect(z.cover_pfad).toMatch(new RegExp(`^${f.reinigung}/cover/[0-9a-f]{64}\\.png$`, 'u'));
    expect(z.cover_alt).toBe('Treppenhaus im Gegenlicht');
    expect(speicher.rohBytes('marke', schluessel)).toEqual(PNG);
  });

  it('ein SVG-Logo wird angenommen und als .svg abgelegt', async () => {
    const speicher = new LokalerSpeicher();
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, speicher, {
      art: 'logo_hell', daten: SVG, alt: 'Logo der Reinigung',
    }));
    expect(schluessel.endsWith('.svg')).toBe(true);
    expect((await zeile()).logo_hell_pfad).toBe(schluessel);
  });

  it('der Vorgang steht im Protokoll', async () => {
    await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'avatar', daten: PNG, alt: 'Avatar',
    }));
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where aktion = 'mandant.markenbild_gesetzt' and mandant_id = $1`, [f.reinigung]);
    expect(z!.n).toBe(1);
  });

  it('die Ortsdaten eines PNG gehen nicht mit — abgelegt wird die bereinigte Datei', async () => {
    const speicher = new LokalerSpeicher();
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, speicher, {
      art: 'cover', daten: PNG_MIT_ORT, alt: 'Fassade',
    }));
    const abgelegt = speicher.rohBytes('marke', schluessel)!;
    expect(Buffer.from(abgelegt).includes(Buffer.from('52.5,13.4'))).toBe(false);
    expect(abgelegt.length).toBeLessThan(PNG_MIT_ORT.length);
  });

  it('die drei Logos teilen EINEN Alternativtext — der schon gesetzte trägt das nächste', async () => {
    await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'logo_hell', daten: SVG, alt: 'Logo der Reinigung',
    }));
    expect(await grund(new LokalerSpeicher(), { art: 'logo_dunkel', daten: SVG, alt: null }))
      .toBeNull();
  });
});

describe('§2 bei jedem „nein" bleiben Zeile und Speicher unberührt', () => {
  it('ohne Alternativtext', async () => {
    const speicher = new LokalerSpeicher();
    expect(await grund(speicher, { art: 'cover', daten: PNG, alt: '  ' })).toBe('alt_text_fehlt');
    expect((await zeile()).cover_pfad).toBeNull();
    expect(speicher.rohBytes('marke', `${f.reinigung}/cover`)).toBeUndefined();
  });

  it('ohne verbundenen Speicher — auch keine halbe Zuordnung', async () => {
    expect(await grund(new SupabaseSpeicher('', ''), { art: 'cover', daten: PNG, alt: 'x' }))
      .toBe('nicht_verbunden');
    expect((await zeile()).cover_pfad).toBeNull();
  });

  it('ein PDF, ein SVG als Titelbild und ein SVG mit Skript sind keine Markenbilder', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n');
    const boese = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    expect(await grund(new LokalerSpeicher(), { art: 'avatar', daten: pdf, alt: 'x' })).toBe('typ');
    expect(await grund(new LokalerSpeicher(), { art: 'cover', daten: SVG, alt: 'x' })).toBe('typ');
    expect(await grund(new LokalerSpeicher(), { art: 'logo_hell', daten: boese, alt: 'x' }))
      .toBe('typ');
    const z = await zeile();
    expect([z.avatar_pfad, z.cover_pfad, z.logo_hell_pfad]).toEqual([null, null, null]);
  });

  it('ohne „Identität verwalten": kein stiller Erfolg — die Leitung liest, schreibt aber nicht', async () => {
    const speicher = new LokalerSpeicher();
    expect(await grund(speicher, { art: 'cover', daten: PNG, alt: 'x' }, leitung)).toBe('kein_recht');
    expect((await zeile()).cover_pfad).toBeNull();
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log where aktion = 'mandant.markenbild_gesetzt'`);
    expect(z!.n).toBe(0);
  });
});

describe('§3 „Entfernen" nimmt die Zuordnung weg und lässt die Datei liegen', () => {
  it('Pfad NULL, Alternativtext bleibt, Objekt bleibt', async () => {
    const speicher = new LokalerSpeicher();
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, speicher, {
      art: 'cover', daten: PNG, alt: 'Treppenhaus',
    }));
    await als(chef, (k) => entferneMarkenbild(k, 'cover'));
    const z = await zeile();
    expect(z.cover_pfad).toBeNull();
    expect(z.cover_alt).toBe('Treppenhaus');
    expect(speicher.rohBytes('marke', schluessel)).toEqual(PNG);
  });

  it('ohne Recht wird nichts entfernt', async () => {
    await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'cover', daten: PNG, alt: 'Treppenhaus',
    }));
    await expect(als(leitung, (k) => entferneMarkenbild(k, 'cover')))
      .rejects.toThrow(MarkenbildFehler);
    expect((await zeile()).cover_pfad).not.toBeNull();
  });
});

describe('§4 die Website bekommt ein Bild nur aus einer veröffentlichten Identität', () => {
  it('unveröffentlicht: öffentlich nichts, in der eigenen Sitzung die Vorschau', async () => {
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'cover', daten: PNG, alt: 'Treppenhaus',
    }));
    expect(await als(chef, (k) => oeffentlichesMarkenbild(k, f.reinigung, 'cover'))).toBeNull();
    expect(await als(chef, (k) => eigenesMarkenbild(k, f.reinigung, 'cover')))
      .toEqual({ pfad: schluessel, alt: 'Treppenhaus' });
  });

  it('veröffentlicht: öffentlich sichtbar', async () => {
    const schluessel = await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'cover', daten: PNG, alt: 'Treppenhaus',
    }));
    await sql.unsafe(`update mandant_identitaet set oeffentlich_sichtbar = true where mandant_id = $1`,
      [f.reinigung]);
    expect(await als(chef, (k) => oeffentlichesMarkenbild(k, f.reinigung, 'cover')))
      .toEqual({ pfad: schluessel, alt: 'Treppenhaus' });
  });

  it('die Vorschau einer FREMDEN Gesellschaft gibt es nicht', async () => {
    await als(chef, (k) => setzeMarkenbild(k, new LokalerSpeicher(), {
      art: 'cover', daten: PNG, alt: 'Rohbau',
    }), f.bau);
    /* Dieselbe Person, aber in der Reinigung angemeldet: die Bau-Vorschau gibt es dort nicht. */
    expect(await als(chef, (k) => eigenesMarkenbild(k, f.bau, 'cover'))).toBeNull();
    expect(await als(chef, (k) => eigenesMarkenbild(k, f.bau, 'cover'), f.bau)).not.toBeNull();
  });
});
