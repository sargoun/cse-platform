/**
 * Die Einladung eines Verwaltungskontos gegen echtes Postgres
 * (AUT-04, AUT-02, D-610, K-04, 0372).
 *
 * **Der Befund, den diese Datei schliesst.** Die einzige Stelle, die in
 * `benutzer` schrieb, war der SEED — keine Einladungsroute, kein Formular,
 * keine API. Ein neuer Admin liess sich nur durch einen erneuten Seed-Lauf
 * einsetzen, auf einer Produktionsdatenbank also gar nicht. Und das Schema
 * erwartete die Einladung die ganze Zeit: `benutzer.status` steht auf
 * `'eingeladen'`, ein Zustand, den nichts erzeugen konnte.
 *
 * **Was hier wirklich geprueft wird, ist D-610.** Dass ein Konto entsteht,
 * ist die leichte Haelfte. Die schwere ist, dass es NUR der Super-Admin kann:
 * `system.verwaltungskonto_erstellen` ist `nur_global`, und ein `nur_global`-
 * Recht wird ausschliesslich ueber `benutzer.globale_rolle_id` ausgewertet
 * (0169). Ein Admin bekommt hier also `false` — auch in seiner eigenen
 * Gesellschaft. Ohne diesen Fall waere die Trennlinie eine Behauptung.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  EinladungFehler, ladeVerwaltungskontoEin, stelleLinkNeuAus, wechsleVerwaltungsrolle,
} from '../../src/server/services/system/verwaltungskonto.js';

let f: Fixtur;
let chef = '';      // super_admin, global
let admin = '';     // admin der Reinigung
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

/** Ein Super-Admin: globale Rolle — und erst der zweite Faktor, dann die Rolle. */
async function superAdmin(): Promise<string> {
  const b = await konto('chef');
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [b]);
  await sql.unsafe(`update benutzer set globale_rolle_id = $1 where id = $2`,
    [await rolleId('super_admin'), b]);
  return b;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)]);
}

function kontextAus(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(b: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  aal: 'aal1' | 'aal2' = 'aal2'): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: b,
           portal: 'intern', readonly: false, aal }, fn);

const einladen = (b: string, rolle: 'admin' | 'leitung' = 'admin',
  aal: 'aal1' | 'aal2' = 'aal2', email = `neu-${zufall()}@cse.test`) =>
  als(b, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, b), {
    mandantId: f.reinigung, email, name: 'Neue Verwaltung', rolle,
  }), aal);

beforeEach(async () => {
  f = await seed();
  chef = await superAdmin();
  admin = await konto('admin');
  await mitglied(admin, f.reinigung, 'admin');
});
afterAll(schliessen);

