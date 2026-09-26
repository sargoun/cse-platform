import { nachCp1252 } from './cp1252.js';

/**
 * Der EXTF-Buchungsstapel (ACC-02, `05-FINANZEN.md` §9.4, PR 60).
 *
 * **Diese Datei erzeugt Bytes, nicht Text.** Das ist der ganze Punkt: DATEV
 * liest Windows-1252 mit CRLF und Komma als Dezimaltrenner, und jede dieser
 * drei Eigenschaften geht verloren, sobald jemand das Ergebnis als
 * JavaScript-String weiterreicht und irgendwo als UTF-8 schreibt. Der
 * Rückgabewert ist deshalb `Uint8Array`, und die Tests prüfen Bytes.
 *
 * **Kein Betrag wird hier gerechnet** (Invariante 1, Invariante 6). Herein
 * kommen ganze Cent; `betragText` verschiebt das Komma und tut sonst nichts.
 * Es gibt keine Multiplikation, keine Division, kein `Number` — eine
 * Fliesskommazahl im Steuerexport ist der Fehler, der erst der
 * Betriebsprüfung auffällt.
 *
 * ---
 *
 * ## ⚑ Das Format ist SPEZIFIKATIONSABGELEITET, nicht kundengeprüft (O-05)
 *
 * Die Feldreihenfolge unten stammt aus der veröffentlichten DATEV-Beschreibung
 * des Formats „Buchungsstapel", nicht aus einer Datei, die dieser Steuerberater
 * tatsächlich eingelesen hat. Solange keine echte Musterdatei vorliegt, gilt:
 *
 *  - `SPALTEN` ist die EINE Wahrheit über Anzahl und Reihenfolge der Felder.
 *    Die Kopfzeile der Datei IST diese Liste; jede Datenzeile wird gegen ihre
 *    Länge geprüft. Kopf und Zeilen können deshalb nicht auseinanderlaufen.
 *  - Kommt das Muster, ist die Korrektur ein Eingriff an EINER Stelle.
 *  - Die Oberfläche sagt bis dahin, dass das Format ungeprüft ist, und ein
 *    Test hält fest, dass sie es sagt.
 *
 * TODO(client, O-05): echte EXTF-Musterdatei des Steuerberaters anfordern und
 * `SPALTEN`, `KOPF_FELDER` sowie `FORMAT_VERSION` dagegen abgleichen.
 */

/** ⚑ Ungeprüft gegen ein Kundenmuster (O-05). Siehe Dateikopf. */
export const FORMAT_SPEZIFIKATIONSABGELEITET = true as const;

/** Feldtrenner, Textbegrenzer und Zeilenende — alle drei gibt DATEV vor. */
const TRENNER = ';';
const ZEILENENDE = '\r\n';

/**
 * Die Spalten des Buchungsstapels, in ihrer Reihenfolge.
 *
 * Die Liste ist bewusst vollständig und nicht auf die belegten Felder
 * gekürzt: DATEV liest nach POSITION, und eine gekürzte Zeile verschöbe jedes
 * Feld dahinter. Was die Plattform nicht füllt, bleibt leer — aber es bleibt
 * an seinem Platz.
 */
