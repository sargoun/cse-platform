/**
 * Der tokenisierte Check-in (TIM-07, TIM-08, K-08, K-09).
 *
 * Der Dienst ist duenn, und das ist Absicht: die Entscheidung faellt in
 * **einer** SQL-Anweisung (`app.checkin_verbrauchen`), weil Pruefen und danach
 * Schreiben ein Wettlauf ist. Ein doppelt getipptes Feld auf einer langsamen
 * Verbindung ist kein Randfall — es ist der Normalfall auf einem Telefon im
 * Treppenhaus —, und ein doppelter `zeiteintrag` ist doppelt abgerechnete Zeit
 * (FIN-07) und ein doppelter § 17 MiLoG-Nachweis.
 *
 * **Was dieser Dienst NICHT tut, ist rechnen.** Er bildet keine Zeit, keine
 * Dauer und keine Abweichung: der massgebliche Zeitpunkt ist `now()` in der
 * Datenbank (Invariante 5, TIM-08), die Abweichung leitet
 * `kern.stempel_feldzeit()` ab. Was hier zurueckkommt, ist gelesen, nicht
 * gerechnet — sonst gaebe es zwei Zahlen fuer eine Tatsache.
 */
import { createHash } from 'node:crypto';
import type { SchreibKontext } from '../../kontext/index.js';
import { withCheckin } from '../../kontext/checkin.js';
import type { Transaktion } from '../../kontext/index.js';

export type TokenZweck = 'checkin' | 'checkout';

/**
 * Der einzige Grund, aus dem eine Einloesung scheitert — und er nennt keinen.
 *
 * Unbekannte Marke, abgelaufen, zu frueh, widerrufen, schon benutzt: alle
 * ergeben dieselbe Ausnahme mit derselben Meldung. Eine Antwort, die die Faelle
 * unterscheidet, macht das Durchprobieren von Marken lohnend (AUT-06) — und
 * ein „diese Marke gibt es, sie ist nur abgelaufen" ist genau die Auskunft,
 * die ein Angreifer sucht.
 *
 * Der Code ist `ungueltiger_zustand`, HTTP 409: PR 34 nennt ihn woertlich fuer
 * die zweite Einloesung, und da alle Faelle dieselbe Antwort bekommen, gilt er
 * fuer alle. (`05-API-KARTE.md` §C schreibt an derselben Stelle 404. Der
 * Widerspruch ist in DECISIONS.md notiert; entscheidend ist, dass EIN Status
 * fuer ALLE Ablehnungen gilt — daran haengt die Orakelfreiheit, nicht an der
 * Zahl.)
 */
export class TokenAbgelehntFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super('Dieser Link ist nicht gültig.');
    this.name = 'TokenAbgelehntFehler';
  }
}

/**
 * Die Person hinter der Einteilung hat kein `benutzer`-Konto.
 *
 * Das ist AUSDRUECKLICH keine Ablehnung: die Transaktion faellt zurueck, die
 * Marke bleibt unverbraucht, und der Fall ist behebbar (Zugang freischalten).
 * Ihn in `TokenAbgelehntFehler` zu schlucken hiesse, dass die erste Schicht
 * eines neuen Menschen als „Link kaputt" erscheint — und die Marke waere
 * verbrannt.
 */
export class KeinBenutzerkontoFehler extends Error {
  readonly code = 'kein_benutzerkonto';
  readonly status = 409;
  constructor() {
    super('Für diese Person besteht noch kein Zugang.');
    this.name = 'KeinBenutzerkontoFehler';
  }
}

/** Eine Ausstempelmarke, zu der kein offener Eintrag existiert (§9.1). */
export class KeinOffenerEintragFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor() {
    super('Zu dieser Schicht läuft keine Zeiterfassung.');
    this.name = 'KeinOffenerEintragFehler';
  }
}

/** Der SQLSTATE, den `app.checkin_verbrauchen` fuer den jeweiligen Fall wirft. */
function ausSqlFehler(fehler: unknown): Error {
  const code = (fehler as { code?: string } | null)?.code;
  if (code === 'P0003') return new KeinBenutzerkontoFehler();
  if (code === 'P0004') return new KeinOffenerEintragFehler();
  return fehler instanceof Error ? fehler : new Error(String(fehler));
}

/**
 * `sha256(token)` hexadezimal — dieselbe Form, die `checkin_token.token_hash`
 * traegt.
 *
 * Gespeichert wird nur dieser Wert. Das Geheimnis lebt ausschliesslich in der
 * ausgelieferten Adresse, also macht ein Datenbankabzug keinen gefaelschten
 * Check-in moeglich (§16 Nr. 11).
 */
export function tokenHash(klartext: string): string {
  return createHash('sha256').update(klartext, 'utf8').digest('hex');
}

/** Ein Punkt, wie ihn LEG-10 zulaesst — einer bei Beginn, einer bei Ende. */
export interface GeoPunkt {
  readonly lat: number;
  readonly lon: number;
  readonly genauigkeitM?: number;
}

export interface CheckinEingabe {
  /** Die Marke im Klartext, wie sie in der Adresse steht. */
  readonly token: string;
  /** Die Uhr des Geraets. Wird GESPEICHERT und ist nie massgeblich (TIM-08). */
  readonly geraeteZeit?: Date | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /**
   * Nur uebergeben, wenn die Oberflaeche einen Punkt erhoben hat. Ist
   * `zeit.geolokalisierung` aus, verwirft die Datenbank ihn — die Erfassung
   * findet dann gar nicht erst statt (§9.5, O-06).
   */
  readonly geo?: GeoPunkt | null;
}

