/**
 * Die fuenf Abrechnungsarten — die Begriffe, die alle fuenf teilen (FIN-01).
 *
 * `05-API-KARTE.md` §D.7 und `02-CRM-OPERATIONS.md` §3.2 beschreiben eine
 * Registrierung: eine Umsetzung je Aufzaehlungswert, eingetragen in eine Karte,
 * und der Rechnungsdienst kennt keine einzige davon. Das ist der ganze Zweck —
 * O-04 ist offen, und eine Antwort darauf muss EINE Klasse und EINE
 * Registerzeile kosten, nicht einen Umbau von `rechnung.ts`.
 *
 * **Was hier NICHT steht, ist eine Regel.** Die fuenf NAMEN kommen aus SPEC
 * FIN-01. Ihre Regeln — Minutenrundung, Teilmonatsbehandlung, abrechenbare
 * Aufmasszustaende, Mindestabruf — hat niemand bestaetigt. Jede Strategie
 * fuehrt sie deshalb als PARAMETER auf `vertrag_abrechnung.parameter`, und
 * solange der Parameter fehlt, liefert sie einen blockierenden Befund statt
 * einer plausiblen Zahl. Eine erfundene Regel faellt nicht auf: die Rechnung
 * sieht richtig aus, ist einseitig und unveraenderlich, und der Fehler taucht
 * bei der naechsten Betriebspruefung auf.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen.
 */
import { type Cent, cent } from '../geld.js';
import { type MilliMenge, mengeAusPostgres, milliMenge } from '../menge.js';
import type { Abfrage } from '../rechnung.js';

/**
 * Die fuenf Schluessel — WOERTLICH die Werte des Aufzaehlungstyps
 * `abrechnungsart` aus `0086`.
 *
 * `05-API-KARTE.md` §D.7 schreibt den ersten als `stunden`, der Eigentuemer des
 * Vokabulars (`02-CRM-OPERATIONS.md` §2, K-21) als `stundenbasiert`. Hier gilt
 * der Eigentuemer: zwei Schreibweisen fuer dieselbe Sache waeren eine
 * Uebersetzungsschicht zwischen Datenbank und Dienst, und eine Uebersetzung,
 * die irgendwann jemand halb pflegt, ist genau der Weg, auf dem eine Zeile
 * ihre Abrechnungsart verliert (D-341).
 */
export type AbrechnungsartSchluessel =
  | 'stundenbasiert'
  | 'monatspauschale'
  | 'festpreis_los'
  | 'einheitspreis_aufmass'
  | 'einzelabruf';

export const ABRECHNUNGSARTEN: readonly AbrechnungsartSchluessel[] = [
  'stundenbasiert', 'monatspauschale', 'festpreis_los', 'einheitspreis_aufmass', 'einzelabruf',
];

/**
 * Ein Abrechnungszeitraum als zwei BERLINER Kalendertage, beide einschliesslich
 * (K-11). Keine Instants: der Zeitraum einer Rechnung ist ein Kalenderbegriff
 * („August 2026"), und ihn als UTC-Fenster zu fuehren verschoebe ihn im Sommer
 * um zwei Stunden — also um die Nachtschicht des Ersten.
 */
export interface Periode {
  /** `JJJJ-MM-TT`. */
  readonly von: string;
  /** `JJJJ-MM-TT`, EINSCHLIESSLICH. */
  readonly bis: string;
}

/**
 * Ein Herkunftsverweis (FIN-07): woher die Zahl dieser Zeile stammt.
 *
 * **Ein eigener Typ und nicht `QuelleEingabe`**, obwohl `bestuecke()` genau
 * dorthin abbildet. Die Herkunftstabelle `rechnungsposition_quelle` und ihr
 * Vokabular gehoeren PR 49; diese Schicht sagt, was sie GELESEN hat, und die
 * Abbildung auf das Vokabular des Nachbarn steht an genau EINER Stelle
 * (`alsQuellen` in `index.ts`). Aendert der Nachbar seine Form, ist das eine
 * Funktion und nicht fuenf Strategien.
 */
