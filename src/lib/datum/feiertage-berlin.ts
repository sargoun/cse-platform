/**
 * Berliner Feiertage — gerechnet, nicht abgeschrieben (CLN-03, §5.1, §8.5).
 *
 * **Warum gerechnet.** Eine getippte Liste stimmt genau so lange, wie jemand
 * sie pflegt. Ein vergessenes Jahr heisst danach: der Generator legt am
 * 3. Oktober eine Reinigung an, die nicht stattfinden darf, oder er laesst am
 * 25. Dezember eine ausfallen, die vertraglich geschuldet ist. Beides faellt
 * erst auf, wenn jemand vor der Tuer steht oder eben nicht. Die beweglichen
 * Feste haengen alle am Ostersonntag, und der ist rechenbar.
 *
 * **Warum die Datei nichts speichert.** Sie ist die Quelle, aus der
 * `job:feiertage_pflegen` die Tabelle `feiertag` fuellt und aus der der Seed
 * seine Zeilen nimmt (§5.1, §8.5). Sie liegt deshalb unter `src/lib/**` und
 * nicht unter `src/server/**`: Dienst, Job und Seed importieren sie alle drei,
 * und aus `src/lib/**` heraus zeigt kein Pfeil zurueck in den Server (§23).
 * Genau darum steht die Osterrechnung hier ein einziges Mal statt zweimal.
 *
 * **Ein Feiertag ist ein Tag, kein Zeitpunkt.** Deshalb `datum` als
 * `JJJJ-MM-TT` und nirgends ein `Date`: wer den 3. Oktober als Instant fuehrt,
 * hat ihn in einer Zeitzone, und dann ist er in UTC am 2. Oktober um 22:00 zu
 * Ende. `feiertag.datum` ist aus demselben Grund `date` und nicht
 * `timestamptz` (K-11, §5.1). Die Umrechnung eines Kalendertags in Instants
 * macht die Zeitrechnung des Servers, nicht dieser Kalender.
 *
 * **Was Berlin von den anderen Laendern unterscheidet.** Der Internationale
 * Frauentag am 8. Maerz ist hier seit 2019 gesetzlicher Feiertag — das Jahr
 * steht deshalb im Code und nicht in einer Fussnote. Fronleichnam gilt in
 * Berlin nicht, Reformationstag ebenfalls nicht, Ostersonntag und
 * Pfingstsonntag sind hier keine gesetzlichen Feiertage (in Brandenburg
 * dagegen schon). Eine Liste, die diese vier mitfuehrt, sperrt vier Arbeitstage
 * im Jahr, an denen gearbeitet wird. Ob die Gruppe ueberhaupt ausserhalb
 * Berlins arbeitet, ist offen; bis dahin rechnet dieses Modul Berlin und sagt
 * das im Namen.
 *
 * **Der 31. Oktober 2017 ist enthalten, und zwar nur er.** Er war zum
 * 500. Reformationsjubilaeum einmalig in allen Laendern gesetzlicher Feiertag.
 * Ihn wegzulassen waere keine Vorsicht, sondern eine falsche Aussage ueber
 * einen vergangenen Kalendertag — und ein Bericht, der einen Einsatz an diesem
 * Tag als normalen Werktag ausweist, ist schlicht falsch. Die Bedingung ist
 * eine Gleichheit auf das Jahr, keine Spanne: so kann der Tag nicht nach 2018
 * durchsickern. Dasselbe gilt fuer den 8. Mai 2020 und 2025, die Berlin
 * einmalig zum Jahrestag der Befreiung zum Feiertag gemacht hat. Die drei
 * stehen als aufgezaehlte Einzeltage in `EINMALIG` — nachpruefbar Zeile fuer
 * Zeile, nicht als Regel, die weiterrechnet.
 *
 * **Zukunft ist Rechnung, nicht Zusage.** Ein Jahr wird nach dem HEUTE
 * geltenden Recht berechnet; Feiertagsrecht aendert sich (2019 hat es das
 * getan). Deshalb schreibt der Job ein bereits materialisiertes Jahr nicht
 * still um, sondern meldet die Abweichung (§5.1).
 *
 * // TODO(client): O-167 — Welche Quelle gilt als verbindliche Feiertagsliste, und
 * // werden Heiligabend und Silvester im Betrieb wie Feiertage behandelt?
 */

/** `feiertag.bundesland` fuer jede hier berechnete Zeile (§5.1: `char(2)`). */
export const BUNDESLAND_BERLIN = 'BE';

