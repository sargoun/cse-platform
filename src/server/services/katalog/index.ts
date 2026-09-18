/**
 * Der Leistungskatalog (OPS-06, CLN-05) — Fassungen und ihr Positionsbaum.
 *
 * **Was dieser Dienst NICHT tut: rechnen.** Er liest und schreibt Zeitwerte,
 * Leistungswerte und Standardpreise; aus welchem dieser Werte ein Preis wird,
 * entscheidet `services/kalkulation`. Ein zweiter Rechenweg neben dem
 * getesteten waere eine zweite Wahrheit ueber denselben Betrag (Invariante 6).
 *
 * **Und er erfindet keine Werte.** `leistungskatalog_position` traegt
 * `ist_platzhalter` mit Vorgabe `true`, und der CHECK `lkp_kalkulierbar`
 * verlangt zugleich MINDESTENS EINEN der drei Werte. „Keinen Wert erfinden"
 * kann hier also nicht „NULL lassen" heissen — die Datenbank laesst eine
 * Position ohne jeden Wert nicht zu. Der Weg ist derselbe wie bei der
 * Kalkulationsbestaetigung: der Wert steht da, er ist als unbestaetigt
 * GEKENNZEICHNET, und das Kennzeichen faellt nur, wenn ein Mensch es
 * ausdruecklich fuer DIESE Fassung bestaetigt.
 *
 * // TODO(client, O-731): Welche Zeitwerte (Minuten je Einheit) und welche Standardeinzelpreise gelten je Katalogposition, und wer gibt sie frei? Die Leistungswertfrage je Belagsart ist O-17; diese hier ist die Positionsseite derselben Luecke und betrifft zusaetzlich Zeitwert und Standardpreis.
 */
import { cent, parseGeld, type Cent } from '../finanz/geld.js';
import { alsNumerisch, leseZahl } from '../raumbuch/tabelle.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class KatalogFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'archiviert' | 'oz_belegt' | 'schluessel_belegt'
    | 'ohne_wert' | 'fremder_elternteil' | 'zyklus' | 'unvollstaendig'
    | 'zahl_unlesbar' | 'status_endstation' | 'zeitraum_unstimmig') {
    super(nachricht);
    this.name = 'KatalogFehler';
  }
}

/**
 * Ein Verstoss gegen GENAU DIESEN Index oder CHECK — nicht irgendeinen.
 *
 * Auf `23505` allein zu pruefen faenge auch `leistungskatalog_version_uk` und
 * jede spaetere Eindeutigkeit mit ein und uebersetzte sie in eine Aussage
 * ueber die Ordnungszahl, die nicht stimmt. Der Name steht deshalb im
 * Vergleich (dieselbe Bauart wie `istEindeutigkeitsverstoss` im
 * Angebotsdienst).
 */
function verstoss(fehler: unknown, code: string, name: string): boolean {
  if (typeof fehler !== 'object' || fehler === null) return false;
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return f.code === code && f.constraint_name === name;
}

/** Eine Meldung der Ausloeser aus 0298 und `kern.pruefe_katalog_*`. */
function meldung(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export interface KatalogZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly version: number;
  readonly status: string;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  /** Als Text, weil `count(*)` ein `bigint` ist und kein `number`. */
  readonly positionen: string;
  readonly platzhalter: string;
}

/**
 * Alle Fassungen dieser Gesellschaft, mit dem Platzhalteranteil IN der Zeile.
 *
 * Die Zahl offener Positionen gehoert nicht ins Kleingedruckte: ein Katalog,
 * dessen Preise aussehen wie entschiedene, ist hier der teuerste Fehler.
 * Sortiert nach Schluessel und dann absteigend nach Version, weil die
 * jueng­ste Fassung die interessante ist.
 */
