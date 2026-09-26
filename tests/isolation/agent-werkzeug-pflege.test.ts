import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  WerkzeugPflegeFehler, setzeWerkzeug,
} from '../../src/server/services/agent/werkzeug-pflege.js';
import {
  WerkzeugNichtFreigeschaltet, verlangeWerkzeug, werkzeugStand,
} from '../../src/server/agent/tools/freischaltung.js';

/**
 * Werkzeuge pflegen — und das Tor, das den Stand zur Laufzeit gelten lässt
 * (AGT-01, AGT-02, Invariante 7, V-228, D-722).
 *
 *  1. Ohne `agent.werkzeug_verbinden` wird nichts gesetzt — ein Satz, keine
 *     Constraint-Verletzung.
 *  2. Mit dem Recht entsteht die Zeile, ein zweites Setzen ändert sie, und
 *     jedes Setzen steht im Protokoll.
 *  3. Nur Paare aus dem Register, und Versand nie ohne Freigabe.
 *  4. Das Tor liest den Stand der EIGENEN Gesellschaft: eine Zeile im
 *     Nachbarbereich schaltet hier nichts frei.
 */

let f: Fixtur;
let verbinder = '';
let nurLeser = '';
let ceo = '';
let backoffice = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `werkzeug-${zufall()}@cse.test`;
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

async function gewaehre(rolle: string, recht: string, mandant: string, wert: boolean):
Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select r.id, b.id, $3, $4
       from rolle r, berechtigung b
      where r.schluessel = $1 and r.mandant_id is null and b.schluessel = $2
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = $4`,
    [rolle, recht, mandant, wert] as never[]);
}

beforeAll(async () => {
  f = await seed();
  /* `admin` bekommt das Verbinden, `leitung` nur das Lesen — genau der Unterschied. */
  verbinder = await konto(f.reinigung, 'admin');
  nurLeser = await konto(f.reinigung, 'leitung');
  for (const r of ['agent.lesen', 'agent.werkzeug_verbinden']) {
    await gewaehre('admin', r, f.reinigung, true);
  }
  await gewaehre('leitung', 'agent.lesen', f.reinigung, true);
  await gewaehre('leitung', 'agent.werkzeug_verbinden', f.reinigung, false);
  const agenten = await sql.unsafe<{ id: string; kennung: string }[]>(
    `select id, kennung::text as kennung from agent`);
  ceo = agenten.find((a) => a.kennung === 'ceo_assistent')!.id;
  backoffice = agenten.find((a) => a.kennung === 'backoffice')!.id;
});
beforeEach(async () => {
  await sql.unsafe(`delete from agent_werkzeug`);
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  wer = verbinder, mandant = f.reinigung,
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

async function grund(lauf: Promise<unknown>): Promise<string | null> {
  try {
    await lauf;
    return null;
  } catch (fehler) {
    return fehler instanceof WerkzeugPflegeFehler ? fehler.grund : String(fehler);
  }
}

describe('(1) ohne agent.werkzeug_verbinden wird nichts gesetzt', () => {
  it('leitung liest, setzt aber nicht — mit einem Satz statt einer Policy-Meldung', async () => {
    expect(await grund(imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'suche_bestand', istAktiv: true, erfordertFreigabe: true,
    }), nurLeser))).toBe('abgewiesen');
    const [z] = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from agent_werkzeug`);
    expect(z!.n).toBe('0');
  });
});

describe('(2) mit dem Recht: anlegen, ändern, protokollieren', () => {
  it('die Zeile entsteht, ein zweites Setzen ändert sie, beides steht im Protokoll', async () => {
    const an = await imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'suche_bestand', istAktiv: true, erfordertFreigabe: false,
    }));
    expect(an).toMatchObject({ freigeschaltet: true, erfordertFreigabe: false, bereit: true });

    const aus = await imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'suche_bestand', istAktiv: false, erfordertFreigabe: true,
    }));
    expect(aus.id).toBe(an.id);
    expect(aus).toMatchObject({ freigeschaltet: false, erfordertFreigabe: true, bereit: false });

    const zeilen = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_werkzeug where agent_id = $1`, [ceo]);
    expect(zeilen[0]!.n).toBe('1');
    const protokoll = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'agent.werkzeug_gesetzt' and objekt_id = $1`, [an.id]);
    expect(protokoll[0]!.n).toBe('2');
  });

  it('ein Modellwerkzeug lässt sich freischalten, ist aber nicht bereit', async () => {
    const stand = await imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'entwirf_text', istAktiv: true, erfordertFreigabe: true,
    }));
    expect(stand).toMatchObject({ freigeschaltet: true, ausfuehrbar: false, bereit: false });
  });
});

describe('(3) nur Paare aus dem Register, und Versand nie ohne Freigabe', () => {
  it('ein Werkzeug, das der Agent nicht führt, bekommt keine Zeile (D-513)', async () => {
    expect(await grund(imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'sende_email', istAktiv: true, erfordertFreigabe: true,
    })))).toBe('nicht_im_register');
  });

  it('sende_email ohne Freigabe weist der Dienst ab — Invariante 7', async () => {
    expect(await grund(imKontext((k) => setzeWerkzeug(k, {
      agentId: backoffice, werkzeug: 'sende_email', istAktiv: true, erfordertFreigabe: false,
    })))).toBe('freigabe_pflicht');
    expect(await grund(imKontext((k) => setzeWerkzeug(k, {
      agentId: backoffice, werkzeug: 'sende_email', istAktiv: true, erfordertFreigabe: true,
    })))).toBeNull();
  });
});

describe('(4) das Tor liest den Stand der eigenen Gesellschaft', () => {
  it('ohne Zeile gesperrt, mit Zeile bereit — und der Nachbar bleibt gesperrt', async () => {
    const vorher = await imKontext((k) => werkzeugStand(k, 'ceo_assistent', 'suche_bestand'));
    expect(vorher.bereit).toBe(false);
    await expect(imKontext((k) => verlangeWerkzeug(k, 'ceo_assistent', 'suche_bestand')))
      .rejects.toBeInstanceOf(WerkzeugNichtFreigeschaltet);

    await imKontext((k) => setzeWerkzeug(k, {
      agentId: ceo, werkzeug: 'suche_bestand', istAktiv: true, erfordertFreigabe: true,
    }));
    const nachher = await imKontext((k) => verlangeWerkzeug(k, 'ceo_assistent', 'suche_bestand'));
    expect(nachher.bereit).toBe(true);

    /* Dieselbe Frage aus dem Bau: dort gibt es keine Zeile, also nichts freigeschaltet. */
    const bauLeser = await konto(f.bau, 'admin');
    await gewaehre('admin', 'agent.lesen', f.bau, true);
    const imBau = await imKontext(
      (k) => werkzeugStand(k, 'ceo_assistent', 'suche_bestand'), bauLeser, f.bau);
    expect(imBau.freigeschaltet).toBe(false);
  });
});
