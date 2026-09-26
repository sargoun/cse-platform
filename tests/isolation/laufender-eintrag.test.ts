/**
 * Was die Verwaltung mit einem LAUFENDEN Zeiteintrag darf (V-064, TIM-11,
 * Invariante 5, Invariante 8).
 *
 * **Der Befund, den diese Datei festnagelt.** `korrigiereZeiteintrag` weist
 * einen laufenden Eintrag ab — mit dem Satz „Ein laufender Zeiteintrag wird
 * bearbeitet, nicht korrigiert." Der Satz war richtig und der Weg, auf den er
 * verwies, existierte nicht.
 *
 * Das ist kein Randfall: `z_offen_uk` lässt je Person genau EINEN offenen
 * Eintrag zu. Wer am Freitag das Ausstempeln vergisst, kann am Montag nicht
 * wieder einstempeln — ein vergessener Klick legt die Erfassung dieses
 * Menschen still.
 *
 * Geprüft wird, was dabei leise schiefgehen kann:
 *
 *  1. **Die Spur.** Eine gesetzte Zeit muss als gesetzt erkennbar bleiben
 *     (`nacherfasst`, `quelle_ende`, `behauptet_ende`) — sonst sieht sie im
 *     Streitfall aus wie eine gestempelte.
 *  2. **Die Grenzen.** Ein Ende vor dem Beginn, ein Ende in der Zukunft, eine
 *     leere Begründung.
 *  3. **Der Storno löscht nichts** (Invariante 8).
 *  4. **Die Gesellschaftsgrenze** (Invariante 3).
 *  5. **Dass danach wieder eingestempelt werden kann** — der eigentliche
 *     Grund für den ganzen Weg.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  LaufenderEintragFehler, LaufenderEintragNichtGefunden,
  schliesseLaufendenEintrag, storniereLaufendenEintrag,
} from '../../src/server/services/zeit/laufender-eintrag.js';

let f: Fixtur;
let planer = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

function kontextAus(tx: postgres.TransactionSql, mandant: string): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: planer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(mandant: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: planer,
           portal: 'intern', readonly: false }, fn);

beforeAll(async () => {
  f = await seed();
  const email = `zeitplanung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  planer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [planer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1,$2,'Zeitplanung','aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [planer, email]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1,$2,(select id from rolle where schluessel='admin' and mandant_id is null),$3)`,
      [planer, m, m === f.reinigung]);
  }
});
afterAll(schliessen);

/**
 * Ein LAUFENDER Eintrag für Jonas, begonnen vor `stundenHer` Stunden.
 *
 * `z_offen_uk` laesst je Person nur einen zu — jeder Fall raeumt deshalb
 * hinterher auf, indem er ihn schliesst oder storniert. Wo das nicht der
 * Punkt ist, tut es diese Funktion selbst.
 */
async function laufend(stundenHer = 20): Promise<string> {
  await sql.unsafe(
    `update zeiteintrag set status = 'storniert', storniert_am = now(),
            storno_grund = 'Aufraeumen der Pruefung'
      where person_id = $1 and status = 'laufend'`, [f.jonas] as never[]);
  /*
   * `quelle_beginn = 'import'` und NICHT `'server_uhr'` — sonst setzt
   * `kern.stempel_feldzeit` den Beginn auf `now()` und der Eintrag ist null
   * Minuten alt. Das ist Invariante 5 bei der Arbeit: eine gestempelte Zeit
   * kommt von der Serveruhr, egal was jemand mitschickt. Eine Pruefung, die
   * einen zwanzig Stunden alten Laeufer braucht, muss ihn deshalb als
   * IMPORT anlegen — genauso wie `zeit-korrektur-nachricht.test.ts`.
   */
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt,
        pause_minuten, erfassungsart_beginn, quelle_beginn, status, erstellt_von_art)
     values ($1,$2,$3, now() - ($4 || ' hours')::interval, 0,
             'import','import','laufend','system')
     returning id`,
    [f.reinigung, f.jonasReinigung, f.jonas, String(stundenHer)] as never[]);
  return z!.id;
}

async function zeile(id: string): Promise<{
  status: string; ende_zeitpunkt: Date | null; behauptet_ende: Date | null;
  nacherfasst: boolean; quelle_ende: string | null; erfassungsart_ende: string | null;
  notiz: string | null; dauer_netto_minuten: number | null;
  storno_grund: string | null; storniert_am: Date | null;
}> {
  const [z] = await sql.unsafe(
    `select status::text as status, ende_zeitpunkt, behauptet_ende, nacherfasst,
            quelle_ende::text as quelle_ende,
            erfassungsart_ende::text as erfassungsart_ende,
            notiz, dauer_netto_minuten, storno_grund, storniert_am
       from zeiteintrag where id = $1`, [id]) as never[];
  return z as never;
}

const GRUND = 'Ausstempeln vergessen, Ende laut Objektleitung 17:30.';

describe('§1 schliessen — und die Spur bleibt sichtbar (Invariante 5)', () => {
  it('setzt Ende, Status und die drei Merkmale der Nacherfassung', async () => {
    const id = await laufend(6);
    const ende = new Date(Date.now() - 60 * 60 * 1000);
    const r = await als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: ende, begruendung: GRUND, benutzerId: planer,
      }));

    const z = await zeile(id);
    expect(z.status).toBe('abgeschlossen');
    expect(z.ende_zeitpunkt).not.toBeNull();
    /*
     * Die drei Merkmale sind nicht Zierde: `z_quelle_ende_belegt` verlangt
     * `nacherfasst`, sobald `quelle_ende = 'planer_entscheidung'` ist, und
     * `z_anspruch_je_ereignis` verlangt dann eine Behauptung. Das Schema
     * erzwingt damit, was der Satz sagt — eine gesetzte Zeit bleibt als
     * gesetzt erkennbar.
     */
    expect(z.nacherfasst).toBe(true);
    expect(z.quelle_ende).toBe('planer_entscheidung');
    expect(z.erfassungsart_ende).toBe('nacherfassung');
    expect(z.behauptet_ende).not.toBeNull();
    expect(z.notiz).toBe(GRUND);
    /* Die Dauer entsteht aus dem Abstand zweier Instants (Invariante 2). */
    expect(r.nettoMinuten).not.toBeNull();
    expect(r.nettoMinuten).toBeGreaterThan(0);
  });

  it('übernimmt eine angegebene Pause und rechnet sie ab', async () => {
    const id = await laufend(6);
    const ende = new Date(Date.now() - 60 * 60 * 1000);
    const r = await als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: ende, pauseMinuten: 45,
        begruendung: GRUND, benutzerId: planer,
      }));
    const brutto = Math.round((ende.getTime() - (Date.now() - 6 * 3600_000)) / 60000);
    expect(r.nettoMinuten).toBeLessThan(brutto);
  });

  it('macht den Platz wieder frei — die Person kann erneut einstempeln', async () => {
    /*
     * Der eigentliche Grund fuer den ganzen Weg. `z_offen_uk` laesst je
     * Person genau einen offenen Eintrag zu; solange der alte laeuft, ist
     * die Erfassung dieses Menschen still gelegt.
     */
    const id = await laufend(30);
    await als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 3600_000),
        begruendung: GRUND, benutzerId: planer,
      }));
    await expect(sql.unsafe(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, pause_minuten,
          erfassungsart_beginn, quelle_beginn, status, erstellt_von_art)
       values ($1,$2,$3, now(), 0,'checkin_token','server_uhr','laufend','system')`,
      [f.reinigung, f.jonasReinigung, f.jonas] as never[])).resolves.toBeDefined();
  });
});

