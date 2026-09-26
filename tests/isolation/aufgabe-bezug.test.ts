import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bezugskandidaten, legeAn, loeseBezugAuf,
} from '../../src/server/services/kern/aufgabe.js';

/**
 * **Eine Aufgabe hängt an einem Vorgang** (V-096, OPS-11).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `aufgabe` trägt fünf Bezugsfelder, die Route nimmt alle fünf entgegen,
 * `loeseBezugAuf` löst sechs Arten auf, die Detailseite zeigt den Verweis —
 * **und das Anlegeformular schickte keines davon**. Jede von Hand angelegte
 * Aufgabe stand frei in der Luft.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Auswahl kommt unter der SITZUNG zustande: was ein Mensch wählen kann,
 * entscheidet die RLS und keine zweite Rechteprüfung im Dienst. Ob das hält,
 * lässt sich nur an echten Policies zeigen — und ob der Bezug danach
 * AUFLÖST, nur an echten Zeilen.
 */

let f: Fixtur;
let leitung = '';
let auftragId = '';
let objektId = '';
let kundeId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `bez-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

function kontext(
  tx: postgres.TransactionSql, mandantId: string, benutzerId: string,
): LeseKontext & SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: lauf, schreibe: lauf,
  };
}

async function alsWer<T>(
  benutzerId: string, fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  o: { readonly mandantId?: string } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: false, aal: 'aal2' },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung, 'leitung');
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin')
     returning id`, [f.reinigung, `K-${zufall()}`] as never[]);
  kundeId = k!.id;
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Mitte','Teststr. 7','10115','Berlin') returning id`,
    [f.reinigung, kundeId, `O-${zufall()}`] as never[]);
  objektId = o!.id;
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'dauerauftrag','Unterhaltsreinigung',$5,'2026-01-01')
     returning id`,
    [f.reinigung, `AU-${zufall()}`, kundeId, objektId, leitung] as never[]);
  auftragId = a!.id;
});
afterAll(schliessen);

describe('§1 die Auswahl', () => {
  it('führt den Auftrag, das Objekt und den Kunden dieser Gesellschaft', async () => {
    const kandidaten = await alsWer(leitung, (k) => bezugskandidaten(k));
    expect(kandidaten.some((z) => z.typ === 'auftrag' && z.id === auftragId)).toBe(true);
    expect(kandidaten.some((z) => z.typ === 'objekt' && z.id === objektId)).toBe(true);
    expect(kandidaten.some((z) => z.typ === 'kunde' && z.id === kundeId)).toBe(true);
  });

  it('und NICHTS aus einer fremden Gesellschaft (Invariante 3)', async () => {
    const imBau = await konto(f.bau, 'leitung');
    const kandidaten = await alsWer(imBau, (k) => bezugskandidaten(k),
                                    { mandantId: f.bau });
    expect(kandidaten.some((z) => z.id === auftragId)).toBe(false);
    expect(kandidaten.some((z) => z.id === objektId)).toBe(false);
    expect(kandidaten.some((z) => z.id === kundeId)).toBe(false);
  });

  it('lässt eine Gruppe aus, die diese Sitzung nicht lesen darf', async () => {
    /*
     * **Die RLS entscheidet, nicht eine zweite Rechteprüfung im Dienst.**
     * `mitarbeiter` hält `crm.lesen` nicht — die Kundengruppe fehlt dann in
     * der Auswahl, und zwar ohne Fehler. Eine eigene Prüfung im Dienst könnte
     * von der Policy abweichen, und dann böte die Seite etwas an, das die
     * Datenbank abweist.
     */
    const ohne = await konto(f.reinigung, 'mitarbeiter');
    const kandidaten = await alsWer(ohne, (k) => bezugskandidaten(k));
    expect(kandidaten.some((z) => z.typ === 'kunde')).toBe(false);
  });

  it('einen beendeten Auftrag bietet sie nicht mehr an', async () => {
    /*
     * Eine Auswahl, die jeden je angelegten Auftrag führt, ist nach zwei
     * Jahren keine Auswahl mehr — und eine Aufgabe zu einem beendeten Auftrag
     * ist der seltenere Fall.
     *
     * Storniert und nicht abgeschlossen: den Abschluss bindet
     * `kern.auftrag_uebergang_pruefen` (0296) an `auftrag.abschliessen`, und
     * zwar auch gegen den Eigentümer ohne Sitzung — eine Fixtur, die ihn hier
     * setzte, prüfte den Abschlussweg statt der Auswahlliste.
     */
    await sql.unsafe(
      `update auftrag set status = 'storniert',
                          status_grund = 'Der Kunde hat vor Beginn gekündigt.'
        where id = $1`, [auftragId] as never[]);
    const kandidaten = await alsWer(leitung, (k) => bezugskandidaten(k));
    expect(kandidaten.some((z) => z.id === auftragId)).toBe(false);
  });
});

describe('§2 der Bezug hält bis zur Anzeige', () => {
  it('legt die Aufgabe MIT beiden Formen an — Fremdschlüssel und Paar', async () => {
    /*
     * `auftrag_id` trägt die LISTE (über Joins), das polymorphe Paar trägt
     * die Detailseite (`loeseBezugAuf`). Nur eines zu setzen liesse die
     * jeweils andere Ansicht leer — und zwar still.
     */
    const id = await alsWer(leitung, (k) => legeAn(k, {
      titel: 'Rechnung prüfen',
      auftragId, bezugTyp: 'auftrag', bezugId: auftragId,
    }));
    const [z] = await sql.unsafe<{
      auftrag_id: string | null; bezug_typ: string | null; bezug_id: string | null;
    }[]>(
      `select auftrag_id, bezug_typ::text as bezug_typ, bezug_id
         from aufgabe where id = $1`, [id] as never[]);
    expect(z!.auftrag_id).toBe(auftragId);
    expect(z!.bezug_typ).toBe('auftrag');
    expect(z!.bezug_id).toBe(auftragId);
  });

  it('und der Bezug löst auf einen Namen UND einen Pfad auf', async () => {
    const bezug = await alsWer(leitung, (k) => loeseBezugAuf(k, 'auftrag', auftragId));
    expect(bezug?.titel).toContain('Unterhaltsreinigung');
    expect(bezug?.pfad).toBe(`auftraege/${auftragId}`);
  });

  it('ein Bezug auf eine unsichtbare Zeile gibt KEINEN Verweis und keinen Fehler', async () => {
    /*
     * Ein Verweis auf eine Adresse, die es für diese Sitzung nicht gibt, wäre
     * der sichtbarste 404 im Portal. Die Aufgabe steht dann mit der Art da
     * und ohne Link.
     */
    const imBau = await konto(f.bau, 'leitung');
    const bezug = await alsWer(imBau, (k) => loeseBezugAuf(k, 'auftrag', auftragId),
                               { mandantId: f.bau });
    expect(bezug?.titel).toBeNull();
    expect(bezug?.pfad).toBeNull();
  });

  it('ein halber Bezug wird abgewiesen — die Datenbank verlangt das Paar', async () => {
    await expect(alsWer(leitung, (k) => legeAn(k, {
      titel: 'Halber Bezug', bezugTyp: 'auftrag',
    }))).rejects.toThrow(/Paar/u);
  });
});