export interface CheckinErgebnis {
  readonly ergebnis: 'eingecheckt' | 'ausgecheckt';
  readonly zeiteintragId: string;
  readonly objekt: string | null;
  /** Der Zeitpunkt, den der SERVER gesetzt hat — UTC, angezeigt Berlin. */
  readonly serverZeit: Date;
  /**
   * Geraet minus Server, in Sekunden. Aus der Datenbank gelesen, nicht hier
   * gerechnet: die gespeicherte Zahl und die angezeigte muessen dieselbe sein.
   * `null`, wenn das Geraet keine Zeit mitgeschickt hat.
   */
  readonly zeitabweichungSek: number | null;
}

interface VerbrauchZeile {
  ergebnis: string;
  zeiteintrag_id: string | null;
  objekt: string | null;
  beginn: Date | null;
  zeitabweichung_sek: number | null;
}

/**
 * Loest eine Marke ein und schreibt die Zeitgrenze — in EINER Transaktion.
 *
 * Der Aufrufer oeffnet die Transaktion; dieser Dienst bindet den
 * K-08-Prinzipal und ruft die eine Funktion. Er liest keine Tabelle: er
 * koennte es nicht, `cse_checkin` haelt kein Tabellenrecht.
 */
export async function loeseCheckinEin(
  tx: Transaktion,
  eingabe: CheckinEingabe,
): Promise<CheckinErgebnis> {
  const hash = tokenHash(eingabe.token);
  const geo = eingabe.geo ?? null;

  let zeilen: readonly VerbrauchZeile[];
  try {
    zeilen = await withCheckin(tx, async (k) =>
      k.rufe<VerbrauchZeile>(
        `select ergebnis, zeiteintrag_id, objekt, beginn, zeitabweichung_sek
           from app.checkin_verbrauchen($1, $2::timestamptz, $3::inet, $4, $5::jsonb)`,
        [
          hash,
          eingabe.geraeteZeit?.toISOString() ?? null,
          eingabe.ip ?? null,
          eingabe.userAgent ?? null,
          /**
           * Das OBJEKT, nicht `JSON.stringify(objekt)`.
           *
           * Der Treiber serialisiert selbst. Eine bereits erzeugte Zeichenkette
           * wird ein ZWEITES Mal kodiert und landet als jsonb-Zeichenkette
           * statt als jsonb-Objekt — `p_geo ->> 'lat'` ist dann NULL, der
           * Check-in gelingt, und der Punkt fehlt. Kein Fehler, keine
           * Meldung, nur eine Erfassung, die nie etwas erfasst. Genau dieser
           * Fall stand hier, und `tests/isolation/zeiteintrag.test.ts` hat ihn
           * gefunden.
           */
          geo === null ? null : {
            lat: geo.lat, lon: geo.lon,
            genauigkeit_m: geo.genauigkeitM ?? null,
            status: 'erfasst',
          },
        ],
      ));
  } catch (fehler: unknown) {
    throw ausSqlFehler(fehler);
  }

  const zeile = zeilen[0];
  // Kein Satz zurueck ist derselbe Fall wie `abgelehnt` — beides heisst: die
  // bedingte Anweisung hat null Zeilen getroffen (K-09).
  if (zeile === undefined || zeile.ergebnis === 'abgelehnt') {
    throw new TokenAbgelehntFehler();
  }
  if (zeile.zeiteintrag_id === null || zeile.beginn === null) {
    // Kann nicht eintreten: die Funktion wirft, statt eine Marke ohne
    // Zeiteintrag zu verbrennen. Der Zweig steht hier, weil ein `!` an dieser
    // Stelle genau die stille Variante davon waere.
    throw new TokenAbgelehntFehler();
  }
  return {
    ergebnis: zeile.ergebnis === 'eingecheckt' ? 'eingecheckt' : 'ausgecheckt',
    zeiteintragId: zeile.zeiteintrag_id,
    objekt: zeile.objekt,
    serverZeit: zeile.beginn,
    zeitabweichungSek: zeile.zeitabweichung_sek,
  };
}

/**
 * Gibt eine Marke aus und liefert sie EINMAL im Klartext zurueck.
 *
 * Der Rueckgabewert ist das Geheimnis; danach existiert es nirgends mehr —
 * weder in der Datenbank noch im Protokoll noch im Audit. Wer ihn nicht
 * ausliefert, hat ihn verloren, und das ist die richtige Richtung.
 *
 * Der Kanal ist ein Adapter, kein Schema-Fakt. Solange keiner verbunden ist,
 * steht `unverbunden` auf der Zeile und die Oberflaeche sagt das — sie
 * simuliert keinen Versand.
 * // TODO(client, O-93): Wie erreicht der Check-in-Link den Mitarbeitenden —
 * SMS, E-Mail, aushaengender QR-Code am Objekt oder Portal-Link, wer ist der
 * SMS-Anbieter (EU-Verarbeitung, AVV), und wer traegt die Kosten?
 */
export async function gibCheckinAus(
  kontext: SchreibKontext,
  zuordnungId: string,
  zweck: TokenZweck,
  kanal = 'unverbunden',
): Promise<string> {
  const zeilen = await kontext.schreibe<{ marke: string }>(
    `select app.checkin_ausgeben($1::uuid, $2::token_zweck, $3) as marke`,
    [zuordnungId, zweck, kanal],
  );
  const marke = zeilen[0]?.marke;
  if (marke === undefined || marke === '') {
    throw new Error('app.checkin_ausgeben hat keine Marke geliefert.');
  }
  return marke;
}