describe('§2 die Grenzen — ein Satz statt einer Zwangsbedingung', () => {
  it('WEIST ein Ende vor dem Beginn ab', async () => {
    const id = await laufend(2);
    await expect(als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 5 * 3600_000),
        begruendung: GRUND, benutzerId: planer,
      }))).rejects.toThrow(/vor dem Beginn/u);
  });

  it('WEIST ein Ende in der ZUKUNFT ab — ein Feierabend, der noch nicht war', async () => {
    const id = await laufend(2);
    await expect(als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() + 3600_000),
        begruendung: GRUND, benutzerId: planer,
      }))).rejects.toThrow(/Zukunft/u);
  });

  it('WEIST eine zu kurze Begründung ab', async () => {
    const id = await laufend(2);
    await expect(als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 3600_000),
        begruendung: 'passt', benutzerId: planer,
      }))).rejects.toThrow(LaufenderEintragFehler);
  });

  it('WEIST eine negative Pause ab', async () => {
    const id = await laufend(2);
    await expect(als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 3600_000),
        pauseMinuten: -5, begruendung: GRUND, benutzerId: planer,
      }))).rejects.toThrow(LaufenderEintragFehler);
  });

  it('WEIST einen ABGESCHLOSSENEN Eintrag ab — dafür gibt es die Korrektur', async () => {
    const id = await laufend(3);
    await als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 3600_000),
        begruendung: GRUND, benutzerId: planer,
      }));
    await expect(als(f.reinigung, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 1800_000),
        begruendung: GRUND, benutzerId: planer,
      }))).rejects.toThrow(LaufenderEintragNichtGefunden);
  });
});

describe('§3 stornieren — löscht nichts (Invariante 8)', () => {
  it('setzt Status, Stempel und Grund, und die Zeile BLEIBT', async () => {
    const id = await laufend(4);
    const grund = 'Versehentlich eingestempelt, Dienst nicht angetreten.';
    await als(f.reinigung, (tx) =>
      storniereLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, grund, benutzerId: planer,
      }));
    const z = await zeile(id);
    expect(z.status).toBe('storniert');
    expect(z.storniert_am).not.toBeNull();
    /* `z_storno_begruendet` verlangt beides zusammen. */
    expect(z.storno_grund).toBe(grund);
    const [da] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from zeiteintrag where id = $1`, [id]);
    expect(da!.anzahl).toBe('1');
  });

  it('WEIST einen zu kurzen Grund ab', async () => {
    const id = await laufend(4);
    await expect(als(f.reinigung, (tx) =>
      storniereLaufendenEintrag(kontextAus(tx, f.reinigung), {
        zeiteintragId: id, grund: 'egal', benutzerId: planer,
      }))).rejects.toThrow(LaufenderEintragFehler);
  });
});

describe('§4 die Gesellschaftsgrenze (Invariante 3)', () => {
  it('ein Eintrag der Reinigung ist aus der Security nicht schliessbar', async () => {
    const id = await laufend(5);
    await expect(als(f.security, (tx) =>
      schliesseLaufendenEintrag(kontextAus(tx, f.security), {
        zeiteintragId: id, endeZeitpunkt: new Date(Date.now() - 3600_000),
        begruendung: GRUND, benutzerId: planer,
      }))).rejects.toThrow(LaufenderEintragNichtGefunden);
    expect((await zeile(id)).status).toBe('laufend');
  });
});
