import 'server-only';
import { monatsName } from '../../lib/datum/kalendertag.js';
import { erzeuge, findeArt } from '../benachrichtigung/registry.js';
import { ART_BUDGET_ERSCHOEPFT, registriereAgentArten } from './benachrichtigung.js';
import { RESERVIERUNG_MINUTEN_PLATZHALTER } from './limits.platzhalter.js';

/**
 * Das Monatsbudget der Agenten und sein **harter** Stopp (AGT-05).
 *
 * „Hart" heißt: der nächste Aufruf wird **abgelehnt**. Nicht verkleinert,
 * nicht gekürzt, nicht auf ein billigeres Modell umgelenkt und nicht auf
 * morgen verschoben. Eine Obergrenze, die man durch Degradieren umgeht, ist
 * keine Obergrenze — sie ist eine Empfehlung mit Zahl.
 *
 * **Die Prüfung wirft nicht, sie urteilt.** `app.agent_budget_pruefen` gibt
 * ein Urteil zurück; `reserviereMitHartstopp` schreibt daraufhin Status,
 * Zeitpunkt und Benachrichtigung in einer **eigenen** Transaktion, die
 * committet, und lehnt den Lauf erst danach ab. Die frühere Fassung setzte
 * den Status und warf in derselben Transaktion — der Rollback nahm Status und
 * Benachrichtigung mit, und derselbe Aufruf lief für immer in denselben
 * Fehler, ohne dass irgendwo stand, dass gestoppt wurde (D-428).
 *
 * **Reservieren, bevor es teuer wird.** Ein Lauf reserviert seinen
 * geschätzten Betrag als ZEILE mit Verfallszeit. Ein abgestürzter Lauf hält
 * damit kein Budget für immer: der Wächter gibt abgelaufene Zeilen frei und
 * meldet, wie viele.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type Verdikt = 'ok' | 'gestoppt' | 'budget_fehlt';

export interface BudgetUrteil {
  readonly verdikt: Verdikt;
  /** Die Zeile, an der es scheiterte — für die Meldung und den Stopp. */
  readonly budgetId: string | null;
}

/** Ein Agent ohne Budget läuft nicht, und ein gestoppter erst recht nicht. */
export class BudgetErschoepft extends Error {
  constructor(
    public readonly verdikt: Exclude<Verdikt, 'ok'>,
    public readonly budgetId: string | null,
    /** Gesetzt, wenn zusätzlich der Stoppvermerk nicht geschrieben werden konnte. */
    optionen?: { readonly cause: unknown },
  ) {
    super(
      verdikt === 'budget_fehlt'
        ? 'Für diesen Monat ist kein KI-Budget hinterlegt (O-26) — der Agent läuft nicht.'
        : 'Das KI-Monatsbudget ist erschöpft. Der Lauf wird abgelehnt (AGT-05).',
      optionen,
    );
    this.name = 'BudgetErschoepft';
  }
}

interface UrteilRoh {
  readonly verdikt: Verdikt;
  readonly budget_id: string | null;
}

/** Fragt das Urteil ab — ohne etwas zu ändern. */
export async function pruefeBudget(
  db: Abfrage, mandantId: string, agentId: string, betragMikrocent: bigint,
): Promise<BudgetUrteil> {
  const [zeile] = await db.abfrage<UrteilRoh>(
    'select verdikt::text as verdikt, budget_id from app.agent_budget_pruefen($1, $2, $3::bigint)',
    [mandantId, agentId, betragMikrocent.toString()]);

  if (zeile === undefined) {
    // Kein Ergebnis ist kein „ok": die Funktion liefert immer eine Zeile.
    return { verdikt: 'budget_fehlt', budgetId: null };
  }
  return { verdikt: zeile.verdikt, budgetId: zeile.budget_id };
}

/**
 * Schreibt den Stopp **sichtbar**: Status, Zeitpunkt und je eine
 * Benachrichtigung an alle, die das Budget verwalten dürfen.
 *
 * **Die Empfänger werden abgeleitet, nicht erfunden.** Wer
 * `agent.budget_verwalten` für diesen Mandanten hält, ist die Person, die
 * eine erschöpfte Obergrenze angeht — das folgt aus dem Rechtemodell und ist
 * keine Annahme über die Organisation. Findet sich niemand, bleibt der Stopp
 * trotzdem geschrieben und die Funktion meldet es zurück: ein Stopp ohne
 * Empfänger ist ein Befund, kein Grund, nicht zu stoppen.
 *
 * **Geschrieben wird in der Datenbank, nicht hier.** `benachrichtigung` nimmt
 * von `cse_app` kein `insert` an — Posteingänge füllen Systemläufe, nicht die
 * Sitzung eines Menschen. `app.agent_stopp_vermerken` (0128) ist der enge,
 * benannte Schreiber dafür: er setzt den Status, leitet die Empfänger ab und
 * schreibt **nur dann**, wenn der Stopp in genau diesem Aufruf entstanden ist.
 * Ein zweiter abgelehnter Lauf meldet deshalb nichts mehr — ein erschöpftes
 * Budget erzeugt eine Meldung, nicht eine je Versuch.
 *
 * Titel und Text kommen aus der Artenregistratur (NOT-01/NOT-03), damit die
 * Formulierung an einer Stelle steht und nicht zusätzlich im SQL.
 */