export interface HerkunftVerweis {
  /**
   * `vertrag_abrechnung` ist kein Beleg im Sinne von FIN-07, sondern die
   * VEREINBARUNG: eine Monatspauschale hat keinen Zeiteintrag und kein Aufmass
   * hinter sich, sondern einen Vertrag. Die Abbildung macht daraus eine
   * ausdruecklich beleglose Zeile MIT Begruendung — und nicht eine erfundene
   * Leistungszeile.
   */
  readonly art: 'zeiteintrag' | 'aufmass' | 'vertrag' | 'vertrag_abrechnung'
    | 'sonderleistung';
  readonly id: string;
  /** Der Anteil, mit dem die Quelle in die Zeile eingeht — `null`: ganz. */
  readonly anteil: MilliMenge | null;
}

/**
 * Ein Entwurf einer Rechnungszeile. Noch keine Zeile: `bestuecke()` gibt ihn an
 * `fuegePositionHinzu()`, und DORT wird der Nettobetrag geschrieben.
 *
 * `nettoCent` steht trotzdem hier — gerechnet mit derselben Funktion
 * (`berechneNetto` aus `rechnung.ts`), damit eine Vorschau denselben Betrag
 * zeigt, den die Zeile spaeter traegt. Zwei Formeln fuer einen Betrag sind eine
 * zu viel.
 */
export interface RechnungspositionEntwurf {
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly menge: MilliMenge;
  /** Der Schluessel aus `masseinheit` — `min`, `tag`, `m2`, `psch`, `stk`. */
  readonly einheit: string;
  /** BT-149/150: `einzelpreisCent` gilt je DIESER Menge Einheiten. */
  readonly preisBasismenge: MilliMenge;
  readonly einzelpreisCent: Cent;
  readonly nettoCent: Cent;
  /** Der Schluessel aus `steuersatz_gruppe`. */
  readonly steuergruppe: string;
  readonly abrechnungsart: string;
  readonly vertragAbrechnungId: string;
  readonly auftragLeistungId: string | null;
  readonly lvPositionId: string | null;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly herkunft: readonly HerkunftVerweis[];
}

/**
 * Ein Befund einer Abrechnungsart — strategieeigen, NICHT der §14-Befund.
 *
 * Der §14-UStG-Bericht gehoert `services/finanz/ustg14.ts` (PR 47) und wird in
 * den Snapshot eingefroren. Dieser hier sagt etwas anderes: ob die
 * ABRECHNUNGSREGEL vollstaendig ist. Beide in einen Typ zu falten hiesse, einen
 * offenen Parameter als Verstoss gegen das Umsatzsteuergesetz auszuweisen.
 */
export interface AbrechnungsBefund {
  readonly art: 'fehler' | 'warnung';
  /** Woran es haengt — ein Spaltenname oder ein Parameterschluessel. */
  readonly feld: string;
  /** Die offene Frage, wenn es eine ist. */
  readonly offeneFrage: string | null;
  readonly textDe: string;
}

export function fehler(feld: string, textDe: string, offeneFrage: string | null = null):
AbrechnungsBefund {
  return { art: 'fehler', feld, offeneFrage, textDe };
}

export function warnung(feld: string, textDe: string, offeneFrage: string | null = null):
AbrechnungsBefund {
  return { art: 'warnung', feld, offeneFrage, textDe };
}

/** Eine Zeile `vertrag_abrechnung`, aufgeloest (§3.2). */
export interface VertragAbrechnung {
  readonly id: string;
  readonly mandantId: string;
  readonly auftragId: string;
  readonly auftragLeistungId: string | null;
  /** Der Aufzaehlungswert als Zeichenkette — eine SECHSTE Art ist denkbar. */
  readonly abrechnungsart: string;
  readonly parameter: Readonly<Record<string, unknown>>;
  readonly pauschaleNettoCent: Cent | null;
  readonly stundensatzCent: Cent | null;
  readonly festpreisNettoCent: Cent | null;
  readonly mindestabnahmeStunden: MilliMenge | null;
  readonly abrechnungsintervall: string;
  readonly leistungszeitraumModus: string;
  readonly zahlungszielTage: number | null;
  readonly reverseCharge13b: boolean;
  readonly unterliegtBauabzugsteuer: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
}

/** Was eine Strategie zum Rechnen bekommt. */
export interface AbrechnungsEingabe {
  readonly konfiguration: VertragAbrechnung;
  readonly periode: Periode;
  /**
   * Die AUSDRUECKLICH abzurechnenden Aufmassblaetter (`einheitspreis_aufmass`).
   * Ausdruecklich und nicht gesucht: ein Blatt, das die Strategie still
   * ueberspringt, weil es noch nicht gegengezeichnet ist, ist eine Rechnung mit
   * fehlender Leistung — und niemand sieht, dass etwas fehlt.
   */
  readonly aufmassIds?: readonly string[] | undefined;
  /** Fertigstellungsgrad in Basispunkten (`festpreis_los`, anteilig). */
  readonly fertigstellungBp?: number | undefined;
}

