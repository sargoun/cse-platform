/**
 * Werktage im Berliner Kalender — `JJJJ-MM-TT` hinein, `JJJJ-MM-TT` heraus
 * (V-307, O-112, D-839; V-287, O-735, D-841).
 *
 * **Ein Werktag ist hier Montag bis Freitag ohne gesetzlichen Feiertag in
 * Berlin** (`istFeiertag`, `feiertage-berlin.ts`). Das ist der Werktag des
 * Büros, das eine Vergabemappe zusammenstellt — nicht der des § 193 BGB, der
 * den Samstag mitzählt. Wer einen Vorlauf in Werktagen setzt, meint die Tage,
 * an denen jemand an der Mappe arbeiten kann.
 *
 * Gerechnet wird auf dem Kalendertag in UTC-Mitternacht, wie in
 * `kalendertag.ts`: ein Tag ist eine Beschriftung, kein Zeitpunkt, und die
 * Zone des Prozesses spielt keine Rolle.
 */
import { feiertageBerlin, istFeiertag } from './feiertage-berlin.js';
import { istGueltigerKalendertag, tagePlus } from './kalendertag.js';

function pruefe(tag: string): void {
  if (!istGueltigerKalendertag(tag)) throw new RangeError(`Kein Kalendertag: „${tag}"`);
}

/** Montag = 1 … Sonntag = 7 (ISO 8601). */
export function isoWochentag(tag: string): number {
  pruefe(tag);
  const sonntagNull = new Date(`${tag}T00:00:00Z`).getUTCDay();
  return sonntagNull === 0 ? 7 : sonntagNull;
}

/** Montag bis Freitag und kein gesetzlicher Feiertag in Berlin. */
export function istWerktag(tag: string): boolean {
  return isoWochentag(tag) <= 5 && !istFeiertag(tag);
}

/** Zählt `anzahl` Werktage in eine Richtung; `tag` selbst zählt nicht mit. */
function werktageSchritt(tag: string, anzahl: number, richtung: 1 | -1): string {
  pruefe(tag);
  if (!Number.isInteger(anzahl) || anzahl < 0) {
    throw new RangeError(`Keine Anzahl Werktage: ${String(anzahl)}`);
  }
  let aktuell = tag;
  let gezaehlt = 0;
  // Ein Jahr Weg reicht für jede Anzahl, die ein Vorlauf vernünftig hat.
  for (let schutz = 0; gezaehlt < anzahl; schutz += 1) {
    if (schutz > 400) throw new RangeError(`Zu viele Werktage: ${String(anzahl)}`);
    aktuell = tagePlus(aktuell, richtung);
    if (istWerktag(aktuell)) gezaehlt += 1;
  }
  return aktuell;
}

/**
 * Der Werktag, der `anzahl` Werktage VOR `tag` liegt. `tag` selbst zählt
 * nicht mit, gleich ob er ein Werktag ist: fünf Werktage vor einer Frist am
 * Donnerstag, dem 15. Oktober 2026, ist Donnerstag, der 8. Oktober.
 */
export function werktageVor(tag: string, anzahl: number): string {
  return werktageSchritt(tag, anzahl, -1);
}

/**
 * Der Werktag, der `anzahl` Werktage NACH `tag` liegt (V-287, D-841) — die
 * Frist „binnen fünf Arbeitstagen". `tag` selbst zählt nicht mit, gleich ob
 * er ein Werktag ist: fünf Werktage nach Mittwoch, dem 7. Oktober 2026, ist
 * Mittwoch, der 14. Oktober; nach einem Samstag beginnt die Zählung am
 * Montag.
 */
export function werktageNach(tag: string, anzahl: number): string {
  return werktageSchritt(tag, anzahl, 1);
}

/**
 * Die gesetzlichen Feiertage in Berlin zwischen zwei Tagen, beide
 * eingeschlossen — die Liste, die `arbeitstageZwischen` als Eingabe nimmt
 * (V-281, D-843). Heiligabend und Silvester stehen nicht darin
 * (`gesetzlich = false`, O-167).
 */
export function gesetzlicheFeiertageBerlin(von: string, bis: string): ReadonlySet<string> {
  pruefe(von);
  pruefe(bis);
  const tage = new Set<string>();
  for (let jahr = Number(von.slice(0, 4)); jahr <= Number(bis.slice(0, 4)); jahr += 1) {
    for (const f of feiertageBerlin(jahr)) {
      if (f.gesetzlich && f.datum >= von && f.datum <= bis) tage.add(f.datum);
    }
  }
  return tage;
}

/**
 * Die Arbeitstage zwischen zwei Tagen, beide eingeschlossen: Montag bis
 * Freitag ohne die Tage der Feiertagsliste (V-281, D-843).
 *
 * **Rein, mit der Liste als Eingabe.** Welches Land gilt, entscheidet, wer die
 * Liste übergibt — heute Berlin für jedes Objekt (O-167), morgen das Land am
 * Objekt, ohne dass diese Zählung sich ändert. Ein Samstag zählt nie: der
 * Werktag des § 3 BUrlG ist ein anderer als der Arbeitstag einer
 * Monatspauschale.
 */
export function arbeitstageZwischen(
  von: string, bis: string, feiertage: ReadonlySet<string>,
): number {
  pruefe(von);
  pruefe(bis);
  if (von > bis) throw new RangeError(`Der Zeitraum endet vor seinem Beginn: ${von} bis ${bis}`);
  let anzahl = 0;
  let tag = von;
  // Zehn Jahre Weg reichen für jeden Zeitraum, den eine Abrechnung hat.
  for (let schutz = 0; tag <= bis; schutz += 1) {
    if (schutz > 3700) throw new RangeError(`Zeitraum zu lang: ${von} bis ${bis}`);
    if (isoWochentag(tag) <= 5 && !feiertage.has(tag)) anzahl += 1;
    tag = tagePlus(tag, 1);
  }
  return anzahl;
}
