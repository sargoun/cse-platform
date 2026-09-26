import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  BudgetFehler, budgetInCent, pruefeZeitraum, setzeBudget,
} from '../../src/server/services/agent/budget-pflege.js';

/**
 * **Das Monatsbudget eines Agenten setzen** (V-015, AGT-05, Invariante 1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Zwei Befunde.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Es gab keinen Schreibweg.** `0128` baut Preisliste, Reservierung,
 * Verbrauch, Hartstopp und Stoppmeldung; `/agenten/budget` zeigt alles. Und
 * `budget_cent` blieb NULL — worauf `app.agent_budget_pruefen` mit
 * `budget_fehlt` antwortet: **es lief kein einziger Agent.**
 *
 * **2. Wer einen Agenten starten durfte, durfte sein Budget setzen.** `0128`
 * legt die fünf Agententabellen in EINER Schleife an und gibt allen dieselbe
 * Schreibbedingung `agent.aufgabe_starten` — ein Recht, das auch eine
 * `leitung` hält. AGT-05 verlangt eine Obergrenze; eine, die der Begrenzte
 * selbst verstellt, ist keine. `agent.budget_verwalten` stand seit `0008` im
 * Katalog und war an nichts gebunden. §4 prüft beide Richtungen gegen die
 * ROLLE, nicht gegen den Dienst.
 */