/**
 * Der Vertrag, den eine Abrechnungsart erfuellt.
 *
 * Zwei Methoden, und die Trennung ist der Punkt: `positionen()` rechnet,
 * `pruefe()` sagt, ob gerechnet werden DARF. Waeren es eine, muesste jeder
 * Aufrufer, der nur vorschauen will, mit einer Ausnahme rechnen — und der eine,
 * der festschreibt, koennte die Pruefung ueberspringen.
 */
export interface Abrechnungsart {
  /** Der Aufzaehlungswert. Eine sechste Art bringt ihren eigenen mit. */
  readonly schluessel: string;
  /** Die deutsche Beschriftung der Oberflaeche. */
  readonly bezeichnung: string;
  /**
   * `true`, solange die REGELN dieser Art unbestaetigt sind (O-04). Die
   * Oberflaeche schreibt daneben „provisorisch"; eine Art ohne diese Marke
   * behauptet, jemand haette sie bestaetigt.
   */
  readonly istProvisorisch: boolean;
  /** Die Parameterschluessel, die auf `vertrag_abrechnung.parameter` stehen muessen. */
  readonly offeneParameter: readonly OffenerParameter[];
  positionen(db: Abfrage, eingabe: AbrechnungsEingabe):
  Promise<readonly RechnungspositionEntwurf[]>;
  pruefe(db: Abfrage, eingabe: AbrechnungsEingabe): Promise<readonly AbrechnungsBefund[]>;
}

/** Ein offener Parameter: der Schluessel, die Frage und die zulaessigen Werte. */
export interface OffenerParameter {
  readonly schluessel: string;
  readonly frage: string;
  /** `null`: ein freier Wert (eine Zahl, eine Liste). */
  readonly werte: readonly string[] | null;
  readonly offeneFrage: string;
}

export type AbrechnungGrund =
  | 'keine_abrechnungsart'
  | 'parameter_offen'
  | 'unbekannte_abrechnungsart'
  | 'kein_preis'
  | 'keine_menge'
  | 'aufmass_nicht_abrechenbar'
  | 'unbekannte_einheit'
  | 'mehrdeutige_steuergruppe'
  | 'ausserhalb_lv'
  | 'nichts_abzurechnen'
  /**
   * Die Rechnung traegt einen ANDEREN Auftrag als der Vorgang, der sie
   * bestueckt. Siehe `bestueckeAusAbrechnungsart`.
   */
  | 'auftrag_passt_nicht';

/**
 * Der eine getippte Fehler dieser Schicht.
 *
 * Getippt und nicht `Error`, weil Abnahme (4) genau das verlangt: ein Auftrag
 * ohne Abrechnungsart laesst sich NICHT berechnen, und der Aufrufer soll
 * `keine_abrechnungsart` unterscheiden koennen von „Preis fehlt". Ein
 * Vorgabewert an dieser Stelle waere eine Rechnung ueber eine Regel, die
 * niemand vereinbart hat.
 */
export class AbrechnungFehler extends Error {
  readonly status = 409;
  constructor(nachricht: string, readonly grund: AbrechnungGrund) {
    super(nachricht);
    this.name = 'AbrechnungFehler';
  }
}

// ---------------------------------------------------------------------------
// Gemeinsame Helfer
// ---------------------------------------------------------------------------

/** `"2026-08-01"` → `{ jahr: 2026, monat: 8, tag: 1 }`, ohne Prozessuhr. */
export function zerlegeTag(tag: string): { jahr: number; monat: number; tag: number } {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(tag);
  if (treffer === null) {
    throw new AbrechnungFehler(`Kein Kalendertag in der Form JJJJ-MM-TT: ${tag}`, 'keine_menge');
  }
  return {
    jahr: Number(treffer[1]), monat: Number(treffer[2]), tag: Number(treffer[3]),
  };
}

/** Tage im Monat — der gregorianische Kalender, nicht die Systemzeitzone. */
export function tageImMonat(jahr: number, monat: number): number {
  const laengen = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monat === 2 && ((jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0)) return 29;
  return laengen[monat - 1] ?? 30;
}