export const SPALTEN: readonly string[] = [
  'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
  'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
  'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto',
  'Buchungstext', 'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank',
  'Sachverhalt', 'Zinssperre', 'Beleglink',
  'Beleginfo - Art 1', 'Beleginfo - Inhalt 1',
  'Beleginfo - Art 2', 'Beleginfo - Inhalt 2',
  'Beleginfo - Art 3', 'Beleginfo - Inhalt 3',
  'Beleginfo - Art 4', 'Beleginfo - Inhalt 4',
  'Beleginfo - Art 5', 'Beleginfo - Inhalt 5',
  'Beleginfo - Art 6', 'Beleginfo - Inhalt 6',
  'Beleginfo - Art 7', 'Beleginfo - Inhalt 7',
  'Beleginfo - Art 8', 'Beleginfo - Inhalt 8',
  'KOST1 - Kostenstelle', 'KOST2 - Kostenstelle', 'KOST-Menge',
  'EU-Mitgliedstaat u. UStID', 'EU-Steuersatz', 'Abw. Versteuerungsart',
  'Sachverhalt L+L', 'Funktionsergänzung L+L', 'BU 49 Hauptfunktionstyp',
  'BU 49 Hauptfunktionsnummer', 'BU 49 Funktionsergänzung',
  'Zusatzinformation - Art 1', 'Zusatzinformation - Inhalt 1',
  'Zusatzinformation - Art 2', 'Zusatzinformation - Inhalt 2',
  'Zusatzinformation - Art 3', 'Zusatzinformation - Inhalt 3',
  'Zusatzinformation - Art 4', 'Zusatzinformation - Inhalt 4',
  'Zusatzinformation - Art 5', 'Zusatzinformation - Inhalt 5',
  'Zusatzinformation - Art 6', 'Zusatzinformation - Inhalt 6',
  'Zusatzinformation - Art 7', 'Zusatzinformation - Inhalt 7',
  'Zusatzinformation - Art 8', 'Zusatzinformation - Inhalt 8',
  'Zusatzinformation - Art 9', 'Zusatzinformation - Inhalt 9',
  'Zusatzinformation - Art 10', 'Zusatzinformation - Inhalt 10',
  'Zusatzinformation - Art 11', 'Zusatzinformation - Inhalt 11',
  'Zusatzinformation - Art 12', 'Zusatzinformation - Inhalt 12',
  'Zusatzinformation - Art 13', 'Zusatzinformation - Inhalt 13',
  'Zusatzinformation - Art 14', 'Zusatzinformation - Inhalt 14',
  'Zusatzinformation - Art 15', 'Zusatzinformation - Inhalt 15',
  'Zusatzinformation - Art 16', 'Zusatzinformation - Inhalt 16',
  'Zusatzinformation - Art 17', 'Zusatzinformation - Inhalt 17',
  'Zusatzinformation - Art 18', 'Zusatzinformation - Inhalt 18',
  'Zusatzinformation - Art 19', 'Zusatzinformation - Inhalt 19',
  'Zusatzinformation - Art 20', 'Zusatzinformation - Inhalt 20',
  'Stück', 'Gewicht', 'Zahlweise', 'Forderungsart', 'Veranlagungsjahr',
  'Zugeordnete Fälligkeit', 'Skontotyp', 'Auftragsnummer', 'Buchungstyp',
  'USt-Schlüssel (Anzahlungen)', 'EU-Mitgliedstaat (Anzahlungen)',
  'Sachverhalt L+L (Anzahlungen)', 'EU-Steuersatz (Anzahlungen)',
  'Erlöskonto (Anzahlungen)', 'Herkunft-Kz', 'Buchungs GUID',
  'KOST-Datum', 'SEPA-Mandatsreferenz', 'Skontosperre', 'Gesellschaftername',
  'Beteiligtennummer', 'Identifikationsnummer', 'Zeichnernummer',
  'Postensperre bis', 'Bezeichnung SoBil-Sachverhalt', 'Kennzeichen SoBil-Buchung',
  'Festschreibung', 'Leistungsdatum', 'Datum Zuord. Steuerperiode',
  'Fälligkeit', 'Generalumkehr (GU)', 'Steuersatz', 'Land',
  'Abrechnungsreferenz', 'BVV-Position', 'EU-Mitgliedstaat u. UStID (Ursprung)',
  'EU-Steuersatz (Ursprung)',
];

/** Die Feldnamen der Kopfzeile — dieselbe Rolle wie `SPALTEN`. */
export const KOPF_FELDER: readonly string[] = [
  'Kennzeichen', 'Versionsnummer', 'Formatkategorie', 'Formatname',
  'Formatversion', 'Erzeugt am', 'Importiert', 'Herkunft', 'Exportiert von',
  'Importiert von', 'Berater', 'Mandant', 'WJ-Beginn', 'Sachkontenlänge',
  'Datum von', 'Datum bis', 'Bezeichnung', 'Diktatkürzel', 'Buchungstyp',
  'Rechnungslegungszweck', 'Festschreibung', 'WKZ', 'reserviert',
  'Derivatskennzeichen', 'reserviert', 'reserviert', 'SKR',
  'Branchenlösungs-Id', 'reserviert', 'reserviert', 'Anwendungsinformation',
];

