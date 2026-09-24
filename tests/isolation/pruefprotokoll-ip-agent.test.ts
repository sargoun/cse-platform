/**
 * **Das Prüfprotokoll trägt IP und Agent** (SEC-A9, V-163, D-657, 0415;
 * Wege ohne Sitzung: V-167, D-661).
 *
 * SEC-A9 verlangt je Eintrag Akteur (Mensch/Agent/System), Handlung,
 * vorher/nachher, Zeitpunkt und IP. `audit_log` hatte die Spalten seit 0003 —
 * und zwei davon blieben leer: keine Sitzungsbindung setzte `app.ip`, und
 * niemand schrieb `agent_id` oder `akteur_typ = 'agent'`.
 *
 * Geprüft wird hier der ECHTE Weg: `withTenant` aus `server/kontext`, dieselbe
 * Bindung, die jede Route benutzt, und `alsAgent`, das der Orchestrator um
 * seinen Lauf legt. Nicht eine nachgebaute Folge von `set_config` — die hätte
 * bewiesen, dass die Datenbank liest, was man ihr gibt, und nicht, dass die
 * Anwendung es ihr gibt.
 */
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  alsAgent, withTenant, type Sitzung, type Transaktion,
} from '../../src/server/kontext/index.js';
import { fuehreLaufAus } from '../../src/server/agent/orchestrator.js';
import {
  bestaetigeFaktorMitToken, legeKennwortTokenAn, loeseKennwortTokenEin, meldeAnMitKennwort,
  richteFaktorMitTokenEin,
} from '../../src/server/auth/kennwort-anmeldung.js';
import { codeFuer, schritt } from '../../src/lib/totp.js';
import {
  gibCheckinAus, loeseCheckinEin, stempleAusDerSitzung,
} from '../../src/server/services/zeit/checkin.js';
import { nimmClaimAn } from '../../src/server/services/zeit/offline.js';
import { codeAnfordern, codeEinloesen } from '../../src/server/auth/mitarbeiter-anmeldung.js';
import type { SmsDienst } from '../../src/server/auth/sms.js';

let f: Fixtur;
let benutzer = '';

interface Zeile {
  readonly akteur_typ: string;
  readonly akteur_id: string | null;
  readonly agent_id: string | null;
  readonly ip: string | null;
}

