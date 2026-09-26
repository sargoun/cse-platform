/**
 * Der strukturierte Kandidatendatensatz gegen echtes Postgres (REC-04,
 * V-223, D-717).
 *
 * **Der Befund.** `kandidat` hatte keinen Schreiber, auch nicht im Seed, und
 * keine Seite zeigte ihn. Geprüft wird hier, was nur die Datenbank beweist:
 * dass ein Datensatz erst mit der Bestätigung eines Menschen gilt (Zeitpunkt
 * der DATENBANK), dass jede Änderung die Bestätigung zurücknimmt, dass ein
 * Vorschlag des Agenten unbestätigt und als `agent` dasteht — und dass ohne
 * brauchbares Modell NICHTS entsteht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bestaetigeKandidat, erfasseKandidat, ladeKandidat, legeVorschlagAb, schlageKandidatVor,
} from '../../src/server/services/recruiting/kandidat.js';
import { KANDIDAT_KENNZEICHEN, seedKandidat } from '../../src/server/db/seed/kandidat.js';

let f: Fixtur;
let leitung = '';
let bewerbung = '';
const zufall = (): string => String(Math.random()).slice(2, 10);
const LAUF = { schluessel: 'test', codeVersion: 'test' };

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `kandidat-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Leitung Kandidat','aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

function als<T>(
  fn: (k: SchreibKontext) => Promise<T>, wer = leitung, mandant = f.reinigung,
): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: wer,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, wer, mandant)));
}

async function schalteAgentEin(): Promise<void> {
  await sql.unsafe(`update agent set ist_aktiv = true where kennung = 'backoffice'`);
}

async function legeBudgetAn(): Promise<void> {
  await sql.unsafe(
    `insert into agent_budget
       (mandant_id, geltungsbereich, jahr, monat, budget_cent, ist_platzhalter,
        erstellt_von_art, erstellt_von_dienst)
     values ($1::uuid, 'mandant',
             extract(year  from (now() at time zone 'Europe/Berlin'))::integer,
             extract(month from (now() at time zone 'Europe/Berlin'))::integer,
             5000, true, 'system', 'job:test')
     on conflict do nothing`, [f.reinigung]);
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung, 'admin');
  const [bw] = await sql.unsafe<{ id: string }[]>(
    `insert into bewerbung (mandant_id, name, email, quelle, status, nachricht, aufbewahrung_bis)
     values ($1, 'Agnieszka Nowak', 'nowak@kandidat.test', 'initiativ', 'eingegangen',
             'Ich arbeite seit 7 Jahren in der Unterhaltsreinigung und spreche Deutsch und Polnisch.',
             current_date + 180)
     returning id`, [f.reinigung]);
  bewerbung = bw!.id;
});
afterAll(schliessen);

describe('(1) ein Mensch erfasst — der Datensatz gilt erst mit Bestätigung', () => {
  it('erfassen legt unbestätigt an; bestätigen setzt Zeitpunkt der Datenbank und Person', async () => {
    await erfasse();
    let k = await als((kt) => ladeKandidat(kt, bewerbung));
    expect(k).toMatchObject({
      quelleArt: 'mensch', qualifikationen: ['Unterhaltsreinigung'],
      sprachen: ['Deutsch', 'Polnisch'], erfahrungJahre: 7, bestaetigtAm: null,
    });

    await als((kt) => bestaetigeKandidat(kt, bewerbung));
    k = await als((kt) => ladeKandidat(kt, bewerbung));
    expect(k!.bestaetigtAm).toBeInstanceOf(Date);
    expect(k!.bestaetigtVon).toBe('Leitung Kandidat');
    const [z] = await sql.unsafe<{ frisch: boolean }[]>(
      `select bestaetigt_am > now() - interval '1 minute' as frisch
         from kandidat where bewerbung_id = $1`, [bewerbung]);
    expect(z!.frisch).toBe(true);

    await expect(als((kt) => bestaetigeKandidat(kt, bewerbung)))
      .rejects.toMatchObject({ grund: 'schon_bestaetigt' });
  });

  it('jede Änderung nimmt die Bestätigung zurück — bestätigt war der alte Stand', async () => {
    await erfasse();
    await als((kt) => bestaetigeKandidat(kt, bewerbung));
    await als((kt) => erfasseKandidat(kt, bewerbung, {
      qualifikationen: ['Unterhaltsreinigung', 'Glasreinigung'], sprachen: ['Deutsch'],
      erfahrungJahre: null, notiz: null,
    }));
    const k = await als((kt) => ladeKandidat(kt, bewerbung));
    expect(k).toMatchObject({ bestaetigtAm: null, bestaetigtVon: null, erfahrungJahre: null });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from kandidat where bewerbung_id = $1`, [bewerbung]);
    expect(n!.n).toBe(1);
  });

  it('ohne Datensatz gibt es nichts zu bestätigen; unsinnige Jahre werden abgewiesen', async () => {
    await expect(als((kt) => bestaetigeKandidat(kt, bewerbung)))
      .rejects.toMatchObject({ grund: 'kein_datensatz' });
    await expect(als((kt) => erfasseKandidat(kt, bewerbung, {
      qualifikationen: [], sprachen: [], erfahrungJahre: 61, notiz: null,
    }))).rejects.toMatchObject({ grund: 'unbrauchbare_jahre' });
  });

  it('eine Bewerbung einer anderen Gesellschaft ist unbekannt (AUT-06)', async () => {
    const fremd = await konto(f.security, 'admin');
    await expect(als((kt) => erfasseKandidat(kt, bewerbung, {
      qualifikationen: ['x'], sprachen: [], erfahrungJahre: null, notiz: null,
    }), fremd, f.security)).rejects.toMatchObject({ grund: 'unbekannt' });
  });
});

describe('(2) der Agent liest aus — unbestätigt, und ohne brauchbares Modell entsteht nichts', () => {
  it('der Vorschlag steht als agent und unbestätigt da, mit der Aufgabe im Protokoll', async () => {
    const id = await als((kt) => legeVorschlagAb(kt, bewerbung, {
      qualifikationen: ['Unterhaltsreinigung'], sprachen: ['Polnisch'], erfahrungJahre: 7,
      notiz: null,
    }, '00000000-0000-4000-8000-00000000abcd'));
    const k = await als((kt) => ladeKandidat(kt, bewerbung));
    expect(k).toMatchObject({ id, quelleArt: 'agent', bestaetigtAm: null });
    const [p] = await sql.unsafe<{ nachher: Record<string, unknown> }[]>(
      `select nachher from audit_log where objekt_typ = 'kandidat' and objekt_id = $1
          and aktion = 'recruiting.kandidat_vorgeschlagen'`, [id]);
    expect(p!.nachher['aufgabe_id']).toBe('00000000-0000-4000-8000-00000000abcd');
  });

  it('einen bestätigten Datensatz überschreibt kein Vorschlag', async () => {
    await erfasse();
    await als((kt) => bestaetigeKandidat(kt, bewerbung));
    await expect(als((kt) => legeVorschlagAb(kt, bewerbung, {
      qualifikationen: ['anders'], sprachen: [], erfahrungJahre: null, notiz: null,
    }, '00000000-0000-4000-8000-00000000abcd')))
      .rejects.toMatchObject({ grund: 'schon_bestaetigt' });
    await expect(als((kt) => schlageKandidatVor(kt, bewerbung, LAUF)))
      .rejects.toMatchObject({ grund: 'schon_bestaetigt' });
  });

  it('der Agent ist aus (D-435): kein Lauf, kein Datensatz', async () => {
    await sql.unsafe(`update agent set ist_aktiv = false where kennung = 'backoffice'`);
    const e = await als((kt) => schlageKandidatVor(kt, bewerbung, LAUF));
    expect(e).toMatchObject({ art: 'gestoert', code: 'AGENT_INAKTIV' });
    expect(await als((kt) => ladeKandidat(kt, bewerbung))).toBeNull();
  });

  it('der Demobetrieb liest nichts aus: die Aufgabe scheitert sichtbar, gespeichert wird nichts', async () => {
    await schalteAgentEin();
    await legeBudgetAn();
    const e = await als((kt) => schlageKandidatVor(kt, bewerbung, LAUF));
    expect(e.art).toBe('gestoert');
    expect(await als((kt) => ladeKandidat(kt, bewerbung))).toBeNull();
    const [a] = await sql.unsafe<{ status: string; fehler: string | null }[]>(
      `select status::text as status, fehler_text as fehler from agent_aufgabe
        where mandant_id = $1 and idempotenz_schluessel = 'kandidat:test'`, [f.reinigung]);
    expect(a!.status).toBe('fehlgeschlagen');
    expect(a!.fehler).toBeTruthy();
  });

  it('eine Bewerbung ohne Text hat nichts, was sich auslesen liesse', async () => {
    await sql.unsafe(`update bewerbung set nachricht = null where id = $1`, [bewerbung]);
    await expect(als((kt) => schlageKandidatVor(kt, bewerbung, LAUF)))
      .rejects.toMatchObject({ grund: 'ohne_quelle' });
  });
});

describe('(3) der Seed zeigt beide Stände — über die Dienste', () => {
  it('ein bestätigter und ein unbestätigter Datensatz; ein zweiter Lauf legt nichts nach', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    expect(await seedKandidat(sql, ids, false)).toEqual({ erfasst: 0, bestaetigt: 0 });
    await sql.unsafe(
      `insert into bewerbung (mandant_id, name, email, quelle, status, nachricht, aufbewahrung_bis)
       values ($1, 'Jan Kowalski', 'seed@kandidat.test', 'initiativ', 'eingegangen',
               'Objektbetreuung seit 2019.', current_date + 90)`,
      [f.reinigung]);
    expect(await seedKandidat(sql, ids, true)).toEqual({ erfasst: 2, bestaetigt: 1 });
    const zeilen = await sql.unsafe<{ bestaetigt: boolean; quelle: string }[]>(
      `select bestaetigt_am is not null as bestaetigt, quelle_art::text as quelle
         from kandidat where mandant_id = $1 and notiz like '%' || $2 || '%'
        order by bestaetigt_am nulls last`, [f.reinigung, KANDIDAT_KENNZEICHEN]);
    expect(zeilen.map((z) => z.bestaetigt)).toEqual([true, false]);
    expect(zeilen.every((z) => z.quelle === 'mensch')).toBe(true);
    expect(await seedKandidat(sql, ids, true)).toEqual({ erfasst: 0, bestaetigt: 0 });
  });
});

async function erfasse(): Promise<void> {
  await als((kt) => erfasseKandidat(kt, bewerbung, {
    qualifikationen: ['Unterhaltsreinigung'], sprachen: ['Deutsch', 'Polnisch'],
    erfahrungJahre: 7, notiz: 'Aus der Nachricht übernommen.',
  }));
}
