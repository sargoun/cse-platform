/**
 * `pruefeEinsatz` — die Arbeitszeitpruefung ueber Gesellschaftsgrenzen hinweg
 * (TIM-05, TIM-06, TIM-14, LEG-03, D-09, K-06).
 *
 * ## Warum diese Datei ueberhaupt existiert
 *
 * Die naheliegende Abfrage ist die gefaehrliche. Unter RLS liefert
 * `select … from einsatz where person_id = X` nur die Schichten des aktiven
 * Mandanten: der Detektor findet sechs Stunden, schliesst „kein Verstoss" und
 * die Plattform liefert eine gesetzlich verlangte Pruefung aus, **die immer
 * besteht**. Niemand merkt es, weil eine Pruefung, die nichts findet, genau
 * so aussieht wie ein sauberer Plan.
 *
 * Darum genau EIN gesicherter Uebertritt: `app.arbzg_belastung`. Sie ist
 * `SECURITY DEFINER`, prueft selbst, ob der Aufrufer die Person im aktiven
 * Mandanten ueberhaupt kennt, schreibt jeden Aufruf ins `audit_log` — und
 * liefert **Dauern und Intervallgrenzen und sonst nichts**. Der Planer erfaehrt,
 * DASS die Person anderweitig gebunden ist, nie wo und fuer wen.
 *
 * ## Was hier NICHT gerechnet wird
 *
 * Die Regeln selbst stehen in `services/zeit/arbzg.ts` und sind ohne
 * Datenbank pruefbar. Diese Datei besorgt die Fenster, uebergibt sie und
 * schreibt die Befunde zurueck. Eine zweite Auslegung von § 3 ArbZG hier
 * waere genau die Doppelung, die K-11 fuer die Zeitrechnung verhindert.
 */
import { pruefeArbzg, type ArbzgBefund, type Schicht } from '../zeit/arbzg.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Ein Fenster, wie `app.arbzg_belastung` es liefert — ohne jede Kennung. */
export interface Belastungsfenster {
  /** Undurchsichtiger Hash, nur zum Entdoppeln. Kein Rueckschluss moeglich. */
  readonly fensterGruppe: string;
  readonly beginn: Date;
  readonly ende: Date | null;
  readonly minuten: number;
  /** Gehoert das Fenster einer ANDEREN Gesellschaft? */
  readonly fremd: boolean;
}

export interface Pruefergebnis {
  readonly personId: string;
  readonly fenster: readonly Belastungsfenster[];
  readonly befunde: readonly ArbzgBefund[];
  /** Hat mindestens ein fremdes Fenster beigetragen? Dann ist es der K-06-Fall. */
  readonly ueberGesellschaften: boolean;
}

export class ArbzgFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ArbzgFehler';
  }
}

/**
 * Das Fenster, das gelesen wird — und warum es nicht der Tag ist.
 *
 * § 5 ArbZG misst die Ruhezeit **zwischen** zwei Schichten, also muss der
 * Abend davor und der Morgen danach mit hinein. Ein Tagesfenster faende die
 * Unterschreitung nie: die Schicht, die um 23:00 endet, und die, die um 07:00
 * beginnt, liegen an zwei Kalendertagen. Eine Pruefung, die den einen Fall
 * nicht sehen kann, den sie pruefen soll, ist schlimmer als keine.
 */
const VORLAUF_STUNDEN = 24;
const NACHLAUF_STUNDEN = 24;

/**
 * Liest die Belastung einer Person im Fenster — ueber alle Gesellschaften.
 *
 * Wirft, wenn der Aufrufer nicht berechtigt ist: die Funktion in der
 * Datenbank hebt `42501`, und das wird hier NICHT zu einem leeren Ergebnis
 * geglaettet. Eine abgewiesene Pruefung, die wie „kein Verstoss" aussieht,
 * ist der Fehler, gegen den diese ganze Datei geschrieben ist.
 */
export async function leseBelastung(
  db: Abfrage, personId: string, vonUtc: Date, bisUtc: Date,
): Promise<readonly Belastungsfenster[]> {
  const zeilen = (await db.unsafe(
    `select fenster_gruppe, beginn_utc, ende_utc, minuten, fremd
       from app.arbzg_belastung($1, $2::timestamptz, $3::timestamptz)`,
    [personId, vonUtc.toISOString(), bisUtc.toISOString()],
  )) as Record<string, unknown>[];

  return zeilen.map((z) => ({
    fensterGruppe: z['fenster_gruppe'] as string,
    beginn: new Date(z['beginn_utc'] as string),
    ende: z['ende_utc'] === null ? null : new Date(z['ende_utc'] as string),
    minuten: Number(z['minuten']),
    fremd: z['fremd'] === true,
  }));
}

/**
 * Prueft eine Person rund um ein Zeitfenster und gibt die Befunde zurueck.
 *
 * `schreiben = false` ist die Vorgabe: der Planer soll den Befund SEHEN,
 * bevor er speichert (PR 33 Abnahme 3). Erst der Speicherpfad schreibt ihn
 * fest — sonst stuende in `arbeitszeit_verstoss` jeder Entwurf, den jemand
 * beim Ausprobieren erzeugt hat, und die Liste waere unbrauchbar.
 */
