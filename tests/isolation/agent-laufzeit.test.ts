/**
 * PR 74 — die Agenten-Laufzeit gegen eine echte Datenbank (AGT-04, AGT-05).
 *
 * Die vier Sätze der Abnahme:
 *
 *  1. Jeder Schritt ist protokolliert — Werkzeug, Modell, Tokens, Kosten,
 *     Dauer — **bevor** der nächste läuft; und ein Schritt lässt sich
 *     nachträglich nicht ändern.
 *  2. Ein überschrittenes Monatsbudget **stoppt hart**, mit Statuszeile UND
 *     Benachrichtigung — beides muss NACH dem abgelehnten Aufruf noch da
 *     sein. (Die Vorfassung setzte den Status und warf in derselben
 *     Transaktion; der Rollback nahm beides mit.)
 *  3. Die Monatskosten stimmen mit der Summe der Schritte überein, und die
 *     Cent-Zahl entsteht an genau einer Stelle.
 *  4. Mit erschöpftem Budget läuft der manuelle Weg unverändert weiter.
 *
 * Dazu der Befund B5, der der Vorfassung ein Loch in den Deckel schlug: ein
 * Mandantsbudget von 200 € und vier Agentenbudgets von je 500 € liessen 2.000 €
 * durch, weil nur EINE Zeile geprüft wurde.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  BudgetErschoepft, bucheKosten, pruefeBudget, reserviere, reserviereMitHartstopp,
  vermerkeStopp, type Verbindung,
} from '../../src/server/agent/budget.js';
import {
  beendeAufgabe, letzteAufgaben, monatsverbrauch, protokolliereSchritt, starteAufgabe,
  type Abfrage, beginneSchritt,
} from '../../src/server/agent/laufzeit.js';

let f: Fixtur;
let benutzer: string;
let preislisteId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/**
 * Der **Pool**, nicht die laufende Transaktion: jeder Aufruf oeffnet eine
 * eigene. Genau daran haengt der Hartstopp — er muss die Ablehnung ueberleben,
 * und das kann er nur, wenn er nicht in derselben Transaktion steht, die die
 * Ablehnung zurueckrollt.
 */