export async function listeKataloge(db: Abfrage): Promise<readonly KatalogZeile[]> {
  return db.abfrage<KatalogZeile>(
    `select k.id, k.schluessel, k.bezeichnung, k.beschreibung, k.version,
            k.status::text as status,
            to_char(k.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab,
            to_char(k.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
            (select count(*) from leistungskatalog_position p
              where p.katalog_id = k.id)::text as positionen,
            (select count(*) from leistungskatalog_position p
              where p.katalog_id = k.id and p.ist_platzhalter)::text as platzhalter
       from leistungskatalog k
      order by k.schluessel, k.version desc`);
}

export interface PositionZeile {
  readonly id: string;
  readonly parent_id: string | null;
  readonly oz: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly einheit: string;
  readonly zeitwert_minuten: string | null;
  readonly leistungswert: string | null;
  readonly standard_einzelpreis_cent: string | null;
  readonly kostenart: string | null;
  readonly steuer_kennzeichen: string;
  readonly steuerbefreiung_grund: string | null;
  readonly ist_platzhalter: boolean;
  /** Deutsch formatiert, fuer die Anzeige. */
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
  /** ISO `YYYY-MM-DD` — was ein `<input type="date">` als Vorbelegung braucht. */
  readonly gueltig_ab_iso: string;
  readonly gueltig_bis_iso: string | null;
  readonly sortierung: number;
  /** Wie tief im Baum — vom `with recursive`, nicht in der Seite gezaehlt. */
  readonly tiefe: number;
}

export async function ladeKatalog(
  db: Abfrage, katalogId: string,
): Promise<{ kopf: KatalogZeile; positionen: readonly PositionZeile[] } | null> {
  const [kopf] = await db.abfrage<KatalogZeile>(
    `select k.id, k.schluessel, k.bezeichnung, k.beschreibung, k.version,
            k.status::text as status,
            to_char(k.gueltig_ab, 'DD.MM.YYYY') as gueltig_ab,
            to_char(k.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
            (select count(*) from leistungskatalog_position p
              where p.katalog_id = k.id)::text as positionen,
            (select count(*) from leistungskatalog_position p
              where p.katalog_id = k.id and p.ist_platzhalter)::text as platzhalter
       from leistungskatalog k where k.id = $1`, [katalogId]);
  if (kopf === undefined) return null;

  /**
   * Der Baum in der DATENBANK aufgespannt, nicht in der Seite.
   *
   * Die Alternative waere, alle Zeilen zu holen und in TypeScript zu
   * verketten. Das ist dieselbe Rekursion, nur ohne die Zyklenwache, die
   * `kern.pruefe_katalog_hierarchie` schon durchsetzt — und eine zweite
   * Fassung derselben Baumlogik ist eine zweite Stelle, an der die
   * Einrueckung falsch werden kann.
   *
   * `sortierung` und dann `oz` innerhalb jeder Ebene: `sortierung` ist die
   * gewollte Reihenfolge, `oz` die stabile Nachsortierung, wenn beide gleich
   * 0 sind (die Vorgabe der Spalte).
   */
  const positionen = await db.abfrage<PositionZeile>(
    `with recursive baum as (
       select p.*, 0 as tiefe,
              array[p.sortierung, 0]::int[] as pfad_zahl,
              array[p.oz]::text[] as pfad_text
         from leistungskatalog_position p
        where p.katalog_id = $1 and p.parent_id is null
       union all
       select p.*, b.tiefe + 1,
              b.pfad_zahl || p.sortierung,
              b.pfad_text || p.oz
         from leistungskatalog_position p
         join baum b on b.id = p.parent_id
        where p.katalog_id = $1
     )
     select id, parent_id, oz, kurztext, langtext, einheit,
            zeitwert_minuten::text,
            leistungswert_qm_pro_stunde::text as leistungswert,
            standard_einzelpreis_cent::text,
            kostenart::text as kostenart,
            steuer_kennzeichen::text as steuer_kennzeichen,
            steuerbefreiung_grund, ist_platzhalter,
            to_char(gueltig_ab, 'DD.MM.YYYY') as gueltig_ab,
            to_char(gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
            gueltig_ab::text as gueltig_ab_iso,
            gueltig_bis::text as gueltig_bis_iso,
            sortierung, tiefe
       from baum
      order by pfad_zahl, pfad_text`,
    [katalogId]);
  return { kopf, positionen };
}

