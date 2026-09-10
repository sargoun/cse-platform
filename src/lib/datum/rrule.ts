/**
 * RRULE — die Teilmenge von RFC 5545, die ein Turnus braucht (CLN-02, TIM-02),
 * entfaltet über die **Berliner Wanduhr**.
 *
 * Warum das keine Bibliothek erledigt: eine Serie ist kein Zeitpunkt, sondern
 * eine Aussage über die Wanduhr. „Montags um 06:00" bleibt am 30. März 06:00
 * Ortszeit — der *Instant* verschiebt sich um eine Stunde, die Wanduhr nicht.
 * Wer in UTC entfaltet und danach umrechnet, lässt die Kolonne ab der Umstellung
 * um 05:00 oder um 07:00 anrücken: im Sommer fällt das niemandem auf, im Winter
 * kostet es die Vertragsstrafe (K-11, `03-GEWERKE.md` §10.1).
 *
 * Deshalb läuft die Entfaltung über **Kalendertage** und eine feste Ortszeit, und
 * erst das fertige Vorkommnis wird mit `berlinInstant` aus `./dauer.ts` in einen
 * Instant übersetzt. Es gibt in diesem Projekt genau eine solche Umrechnung; eine
 * zweite wäre genau der Fehler, den K-11 verhindern soll.
 *
 * ## Unterstützt
 *
 * `FREQ=DAILY|WEEKLY|MONTHLY` · `INTERVAL` · `BYDAY` (MO…SU, **nur** zu WEEKLY) ·
 * `BYMONTHDAY` (1…31, **nur** zu MONTHLY) · `COUNT` · `UNTIL`. Die Reihenfolge der
 * Komponenten ist frei — RFC 5545 legt sie nicht fest, und `INTERVAL=2;FREQ=WEEKLY`
 * ist eine gültige Regel (`04-PLANUNG-ZEIT.md` §8.2, wo die Prüfregel
 * `rrule ~ '^FREQ='` genau deswegen gestrichen wurde).
 *
 * ## Nicht unterstützt — und deshalb **abgewiesen, nicht ignoriert**
 *
 * `BYSETPOS` · `BYMONTH` · `BYWEEKNO` · `BYYEARDAY` · `BYHOUR` · `BYMINUTE` ·
 * `BYSECOND` · `WKST` · `FREQ=SECONDLY|MINUTELY|HOURLY|YEARLY` · gezählte
 * Wochentage (`2MO`, `-1FR`) · negative `BYMONTHDAY` (`-1` für „letzter Tag des
 * Monats") · `RDATE`/`EXDATE` (Ausnahmen leben in `turnus_ausnahme` /
 * `posten_ausnahme`, §8.2 Schritt 3).
 *
 * Jede unbekannte oder nicht unterstützte Komponente wirft `RegelFehler`. Das ist
 * der Kern dieser Datei: eine stillschweigend verworfene Komponente plant die
 * falschen Tage, und zwar plausibel. `FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=1`
 * meint „einmal pro Woche, am ersten dieser Tage"; ohne BYSETPOS entstehen drei
 * Schichten pro Woche statt einer — jede mit Check-in-Link, jede im
 * Leistungsnachweis, jede in der Rechnung. Ein Fehler beim Speichern ist billig,
 * eine dreifach besetzte Woche ist es nicht.
 *
 * Aus demselben Grund ist `WKST` nicht „egal": diese Entfaltung nimmt Montag als
 * Wochenanfang an (RFC-Vorgabe und deutsche Woche). Bei `INTERVAL=1` ändert ein
 * abweichender Wochenanfang nichts, bei `INTERVAL=2` verschiebt er jede zweite
 * Woche — also wird er abgewiesen statt angenommen.
 *
 * ## Was der Aufrufer bekommt
 *
 * Ein `Vorkommnis` trägt beides: die geplante Ortszeit (`planDatum`,
 * `beginnLokal` — das, was `einsatz.beginn_lokal` als Beweis festhält und was in
 * den Idempotenzschlüssel `serie:<id>:<plan_datum>:<HHMM>` eingeht, §8.3) **und**
 * den daraus aufgelösten Instant (`beginnZeitpunkt` → `einsatz.beginn_zeitpunkt`,
 * timestamptz, UTC gespeichert). Die Dauer bleibt die Differenz zweier Instants
 * (`dauerMinuten`), nie eine Wanduhr-Subtraktion — deshalb ergeben die beiden
 * Umstellungsnächte 420 und 540 Minuten und nicht zweimal 480.
 */
