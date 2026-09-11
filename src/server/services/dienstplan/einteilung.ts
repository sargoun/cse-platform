/**
 * Die Einteilung — ein Mensch kommt an eine Schicht (TIM-05, TIM-06, TIM-14,
 * SEC-04, LEG-03, LEG-04).
 *
 * **Das war die Luecke.** Der Generator legte Schichten an, die Konfliktliste
 * zeigte Befunde, die Zeiterfassung wartete auf eine Einteilung — und es gab
 * keinen einzigen Schreibpfad auf `einsatz_zuordnung`. Ein Plan, in dem
 * niemand eingeteilt werden kann, ist ein Kalender; ohne Zuordnung gibt es
 * keinen Check-in-Link, keinen Zeiteintrag, keine ArbZG-Belastung und keine
 * Abrechnung.
 *
 * **Zwei Tore, und sie sind verschieden hart:**
 *
 *  - **Qualifikation ist eine SPERRE.** § 34a GewO kennt keine Begruendung,
 *    die einen fehlenden Sachkundenachweis ersetzt (SEC-04, LEG-04). Der
 *    Dienst prueft ueber `assertZuordnungZulaessig` und schreibt nicht; die
 *    Datenbank prueft dieselbe Frage noch einmal im Ausloeser
 *    `erzwinge_einsatz_qualifikation` — zwei Linien, weil eine Einteilung
 *    auch an diesem Dienst vorbei entstehen kann.
 *  - **ArbZG ist eine WARNUNG.** § 3 und § 5 ArbZG kennen Ausnahmen (§ 7,
 *    § 14), und die Software darf sie nicht fuer den Menschen entscheiden.
 *    Der Planer sieht den Befund, BEVOR er speichert (PR 33 Abnahme 3), und
 *    kann ihn nur mit `bestaetigt` uebergehen. Uebergangen heisst nicht
 *    verschwunden: derselbe Aufruf schreibt den Verstoss und laesst den
 *    Detektor den Konflikt anlegen, der im Eingang mit **Begruendung**
 *    quittiert werden muss (`POST /api/konflikt`).
 *
 * **Wenig eigenes SQL, und das mit Absicht.** Fenster, Qualifikationsabdruck,
 * Besetzungszaehler, ArbZG-Projektion und die Ruecknahme der Check-in-Marken
 * haengen als Ausloeser an der Tabelle. Sie hier noch einmal zu rechnen
 * hiesse, eine zweite Wahrheit zu pflegen, die beim ersten Pfad, der an
 * diesem Dienst vorbeigeht, auseinanderlaeuft.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { assertZuordnungZulaessig, type Torbefund } from '../nachweis/tor.js';
import { pruefeEinsatz } from '../arbzg/pruefung.js';
import { erkenneKonflikte } from '../arbzg/detektor.js';
import type { ArbzgBefund } from '../zeit/arbzg.js';

/** Die rohe Abfrageflaeche, die die beiden Tore erwarten. */
interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

function alsAbfrage(kontext: SchreibKontext): Abfrage {
  return { unsafe: async (sql, werte = []) => kontext.schreibe(sql, werte) };
}

export class EinsatzNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Schicht ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'EinsatzNichtGefunden';
  }
}