export const FORMAT_VERSION = '700' as const;

export class ExtfFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ExtfFehler';
  }
}

// ---------------------------------------------------------------------------
// Feldwerte
// ---------------------------------------------------------------------------

/**
 * Ganze Cent als DATEV-Betrag: Komma als Dezimaltrenner, immer zwei Stellen,
 * **ohne** Vorzeichen — die Richtung steht im Soll/Haben-Kennzeichen.
 *
 * Rein über Zeichenketten. `(cent / 100).toFixed(2)` wäre kürzer und führte
 * eine Fliesskommazahl in den Steuerexport ein (Invariante 1).
 */
export function betragText(cent: bigint): string {
  const betrag = cent < 0n ? -cent : cent;
  const roh = betrag.toString().padStart(3, '0');
  return `${roh.slice(0, -2)},${roh.slice(-2)}`;
}

/** `2026-08-15` → `1508`. DATEV führt im Stapel Tag und Monat, das Jahr steht im Kopf. */
export function belegdatumText(iso: string): string {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (treffer === null) throw new ExtfFehler(`"${iso}" ist kein ISO-Datum.`);
  return `${treffer[3]!}${treffer[2]!}`;
}

/** Die Höchstlänge der Stapelbezeichnung im Kopf (Feld 17 der Kopfzeile). */
export const BEZEICHNUNG_HOECHSTENS = 30;

/**
 * Die Bezeichnung eines Stapels: `Stapel 01.08.2026-31.08.2026` — 28 Zeichen.
 *
 * **Sie muss in 30 Zeichen passen, und zwar ganz (V-211).** Die erste Fassung
 * hiess `Buchungsstapel 2026-08-01 bis 2026-08-31`, 40 Zeichen; der Kopf
 * schnitt sie auf „Buchungsstapel 2026-08-01 bis ", und das Enddatum fehlte in
 * genau der Zeile, an der man im DATEV-Stapelverzeichnis einen Stapel
 * erkennt. Geschrieben in der Hausschreibweise, weil die Bezeichnung ein
 * Text für Menschen ist; die Kopffelder `Datum von`/`Datum bis` tragen das
 * Datum daneben ohnehin maschinenlesbar.
 */
export function stapelBezeichnung(von: string, bis: string): string {
  const deutsch = (iso: string): string => {
    const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
    if (treffer === null) throw new ExtfFehler(`"${iso}" ist kein ISO-Datum.`);
    return `${treffer[3]!}.${treffer[2]!}.${treffer[1]!}`;
  };
  return `Stapel ${deutsch(von)}-${deutsch(bis)}`;
}

/** `2026-08-15` → `20260815`. Die Kopffelder tragen das volle Datum. */
export function vollesDatumText(iso: string): string {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (treffer === null) throw new ExtfFehler(`"${iso}" ist kein ISO-Datum.`);
  return `${treffer[1]!}${treffer[2]!}${treffer[3]!}`;
}

/**
 * Ein Textfeld, wie DATEV es liest: in Anführungszeichen, und ein enthaltenes
 * Anführungszeichen verdoppelt.
 *
 * **Und ohne Semikolon, Zeilenumbruch oder Anführungszeichen im Ergebnis, die
 * das Feld verlassen könnten.** Ein Buchungstext stammt aus einem Formular;
 * ein `"` darin, das nicht verdoppelt wird, verschiebt jedes folgende Feld —
 * still, und in einer Datei, die niemand Zeile für Zeile liest. Steuerzeichen
 * fallen weg, statt die Zeile zu zerreissen.
 */
