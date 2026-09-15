/**
 * iCalendar (RFC 5545) — genug davon, und richtig.
 *
 * **Warum von Hand und nicht mit einer Bibliothek.** Der Ausgang muss genau
 * vier Dinge können: `VEVENT` mit Beginn und Ende, ganztägige Termine,
 * Zeilenfaltung und Maskierung. Das sind sechzig Zeilen, sie sind prüfbar,
 * und sie haben keine Abhängigkeit, die in zwei Jahren eine Sicherheitslücke
 * meldet. Was hier NICHT steht — Wiederholungsregeln, Zeitzonendefinitionen,
 * Einladungen mit Antwort —, steht nicht da, weil CAL-03 einen LESENDEN Feed
 * verlangt und nichts davon dazugehört.
 *
 * **Alles in UTC** (Invariante 2). `20260915T080000Z` ist ein Instant und
 * braucht keine `VTIMEZONE`-Definition; jedes Kalenderprogramm rechnet ihn in
 * die Zone des Lesenden um. Die Alternative — lokale Zeiten mit `TZID` —
 * verlangte eine mitgelieferte Zonendefinition, die veraltet, sobald
 * Deutschland die Sommerzeit abschafft.
 */

/**
 * **Zeilen sind auf 75 Oktette begrenzt** (RFC 5545 §3.1), und ein Umbruch
 * mitten in einem Mehrbyte-Zeichen macht die Datei kaputt. Gezählt werden
 * deshalb OKTETTE, nicht Zeichen — „Baustellenbegehung Kurfürstendamm" hat
 * mehr Oktette als Zeichen, und genau daran scheitert die naive Fassung.
 */
export function falte(zeile: string): string {
  const roh = Buffer.from(zeile, 'utf8');
  if (roh.length <= 75) return zeile;

  const teile: string[] = [];
  let start = 0;
  // Erste Zeile 75 Oktette, jede Folgezeile 74 (das führende Leerzeichen zählt).
  let grenze = 75;
  while (start < roh.length) {
    let ende = Math.min(start + grenze, roh.length);
    // Nie mitten in einer UTF-8-Folge trennen: Fortsetzungsoktette sind 10xxxxxx.
    while (ende > start && ende < roh.length && (roh[ende]! & 0xc0) === 0x80) ende -= 1;
    teile.push(roh.subarray(start, ende).toString('utf8'));
    start = ende;
    grenze = 74;
  }
  return teile.join('\r\n ');
}

/**
 * Maskierung nach §3.3.11: Backslash, Semikolon, Komma und Zeilenumbruch.
 * Die Reihenfolge ist wichtig — der Backslash zuerst, sonst maskiert man die
 * eigenen Maskierungen ein zweites Mal.
 *
 * **Jedes Ersatzmuster braucht einen doppelten Backslash.** `'\;'` (ein
 * Backslash im Quelltext) ist in
 * JavaScript kein maskiertes Semikolon, sondern ein blankes: der Backslash vor
 * einem Zeichen ohne Sonderbedeutung verschwindet beim Einlesen des Literals.
 * Die Zeile sah aus wie eine Maskierung und war keine — und weil der
 * danebenstehende Test dasselbe Literal benutzte, konnte er das nie finden.
 * Ein unmaskiertes Semikolon in einem TEXT-Wert trennt für den Leser den
 * Parameterteil ab: aus einem Titel „Objektschutz; Nachtdienst" wurde ein
 * SUMMARY mit einem Parameter, den es nicht gibt.
 */
export function maskiere(wert: string): string {
  return wert
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n');
}

/** `20260915T080000Z` — ein Instant, ohne Zone, ohne Zweifel. */
export function alsUtc(zeitpunkt: Date): string {
  const z = (n: number, b = 2): string => String(n).padStart(b, '0');
  return `${z(zeitpunkt.getUTCFullYear(), 4)}${z(zeitpunkt.getUTCMonth() + 1)}`
    + `${z(zeitpunkt.getUTCDate())}T${z(zeitpunkt.getUTCHours())}`
    + `${z(zeitpunkt.getUTCMinutes())}${z(zeitpunkt.getUTCSeconds())}Z`;
}