export interface Feiertag {
  /** Kalendertag `JJJJ-MM-TT` — Berliner Wanduhr, kein Instant (K-11). */
  readonly datum: string;
  readonly bezeichnung: string;
  /**
   * `false` fuer Heiligabend und Silvester. §5.1 fuehrt sie mit
   * `gesetzlich = false` und laesst ihre BEHANDLUNG ausdruecklich offen —
   * dieses Modul haelt das Faktum fest und trifft keine Aussage darueber, ob
   * an ihnen gearbeitet wird.
   */
  readonly gesetzlich: boolean;
  /** `feiertag.quelle` (§5.1). Hier immer berechnet, nie importiert. */
  readonly quelle: 'berechnet';
}

export class FeiertagFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeiertagFehler';
  }
}

/**
 * Vor 1990 gibt dieses Modul keine Auskunft.
 *
 * Der Tag der Deutschen Einheit besteht seit dem Einigungsvertrag; eine Liste
 * fuer 1989, die den 3. Oktober enthaelt, waere falsch, und das
 * Feiertagsrecht des geteilten Berlin ist nicht Sache dieses Kalenders. Ein
 * lauter Fehler ist an dieser Stelle mehr wert als eine plausible Liste.
 */
const JAHR_MIN = 1990;

/** Der anonyme gregorianische Algorithmus ist bis 4099 angegeben. */
const JAHR_MAX = 4099;

/** Seit 2019 gesetzlicher Feiertag in Berlin — das Jahr ist Teil der Regel. */
const FRAUENTAG_AB = 2019;

interface Kalendertag {
  readonly jahr: number;
  readonly monat: number;
  readonly tag: number;
}

interface FesterTag {
  readonly monat: number;
  readonly tag: number;
  readonly bezeichnung: string;
  readonly gesetzlich: boolean;
  /** Erst ab diesem Jahr gesetzlich. Nur der Frauentag hat das noetig. */
  readonly abJahr?: number;
}

const FESTE_TAGE: readonly FesterTag[] = [
  { monat: 1, tag: 1, bezeichnung: 'Neujahr', gesetzlich: true },
  {
    monat: 3,
    tag: 8,
    bezeichnung: 'Internationaler Frauentag',
    gesetzlich: true,
    abJahr: FRAUENTAG_AB,
  },
  { monat: 5, tag: 1, bezeichnung: 'Tag der Arbeit', gesetzlich: true },
  { monat: 10, tag: 3, bezeichnung: 'Tag der Deutschen Einheit', gesetzlich: true },
  { monat: 12, tag: 25, bezeichnung: '1. Weihnachtstag', gesetzlich: true },
  { monat: 12, tag: 26, bezeichnung: '2. Weihnachtstag', gesetzlich: true },
  // Kein gesetzlicher Feiertag, aber ein Tag, an dem die Disposition anders
  // aussieht. §5.1 will ihn als Zeile mit `gesetzlich = false`; was daraus
  // folgt, entscheidet der Mandant (O-167), nicht diese Datei.
  { monat: 12, tag: 24, bezeichnung: 'Heiligabend', gesetzlich: false },
  { monat: 12, tag: 31, bezeichnung: 'Silvester', gesetzlich: false },
];

/**
 * Die beweglichen Feste, alle als Abstand zum Ostersonntag.
 *
 * Nicht dabei und das mit Absicht: Ostersonntag und Pfingstsonntag (in Berlin
 * keine gesetzlichen Feiertage, in Brandenburg schon) und Fronleichnam
 * (Ostern + 60, in Berlin kein Feiertag). Wer sie mitfuehrt, streicht
 * Arbeitstage, an denen gearbeitet wird.
 */
const BEWEGLICH: readonly { readonly versatz: number; readonly bezeichnung: string }[] = [
  { versatz: -2, bezeichnung: 'Karfreitag' },
  { versatz: 1, bezeichnung: 'Ostermontag' },
  { versatz: 39, bezeichnung: 'Christi Himmelfahrt' },
  { versatz: 50, bezeichnung: 'Pfingstmontag' },
];

/**
 * Einmalige gesetzliche Feiertage, einzeln aufgezaehlt.
 *
 * Jede Zeile nennt genau ein Datum und ist damit einzeln nachpruefbar und
 * einzeln zu streichen. Als Regel formuliert waere sie eine Behauptung ueber
 * kuenftige Jahre — und genau das sind diese Tage nicht.
 */