export function textFeld(wert: string | null, maximum: number): string {
  if (wert === null || wert === '') return '';
  /*
   * Eine FOLGE von Steuerzeichen wird EIN Leerzeichen, nicht eines je
   * Zeichen: ein CRLF ist ein Umbruch, und zwei Leerzeichen daraus zu
   * machen hiesse, dass derselbe Text je nach Betriebssystem des
   * Erfassenden verschieden in der Datei steht.
   */
  const einzeilig = wert.replace(/[\r\n\t]+/gu, ' ');
  /*
   * **Erst kürzen, DANN maskieren (V-211).** Die erste Fassung verdoppelte
   * zuerst und schnitt danach. Fiel der Schnitt zwischen die beiden Zeichen
   * eines verdoppelten `""`, endete das Feld auf `"` + schliessendem `"` —
   * für DATEV ein maskiertes Zeichen statt des Feldendes. Das Feld blieb
   * offen, und jedes folgende `;` der Zeile gehörte zum Buchungstext. Und
   * jeder Text mit Anführungszeichen verlor still so viele Zeichen, wie er
   * Anführungszeichen trug.
   *
   * Die Länge, die DATEV vorgibt, ist die des INHALTS. Gezählt wird in
   * Codepunkten (`Array.from`), nicht in UTF-16-Einheiten: ein Schnitt
   * mitten in einem Ersatzpaar hinterliesse ein halbes Zeichen.
   */
  const gekuerzt = Array.from(einzeilig).slice(0, maximum).join('');
  return `"${gekuerzt.replace(/"/gu, '""')}"`;
}

/** Ein Zahlenfeld ohne Anführungszeichen — leer, wenn es keines gibt. */
function zahlFeld(wert: string | null): string {
  return wert ?? '';
}

// ---------------------------------------------------------------------------
// Die Zeile
// ---------------------------------------------------------------------------

export interface ExtfBuchung {
  readonly umsatzCent: bigint;
  readonly sollHaben: 'soll' | 'haben';
  readonly konto: string;
  readonly gegenkonto: string | null;
  readonly buSchluessel: string | null;
  /** ISO-Datum. */
  readonly belegdatum: string;
  readonly belegfeld1: string | null;
  readonly belegfeld2: string | null;
  readonly buchungstext: string | null;
  /** ISO-Datum oder null. */
  readonly leistungsdatum: string | null;
  readonly festgeschrieben: boolean;
  /** Die Kennung der Buchungszeile — als `Buchungs GUID` wiederauffindbar. */
  readonly buchungssatzId: string;
}

export interface ExtfKopf {
  readonly beraterNummer: string;
  readonly mandantenNummer: string;
  /** ISO-Datum des Wirtschaftsjahresbeginns. */
  readonly wjBeginn: string;
  readonly sachkontenlaenge: number;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly kontenrahmen: string;
  readonly festschreibung: boolean;
  /** Wer den Export ausgelöst hat — DATEV führt das Feld, also steht es da. */
  readonly exportiertVon: string;
  /** Der Erzeugungszeitpunkt, HEREINGEGEBEN — nie aus der Uhr dieser Datei. */
  readonly erzeugtAm: Date;
}

/**
 * Die Kopfzeile.
 *
 * `erzeugtAm` kommt von aussen und wird nicht hier gelesen: derselbe Zeitraum
 * zweimal exportiert muss identische Bytes ergeben (Abnahme (3)), und ein
 * `new Date()` in dieser Funktion machte das unmöglich.
 */