/**
 * `20260915` — ein DATUM, kein Instant.
 *
 * **Und es ist das BERLINER Datum.** Ein ganztägiger Termin am 15. September
 * ist der 15. September in Berlin; als UTC-Datum gelesen wäre er es zwischen
 * Mitternacht und zwei Uhr nicht (Invariante 2). Wer hier `toISOString()`
 * nähme, verschöbe jeden ganztägigen Termin, der abends angelegt wurde, um
 * einen Tag — und zwar nur im Sommer.
 */
export function alsDatum(zeitpunkt: Date): string {
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(zeitpunkt);
  return teile.replace(/-/gu, '');
}

/**
 * Der Tag NACH einem `YYYYMMDD` — auf dem Datum gerechnet, nicht auf einem
 * Instant.
 *
 * **Warum nicht einfach 24 Stunden addieren.** Das exklusive DTEND eines
 * eintägigen Termins entstand vorher so: 24 Stunden auf den End-Instant, dann
 * in Berlin formatieren. In der Nacht zur Winterzeit hat der Berliner Tag 25
 * Stunden — aus dem 25. Oktober wurde wieder der 25. Oktober, also ein
 * ganztägiger Termin ohne Dauer, den kein Kalenderprogramm zeichnet. In der
 * Nacht zur Sommerzeit hätte derselbe Fehler zwei Tage ergeben. Ein Datum
 * kennt keine Sommerzeit; deshalb wird hier auf dem Datum gerechnet.
 */
export function datumPlusTag(jjjjmmtt: string): string {
  const jahr = Number(jjjjmmtt.slice(0, 4));
  const monat = Number(jjjjmmtt.slice(4, 6));
  const tag = Number(jjjjmmtt.slice(6, 8));
  const d = new Date(Date.UTC(jahr, monat - 1, tag + 1));
  const z = (n: number, b = 2): string => String(n).padStart(b, '0');
  return `${z(d.getUTCFullYear(), 4)}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}`;
}

export interface Termin {
  /** Stabil über Änderungen hinweg — ein Kalender erkennt daran die Fortschreibung. */
  readonly uid: string;
  readonly titel: string;
  readonly beginn: Date;
  readonly ende: Date;
  readonly ganztaegig: boolean;
  readonly beschreibung?: string | null;
  readonly ort?: string | null;
  readonly abgesagt?: boolean;
  /** Wann die Zeile zuletzt geändert wurde — `LAST-MODIFIED`. */
  readonly geaendert?: Date | null;
}

export interface KalenderKopf {
  readonly name: string;
  /** Der Zeitpunkt, den `DTSTAMP` trägt — vom Aufrufer, nie aus `new Date()`. */
  readonly jetzt: Date;
}