export function alsTag(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}`
    + `-${String(tag).padStart(2, '0')}`;
}

/**
 * Die Kalendermonate, die eine Periode beruehrt, jeweils auf die Periode
 * beschnitten. Ein Quartalsintervall ergibt drei Zeilen und nicht eine
 * gerundete.
 */
export function monateDerPeriode(periode: Periode): readonly Periode[] {
  const von = zerlegeTag(periode.von);
  const bis = zerlegeTag(periode.bis);
  if (alsTag(von.jahr, von.monat, von.tag) > alsTag(bis.jahr, bis.monat, bis.tag)) {
    throw new AbrechnungFehler(
      `Der Abrechnungszeitraum endet vor seinem Beginn: ${periode.von} … ${periode.bis}`,
      'keine_menge',
    );
  }
  const stuecke: Periode[] = [];
  let jahr = von.jahr;
  let monat = von.monat;
  for (let schutz = 0; schutz < 240; schutz += 1) {
    const erster = jahr === von.jahr && monat === von.monat ? von.tag : 1;
    const letzter = jahr === bis.jahr && monat === bis.monat ? bis.tag : tageImMonat(jahr, monat);
    stuecke.push({ von: alsTag(jahr, monat, erster), bis: alsTag(jahr, monat, letzter) });
    if (jahr === bis.jahr && monat === bis.monat) return stuecke;
    monat += 1;
    if (monat === 13) { monat = 1; jahr += 1; }
  }
  throw new AbrechnungFehler('Abrechnungszeitraum laenger als zwanzig Jahre', 'keine_menge');
}

/**
 * Der Leistungszeitraum einer Zeile, aus `leistungszeitraum_modus` (FIN-05).
 *
 * FIN-05 nennt den Leistungszeitraum das am haeufigsten fehlende Pflichtfeld
 * und haelt fest, dass sein Fehlen dem Kunden den Vorsteuerabzug kostet. Er
 * wird deshalb hergeleitet und nicht weggelassen — ausser im Modus
 * `nach_leistungsnachweis`, wo die Herleitung selbst offen ist (O-54); dort
 * meldet die Strategie einen blockierenden Befund, statt den Kalendermonat zu
 * unterstellen.
 */
export function leistungszeitraum(
  konfiguration: VertragAbrechnung, abschnitt: Periode,
): { von: string | null; bis: string | null } {
  if (konfiguration.leistungszeitraumModus === 'nach_leistungsnachweis') {
    return { von: null, bis: null };
  }
  return { von: abschnitt.von, bis: abschnitt.bis };
}

/** Der Befund, den ein fehlender Parameter erzeugt — fuer alle fuenf gleich. */
export function pruefeParameter(
  art: Abrechnungsart, konfiguration: VertragAbrechnung,
): readonly AbrechnungsBefund[] {
  const befunde: AbrechnungsBefund[] = [];
  for (const p of art.offeneParameter) {
    const wert = konfiguration.parameter[p.schluessel];
    if (wert === undefined) {
      befunde.push(fehler(
        `parameter.${p.schluessel}`,
        `Unbestätigter Wert: „${art.bezeichnung}" rechnet erst, wenn `
        + `„${p.schluessel}" im Vertrag hinterlegt ist. ${p.frage}`,
        p.offeneFrage,
      ));
      continue;
    }
    if (p.werte !== null && !p.werte.includes(String(wert))) {
      befunde.push(fehler(
        `parameter.${p.schluessel}`,
        `„${p.schluessel}" trägt „${String(wert)}"; zulässig sind `
        + `${p.werte.join(', ')}.`,
        p.offeneFrage,
      ));
    }
  }
  if (konfiguration.leistungszeitraumModus === 'nach_leistungsnachweis') {
    befunde.push(fehler(
      'leistungszeitraum_modus',
      'Unbestätigter Wert: wie der Leistungszeitraum aus einem Leistungsnachweis '
      + 'hergeleitet wird, ist offen. Ohne Leistungszeitraum verliert der Kunde '
      + 'den Vorsteuerabzug (FIN-05, §14 Abs. 4 Nr. 6 UStG).',
      'O-54',
    ));
  }
  return befunde;
}

/** Ein Parameter als Zeichenkette, oder ein getippter Fehler. */
export function parameterText(
  konfiguration: VertragAbrechnung, schluessel: string, offeneFrage: string,
): string {
  const wert = konfiguration.parameter[schluessel];
  if (typeof wert !== 'string' || wert.trim() === '') {
    throw new AbrechnungFehler(
      `Der Parameter „${schluessel}" ist im Vertrag nicht hinterlegt (${offeneFrage}).`,
      'parameter_offen',
    );
  }
  return wert;
}

