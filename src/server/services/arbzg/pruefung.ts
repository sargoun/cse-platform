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
  /**
   * Gesetzt heisst: der Aufrufer ist der NACHTLAUF, nicht das Portal.
   *
   * **Ohne diesen Weg lief der Nachtlauf ueberhaupt nicht.**
   * `app.arbzg_belastung` ist ausschliesslich `cse_app` gewaehrt (0040:1183)
   * und verlangt aktive Sitzung, Mandant und `dienstplan.arbzg_pruefen`. Der
   * Job verbindet sich als `cse_job` — er lief also bei jedem Aufruf in
   * `42501`, BEVOR ein einziger Befund entstehen konnte. Ein
   * Arbeitszeitwaechter, der jede Nacht abgewiesen wird und niemandem etwas
   * meldet, ist genau die Sorte Stille, gegen die dieses Projekt geschrieben
   * ist.
   *
   * Der Leser fuer diesen Fall gibt es seit 0040:1219 —
   * `zeit_intern.arbzg_belastung_job`, `cse_job` gewaehrt — und NIEMAND rief
   * ihn auf. Er liefert statt `fremd` die rohe `mandant_id`: ein Job hat
   * keinen aktiven Mandanten, gegen den sich „fremd" bestimmen liesse, also
   * entscheidet es der Aufrufer. Genau dafuer steht der Mandant hier.
   */
  jobMandantId?: string,
): Promise<readonly Belastungsfenster[]> {
  /**
   * **Beide Leser liefern `fremd`, und beide lassen die DATENBANK vergleichen.**
   *
   * Der Job-Leser gibt `mandant_id uuid` heraus; die erste Fassung las sie als
   * `::text` zurueck und verglich in TypeScript mit `!==`. Das ist ein
   * Zeichenkettenvergleich auf einer UUID: eine Schreibweise in Grossbuchstaben
   * oder mit Bindestrichen an anderer Stelle — und JEDES Fenster gilt als
   * fremd. Der Nachtlauf meldete dann eine Gesellschaftsgrenze, wo keine war,
   * still und in jeder Zeile. `mandant_id <> $4::uuid` vergleicht dagegen uuid
   * gegen uuid; ein unbrauchbarer Wert hebt sofort `22P02`, statt das Ergebnis
   * lautlos zu verdrehen. Nebenbei faellt damit auch der zweite Schluessel im
   * Rueckleseobjekt weg — genau die Stelle, an der sich Camel- und
   * Unterstrich-Schreibweise sonst unbemerkt verfehlen.
   */
  const zeilen = (await db.unsafe(
    jobMandantId === undefined
      ? `select fenster_gruppe, beginn_utc, ende_utc, minuten, fremd
           from app.arbzg_belastung($1, $2::timestamptz, $3::timestamptz)`
      : `select fenster_gruppe, beginn_utc, ende_utc, minuten,
                (mandant_id <> $4::uuid) as fremd
           from zeit_intern.arbzg_belastung_job($1, $2::timestamptz, $3::timestamptz)`,
    jobMandantId === undefined
      ? [personId, vonUtc.toISOString(), bisUtc.toISOString()]
      : [personId, vonUtc.toISOString(), bisUtc.toISOString(), jobMandantId],
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
  optionen: {
    readonly zehnStundenAusnahme?: boolean;
    readonly schreiben?: boolean;
    /** Gesetzt nur im Nachtlauf — siehe `leseBelastung`. */
    readonly jobMandantId?: string;
    /**
     * Eine Schicht, die es NOCH NICHT gibt — die, die gerade eingeteilt werden
     * soll.
     *
     * Ohne sie beantwortet diese Funktion eine andere Frage als die gestellte.
     * `app.arbzg_belastung` liest gespeicherte Fenster; eine Einteilung, die
     * noch nicht geschrieben ist, hat keines. Die Pruefung VOR dem Speichern
     * (PR 33 Abnahme 3) saehe also genau die eine Schicht nicht, wegen der sie
     * laeuft — sechs Stunden am Vormittag plus fuenf am Abend blieben sechs,
     * und der Planer bekaeme grünes Licht fuer elf.
     *
     * Sie geht als „eigen" in die Rechnung: sie entsteht im aktiven Mandanten.
     */
    readonly zusatzSchicht?: {
      readonly beginn: Date;
      readonly ende: Date;
      /**
       * Die GEPLANTE Pause dieser Schicht, oder `null` — „nicht hinterlegt".
       *
       * `0` waere hier eine Behauptung: „null Minuten Pause". Ein Plan, der
       * keine Pause nennt, sagt nichts ueber die Pause; was die Gruppe
       * vereinbart hat, ist offen (O-168). Siehe die Begruendung an
       * `pauseMinuten: null` weiter unten — sie gilt fuer die geplante Schicht
       * genauso wie fuer die gespeicherten Fenster.
       */
      readonly pauseMinuten?: number | null;
    };
    /** Die eigene Gesellschaft — nur zum SCHREIBEN nötig, nie zum Rechnen. */
    readonly mandantId?: string;
  } = {},
): Promise<Pruefergebnis> {
  if (ende.getTime() <= beginn.getTime()) {
    throw new ArbzgFehler('Das Pruefintervall endet vor seinem Anfang.');
  }
  const von = new Date(beginn.getTime() - VORLAUF_STUNDEN * 3_600_000);
  const bis = new Date(ende.getTime() + NACHLAUF_STUNDEN * 3_600_000);

  const fenster = await leseBelastung(
    db, personId, von, bis, optionen.jobMandantId);

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
    /**
     * **`null` und nicht `0`** — der Leser kennt keine Pause.
     *
     * `app.arbzg_belastung` gibt Dauern und Grenzen zurueck, nie eine
     * Pausenangabe (K-06), und der PLAN hat ohnehin keine (O-168). Mit `0`
     * hiess das fuer die Regelrechnung „null Minuten Pause erfasst" — und
     * jede Schicht ueber sechs Stunden trug einen § 4-Befund, der sich nicht
     * aufloesen liess: es gibt kein Feld, in das eine geplante Pause
     * gehoerte. Eine Warnung, die auf jeder Nachtschicht steht, bringt der
     * Planung bei, Warnungen wegzuklicken — teurer als gar keine.
     */
    pauseMinuten: null,
  }));

  /**
   * Die geplante, noch nicht geschriebene Schicht kommt dazu — und nur zur
   * RECHNUNG. Sie wandert nicht in `fenster`, denn `fenster` ist, was die
   * Datenbank gespeichert hat, und `schreibeBefund` misst seinen Zeitraum
   * daran.
   */
  const zusatz = optionen.zusatzSchicht;
  if (zusatz !== undefined) {
    schichten.push({
      id: 'geplant:neu',
      personId,
      mandantId: 'eigen',
      vonUtc: zusatz.beginn,
      bisUtc: zusatz.ende,
      /**
       * `null` heisst „unbekannt", und unbekannt ist der Normalfall.
       *
       * Mit `0` trug JEDE geplante Schicht ueber sechs Stunden einen
       * § 4-Befund — beim allerersten Einteilen, vor jeder erfassten Minute.
       * Die Planung haette gelernt, die Warnung wegzuklicken, und mit ihr die
       * echten.
       */
      pauseMinuten: zusatz.pauseMinuten ?? null,
    });
  }

  const befunde = schichten.length === 0
    ? []
    : pruefeArbzg(schichten, { zehnStundenAusnahme: optionen.zehnStundenAusnahme ?? false });

  if (optionen.schreiben === true) {
    for (const b of befunde) {
      await schreibeBefund(db, personId, b, fenster, optionen.mandantId ?? null);
    }
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
/**
 * Die Ursache eines Befunds: die FENSTER, die zu ihm beigetragen haben.
 *
 * `zeit_intern.ursache_fuer_mandant` erwartet ein Feld solcher Fenster und
 * reduziert jedes, das nicht dem lesenden Mandanten gehoert, auf Dauer und
 * Grenzen (§5.11) — es entscheidet an `mandant_id`. Deshalb traegt hier
 * genau das EIGENE Fenster seine Gesellschaft, und das fremde traegt keine:
 * dieser Dienst kennt sie nicht (K-06), und ein geratener Wert waere
 * schlimmer als keiner.
 *
 * Kalendertag und Begruendung stehen NICHT hier. Sie gehoeren in die
 * Konfliktkarte (`planungs_konflikt.details`); die Aufzeichnung traegt Regel,
 * Istwert und Grenzwert in eigenen Spalten.
 */
function ursacheAusFenstern(
  fenster: readonly Belastungsfenster[], mandantId: string | null,
): readonly Record<string, unknown>[] {
  return fenster.map((f) => ({
    ...(f.fremd || mandantId === null ? {} : { mandant_id: mandantId }),
    fenster_gruppe: f.fensterGruppe,
    beginn: f.beginn.toISOString(),
    ende: f.ende === null ? null : f.ende.toISOString(),
    minuten: f.minuten,
  }));
}

export async function schreibeBefund(
  db: Abfrage, personId: string, befund: ArbzgBefund,
  fenster: readonly Belastungsfenster[],
  mandantId: string | null,
): Promise<string | null> {
  const grenzwert = GRENZWERTE[befund.regel];
  /**
   * **Die Liste der Gesellschaften, oder `null`.**
   *
   * Ein Befund, der NUR im eigenen Haus entstand, nennt sein Haus — sonst
   * erfuehre eine unbeteiligte Gesellschaft, dass diese Person anderswo zu
   * lange gearbeitet hat. Ein Befund UEBER Gesellschaften hinweg uebergibt
   * `null`, weil dieser Dienst die fremde Seite gar nicht kennen darf (K-06):
   * die Definer-Funktion leitet sie dann aus den Beschaeftigungen ab (0064).
   *
   * Vorher stand hier in beiden Faellen `null` — und `foreach … in array null`
   * laeuft null Mal: `schreiben: true` schrieb nichts, ohne Fehler.
   */
  const mandanten = befund.ueberMandanten || mandantId === null ? null : [mandantId];
  const zeilen = (await db.unsafe(
    `select app.arbzg_befund_schreiben($1, $2::arbzg_regel, $3::verstoss_schwere,
                                       $4::timestamptz, $5::timestamptz,
                                       $6::integer, $7::integer, $8::jsonb,
                                       $9::uuid[]) as id`,
    [
      personId, befund.regel, befund.schwere,
      fensterAnfang(fenster).toISOString(), fensterEnde(fenster).toISOString(),
      befund.minuten, grenzwert,
      /**
       * Als FELD, nicht als Zeichenkette: der Treiber kodiert selbst, und eine
       * schon kodierte Zeichenkette landete als jsonb-SKALAR — worauf
       * `zeit_intern.ursache_fuer_mandant` mit „cannot extract elements from a
       * scalar" abbricht. Derselbe Fehler wie beim MiLoG-Artefakt in PR 36.
       */
      ursacheAusFenstern(fenster, mandantId),
      mandanten,
    ],
  )) as { id: string }[];

  /**
   * Zurueck kommt je geschriebener Gesellschaft eine Kennung — auch die der
   * fremden. Gesucht ist die EIGENE, und deshalb steht der Mandant im
   * Praedikat und nicht bloss in der RLS.
   *
   * **Die RLS allein trug es nicht.** Sie verengt auf den aktiven Mandanten,
   * wenn `cse_app` fragt — der NACHTLAUF fragt aber als `cse_job`, und dessen
   * Policy ist `t_job … using (true)` (0040:1530): er sieht beide Zeilen.
   * `limit 1` ohne Ordnung und ohne Mandant gab dann bei jedem
   * gesellschaftsuebergreifenden Befund mit etwa gleicher Wahrscheinlichkeit
   * die FREMDE Kennung zurueck — und der darauf folgende Einschub in
   * `planungs_konflikt` lief in `pk_verstoss_fk`
   * (`(mandant_id, arbeitszeit_verstoss_id)`), also in eine
   * Fremdschluesselverletzung, die den ganzen Nachtlauf dieses Mandanten
   * abbrach. Ausgerechnet im K-06-Fall, fuer den der Lauf da ist; und keine
   * Pruefung sah es, weil alle als `cse_app` laufen, wo die RLS den Fehler
   * zudeckt.
   */
  const ids = zeilen.map((z) => z.id);
  if (ids.length === 0) return null;
  const sichtbar = (await db.unsafe(
    `select id from arbeitszeit_verstoss
      where id = any($1::uuid[])
        and ($2::uuid is null or mandant_id = $2::uuid)
      limit 1`,
    [ids, mandantId],
  )) as { id: string }[];
  return sichtbar[0]?.id ?? null;
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

/**
 * Anfang und Ende der beteiligten Fenster.
 *
 * Beide WERFEN auf einer leeren Liste, statt auf „jetzt" auszuweichen. Ein
 * Befund ohne Fenster kann es nicht geben — er entsteht ja aus ihnen —, und
 * die Uhr dieses Prozesses als Ersatzwert einzusetzen hiesse, einem Verstoss
 * einen Zeitraum anzudichten, den niemand gemessen hat (Invariante 5).
 */
function fensterAnfang(fenster: readonly Belastungsfenster[]): Date {
  const erstes = fenster[0];
  if (erstes === undefined) {
    throw new ArbzgFehler('Ein Befund ohne beteiligte Fenster kann nicht geschrieben werden.');
  }
  return fenster.reduce((a, f) => (f.beginn < a ? f.beginn : a), erstes.beginn);
}

function fensterEnde(fenster: readonly Belastungsfenster[]): Date {
  const erstes = fenster[0];
  if (erstes === undefined) {
    throw new ArbzgFehler('Ein Befund ohne beteiligte Fenster kann nicht geschrieben werden.');
  }
  const schluss = (f: Belastungsfenster): Date =>
    f.ende ?? new Date(f.beginn.getTime() + f.minuten * 60_000);
  return fenster.reduce((a, f) => (schluss(f) > a ? schluss(f) : a), schluss(erstes));
}