import {
  berlinInstant, berlinTeile, istKalendertag, ZeitFehler,
} from '../../server/services/zeit/dauer.js';

/**
 * Der benannte Fehler dieser Datei.
 *
 * Er erbt von `ZeitFehler`, weil ein Aufrufer, der Zeitfehler schon abfängt,
 * keinen zweiten `catch` braucht; der eigene `name` unterscheidet trotzdem
 * „diese Regel ist unbrauchbar" von „diese Zeiten sind unbrauchbar".
 */
export class RegelFehler extends ZeitFehler {
  constructor(message: string) {
    super(message);
    this.name = 'RegelFehler';
  }
}

/** Die Frequenzen, die ein Turnus braucht. RFC-Token, also englisch. */
export const FREQUENZEN = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Frequenz = (typeof FREQUENZEN)[number];

/** RFC 5545 §3.3.10, Wochentage ab Montag — die Reihenfolge ist die Indexbasis. */
export const WOCHENTAGE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Wochentag = (typeof WOCHENTAGE)[number];

/** Die Komponenten, die diese Datei kennt. Alles andere wirft. */
export const UNTERSTUETZTE_KOMPONENTEN = [
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'COUNT',
  'UNTIL',
] as const;

/**
 * `zeitanomalie` aus `04-PLANUNG-ZEIT.md` §3.1, Wert für Wert.
 *
 * Diese Datei erfindet dafür **keine eigene Sprache**: `einsatz.zeitanomalie` ist
 * ein Postgres-Enum mit genau diesen drei Werten, und der Materialisierer schreibt
 * den Wert unverändert in die Spalte. Ein zweites Vokabular bräuchte eine
 * Abbildung, und eine Abbildung driftet.
 */
export const ZEITANOMALIEN = ['keine', 'dst_luecke', 'dst_doppelt'] as const;
export type Zeitanomalie = (typeof ZEITANOMALIEN)[number];

/** Die gelesene Regel — das, wogegen der Speichern-Pfad validiert (§8.2). */
export interface Turnusregel {
  readonly freq: Frequenz;
  /** `INTERVAL`, Vorgabe 1. */
  readonly interval: number;
  /** `BYDAY`, nur zu WEEKLY; `undefined` = der Wochentag des Ankers. */
  readonly byday: readonly Wochentag[] | undefined;
  /** `BYMONTHDAY`, nur zu MONTHLY; `undefined` = der Monatstag des Ankers. */
  readonly bymonthday: readonly number[] | undefined;
  readonly count: number | undefined;
  readonly until: Grenze | undefined;
}

/**
 * `UNTIL` in seinen drei zulässigen Schreibweisen.
 *
 * Als reines Datum ist die Grenze eine Aussage über die Wanduhr und wird auch so
 * verglichen; als `…Z` ist sie ein Instant. Beides ist inklusiv (RFC 5545: „bounds
 * the recurrence rule in an inclusive manner").
 */
export type Grenze =
  | { readonly art: 'datum'; readonly datum: string }
  | { readonly art: 'zeitpunkt'; readonly zeitpunkt: Date };

/** Der lokale Anker der Serie — `dtstart_lokal` + Uhrzeit, nie ein Instant. */
export interface AnkerLokal {
  /** `JJJJ-MM-TT`, Berliner Kalendertag. */
  readonly datum: string;
  readonly stunde: number;
  readonly minute: number;
}