export class AnstellungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403: dass es die Beschaeftigung anderswo gibt, ist selbst
    // eine Auskunft (AUT-06).
    super(`Beschäftigung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AnstellungNichtGefunden';
  }
}

export class SchichtStorniert extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super('Eine stornierte Schicht wird nicht besetzt.');
    this.name = 'SchichtStorniert';
  }
}

export class BereitsEingeteilt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super('Diese Beschäftigung ist auf dieser Schicht bereits eingeteilt.');
    this.name = 'BereitsEingeteilt';
  }
}

/**
 * Der Befund, der die Einteilung anhaelt — mit allem, was der Planer braucht,
 * um zu entscheiden.
 */
export class ArbzgWarnungOffen extends Error {
  readonly code = 'arbzg_warnung';
  readonly status = 422;
  readonly befunde: readonly ArbzgBefund[];
  readonly ueberGesellschaften: boolean;
  constructor(befunde: readonly ArbzgBefund[], ueberGesellschaften: boolean) {
    super(
      `Die Einteilung berührt ${String(befunde.length)} Arbeitszeitbefund(e). `
      + 'Sie wird erst nach ausdrücklicher Bestätigung geschrieben.',
    );
    this.name = 'ArbzgWarnungOffen';
    this.befunde = befunde;
    this.ueberGesellschaften = ueberGesellschaften;
  }
}

/**
 * Die Person ist an diesem Tag abgemeldet — und das haelt die Einteilung an.
 *
 * Nicht als Sperre: eine Krankmeldung kann zurueckgenommen werden, ein Urlaub
 * ist erst beantragt, und es gibt Faelle, in denen jemand bewusst trotzdem
 * eingeteilt wird (und die Abwesenheit danach storniert). Aber still
 * druebergehen darf der Weg nicht: eine Schicht, auf der jemand steht, der
 * nicht kommt, faellt erst am Einsatztag auf — um 06:00, vor einem
 * verschlossenen Objekt.
 */
export class AbwesendWarnungOffen extends Error {
  readonly code = 'abwesend';
  readonly status = 422;
  readonly hinweis: string;
  constructor(hinweis: string) {
    super(
      `Diese Beschäftigung ${hinweis}. Die Einteilung wird erst nach `
      + 'ausdrücklicher Bestätigung geschrieben.',
    );
    this.name = 'AbwesendWarnungOffen';
    this.hinweis = hinweis;
  }
}

/**
 * Die Arbeitszeitpruefung ist ein eigenes Recht (`dienstplan.arbzg_pruefen`,
 * K-06) — und ihr Fehlen darf NICHT wie „keine Befunde" aussehen.
 *
 * `app.arbzg_belastung` hebt `42501`, wenn der Aufrufer es nicht haelt. Diese
 * Ausnahme wird hier zu einem eigenen, benannten Fehler und nirgends zu einem
 * leeren Ergebnis geglaettet: eine abgewiesene Pruefung, die wie ein sauberer
 * Durchlauf aussieht, ist genau der Fall, gegen den die ganze Kette
 * geschrieben ist.
 */
export class ArbzgPruefungNichtErlaubt extends Error {
  readonly code = 'kein_recht';
  readonly status = 403;
  constructor() {
    super(
      'Die Arbeitszeitprüfung verlangt das Recht `dienstplan.arbzg_pruefen` '
      + '(K-06). Ohne sie wird nicht eingeteilt — ein ungeprüfter Plan ist '
      + 'nicht dasselbe wie ein geprüfter ohne Befund.',
    );
    this.name = 'ArbzgPruefungNichtErlaubt';
  }
}

/** `42501` ist die Absage der Datenbank, nicht ein Fehler dieses Dienstes. */
function istRechteFehler(fehler: unknown): boolean {
  return typeof fehler === 'object' && fehler !== null
    && (fehler as { code?: unknown }).code === '42501';
}

export interface EinteilungEingabe {
  readonly einsatzId: string;
  readonly anstellungId: string;
  readonly funktion?: string | null;
  /**
   * Hat der Planer die Arbeitszeitbefunde gesehen und trotzdem eingeteilt?
   *
   * Ohne dieses Wort wirft der Dienst `ArbzgWarnungOffen`. Ein stiller
   * Durchlauf waere die eine Variante, die nie passieren darf: sie sieht
   * genauso aus wie „keine Befunde".
   */
  readonly bestaetigt?: boolean;
}

export interface Einteilungsbefund {
  readonly zuordnungId: string;
  readonly personId: string;
  readonly qualifikation: Torbefund;
  readonly arbzg: readonly ArbzgBefund[];
  readonly ueberGesellschaften: boolean;
}

interface SchichtZeile {
  readonly id: string;
  readonly beginn_zeitpunkt: string;
  readonly ende_zeitpunkt: string;
  readonly storniert: boolean;
}

/** Die Vorschau: derselbe Befund, ohne zu schreiben (PR 33 Abnahme 3). */
export interface Vorschau {
  readonly qualifikation: Torbefund | null;
  readonly qualifikationsfehler: string | null;
  /** `null`: nicht geprüft, weil das Recht fehlt — nicht „nichts gefunden". */
  readonly arbzg: readonly ArbzgBefund[] | null;
  readonly ueberGesellschaften: boolean;
  /**
   * Ist die Person an diesem Tag abgemeldet? Der TEXT, nie der Grund
   * (Art. 9 DSGVO, 0073) — und `null`, wenn dieser Sitzung
   * `zeit.abwesenheit_lesen` fehlt: „nicht geprüft" ist etwas anderes als
   * „nicht abwesend".
   */
  readonly abwesend: string | null;
  readonly abwesenheitGeprueft: boolean;
}

/**
 * Ist diese Beschaeftigung im Zeitraum der Schicht abgemeldet?
 *
 * Gefragt wird `abwesenheit` mit dem Fenster der Schicht — und geantwortet
 * wird mit Status und Zeitraum, nie mit der Art. Der Planer erfaehrt, dass er
 * gerade jemanden einteilt, der nicht kommt; warum, geht ihn nichts an.
 *
 * Ohne `zeit.abwesenheit_lesen` gibt die RLS nichts heraus. Das darf nicht wie
 * „niemand ist abgemeldet" aussehen — deshalb wird das Recht zuerst gefragt.
 */
async function abwesenheitImFenster(
  kontext: SchreibKontext, anstellungId: string, beginn: Date, ende: Date,
): Promise<{ readonly geprueft: boolean; readonly text: string | null }> {
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('zeit.abwesenheit_lesen', app.aktiver_mandant()) as darf`,
  );
  if (recht?.darf !== true) return { geprueft: false, text: null };

  const [zeile] = await kontext.abfrage<{ status: string; von: string; bis: string }>(
    `select a.status::text as status,
            to_char(a.von, 'DD.MM.YYYY') as von,
            to_char(a.bis, 'DD.MM.YYYY') as bis
       from abwesenheit a
      where a.anstellung_id = $1::uuid
        and a.status in ('beantragt','genehmigt','erfasst')
        and daterange(a.von, a.bis, '[]') && daterange(
              ($2::timestamptz at time zone 'Europe/Berlin')::date,
              ($3::timestamptz at time zone 'Europe/Berlin')::date, '[]')
      order by a.von limit 1`,
    [anstellungId, beginn.toISOString(), ende.toISOString()],
  );
  if (zeile === undefined) return { geprueft: true, text: null };
  const wort = zeile.status === 'beantragt' ? 'hat Urlaub beantragt' : 'ist abgemeldet';
  return { geprueft: true, text: `${wort} vom ${zeile.von} bis ${zeile.bis}` };
}