async function zeile(aktion: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select akteur_typ::text as akteur_typ, akteur_id::text as akteur_id,
            agent_id::text as agent_id, host(ip) as ip
       from audit_log where aktion = $1 order by id desc limit 1`, [aktion]);
  expect(z, `keine Protokollzeile fuer ${aktion}`).toBeDefined();
  return z!;
}

function sitzung(ip: string | null | undefined): Sitzung {
  return {
    benutzerId: benutzer, personId: null, aktiverMandantId: f.reinigung,
    ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000415',
    ...(ip === undefined ? {} : { ip }),
  };
}

/** Eine Protokollzeile über den echten Bindungsweg. */
async function protokolliere(aktion: string, ip: string | null | undefined): Promise<void> {
  await sql.begin(async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung(ip), async (k) => {
      await k.schreibe(`select app.protokolliere($1, 'probe', '1')`, [aktion]);
    }));
}

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('protokoll-ip@test.invalid') returning id`);
  benutzer = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, 'protokoll-ip@test.invalid', 'Protokoll', 'aktiv')`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [benutzer, f.reinigung]);
});
afterAll(schliessen);

describe('(1) die IP der Anfrage steht in der Zeile', () => {
  it('IPv4 aus der Sitzung → audit_log.ip', async () => {
    await protokolliere('probe.ipv4', '203.0.113.7');
    const z = await zeile('probe.ipv4');
    expect(z.ip).toBe('203.0.113.7');
    expect(z.akteur_typ).toBe('mensch');
    expect(z.akteur_id).toBe(benutzer);
    expect(z.agent_id, 'ein Mensch traegt keine Agentenkennung').toBeNull();
  });

  it('IPv6 genauso', async () => {
    await protokolliere('probe.ipv6', '2001:db8::17');
    expect((await zeile('probe.ipv6')).ip).toBe('2001:db8::17');
  });

  it('ohne Anfrage (Hintergrund, Test) bleibt die Spalte ehrlich leer', async () => {
    await protokolliere('probe.ohne', undefined);
    expect((await zeile('probe.ohne')).ip).toBeNull();
  });

  /**
   * **Ein kaputter Wert bricht keine Buchung ab.** Bis 0415 stand hier ein
   * nackter Cast: ein Wert, den `inet` nicht versteht, haette jede
   * protokollierende Transaktion mit `invalid input syntax` beendet — auch das
   * Festschreiben einer Rechnung. Die Anwendung prueft vorher (`isIP`); das
   * hier ist die zweite Linie.
   */
  it('ein ungueltiger Wert wird NULL, die Transaktion laeuft durch', async () => {
    await protokolliere('probe.kaputt', 'kein-ip; drop table audit_log');
    expect((await zeile('probe.kaputt')).ip).toBeNull();
  });
});

describe('(2) was ein Agent schreibt, steht als Agent da', () => {
  const agent = '11111111-2222-4333-8444-555555555415';

  it('alsAgent: akteur_typ agent, agent_id gesetzt, der Mensch bleibt Ausloeser', async () => {
    await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung('198.51.100.4'), async (k) => {
        await alsAgent(k, agent, async () => {
          await k.schreibe(`select app.protokolliere('probe.agent', 'probe', '1')`);
        });
        /* Danach schreibt wieder der Mensch — in derselben Transaktion. */
        await k.schreibe(`select app.protokolliere('probe.danach', 'probe', '1')`);
      }));

    const a = await zeile('probe.agent');
    expect(a.akteur_typ).toBe('agent');
    expect(a.agent_id).toBe(agent);
    expect(a.akteur_id, 'in wessen Auftrag').toBe(benutzer);
    expect(a.ip).toBe('198.51.100.4');

    const d = await zeile('probe.danach');
    expect(d.akteur_typ).toBe('mensch');
    expect(d.agent_id).toBeNull();
  });

  it('eine Agentenkennung ohne akteur_typ agent wird nicht geschrieben', async () => {
    await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung(null), async (k) => {
        await k.schreibe(`select set_config('app.agent_id', $1, true)`, [agent]);
        await k.schreibe(`select app.protokolliere('probe.falsche_kennung', 'probe', '1')`);
      }));
    const z = await zeile('probe.falsche_kennung');
    expect(z.akteur_typ).toBe('mensch');
    expect(z.agent_id).toBeNull();
  });

  it('wirft der Lauf, geht der Wurf durch — nicht ein Fehler beim Zuruecksetzen', async () => {
    await expect(sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung(null), async (k) => {
        await alsAgent(k, agent, async () => {
          await k.schreibe(`select 1 / 0`);
        });
      }))).rejects.toThrow(/division by zero/u);
  });

  /**
   * Der Orchestrator selbst: ein ganzer Lauf, danach dieselbe Transaktion
   * weiter. Was er schreibt, schreibt er als Agent; was danach kommt, wieder
   * der Mensch.
   *
   * **Gemessen wird eine ECHTE Protokollzeile aus dem Lauf** (V-237, D-731).
   * Ein Demolauf schreibt selbst keine (Freigabe und Artefakt tragen keinen
   * Ausloeser). Die Pruefung stand deshalb frueher als Schleife ueber die
   * Zeilen „waehrend des Laufs" — ueber null Zeilen, und die Erwartung danach
   * war auf einer leeren Menge trivial wahr. Jetzt schreibt der Spion im
   * Moment, in dem die Freigabe entsteht, selbst eine Zeile ueber
   * app.protokolliere: genau das, was ein protokollierender Ausloeser an
   * dieser Stelle taete, mit genau dem Zustand der Transaktion, den der Lauf
   * gesetzt hat.
   */
  it('fuehreLaufAus stellt fuer den Lauf um und danach zurueck', async () => {
    await sql.unsafe(`update agent set ist_aktiv = true where kennung = 'backoffice'`);
    await sql.unsafe(
      `insert into agent_budget
         (mandant_id, geltungsbereich, jahr, monat, budget_cent, ist_platzhalter,
          erstellt_von_art, erstellt_von_dienst)
       values ($1::uuid, 'mandant',
               extract(year  from (now() at time zone 'Europe/Berlin'))::integer,
               extract(month from (now() at time zone 'Europe/Berlin'))::integer,
               5000, true, 'system', 'job:test')
       on conflict do nothing`, [f.reinigung]);

    let imLauf = 0;
    const stand = await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung('192.0.2.44'), async (k) => {
        const spion = {
          ...k,
          schreibe: async <T,>(q: string, w?: readonly unknown[]): Promise<readonly T[]> => {
            if (/insert into freigabe/u.test(q)) {
              await k.schreibe(`select app.protokolliere('probe.im_lauf', 'probe', '1')`);
              imLauf += 1;
            }
            return k.schreibe<T>(q, w);
          },
        };
        await k.schreibe(`select app.protokolliere('probe.vor_lauf', 'probe', '1')`);
        const lauf = await fuehreLaufAus(spion, {
          agent: 'backoffice', vorgangTyp: 'interner_hinweis', aktion: 'interner_hinweis',
          titel: 'Probe fuer das Protokoll', vorlage: 'interner_hinweis',
          tatsachen: { zusammenfassung: 'Probe.', stand: '23.09.2026', empfehlung: 'Keine.' },
          codeVersion: 'test',
        });
        await k.schreibe(`select app.protokolliere('probe.nach_lauf', 'probe', '1')`);
        const [g] = await k.abfrage<{ typ: string | null; agent: string | null }>(
          `select current_setting('app.akteur_typ', true) as typ,
                  current_setting('app.agent_id', true) as agent`);
        return { lauf, g };
      })) as unknown as {
        lauf: Awaited<ReturnType<typeof fuehreLaufAus>>;
        g: { typ: string | null; agent: string | null };
      };

    expect(stand.lauf.gestoert, 'der Lauf muss durchlaufen').toBeNull();
    expect(imLauf, 'die Freigabe entsteht genau einmal').toBe(1);
    const [ag] = await sql.unsafe<{ agent_id: string }[]>(
      `select agent_id::text as agent_id from freigabe where id = $1`, [stand.lauf.freigabeId]);

    /* Die Zeile aus dem Lauf steht als Agent da — im Auftrag des Menschen, mit seiner Adresse. */
    const im = await zeile('probe.im_lauf');
    expect(im.akteur_typ).toBe('agent');
    expect(im.agent_id).toBe(ag!.agent_id);
    expect(im.akteur_id, 'in wessen Auftrag').toBe(benutzer);
    expect(im.ip).toBe('192.0.2.44');

    /* Danach schreibt wieder der Mensch — Zustand und Zeile. */
    expect(stand.g.typ).toBe('mensch');
    expect(stand.g.agent ?? '').toBe('');
    const nach = await zeile('probe.nach_lauf');
    expect(nach.akteur_typ).toBe('mensch');
    expect(nach.agent_id).toBeNull();

    expect((await zeile('probe.vor_lauf')).akteur_typ, 'vor dem Lauf: der Mensch').toBe('mensch');

    /*
     * Und JEDE Zeile, die zwischen der Marke davor und der danach entstand —
     * also waehrend des Laufs —, traegt den Agenten. Die Menge ist nicht leer:
     * sie enthaelt mindestens die Zeile aus dem Lauf. Die Kennungen steigen in
     * der Reihenfolge, in der die Transaktion schrieb.
     */
    const waehrend = await sql.unsafe<(Zeile & { aktion: string })[]>(
      `select a.aktion, a.akteur_typ::text as akteur_typ, a.akteur_id::text as akteur_id,
              a.agent_id::text as agent_id, host(a.ip) as ip
         from audit_log a
        where a.sitzung_id = '00000000-0000-4000-8000-000000000415'
          and a.id > (select max(id) from audit_log where aktion = 'probe.vor_lauf')
          and a.id < (select max(id) from audit_log where aktion = 'probe.nach_lauf')
        order by a.id`);
    expect(waehrend.map((z) => z.aktion)).toContain('probe.im_lauf');
    for (const z of waehrend) {
      expect(z.akteur_typ, z.aktion).toBe('agent');
      expect(z.agent_id, z.aktion).toBe(ag!.agent_id);
      expect(z.ip, z.aktion).toBe('192.0.2.44');
    }
  });
});

/**
 * **Wege OHNE Sitzung tragen die Adresse auch** (V-167, D-661).
 *
 * Drei Zeilen entstehen, bevor es eine Sitzung gibt: die Sperre der Bremse
 * (`auth.konto_gesperrt`, `app.versuch_protokollieren`), das Kennwort über
 * einen Token (`auth.kennwort_gesetzt`) und der zweite Faktor einer Einladung
 * (`auth.zweiter_faktor_eingerichtet`). Keiner geht durch `bindeSitzung`, und
 * bis V-167 trugen sie deshalb `ip = NULL` — obwohl die Anfrage ihre Adresse
 * hatte. Geprüft über die ECHTEN Dienste, in einer Transaktion ohne jede
 * Bindung, genau wie die Seiten sie öffnen (`db().begin(...)`).
 */
describe('(3) Wege ohne Sitzung: Sperre, Kennwort und zweiter Faktor per Token', () => {
  const zufall = (): string => Math.random().toString(36).slice(2, 10);

  /** Eine Zeile zu genau diesem Konto — nicht irgendeine mit derselben Aktion. */
  async function zeileZu(aktion: string, konto: string): Promise<Zeile> {
    const [z] = await sql.unsafe<Zeile[]>(
      `select akteur_typ::text as akteur_typ, akteur_id::text as akteur_id,
              agent_id::text as agent_id, host(ip) as ip
         from audit_log where aktion = $1 and objekt_id = $2 order by id desc limit 1`,
      [aktion, konto]);
    expect(z, `keine Protokollzeile ${aktion} fuer ${konto}`).toBeDefined();
    return z!;
  }

  async function konto(opts: {
    rolle: string; status: string; kennwort: string | null;
  }): Promise<{ id: string; email: string }> {
    const email = `herkunft-${zufall()}@test.invalid`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1, $2, 'Herkunft', $3)`,
      [u!.id, email, opts.status]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
      [u!.id, f.reinigung, opts.rolle]);
    if (opts.kennwort !== null) {
      await sql.unsafe(`select app.demo_kennwort_setzen($1::uuid, $2)`, [u!.id, opts.kennwort]);
    }
    return { id: u!.id, email };
  }

  /** Ohne Sitzungsbindung — der Ausweis ist das Kennwort oder der Token. */
  async function ohneSitzung<T>(fn: (tx: Transaktion) => Promise<T>): Promise<T> {
    return sql.begin(async (tx: postgres.TransactionSql) =>
      fn(tx as unknown as Transaktion)) as Promise<T>;
  }

  it('die Sperre nach zehn Fehlversuchen traegt die Adresse des Versuchs', async () => {
    const k = await konto({ rolle: 'leitung', status: 'aktiv', kennwort: 'ein-langes-kennwort-2026' });
    for (let i = 0; i < 10; i += 1) {
      await ohneSitzung((tx) => meldeAnMitKennwort(
        tx, k.email, `daneben-${String(i)}`, '198.51.100.23', 'vitest'));
    }
    const z = await zeileZu('auth.konto_gesperrt', k.id);
    expect(z.ip).toBe('198.51.100.23');
    /* Wer hier handelt, ist nicht angemeldet: die Zeile behauptet keinen Menschen. */
    expect(z.akteur_id).toBeNull();
    expect(z.agent_id).toBeNull();
  });

  it('das Kennwort ueber den Token der Zuruecksetzung traegt sie', async () => {
    const k = await konto({ rolle: 'leitung', status: 'aktiv', kennwort: 'ein-langes-kennwort-2026' });
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'zuruecksetzen'));
    const e = await ohneSitzung((tx) =>
      loeseKennwortTokenEin(tx, token, 'ganz-neues-kennwort-2026', '2001:db8::23'));
    expect(e?.benutzerId).toBe(k.id);
    expect((await zeileZu('auth.kennwort_gesetzt', k.id)).ip).toBe('2001:db8::23');
  });

  it('Einladung mit Pflicht zum zweiten Faktor: Kennwort und Faktor tragen sie', async () => {
    const k = await konto({ rolle: 'admin', status: 'eingeladen', kennwort: null });
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'einladung'));
    const e = await ohneSitzung((tx) =>
      loeseKennwortTokenEin(tx, token, 'mein-eigenes-kennwort', '203.0.113.61'));
    expect(e?.brauchtFaktor).toBe(true);
    expect((await zeileZu('auth.kennwort_gesetzt', k.id)).ip).toBe('203.0.113.61');

    const ein = await ohneSitzung((tx) => richteFaktorMitTokenEin(tx, token, k.email));
    expect(ein).not.toBeNull();
    const [jetzt] = await sql.unsafe<{ t: Date }[]>(`select now() as t`);
    const code = codeFuer(ein!.geheimnis, schritt(new Date(jetzt!.t)));
    expect(await ohneSitzung((tx) =>
      bestaetigeFaktorMitToken(tx, token, code, '203.0.113.62'))).toBe(k.id);
    expect((await zeileZu('auth.zweiter_faktor_eingerichtet', k.id)).ip).toBe('203.0.113.62');
  });

  it('ohne bekannte Adresse bleibt die Spalte leer — und nichts bricht ab', async () => {
    const k = await konto({ rolle: 'leitung', status: 'aktiv', kennwort: 'ein-langes-kennwort-2026' });
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'zuruecksetzen'));
    expect(await ohneSitzung((tx) =>
      loeseKennwortTokenEin(tx, token, 'ganz-neues-kennwort-2026', null))).not.toBeNull();
    expect((await zeileZu('auth.kennwort_gesetzt', k.id)).ip).toBeNull();
  });
});

