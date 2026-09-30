import { eigenerEintrag } from '@/lib/nachschlagen';
import { istGueltigerKalendertag, tagePlus } from '@/lib/datum/kalendertag';
import { TURNUS_ANLAGE_TEXTE, TURNUS_LISTE_TEXTE } from '@/lib/i18n/verwaltung/reinigung';
import { SerieEingabeFehlt } from '@/server/services/dienstplan/serie';

/**
 * Was die zwei Turnusseiten aus ihrer ADRESSE machen — nie etwas, das dort
 * roh stand (V-275, D-773, D-769, D-728).
 *
 * **Der Befund.** Die Serienliste zeigte `?uebersprungen=` als Wort
 * („Übersprungen: objekt_ohne_kunde"), und jeder Text aus einem präparierten
 * Link stand dort genauso. Die Vorschau auf `/turnus/neu` zeigte die Meldung
 * des Dienstes: bei `?wochentag=<Text>` „„<Text>" ist kein Wochentag", bei
 * `?gueltig_ab=<Text>` einen Satz mit Feldnamen des Quelltexts und dem Text —
 * und ein `?gueltig_ab=` aus Buchstaben brachte die Seite zum Absturz, weil
 * das Vorschaufenster aus ihm gerechnet wurde.
 *
 * Diese Datei liegt neben den Seiten und nicht in ihnen, damit ihre Antworten
 * sich ohne Datenbank prüfen lassen (`tests/kern/rueckweg-turnus-adresse.test.ts`).
 */

type Suche = Readonly<Record<string, string | string[] | undefined>>;

/** Was die Serienliste nach einem neuen Turnus meldet — jede Angabe geprüft. */
export interface AnlageRueckmeldung {
  readonly bestandSchon: boolean;
  /** Die Zahl der geschriebenen Schichten — nur als Ziffernfolge, sonst `null`. */
  readonly erzeugt: number | null;
  /** Der SATZ zum übersprungenen Grund — `null`, wenn nichts übersprungen wurde. */
  readonly uebersprungen: string | null;
}

/**
 * `?angelegt=1&erzeugt=<n>[&bestand=1][&uebersprungen=<grund>]` →
 * Rückmeldung, oder `null`, wenn nichts angelegt wurde. Der Grund wird nur
 * als eigener Eintrag nachgeschlagen; ein unbekanntes Wort ergibt den
 * allgemeinen Satz, nie sich selbst.
 */
export function anlageRueckmeldung(suche: Suche): AnlageRueckmeldung | null {
  const einzeln = (k: string): string | null => {
    const w = suche[k];
    return typeof w === 'string' && w !== '' ? w : null;
  };
  if (einzeln('angelegt') === null) return null;
  const t = TURNUS_LISTE_TEXTE.de;
  const erzeugtRoh = einzeln('erzeugt');
  const grund = einzeln('uebersprungen');
  return {
    bestandSchon: einzeln('bestand') === '1',
    erzeugt: erzeugtRoh !== null && /^\d{1,6}$/u.test(erzeugtRoh) ? Number(erzeugtRoh) : null,
    uebersprungen: grund === null ? null : (eigenerEintrag(t.gruende, grund) ?? t.sonst),
  };
}

/**
 * Der Satz zu einer abgewiesenen Regel oder Vorschau — nach dem GRUND, nie
 * die Meldung des Dienstes. `SerieEingabeFehlt` trägt ihn (V-275); jeder
 * andere Fehler der Vorschau (eine Angabe der Adresse, die nicht passt)
 * bekommt den allgemeinen Satz.
 */
export function vorschauFehlerSatz(fehler: unknown): string {
  const t = TURNUS_ANLAGE_TEXTE.de;
  if (fehler instanceof SerieEingabeFehlt) {
    return eigenerEintrag(t.fehler, fehler.grund) ?? t.vorschauSonst;
  }
  return t.vorschauSonst;
}

/**
 * Das Fenster der Vorschau: ab „Gültig ab", wenn das ein Tag in der Zukunft
 * ist, sonst ab heute. Aus einem `?gueltig_ab=`, das kein Kalendertag ist,
 * wird kein Fenster gerechnet — `tagePlus` warf daran, und die Seite war
 * eine Fehlerseite. Die Vorschau selbst weist die Angabe dann ab.
 */
export function vorschauFenster(
  gueltigAb: string, heute: string, tage: number,
): { readonly vonDatum: string; readonly bisDatum: string } {
  /*
   * Das Fenster muss selbst noch aus Kalendertagen bestehen: ab dem
   * 9999-12-04 (bei 28 Tagen) läge sein Ende jenseits von 9999-12-31, und
   * `tagePlus` lieferte „+010000-…“ — die Vorschau warf (Review V-275). Ein
   * solcher Beginn gilt wie ein ungültiger: das Fenster beginnt heute.
   */
  const spaetesterBeginn = tagePlus('9999-12-31', -tage);
  const von = istGueltigerKalendertag(gueltigAb) && gueltigAb > heute && gueltigAb <= spaetesterBeginn
    ? gueltigAb : heute;
  return { vonDatum: von, bisDatum: tagePlus(von, tage) };
}