let f: Fixtur;
let budgetmensch = '';
let nurStarter = '';
let agentId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `budget-${zufall()}@cse.test`;
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
  /* `admin` bekommt beides, `leitung` nur das Starten — der Unterschied ist
     genau der, um den es geht. */
  budgetmensch = await konto(f.reinigung, 'admin');
  nurStarter = await konto(f.reinigung, 'leitung');
  for (const r of ['agent.lesen', 'agent.budget_verwalten', 'agent.aufgabe_starten']) {
    await gewaehre('admin', r, f.reinigung, true);
  }
  for (const r of ['agent.lesen', 'agent.aufgabe_starten']) {
    await gewaehre('leitung', r, f.reinigung, true);
  }
  await gewaehre('leitung', 'agent.budget_verwalten', f.reinigung, false);

  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from agent order by name limit 1`);
  agentId = a?.id ?? '';
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>, wer = budgetmensch,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: wer,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function zeile(id: string): Promise<{
  cent: string | null; platzhalter: boolean; stopp: boolean; schwelle: number | null;
  status: string; gestoppt: string | null; bereich: string;
}> {
  const [z] = await sql.unsafe<{
    cent: string | null; platzhalter: boolean; stopp: boolean; schwelle: number | null;
    status: string; gestoppt: string | null; bereich: string;
  }[]>(
    `select budget_cent::text as cent, ist_platzhalter as platzhalter,
            stopp_bei_ueberschreitung as stopp, warnschwelle_prozent as schwelle,
            status::text as status, gestoppt_am::text as gestoppt,
            geltungsbereich::text as bereich
       from agent_budget where id = $1`, [id]);
  return z!;
}

const basis = { jahr: 2026, monat: 5, stoppBeiUeberschreitung: true } as const;

describe('§1 Geld ist ganzzahliger Cent — über die geprüfte Funktion', () => {
  it('liest deutsche Schreibweise und rechnet exakt', () => {
    expect(budgetInCent('1.250,00') as bigint).toBe(125_000n);
    expect(budgetInCent('0,01') as bigint).toBe(1n);
    expect(budgetInCent('250') as bigint).toBe(25_000n);
    expect(budgetInCent('1.234,56 €') as bigint).toBe(123_456n);
  });

  /**
   * `1.234` ist hier eintausendzweihundertvierunddreissig Euro. Als „eins
   * Komma zwei drei vier" gelesen wäre es ein Budget, das um den Faktor
   * tausend danebenliegt — und das fiele erst auf, wenn der Agent stoppt.
   */
  it('rät keine fremde Schreibweise', () => {
    expect(() => budgetInCent('1,234.56')).toThrow(BudgetFehler);
    expect(() => budgetInCent('zweihundert')).toThrow(BudgetFehler);
    expect(() => budgetInCent('')).toThrow(BudgetFehler);
  });

  /** Null ist eine Entscheidung, negativ ist ein Versehen. */
  it('0,00 € ist erlaubt, −10,00 € nicht', () => {
    expect(budgetInCent('0,00') as bigint).toBe(0n);
    expect(() => budgetInCent('-10,00')).toThrow(/nicht negativ/u);
  });

  it('der Zeitraum ist ein Monat zwischen 2000 und 2100', () => {
    expect(() => pruefeZeitraum(2026, 13)).toThrow(BudgetFehler);
    expect(() => pruefeZeitraum(1999, 5)).toThrow(BudgetFehler);
    expect(() => pruefeZeitraum(2026, 0)).toThrow(BudgetFehler);
    expect(pruefeZeitraum(2026, 12)).toBeUndefined();
  });
});

describe('§2 setzen — anlegen, überschreiben, und der Platzhalter fällt', () => {
  it('legt die Zeile der Gesellschaft an und setzt `ist_platzhalter` auf false', async () => {
    const { budgetId, cent } = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 1,
    }));
    const z = await zeile(budgetId);
    expect(cent as bigint).toBe(50_000n);
    expect(z.cent).toBe('50000');
    expect(z.platzhalter).toBe(false);
    expect(z.bereich).toBe('mandant');
    expect(z.stopp).toBe(true);
  });

  it('ein zweites Speichern desselben Monats überschreibt, statt zu verdoppeln', async () => {
    const erst = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '100,00', monat: 2,
    }));
    const zweit = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '300,00', monat: 2,
    }));
    expect(zweit.budgetId).toBe(erst.budgetId);
    expect((await zeile(erst.budgetId)).cent).toBe('30000');

    const [anzahl] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from agent_budget
        where mandant_id = $1 and jahr = 2026 and monat = 2
          and geltungsbereich = 'mandant'`, [f.reinigung]);
    expect(anzahl?.n).toBe(1);
  });

  it('die Zeile eines Agenten steht neben der der Gesellschaft, nicht statt ihrer',
    async () => {
      await imKontext((k) => setzeBudget(k, {
        ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 3,
      }));
      const je = await imKontext((k) => setzeBudget(k, {
        ...basis, bereich: 'agent', agentId, budgetEuro: '50,00', monat: 3,
      }));
      expect((await zeile(je.budgetId)).bereich).toBe('agent');
      const [anzahl] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from agent_budget
          where mandant_id = $1 and jahr = 2026 and monat = 3`, [f.reinigung]);
      expect(anzahl?.n).toBe(2);
    });

  /**
   * **Der Stopp fällt mit der neuen Grenze.** Sonst bliebe eine Gesellschaft
   * gestoppt, deren Budget gerade erhöht wurde — und niemand fände den Grund,
   * weil die Zahl daneben stimmt.
   */
  it('ein neues Budget hebt einen gesetzten Stopp auf', async () => {
    const { budgetId } = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '10,00', monat: 4,
    }));
    await sql.unsafe(
      `update agent_budget set status = 'gestoppt', gestoppt_am = now() where id = $1`,
      [budgetId]);
    expect((await zeile(budgetId)).status).toBe('gestoppt');

    await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '900,00', monat: 4,
    }));
    const z = await zeile(budgetId);
    expect(z.status).toBe('aktiv');
    expect(z.gestoppt).toBeNull();
  });

  it('die Warnschwelle bleibt leer, solange niemand sie entschieden hat (O-195)', async () => {
    const { budgetId } = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 6,
    }));
    expect((await zeile(budgetId)).schwelle).toBeNull();

    const mit = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 6,
      warnschwelleProzent: 80,
    }));
    expect((await zeile(mit.budgetId)).schwelle).toBe(80);
  });

  it('eine Schwelle ausserhalb von 1–100 wird abgewiesen', async () => {
    await expect(imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 7,
      warnschwelleProzent: 120,
    }))).rejects.toMatchObject({ grund: 'schwelle' });
  });

  it('ein Agentenbudget ohne Agenten und ein Mandantsbudget mit einem werden abgewiesen',
    async () => {
      await expect(imKontext((k) => setzeBudget(k, {
        ...basis, bereich: 'agent', agentId: null, budgetEuro: '50,00', monat: 8,
      }))).rejects.toMatchObject({ grund: 'kein_agent' });
      await expect(imKontext((k) => setzeBudget(k, {
        ...basis, bereich: 'mandant', agentId, budgetEuro: '50,00', monat: 8,
      }))).rejects.toMatchObject({ grund: 'unvollstaendig' });
    });
});

describe('§3 erst mit der Zahl läuft ein Agent — die Prüfung sagt es', () => {
  /**
   * Die Gegenprobe zum ganzen Befund: `app.agent_budget_pruefen` antwortet
   * ohne Zeile mit `budget_fehlt`, und mit Zeile mit `ok`.
   */
  it('ohne Budgetzeile `budget_fehlt`, mit Zeile `ok`', async () => {
    const vorher = await imKontext((k) => k.abfrage<{ verdikt: string }>(
      `select verdikt::text as verdikt
         from app.agent_budget_pruefen($1::uuid, $2::uuid, 1000::bigint)`,
      [f.security, agentId]));
    expect(vorher[0]?.verdikt).toBe('budget_fehlt');

    const [jetzt] = await sql.unsafe<{ j: number; m: number }[]>(
      `select extract(year from (now() at time zone 'Europe/Berlin'))::int as j,
              extract(month from (now() at time zone 'Europe/Berlin'))::int as m`);
    await imKontext((k) => setzeBudget(k, {
      bereich: 'mandant', jahr: jetzt!.j, monat: jetzt!.m,
      budgetEuro: '500,00', stoppBeiUeberschreitung: true,
    }));
    const nachher = await imKontext((k) => k.abfrage<{ verdikt: string }>(
      `select verdikt::text as verdikt
         from app.agent_budget_pruefen($1::uuid, $2::uuid, 1000::bigint)`,
      [f.reinigung, agentId]));
    expect(nachher[0]?.verdikt).toBe('ok');
  });
});

describe('§4 die Rolle, nicht der Dienst — wer begrenzt wird, verstellt nicht selbst', () => {
  /**
   * **Der Kern von Befund 2.** `leitung` hält `agent.aufgabe_starten` und
   * NICHT `agent.budget_verwalten`. Vor `0385` schrieb sie die Budgetzeile
   * trotzdem; hier steht kein Dienst dazwischen, nur rohes SQL.
   */
  it('wer nur Aufgaben starten darf, schreibt keine Budgetzeile', async () => {
    await expect(imKontext((k) => k.schreibe(
      `insert into agent_budget
         (mandant_id, geltungsbereich, jahr, monat, budget_cent,
          erstellt_von_art, erstellt_von)
       values ($1::uuid, 'mandant', 2026, 11, 999999, 'mensch', $2::uuid)`,
      [f.reinigung, nurStarter]), nurStarter))
      .rejects.toThrow(/row-level security|row level security/iu);
  });

  it('und auch nicht über den Dienst — der Satz nennt das Recht', async () => {
    const fehler = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '900,00', monat: 12,
    }), nurStarter).catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(BudgetFehler);
    expect((fehler as BudgetFehler).grund).toBe('abgewiesen');
    expect((fehler as BudgetFehler).message).toContain('agent.budget_verwalten');
  });

  it('gelesen wird weiter unter `agent.lesen` — eine Grenze, die man nicht kennt, ist keine',
    async () => {
      const { budgetId } = await imKontext((k) => setzeBudget(k, {
        ...basis, bereich: 'mandant', budgetEuro: '500,00', monat: 9,
      }));
      const gelesen = await imKontext((k) => k.abfrage<{ cent: string }>(
        `select budget_cent::text as cent from agent_budget where id = $1::uuid`,
        [budgetId]), nurStarter);
      expect(gelesen[0]?.cent).toBe('50000');
    });

  it('eine nur-lesende Sitzung setzt kein Budget', async () => {
    await expect(alsApp(
      {
        scope: 'gruppe' as const, mandantIds: [f.reinigung], benutzerId: budgetmensch,
        readonly: true,
      },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into agent_budget
           (mandant_id, geltungsbereich, jahr, monat, budget_cent,
            erstellt_von_art, erstellt_von)
         values ($1::uuid, 'mandant', 2026, 10, 1, 'mensch', $2::uuid)`,
        [f.reinigung, budgetmensch]),
    )).rejects.toThrow();
  });
});

describe('§5 die Spur', () => {
  it('jedes Setzen schreibt eine Auditzeile mit dem Betrag', async () => {
    const { budgetId } = await imKontext((k) => setzeBudget(k, {
      ...basis, bereich: 'mandant', budgetEuro: '777,00', monat: 5,
    }));
    const zeilen = await sql.unsafe<{
      aktion: string; nachher: { budgetCent?: string } | null;
    }[]>(
      `select aktion, nachher from audit_log
        where objekt_typ = 'agent_budget' and objekt_id = $1 order by id`, [budgetId]);
    expect(zeilen.map((z) => z.aktion)).toContain('agent.budget_gesetzt');
    expect(zeilen.at(-1)?.nachher?.budgetCent).toBe('77700');
  });
});
