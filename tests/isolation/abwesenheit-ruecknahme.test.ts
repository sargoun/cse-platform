import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AbwesenheitNichtGefunden, AuBisVorBeginn, meldeAbwesenheit, storniereAbwesenheit,
} from '../../src/server/services/abwesenheit/index.js';

/**
 * **Die eigene Abwesenheit zurücknehmen — und halbe Tage melden**
 * (V-056, V-057, EMP-10, EMP-04, § 5 EFZG).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Zwei Befunde, ein Formular.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **V-056.** `/portal/mein/antraege` listete die eigenen Abwesenheiten als
 * Kacheln ohne Ziel. Darunter lag mehr als ein fehlender Link: `cse_app`
 * hatte auf `abwesenheit` genau EINE UPDATE-Policy — `t_mandant_entscheiden`
 * mit `zeit.abwesenheit_genehmigen`, dem Recht der PLANUNG. Wer sich um 05:40
 * krank gemeldet und dabei den falschen Tag getippt hatte, konnte das nicht
 * zurücknehmen; `storniereAbwesenheit` traf null Zeilen und antwortete 404
 * auf eine Zeile, die der Mensch vor sich sah. `t_selbst_zurueckziehen`
 * (0386) trägt den Weg, in derselben Form wie `antrag.t_selbst_zurueckziehen`
 * (0301).
 *
 * **V-057.** `von_halbtags`, `bis_halbtags`, `au_bescheinigung_vorliegt` und
 * `au_bis` standen seit `0073` in der Tabelle, `rechneTage` zog je halbem
 * Randtag 0,5 ab, die Route las alle vier Felder — **und kein Formular
 * schickte sie.** Wer einen halben Tag krank war, meldete einen ganzen, und
 * die Sollzeitgutschrift im Stundenkonto war um einen halben Tag falsch.
 */

let f: Fixtur;
/** Der Mensch selbst — ein Konto, das an `f.jonas` hängt. */
let jonasKonto = '';
/** Die Planung, die entscheidet. */
let buero = '';
/** Ein zweiter Mensch, dessen Zeile Jonas nicht anfassen darf. */
let fatimaKonto = '';
let artKrank = '';