/** Das Entfaltungsfenster, beide Grenzen inklusiv, in Berliner Kalendertagen. */
export interface Fenster {
  readonly vonDatum: string;
  readonly bisDatum: string;
}

/** Ein entfaltetes Vorkommnis — ein künftiger `einsatz`, noch ohne Zeile. */
export interface Vorkommnis {
  /** `einsatz.plan_datum` — der Berliner Kalendertag, dem die Schicht gehört. */
  readonly planDatum: string;
  /** `einsatz.beginn_lokal` als `HH:MM` — die **geplante** Wanduhrzeit. */
  readonly beginnLokal: string;
  /** `einsatz.beginn_zeitpunkt` — der Instant, UTC. */
  readonly beginnZeitpunkt: Date;
  /** `einsatz.zeitanomalie` — was bei der Auflösung passiert ist. */
  readonly anomalie: Zeitanomalie;
}

/** Ergebnis der Auflösung einer Ortszeit; auch das Schichtende geht hier durch. */
export interface Ortszeitaufloesung {
  readonly zeitpunkt: Date;
  readonly anomalie: Zeitanomalie;
}

export interface EntfaltungsOptionen {
  /**
   * Welcher der beiden Instants gilt, wenn es die Ortszeit zweimal gibt.
   *
   * Vorgabe ist der **frühere** (noch CEST) — die Regel, die
   * `04-PLANUNG-ZEIT.md` §7.2 als PLATZHALTER festhält. Sie steht hier als
   * Parameter und nicht als Konstante, weil die Wahl des Instants die Wahl der
   * Vergütung ist: der frühere Zeitpunkt erzeugt systematisch die längere, besser
   * bezahlte Schicht, der spätere die kürzere. Das ist keine technische
   * Entscheidung, und deshalb wird sie hier nicht stillschweigend getroffen,
   * sondern austauschbar gemacht (K-17, §7.2 `DstStrategie.beiUeberlappung`).
   *
   * // TODO(client, O-163): Wie werden die beiden Nächte der Zeitumstellung bezahlt — zählt die
   * // geleistete Zeit (7 h bzw. 9 h) oder die geplante Schichtlänge? Und welcher der beiden
   * // Zeitpunkte gilt bei doppelt vorhandener Ortszeit in der Rückstellungsnacht?
   */
  readonly beiUeberlappung?: ((kandidaten: readonly [Date, Date]) => Date) | undefined;
}

const MS_PRO_TAG = 86_400_000;
const MS_PRO_STUNDE = 3_600_000;

/**
 * Obergrenze der Kandidatensuche, in Tagen ab dem Anker.
 *
 * Die Entfaltung läuft Tag für Tag vom Anker bis zum Fensterende — eine Serie aus
 * 2015, die 2026 geplant wird, sind viertausend Durchläufe und damit kein Problem.
 * Ein vertippter Anker („1026-03-23") wäre eine Million, und eine Schleife, die
 * scheinbar hängt, ist schwerer zu finden als ein Fehler, der sagt was los ist.
 */
const MAX_KANDIDATENTAGE = 40_000;

interface Kalendertag {
  readonly jahr: number;
  readonly monat: number;
  readonly tag: number;
}

// --- Kalenderarithmetik ----------------------------------------------------
// Bewusst in UTC gerechnet: hier geht es um die Abfolge von Kalendertagen, nicht
// um Zeitpunkte. UTC hat keine Zeitumstellung, also ist „ein Tag" hier immer
// 86 400 000 ms. Die Ortszeit kommt erst bei der Auflösung dazu.

function tagesnummer(k: Kalendertag): number {
  return Math.round(Date.UTC(k.jahr, k.monat - 1, k.tag) / MS_PRO_TAG);
}

function vonTagesnummer(nummer: number): Kalendertag {
  const d = new Date(nummer * MS_PRO_TAG);
  return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: d.getUTCDate() };
}