/** Die Positionen einer Fassung als Auswahl fuer das Elternfeld. */
export async function listePositionsauswahl(
  db: Abfrage, katalogId: string,
): Promise<readonly { readonly id: string; readonly oz: string;
                      readonly kurztext: string }[]> {
  return db.abfrage(
    `select id, oz, kurztext from leistungskatalog_position
      where katalog_id = $1 order by sortierung, oz`, [katalogId]);
}

// ---------------------------------------------------------------------------
// Schreiben — die Fassung
// ---------------------------------------------------------------------------

export interface KatalogAnlegen {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly beschreibung?: string | null;
  readonly gueltigAb: string;
}

/**
 * Eine neue Fassung — die Versionsnummer wird GEZOGEN, nicht eingegeben.
 *
 * `leistungskatalog_version_uk` ist unique auf (mandant_id, schluessel,
 * version) mit Vorgabe 1. Ein Formular, das die Version abfragt, laedt zum
 * Verstoss ein und zum Raten: die zweite Fassung von `unterhalt` ist
 * Version 2, und das weiss die Datenbank besser als der Mensch am Bildschirm.
 * Entsteht sie immer als `entwurf` (die Spaltenvorgabe) — aktiv wird sie
 * durch einen eigenen Schritt, und der prueft, ob eine andere Fassung gilt.
 */
export async function legeKatalogAn(
  db: Abfrage, eingabe: KatalogAnlegen,
): Promise<{ readonly id: string; readonly version: number }> {
  if (eingabe.schluessel.trim() === '' || eingabe.bezeichnung.trim() === ''
      || eingabe.gueltigAb.trim() === '') {
    throw new KatalogFehler(
      'Schluessel, Bezeichnung und Gueltigkeitsbeginn sind Pflicht', 'unvollstaendig');
  }
  try {
    const [z] = await db.abfrage<{ id: string; version: number }>(
      `insert into leistungskatalog
         (mandant_id, schluessel, bezeichnung, beschreibung, version, gueltig_ab)
       values (app.aktiver_mandant(), $1, $2, $3,
               coalesce((select max(k.version) + 1 from leistungskatalog k
                          where k.mandant_id = app.aktiver_mandant()
                            and k.schluessel = $1), 1),
               $4::date)
       returning id, version`,
      [eingabe.schluessel.trim(), eingabe.bezeichnung.trim(),
       eingabe.beschreibung ?? null, eingabe.gueltigAb]);
    if (z === undefined) {
      throw new KatalogFehler('Die Katalogfassung wurde nicht angelegt', 'nicht_gefunden');
    }
    return z;
  } catch (fehler) {
    if (verstoss(fehler, '23505', 'leistungskatalog_version_uk')) {
      throw new KatalogFehler(
        'Zu diesem Schluessel entsteht gerade eine Fassung mit derselben Nummer — '
        + 'bitte erneut versuchen', 'schluessel_belegt');
    }
    throw fehler;
  }
}

/**
 * Der Statuswechsel. Die Regeln dahinter liegen in 0298, nicht hier.
 *
 * Diese Funktion uebersetzt nur: was der Ausloeser als `unique_violation`
 * oder `check_violation` abweist, bekommt einen benannten Grund, damit die
 * Seite einen Satz zeigen kann statt eines Datenbankfehlers.
 */
