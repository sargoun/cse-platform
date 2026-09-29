/**
 * Ein ZEITPUNKT in der Sprache der Seite — immer Berliner Ortszeit, immer
 * 24-Stunden-Uhr, nie das amerikanische Monat-Tag (SEITENKARTE §12, V-201).
 *
 * **Der Befund.** Die Blätter des Arbeiterportals formatierten Zeitpunkte mit
 * `new Intl.DateTimeFormat(basis.sprache, …)`. Die Sprache wählt in Intl
 * nicht nur Wörter, sondern die Uhr und die Reihenfolge: Arabisch schrieb
 * „11‏/09‏/2026، 10:30 م" (12-Stunden-Uhr), Englisch (`en` ist `en-US`)
 * „Sep 11, 2026, 10:30 PM" und das Datum allein „09/11/2026" — in Europa der
 * 9. November —, Türkisch „11 Eyl 2026 22:30". Daneben stand derselbe Tag über
 * `tagInSprache` als „11.09.2026". Die Seitenkarte sagt: Zahlen, Geld und
 * Zeit lokalisieren nie weg von der gesetzlichen Form.
 *
 * **Die Regel ist die von `tagInSprache`** (V-199, V-210, D-733): Deutsch,
 * Arabisch und Türkisch `TT.MM.JJJJ HH:MM` — die Form der MiLoG-Aufzeichnung
 * und der Zeitenliste, die die Browserprüfung „Zahlen, Geld und Zeit bleiben
 * in der gesetzlichen Form" misst —, Englisch britisch „11 Sept 2026, 22:30"
 * wie `fristInWorten(…, 'en')`. Die Ziffern sind lateinisch in jeder Sprache.
 *
 * **Gerechnet wird in Europe/Berlin, nie in der Zone des Prozesses**
 * (Invariante 2): der Zeitpunkt ist ein UTC-Instant, und was der Mensch
 * liest, ist die Berliner Wanduhr — auch in den Nächten der Zeitumstellung.
 */

const BERLIN = 'Europe/Berlin';

/** Die Teile der Berliner Wanduhr, lateinische Ziffern, 24-Stunden-Uhr. */
const TEILE = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  numberingSystem: 'latn',
});

/** Britisches Englisch, mittlere Länge, 24-Stunden-Uhr — wie `fristInWorten`. */
const EN_ZEITPUNKT = new Intl.DateTimeFormat('en-GB', {
  timeZone: BERLIN, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
});

/** Der Berliner KALENDERTAG eines Zeitpunkts, englisch („11 Sept 2026"). */
const EN_TAG = new Intl.DateTimeFormat('en-GB', { timeZone: BERLIN, dateStyle: 'medium' });

function alsDatum(wert: Date | string | null | undefined): Date | null {
  if (wert === null || wert === undefined) return null;
  const d = wert instanceof Date ? wert : new Date(wert);
  return Number.isNaN(d.getTime()) ? null : d;
}

function teile(d: Date): Readonly<Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>> {
  const t: Record<string, string> = {};
  for (const p of TEILE.formatToParts(d)) {
    if (p.type !== 'literal') t[p.type] = p.value;
  }
  return {
    year: t['year'] ?? '', month: t['month'] ?? '', day: t['day'] ?? '',
    hour: t['hour'] ?? '', minute: t['minute'] ?? '',
  };
}

/**
 * Ein Zeitpunkt als `TT.MM.JJJJ HH:MM` (de, ar, tr) bzw. „11 Sept 2026, 22:30"
 * (en), in Berliner Ortszeit. Ein leerer Wert ergibt `''`; eine Zeichenkette,
 * die kein Zeitpunkt ist, kommt unverändert zurück — sichtbar statt
 * „Invalid Date".
 */
export function zeitpunktInSprache(
  wert: Date | string | null | undefined, sprache: string | null | undefined,
): string {
  const d = alsDatum(wert);
  if (d === null) return typeof wert === 'string' ? wert : '';
  if (sprache === 'en') return EN_ZEITPUNKT.format(d);
  const t = teile(d);
  return `${t.day}.${t.month}.${t.year} ${t.hour}:${t.minute}`;
}

/**
 * Der Berliner Kalendertag eines Zeitpunkts, ohne Uhrzeit — `TT.MM.JJJJ`
 * (de, ar, tr) bzw. „11 Sept 2026" (en), dieselbe Form wie `tagInSprache`.
 * Für ein Eingangs- oder Entscheidungsdatum, das als Zeitpunkt gespeichert
 * ist: 23:30 Uhr UTC am 10. ist in Berlin schon der 11.
 */
export function tagVonZeitpunktInSprache(
  wert: Date | string | null | undefined, sprache: string | null | undefined,
): string {
  const d = alsDatum(wert);
  if (d === null) return typeof wert === 'string' ? wert : '';
  if (sprache === 'en') return EN_TAG.format(d);
  const t = teile(d);
  return `${t.day}.${t.month}.${t.year}`;
}