function eintrag(t: Termin, jetzt: Date): readonly string[] {
  const zeilen: string[] = ['BEGIN:VEVENT', `UID:${t.uid}`, `DTSTAMP:${alsUtc(jetzt)}`];

  if (t.ganztaegig) {
    /*
     * **DTEND ist bei ganztaegigen Terminen EXKLUSIV** (RFC 5545 §3.6.1):
     * ein eintaegiger Termin am 15. hat DTEND 16. Ohne diesen Tag zeigen
     * Kalenderprogramme einen Termin ohne Dauer -- oder gar keinen.
     */
    const beginnTag = alsDatum(t.beginn);
    const endeTag = alsDatum(t.ende);
    zeilen.push(`DTSTART;VALUE=DATE:${beginnTag}`);
    /*
     * `kalender_eintrag.ende` IST bei ganztaegigen Zeilen schon das exklusive
     * Ende (Migration 0160) -- dann steht es hier unveraendert. Die Fristen
     * aus den anderen fuenf Quellen tragen denselben Zeitpunkt zweimal; fuer
     * sie wird der Folgetag auf dem DATUM gerechnet.
     */
    zeilen.push(`DTEND;VALUE=DATE:${
      endeTag === beginnTag ? datumPlusTag(beginnTag) : endeTag}`);
  } else {
    zeilen.push(`DTSTART:${alsUtc(t.beginn)}`);
    zeilen.push(`DTEND:${alsUtc(t.ende)}`);
  }

  zeilen.push(`SUMMARY:${maskiere(t.titel)}`);
  if (t.beschreibung !== undefined && t.beschreibung !== null && t.beschreibung !== '') {
    zeilen.push(`DESCRIPTION:${maskiere(t.beschreibung)}`);
  }
  if (t.ort !== undefined && t.ort !== null && t.ort !== '') {
    zeilen.push(`LOCATION:${maskiere(t.ort)}`);
  }
  /*
   * **Ein abgesagter Termin wird MITGESCHICKT, nicht weggelassen.** Wer ihn
   * schon im Kalender hat, bekommt ihn sonst nie wieder los: ein Feed ohne
   * die Zeile heisst „unveraendert", nicht „abgesagt" (§3.8.1.11).
   */
  zeilen.push(`STATUS:${t.abgesagt === true ? 'CANCELLED' : 'CONFIRMED'}`);
  if (t.geaendert !== undefined && t.geaendert !== null) {
    zeilen.push(`LAST-MODIFIED:${alsUtc(t.geaendert)}`);
  }
  zeilen.push('END:VEVENT');
  return zeilen;
}

/**
 * Die Zonendefinition — **und der Grund, warum sie immer mitgeht**.
 *
 * RFC 5545 §3.4 verlangt in einem VCALENDAR mindestens EINE Komponente
 * (`component = 1*(eventc / todoc / … / timezonec / …)`). Ein Kalender ohne
 * Termine ist aber ein voellig normaler Zustand — ein neuer Zugang, ein
 * Zeitraum ohne Eintraege —, und eine Datei aus lauter Kopfzeilen weisen
 * strenge Leser als fehlerhaft ab. Eine VTIMEZONE ist eine Komponente, ist
 * hier ohnehin wahr und macht die Datei in jedem Fall gueltig.
 *
 * Die Regeln sind die der EU seit 1996 und stehen fest im Text: sie gelten
 * ohne Enddatum weiter, und ein Kalenderprogramm rechnet mit ihnen selbst.
 * Wuerde die Union die Umstellung abschaffen, gehoerte hier ein neues
 * `TZNAME`-Paar mit `RDATE` hin — keine Zeile, die sich von selbst aendert.
 */
const ZONE: readonly string[] = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

/**
 * Der ganze Kalender als Text — mit CRLF, wie RFC 5545 es verlangt.
 *
 * `PRODID` nennt die erzeugende Anwendung; ohne ihn weisen manche
 * Kalenderprogramme die Datei ab.
 *
 * **Kein `METHOD`.** Es stand hier, damit Outlook nicht nach einer Zusage
 * fragt — und bewirkt das Gegenteil: `METHOD` macht aus der Datei ein
 * iTIP-Objekt (RFC 5546), und fuer ein solches ist `ORGANIZER` in jedem
 * VEVENT Pflicht (§3.2.1). Keiner unserer Termine hat einen — eine Schicht
 * hat einen Dienstplan, keinen Einladenden. Ausserdem verlangt §8.1, dass die
 * Kopfzeile dieselbe Methode traegt (`text/calendar; method=PUBLISH`), was die
 * Route nicht tat. Ein ABONNEMENT braucht kein METHOD: der Leser holt die
 * Datei, er hat keine Einladung bekommen.
 */
export function alsIcal(kopf: KalenderKopf, termine: readonly Termin[]): string {
  const zeilen = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CSE Gruppe//Plattform//DE',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${maskiere(kopf.name)}`,
    'X-WR-TIMEZONE:Europe/Berlin',
    ...ZONE,
    ...termine.flatMap((t) => eintrag(t, kopf.jetzt)),
    'END:VCALENDAR',
  ];
  return `${zeilen.map(falte).join('\r\n')}\r\n`;
}