const EINMALIG: readonly (Kalendertag & { readonly bezeichnung: string })[] = [
  // 500 Jahre Reformation; 2017 in allen Laendern einmalig gesetzlicher Feiertag.
  { jahr: 2017, monat: 10, tag: 31, bezeichnung: 'Reformationstag' },
  // Berlin, 75. Jahrestag der Befreiung — einmalig, nur 2020.
  { jahr: 2020, monat: 5, tag: 8, bezeichnung: 'Tag der Befreiung' },
  // Berlin, 80. Jahrestag der Befreiung — einmalig, nur 2025.
  { jahr: 2025, monat: 5, tag: 8, bezeichnung: 'Tag der Befreiung' },
];

function pruefeJahr(jahr: number): void {
  if (!Number.isInteger(jahr)) {
    throw new FeiertagFehler(`Jahr ist eine Ganzzahl: ${JSON.stringify(jahr)}`);
  }
  if (jahr < JAHR_MIN || jahr > JAHR_MAX) {
    throw new FeiertagFehler(
      `Feiertage werden nur fuer ${JAHR_MIN}–${JAHR_MAX} berechnet, gefragt war ${jahr}`,
    );
  }
}

function alsText(t: Kalendertag): string {
  const p = (n: number, breite: number): string => String(n).padStart(breite, '0');
  return `${p(t.jahr, 4)}-${p(t.monat, 2)}-${p(t.tag, 2)}`;
}

/**
 * Tage addieren — reine Kalenderrechnung, keine Zeitzone.
 *
 * `Date` steht hier nur als Rechenknecht fuer den gregorianischen Kalender:
 * hinein gehen Jahr, Monat, Tag als UTC-Mitternacht, heraus werden
 * ausschliesslich die UTC-Felder gelesen. Damit ist das Ergebnis von der
 * Zeitzone des laufenden Prozesses unabhaengig — was es sein muss, denn ein
 * Kalendertag ist kein Zeitpunkt (K-11). Eine Sommerzeitgrenze kann hier
 * nichts verschieben, weil hier gar keine Uhrzeit vorkommt.
 */
function tagePlus(t: Kalendertag, tage: number): Kalendertag {
  const d = new Date(Date.UTC(t.jahr, t.monat - 1, t.tag) + tage * 86_400_000);
  return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: d.getUTCDate() };
}

/**
 * Ostersonntag nach dem anonymen gregorianischen Algorithmus (Meeus/Butcher).
 *
 * Der Anker fuer alle beweglichen Feste: Karfreitag (−2), Ostermontag (+1),
 * Christi Himmelfahrt (+39), Pfingstmontag (+50). Die Zwischengroessen tragen
 * die Buchstaben des Verfahrens, damit sie sich gegen jede Darstellung des
 * Algorithmus Zeile fuer Zeile pruefen lassen; sprechende Namen gibt es fuer
 * sie nicht, sie sind Rechenschritte der Osterformel und nichts sonst.
 */
function osterTag(jahr: number): Kalendertag {
  const a = jahr % 19;
  const b = Math.floor(jahr / 100);
  const c = jahr % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const zaehler = h + l - 7 * m + 114;
  return { jahr, monat: Math.floor(zaehler / 31), tag: (zaehler % 31) + 1 };
}

/** Ostersonntag als Kalendertag `JJJJ-MM-TT`. */
export function ostersonntag(jahr: number): string {
  pruefeJahr(jahr);
  return alsText(osterTag(jahr));
}

function feiertag(t: Kalendertag, bezeichnung: string, gesetzlich: boolean): Feiertag {
  return { datum: alsText(t), bezeichnung, gesetzlich, quelle: 'berechnet' };
}

/**
 * Zwei Feiertage auf einem Tag werden zu einer Zeile mit beiden Namen.
 *
 * Das ist kein Sonderfall fuer den Aktenschrank: faellt Ostern auf den
 * 23. Maerz, liegt Christi Himmelfahrt auf dem 1. Mai (zuletzt 2008). Die
 * Tabelle `feiertag` hat `unique (bundesland, datum)` (§5.1) — zwei Zeilen
 * liessen sich gar nicht speichern, und eine davon stillschweigend
 * wegzuwerfen naehme dem spaeteren "warum fiel dieser Einsatz aus" den halben
 * Grund.
 */