function verbindung(): Verbindung {
  return {
    transaktion: async <T,>(arbeit: (db: Abfrage) => Promise<T>): Promise<T> =>
      alsApp(sitzung(), async (tx) => arbeit(alsDienst(tx))),
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Agentenverwaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function agentId(kennung: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from agent where kennung = $1::agent_kennung`, [kennung]);
  return a!.id;
}

async function schalteEin(kennung: string): Promise<void> {
  await sql.unsafe(
    `update agent set ist_aktiv = true where kennung = $1::agent_kennung`, [kennung]);
}

/** Ein Budget für den laufenden Berliner Monat — die Vorrichtung für O-26. */
async function legeBudgetAn(
  bereich: 'mandant' | 'agent', centOderNull: number | null, kennung?: string,
): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into agent_budget
       (mandant_id, geltungsbereich, agent_id, jahr, monat, budget_cent,
        ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, $2::budget_geltungsbereich,
             case when $2 = 'agent'
                  then (select id from agent where kennung = $3::agent_kennung) end,
             extract(year  from (now() at time zone 'Europe/Berlin'))::integer,
             extract(month from (now() at time zone 'Europe/Berlin'))::integer,
             $4, false, 'system', 'job:test')
     returning id`,
    [f.reinigung, bereich, kennung ?? 'akquise', centOderNull]);
  return b!.id;
}

async function legePreislisteAn(): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into agent_preisliste
       (modell, gueltig_ab, preis_eingabe_je_mio_token_mikrocent,
        preis_ausgabe_je_mio_token_mikrocent, version)
     values ($1, '2020-01-01', 300000, 1500000, 'test-1')
     returning id`,
    [`pruefmodell-${zufall()}`]);
  return p!.id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`agent-${zufall()}@cse.test`);
  // `agent` und `agent_preisliste` sind Referenztabellen und ueberleben `seed()`
  // nicht immer — die vier Zeilen kommen aus der Migration, der Preis hier.
  preislisteId = await legePreislisteAn();
  await sql.unsafe(`update agent set ist_aktiv = false`);
});

afterAll(schliessen);

describe('(1) jeder Schritt steht im Protokoll — und bleibt, wie er ist', () => {
  it('protokolliert Werkzeug, Modell, Tokens, Kosten und Dauer', async () => {
    await schalteEin('akquise');
    await legeBudgetAn('mandant', 10_000);

    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const aufgabe = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'akquise', vorgangTyp: 'anfrage_antwort_entwurf',
        titel: 'Anfrage beantworten', angefordertVon: benutzer,
      });
      const begonnenAm = await beginneSchritt(d);
      await protokolliereSchritt(d, f.reinigung, aufgabe, {
        werkzeug: 'entwirf_text', modell: 'pruefmodell',
        eingabe: { anfrageId: 'abc' }, ausgabe: { entwurf: 'Text' },
        tokensEingabe: 1200, tokensAusgabe: 300, kostenMikrocent: 810n, dauerMs: 1234,
        begonnenAm,
      });
      await beendeAufgabe(d, f.reinigung, aufgabe.id, { status: 'abgeschlossen' });
    });

    const [s] = await sql.unsafe<{
      werkzeug: string; modell: string; tokens_eingabe: number;
      kosten_mikrocent: string; dauer_ms: number; eingabe_hash: string;
      plausibel: boolean;
    }[]>(
      `select werkzeug::text as werkzeug, modell, tokens_eingabe,
              kosten_mikrocent::text, dauer_ms, eingabe_hash,
              (begonnen_am <= beendet_am and beendet_am - begonnen_am < interval '1 minute')
                as plausibel
         from agent_schritt`);

    expect(s?.werkzeug).toBe('entwirf_text');
    expect(s?.modell).toBe('pruefmodell');
    expect(s?.tokens_eingabe).toBe(1200);
    expect(s?.kosten_mikrocent).toBe('810');
    expect(s?.dauer_ms).toBe(1234);
    expect(s?.eingabe_hash).toMatch(/^[0-9a-f]{64}$/u);
    /* Die Zeitpunkte sind die des Servers — nicht `now() - dauer_ms` aus der Angabe des Aufrufers. */
    expect(s?.plausibel).toBe(true);
  });

  it('ein protokollierter Schritt lässt sich nicht mehr ändern', async () => {
    await schalteEin('akquise');
    await legeBudgetAn('mandant', 10_000);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'akquise', vorgangTyp: 'interner_hinweis', titel: 'Hinweis',
      });
      await protokolliereSchritt(d, f.reinigung, a, {
        eingabe: { x: 1 }, dauerMs: 5, tokensAusgabe: 7,
      });
      await beendeAufgabe(d, f.reinigung, a.id, { status: 'abgeschlossen' });
    });

    await expect(sql.unsafe(`update agent_schritt set tokens_ausgabe = 999999`))
      .rejects.toThrow(/nicht geaendert/u);
    await expect(sql.unsafe(`delete from agent_schritt`)).rejects.toThrow();
  });

  it('ein ausgeschalteter Agent läuft nicht', async () => {
    await expect(alsApp(sitzung(), async (tx) => starteAufgabe(alsDienst(tx), f.reinigung, {
      agentKennung: 'finanzen', vorgangTyp: 'interner_hinweis', titel: 'Nein',
    }))).rejects.toThrow(/nicht eingeschaltet/u);
  });

  it('derselbe Idempotenzschlüssel startet keine zweite Aufgabe', async () => {
    await schalteEin('backoffice');
    await legeBudgetAn('mandant', 10_000);
    const schluessel = `ereignis-${zufall()}`;

    const ersteId = await alsApp(sitzung(), async (tx) => (await starteAufgabe(
      alsDienst(tx), f.reinigung, {
        agentKennung: 'backoffice', vorgangTyp: 'termin_bestaetigen', titel: 'Termin',
        idempotenzSchluessel: schluessel,
      })).id);

    const zweite = await alsApp(sitzung(), async (tx) => starteAufgabe(
      alsDienst(tx), f.reinigung, {
        agentKennung: 'backoffice', vorgangTyp: 'termin_bestaetigen', titel: 'Termin',
        idempotenzSchluessel: schluessel,
      }));

    expect(zweite.bestand).toBe(true);
    expect(zweite.id).toBe(ersteId);
  });
});

describe('(2) das Budget stoppt hart — und der Stopp bleibt sichtbar', () => {
  it('ohne Budgetzeile läuft gar nichts (O-26)', async () => {
    await schalteEin('akquise');
    const urteil = await alsApp(sitzung(), async (tx) =>
      pruefeBudget(alsDienst(tx), f.reinigung, await agentId('akquise'), 1000n));
    expect(urteil.verdikt).toBe('budget_fehlt');
  });

  it('ein NULL-Budget ist kein freies Budget', async () => {
    await schalteEin('akquise');
    await legeBudgetAn('mandant', null);
    const urteil = await alsApp(sitzung(), async (tx) =>
      pruefeBudget(alsDienst(tx), f.reinigung, await agentId('akquise'), 1000n));
    expect(urteil.verdikt).toBe('budget_fehlt');
  });

  it('DER Fall: erschöpft ⇒ abgelehnt, Status gestoppt, Benachrichtigung da', async () => {
    await schalteEin('akquise');
    const budgetId = await legeBudgetAn('mandant', 100); // 1,00 €
    // Verbrauch einspielen: 0,99 € sind 990.000 Mikrocent.
    await sql.unsafe(
      `update agent_budget set verbrauch_mikrocent = 990000 where id = $1`, [budgetId]);

    const a = await alsApp(sitzung(), async (tx) => starteAufgabe(alsDienst(tx), f.reinigung, {
      agentKennung: 'akquise', vorgangTyp: 'interner_hinweis', titel: 'Teuer',
    }));

    // 0,02 € mehr als übrig ist.
    await expect(reserviereMitHartstopp(
      verbindung(), f.reinigung, await agentId('akquise'), a.id, 20_000n,
    )).rejects.toThrow(BudgetErschoepft);

    // **Nach** dem abgelehnten Aufruf muss beides noch da sein.
    const [b] = await sql.unsafe<{ status: string; gestoppt_am: string | null }[]>(
      `select status::text as status, gestoppt_am::text from agent_budget where id = $1`,
      [budgetId]);
    expect(b?.status).toBe('gestoppt');
    expect(b?.gestoppt_am).not.toBeNull();

    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from benachrichtigung
        where art = 'agent.budget_erschoepft' and objekt_id = $1`, [budgetId]);
    expect(n?.n, 'ein Stopp ohne Meldung ist kein Stopp (AGT-05)').not.toBe('0');
  });

  it('ein erschöpftes Budget meldet EINMAL, nicht je abgelehntem Lauf', async () => {
    await schalteEin('akquise');
    const budgetId = await legeBudgetAn('mandant', 100);
    await sql.unsafe(
      `update agent_budget set verbrauch_mikrocent = 990000 where id = $1`, [budgetId]);
    const agent = await agentId('akquise');

    for (const titel of ['Erster', 'Zweiter', 'Dritter']) {
      const a = await alsApp(sitzung(), async (tx) => starteAufgabe(alsDienst(tx), f.reinigung, {
        agentKennung: 'akquise', vorgangTyp: 'interner_hinweis', titel,
      }));
      await expect(reserviereMitHartstopp(verbindung(), f.reinigung, agent, a.id, 20_000n))
        .rejects.toThrow(BudgetErschoepft);
    }

    /*
     * Drei Ablehnungen, EINE Meldung. Ohne die Bedingung „nur wenn der Stopp
     * in diesem Aufruf entstanden ist" haette ein Nachtlauf mit hundert
     * abgelehnten Aufgaben hundert Zeilen in den Posteingang geschrieben —
     * und der Posteingang, in dem hundert gleiche Zeilen stehen, wird nicht
     * gelesen, sondern geleert.
     */
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from benachrichtigung
        where art = 'agent.budget_erschoepft' and objekt_id = $1`, [budgetId]);
    expect(n?.n).toBe('1');
  });

  it('der zweite Vermerk sagt, dass er nichts Neues war', async () => {
    await schalteEin('akquise');
    const budgetId = await legeBudgetAn('mandant', 100);

    const erst = await alsApp(sitzung(),
      async (tx) => vermerkeStopp(alsDienst(tx), f.reinigung, budgetId));
    expect(erst.neu, 'der erste Vermerk stoppt').toBe(true);
    expect(erst.empfaenger, 'super_admin hält agent.budget_verwalten').toBeGreaterThan(0);

    const zweit = await alsApp(sitzung(),
      async (tx) => vermerkeStopp(alsDienst(tx), f.reinigung, budgetId));
    expect(zweit.neu).toBe(false);
    expect(zweit.empfaenger).toBe(0);
  });

  it('B5: der Mandantsdeckel gilt AUCH, wenn es einen Agentendeckel gibt', async () => {
    await schalteEin('akquise');
    await legeBudgetAn('mandant', 200);            // 2,00 €
    await legeBudgetAn('agent', 500, 'akquise');   // 5,00 € — darf nicht gewinnen

    const urteil = await alsApp(sitzung(), async (tx) =>
      pruefeBudget(alsDienst(tx), f.reinigung, await agentId('akquise'), 3_000_000n));

    expect(urteil.verdikt, 'der engere Deckel entscheidet').toBe('gestoppt');
  });

  it('(4) mit erschöpftem Budget läuft der manuelle Weg weiter', async () => {
    await schalteEin('akquise');
    const budgetId = await legeBudgetAn('mandant', 1);
    await sql.unsafe(
      `update agent_budget set verbrauch_mikrocent = 100000 where id = $1`, [budgetId]);
    await alsApp(sitzung(), async (tx) => vermerkeStopp(alsDienst(tx), f.reinigung, budgetId));

    // Ein Mensch legt weiter Kunden an — der Stopp betrifft die Agenten, nicht ihn.
    const [k] = await alsApp(sitzung(), async (tx) => tx.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, typ, name, strasse, hausnummer, plz, ort)
       values ($1, $2, 'firma', 'Trotzdem GmbH', 'Weg', '1', '10178', 'Berlin')
       returning id`, [f.reinigung, `K-${zufall()}`] as never[]));
    expect(k?.id).toBeDefined();
  });
});