export async function setzeKatalogStatus(
  db: Abfrage, katalogId: string, status: 'entwurf' | 'aktiv' | 'archiviert',
): Promise<string> {
  try {
    /**
     * Nur der Status. `gueltig_bis` setzt der Ausloeser
     * `leistungskatalog_05_status` (0298), wenn die Fassung archiviert wird —
     * dort und nicht hier, damit die Regel auf JEDEM Schreibweg gilt und
     * nicht nur auf diesem.
     */
    const [z] = await db.abfrage<{ status: string; gueltig_bis: string | null }>(
      `update leistungskatalog set status = $2::katalog_status
        where id = $1
        returning status::text as status, gueltig_bis::text as gueltig_bis`,
      [katalogId, status]);
    if (z === undefined) throw new KatalogFehler('Katalogfassung nicht gefunden', 'nicht_gefunden');
    return z.status;
  } catch (fehler) {
    if (fehler instanceof KatalogFehler) throw fehler;
    const text = meldung(fehler);
    if (/nicht wieder geoeffnet/u.test(text)) {
      throw new KatalogFehler(text, 'status_endstation');
    }
    if (/bereits eine aktive Fassung/u.test(text)) {
      throw new KatalogFehler(text, 'schluessel_belegt');
    }
    throw fehler;
  }
}

// ---------------------------------------------------------------------------
// Schreiben — die Position
// ---------------------------------------------------------------------------

export interface PositionEingabe {
  readonly oz: string;
  readonly kurztext: string;
  readonly langtext?: string | null;
  readonly einheit: string;
  readonly parentId?: string | null;
  /** Deutsche Zahl: `"4,5"` Minuten. Leer heisst „kein Zeitwert". */
  readonly zeitwertMinuten?: string | null;
  /** Deutsche Zahl: `"250"` m²/h. */
  readonly leistungswert?: string | null;
  /** Deutscher Geldbetrag ohne Waehrung: `"12,50"`. */
  readonly standardEinzelpreis?: string | null;
  readonly kostenart?: string | null;
  readonly steuerKennzeichen?: string | null;
  readonly steuerbefreiungGrund?: string | null;
  readonly gueltigAb: string;
  readonly sortierung?: number;
  /**
   * Sind diese Werte fuer DIESE Fassung bestaetigt?
   *
   * Die Vorgabe ist `false`, also `ist_platzhalter = true`. Wer bestaetigt,
   * sagt „fuer diese Katalogfassung rechnen wir so" — nicht „O-17 und O-731
   * sind beantwortet". Dieselbe Trennung wie bei `bestaetigeKalkulation`.
   */
  readonly bestaetigt?: boolean;
}

const KOSTENARTEN = ['lohn', 'material', 'geraet', 'gemeinkosten', 'wagnis_gewinn'] as const;
const KENNZEICHEN = ['regelsatz', 'ermaessigt', 'steuerfrei', 'reverse_charge_13b'] as const;

/**
 * Der Standardsteuersatz einer Katalogposition.
 *
 * // TODO(client, O-60): Welche Leistung traegt welches Steuerkennzeichen? Ein
 * ermaessigter Satz, eine Steuerbefreiung oder ein § 13b-Fall haengt an der
 * LEISTUNG und an der Lage des KUNDEN, nicht am Katalog — die Position kann
 * also nur eine Vorgabe tragen, und die ist der Regelsatz. Sichtbar
 * gekennzeichnet bleibt sie trotzdem.
 */
export const KENNZEICHEN_VORGABE = 'regelsatz';

/** Eine deutsche Zahl in die Form, die `numeric(10,3)` erwartet — oder null. */
function numerisch(roh: string | null | undefined, feld: string): string | null {
  if (roh === null || roh === undefined || roh.trim() === '') return null;
  const befund = leseZahl(roh);
  if (befund.wert === null) {
    throw new KatalogFehler(`${feld}: „${roh}" ist keine lesbare Zahl`, 'zahl_unlesbar');
  }
  if (befund.wert <= 0n) {
    // `lkp_zeitwert_positiv` und `lkp_leistungswert_positiv` verlangen > 0.
    throw new KatalogFehler(`${feld} muss groesser als null sein`, 'zahl_unlesbar');
  }
  return alsNumerisch(befund.wert);
}