/**
 * **Der Check-in traegt die Adresse auch** (V-235, D-729).
 *
 * Die Kraft im Treppenhaus hat keine Sitzung: die Marke loest
 * `app.checkin_verbrauchen` bzw. `app.offline_ereignis_annehmen` als
 * `cse_checkin` ein, und beide bekamen die Adresse nur als `p_ip` — fuer
 * `checkin_token.ip_adresse` und die Bremse. `app.protokolliere` liest sie
 * aber aus `app.ip`, und `withCheckin` setzte keine GUC: jede Protokollzeile
 * eines Check-ins (`zeiteintrag.insert`, `zeit.eingestempelt`,
 * `zeit.offline_empfangen`) trug `ip = NULL`. Dasselbe beim Einmalcode der
 * Kraft (`mitarbeiter_zugang.update` aus `app.zugang_code_einloesen`).
 *
 * Geprueft ueber die ECHTEN Dienste, in einer Transaktion ohne jede Bindung —
 * genau wie die Routen sie oeffnen (`db().begin(...)`). Und zum Vergleich die
 * Stempeluhr aus der Sitzung (0373), die ueber `withTenant` bindet.
 */
describe('(4) der Check-in: Marke, Nachreichung, Stempeluhr, Einmalcode', () => {
  const zufall = (): string => Math.random().toString(36).slice(2, 10);
  const konten: Record<string, string> = {};

  /** Eine Zeile zu genau diesem Objekt — nicht irgendeine mit derselben Aktion. */
  async function zeileZu(aktion: string, objekt: string): Promise<Zeile> {
    const [z] = await sql.unsafe<Zeile[]>(
      `select akteur_typ::text as akteur_typ, akteur_id::text as akteur_id,
              agent_id::text as agent_id, host(ip) as ip
         from audit_log where aktion = $1 and objekt_id = $2 order by id desc limit 1`,
      [aktion, objekt]);
    expect(z, `keine Protokollzeile ${aktion} fuer ${objekt}`).toBeDefined();
    return z!;
  }

  /** Ohne Sitzungsbindung — der Ausweis ist die Marke oder der Code. */
  async function ohneSitzung<T>(fn: (tx: Transaktion) => Promise<T>): Promise<T> {
    return sql.begin(async (tx: postgres.TransactionSql) =>
      fn(tx as unknown as Transaktion)) as Promise<T>;
  }

  /**
   * Eine Schicht, die JETZT laeuft — Beginn vor zehn Minuten, damit das
   * Markenfenster (±1 h, 0035) sicher offen ist.
   */
  async function zuordnungJetzt(anstellung: string, person: string): Promise<string> {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1, $2, 'Herkunft-Testkunde') returning id`, [f.reinigung, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1, $2, $3, 'Herkunft Nord', 'Teststr. 5', '10115', 'Berlin') returning id`,
      [f.reinigung, k!.id, `O-${zufall()}`]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                            beginn_lokal, ende_lokal, endet_am_folgetag,
                            objekt_id, kunde_id, soll_besetzung, min_besetzung,
                            erstellt_von_art, status)
       values ($1, 'manuell', $2, (now() at time zone 'Europe/Berlin')::date,
               now() - interval '10 minutes', now() + interval '7 hours',
               'Europe/Berlin', '08:00', '16:00', false,
               $3, $4, 1, 1, 'system', 'geplant')
       returning id`,
      [f.reinigung, `herkunft:${zufall()}`, o!.id, k!.id] as never[]);
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
       select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
         from einsatz where id = $2
       returning id`,
      [f.reinigung, e!.id, anstellung, person] as never[]);
    return z!.id;
  }

  /** Die Marke gibt die Planung aus — ueber den echten Dienst. */
  async function marke(zuordnung: string, zweck: 'checkin' | 'checkout'): Promise<string> {
    return sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung(null), (k) => gibCheckinAus(k, zuordnung, zweck))) as Promise<string>;
  }

  beforeAll(async () => {
    /* Ohne Konto faellt der Check-in mit „kein Benutzerkonto" (0035). */
    for (const [name, person] of [['jonas', f.jonas], ['fatima', f.fatima]] as const) {
      const email = `herkunft-${name}-${zufall()}@test.invalid`;
      const [u] = await sql.unsafe<{ id: string }[]>(
        `insert into auth.users (email) values ($1) returning id`, [email]);
      await sql.unsafe(
        `insert into benutzer (id, email, name, status, person_id)
         values ($1, $2, $2, 'aktiv', $3)`, [u!.id, email, person]);
      konten[name] = u!.id;
    }
  });

  it('die Marke: Ein- und Ausstempeln tragen die Adresse der Anfrage', async () => {
    const z = await zuordnungJetzt(f.jonasReinigung, f.jonas);

    const ein = await ohneSitzung(async (tx) => loeseCheckinEin(tx, {
      token: await marke(z, 'checkin'), ip: '198.51.100.71', userAgent: 'vitest',
    }));
    expect(ein.ergebnis).toBe('eingecheckt');
    for (const aktion of ['zeiteintrag.insert', 'zeit.eingestempelt']) {
      const zeile = await zeileZu(aktion, ein.zeiteintragId);
      expect(zeile.ip, aktion).toBe('198.51.100.71');
      /* Wer die Marke einloest, ist nicht angemeldet: kein Mensch, kein Agent. */
      expect(zeile.akteur_id, aktion).toBeNull();
      expect(zeile.agent_id, aktion).toBeNull();
    }
    /* Dieselbe Adresse steht wie bisher an der Marke selbst. */
    const [t] = await sql.unsafe<{ ip: string | null }[]>(
      `select host(ip_adresse) as ip from checkin_token
        where eingeloest_zeiteintrag_id = $1`, [ein.zeiteintragId]);
    expect(t?.ip).toBe('198.51.100.71');

    const aus = await ohneSitzung(async (tx) => loeseCheckinEin(tx, {
      token: await marke(z, 'checkout'), ip: '2001:db8::71', userAgent: 'vitest',
    }));
    expect(aus.ergebnis).toBe('ausgecheckt');
    expect((await zeileZu('zeit.ausgestempelt', aus.zeiteintragId)).ip).toBe('2001:db8::71');
    expect((await zeileZu('zeiteintrag.update', aus.zeiteintragId)).ip).toBe('2001:db8::71');
  });

  it('die Nachreichung aus dem Funkloch traegt sie', async () => {
    const z = await zuordnungJetzt(f.jonasReinigung, f.jonas);
    const token = await marke(z, 'checkin');
    const [angenommen] = await ohneSitzung((tx) => nimmClaimAn(tx, {
      token,
      ereignisse: [{
        clientEreignisId: randomUUID(), art: 'checkin',
        behaupteteZeit: new Date(Date.now() - 5 * 60_000),
      }],
      ip: '203.0.113.72',
      userAgent: 'vitest',
    }));
    expect(angenommen).toBeDefined();
    const zeile = await zeileZu('zeit.offline_empfangen', angenommen!.vorgangId);
    expect(zeile.ip).toBe('203.0.113.72');
    expect(zeile.akteur_id).toBeNull();
  });

  it('die Stempeluhr aus der Sitzung traegt sie ueber withTenant', async () => {
    const z = await zuordnungJetzt(f.fatimaReinigung, f.fatima);
    const kraft: Sitzung = {
      benutzerId: konten['fatima']!, personId: f.fatima, aktiverMandantId: f.reinigung,
      ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter',
      sitzungId: '00000000-0000-4000-8000-000000000235', ip: '192.0.2.73',
    };
    const r = await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, kraft, (k) => stempleAusDerSitzung(k, {
        zuordnungId: z, zweck: 'checkin', ip: kraft.ip ?? null, userAgent: 'vitest',
      }))) as Awaited<ReturnType<typeof stempleAusDerSitzung>>;
    expect(r.art).toBe('eingecheckt');

    expect((await zeileZu('zeit.checkin_aus_sitzung', z)).ip).toBe('192.0.2.73');
    const [e] = await sql.unsafe<{ id: string }[]>(
      `select id::text as id from zeiteintrag where einsatz_zuordnung_id = $1`, [z]);
    const zeile = await zeileZu('zeiteintrag.insert', e!.id);
    expect(zeile.ip).toBe('192.0.2.73');
    expect(zeile.akteur_id, 'hier handelt die angemeldete Kraft').toBe(konten['fatima']);
  });

  it('der Einmalcode der Kraft traegt sie', async () => {
    const telefon = `+4917012${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname, telefon)
       values ('Herkunft', 'Code', $1) returning id`, [telefon]);
    const [zugang] = await sql.unsafe<{ id: string }[]>(
      `insert into mitarbeiter_zugang (person_id, telefon_e164) values ($1, $2) returning id`,
      [p!.id, telefon]);
    /* Ein Dienst, der den Code zeigt statt sendet — wie die Entwicklungsflaeche. */
    const zeigend: SmsDienst = {
      verbunden: false, zeigtCode: true, name: 'Pruefung',
      sende: () => Promise.resolve(),
    };
    const anforderung = await ohneSitzung((tx) =>
      codeAnfordern(tx, telefon, zeigend, '198.51.100.74'));
    expect(anforderung.codeFuerEntwicklung).not.toBeNull();

    const person = await ohneSitzung((tx) =>
      codeEinloesen(tx, telefon, anforderung.codeFuerEntwicklung!, '198.51.100.74'));
    expect(person).toBe(p!.id);
    const zeile = await zeileZu('mitarbeiter_zugang.update', zugang!.id);
    expect(zeile.ip).toBe('198.51.100.74');
    expect(zeile.akteur_id).toBeNull();
  });
});
