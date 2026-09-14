/**
 * Der Agentenlauf gegen eine echte Datenbank (AGT-01, AGT-05, §4, §8, 0154).
 *
 * **Der Satz, den diese Datei beweist:** die Kette trägt. Auftrag → Modell →
 * Entwurf → Schrittprotokoll → Freigabe im Posteingang, in einer Transaktion,
 * mit einem Modell, das im Register steht.
 *
 * Bis PR 76 war sie nie durchlaufen worden: es gab keinen Zugang zu einem
 * Anbieter, und damit blieb ungeprüft, ob der Weg überhaupt zusammenhängt.
 * Der Demobetrieb schliesst diese Lücke, ohne einen Auftragsverarbeiter zu
 * brauchen — er läuft im eigenen Prozess.
 *
 *  1. **Ein Lauf legt einen Vorschlag vor, er versendet nichts** (Invariante 7).
 *  2. **Jede Zahl im Entwurf stand vorher in den Tatsachen** (Invariante 6) —
 *     der Demobetrieb erfindet keine.
 *  3. **Derselbe Auftrag zweimal ist ein Lauf**, nicht zwei (Idempotenz).
 *  4. **Ohne freigegebenes Modell läuft nichts** — und das ist ein
 *     Betriebszustand mit einem Satz, kein Absturz (§8).
 *  5. **Das Register ist das Tor**: eine Zeile ohne die drei Flaggen macht
 *     ein Modell nicht aufrufbar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { fuehreLaufAus } from '../../src/server/agent/orchestrator.js';
import { DEMO_MODELL } from '../../src/server/agent/modell/demo.js';
import { modellStand } from '../../src/server/agent/modell/auswahl.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `agent-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql, mandantId?: string): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandantId ?? f.reinigung, mandantIds: [mandantId ?? f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function alsDienst<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp({
    scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern', readonly: false,
  }, async (tx: postgres.TransactionSql) => fn(kontext(tx))) as Promise<T>;
}

/** Der Agent muss aktiv sein — im Seed sind alle vier aus (D-435). */
async function schalteAgentEin(kennung: string): Promise<void> {
  await sql.unsafe(`update agent set ist_aktiv = true where kennung = $1::agent_kennung`,
    [kennung]);
}

const AUFTRAG = {
  agent: 'backoffice' as const,
  vorgangTyp: 'interner_hinweis',
  titel: 'Leistungsnachweis seit neun Tagen ohne Unterschrift',
  vorlage: 'interner_hinweis',
  tatsachen: {
    zusammenfassung: 'Der Leistungsnachweis für Kurfürstendamm 21 ist seit 9 Tagen offen.',
    stand: '14.09.2026',
    empfehlung: 'Objektleitung erinnert den Kunden.',
  },
  codeVersion: 'test',
};

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  await schalteAgentEin('backoffice');
});

afterAll(schliessen);

describe('(1) der Lauf legt vor, er versendet nicht (Invariante 7)', () => {
  it('aus einem Auftrag wird ein Entwurf und eine offene Freigabe', async () => {
    const e = await alsDienst((k) => fuehreLaufAus(k, AUFTRAG));

    expect(e.bestand).toBe(false);
    expect(e.modell).toBe(DEMO_MODELL);
    expect(e.freigabeId).not.toBeNull();
    expect(e.entwurf).toContain('Kurfürstendamm 21');

    const [fg] = await sql.unsafe<{ status: string; titel: string; agent_id: string | null }[]>(
      `select status::text as status, titel, agent_id from freigabe where id = $1`,
      [e.freigabeId]);
    expect(fg!.status, 'ein Agent legt VOR, er entscheidet nicht').toBe('offen');
    expect(fg!.agent_id, 'die Zeile weiss, welcher Agent sie erzeugt hat').not.toBeNull();

    /* Und nichts ist hinausgegangen: es gibt keine Versandzeile. */
    const [ausgang] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from freigabe where id = $1 and ausfuehrung_status <> 'offen'`,
      [e.freigabeId]);
    expect(ausgang!.n).toBe('0');
  });

  it('die Aufgabe steht danach auf `wartet_auf_freigabe`, nicht auf `abgeschlossen`', async () => {
    const e = await alsDienst((k) => fuehreLaufAus(k, AUFTRAG));
    const [a] = await sql.unsafe<{ status: string; schritte_anzahl: number }[]>(
      `select status::text as status, schritte_anzahl from agent_aufgabe where id = $1`,
      [e.aufgabeId]);
    expect(a!.status).toBe('wartet_auf_freigabe');
    expect(a!.schritte_anzahl).toBe(1);
  });

  /**
   * AGT-05: der Schritt trägt Modell, Tokens und Dauer. Ohne das liesse sich
   * hinterher nicht sagen, was ein Lauf gekostet hat — und die Budgetgrenze
   * wäre eine Zahl ohne Grundlage.
   */
  it('der Schritt steht im Protokoll, mit Modell und Tokens', async () => {
    const e = await alsDienst((k) => fuehreLaufAus(k, AUFTRAG));
    const [s] = await sql.unsafe<{
      modell: string; tokens_eingabe: number; tokens_ausgabe: number; status: string;
    }[]>(
      `select modell, tokens_eingabe, tokens_ausgabe, status::text as status
         from agent_schritt where agent_aufgabe_id = $1`, [e.aufgabeId]);
    expect(s!.modell).toBe(DEMO_MODELL);
    expect(s!.tokens_eingabe).toBeGreaterThan(0);
    expect(s!.tokens_ausgabe).toBeGreaterThan(0);
    expect(s!.status).toBe('erfolg');
  });
});

describe('(2) der Demobetrieb erfindet nichts (Invariante 6)', () => {
  /**
   * **Der Satz, der den Demobetrieb von einem Sprachmodell unterscheidet.**
   * Jede Ziffernfolge im Entwurf muss vorher in den Tatsachen gestanden haben.
   * Ein Modell, das eine Zahl dazuerfindet, fällt hier auf — und zwar bevor
   * jemand sie auf einer Rechnung liest.
   */
  it('jede Zahl im Entwurf stand vorher in den Tatsachen', async () => {
    const e = await alsDienst((k) => fuehreLaufAus(k, AUFTRAG));
    const gegeben = Object.values(AUFTRAG.tatsachen).join(' ');
    for (const zahl of e.entwurf.match(/\d+/gu) ?? []) {
      expect(gegeben, `„${zahl}" steht im Entwurf, aber in keiner Tatsache`).toContain(zahl);
    }
  });

  it('derselbe Auftrag ergibt denselben Text — wiederholbar, nicht gewürfelt', async () => {
    const a = await alsDienst((k) => fuehreLaufAus(k, { ...AUFTRAG, idempotenzSchluessel: `a-${zufall()}` }));
    const b = await alsDienst((k) => fuehreLaufAus(k, { ...AUFTRAG, idempotenzSchluessel: `b-${zufall()}` }));
    expect(b.entwurf).toBe(a.entwurf);
  });
});