/** Ein Parameter als ganze Zahl, oder ein getippter Fehler. */
export function parameterGanzzahl(
  konfiguration: VertragAbrechnung, schluessel: string, offeneFrage: string,
): number {
  const wert = konfiguration.parameter[schluessel];
  if (typeof wert !== 'number' || !Number.isInteger(wert) || wert <= 0) {
    throw new AbrechnungFehler(
      `Der Parameter „${schluessel}" ist im Vertrag nicht als ganze Zahl hinterlegt `
      + `(${offeneFrage}).`,
      'parameter_offen',
    );
  }
  return wert;
}

/** Ein Parameter als Liste von Zeichenketten, oder ein getippter Fehler. */
export function parameterListe(
  konfiguration: VertragAbrechnung, schluessel: string, offeneFrage: string,
): readonly string[] {
  const wert = konfiguration.parameter[schluessel];
  if (!Array.isArray(wert) || wert.some((w) => typeof w !== 'string')) {
    throw new AbrechnungFehler(
      `Der Parameter „${schluessel}" ist im Vertrag nicht als Liste hinterlegt `
      + `(${offeneFrage}).`,
      'parameter_offen',
    );
  }
  return wert as readonly string[];
}

interface SteuergruppeZeile {
  readonly schluessel: string;
  readonly steuer_kennzeichen: string;
  readonly satz_bp: number;
}

/**
 * Die Steuersatzgruppe einer Zeile — aufgeloest aus dem, was die
 * LEISTUNGSZEILE vereinbart hat, nie geraten.
 *
 * `auftrag_leistung` traegt `steuersatz_bp` und `steuer_kennzeichen`; der
 * Katalog `steuersatz_gruppe` traegt dieselben zwei Angaben und den Schluessel,
 * den die Rechnungszeile braucht. Findet sich keine Gruppe oder finden sich
 * zwei — der §13b-Fall, wo `bau` und `gebaeudereinigung` beide Satz 0 und
 * dasselbe Kennzeichen tragen —, wird ein getippter Fehler geworfen. Die eine
 * von zweien zu waehlen hiesse, die §13b-Kategorie zu erfinden, und die steht
 * gedruckt auf dem Beleg (§14a Abs. 5 UStG).
 */
export async function loeseSteuergruppe(
  db: Abfrage, kennzeichen: string, satzBp: number, stichtag: string,
): Promise<string> {
  const zeilen = await db.abfrage<SteuergruppeZeile>(
    `select schluessel, steuer_kennzeichen::text as steuer_kennzeichen, satz_bp
       from steuersatz_gruppe
      where steuer_kennzeichen::text = $1
        and satz_bp = $2
        and gueltig_von <= $3::date
        and (gueltig_bis is null or gueltig_bis >= $3::date)
      order by schluessel`,
    [kennzeichen, satzBp, stichtag],
  );
  if (zeilen.length === 0) {
    throw new AbrechnungFehler(
      `Keine Steuersatzgruppe fuer „${kennzeichen}" mit ${String(satzBp)} Basispunkten `
      + `am ${stichtag}.`,
      'mehrdeutige_steuergruppe',
    );
  }
  if (zeilen.length > 1) {
    throw new AbrechnungFehler(
      `Mehrdeutige Steuersatzgruppe fuer „${kennzeichen}" am ${stichtag}: `
      + `${zeilen.map((z) => z.schluessel).join(', ')}. `
      + 'Welche §13b-Kategorie gilt, entscheidet die §13b-Ermittlung (FIN-09, O-104) '
      + 'und nicht die Abrechnungsart.',
      'mehrdeutige_steuergruppe',
    );
  }
  return zeilen[0]!.schluessel;
}

interface LeistungZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly einheit: string | null;
  readonly einzelpreis_cent: string | null;
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
}

/**
 * Die Leistungszeilen eines Auftrags, die am Stichtag leben.
 *
 * `gueltig_bis` ist EINSCHLIESSLICH (02-CRM §0.5) — deshalb `>= stichtag` und
 * nicht `> stichtag`. Der Unterschied ist genau der Wechseltag, und dort ist er
 * kein falsches Etikett, sondern ein falscher Preis.
 */