/** 0 = Montag. Der 1.1.1970 (Tagesnummer 0) war ein Donnerstag, daher die +3. */
function wochentagIndex(nummer: number): number {
  return (((nummer + 3) % 7) + 7) % 7;
}

function formatDatum(k: Kalendertag): string {
  return `${String(k.jahr).padStart(4, '0')}-${String(k.monat).padStart(2, '0')}-${String(k.tag).padStart(2, '0')}`;
}

function formatUhrzeit(stunde: number, minute: number): string {
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function leseDatum(datum: string, feld: string): Kalendertag {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(datum.trim());
  if (treffer === null) {
    throw new RegelFehler(`${feld} ist kein Datum der Form JJJJ-MM-TT: ${JSON.stringify(datum)}`);
  }
  const k = {
    jahr: Number(treffer[1]),
    monat: Number(treffer[2]),
    tag: Number(treffer[3]),
  };
  // Die Form allein genügt nicht — `2026-02-30` hat sie (siehe dauer.ts).
  if (!istKalendertag(k.jahr, k.monat, k.tag)) {
    throw new RegelFehler(`${feld} nennt einen Tag, den der Kalender nicht kennt: ${datum}`);
  }
  return k;
}

function pruefeUhrzeit(stunde: number, minute: number): void {
  if (!Number.isInteger(stunde) || stunde < 0 || stunde > 23) {
    throw new RegelFehler(`Stunde liegt ausserhalb 0…23: ${stunde}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RegelFehler(`Minute liegt ausserhalb 0…59: ${minute}`);
  }
}

// --- Regel lesen -----------------------------------------------------------

function leseGanzzahl(name: string, wert: string, minimum: number): number {
  if (!/^\d+$/u.test(wert)) {
    throw new RegelFehler(`${name} erwartet eine positive Ganzzahl, gelesen: ${JSON.stringify(wert)}`);
  }
  const zahl = Number(wert);
  if (zahl < minimum) {
    throw new RegelFehler(`${name}=${zahl} ist kleiner als ${minimum} und ergibt keine Serie`);
  }
  return zahl;
}

function leseGrenze(wert: string): Grenze {
  const alsDatum = /^(\d{4})(\d{2})(\d{2})$/u.exec(wert);
  if (alsDatum !== null) {
    const k = leseDatum(`${alsDatum[1]}-${alsDatum[2]}-${alsDatum[3]}`, 'UNTIL');
    return { art: 'datum', datum: formatDatum(k) };
  }
  const alsZeit = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/u.exec(wert);
  if (alsZeit === null) {
    throw new RegelFehler(
      `UNTIL ist weder JJJJMMTT noch JJJJMMTTThhmmss[Z]: ${JSON.stringify(wert)}`,
    );
  }
  const k = leseDatum(`${alsZeit[1]}-${alsZeit[2]}-${alsZeit[3]}`, 'UNTIL');
  const stunde = Number(alsZeit[4]);
  const minute = Number(alsZeit[5]);
  const sekunde = Number(alsZeit[6]);
  if (stunde > 23 || minute > 59 || sekunde > 59) {
    throw new RegelFehler(`UNTIL nennt keine gültige Uhrzeit: ${JSON.stringify(wert)}`);
  }
  // Ohne `Z` ist die Grenze Ortszeit (RFC 5545: schwebender DTSTART verlangt eine
  // schwebende UNTIL-Grenze) und wird deshalb wie jede andere Ortszeit aufgelöst.
  const zeitpunkt =
    alsZeit[7] === 'Z'
      ? new Date(Date.UTC(k.jahr, k.monat - 1, k.tag, stunde, minute, sekunde))
      : berlinInstant(k.jahr, k.monat, k.tag, stunde, minute);
  return { art: 'zeitpunkt', zeitpunkt };
}

function leseWochentage(wert: string): readonly Wochentag[] {
  const tage: Wochentag[] = [];
  for (const roh of wert.split(',')) {
    const token = roh.trim();
    const bekannt = WOCHENTAGE.find((w) => w === token);
    if (bekannt === undefined) {
      throw new RegelFehler(
        `BYDAY kennt nur ${WOCHENTAGE.join(', ')} ohne Zähler, gelesen: ${JSON.stringify(token)}. ` +
          'Gezählte Wochentage („2MO", „-1FR") werden nicht unterstützt und nicht überlesen — ' +
          'aus „letzter Freitag im Monat" würde sonst jeder Freitag.',
      );
    }
    if (tage.includes(bekannt)) {
      throw new RegelFehler(`BYDAY nennt ${bekannt} zweimal; das ist ein Tippfehler, keine Doppelschicht`);
    }
    tage.push(bekannt);
  }
  return tage;
}

function leseMonatstage(wert: string): readonly number[] {
  const tage: number[] = [];
  for (const roh of wert.split(',')) {
    const token = roh.trim();
    if (!/^\d{1,2}$/u.test(token) || Number(token) < 1 || Number(token) > 31) {
      throw new RegelFehler(
        `BYMONTHDAY kennt nur 1…31, gelesen: ${JSON.stringify(token)}. Negative Werte ` +
          '(„-1" für den letzten Tag des Monats) werden nicht unterstützt.',
      );
    }
    const tag = Number(token);
    if (tage.includes(tag)) throw new RegelFehler(`BYMONTHDAY nennt den ${tag}. zweimal`);
    tage.push(tag);
  }
  return tage;
}

/**
 * Liest eine RRULE, oder wirft.
 *
 * Dieselbe Funktion prüft die Regel beim Speichern und entfaltet sie im
 * Generator (§8.2) — zwei Parser wären zwei Meinungen darüber, was eine gültige
 * Serie ist, und die zweite fällt erst nachts um 02:15 auf.
 */
export function leseRegel(regel: string): Turnusregel {
  const roh = regel.trim().toUpperCase();
  if (roh === '') throw new RegelFehler('Leere RRULE');
  if (roh.startsWith('RRULE:')) {
    throw new RegelFehler(
      'Die RRULE steht ohne das Präfix „RRULE:" in der Spalte (03-GEWERKE.md §5.3)',
    );
  }

  const komponenten = new Map<string, string>();
  for (const stueck of roh.split(';')) {
    const teil = stueck.trim();
    if (teil === '') throw new RegelFehler(`Leere Komponente in ${JSON.stringify(regel)}`);
    const gleich = teil.indexOf('=');
    if (gleich < 1 || gleich === teil.length - 1) {
      throw new RegelFehler(`Komponente ohne NAME=WERT: ${JSON.stringify(teil)}`);
    }
    const name = teil.slice(0, gleich);
    if (komponenten.has(name)) {
      throw new RegelFehler(`${name} steht zweimal in der Regel; RFC 5545 lässt jede Komponente einmal zu`);
    }
    komponenten.set(name, teil.slice(gleich + 1));
  }

  for (const name of komponenten.keys()) {
    if (!(UNTERSTUETZTE_KOMPONENTEN as readonly string[]).includes(name)) {
      throw new RegelFehler(
        `${name} wird nicht unterstützt und wird nicht überlesen. Unterstützt sind ` +
          `${UNTERSTUETZTE_KOMPONENTEN.join(', ')}. Eine verworfene Komponente plant die falschen ` +
          'Tage, und zwar plausibel — deshalb bricht die Serie hier ab statt später zu viele ' +
          'oder zu wenige Schichten zu erzeugen.',
      );
    }
  }

  const freqWert = komponenten.get('FREQ');
  if (freqWert === undefined) throw new RegelFehler('FREQ fehlt; RFC 5545 verlangt es');
  const freq = FREQUENZEN.find((f) => f === freqWert);
  if (freq === undefined) {
    throw new RegelFehler(
      `FREQ=${freqWert} wird nicht unterstützt; ein Dienstplan kennt ${FREQUENZEN.join(', ')}`,
    );
  }

  const intervalWert = komponenten.get('INTERVAL');
  const interval = intervalWert === undefined ? 1 : leseGanzzahl('INTERVAL', intervalWert, 1);

  const bydayWert = komponenten.get('BYDAY');
  if (bydayWert !== undefined && freq !== 'WEEKLY') {
    throw new RegelFehler(
      `BYDAY wird nur zu FREQ=WEEKLY unterstützt, hier steht FREQ=${freq}. ` +
        '„Jeden ersten Montag im Monat" braucht BYSETPOS und ist damit ausserhalb dieser Teilmenge.',
    );
  }
  const bydayListe = bydayWert === undefined ? undefined : leseWochentage(bydayWert);

  const bymonthdayWert = komponenten.get('BYMONTHDAY');
  if (bymonthdayWert !== undefined && freq !== 'MONTHLY') {
    throw new RegelFehler(
      `BYMONTHDAY wird nur zu FREQ=MONTHLY unterstützt, hier steht FREQ=${freq}`,
    );
  }
  const bymonthdayListe = bymonthdayWert === undefined ? undefined : leseMonatstage(bymonthdayWert);

  const countWert = komponenten.get('COUNT');
  const untilWert = komponenten.get('UNTIL');
  if (countWert !== undefined && untilWert !== undefined) {
    throw new RegelFehler('COUNT und UNTIL schliessen einander aus (RFC 5545 §3.3.10)');
  }

  return {
    freq,
    interval,
    byday: bydayListe,
    bymonthday: bymonthdayListe,
    count: countWert === undefined ? undefined : leseGanzzahl('COUNT', countWert, 1),
    until: untilWert === undefined ? undefined : leseGrenze(untilWert),
  };
}

// --- Ortszeit auflösen -----------------------------------------------------

const FRUEHERER: (kandidaten: readonly [Date, Date]) => Date = (kandidaten) => kandidaten[0];

function liestSichAls(zeitpunkt: Date, k: Kalendertag, stunde: number, minute: number): boolean {
  const t = berlinTeile(zeitpunkt);
  return (
    t.jahr === k.jahr &&
    t.monat === k.monat &&
    t.tag === k.tag &&
    t.stunde === stunde &&
    t.minute === minute
  );
}

/**
 * Eine Berliner Wanduhrzeit in ihren Instant übersetzen — und dabei sagen, ob es
 * die Uhrzeit an diesem Tag überhaupt gibt, und ob es sie einmal oder zweimal
 * gibt (`04-PLANUNG-ZEIT.md` §7.2).
 *
 * Zweimal im Jahr ist die Frage nicht beantwortbar, ohne sie zu beantworten:
 *
 * - **02:30 in der Nacht der Vorstellung** gibt es nicht; die Uhr springt von
 *   02:00 auf 03:00. `berlinInstant` löst nach vorn auf, die Schicht beginnt also
 *   real um 03:30 Ortszeit. Das Vorkommnis trägt `dst_luecke`, damit
 *   `einsatz.zeitanomalie` festhält, dass die gespeicherte Wanduhrzeit nicht die
 *   geplante ist — der Planer sieht eine Abweichung statt eine stille Verschiebung.
 * - **02:30 in der Nacht der Rückstellung** gibt es zweimal, einmal in CEST und
 *   eine Stunde später in CET. Das Vorkommnis trägt `dst_doppelt`, und welcher der
 *   beiden Zeitpunkte gilt, entscheidet `optionen.beiUeberlappung` (Vorgabe: der
 *   frühere, §7.2, O-163).
 *
 * Geprüft wird in **beide** Richtungen (eine Stunde früher und eine Stunde
 * später), nicht in einer: welchen der beiden Instants `berlinInstant` selbst
 * zurückgibt, ist für die Erkennung dann gleichgültig, und die Erkennung bleibt
 * richtig, falls sich das dort einmal ändert.
 */
export function loeseOrtszeitAuf(
  datum: string,
  stunde: number,
  minute: number,
  optionen: EntfaltungsOptionen = {},
): Ortszeitaufloesung {
  const k = leseDatum(datum, 'datum');
  pruefeUhrzeit(stunde, minute);
  return loeseAuf(k, stunde, minute, optionen.beiUeberlappung ?? FRUEHERER);
}

function loeseAuf(
  k: Kalendertag,
  stunde: number,
  minute: number,
  waehle: (kandidaten: readonly [Date, Date]) => Date,
): Ortszeitaufloesung {
  const zeitpunkt = berlinInstant(k.jahr, k.monat, k.tag, stunde, minute);
  if (!liestSichAls(zeitpunkt, k, stunde, minute)) {
    return { zeitpunkt, anomalie: 'dst_luecke' };
  }
  const frueher = new Date(zeitpunkt.getTime() - MS_PRO_STUNDE);
  if (liestSichAls(frueher, k, stunde, minute)) {
    return { zeitpunkt: waehle([frueher, zeitpunkt]), anomalie: 'dst_doppelt' };
  }
  const spaeter = new Date(zeitpunkt.getTime() + MS_PRO_STUNDE);
  if (liestSichAls(spaeter, k, stunde, minute)) {
    return { zeitpunkt: waehle([zeitpunkt, spaeter]), anomalie: 'dst_doppelt' };
  }
  return { zeitpunkt, anomalie: 'keine' };
}

// --- Entfalten -------------------------------------------------------------

function istVorkommnisTag(
  regel: Turnusregel,
  anker: Kalendertag,
  ankerNr: number,
  kandidat: Kalendertag,
  kandidatNr: number,
): boolean {
  switch (regel.freq) {
    case 'DAILY':
      return (kandidatNr - ankerNr) % regel.interval === 0;

    case 'WEEKLY': {
      // Gezählt wird in Wochen ab der Woche des Ankers, Wochenanfang Montag —
      // nicht in Vielfachen von sieben Tagen ab dem Anker. Bei BYDAY=MO,FR und
      // INTERVAL=2 ist das der Unterschied zwischen „jede zweite Woche" und
      // „mal Montag, mal Freitag".
      const wocheAnker = ankerNr - wochentagIndex(ankerNr);
      const wocheKandidat = kandidatNr - wochentagIndex(kandidatNr);
      if (((wocheKandidat - wocheAnker) / 7) % regel.interval !== 0) return false;
      if (regel.byday === undefined) return wochentagIndex(kandidatNr) === wochentagIndex(ankerNr);
      const tag = WOCHENTAGE[wochentagIndex(kandidatNr)];
      return tag !== undefined && regel.byday.includes(tag);
    }

    case 'MONTHLY': {
      const monatsIndex = (kandidat.jahr - anker.jahr) * 12 + (kandidat.monat - anker.monat);
      if (monatsIndex % regel.interval !== 0) return false;
      if (regel.bymonthday === undefined) return kandidat.tag === anker.tag;
      return regel.bymonthday.includes(kandidat.tag);
    }
  }
}

/**
 * Entfaltet eine RRULE über die Berliner Wanduhr in die Vorkommnisse, die im
 * Fenster liegen.
 *
 * Der Anker ist eine **Ortszeit** (`turnus.dtstart_lokal` + `zeitzone`), das
 * Fenster sind Berliner Kalendertage, beide Grenzen inklusiv. Zurück kommen die
 * Vorkommnisse in chronologischer Reihenfolge.
 *
 * Zwei Eigenschaften, die man leicht falsch baut:
 *
 * 1. **COUNT und UNTIL zählen ab dem Anker, nicht ab dem Fenster.** Der Generator
 *    läuft jede Nacht mit einem wandernden Fenster; würde COUNT ab `vonDatum`
 *    zählen, erzeugte eine Serie mit `COUNT=10` jede Woche zehn weitere Schichten.
 *    Deshalb beginnt die Suche immer am Anker und filtert erst am Ende aufs
 *    Fenster.
 * 2. **Der Anker ist nur dann selbst ein Vorkommnis, wenn er zur Regel passt.**
 *    RFC 5545 nennt eine Serie mit unsynchronisiertem DTSTART „undefined"; hier
 *    entsteht dann keine Geisterschicht an einem Tag, den das Muster nicht nennt.
 *
 * Vorkommnisse vor dem Anker gibt es nicht: eine Serie beginnt an ihrem Anfang.
 */
export function entfalte(
  regel: string,
  ankerLokal: AnkerLokal,
  fenster: Fenster,
  optionen: EntfaltungsOptionen = {},
): readonly Vorkommnis[] {
  const gelesen = leseRegel(regel);
  const anker = leseDatum(ankerLokal.datum, 'ankerLokal.datum');
  pruefeUhrzeit(ankerLokal.stunde, ankerLokal.minute);
  const von = leseDatum(fenster.vonDatum, 'fenster.vonDatum');
  const bis = leseDatum(fenster.bisDatum, 'fenster.bisDatum');

  const ankerNr = tagesnummer(anker);
  const vonNr = tagesnummer(von);
  const bisNr = tagesnummer(bis);
  if (bisNr < vonNr) {
    throw new RegelFehler(
      `Fensterende liegt vor dem Fensterbeginn: ${fenster.vonDatum} → ${fenster.bisDatum}`,
    );
  }

  // Ein Datums-UNTIL ist eine Aussage über die Wanduhr und begrenzt deshalb die
  // Kandidatensuche selbst; ein Zeitpunkt-UNTIL wird unten am Instant verglichen.
  let endeNr = bisNr;
  if (gelesen.until?.art === 'datum') {
    endeNr = Math.min(endeNr, tagesnummer(leseDatum(gelesen.until.datum, 'UNTIL')));
  }

  const waehle = optionen.beiUeberlappung ?? FRUEHERER;
  const beginnLokal = formatUhrzeit(ankerLokal.stunde, ankerLokal.minute);
  const vorkommnisse: Vorkommnis[] = [];
  let gezaehlt = 0;
  let durchlaeufe = 0;

  for (let nr = ankerNr; nr <= endeNr; nr += 1) {
    if (gelesen.count !== undefined && gezaehlt >= gelesen.count) break;
    durchlaeufe += 1;
    if (durchlaeufe > MAX_KANDIDATENTAGE) {
      throw new RegelFehler(
        `Mehr als ${MAX_KANDIDATENTAGE} Kandidatentage zwischen Anker ${ankerLokal.datum} und ` +
          `${fenster.bisDatum} — das ist kein Turnus, das ist ein vertipptes Ankerdatum.`,
      );
    }

    const kandidat = vonTagesnummer(nr);
    if (!istVorkommnisTag(gelesen, anker, ankerNr, kandidat, nr)) continue;

    const { zeitpunkt, anomalie } = loeseAuf(kandidat, ankerLokal.stunde, ankerLokal.minute, waehle);
    if (
      gelesen.until?.art === 'zeitpunkt' &&
      zeitpunkt.getTime() > gelesen.until.zeitpunkt.getTime()
    ) {
      break;
    }

    // Gezählt wird jedes Vorkommnis der Serie, auch die vor dem Fenster — sonst
    // wäre COUNT eine Aussage über den Generatorlauf statt über die Serie.
    gezaehlt += 1;
    if (nr < vonNr) continue;

    vorkommnisse.push({
      // `plan_datum` ist der Tag, den die Regel genannt hat. In der Lücke liest
      // sich der Instant zwar als 03:30 statt 02:30, aber die Schicht gehört
      // weiter in die Dienstplanspalte des geplanten Tages (§5.3).
      planDatum: formatDatum(kandidat),
      beginnLokal,
      beginnZeitpunkt: zeitpunkt,
      anomalie,
    });
  }

  return vorkommnisse;
}