function fasseGleicheTageZusammen(sortiert: readonly Feiertag[]): readonly Feiertag[] {
  const ergebnis: Feiertag[] = [];
  for (const heute of sortiert) {
    const letzter = ergebnis[ergebnis.length - 1];
    if (letzter !== undefined && letzter.datum === heute.datum) {
      ergebnis[ergebnis.length - 1] = {
        datum: heute.datum,
        bezeichnung: `${letzter.bezeichnung} / ${heute.bezeichnung}`,
        gesetzlich: letzter.gesetzlich || heute.gesetzlich,
        quelle: 'berechnet',
      };
      continue;
    }
    ergebnis.push(heute);
  }
  return ergebnis;
}

/**
 * Alle Berliner Feiertage eines Jahres, aufsteigend nach Datum.
 *
 * Rein: gleiches Jahr, gleiches Ergebnis, ohne Uhr, ohne Datenbank, ohne
 * Prozesszeitzone. Enthalten sind auch die beiden nicht gesetzlichen Tage
 * (24.12., 31.12.) mit `gesetzlich = false`; wer nur die gesetzlichen
 * braucht, filtert danach oder fragt `istFeiertag`.
 */
export function feiertageBerlin(jahr: number): readonly Feiertag[] {
  pruefeJahr(jahr);

  const roh: Feiertag[] = [];
  for (const fest of FESTE_TAGE) {
    if (fest.abJahr !== undefined && jahr < fest.abJahr) continue;
    const tag: Kalendertag = { jahr, monat: fest.monat, tag: fest.tag };
    roh.push(feiertag(tag, fest.bezeichnung, fest.gesetzlich));
  }

  const ostern = osterTag(jahr);
  for (const beweglich of BEWEGLICH) {
    roh.push(feiertag(tagePlus(ostern, beweglich.versatz), beweglich.bezeichnung, true));
  }

  for (const einmal of EINMALIG) {
    if (einmal.jahr !== jahr) continue;
    roh.push(feiertag(einmal, einmal.bezeichnung, true));
  }

  // `sort` ist seit ES2019 stabil, und ISO-Datumstexte ordnen wie ihre Tage —
  // deshalb genuegt der Textvergleich und es braucht kein `Date` dafuer.
  roh.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
  return fasseGleicheTageZusammen(roh);
}

function liesKalendertag(datum: string): Kalendertag {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(datum.trim());
  if (treffer === null) {
    throw new FeiertagFehler(`Kein Datum in der Form JJJJ-MM-TT: ${JSON.stringify(datum)}`);
  }
  const roh: Kalendertag = {
    jahr: Number(treffer[1]),
    monat: Number(treffer[2]),
    tag: Number(treffer[3]),
  };
  /**
   * Die FORM zu pruefen genuegt nicht — `2026-02-30` hat sie.
   *
   * Die Kalenderrechnung rutscht bei einem Tag, den es nicht gibt, still auf
   * den naechsten weiter (`2026-02-30` → `2026-03-02`). Genau dieses
   * Weiterrutschen macht den Tippfehler sichtbar, wenn man das Ergebnis
   * zurueckliest und vergleicht: sonst antwortete die Funktion auf einen
   * erfundenen Tag brav "kein Feiertag", und niemand erfuehre, dass gar nicht
   * der gefragte Tag geprueft wurde. Schaltjahre sind damit mitgeprueft, ohne
   * dass die Regel dafuer hier ein zweites Mal steht.
   */
  const normalisiert = tagePlus(roh, 0);
  if (alsText(normalisiert) !== alsText(roh)) {
    throw new FeiertagFehler(`Diesen Tag gibt es nicht: ${JSON.stringify(datum)}`);
  }
  pruefeJahr(roh.jahr);
  return roh;
}

/**
 * Ist dieser Kalendertag ein GESETZLICHER Feiertag in Berlin?
 *
 * Die Frage, die der Generator stellt, bevor er eine Serie ueberspringt
 * (CLN-03, §8.2 Schritt 4). Heiligabend und Silvester ergeben deshalb
 * `false`: sie sind keine gesetzlichen Feiertage, und ein `true` hiesse, dass
 * der Generator an ihnen still einen geplanten Einsatz streicht — also die
 * offene Frage O-167 in die Richtung entscheidet, die §8.5 ausdruecklich
 * ausschliesst ("nie stillschweigend eine geplante Schicht entfernen"). Wer
 * die beiden Tage anders behandeln will, findet sie in `feiertageBerlin`.
 *
 * Wirft bei einem Datum, das es nicht gibt — ein stilles `false` waere hier
 * die falsche Antwort auf eine falsche Frage.
 */
export function istFeiertag(datum: string): boolean {
  const tag = liesKalendertag(datum);
  const text = alsText(tag);
  return feiertageBerlin(tag.jahr).some((f) => f.datum === text && f.gesetzlich);
}