async function ladeSchicht(kontext: SchreibKontext, id: string): Promise<SchichtZeile> {
  const [e] = await kontext.abfrage<SchichtZeile>(
    `select id, beginn_zeitpunkt, ende_zeitpunkt, (storniert_am is not null) as storniert
       from einsatz where id = $1::uuid`,
    [id],
  );
  if (e === undefined) throw new EinsatzNichtGefunden(id);
  return e;
}

async function ladePerson(kontext: SchreibKontext, anstellungId: string): Promise<string> {
  const [a] = await kontext.abfrage<{ person_id: string }>(
    `select person_id from anstellung
      where id = $1::uuid and geloescht_am is null and status = 'aktiv'`,
    [anstellungId],
  );
  if (a === undefined) throw new AnstellungNichtGefunden(anstellungId);
  return a.person_id;
}

/**
 * Prueft, ohne zu schreiben — was die Oberflaeche zeigt, bevor jemand
 * speichert.
 *
 * Der Qualifikationsfehler kommt als TEXT zurueck und nicht als Ausnahme:
 * eine Vorschau, die wirft, koennte die zweite Haelfte (ArbZG) nicht mehr
 * zeigen, und der Planer saehe immer nur den ersten Grund.
 */
export async function pruefeEinteilung(
  kontext: SchreibKontext, einsatzId: string, anstellungId: string,
): Promise<Vorschau> {
  const db = alsAbfrage(kontext);
  const schicht = await ladeSchicht(kontext, einsatzId);
  const personId = await ladePerson(kontext, anstellungId);

  let qualifikation: Torbefund | null = null;
  let qualifikationsfehler: string | null = null;
  try {
    qualifikation = await assertZuordnungZulaessig(db, anstellungId, einsatzId);
  } catch (fehler) {
    qualifikationsfehler = fehler instanceof Error ? fehler.message : String(fehler);
  }

  const beginn = new Date(schicht.beginn_zeitpunkt);
  const ende = new Date(schicht.ende_zeitpunkt);
  const abmeldung = await abwesenheitImFenster(kontext, anstellungId, beginn, ende);

  try {
    const ergebnis = await pruefeEinsatz(db, personId, beginn, ende, {
      schreiben: false,
      // Die Schicht, um die es geht, ist noch nicht gespeichert — ohne sie
      // rechnete die Vorschau ohne den Anlass.
      zusatzSchicht: { beginn, ende },
    });
    return {
      qualifikation,
      qualifikationsfehler,
      arbzg: ergebnis.befunde,
      ueberGesellschaften: ergebnis.ueberGesellschaften,
      abwesend: abmeldung.text,
      abwesenheitGeprueft: abmeldung.geprueft,
    };
  } catch (fehler) {
    if (!istRechteFehler(fehler)) throw fehler;
    // `null` heisst UNGEPRUEFT und wird in der Anzeige auch so benannt —
    // nicht als leere Liste, die wie „nichts gefunden" aussaehe.
    return {
      qualifikation, qualifikationsfehler, arbzg: null, ueberGesellschaften: false,
      abwesend: abmeldung.text, abwesenheitGeprueft: abmeldung.geprueft,
    };
  }
}

