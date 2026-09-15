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
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
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

/**
 * **Wer eine Marke hat, wer sie benutzt hat — und wer keine hat.**
 *
 * Die Zeile ist die EINTEILUNG, nicht die Marke. Das ist der Unterschied, auf
 * den es ankommt: der Planer fragt „wer kommt morgen an den Hackeschen Markt
 * und kann dort stempeln", nicht „welche Marken existieren". Eine Liste der
 * Marken beantwortet die zweite Frage und verschweigt die erste — und genau
 * die Einteilung OHNE Marke ist die, bei der jemand vor der Tuer steht und
 * nicht einchecken kann.
 *
 * `linksAussen` (`left join`) deshalb, und nicht `join`.
 */
export interface CheckinZeile {
  readonly zuordnungId: string;
  readonly person: string;
  readonly objekt: string | null;
  readonly beginn: Date;
  readonly ende: Date;
  /** `null` heisst: fuer diese Einteilung gibt es keine lebende Marke. */
  readonly tokenId: string | null;
  readonly zweck: TokenZweck | null;
  readonly ausgegebenAm: Date | null;
  readonly ausgabeKanal: string | null;
  readonly eingeloestAm: Date | null;
  readonly widerrufenAm: Date | null;
  readonly widerrufGrund: string | null;
  readonly gueltigBis: Date | null;
}

export interface CheckinFenster {
  /** Wie viele Tage nach vorn — der Planer plant die Woche, nicht das Jahr. */
  readonly tage?: number;
}

/**
 * Die Einteilungen des Fensters mit ihrer JEWEILS JUENGSTEN Marke.
 *
 * `distinct on` statt `max()`: gebraucht wird die ganze Zeile der juengsten
 * Marke (Zweck, Kanal, Einloesung, Widerruf), nicht ihr Zeitpunkt. Eine
 * Unterabfrage je Spalte waere dieselbe Antwort in fuenf Abfragen.
 */
export async function listeCheckinZeilen(
  kontext: LeseKontext, fenster: CheckinFenster = {},
): Promise<readonly CheckinZeile[]> {
  const tage = fenster.tage ?? 7;
  return kontext.abfrage<CheckinZeile>(
    `select ez.id                       as "zuordnungId",
            trim(p.vorname || ' ' || p.nachname) as person,
            o.name                      as objekt,
            ez.beginn_zeitpunkt         as beginn,
            ez.ende_zeitpunkt           as ende,
            t.id                        as "tokenId",
            t.zweck::text               as zweck,
            t.erstellt_am               as "ausgegebenAm",
            t.ausgabe_kanal             as "ausgabeKanal",
            t.eingeloest_am             as "eingeloestAm",
            t.widerrufen_am             as "widerrufenAm",
            t.widerruf_grund            as "widerrufGrund",
            t.gueltig_bis               as "gueltigBis"
       from einsatz_zuordnung ez
       join person p on p.id = ez.person_id
       join einsatz e on e.mandant_id = ez.mandant_id and e.id = ez.einsatz_id
       left join objekt o on o.id = e.objekt_id
       left join lateral (
         select ct.* from checkin_token ct
          where ct.einsatz_zuordnung_id = ez.id
          order by ct.erstellt_am desc
          limit 1
       ) t on true
      where ez.entfernt_am is null
        and ez.ende_zeitpunkt   >= now() - interval '1 day'
        and ez.beginn_zeitpunkt <= now() + ($1 || ' days')::interval
      order by ez.beginn_zeitpunkt, person
      limit 200`,
    [String(tage)]);
}

/**
 * Widerruft eine Marke, die noch nicht eingeloest ist.
 *
 * `false` heisst „nichts getan" und ist KEIN Fehler: die Marke gibt es nicht,
 * sie ist schon eingeloest oder schon widerrufen. Ein Orakel daraus zu machen
 * waere dieselbe Auskunft, die AUT-06 verbietet — der Bildschirm sagt danach
 * ohnehin, was jetzt gilt, weil er neu laedt.
 */
export async function widerrufeCheckin(
  kontext: SchreibKontext, tokenId: string, grund: string,
): Promise<boolean> {
  const [z] = await kontext.schreibe<{ ok: boolean }>(
    `select app.checkin_widerrufen($1::uuid, $2) as ok`, [tokenId, grund]);
  return z?.ok === true;
}