export async function ladeLeistungszeilen(
  db: Abfrage, auftragId: string, stichtag: string,
): Promise<readonly LeistungZeile[]> {
  return db.abfrage<LeistungZeile>(
    `select al.id, al.bezeichnung, al.einheit, al.einzelpreis_cent::text,
            al.steuersatz_bp, al.steuer_kennzeichen::text as steuer_kennzeichen
       from auftrag_leistung al
      where al.auftrag_id = $1
        and al.gueltig_ab <= $2::date
        and (al.gueltig_bis is null or al.gueltig_bis >= $2::date)
      order by al.position_nr`,
    [auftragId, stichtag],
  );
}

export type { LeistungZeile };

/**
 * Die Steuergruppe eines AUFTRAGSWEITEN Belegs — die Pauschale, das Los.
 *
 * Sie kommt aus den Leistungszeilen, weil dort der vereinbarte Satz steht.
 * Tragen die Zeilen verschiedene Saetze, gibt es keine eine Gruppe fuer eine
 * auftragsweite Pauschale — dann muss die Konfiguration je Leistungszeile
 * gefuehrt werden (O-53), und das sagt der Fehler auch.
 */
export async function steuergruppeDesAuftrags(
  db: Abfrage, auftragId: string, stichtag: string,
): Promise<string> {
  const zeilen = await ladeLeistungszeilen(db, auftragId, stichtag);
  if (zeilen.length === 0) {
    throw new AbrechnungFehler(
      `Auftrag ${auftragId} hat am ${stichtag} keine Leistungszeile — ohne sie gibt es `
      + 'keinen vereinbarten Steuersatz.',
      'mehrdeutige_steuergruppe',
    );
  }
  const saetze = new Set(zeilen.map((z) => `${z.steuer_kennzeichen}:${String(z.steuersatz_bp)}`));
  if (saetze.size > 1) {
    throw new AbrechnungFehler(
      `Die Leistungszeilen des Auftrags tragen ${String(saetze.size)} verschiedene Steuersaetze `
      + '— eine auftragsweite Pauschale hat damit keinen eindeutigen. Die '
      + 'Abrechnungskonfiguration gehoert dann je Leistungszeile (O-53).',
      'mehrdeutige_steuergruppe',
    );
  }
  const erste = zeilen[0]!;
  return loeseSteuergruppe(db, erste.steuer_kennzeichen, erste.steuersatz_bp, stichtag);
}

/**
 * Ein Einheitenlabel auf einen `masseinheit`-Schluessel abbilden.
 *
 * `auftrag_leistung.einheit` und `aufmass_zeile.einheit` sind Freitext — ein
 * VOB-Leistungsverzeichnis bringt Einheiten mit, die keine Liste vorhersieht.
 * Geraten wird trotzdem nichts: gefunden wird ueber Schluessel ODER
 * Bezeichnung, und was sich nicht findet, ist ein getippter Fehler. Eine
 * geratene BT-130 macht die XRechnung ungueltig oder falsch (§3.2).
 */
export async function loeseEinheit(db: Abfrage, label: string | null): Promise<string> {
  if (label === null || label.trim() === '') {
    throw new AbrechnungFehler(
      'Die Leistungszeile traegt keine Mengeneinheit — ohne sie fehlt der Rechnungszeile '
      + 'BT-130 (§14 Abs. 4 Nr. 5 UStG).',
      'unbekannte_einheit',
    );
  }
  const [treffer] = await db.abfrage<{ schluessel: string }>(
    `select schluessel from masseinheit
      where schluessel = $1 or bezeichnung = $1
      order by case when schluessel = $1 then 0 else 1 end
      limit 1`,
    [label.trim()],
  );
  if (treffer === undefined) {
    throw new AbrechnungFehler(
      `Unbekannte Mengeneinheit „${label}" — anzulegen unter Referenzdaten (O-174).`,
      'unbekannte_einheit',
    );
  }
  return treffer.schluessel;
}

/** `bigint`-Cent aus einer Postgres-Zeichenkette, oder `null`. */
export function centOderNull(text: string | null): Cent | null {
  return text === null ? null : cent(BigInt(text));
}

/** `numeric(12,3)` aus Postgres, oder `null`. */
export function mengeOderNull(text: string | null): MilliMenge | null {
  return text === null ? null : mengeAusPostgres(text);
}

/** Ganze Einheiten als Menge — `1` Monat ist `1_000n` (K-16). */
export function ganzeMenge(anzahl: number): MilliMenge {
  return milliMenge(BigInt(anzahl) * 1000n);
}
