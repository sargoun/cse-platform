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
import { erkenneKonflikte, ueberschneidungsFingerabdruck } from '../arbzg/detektor.js';
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

/** Eine andere Einteilung derselben Person, die im selben Zeitfenster liegt. */
export interface Ueberschneidung {
  readonly zuordnungId: string;
  readonly einsatzId: string;
  /** Schon fuer die Anzeige gesetzt — Europe/Berlin, wie ueberall (Invariante 2). */
  readonly text: string;
}

/**
 * Dieselbe Person steht im selben Zeitfenster schon auf einer anderen Schicht.
 *
 * **Das erkannte vorher NICHTS.** Die einzige Doppelbesetzungspruefung dieses
 * Dienstes fragte nach derselben Person auf DERSELBEN Schicht, und die
 * Datenbank haelt dazu passend nur `ez_einsatz_anstellung_uk` — beides trifft
 * genau den Fall, den niemand baut. Zwei ueberlappende Schichten auf zwei
 * Objekten gingen ohne Sperre und ohne Befund durch: `konflikt_art` kennt
 * `ueberschneidung`, `planungs_konflikt.gegen_zuordnung_id` ist fuer die
 * Gegenseite da, der Eingang und der Plan haben den Beschriftungszweig — es
 * gab nur keinen Schreiber. Die ArbZG-Pruefung faengt das nicht auf: zwei
 * ueberlappende Vierstundenschichten ergeben acht Stunden und damit keinen
 * Befund. Aufgefallen waere es am Einsatztag um 06:00, vor dem zweiten
 * Objekt, an dem niemand steht.
 *
 * WARNUNG und nicht Sperre — und das ist die dokumentierte Vorgabe, keine
 * Bequemlichkeit: `planungs_konflikt.blockiert` wird als `false` ausgeliefert,
 * solange O-166 offen ist, und ein blockierender Befund ist durch kein Recht
 * uebersteuerbar (0040 §6.5). Der Planer sieht die Gegenschicht und muss sie
 * mit `bestaetigt` uebergehen; uebergangen heisst auch hier nicht
 * verschwunden, sondern eine Konfliktzeile im Eingang.
 * // TODO(client, O-166): Soll eine Ueberschneidung das Speichern VERHINDERN
 * (blockiert = true) oder wie heute nur warnen?
 */
