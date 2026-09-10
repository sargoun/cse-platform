/**
 * Wann deckt ein Nachweis eine Schicht? (SEC-02, SEC-04, LEG-04)
 *
 * Rein, ohne Datenbank, ohne Uhr — damit sich die eine Regel pruefen laesst,
 * an der SEC-04 haengt: **die Gueltigkeit wird zum SCHICHTDATUM bewertet, nie
 * zu `now()`.**
 *
 * Der naheliegende Entwurf waere still falsch gewesen. `gueltig_bis >=
 * heute` liest sich richtig und ist es fuer die Planung auch — aber angewandt
 * auf eine VERGANGENE Schicht erklaert es sie rueckwirkend fuer unzulaessig:
 * ein Nachweis, der am 3. Maerz galt und am 4. Maerz ablief, hat die
 * Nachtschicht vom 3. gedeckt, und wer im Juni dagegen prueft, findet in der
 * eigenen Datenbank keinen Beleg mehr dafuer, dass der Einsatz erlaubt war.
 * Deshalb nimmt jede Funktion hier den Stichtag als ARGUMENT; es gibt keinen
 * Vorgabewert „heute".
 *
 * Der Stichtag ist der **Berliner** Kalendertag des Schichtbeginns (K-11).
 * `(beginn_zeitpunkt)::date` waere der UTC-Tag und laege bei jeder
 * Nachtschicht zwischen 22:00 und 24:00 Ortszeit um einen Tag daneben — in der
 * Sommerzeit sogar zwischen 22:00 und 02:00.
 */
import { berlinKalendertag } from '../zeit/dauer.js';

/** Das Statusvokabular aus `01-KERN.md` §4, unveraendert uebernommen. */
export type NachweisStatus =
  | 'beantragt' | 'gueltig' | 'abgelaufen' | 'widerrufen' | 'abgelehnt';

/**
 * Die Tatsachen eines Nachweises, so wie die Datenbank sie haelt.
 *
 * `gueltigAb` und `gueltigBis` sind ISO-Kalendertage (`YYYY-MM-DD`), keine
 * Zeitpunkte: ein Gueltigkeitsdatum steht so auf dem Dokument, und es als
 * Instant zu fuehren hiesse, es um Mitternacht UTC beginnen zu lassen — also
 * um 01:00 beziehungsweise 02:00 Berliner Zeit.
 */
export interface NachweisTatsache {
  readonly qualifikationId: string;
  readonly gueltigAb: string;
  /** `null` = unbefristet. */
  readonly gueltigBis: string | null;
  readonly status: NachweisStatus;
  readonly widerrufenAm: string | null;
}

/** Der Berliner Kalendertag, gegen den eine Schicht geprueft wird (K-11). */
export function stichtagVon(einsatzBeginnUtc: Date): string {
  return berlinKalendertag(einsatzBeginnUtc);
}

/**
 * Deckt dieser Nachweis den genannten Tag?
 *
 * Dieselbe Bedingung, die `app.einsatz_qualifikation_erfuellt` in SQL traegt.
 * Zwei Formulierungen einer Regel sind zwei Regeln, sobald eine davon
 * gepflegt wird — die Datenbankfassung ist die durchsetzende (sie feuert auch
 * bei Backfill und Konsole), diese hier die erklaerende und die, gegen die
 * sich die Zeitfaelle ohne Postgres pruefen lassen. Der Isolationstest haelt
 * beide aneinander.
 */
export function decktStichtag(n: NachweisTatsache, stichtag: string): boolean {
  if (n.widerrufenAm !== null) return false;
  // Das Literal `'gueltig'` ist Teil des Vertrags (01-KERN §4): ein
  // umbenannter Wert machte aus dem Tor eine universelle Sperre.
  if (n.status !== 'gueltig') return false;
  if (n.gueltigAb > stichtag) return false;
  return n.gueltigBis === null || n.gueltigBis >= stichtag;
}

/**
 * Wie viele Tage liegen zwischen zwei Kalendertagen?
 *
 * Ueber `Date.UTC` und nicht ueber die Ortszeit: die beiden Argumente sind
 * KALENDERTAGE, keine Zeitpunkte, und eine Differenz zweier Ortszeit-
 * Mitternachte ist in der Umstellungswoche 23 oder 25 Stunden lang — was
 * `Math.round` dann zu 0 oder 2 Tagen macht. Auf der UTC-Achse gerechnet ist
 * ein Kalendertag immer 24 Stunden, und genau das ist hier gemeint.
 */
export function tageZwischen(vonTag: string, bisTag: string): number {
  const alsUtc = (tag: string): number => {
    const teile = tag.split('-').map(Number);
    const [jahr, monat, t] = teile;
    if (jahr === undefined || monat === undefined || t === undefined
        || Number.isNaN(jahr) || Number.isNaN(monat) || Number.isNaN(t)) {
      throw new TypeError(`Kein ISO-Kalendertag: ${tag}`);
    }
    return Date.UTC(jahr, monat - 1, t);
  };
  return Math.round((alsUtc(bisTag) - alsUtc(vonTag)) / 86_400_000);
}