describe('(3) die Kosten stimmen mit den Schritten überein', () => {
  it('Reservierung, Buchung, Verbrauch und Aufgabensumme greifen ineinander', async () => {
    await schalteEin('finanzen');
    const budgetId = await legeBudgetAn('mandant', 10_000);
    const agent = await agentId('finanzen');

    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'finanzen', vorgangTyp: 'buchung_uebernehmen', titel: 'Beleg lesen',
      });
      const res = await reserviere(d, f.reinigung, agent, a.id, 50_000n);

      // Die Reservierung steht auf dem Zähler …
      const [vor] = await tx.unsafe<{ reserviert_mikrocent: string }[]>(
        `select reserviert_mikrocent::text from agent_budget where id = $1`,
        [budgetId] as never[]);
      expect(vor?.reserviert_mikrocent).toBe('50000');

      await protokolliereSchritt(d, f.reinigung, a, {
        werkzeug: 'lies_dokument', modell: 'pruefmodell',
        eingabe: { dokumentId: 'x' }, tokensEingabe: 1000,
        kostenMikrocent: 44_000n, dauerMs: 900,
      });
      await bucheKosten(d, f.reinigung, {
        agentId: agent, aufgabeId: a.id, budgetId: res.budgetId,
        reservierungId: res.reservierungId, kostenMikrocent: 44_000n,
        tokensEingabe: 1000n, tokensAusgabe: 0n, tokensGedanken: 0n,
        modell: 'pruefmodell', preislisteId, betragOriginal: 44n,
        waehrungOriginal: 'USD', wechselkurs: null,
      });
      await beendeAufgabe(d, f.reinigung, a.id, { status: 'abgeschlossen' });
    });

    // … und ist nach der Buchung frei, der Verbrauch steht.
    const [nach] = await sql.unsafe<{
      verbrauch_mikrocent: string; reserviert_mikrocent: string;
    }[]>(
      `select verbrauch_mikrocent::text, reserviert_mikrocent::text
         from agent_budget where id = $1`, [budgetId]);
    expect(nach?.verbrauch_mikrocent).toBe('44000');
    expect(nach?.reserviert_mikrocent, 'die Reservierung ist gebucht, nicht offen').toBe('0');

    const [res] = await sql.unsafe<{ freigabe_grund: string }[]>(
      `select freigabe_grund::text as freigabe_grund from agent_reservierung`);
    expect(res?.freigabe_grund).toBe('gebucht');

    // Die Aufgabensumme ist die EINE Cent-Umrechnung: 44.000 → 4 Cent.
    const [a] = await sql.unsafe<{ kosten_cent: string }[]>(
      `select kosten_cent::text from agent_aufgabe`);
    expect(a?.kosten_cent).toBe('4');

    const verbrauch = await alsApp(sitzung(), async (tx) => monatsverbrauch(alsDienst(tx)));
    expect(verbrauch.find((v) => v.agent === 'Finanz-Assistent')?.cent).toBe(4n);
  });

  it('eine Kostenzeile lässt sich nicht ändern und nicht löschen', async () => {
    await schalteEin('finanzen');
    const budgetId = await legeBudgetAn('mandant', 10_000);
    const agent = await agentId('finanzen');

    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'finanzen', vorgangTyp: 'buchung_uebernehmen', titel: 'Beleg',
      });
      await bucheKosten(d, f.reinigung, {
        agentId: agent, aufgabeId: a.id, budgetId, reservierungId: null,
        kostenMikrocent: 1000n, tokensEingabe: 10n, tokensAusgabe: 0n, tokensGedanken: 0n,
        modell: null, preislisteId, betragOriginal: 1n, waehrungOriginal: 'USD',
        wechselkurs: null,
      });
      await beendeAufgabe(d, f.reinigung, a.id, { status: 'abgeschlossen' });
    });

    await expect(sql.unsafe(`update agent_kosten set kosten_mikrocent = 1`))
      .rejects.toThrow(/nicht geaendert/u);
    await expect(sql.unsafe(`delete from agent_kosten`)).rejects.toThrow();
  });
});