export function baueKopf(k: ExtfKopf): string {
  const z = (n: number, stellen: number): string => String(n).padStart(stellen, '0');
  const stempel = `${z(k.erzeugtAm.getUTCFullYear(), 4)}${z(k.erzeugtAm.getUTCMonth() + 1, 2)}`
    + `${z(k.erzeugtAm.getUTCDate(), 2)}${z(k.erzeugtAm.getUTCHours(), 2)}`
    + `${z(k.erzeugtAm.getUTCMinutes(), 2)}${z(k.erzeugtAm.getUTCSeconds(), 2)}`
    + `${z(k.erzeugtAm.getUTCMilliseconds(), 3)}`;

  const felder = [
    '"EXTF"', FORMAT_VERSION, '21', '"Buchungsstapel"', '13',
    stempel, '', '"RE"', textFeld(k.exportiertVon, 25), '',
    k.beraterNummer, k.mandantenNummer, vollesDatumText(k.wjBeginn),
    String(k.sachkontenlaenge),
    vollesDatumText(k.von), vollesDatumText(k.bis),
    textFeld(k.bezeichnung, BEZEICHNUNG_HOECHSTENS), '', '1', '0',
    k.festschreibung ? '1' : '0', '"EUR"', '', '', '', '',
    textFeld(k.kontenrahmen.toUpperCase().replace(/^SKR/u, ''), 4), '', '', '', '',
  ];

  if (felder.length !== KOPF_FELDER.length) {
    throw new ExtfFehler(
      `Die Kopfzeile hat ${String(felder.length)} Felder, die Beschreibung `
      + `${String(KOPF_FELDER.length)}. DATEV liest nach Position.`);
  }
  return felder.join(TRENNER);
}

/** Eine Datenzeile — immer so viele Felder wie `SPALTEN`. */
export function baueZeile(b: ExtfBuchung): string {
  const felder: string[] = new Array<string>(SPALTEN.length).fill('');

  const setze = (spalte: string, wert: string): void => {
    const stelle = SPALTEN.indexOf(spalte);
    /*
     * Ein Tippfehler im Spaltennamen ergäbe -1, und `felder[-1] = …` legte
     * still eine Eigenschaft an, die nie in der Datei landet: ein Feld fehlte
     * und niemand sähe es. Deshalb der Wurf.
     */
    if (stelle === -1) throw new ExtfFehler(`Unbekannte EXTF-Spalte: ${spalte}`);
    felder[stelle] = wert;
  };

  setze('Umsatz (ohne Soll/Haben-Kz)', betragText(b.umsatzCent));
  setze('Soll/Haben-Kennzeichen', b.sollHaben === 'soll' ? '"S"' : '"H"');
  setze('WKZ Umsatz', '"EUR"');
  setze('Konto', b.konto);
  setze('Gegenkonto (ohne BU-Schlüssel)', zahlFeld(b.gegenkonto));
  setze('BU-Schlüssel', zahlFeld(b.buSchluessel));
  setze('Belegdatum', belegdatumText(b.belegdatum));
  setze('Belegfeld 1', textFeld(b.belegfeld1, 36));
  setze('Belegfeld 2', textFeld(b.belegfeld2, 12));
  setze('Buchungstext', textFeld(b.buchungstext, 60));
  setze('Festschreibung', b.festgeschrieben ? '1' : '0');
  if (b.leistungsdatum !== null) {
    setze('Leistungsdatum', vollesDatumText(b.leistungsdatum));
  }
  /*
   * Die eigene Kennung reist mit. Sie ist der einzige Weg, eine Zeile in der
   * Exportdatei einer Zeile in `buchungssatz` zuzuordnen — ohne sie liesse
   * sich der Rückweg (Abnahme (3)) nur über Betrag und Datum raten, und zwei
   * gleich hohe Buchungen am selben Tag sind der Normalfall.
   */
  setze('Buchungs GUID', textFeld(b.buchungssatzId, 36));

  return felder.join(TRENNER);
}

/**
 * Die ganze Datei als Bytes.
 *
 * Kopfzeile, Spaltenzeile, Datenzeilen — jede mit CRLF abgeschlossen, auch
 * die letzte. Kein BOM: CP1252 hat keines, und ein vorangestelltes `EF BB BF`
 * (die UTF-8-Marke) liest DATEV als drei Zeichen vor dem `EXTF`.
 */
export function schreibeExtf(
  kopf: ExtfKopf, buchungen: readonly ExtfBuchung[],
): Uint8Array {
  const zeilen = [
    baueKopf(kopf),
    SPALTEN.join(TRENNER),
    ...buchungen.map(baueZeile),
  ];
  return nachCp1252(zeilen.map((z) => z + ZEILENENDE).join(''));
}