/** Ein Geldbetrag in Cent — nie als Fliesskommazahl (Invariante 1). */
function inCent(roh: string | null | undefined): Cent | null {
  if (roh === null || roh === undefined || roh.trim() === '') return null;
  try {
    return parseGeld(roh);
  } catch {
    throw new KatalogFehler(`„${roh}" ist kein lesbarer Betrag`, 'zahl_unlesbar');
  }
}

interface Vorbereitet {
  readonly zeitwert: string | null;
  readonly leistungswert: string | null;
  readonly preis: Cent | null;
  readonly kostenart: string | null;
  readonly kennzeichen: string;
}

function pruefeUndWandle(eingabe: PositionEingabe): Vorbereitet {
  if (eingabe.oz.trim() === '' || eingabe.kurztext.trim() === ''
      || eingabe.einheit.trim() === '' || eingabe.gueltigAb.trim() === '') {
    throw new KatalogFehler(
      'Ordnungszahl, Kurztext, Einheit und Gueltigkeitsbeginn sind Pflicht',
      'unvollstaendig');
  }
  const zeitwert = numerisch(eingabe.zeitwertMinuten, 'Zeitwert');
  const leistungswert = numerisch(eingabe.leistungswert, 'Leistungswert');
  const preis = inCent(eingabe.standardEinzelpreis);
  /**
   * `lkp_kalkulierbar`: mindestens einer der drei.
   *
   * Hier und nicht erst in der Datenbank, weil der CHECK eine Zeile ueber
   * eine Bedingung meldet und dieser Satz eine ueber die Aufgabe: eine
   * Position, aus der niemand einen Preis machen kann, ist keine
   * Katalogposition, sondern eine Ueberschrift — und fuer Ueberschriften ist
   * `parent_id` da.
   */
  if (zeitwert === null && leistungswert === null && preis === null) {
    throw new KatalogFehler(
      'Eine Position braucht mindestens einen Wert: Zeitwert, Leistungswert oder '
      + 'Standardeinzelpreis. Ist der richtige Wert noch offen (O-17, O-731), traegt '
      + 'die Position einen gekennzeichneten Platzhalter — keinen leeren Wert.',
      'ohne_wert');
  }
  const kostenart = eingabe.kostenart ?? null;
  if (kostenart !== null && !(KOSTENARTEN as readonly string[]).includes(kostenart)) {
    throw new KatalogFehler(`Unbekannte Kostenart: ${kostenart}`, 'unvollstaendig');
  }
  const kennzeichen = eingabe.steuerKennzeichen ?? KENNZEICHEN_VORGABE;
  if (!(KENNZEICHEN as readonly string[]).includes(kennzeichen)) {
    throw new KatalogFehler(`Unbekanntes Steuerkennzeichen: ${kennzeichen}`, 'unvollstaendig');
  }
  if (kennzeichen === 'steuerfrei'
      && (eingabe.steuerbefreiungGrund ?? '').trim() === '') {
    // `lkp_steuerfrei_mit_grund` — eine Steuerbefreiung ohne genannte Norm ist
    // im Streit mit dem Finanzamt nichts.
    throw new KatalogFehler(
      'Eine steuerfreie Position nennt die Norm der Befreiung', 'unvollstaendig');
  }
  return { zeitwert, leistungswert, preis, kostenart, kennzeichen };
}