async function konto(
  email: string, mandant: string, rolle: string, personId: string | null = null,
): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1, $2, $2, 'aktiv', $3)`, [u!.id, email, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  jonasKonto = await konto('abw-jonas@test.invalid', f.reinigung, 'mitarbeiter', f.jonas);
  fatimaKonto = await konto('abw-fatima@test.invalid', f.reinigung, 'mitarbeiter', f.fatima);
  buero = await konto('abw-planung@test.invalid', f.reinigung, 'leitung');

  /* O-139: `bezahlt` ist eine Lohnregel und steht im Katalog auf NULL. Die
     Fixtur beantwortet sie für GENAU EINE Art, damit der Test den WEG messen
     kann statt die offene Frage. */
  const [a] = await alsRolle('', (tx) => tx.unsafe(
    `update abwesenheitsart set bezahlt = true
      where schluessel = 'krankheit' and mandant_id is null
      returning id`),
  ) as unknown as { id: string }[];
  artKrank = a!.id;
});
afterAll(schliessen);

function alsKontext(tx: postgres.TransactionSql, benutzerId: string, portal: 'intern' | 'mitarbeiter'): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal, benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

/** Die Planung — internes Portal, mit `zeit.abwesenheit_melden`. */
function alsPlanung<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.reinigung, benutzerId: buero,
      portal: 'intern', readonly: false,
    },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(alsKontext(tx, buero, 'intern'));
    },
  ) as Promise<T>;
}

/** Der Mensch selbst — Mitarbeiterportal, mit `app.aktuelle_person()`. */
function alsMensch<T>(
  personId: string, benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.reinigung, benutzerId, personId,
      portal: 'mitarbeiter', readonly: false,
    },
    async (tx) => fn(alsKontext(tx, benutzerId, 'mitarbeiter')),
  ) as Promise<T>;
}

interface Roh {
  readonly status: string;
  readonly tage: string | null;
  readonly von_halbtags: boolean;
  readonly bis_halbtags: boolean;
  readonly au: boolean;
  readonly au_bis: string | null;
  readonly storniert_von: string | null;
  readonly storniert_am: string | null;
}

/** Gelesen als EIGENTÜMER: `au_*` gibt die Datenbank `cse_app` nicht heraus. */
async function roh(id: string): Promise<Roh> {
  const [z] = await sql.unsafe<Roh[]>(
    `select status::text as status, tage_angerechnet::text as tage,
            von_halbtags, bis_halbtags,
            au_bescheinigung_vorliegt as au, au_bis::text as au_bis,
            storniert_von::text as storniert_von, storniert_am::text as storniert_am
       from abwesenheit where id = $1`, [id]);
  return z!;
}

async function melde(o: {
  readonly anstellung?: string; readonly von: string; readonly bis: string;
  readonly vonHalbtags?: boolean; readonly bisHalbtags?: boolean;
  readonly au?: boolean; readonly auBis?: string | null;
  readonly status?: 'erfasst' | 'beantragt';
}): Promise<string> {
  const zeile = await alsPlanung((k) => meldeAbwesenheit(k, {
    anstellungId: o.anstellung ?? f.jonasReinigung,
    abwesenheitsartId: artKrank,
    von: o.von, bis: o.bis,
    vonHalbtags: o.vonHalbtags ?? false,
    bisHalbtags: o.bisHalbtags ?? false,
    auBescheinigungVorliegt: o.au ?? false,
    auBis: o.auBis ?? null,
    status: o.status ?? 'erfasst',
  }));
  return zeile.id;
}

describe('§1 halbe Randtage — die Zahl, die im Stundenkonto ankommt (V-057)', () => {
  it('fünf Werktage ohne halbe Ränder sind fünf Tage', async () => {
    /* Mo 2026-06-01 bis Fr 2026-06-05. */
    const id = await melde({ von: '2026-06-01', bis: '2026-06-05' });
    expect(Number((await roh(id)).tage)).toBe(5);
  });

  it('ein halber erster Tag macht 4,5', async () => {
    const id = await melde({ von: '2026-06-08', bis: '2026-06-12', vonHalbtags: true });
    const z = await roh(id);
    expect(Number(z.tage)).toBe(4.5);
    expect(z.von_halbtags).toBe(true);
  });

  it('beide Ränder halb machen 4', async () => {
    const id = await melde({
      von: '2026-06-15', bis: '2026-06-19', vonHalbtags: true, bisHalbtags: true,
    });
    const z = await roh(id);
    expect(Number(z.tage)).toBe(4);
    expect(z.bis_halbtags).toBe(true);
  });

  /**
   * **Ein einziger halber Tag ist ein halber Tag und nicht null.** `rechneTage`
   * zieht `bisHalbtags` nur ab, wenn `bis <> von` — sonst wäre derselbe Tag
   * zweimal halbiert und die Meldung zählte null.
   */
  it('ein einziger Tag, halb gemeldet, zählt 0,5 — nicht 0', async () => {
    const id = await melde({
      von: '2026-06-22', bis: '2026-06-22', vonHalbtags: true, bisHalbtags: true,
    });
    expect(Number((await roh(id)).tage)).toBe(0.5);
  });
});

describe('§2 die AU-Bescheinigung — vier Felder, die kein Formular schickte (V-057)', () => {
  it('Vermerk und Frist kommen in der Zeile an', async () => {
    const id = await melde({
      von: '2026-07-06', bis: '2026-07-10', au: true, auBis: '2026-07-10',
    });
    const z = await roh(id);
    expect(z.au).toBe(true);
    expect(z.au_bis).toBe('2026-07-10');
  });

  it('ohne Vermerk bleibt die Meldung gültig — die Personalstelle fragt nach', async () => {
    const id = await melde({ von: '2026-07-13', bis: '2026-07-14' });
    const z = await roh(id);
    expect(z.au).toBe(false);
    expect(z.au_bis).toBeNull();
  });

  /**
   * `ab_au_bis check (au_bis is null or au_bis >= von)` — 0073.
   *
   * Seit V-188 prüft der Dienst dieselbe Regel VOR dem Schreiben und antwortet
   * mit einem Satz (`AuBisVorBeginn`) statt mit dem `check_violation`, der auf
   * dem Weg der Arbeiterin eine rohe 500 war. Abgewiesen wird weiterhin — und
   * es entsteht keine Zeile. Die zweite Linie in der Datenbank prüft
   * `meldung-rueckweg.test.ts` („die zweite Linie bleibt"), am Dienst vorbei.
   */
  it('eine Bescheinigung, die vor dem ersten Tag endet, wird abgewiesen', async () => {
    const vorher = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from abwesenheit where von = '2026-07-20'`);
    await expect(melde({
      von: '2026-07-20', bis: '2026-07-24', au: true, auBis: '2026-07-19',
    })).rejects.toBeInstanceOf(AuBisVorBeginn);
    const nachher = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from abwesenheit where von = '2026-07-20'`);
    expect(nachher[0]!.n).toBe(vorher[0]!.n);
  });
});

describe('§3 die eigene Rücknahme (V-056)', () => {
  it('der Mensch nimmt seine eigene, unentschiedene Meldung zurück', async () => {
    const id = await melde({ von: '2026-08-03', bis: '2026-08-04' });
    await alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, 'Datum vertippt'));
    const z = await roh(id);
    expect(z.status).toBe('storniert');
    expect(z.storniert_von).toBe(jonasKonto);
    expect(z.storniert_am).not.toBeNull();
  });

  it('der Grund steht im Protokoll und nicht in `bemerkung`', async () => {
    const id = await melde({ von: '2026-08-10', bis: '2026-08-11' });
    await alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, 'Doch nicht krank'));
    const zeilen = await sql.unsafe<{ aktion: string; nachher: { grund?: string } | null }[]>(
      `select aktion, nachher from audit_log
        where objekt_typ = 'abwesenheit' and objekt_id = $1
          and aktion = 'personal.abwesenheit_storniert'`, [id]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.nachher?.grund).toBe('Doch nicht krank');
  });

  /**
   * **Die USING-Hälfte.** Über eine genehmigte Abwesenheit hat jemand
   * entschieden — über Lohnfortzahlung und Urlaubskonto. Sie still zu
   * entwerten ist keine Rücknahme; sie bleibt der Personalstelle.
   */
  it('eine GENEHMIGTE Abwesenheit nimmt der Mensch nicht selbst zurück', async () => {
    const id = await melde({ von: '2026-08-17', bis: '2026-08-18', status: 'beantragt' });
    await alsPlanung((k) => k.schreibe(
      `update abwesenheit set status = 'genehmigt', genehmigt_von = $2::uuid
        where id = $1::uuid`, [id, buero]));

    await expect(alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, 'Doch nicht'))).rejects
      .toBeInstanceOf(AbwesenheitNichtGefunden);
    expect((await roh(id)).status).toBe('genehmigt');
  });

  /**
   * **Die WITH-CHECK-Hälfte, gegen die ROLLE.** Hier steht kein Dienst
   * dazwischen: eine Selbstgenehmigung ist in dieser Policy nicht
   * formulierbar.
   */
  it('eine Selbstgenehmigung fällt an der Policy, nicht am Dienst', async () => {
    const id = await melde({ von: '2026-08-24', bis: '2026-08-25', status: 'beantragt' });
    await expect(alsMensch(f.jonas, jonasKonto, (k) => k.schreibe(
      `update abwesenheit set status = 'genehmigt' where id = $1::uuid`, [id])))
      .rejects.toThrow(/row-level security|row level security/iu);
    expect((await roh(id)).status).toBe('beantragt');
  });

  it('eine FREMDE Abwesenheit gibt es für den Menschen nicht (AUT-06)', async () => {
    const id = await melde({ anstellung: f.fatimaReinigung, von: '2026-09-07', bis: '2026-09-08' });
    await expect(alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, 'Nicht meine'))).rejects
      .toBeInstanceOf(AbwesenheitNichtGefunden);
    expect((await roh(id)).status).toBe('erfasst');

    /* Und dieselbe Zeile nimmt ihre Eigentümerin sehr wohl zurück. */
    await alsMensch(f.fatima, fatimaKonto, (k) =>
      storniereAbwesenheit(k, id, 'Datum vertippt'));
    expect((await roh(id)).status).toBe('storniert');
  });

  it('zweimal zurücknehmen ist kein zweiter Vorgang', async () => {
    const id = await melde({ von: '2026-09-14', bis: '2026-09-15' });
    await alsMensch(f.jonas, jonasKonto, (k) => storniereAbwesenheit(k, id, 'Vertippt'));
    await expect(alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, 'Vertippt'))).rejects
      .toBeInstanceOf(AbwesenheitNichtGefunden);
  });

  it('ohne Grund geht es nicht — der Grund ist die Auskunft', async () => {
    const id = await melde({ von: '2026-09-21', bis: '2026-09-22' });
    await expect(alsMensch(f.jonas, jonasKonto, (k) =>
      storniereAbwesenheit(k, id, '   '))).rejects.toThrow();
    expect((await roh(id)).status).toBe('erfasst');
  });

  /**
   * Die Gegenprobe zur Policy: die PLANUNG darf weiterhin alles, was sie
   * vorher durfte — `t_mandant_entscheiden` steht unverändert daneben.
   */
  it('die Planung storniert weiter, auch eine genehmigte Abwesenheit', async () => {
    const id = await melde({ von: '2026-10-05', bis: '2026-10-06', status: 'beantragt' });
    await alsPlanung((k) => k.schreibe(
      `update abwesenheit set status = 'genehmigt', genehmigt_von = $2::uuid
        where id = $1::uuid`, [id, buero]));
    await alsPlanung((k) => storniereAbwesenheit(k, id, 'Vom Büro zurückgenommen'));
    expect((await roh(id)).status).toBe('storniert');
  });
});
