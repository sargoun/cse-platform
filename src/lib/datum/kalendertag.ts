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