/** Die Ausloeser aus `kern.pruefe_katalog_*` als benannte Fehler. */
function alsKatalogFehler(fehler: unknown): never {
  if (verstoss(fehler, '23505', 'lkp_oz_uk')) {
    throw new KatalogFehler(
      'Diese Ordnungszahl ist in dieser Fassung schon belegt', 'oz_belegt');
  }
  if (verstoss(fehler, '23514', 'lkp_kalkulierbar')) {
    throw new KatalogFehler(
      'Eine Position braucht mindestens einen Wert (Zeitwert, Leistungswert oder '
      + 'Standardeinzelpreis)', 'ohne_wert');
  }
  /**
   * `lkp_zeitraum_stimmig` — ein Ende vor dem Anfang.
   *
   * Ohne diese Zeile kam der CHECK als roher `23514` heraus, und
   * `fuehreUebergangAus` macht daraus eine 500 ohne Satz: die Seite kann
   * keinen Text zeigen, weil sie keinen Grund bekommt.
   */
  if (verstoss(fehler, '23514', 'lkp_zeitraum_stimmig')) {
    throw new KatalogFehler(
      'Das Ende der Gueltigkeit liegt vor ihrem Beginn', 'zeitraum_unstimmig');
  }
  const text = meldung(fehler);
  if (/Katalog ist archiviert/u.test(text)) {
    throw new KatalogFehler(
      'Diese Fassung ist archiviert — ihre Positionen sind unveraenderlich', 'archiviert');
  }
  if (/anderen Katalog/u.test(text)) {
    throw new KatalogFehler(
      'Die gewaehlte Elternposition gehoert zu einer anderen Fassung',
      'fremder_elternteil');
  }
  if (/Zyklus|tiefer als 64/u.test(text)) {
    throw new KatalogFehler(
      'Diese Zuordnung haengt die Position unter sich selbst', 'zyklus');
  }
  throw fehler as Error;
}

export async function legePositionAn(
  db: Abfrage, katalogId: string, eingabe: PositionEingabe,
): Promise<string> {
  const w = pruefeUndWandle(eingabe);
  try {
    const [z] = await db.abfrage<{ id: string }>(
      `insert into leistungskatalog_position
         (mandant_id, katalog_id, parent_id, oz, kurztext, langtext, einheit,
          zeitwert_minuten, leistungswert_qm_pro_stunde, standard_einzelpreis_cent,
          kostenart, steuer_kennzeichen, steuerbefreiung_grund, ist_platzhalter,
          gueltig_ab, sortierung)
       values (app.aktiver_mandant(), $1, $2, $3, $4, $5, $6,
               $7::numeric, $8::numeric, $9,
               $10::kostenart, $11::steuer_kennzeichen, $12, $13, $14::date, $15)
       returning id`,
      [katalogId, eingabe.parentId ?? null, eingabe.oz.trim(), eingabe.kurztext.trim(),
       eingabe.langtext ?? null, eingabe.einheit.trim(),
       w.zeitwert, w.leistungswert, w.preis === null ? null : String(w.preis),
       w.kostenart, w.kennzeichen, eingabe.steuerbefreiungGrund ?? null,
       eingabe.bestaetigt !== true, eingabe.gueltigAb, eingabe.sortierung ?? 0]);
    if (z === undefined) throw new KatalogFehler('Die Position wurde nicht angelegt', 'nicht_gefunden');
    return z.id;
  } catch (fehler) {
    if (fehler instanceof KatalogFehler) throw fehler;
    return alsKatalogFehler(fehler);
  }
}

/**
 * Die Fassung steht in JEDER Anweisung mit — wie `objekt_id` bei `raum`.
 *
 * Die Route prueft Katalog- und Positionskennung einzeln und reichte danach
 * nur die Position weiter; das `where id = $1` traf damit auch eine Position
 * einer ANDEREN Fassung desselben Mandanten — auch einer aktiven. Die
 * Umleitung zeigte anschliessend auf die Fassung aus dem Formular, also sah
 * niemand, was wirklich getroffen wurde, und die RLS hatte zu Recht nichts zu
 * beanstanden: der Mandant stimmte ja. Die Bindung gehoert deshalb in die
 * Anweisung selbst, nicht in eine Vorabpruefung, die ein zweiter Schreibweg
 * vergessen kann. Ein nicht getroffener Treffer wird zum vorhandenen
 * `nicht_gefunden`.
 */