export async function vermerkeStopp(
  db: Abfrage, mandantId: string, budgetId: string,
): Promise<{ readonly neu: boolean; readonly empfaenger: number }> {
  if (findeArt(ART_BUDGET_ERSCHOEPFT) === undefined) registriereAgentArten();

  /*
   * Der Monat der Zeile, nicht „jetzt": ein Lauf kurz nach Mitternacht am
   * Ersten würde sonst den falschen Monat melden. Bleibt die Zeile
   * unsichtbar (RLS), meldet der Text ihn gar nicht — lieber ohne Monat als
   * mit dem falschen.
   */
  const [zeitraum] = await db.abfrage<{
    readonly jahr: number; readonly monat: number; readonly slug: string;
  }>(
    `select b.jahr, b.monat, m.slug
       from agent_budget b
       join mandant m on m.id = b.mandant_id
      where b.mandant_id = $1 and b.id = $2`,
    [mandantId, budgetId]);

  const monat = zeitraum === undefined
    ? ''
    : monatsName(`${String(zeitraum.jahr).padStart(4, '0')}-`
      + `${String(zeitraum.monat).padStart(2, '0')}-01`);

  const meldung = erzeuge(ART_BUDGET_ERSCHOEPFT, {
    mandantId, mandantSlug: zeitraum?.slug ?? null,
    objektTyp: 'agent_budget', objektId: budgetId, daten: { monat },
  });

  const [ergebnis] = await db.abfrage<{ readonly neu: boolean; readonly empfaenger: number }>(
    'select neu, empfaenger from app.agent_stopp_vermerken($1, $2, $3, $4, $5)',
    [mandantId, budgetId, meldung.titel, meldung.text, meldung.ziel]);

  return ergebnis ?? { neu: false, empfaenger: 0 };
}

/**
 * Reserviert einen Betrag für eine Aufgabe — oder wirft, wenn das Budget
 * nicht trägt.
 *
 * Die Reihenfolge ist der Punkt: **erst prüfen, dann reservieren**, beides in
 * derselben Transaktion, und die Prüfung sperrt die Budgetzeilen. Zwei
 * gleichzeitige Läufe können damit nicht beide „gerade noch" durchkommen.
 */
export async function reserviere(
  db: Abfrage, mandantId: string, agentId: string, aufgabeId: string,
  betragMikrocent: bigint,
): Promise<{ readonly reservierungId: string; readonly budgetId: string }> {
  const urteil = await pruefeBudget(db, mandantId, agentId, betragMikrocent);

  /*
   * **Hier wird NICHT vermerkt.** Diese Funktion wirft, und ihr Wurf rollt die
   * Transaktion zurueck, in der sie laeuft — samt allem, was sie vorher
   * geschrieben haette. Der Stoppvermerk gehoert deshalb in eine eigene
   * Transaktion; `reserviereMitHartstopp` unten oeffnet sie.
   */
  if (urteil.verdikt !== 'ok') {
    throw new BudgetErschoepft(urteil.verdikt, urteil.budgetId);
  }

  /*
   * Welche Budgetzeile trägt die Reservierung? Die des Agenten, wenn es sie
   * gibt, sonst die des Mandanten — dieselbe Reihenfolge wie in der Prüfung,
   * damit Reservierung und Prüfung nie auf verschiedene Zeilen zeigen.
   */
  const [budget] = await db.abfrage<{ readonly id: string }>(
    `select id from agent_budget
      where mandant_id = $1
        and jahr  = extract(year  from (now() at time zone 'Europe/Berlin'))::integer
        and monat = extract(month from (now() at time zone 'Europe/Berlin'))::integer
        and (geltungsbereich = 'agent' and agent_id = $2
             or geltungsbereich = 'mandant')
      order by (geltungsbereich = 'agent') desc
      limit 1`,
    [mandantId, agentId]);

  if (budget === undefined) throw new BudgetErschoepft('budget_fehlt', null);

  const [neu] = await db.abfrage<{ readonly id: string }>(
    `insert into agent_reservierung
       (mandant_id, agent_budget_id, agent_aufgabe_id, betrag_mikrocent, verfaellt_am)
     values ($1, $2, $3, $4::bigint, now() + make_interval(mins => $5))
     returning id`,
    [mandantId, budget.id, aufgabeId, betragMikrocent.toString(),
      RESERVIERUNG_MINUTEN_PLATZHALTER]);

  if (neu === undefined) throw new Error('Die Reservierung ließ sich nicht anlegen.');
  return { reservierungId: neu.id, budgetId: budget.id };
}

/**
 * Was eine EIGENE Transaktion eröffnen kann — der Verbindungspool, nicht die
 * gerade laufende Transaktion.
 */
export interface Verbindung {
  transaktion<T>(arbeit: (db: Abfrage) => Promise<T>): Promise<T>;
}

