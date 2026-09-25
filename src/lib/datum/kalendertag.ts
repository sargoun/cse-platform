/**
 * Rechnen auf dem KALENDERTAG — `JJJJ-MM-TT` hinein, `JJJJ-MM-TT` heraus.
 *
 * Diese Funktionen rechnen bewusst in UTC-Mitternacht und nicht in Berliner
 * Ortszeit: ein Kalendertag ist hier eine **Beschriftung**, kein Zeitpunkt.
 * „Der Montag dieser Woche" und „sieben Tage später" sind Aussagen über den
 * Kalender, und der Kalender kennt keine Sommerzeit — `2026-03-29` bleibt
 * `2026-03-29`, auch wenn der Tag nur 23 Stunden hat.
 *
 * **Der Zeitpunkt entsteht anderswo.** Wo aus einem solchen Tag ein Instant
 * werden muss, tut das die Datenbank mit `at time zone 'Europe/Berlin'`
 * (Invariante 2, §7.2) — nie diese Datei, und nie der Node-Prozess mit seiner
 * eigenen Zonendatenbank. Genau deshalb steht hier `T00:00:00Z` und nicht
 * `new Date(datum)`: der zweite Ausdruck liest je nach `TZ` einen anderen
 * Tag, und der Fehler zeigt sich als eine um einen Tag verschobene Woche.
 *
 * Sie standen vorher viermal im Baum — im Dienstplan, im Generator, im Seed
 * und in der Zeitliste. Vier gleiche Umsetzungen sind drei zu viel: eine
 * davon rechnet irgendwann den Sonntag als Wochenanfang, und der Unterschied
 * fällt erst auf, wenn zwei Bildschirme verschiedene Wochen zeigen.
 */

/** Der Montag der Woche, in der `datum` liegt. */
export function montag(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  // Mo = 0 … So = 6. `getUTCDay()` zählt ab Sonntag; die Verschiebung um 6
  // und der Rest von 7 drehen das auf die deutsche Woche.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Ist `wert` ein Kalendertag `JJJJ-MM-TT`, den es gibt (V-217)?
 *
 * Das Muster allein lässt den 31. Februar durch; die Datenbank antwortet
 * darauf mit `22008`, und eine Route, die nur das Muster prüft, zeigt dem
 * Menschen einen Fehler 500 statt eines Satzes am Formular. Geprüft wird
 * über die Rundreise durch UTC-Mitternacht: ein Tag, den es nicht gibt,
 * kommt als ein anderer zurück.
 */
export function istGueltigerKalendertag(wert: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(wert)) return false;
  const t = Date.parse(`${wert}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === wert;
}

/** `datum` plus `tage` Kalendertage — negative Werte gehen zurück. */
export function tagePlus(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Der erste und der letzte Tag des Monats, in dem `datum` liegt. */
export function monatsgrenzen(datum: string): { von: string; bis: string } {
  const d = new Date(`${datum}T00:00:00Z`);
  const von = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  // Tag 0 des Folgemonats ist der letzte des laufenden — auch im Februar.
  const bis = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { von: von.toISOString().slice(0, 10), bis: bis.toISOString().slice(0, 10) };
}

/**
 * Der Erste des Monats, in dem `datum` liegt — ein Monat heisst hier wie sein
 * erster Tag.
 *
 * Das ist keine Formatierungslaune: `zeiteintrag_monatsanteil.monat` und
 * `stundenkonto` benennen den Monat genau so, und eine zweite Schreibweise in
 * der Oberfläche müsste an jeder Grenze übersetzt werden.
 */
export function monatsErster(datum: string): string {
  return `${datum.slice(0, 7)}-01`;
}

/** `monat` um `um` Monate verschoben — negative Werte gehen zurück. */
export function monatVerschieben(monat: string, um: number): string {
  const jahr = Number(monat.slice(0, 4));
  const m = Number(monat.slice(5, 7));
  const gesamt = jahr * 12 + (m - 1) + um;
  const neuJahr = Math.floor(gesamt / 12);
  const neuMonat = (gesamt % 12) + 1;
  return `${String(neuJahr).padStart(4, '0')}-${String(neuMonat).padStart(2, '0')}-01`;
}

export const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

/**
 * `2026-09-01` → `September 2026`.
 *
 * Ohne `to_char(…, 'TM')`: dessen Ausgabe hängt an `lc_time` der Verbindung,
 * und die ist auf einem englischen Container `C`. Der Monatsname stünde dann
 * je nach Server anders auf demselben Bildschirm.
 */
export function monatsName(monat: string): string {
  const m = Number(monat.slice(5, 7));
  return `${MONATSNAMEN[m - 1] ?? monat.slice(5, 7)} ${monat.slice(0, 4)}`;
}

/**
 * Ein Kalendertag `JJJJ-MM-TT` als `TT.MM.JJJJ` — die Hausschreibweise.
 *
 * **Eine Zeichenkettenumformung, absichtlich ohne `Date`.** Ein
 * `new Date('2026-09-18').toLocaleDateString('de-DE')` liest den Tag als
 * UTC-Mitternacht und formatiert ihn in der Zone des Prozesses; westlich von
 * Greenwich steht dann der Vortag auf dem Bildschirm. Ein Kalendertag ist hier
 * eine Beschriftung (siehe Kopf), und eine Beschriftung wird umgeschrieben,
 * nicht umgerechnet.
 *
 * Alles, was nicht wie ein Kalendertag aussieht, kommt unverändert zurück:
 * ein Datum, das die Datenbank in einer anderen Form liefert, soll sichtbar
 * bleiben und nicht als `undefined.undefined.` erscheinen.
 */
export function tagDeutsch(datum: string | null | undefined): string {
  if (typeof datum !== 'string') return '';
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(datum.slice(0, 10));
  if (treffer === null) return datum;
  return `${treffer[3] ?? ''}.${treffer[2] ?? ''}.${treffer[1] ?? ''}`;
}

/**
 * Britisches Englisch, mittlere Länge („29 Mar 2026") — dieselbe Form, die
 * ein Zeitpunkt mit `dateStyle: 'medium'` bekommt, damit Tag und Zeitpunkt
 * auf einem Blatt gleich aussehen. Gerechnet in UTC hin UND zurück: ein
 * Kalendertag als UTC-Mitternacht, formatiert in UTC, ist derselbe Tag in
 * jeder Zone des Prozesses.
 */
const EN_TAG = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/**
 * Ein Kalendertag in der Sprache der Seite (V-240): deutsch `TT.MM.JJJJ`,
 * englisch „29 Mar 2026" — weder das amerikanische Monat-Tag noch der
 * deutsche Punkt. Was nicht wie ein Kalendertag aussieht, kommt unverändert
 * zurück, wie bei `tagDeutsch`.
 */
export function tagInSprache(
  datum: string | null | undefined, sprache: string | null | undefined,
): string {
  if (sprache !== 'en') return tagDeutsch(datum);
  if (typeof datum !== 'string') return '';
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(datum.slice(0, 10));
  if (treffer === null) return datum;
  const t = Date.UTC(Number(treffer[1]), Number(treffer[2]) - 1, Number(treffer[3]));
  const d = new Date(t);
  if (Number.isNaN(t) || d.toISOString().slice(0, 10) !== datum.slice(0, 10)) return datum;
  return EN_TAG.format(d);
}