describe('(3) zweimal derselbe Auftrag ist ein Lauf', () => {
  it('der Idempotenzschlüssel verhindert den zweiten Entwurf', async () => {
    const schluessel = `lauf-${zufall()}`;
    const erst = await alsDienst((k) => fuehreLaufAus(k, { ...AUFTRAG, idempotenzSchluessel: schluessel }));
    const zweit = await alsDienst((k) => fuehreLaufAus(k, { ...AUFTRAG, idempotenzSchluessel: schluessel }));

    expect(erst.bestand).toBe(false);
    expect(zweit.bestand, 'ein Ereignis kommt zweimal an — der Agent läuft einmal').toBe(true);
    expect(zweit.freigabeId).toBeNull();

    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe where idempotenz_schluessel = $1`,
      [schluessel]);
    expect(n!.n).toBe('1');
  });
});

describe('(4) das Register ist das Tor (§8, 0154)', () => {
  /**
   * **Der gescheiterte Lauf bleibt SICHTBAR.**
   *
   * Eine Ausnahme risse die Transaktion des Aufrufers mit und damit die
   * Aufgabenzeile: der Lauf wäre gescheitert und spurlos, und im
   * Agentenzentrum stünde nichts. §8 nennt „kein Modell freigegeben" einen
   * Betriebszustand — also kommt er als Ergebnis zurück, und die Zeile bleibt.
   */
  it('ohne freigegebenes Modell bleibt die Aufgabe stehen — mit Grund', async () => {
    await sql.unsafe(`update modell_register set freigegeben = false where faehigkeit = 'entwurf_text'`);

    const e = await alsDienst((k) => fuehreLaufAus(k, AUFTRAG));
    expect(e.gestoert?.code).toBe('RESIDENCY_BLOCKED');
    expect(e.freigabeId, 'ohne Modell entsteht kein Vorschlag').toBeNull();

    const [a] = await sql.unsafe<{ status: string; fehler_text: string | null }[]>(
      `select status::text as status, fehler_text from agent_aufgabe where id = $1`,
      [e.aufgabeId]);
    expect(a!.status, 'die Aufgabe steht als fehlgeschlagen da, nicht als laufend').toBe('fehlgeschlagen');
    expect(a!.fehler_text).toMatch(/nicht verfügbar|EU-Verarbeitung/u);
  });

  it('eine der drei Flaggen genügt nicht — die Regel ist die Konjunktion', async () => {
    for (const spalte of ['eu_verarbeitung', 'zero_retention', 'freigegeben']) {
      await sql.unsafe(`update modell_register set eu_verarbeitung = true, zero_retention = true,
                               freigegeben = true where faehigkeit = 'entwurf_text'`);
      await sql.unsafe(
        `update modell_register set ${spalte} = false where faehigkeit = 'entwurf_text'`);
      const [z] = await sql.unsafe<{ modell: string | null }[]>(
        `select app.modell_fuer('entwurf_text') as modell`);
      expect(z!.modell, `ohne ${spalte} darf kein Modell herauskommen`).toBeNull();
    }
  });

  it('der Stand nennt je Fähigkeit, worauf sie läuft — und dass es der Demobetrieb ist', async () => {
    const stand = await alsDienst((k) => modellStand(k));
    expect(stand).toHaveLength(7);
    for (const s of stand) {
      expect(s.modell).toBe(DEMO_MODELL);
      expect(s.demo, 'der Demobetrieb sagt, dass er einer ist').toBe(true);
    }
  });

  it('ein abgeschalteter Agent läuft nicht', async () => {
    await sql.unsafe(`update agent set ist_aktiv = false where kennung = 'backoffice'`);
    await expect(alsDienst((k) => fuehreLaufAus(k, AUFTRAG))).rejects.toThrow();
  });
});

describe('(5) ein echter Programmfehler bleibt laut', () => {
  /**
   * Der Gegenbeweis zur Zeile darüber: NUR die Residenz- und Anschlussgründe
   * aus §8 kommen als Ergebnis zurück. Ein Tippfehler in einer Abfrage soll
   * weiterhin die Transaktion reissen — sonst verschluckte der Orchestrator
   * genau die Fehler, die jemand sehen muss.
   */
  it('eine unbekannte Vorgangsart wirft, statt still ein Ergebnis zu liefern', async () => {
    await expect(alsDienst((k) => fuehreLaufAus(k, { ...AUFTRAG, vorgangTyp: 'gibt_es_nicht' })))
      .rejects.toThrow();
  });
});
