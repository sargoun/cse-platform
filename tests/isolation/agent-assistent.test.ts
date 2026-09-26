import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AssistentFehler, beantworteFrage, leseFrage,
} from '../../src/server/services/agent/assistent.js';

/**
 * Jede Frage an den CEO-Assistenten ist eine Aufgabe mit einem Schritt
 * (AGT-04, AGT-07, V-229, D-723).
 *
 *  1. Eine beantwortete Frage hinterlässt Aufgabe und Schritt — Werkzeug,
 *     Eingabe, Ausgabe, kein Modell, null Tokens und Kosten, eine Dauer.
 *  2. Derselbe Formularschlüssel zweimal ist EINE Aufgabe.
 *  3. Ist das Werkzeug nicht freigeschaltet, steht die Abweisung im
 *     Protokoll — und es gibt keine Antwort.
 *  4. Eine Frage ausserhalb des Katalogs legt nichts an.
 *  5. Die Antwort liest nur die eigene Gesellschaft.
 */

let f: Fixtur;
let chef = '';
let ceo = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `assistent-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  chef = await konto(f.reinigung, 'admin');
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from agent where kennung = 'ceo_assistent'`);
  ceo = a!.id;
});
beforeEach(async () => {
  await sql.unsafe(`delete from agent_werkzeug`);
});
afterAll(schliessen);

async function schalte(mandant: string, aktiv: boolean): Promise<void> {
  await sql.unsafe(
    `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, ist_aktiv, erfordert_freigabe,
                                 erstellt_von_art)
     values ($1, $2, 'suche_bestand', $3, true, 'system')`, [mandant, ceo, aktiv]);
}

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>, wer = chef, mandant = f.reinigung,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: mandant, benutzerId: wer,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function schritte(aufgabeId: string) {
  return sql.unsafe<{
    werkzeug: string | null; modell: string | null; status: string;
    tokens_eingabe: number; tokens_ausgabe: number; kosten: string; dauer_ms: number;
    eingabe: unknown; ausgabe: unknown;
  }[]>(
    `select werkzeug::text as werkzeug, modell, status::text as status, tokens_eingabe,
            tokens_ausgabe, kosten_mikrocent::text as kosten, dauer_ms, eingabe, ausgabe
       from agent_schritt where agent_aufgabe_id = $1 order by schritt_nr`, [aufgabeId]);
}

describe('(1) eine Frage ist eine Aufgabe mit einem protokollierten Schritt', () => {
  it('Werkzeug, Eingabe, Ausgabe, kein Modell, null Kosten, eine Dauer', async () => {
    await schalte(f.reinigung, true);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    expect(r.bestand).toBe(false);

    const [a] = await sql.unsafe<{
      status: string; vorgang: string; titel: string; ausgeloest: string; von: string;
      schritte: number;
    }[]>(
      `select status::text as status, vorgang_typ::text as vorgang, titel,
              ausgeloest_durch::text as ausgeloest, angefordert_von::text as von,
              schritte_anzahl as schritte
         from agent_aufgabe where id = $1`, [r.aufgabeId]);
    expect(a).toMatchObject({
      status: 'abgeschlossen', vorgang: 'interner_hinweis', ausgeloest: 'mensch', von: chef,
      schritte: 1,
    });
    expect(a!.titel).toContain('Rechnungen');

    const [s] = await schritte(r.aufgabeId);
    expect(s).toMatchObject({
      werkzeug: 'suche_bestand', modell: null, status: 'erfolg',
      tokens_eingabe: 0, tokens_ausgabe: 0, kosten: '0',
      eingabe: { abfrageId: 'offene_rechnungen_anzahl' },
    });
    expect(s!.dauer_ms).toBeGreaterThanOrEqual(0);

    const gelesen = await imKontext((k) => leseFrage(k, r.aufgabeId));
    expect(gelesen?.antwort?.abfrageId).toBe('offene_rechnungen_anzahl');
    expect(gelesen?.antwort?.anzeige).toMatch(/\d/u);
    expect(s!.ausgabe).toMatchObject({ anzeige: gelesen!.antwort!.anzeige });
  });
});

describe('(2) derselbe Schlüssel zweimal ist eine Aufgabe', () => {
  it('ein Doppelklick legt keine zweite an', async () => {
    await schalte(f.reinigung, true);
    const schluessel = zufall();
    const eins = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel, angefordertVon: chef,
    }));
    const zwei = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel, angefordertVon: chef,
    }));
    expect(zwei).toEqual({ aufgabeId: eins.aufgabeId, bestand: true });
    expect(await schritte(eins.aufgabeId)).toHaveLength(1);
  });
});

describe('(3) ohne freigeschaltetes Werkzeug: protokolliert abgewiesen, keine Antwort', () => {
  it('die Aufgabe ist abgebrochen, der Schritt sagt warum', async () => {
    await schalte(f.reinigung, false);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    const [s] = await schritte(r.aufgabeId);
    expect(s).toMatchObject({ werkzeug: 'suche_bestand', status: 'abgelehnt_richtlinie' });
    const gelesen = await imKontext((k) => leseFrage(k, r.aufgabeId));
    expect(gelesen).toMatchObject({ status: 'abgebrochen', antwort: null });
    expect(gelesen?.fehlerText).toContain('nicht freigeschaltet');
  });
});

describe('(4) eine Frage ausserhalb des Katalogs legt nichts an', () => {
  it('Abweisung vor der ersten Zeile', async () => {
    await schalte(f.reinigung, true);
    const [vorher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe`);
    await expect(imKontext((k) => beantworteFrage(k, {
      abfrageId: 'select * from rechnung', schluessel: zufall(), angefordertVon: chef,
    }))).rejects.toBeInstanceOf(AssistentFehler);
    const [nachher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe`);
    expect(nachher!.n).toBe(vorher!.n);
  });
});

describe('(5) die Antwort liest nur die eigene Gesellschaft', () => {
  it('eine Aufgabe der Reinigung ist im Bau nicht lesbar', async () => {
    await schalte(f.reinigung, true);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    const bau = await konto(f.bau, 'admin');
    expect(await imKontext((k) => leseFrage(k, r.aufgabeId), bau, f.bau)).toBeNull();
  });
});