/**
 * Teilt ein — nach beiden Toren.
 *
 * Die Reihenfolge ist nicht beliebig: erst die Sperre (sie kann die Einteilung
 * unmoeglich machen), dann die Warnung (sie braucht eine Entscheidung), dann
 * der Schreibvorgang, dann der Detektor. Wuerde der Detektor vorher laufen,
 * schriebe er einen Konflikt zu einer Einteilung, die es nie gab.
 */
export async function besetzeEinsatz(
  kontext: SchreibKontext, eingabe: EinteilungEingabe,
): Promise<Einteilungsbefund> {
  const db = alsAbfrage(kontext);
  const schicht = await ladeSchicht(kontext, eingabe.einsatzId);
  if (schicht.storniert) throw new SchichtStorniert();
  const personId = await ladePerson(kontext, eingabe.anstellungId);

  const [schon] = await kontext.abfrage<{ id: string }>(
    `select id from einsatz_zuordnung
      where einsatz_id = $1::uuid and anstellung_id = $2::uuid
        and entfernt_am is null and status <> 'abgesagt'`,
    [eingabe.einsatzId, eingabe.anstellungId],
  );
  if (schon !== undefined) throw new BereitsEingeteilt();

  // Die Sperre. Wirft `QualifikationFehlt` mit dem Befund darin.
  const qualifikation = await assertZuordnungZulaessig(
    db, eingabe.anstellungId, eingabe.einsatzId);

  const beginn = new Date(schicht.beginn_zeitpunkt);
  const ende = new Date(schicht.ende_zeitpunkt);
  /**
   * Die Abmeldung zuerst: sie ist die billigste Antwort auf die Frage „kommt
   * dieser Mensch ueberhaupt?", und sie kostet eine Abfrage statt eines
   * Uebertritts ueber die Mandantengrenze.
   */
  const abmeldung = await abwesenheitImFenster(kontext, eingabe.anstellungId, beginn, ende);
  if (abmeldung.text !== null && eingabe.bestaetigt !== true) {
    throw new AbwesendWarnungOffen(abmeldung.text);
  }

  let vorher;
  try {
    vorher = await pruefeEinsatz(db, personId, beginn, ende, {
      schreiben: false, zusatzSchicht: { beginn, ende },
    });
  } catch (fehler) {
    if (istRechteFehler(fehler)) throw new ArbzgPruefungNichtErlaubt();
    throw fehler;
  }
  if (vorher.befunde.length > 0 && eingabe.bestaetigt !== true) {
    throw new ArbzgWarnungOffen(vorher.befunde, vorher.ueberGesellschaften);
  }

  const [neu] = await kontext.schreibe<{ id: string }>(
    /**
     * Beginn und Ende bleiben WEG: `kern.ez_fenster_pruefen` setzt sie aus der
     * Schicht. Sie hier zu wiederholen hiesse, denselben Wert an zwei Stellen
     * zu pflegen — und die Zuordnung waere die, die falsch liegt, wenn die
     * Schicht verschoben wird.
     *
     * `qualifikation_snapshot` bleibt ebenfalls weg: `stempel_einsatz_qualifikation`
     * legt den Beweis ab, den `erzwinge_einsatz_qualifikation` unmittelbar
     * danach prueft.
     */
    `insert into einsatz_zuordnung
       (mandant_id, einsatz_id, anstellung_id, person_id, funktion, status,
        erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'geplant', 'mensch', $6::uuid)
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.einsatzId, eingabe.anstellungId, personId,
      eingabe.funktion ?? null, kontext.benutzerId,
    ],
  );

  /**
   * Und JETZT schreiben, was gefunden wurde — mit der Einteilung in der Welt.
   *
   * `erkenneKonflikte` liest die Zuordnungen des Fensters neu, schreibt die
   * Verstoesse ueber `app.arbzg_befund_schreiben` (K-06) und legt die
   * Konfliktzeilen an, die im Eingang mit Begruendung quittiert werden. Der
   * Rueckweg ueber den Detektor statt ueber einen zweiten Schreibpfad ist
   * Absicht: die Entdoppelung je Person UND Tag, die Anker-Regel und das
   * Aufraeumen hinfaelliger Zeilen stehen dort und nur dort.
   */
  const stunde = 3_600_000;
  await erkenneKonflikte(
    db, kontext.aktiverMandantId,
    new Date(beginn.getTime() - 24 * stunde),
    new Date(ende.getTime() + 24 * stunde),
  );

  return {
    zuordnungId: neu!.id,
    personId,
    qualifikation,
    arbzg: vorher.befunde,
    ueberGesellschaften: vorher.ueberGesellschaften,
  };
}

export class ZuordnungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Einteilung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'ZuordnungNichtGefunden';
  }
}

export class GrundFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor() {
    super('Eine Absage ohne Grund ist kein Vorgang, sondern ein Klick.');
    this.name = 'GrundFehlt';
  }
}

/** So kurz darf ein Grund sein: „Krank" ist eine Begruendung. */
const GRUND_MINDESTLAENGE = 3;

/**
 * Sagt eine Einteilung ab — die Zeile BLEIBT (R-08, Invariante 8).
 *
 * Eine geloeschte Einteilung ist eine, ueber die niemand mehr streiten kann:
 * wer war eingeteilt, wer hat abgesagt, und wann. Der Ausloeser
 * `checkin_token_widerrufen` zieht die ausgegebenen Marken zurueck, sobald
 * `entfernt_am` steht — deshalb setzt dieser Weg beides: den Status mit dem
 * Grund und die Entfernung, die die Marke verbrennt.
 */
export async function sageZuordnungAb(
  kontext: SchreibKontext, zuordnungId: string, grund: string,
): Promise<void> {
  if (grund.trim().length < GRUND_MINDESTLAENGE) throw new GrundFehlt();

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update einsatz_zuordnung
        set status = 'abgesagt', abgesagt_am = now(), absage_grund = $2,
            entfernt_am = now(), entfernt_von = $3::uuid
      where id = $1::uuid and entfernt_am is null
      returning id`,
    [zuordnungId, grund.trim(), kontext.benutzerId],
  );
  if (zeilen.length === 0) throw new ZuordnungNichtGefunden(zuordnungId);
}