describe('(5) die Nutzlast ist ein eigenes Tor (0129, SEC-A9)', () => {
  /**
   * `agent_schritt.eingabe` und `.ausgabe` fehlen `cse_app` schon im Grant
   * (K-05). Lesbar sind sie ueber `app.agent_nutzlast_lesen` — mit
   * `agent.protokoll_lesen`, und der Zugriff steht im Audit.
   *
   * Geprueft werden BEIDE Richtungen. Nur die erste zu pruefen hiesse zu
   * zeigen, dass das Tor sich oeffnen laesst — nicht, dass es eines ist.
   */
  async function legeSchrittAn(): Promise<string> {
    await schalteEin('finanzen');
    await legeBudgetAn('mandant', 10_000);
    return alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'finanzen', vorgangTyp: 'buchung_uebernehmen', titel: 'Beleg',
      });
      const s = await protokolliereSchritt(d, f.reinigung, a, {
        werkzeug: 'lies_dokument', modell: 'pruefmodell',
        eingabe: { dokumentId: 'geheim-4711' }, ausgabe: { betrag: '119,00' },
        dauerMs: 300,
      });
      return s.schrittId;
    });
  }

  it('cse_app kommt an die Spalten gar nicht erst heran (K-05)', async () => {
    const schrittId = await legeSchrittAn();
    await expect(alsApp(sitzung(), async (tx) => tx.unsafe(
      `select eingabe from agent_schritt where id = $1`, [schrittId] as never[],
    ))).rejects.toThrow(/permission denied/u);
  });

  it('die Nutzlast steht als OBJEKT in der Spalte, nicht als ihr JSON-Text', async () => {
    const schrittId = await legeSchrittAn();

    /*
     * Der Befund, gegen den dieser Fall geschrieben ist: `JSON.stringify` in
     * einem `$n::jsonb`-Parameter kodiert ein ZWEITES Mal. In der Spalte steht
     * dann eine JSON-Zeichenkette, `jsonb_typeof` sagt `string`, und jeder
     * spaetere Zugriff mit `->>` liefert NULL — ohne Fehler, ohne Meldung, und
     * die Zeile sieht vollstaendig aus. Genau so stand es hier, bis die
     * Pruefung des Nutzlast-Tors es aufdeckte.
     */
    const [z] = await sql.unsafe<{ typ: string; dokument: string | null }[]>(
      `select jsonb_typeof(eingabe) as typ, eingabe ->> 'dokumentId' as dokument
         from agent_schritt where id = $1`, [schrittId]);

    expect(z?.typ, 'eine JSON-Zeichenkette ist kein Objekt').toBe('object');
    expect(z?.dokument).toBe('geheim-4711');
  });

  it('mit dem Recht liefert das Tor die Nutzlast — und schreibt den Zugriff auf', async () => {
    const schrittId = await legeSchrittAn();

    /*
     * Ausgepackt IN SQL (`->>`) und nicht im Treiber: `postgres.js` liefert
     * `jsonb` aus einer Funktion mit Tabellenrueckgabe als Zeichenkette und
     * aus einer Tabellenspalte als Objekt. Der Test soll das Tor pruefen und
     * nicht diese Eigenheit; die Behauptung steht deshalb dort, wo sie in
     * jedem Fall dasselbe heisst.
     */
    const [zeile] = await alsApp(sitzung(), async (tx) => tx.unsafe<{
      dokument: string | null; betrag: string | null;
    }[]>(
      `select eingabe ->> 'dokumentId' as dokument, ausgabe ->> 'betrag' as betrag
         from app.agent_nutzlast_lesen($1)`, [schrittId] as never[]));

    expect(zeile?.dokument).toBe('geheim-4711');
    expect(zeile?.betrag).toBe('119,00');

    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'agent.nutzlast_gelesen' and objekt_id = $1`, [schrittId]);
    expect(spur?.n, 'wer eine Modelleingabe liest, hinterlaesst eine Spur (SEC-A9)')
      .toBe('1');
  });

  it('ohne das Recht bleibt sie leer — und das Audit bleibt es auch', async () => {
    const schrittId = await legeSchrittAn();

    /**
     * Ein Konto mit der Rolle `admin` IM Mandanten — nicht der `super_admin`
     * mit entzogenem Recht.
     *
     * Der Entzug schien der kuerzere Weg und ist keiner: `kern` verbietet ihn
     * („Der super_admin kann sich Rechte nicht entziehen"), und das zu Recht.
     * `admin` ist ausserdem der ECHTE Fall — die Rolle haelt `agent.lesen`,
     * aber nicht `agent.protokoll_lesen`: sie sieht, DASS ein Lauf war, und
     * nicht, was er gelesen hat. Genau diese Trennung soll das Tor tragen.
     *
     * Und sie sieht den Mandanten. Ein Konto ohne Zugehoerigkeit bekaeme
     * ebenfalls null Zeilen — aber wegen der Mandantsgrenze, nicht wegen des
     * Rechts, und der Test bewiese dann etwas anderes, als er behauptet.
     */
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`,
      [`admin-${zufall()}@cse.test`]);
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status)
       values ($1, $2, 'Verwaltung', 'aktiv')`,
      [u!.id, `admin-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle
                         where schluessel = 'admin' and mandant_id is null))`,
      [u!.id, f.reinigung]);

    const ohneRecht = {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: u!.id,
      portal: 'intern' as const, readonly: false,
    };

    // Die Vorbedingung: dieses Konto DARF den Lauf sehen. Sonst prüfte der
    // Fall die Mandantsgrenze und nicht das Tor.
    const [darf] = await alsApp(ohneRecht, async (tx) => tx.unsafe<{
      lesen: boolean; protokoll: boolean;
    }[]>(
      `select app.hat_recht('agent.lesen', app.aktiver_mandant()) as lesen,
              app.hat_recht('agent.protokoll_lesen', app.aktiver_mandant()) as protokoll`));
    expect(darf?.lesen, 'admin sieht den Lauf').toBe(true);
    expect(darf?.protokoll, 'admin sieht die Nutzlast nicht').toBe(false);

    const zeilen = await alsApp(ohneRecht, async (tx) => tx.unsafe(
      `select eingabe from app.agent_nutzlast_lesen($1)`, [schrittId] as never[]));
    expect(zeilen).toHaveLength(0);

    const [spur] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'agent.nutzlast_gelesen' and objekt_id = $1`, [schrittId]);
    expect(spur?.n, 'ein abgewiesener Zugriff ist kein Zugriff auf die Nutzlast')
      .toBe('0');
  });
});