export async function pruefeEinsatz(
  db: Abfrage,
  personId: string,
  beginn: Date,
  ende: Date,
  optionen: { readonly zehnStundenAusnahme?: boolean; readonly schreiben?: boolean } = {},
): Promise<Pruefergebnis> {
  if (ende.getTime() <= beginn.getTime()) {
    throw new ArbzgFehler('Das Pruefintervall endet vor seinem Anfang.');
  }
  const von = new Date(beginn.getTime() - VORLAUF_STUNDEN * 3_600_000);
  const bis = new Date(ende.getTime() + NACHLAUF_STUNDEN * 3_600_000);

  const fenster = await leseBelastung(db, personId, von, bis);

  /**
   * Ein noch offenes Fenster (`ende_utc is null`) ist jemand, der eingestempelt
   * und nicht ausgestempelt hat. Es wird mit seinem Beginn plus der
   * bisherigen Dauer geschlossen — nicht weggelassen. Weglassen waere die
   * eine Richtung, die nie passieren darf: sie erzeugt einen sauberen
   * Durchlauf fuer den Fall, in dem gerade jemand zu lange arbeitet.
   */
  const schichten: Schicht[] = fenster.map((f, i) => ({
    id: `${f.fensterGruppe}:${String(i)}`,
    personId,
    // Der Mandant ist aus dem Leser bewusst nicht zu erfahren (K-06). Fuer die
    // Regelrechnung genuegt „eigen" gegen „fremd" — und mehr darf hier auch
    // nicht ankommen.
    mandantId: f.fremd ? 'fremd' : 'eigen',
    vonUtc: f.beginn,
    bisUtc: f.ende ?? new Date(f.beginn.getTime() + f.minuten * 60_000),
    pauseMinuten: 0,
  }));

  const befunde = schichten.length === 0
    ? []
    : pruefeArbzg(schichten, { zehnStundenAusnahme: optionen.zehnStundenAusnahme ?? false });

  if (optionen.schreiben === true) {
    for (const b of befunde) await schreibeBefund(db, personId, b, fenster);
  }

  return {
    personId,
    fenster,
    befunde,
    ueberGesellschaften: fenster.some((f) => f.fremd),
  };
}

/**
 * Schreibt einen Befund — ueber `app.arbzg_befund_schreiben` und **nur** so.
 *
 * `arbeitszeit_verstoss` hat keine INSERT-Policy fuer `cse_app` (K-06): ein
 * Verstoss ueber zwei Gesellschaften muss in beiden stehen, und eine auf
 * Mandant A verengte Anfrage kann in B nichts schreiben. Die Definer-Funktion
 * prueft vorher, dass der Aufrufer fuer die Person im aktiven Mandanten
 * zustaendig war.
 *
 * Ein Urteil, das sich nicht auf einen der sechs `arbzg_regel`-Werte abbilden
 * laesst, ist damit gar nicht speicherbar — und das ist Absicht, keine
 * Einschraenkung: eine frei benannte Regel waere eine, die niemand
 * wiederfindet.
 */
async function schreibeBefund(
  db: Abfrage, personId: string, befund: ArbzgBefund,
  fenster: readonly Belastungsfenster[],
): Promise<void> {
  const grenzwert = GRENZWERTE[befund.regel];
  await db.unsafe(
    `select app.arbzg_befund_schreiben($1, $2::arbzg_regel, $3::verstoss_schwere,
                                       $4::timestamptz, $5::timestamptz,
                                       $6::integer, $7::integer, $8::jsonb, null)`,
    [
      personId, befund.regel, befund.schwere,
      fensterAnfang(fenster).toISOString(), fensterEnde(fenster).toISOString(),
      befund.minuten, grenzwert,
      JSON.stringify({
        kalendertag: befund.kalendertag,
        begruendung: befund.begruendung,
        ueber_mandanten: befund.ueberMandanten,
      }),
    ],
  );
}

/** Die Grenze, gegen die gemessen wurde — sie gehoert in den Befund. */
const GRENZWERTE: Readonly<Record<ArbzgBefund['regel'], number>> = {
  tagesarbeitszeit_ueber_8h: 8 * 60,
  tagesarbeitszeit_ueber_10h: 10 * 60,
  ruhezeit_unter_11h: 11 * 60,
  pause_fehlt_ueber_6h: 30,
  pause_fehlt_ueber_9h: 45,
  ausgleichszeitraum_ueberschritten: 8 * 60,
};

function fensterAnfang(fenster: readonly Belastungsfenster[]): Date {
  return fenster.reduce(
    (a, f) => (f.beginn < a ? f.beginn : a), fenster[0]?.beginn ?? new Date(),
  );
}

function fensterEnde(fenster: readonly Belastungsfenster[]): Date {
  return fenster.reduce((a, f) => {
    const e = f.ende ?? new Date(f.beginn.getTime() + f.minuten * 60_000);
    return e > a ? e : a;
  }, fenster[0]?.ende ?? fenster[0]?.beginn ?? new Date());
}