export async function aenderePosition(
  db: Abfrage, katalogId: string, positionId: string, eingabe: PositionEingabe,
): Promise<void> {
  const w = pruefeUndWandle(eingabe);
  try {
    const [z] = await db.abfrage<{ id: string }>(
      `update leistungskatalog_position
          set parent_id = $2, oz = $3, kurztext = $4, langtext = $5, einheit = $6,
              zeitwert_minuten = $7::numeric,
              leistungswert_qm_pro_stunde = $8::numeric,
              standard_einzelpreis_cent = $9,
              kostenart = $10::kostenart,
              steuer_kennzeichen = $11::steuer_kennzeichen,
              steuerbefreiung_grund = $12,
              ist_platzhalter = $13,
              gueltig_ab = $14::date,
              sortierung = $15
        where id = $1 and katalog_id = $16
        returning id`,
      [positionId, eingabe.parentId ?? null, eingabe.oz.trim(), eingabe.kurztext.trim(),
       eingabe.langtext ?? null, eingabe.einheit.trim(),
       w.zeitwert, w.leistungswert, w.preis === null ? null : String(w.preis),
       w.kostenart, w.kennzeichen, eingabe.steuerbefreiungGrund ?? null,
       eingabe.bestaetigt !== true, eingabe.gueltigAb, eingabe.sortierung ?? 0,
       katalogId]);
    if (z === undefined) {
      throw new KatalogFehler(
        'Diese Position gehoert nicht zu dieser Fassung', 'nicht_gefunden');
    }
  } catch (fehler) {
    if (fehler instanceof KatalogFehler) throw fehler;
    alsKatalogFehler(fehler);
  }
}

/**
 * Eine Position ausser Kraft setzen — `gueltig_bis`, nie DELETE.
 *
 * `verhindere_loeschung` weist ein DELETE ohnehin ab (Invariante 8), und das
 * ist richtig: an einer Katalogposition haengen Angebotszeilen,
 * Kalkulationszeilen, Turnusse und Kontenzuordnungen. Sie zu entfernen
 * hiesse, die Herkunft eines Preises zu loeschen, den ein Kunde bezahlt hat.
 *
 * Nebenwirkung mit Absicht: `lkp_oz_uk` gilt nur WHERE `gueltig_bis is null`,
 * eine ausser Kraft gesetzte Ordnungszahl wird also fuer eine Nachfolgerin
 * frei.
 */
export async function setzePositionAusserKraft(
  db: Abfrage, katalogId: string, positionId: string, gueltigBis: string,
): Promise<void> {
  try {
    /**
     * `katalog_id` steht mit — dieselbe Bindung wie in `aenderePosition`, und
     * aus demselben Grund: sonst liesse sich die Position einer anderen,
     * moeglicherweise AKTIVEN Fassung ausser Kraft setzen.
     */
    const [z] = await db.abfrage<{ id: string }>(
      `update leistungskatalog_position set gueltig_bis = $3::date
        where id = $1 and katalog_id = $2 returning id`,
      [positionId, katalogId, gueltigBis]);
    if (z === undefined) {
      throw new KatalogFehler(
        'Diese Position gehoert nicht zu dieser Fassung', 'nicht_gefunden');
    }
  } catch (fehler) {
    if (fehler instanceof KatalogFehler) throw fehler;
    alsKatalogFehler(fehler);
  }
}

/** Der Betrag als `Cent`, fuer die Anzeige — ohne ihn neu zu rechnen. */
export function preisAus(zeile: PositionZeile): Cent | null {
  return zeile.standard_einzelpreis_cent === null
    ? null : cent(BigInt(zeile.standard_einzelpreis_cent));
}