export class UeberschneidungWarnungOffen extends Error {
  readonly code = 'ueberschneidung';
  readonly status = 422;
  readonly ueberschneidungen: readonly Ueberschneidung[];
  constructor(ueberschneidungen: readonly Ueberschneidung[]) {
    super(
      'Diese Beschäftigung steht im selben Zeitraum bereits auf '
      + `${String(ueberschneidungen.length)} anderen Schicht(en): `
      + `${ueberschneidungen.map((u) => u.text).join('; ')}. `
      + 'Die Einteilung wird erst nach ausdrücklicher Bestätigung geschrieben.',
    );
    this.name = 'UeberschneidungWarnungOffen';
    this.ueberschneidungen = ueberschneidungen;
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
  /** Die uebergangenen Doppelbesetzungen — leer heisst: es gab keine. */
  readonly ueberschneidungen: readonly Ueberschneidung[];
}

interface SchichtZeile {
  readonly id: string;
  readonly beginn_zeitpunkt: string;
  readonly ende_zeitpunkt: string;
  readonly storniert: boolean;
  /** `0` heisst im Plan „nicht hinterlegt", nicht „keine Pause" (O-168). */
  readonly pause_geplant_minuten: number;
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
  /**
   * Andere Schichten derselben Person im selben Zeitfenster — im EIGENEN
   * Mandanten. Eine Schicht in einer Schwestergesellschaft bleibt hier
   * ungenannt (K-06); sie erreicht den Planer ueber `ueberGesellschaften`.
   */
  readonly ueberschneidungen: readonly Ueberschneidung[];
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

/**
 * Steht diese Person im Fenster dieser Schicht schon woanders?
 *
 * Gefragt wird nach der PERSON und nicht nach der Beschaeftigung: ein Mensch
 * kann in derselben Gesellschaft zwei Anstellungen haben, und in zwei
 * Objekten gleichzeitig kann er trotzdem nicht stehen (D-09, Invariante 9).
 *
 * Die Schicht selbst bleibt aussen vor — sie ist beim Schreiben noch nicht in
 * der Tabelle, und bei der Vorschau waere sie es nur, wenn schon jemand
 * anderes auf ihr steht.
 *
 * Halboffenes Intervall: eine Schicht, die um 14:00 endet, und eine, die um
 * 14:00 beginnt, ueberschneiden sich NICHT. Die Ruhezeit dazwischen ist eine
 * andere Frage und gehoert der ArbZG-Pruefung.
 */
async function ueberschneidungenFinden(
  kontext: SchreibKontext, personId: string, einsatzId: string,
  beginn: Date, ende: Date,
): Promise<readonly Ueberschneidung[]> {
  const zeilen = await kontext.abfrage<{
    zuordnung_id: string; einsatz_id: string; text: string;
  }>(
    `select z.id as zuordnung_id, e.id as einsatz_id,
            coalesce(o.bezeichnung, 'ohne Objekt') || ' '
            || to_char(e.beginn_zeitpunkt at time zone 'Europe/Berlin',
                       'DD.MM.YYYY HH24:MI')
            || '–'
            || to_char(e.ende_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI')
              as text
       from einsatz_zuordnung z
       join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
       left join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id
      where z.person_id = $1::uuid
        and z.entfernt_am is null
        and z.status not in ('abgesagt','ersetzt')
        and e.storniert_am is null
        and e.id <> $2::uuid
        -- Halboffen, siehe oben: Ende > Beginn UND Beginn < Ende.
        and e.ende_zeitpunkt   > $3::timestamptz
        and e.beginn_zeitpunkt < $4::timestamptz
      order by e.beginn_zeitpunkt`,
    [personId, einsatzId, beginn.toISOString(), ende.toISOString()],
  );
  return zeilen.map((z) => ({
    zuordnungId: z.zuordnung_id, einsatzId: z.einsatz_id, text: z.text,
  }));
}

/**
 * Die Konfliktzeile zur uebergangenen Doppelbesetzung — EINE je Einteilung.
 *
 * Der Abdruck haengt an der neuen Zuordnung (`ueberschneidungsFingerabdruck`),
 * nicht am Tag: wer zweimal doppelt eingeteilt wird, bekommt zwei Karten, und
 * wer dieselbe Einteilung zweimal speichert, nur eine. Die Gegenseite steht in
 * `gegen_zuordnung_id`; liegt sie in einer fremden Gesellschaft, bliebe sie
 * ungenannt (§6.3) — dieser Weg sieht ohnehin nur den eigenen Mandanten.
 *
 * `blockiert` bleibt `false`, weil es der ausgelieferte Vorgabewert ist,
 * solange O-166 offen ist; die Zeile ist der Nachweis, nicht die Bremse.
 */
async function schreibeUeberschneidungsKonflikt(
  kontext: SchreibKontext, eingabe: {
    readonly personId: string; readonly anstellungId: string;
    readonly einsatzId: string; readonly zuordnungId: string;
    readonly beginn: Date; readonly ende: Date;
    readonly ueberschneidungen: readonly Ueberschneidung[];
  },
): Promise<void> {
  const erste = eingabe.ueberschneidungen[0];
  if (erste === undefined) return;

  await kontext.schreibe(
    `insert into planungs_konflikt (
       mandant_id, art, person_id, anstellung_id, einsatz_id,
       einsatz_zuordnung_id, gegen_zuordnung_id,
       zeitraum_beginn, zeitraum_ende, schwere, blockiert,
       details, fingerprint, erkannt_durch, erstellt_von_art, erstellt_von
     ) values (
       $1::uuid, 'ueberschneidung', $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, $6::uuid,
       $7::timestamptz, $8::timestamptz, 'warnung', false,
       $9::jsonb, $10, 'planung_live', 'mensch', $11::uuid
     )
     on conflict (mandant_id, fingerprint) where hinfaellig_am is null
     do update set zeitraum_beginn    = excluded.zeitraum_beginn,
                   zeitraum_ende      = excluded.zeitraum_ende,
                   gegen_zuordnung_id = excluded.gegen_zuordnung_id,
                   details            = excluded.details`,
    [
      kontext.aktiverMandantId, eingabe.personId, eingabe.anstellungId,
      eingabe.einsatzId, eingabe.zuordnungId, erste.zuordnungId,
      eingabe.beginn.toISOString(), eingabe.ende.toISOString(),
      // Das OBJEKT, nicht sein JSON-Text: der Treiber serialisiert selbst,
      // und zweimal kodiert stuende in details eine JSON-Zeichenkette, aus
      // der kein ->> mehr etwas herausholt (siehe detektor.ts).
      { gegenschichten: eingabe.ueberschneidungen.map((u) => u.text) },
      ueberschneidungsFingerabdruck(
        kontext.aktiverMandantId, eingabe.personId, eingabe.zuordnungId),
      kontext.benutzerId,
    ],
  );
}

/**
 * Die geplante Pause — oder `null`, wenn keine hinterlegt ist.
 *
 * `einsatz.pause_geplant_minuten` hat den Vorgabewert `0`, und `0` bedeutet
 * dort „niemand hat eine Pause geplant". Als Zahl an die Arbeitszeitrechnung
 * gegeben hiesse es „null Minuten Pause" — und damit truege jede Schicht ueber
 * sechs Stunden einen § 4-Befund, den kein Feld aufloesen kann, solange O-168
 * offen ist.
 */
function geplantePause(schicht: SchichtZeile): number | null {
  const wert = Number(schicht.pause_geplant_minuten);
  return Number.isFinite(wert) && wert > 0 ? wert : null;
}

async function ladeSchicht(kontext: SchreibKontext, id: string): Promise<SchichtZeile> {
  const [e] = await kontext.abfrage<SchichtZeile>(
    `select id, beginn_zeitpunkt, ende_zeitpunkt, pause_geplant_minuten,
            (storniert_am is not null) as storniert
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
  const ueberschneidungen = await ueberschneidungenFinden(
    kontext, personId, einsatzId, beginn, ende);

  try {
    const ergebnis = await pruefeEinsatz(db, personId, beginn, ende, {
      schreiben: false,
      // Die Schicht, um die es geht, ist noch nicht gespeichert — ohne sie
      // rechnete die Vorschau ohne den Anlass.
      zusatzSchicht: { beginn, ende, pauseMinuten: geplantePause(schicht) },
    });
    return {
      qualifikation,
      qualifikationsfehler,
      arbzg: ergebnis.befunde,
      ueberGesellschaften: ergebnis.ueberGesellschaften,
      abwesend: abmeldung.text,
      abwesenheitGeprueft: abmeldung.geprueft,
      ueberschneidungen,
    };
  } catch (fehler) {
    if (!istRechteFehler(fehler)) throw fehler;
    // `null` heisst UNGEPRUEFT und wird in der Anzeige auch so benannt —
    // nicht als leere Liste, die wie „nichts gefunden" aussaehe.
    return {
      qualifikation, qualifikationsfehler, arbzg: null, ueberGesellschaften: false,
      abwesend: abmeldung.text, abwesenheitGeprueft: abmeldung.geprueft,
      ueberschneidungen,
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

  /**
   * Und die zweite billige Frage: steht dieser Mensch zu dieser Stunde schon
   * woanders? Sie kostet ebenfalls eine mandantenlokale Abfrage und kommt
   * deshalb vor dem Uebertritt ueber die Mandantengrenze.
   */
  const ueberschneidungen = await ueberschneidungenFinden(
    kontext, personId, eingabe.einsatzId, beginn, ende);
  if (ueberschneidungen.length > 0 && eingabe.bestaetigt !== true) {
    throw new UeberschneidungWarnungOffen(ueberschneidungen);
  }

  let vorher;
  try {
    vorher = await pruefeEinsatz(db, personId, beginn, ende, {
      schreiben: false,
      zusatzSchicht: { beginn, ende, pauseMinuten: geplantePause(schicht) },
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

  /**
   * Die uebergangene Doppelbesetzung bekommt ihre Karte — nach dem Detektor,
   * damit sie nicht in denselben Lauf geraet: `raeumeAuf` holt sich nur
   * `art = 'arbzg'`, aber die Reihenfolge soll auch dann stimmen, wenn dort
   * einmal eine Art dazukommt.
   */
  await schreibeUeberschneidungsKonflikt(kontext, {
    personId, anstellungId: eingabe.anstellungId, einsatzId: eingabe.einsatzId,
    zuordnungId: neu!.id, beginn, ende, ueberschneidungen,
  });

  return {
    zuordnungId: neu!.id,
    personId,
    qualifikation,
    arbzg: vorher.befunde,
    ueberGesellschaften: vorher.ueberGesellschaften,
    ueberschneidungen,
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