describe('das Zentrum sieht, was lief', () => {
  it('listet die Aufgaben mit Agent, Status und Kosten', async () => {
    await schalteEin('backoffice');
    await legeBudgetAn('mandant', 10_000);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'backoffice', vorgangTyp: 'ersatz_vorschlagen', titel: 'Ersatz für Montag',
      });
      await beendeAufgabe(d, f.reinigung, a.id, { status: 'abgeschlossen' });
    });

    const zeilen = await alsApp(sitzung(), async (tx) => letzteAufgaben(alsDienst(tx)));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.agent).toBe('Rueckbuero-Assistent');
    expect(zeilen[0]?.status).toBe('abgeschlossen');
    expect(zeilen[0]?.kostenCent).toBe(0n);
  });

  it('eine fremde Gesellschaft sieht die Aufgabe nicht', async () => {
    await schalteEin('backoffice');
    await legeBudgetAn('mandant', 10_000);
    await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const a = await starteAufgabe(d, f.reinigung, {
        agentKennung: 'backoffice', vorgangTyp: 'interner_hinweis', titel: 'Nur hier',
      });
      await beendeAufgabe(d, f.reinigung, a.id, { status: 'abgeschlossen' });
    });

    const fremd = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => letzteAufgaben(alsDienst(tx)));
    expect(fremd).toHaveLength(0);
  });
});