describe('(1) D-610 — nur der Super-Admin laedt ein', () => {
  it('der Super-Admin kann es', async () => {
    const e = await einladen(chef);
    expect(e.ok, e.grund).toBe(true);
    expect(e.grund).toBe('eingeladen');
    expect(e.neuesKonto).toBe(true);
    /* Der Klartext kommt GENAU EINMAL zurueck; gespeichert ist nur sein Hash. */
    expect(e.token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
  });

  /*
   * Der Fall, der die Entscheidung traegt. Ein Admin der Reinigung steht in
   * SEINER eigenen Gesellschaft und darf trotzdem nicht: `nur_global` wertet
   * nur die globale Rolle aus (0169). Faellt dieser Test, ist D-610 wieder
   * eine Behauptung in einem Dokument.
   */
  it('ein Admin der Gesellschaft kann es NICHT — auch in seiner eigenen', async () => {
    /*
     * D-774: die Absage der Datenbank (42501) kommt als `EinladungFehler` mit
     * dem Grund `nicht_erlaubt` — ihr Satz steht als `cause` daran und wird
     * unverändert geprüft; nur auf den Schirm geht er nicht mehr.
     */
    await expect(einladen(admin)).rejects.toSatisfy((e: unknown) =>
      e instanceof EinladungFehler && e.grund === 'nicht_erlaubt'
      && /verwaltungskonto_erstellen|berechtigt|privilege/iu.test(
        String((e.cause as { message?: unknown } | undefined)?.message)));
  });

  it('ohne zweiten Faktor gar nicht (AUT-02)', async () => {
    /* Seit V-136 (0395) gewährt super_admin ohne aal2 nichts — die Rechtefrage
       weist dann schon vor der Stufenprüfung ab. Beides ist AUT-02. */
    await expect(einladen(chef, 'admin', 'aal1')).rejects.toSatisfy((e: unknown) =>
      e instanceof EinladungFehler && e.grund === 'nicht_erlaubt'
      && /zweitem Faktor|aal2|privilege|verwaltungskonto_erstellen fehlt/iu.test(
        String((e.cause as { message?: unknown } | undefined)?.message)));
  });
});

describe('(2) was entsteht — und in welchem Zustand', () => {
  it('Konto `eingeladen`, Mitgliedschaft mit der gewaehlten Rolle, ein offener Token', async () => {
    const email = `neu-${zufall()}@cse.test`;
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Neue Leitung', rolle: 'leitung',
    }));
    expect(e.ok, e.grund).toBe(true);

    const [b] = await sql.unsafe<{ status: string; name: string }[]>(
      `select status::text as status, name from benutzer where id = $1`, [e.kontoId]);
    /* Genau der Zustand, den die Benutzerverwaltung als „Wartet" zeigt und den
       vor dieser Migration nichts erzeugen konnte. */
    expect(b?.status).toBe('eingeladen');
    expect(b?.name).toBe('Neue Leitung');

    const [m] = await sql.unsafe<{ schluessel: string }[]>(
      `select r.schluessel from benutzer_mandant bm
         join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null`,
      [e.kontoId, f.reinigung]);
    expect(m?.schluessel).toBe('leitung');

    const [t] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*) as anzahl from kern.kennwort_token
        where benutzer_id = $1 and zweck = 'einladung' and eingeloest_am is null`,
      [e.kontoId]);
    expect(Number(t?.anzahl)).toBe(1);
  });

  it('eine zweite Einladung entwertet die erste — nie zwei gueltige (0155)', async () => {
    const email = `neu-${zufall()}@cse.test`;
    const eins = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Doppelt', rolle: 'admin',
    }));
    expect(eins.ok, eins.grund).toBe(true);

    /* Dieselbe Adresse, dieselbe Gesellschaft: der Vorgang sagt, dass das
       Konto schon eingetragen ist, statt eine zweite Mitgliedschaft zu bauen. */
    const zwei = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email, name: 'Doppelt', rolle: 'admin',
    }));
    expect(zwei.ok).toBe(false);
    /* D-774: der Satz der Datenbank ist hier ein Schlüssel — die Seite hat den Satz. */
    expect(zwei.grund).toBe('schon_eingetragen');
  });
});

describe('(3) die Grenzen, die das Tor eng halten', () => {
  it('`super_admin` ist ueber diesen Weg NICHT einladbar (O-887)', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `x-${zufall()}@cse.test`, name: 'Zweiter Chef',
      /* Bewusst am Typ vorbei: die Sperre muss in der DATENBANK halten und
         nicht erst im TypeScript, sonst haelt sie nicht gegen die Route. */
      rolle: 'super_admin' as never,
    }));
    expect(e.ok).toBe(false);
    /* D-774: vorher der Satz der Datenbank („nur `admin` und `leitung`"), jetzt sein Schlüssel. */
    expect(e.grund).toBe('rolle_unzulaessig');
  });

  it('`mitarbeiter` ebenfalls nicht — dafuer gibt es den Personalweg', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `y-${zufall()}@cse.test`, name: 'Kein Arbeiter',
      rolle: 'mitarbeiter' as never,
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toBe('rolle_unzulaessig');
  });

  it('eine unbrauchbare Adresse legt kein Konto an', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: 'kein-at-zeichen', name: 'X', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toBe('email_ungueltig');
    expect(e.kontoId).toBeNull();
  });

  it('ein Konto ohne Namen auch nicht — der Name steht in jedem Protokoll', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: `z-${zufall()}@cse.test`, name: '   ', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toBe('name_fehlt');
  });

  /*
   * D-774: die übrigen zwei Sätze der Datenbank finden ebenfalls ihren
   * Schlüssel. Ein Satz, den der Dienst nicht kennt, würde zum allgemeinen
   * `nicht_ausgestellt` — dieser Fall prüft, dass 0372 und die Liste im Dienst
   * nicht auseinanderlaufen.
   */
  it('eine Gesellschaft, die es nicht gibt: `gesellschaft_fehlt`', async () => {
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: '00000000-0000-4000-8000-00000000abcd', email: `g-${zufall()}@cse.test`,
      name: 'Niemand', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toBe('gesellschaft_fehlt');
  });

  it('ein Kundenkonto wird kein Verwaltungskonto: `kundenkonto` (K-04)', async () => {
    const kunde = await konto('kunde');
    await mitglied(kunde, f.reinigung, 'kunde');
    const [b] = await sql.unsafe<{ email: string }[]>(
      `select email from benutzer where id = $1`, [kunde]);
    const e = await als(chef, (tx) => ladeVerwaltungskontoEin(kontextAus(tx, chef), {
      mandantId: f.reinigung, email: b!.email, name: 'Kunde', rolle: 'admin',
    }));
    expect(e.ok).toBe(false);
    expect(e.grund).toBe('kundenkonto');
  });
});

/**
 * **Neuer Link und Rollenwechsel** (V-302, O-980, O-981, D-821, 0517).
 *
 * Bis 0517 gab es für einen verlorenen oder abgelaufenen Link keinen neuen —
 * eine zweite Einladung derselben Adresse wies die Datenbank ab —, und die
 * Rolle einer Mitgliedschaft änderte kein Weg. Geprüft wird an echtem
 * Postgres: wer darf (nur die Super-Administration mit zweitem Faktor), was
 * verfällt (jeder offene Link), welcher Zweck (Einladung oder Kennwort), was
 * im Protokoll steht, und die Grenzen — kein fremdes Konto, kein eigenes,
 * keine fremde Rolle.
 */
describe('(4) V-302 — einen neuen Link ausstellen', () => {
  async function offeneTokens(b: string): Promise<{ zweck: string; n: number }[]> {
    return sql.unsafe<{ zweck: string; n: number }[]>(
      `select zweck, count(*)::int as n from kern.kennwort_token
        where benutzer_id = $1 and eingeloest_am is null group by zweck order by zweck`, [b]);
  }

  it('für eine wartende Einladung: ein neuer Einladungslink, der alte verfällt — protokolliert', async () => {
    const e = await einladen(chef);
    expect(e.ok).toBe(true);
    const neu = await als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), e.kontoId!));
    expect(neu).toMatchObject({ ok: true, zweck: 'einladung' });
    expect(neu.ok && neu.token).not.toBe(e.token);
    expect(await offeneTokens(e.kontoId!)).toEqual([{ zweck: 'einladung', n: 1 }]);
    const [z] = await sql.unsafe<{ nachher: Record<string, unknown> }[]>(
      `select nachher from audit_log where aktion = 'system.verwaltungskonto_link_neu'
        and objekt_id = $1`, [e.kontoId!]);
    expect(z!.nachher).toMatchObject({ zweck: 'einladung' });
  });

  it('für ein aktives Konto: ein Kennwortlink — jeder offene Link verfällt', async () => {
    const leitung = await konto('leitung');
    await mitglied(leitung, f.reinigung, 'leitung');
    await sql.unsafe(
      `insert into kern.kennwort_token (benutzer_id, zweck, token_hash, gueltig_bis)
       values ($1, 'zuruecksetzen', repeat('c', 64), now() + interval '1 day')`, [leitung]);
    const neu = await als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), leitung));
    expect(neu).toMatchObject({ ok: true, zweck: 'zuruecksetzen' });
    expect(await offeneTokens(leitung)).toEqual([{ zweck: 'zuruecksetzen', n: 1 }]);
    /* Gültig wie ein Zurücksetzungslink (auth.zuruecksetzung_stunden), nicht wie eine Einladung. */
    const [frist] = await sql.unsafe<{ passt: boolean }[]>(
      `select abs(extract(epoch from (t.gueltig_bis - now()))
                  - 3600 * coalesce((app.plattform_einstellung('auth.zuruecksetzung_stunden'))::int, 2))
              < 120 as passt
         from kern.kennwort_token t
        where t.benutzer_id = $1 and t.eingeloest_am is null`, [leitung]);
    expect(frist!.passt).toBe(true);
    const [alt] = await sql.unsafe<{ eingeloest: boolean }[]>(
      `select eingeloest_am is not null as eingeloest from kern.kennwort_token
        where token_hash = repeat('c', 64)`);
    expect(alt!.eingeloest).toBe(true);
  });

  it('kein Verwaltungskonto, gesperrt, deaktiviert: ein Schlüssel — und kein Token', async () => {
    const mitarbeiter = await konto('mitarbeiter');
    await mitglied(mitarbeiter, f.reinigung, 'mitarbeiter');
    expect(await als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), mitarbeiter)))
      .toEqual({ ok: false, grund: 'kein_verwaltungskonto' });

    const gesperrt = await konto('gesperrt');
    await mitglied(gesperrt, f.reinigung, 'leitung');
    await sql.unsafe(`update benutzer set status = 'gesperrt' where id = $1`, [gesperrt]);
    expect(await als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), gesperrt)))
      .toEqual({ ok: false, grund: 'gesperrt' });

    const weg = await konto('weg');
    await mitglied(weg, f.reinigung, 'admin');
    await sql.unsafe(
      `update benutzer set status = 'deaktiviert', deaktiviert_am = now() where id = $1`, [weg]);
    expect(await als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), weg)))
      .toEqual({ ok: false, grund: 'deaktiviert' });

    for (const b of [mitarbeiter, gesperrt, weg]) expect(await offeneTokens(b)).toEqual([]);
  });

  it('ein Admin der Gesellschaft nicht, und nicht ohne zweiten Faktor', async () => {
    const leitung = await konto('leitung');
    await mitglied(leitung, f.reinigung, 'leitung');
    await expect(als(admin, (tx) => stelleLinkNeuAus(kontextAus(tx, admin), leitung)))
      .rejects.toSatisfy((e: unknown) => e instanceof EinladungFehler && e.grund === 'nicht_erlaubt');
    await expect(als(chef, (tx) => stelleLinkNeuAus(kontextAus(tx, chef), leitung), 'aal1'))
      .rejects.toSatisfy((e: unknown) => e instanceof EinladungFehler && e.grund === 'nicht_erlaubt');
    expect(await offeneTokens(leitung)).toEqual([]);
  });
});

describe('(5) V-302 — die Rolle wechseln', () => {
  async function rolle(b: string): Promise<string> {
    const [r] = await sql.unsafe<{ s: string }[]>(
      `select r.schluessel as s from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null`,
      [b, f.reinigung]);
    return r!.s;
  }

  it('Leitung wird Administration und zurück — protokolliert mit alt und neu', async () => {
    const leitung = await konto('leitung');
    await mitglied(leitung, f.reinigung, 'leitung');
    expect(await als(chef, (tx) => wechsleVerwaltungsrolle(kontextAus(tx, chef), leitung, 'admin')))
      .toEqual({ ok: true, grund: 'gewechselt' });
    expect(await rolle(leitung)).toBe('admin');
    const [z] = await sql.unsafe<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> }[]>(
      `select vorher, nachher from audit_log
        where aktion = 'system.verwaltungskonto_rolle_gewechselt' order by id desc limit 1`);
    expect([z!.vorher['rolle'], z!.nachher['rolle']]).toEqual(['leitung', 'admin']);

    expect(await als(chef, (tx) => wechsleVerwaltungsrolle(kontextAus(tx, chef), leitung, 'admin')))
      .toEqual({ ok: true, grund: 'unveraendert' });
    expect(await als(chef, (tx) => wechsleVerwaltungsrolle(kontextAus(tx, chef), leitung, 'leitung')))
      .toEqual({ ok: true, grund: 'gewechselt' });
    expect(await rolle(leitung)).toBe('leitung');
  });

  it('nie zur Super-Administration, nie am eigenen Konto, nie an einem Mitarbeiterkonto', async () => {
    const leitung = await konto('leitung');
    await mitglied(leitung, f.reinigung, 'leitung');
    const roh = (wer: string, ziel: string, r: string) => als(wer, (tx) => tx.unsafe<{ ok: boolean; grund: string }[]>(
      `select ok, grund from app.verwaltungskonto_rolle_wechseln($1::uuid, $2)`, [ziel, r]));
    expect((await roh(chef, leitung, 'super_admin'))[0]).toEqual({ ok: false, grund: 'rolle_unzulaessig' });
    await mitglied(chef, f.reinigung, 'admin');
    expect((await roh(chef, chef, 'leitung'))[0]).toEqual({ ok: false, grund: 'selbst' });
    const mitarbeiter = await konto('mitarbeiter');
    await mitglied(mitarbeiter, f.reinigung, 'mitarbeiter');
    expect((await roh(chef, mitarbeiter, 'admin'))[0])
      .toEqual({ ok: false, grund: 'kein_verwaltungskonto' });
    expect(await rolle(mitarbeiter)).toBe('mitarbeiter');
  });

  it('ein Admin der Gesellschaft nicht — und cse_app schreibt die Rolle nicht direkt um', async () => {
    const leitung = await konto('leitung');
    await mitglied(leitung, f.reinigung, 'leitung');
    await expect(als(admin, (tx) => wechsleVerwaltungsrolle(kontextAus(tx, admin), leitung, 'admin')))
      .rejects.toSatisfy((e: unknown) => e instanceof EinladungFehler && e.grund === 'nicht_erlaubt');
    await expect(als(chef, (tx) => tx.unsafe(
      `update benutzer_mandant set rolle_id = (select id from rolle where schluessel = 'admin'
                                               and mandant_id is null)
        where benutzer_id = $1`, [leitung])))
      .rejects.toThrow();
    expect(await rolle(leitung)).toBe('leitung');
  });
});