/**
 * Reservieren — und einen Hartstopp so vermerken, dass er die Ablehnung
 * **überlebt** (AGT-05).
 *
 * **Der Befund, gegen den diese Funktion geschrieben ist.** Prüfung, Vermerk
 * und Ablehnung standen in EINER Transaktion. Die Ablehnung ist ein `throw`;
 * der `throw` rollt die Transaktion zurück; der Rückroll nahm Status und
 * Benachrichtigung mit. Das Ergebnis war ein Budget, das jeden Lauf ablehnte
 * und dabei nirgends stehen hatte, dass es das tut — der teuerste denkbare
 * Zustand, weil er wie ein Ausfall des Agenten aussieht und nicht wie eine
 * erreichte Obergrenze.
 *
 * Deshalb zwei Transaktionen, in dieser Reihenfolge:
 *
 *  1. prüfen und reservieren — schlägt fehl, rollt zurück, schreibt nichts;
 *  2. **danach**, auf einer eigenen Transaktion, den Stopp schreiben und
 *     committen;
 *  3. erst dann den Lauf ablehnen.
 *
 * Schlägt Schritt 2 seinerseits fehl, wird die ursprüngliche Ablehnung
 * geworfen — mit dem Schreibfehler als `cause`. Der Lauf muss auf jeden Fall
 * abgelehnt werden; dass der Vermerk fehlt, ist ein zweiter Befund und keiner,
 * der den ersten aufhebt.
 */
export async function reserviereMitHartstopp(
  verbindung: Verbindung, mandantId: string, agentId: string, aufgabeId: string,
  betragMikrocent: bigint,
): Promise<{ readonly reservierungId: string; readonly budgetId: string }> {
  try {
    return await verbindung.transaktion(
      async (db) => reserviere(db, mandantId, agentId, aufgabeId, betragMikrocent));
  } catch (fehler) {
    if (!(fehler instanceof BudgetErschoepft)) throw fehler;
    const budgetId = fehler.budgetId;
    if (fehler.verdikt !== 'gestoppt' || budgetId === null) throw fehler;

    try {
      await verbindung.transaktion(async (db) => vermerkeStopp(db, mandantId, budgetId));
    } catch (vermerkFehler) {
      throw new BudgetErschoepft(fehler.verdikt, budgetId, { cause: vermerkFehler });
    }
    throw fehler;
  }
}

/** Gibt eine Reservierung frei, ohne zu buchen — Abbruch oder Verfall. */
export async function gibReservierungFrei(
  db: Abfrage, mandantId: string, reservierungId: string,
  grund: 'abgebrochen' | 'verfallen',
): Promise<void> {
  await db.abfrage(
    `update agent_reservierung
        set freigegeben_am = now(), freigabe_grund = $3::reservierung_ende
      where mandant_id = $1 and id = $2 and freigegeben_am is null`,
    [mandantId, reservierungId, grund]);
}

export interface Kostenbuchung {
  readonly agentId: string;
  readonly aufgabeId: string | null;
  readonly budgetId: string;
  readonly reservierungId: string | null;
  readonly kostenMikrocent: bigint;
  readonly tokensEingabe: bigint;
  readonly tokensAusgabe: bigint;
  readonly tokensGedanken: bigint;
  readonly modell: string | null;
  readonly preislisteId: string;
  readonly betragOriginal: bigint;
  readonly waehrungOriginal: string;
  readonly wechselkurs: string | null;
}

/**
 * Bucht die tatsächlichen Kosten. Der Ausloeser in 0128 schreibt den Verbrauch
 * fort, gibt die Reservierung frei und rechnet die Aufgabensumme in Cent um —
 * alles in derselben Transaktion, damit kein Zwischenzustand existiert, in dem
 * Budget doppelt gebunden oder Verbrauch ungebucht ist.
 */
export async function bucheKosten(
  db: Abfrage, mandantId: string, buchung: Kostenbuchung,
): Promise<string> {
  const [zeile] = await db.abfrage<{ readonly id: string }>(
    `insert into agent_kosten
       (mandant_id, agent_id, agent_aufgabe_id, agent_budget_id, agent_reservierung_id,
        jahr, monat, kosten_mikrocent, tokens_eingabe, tokens_ausgabe, tokens_gedanken,
        modell, agent_preisliste_id, betrag_original, waehrung_original, wechselkurs)
     values ($1, $2, $3, $4, $5,
             extract(year  from (now() at time zone 'Europe/Berlin'))::integer,
             extract(month from (now() at time zone 'Europe/Berlin'))::integer,
             $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10, $11, $12::bigint, $13, $14)
     returning id`,
    [mandantId, buchung.agentId, buchung.aufgabeId, buchung.budgetId,
      buchung.reservierungId, buchung.kostenMikrocent.toString(),
      buchung.tokensEingabe.toString(), buchung.tokensAusgabe.toString(),
      buchung.tokensGedanken.toString(), buchung.modell, buchung.preislisteId,
      buchung.betragOriginal.toString(), buchung.waehrungOriginal, buchung.wechselkurs]);

  if (zeile === undefined) throw new Error('Die Kostenzeile ließ sich nicht schreiben.');
  return zeile.id;
}
