/**
 * **Das Prüfprotokoll trägt IP und Agent** (SEC-A9, V-163, D-657, 0415).
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
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { alsAgent, withTenant, type Sitzung } from '../../src/server/kontext/index.js';
import { fuehreLaufAus } from '../../src/server/agent/orchestrator.js';

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

    /*
     * **Gemessen wird der Zustand AM Schreibvorgang.** Heute schreibt ein
     * Demolauf selbst keine Protokollzeile (Freigabe und Artefakt tragen
     * keinen Ausloeser); was zaehlt, ist, als wer die Transaktion in dem
     * Moment dasteht, in dem die Freigabe entsteht — jeder protokollierende
     * Ausloeser und jede Definer-Funktion liest genau das.
     */
    const amSchreiben: { typ: string | null; agent: string | null }[] = [];
    const stand = await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung('192.0.2.44'), async (k) => {
        const spion = {
          ...k,
          schreibe: async <T,>(q: string, w?: readonly unknown[]): Promise<readonly T[]> => {
            if (/insert into freigabe/u.test(q)) {
              const [s] = await k.abfrage<{ typ: string | null; agent: string | null }>(
                `select current_setting('app.akteur_typ', true) as typ,
                        current_setting('app.agent_id', true) as agent`);
              amSchreiben.push(s!);
            }
            return k.schreibe<T>(q, w);
          },
        };
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
    const [ag] = await sql.unsafe<{ agent_id: string }[]>(
      `select agent_id::text as agent_id from freigabe where id = $1`, [stand.lauf.freigabeId]);
    expect(amSchreiben, 'die Freigabe entsteht als Agent, nicht als Mensch').toEqual([
      { typ: 'agent', agent: ag!.agent_id },
    ]);
    expect(stand.g.typ).toBe('mensch');
    expect(stand.g.agent ?? '').toBe('');
    const nach = await zeile('probe.nach_lauf');
    expect(nach.akteur_typ).toBe('mensch');
    expect(nach.agent_id).toBeNull();

    /* Und wenn waehrend des Laufs eine Protokollzeile entstand, traegt sie ihn. */
    const waehrend = await sql.unsafe<Zeile[]>(
      `select akteur_typ::text as akteur_typ, akteur_id::text as akteur_id,
              agent_id::text as agent_id, host(ip) as ip
         from audit_log
        where sitzung_id = '00000000-0000-4000-8000-000000000415'
          and aktion not like 'probe.%'
          and erstellt_am >= now() - interval '1 minute'`);
    for (const z of waehrend.filter((w) => w.akteur_typ === 'agent')) {
      expect(z.agent_id).toBe(ag!.agent_id);
      expect(z.ip).toBe('192.0.2.44');
    }
    expect(waehrend.filter((w) => w.agent_id !== null && w.akteur_typ !== 'agent')).toEqual([]);
  });
});
