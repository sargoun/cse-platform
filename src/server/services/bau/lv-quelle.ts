/**
 * Woher ein Leistungsverzeichnis kommt — hinter EINER Schnittstelle
 * (BAU-01, REQ-04, 03-GEWERKE §7.4/§7.5).
 *
 * **Das Austauschformat ist eine offene Frage und keine technische Wahl.**
 * GAEB DA XML (X83 Leistungsverzeichnis, X84 Angebotsaufforderung), GAEB D8x,
 * Excel oder PDF — jedes davon kommt auf einer Berliner Baustelle vor, und
 * welches der Auftraggeber schickt, entscheidet nicht diese Datei.
 * // TODO(client, O-41): In welchem Format kommen die Leistungsverzeichnisse
 * an — GAEB DA XML (X83/X84), GAEB D8x, Excel oder PDF?
 *
 * **Warum kein halbfertiger GAEB-Leser daneben steht.** Ein Leser, der die
 * erste Ebene versteht, Zuschlags- und Bedarfspositionen uebersieht und
 * trotzdem „gelesen" meldet, ist teurer als gar keiner: die Vorschau sieht
 * ordentlich aus (sie zeigt ja genau das, was gelesen wurde), das
 * Leistungsverzeichnis ist unvollstaendig, und der Fehler faellt in der
 * Schlussrechnung auf. Deshalb gilt hier dieselbe Regel wie beim
 * Raumbuch-Import (0026, `api/raumbuch-import`): implementiert ist EIN
 * Format, jedes andere wird ABGEWIESEN — mit Namen und Begruendung, nie
 * simuliert (CLAUDE.md: keine vorgetaeuschten Integrationen).
 *
 * Implementiert ist `csv_semikolon`: die Form, in die sich jedes der vier
 * Formate exportieren laesst und die Excel im deutschen Sprachraum von selbst
 * schreibt. Sie ist die BRUECKE, nicht die Antwort.
 */
import { alsNumerisch, leseCsv, leseZahl, TabellenFehler } from '../raumbuch/tabelle.js';
import type { LvArt, LvPositionsart } from './lv.js';

/** `lv_import_format` (0212). */
export type LvFormat =
  | 'csv_semikolon' | 'gaeb_da_xml' | 'gaeb_d83' | 'gaeb_d84' | 'excel' | 'pdf';

export const LV_FORMATE: readonly LvFormat[] =
  ['csv_semikolon', 'gaeb_da_xml', 'gaeb_d83', 'gaeb_d84', 'excel', 'pdf'];

export const LV_FORMAT_TEXT: Readonly<Record<LvFormat, string>> = {
  csv_semikolon: 'CSV, Semikolon-getrennt (implementiert)',
  gaeb_da_xml: 'GAEB DA XML (X83/X84) — nicht implementiert (O-41)',
  gaeb_d83: 'GAEB D83 — nicht implementiert (O-41)',
  gaeb_d84: 'GAEB D84 — nicht implementiert (O-41)',
  excel: 'Excel (.xlsx) — nicht implementiert (O-41)',
  pdf: 'PDF — nicht implementiert (O-41)',
};

export function istLvFormat(wert: unknown): wert is LvFormat {
  return typeof wert === 'string' && (LV_FORMATE as readonly string[]).includes(wert);
}

export class LvQuelleFehler extends Error {
  readonly status: number;
  constructor(
    readonly grund: 'nicht_implementiert' | 'leer' | 'format' | 'kopfzeile',
    nachricht: string,
    status = 415,
  ) {
    super(nachricht);
    this.name = 'LvQuelleFehler';
    this.status = status;
  }
}

/** Eine gelesene Zeile — noch NICHT gegen das Projekt geprueft. */
export interface QuellZeile {
  readonly zeilennummer: number;
  /** Die unveraenderte Quellzeile — der Nachweis, WAS hochgeladen wurde. */
  readonly rohdaten: Readonly<Record<string, string>>;
  readonly oz: string | null;
  readonly art: LvArt | null;
  readonly positionsart: LvPositionsart;
  readonly kurztext: string | null;
  readonly langtext: string | null;
  readonly einheit: string | null;
  /** In der Form, die `numeric(12,3)` erwartet — oder `null`. */
  readonly menge: string | null;
  /** Ganzzahlige Cent (Invariante 1) als Text — oder `null`. */
  readonly einheitspreisCent: string | null;
  /**
   * APR-03: wie sicher der Leser war. Bei einer CSV-Spalte, die woertlich
   * dasteht, bleibt sie `null` — eine erfundene 100 waere die Behauptung, ein
   * Modell habe geprueft.
   */
  readonly konfidenz: string | null;
  readonly fehler: readonly string[];
}

export interface QuellErgebnis {
  readonly kopf: readonly string[];
  readonly zeilen: readonly QuellZeile[];
}

/**
 * Ein Format, das gelesen werden kann.
 *
 * Die Schnittstelle nimmt den ROHTEXT und gibt Zeilen — sie kennt weder
 * Projekt noch Datenbank. Dadurch ist der Parser fuer sich testbar (am
 * Beispiel-LV), und der Dienst, der das Ergebnis ins Staging schreibt, bleibt
 * derselbe, wenn das Format wechselt.
 */
export interface LvQuelle {
  readonly format: LvFormat;
  /** Wahr, wenn dieses Format wirklich gelesen wird — nie vorgetaeuscht. */
  readonly implementiert: boolean;
  lese(inhalt: string): QuellErgebnis;
}

/* ---------------------------------------------------------------------------
 * Die Spaltenzuordnung der CSV-Bruecke
 * ------------------------------------------------------------------------ */

const SPALTEN = {
  oz: ['oz', 'ordnungszahl', 'position', 'positionsnummer', 'pos', 'nr'],
  art: ['art', 'ebene', 'typ', 'zeilenart'],
  positionsart: ['positionsart', 'kennzeichen', 'posart'],
  kurztext: ['kurztext', 'bezeichnung', 'text', 'titel'],
  langtext: ['langtext', 'beschreibung', 'leistungstext'],
  einheit: ['einheit', 'me', 'mengeneinheit', 'einh'],
  menge: ['menge', 'vertragsmenge', 'mengevertrag', 'lvmenge'],
  preis: ['einheitspreis', 'ep', 'preis', 'einzelpreis'],
} as const;

type Feld = keyof typeof SPALTEN;

/** Vergleichsform eines Spaltennamens: klein, ohne Trenner, ohne Umlaute. */
function normal(text: string): string {
  return text.toLowerCase()
    .replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u')
    .replaceAll('ß', 'ss').replaceAll('²', '2')
    .replace(/[^a-z0-9]/gu, '');
}

/**
 * Welche Quellspalte auf welches Feld zeigt — geraten, aber sichtbar.
 *
 * Erst die genaue Uebereinstimmung, dann die enthaltene (dieselbe Reihenfolge
 * wie in `raumbuch/import.ts`): sonst nimmt „Positionsart" die Spalte
 * „Position" weg, und die OZ landet nirgends.
 */
export function ordneSpaltenZu(
  kopf: readonly string[],
): Readonly<Partial<Record<Feld, string>>> {
  const zuordnung: Partial<Record<Feld, string>> = {};
  const belegt = new Set<string>();
  for (const feld of Object.keys(SPALTEN) as readonly Feld[]) {
    const worte = SPALTEN[feld].map(normal);
    const genau = kopf.find((s) => !belegt.has(s) && worte.includes(normal(s)));
    const treffer = genau
      ?? kopf.find((s) => !belegt.has(s) && worte.some((w) => normal(s).includes(w)));
    if (treffer !== undefined) { zuordnung[feld] = treffer; belegt.add(treffer); }
  }
  return zuordnung;
}

const ART_WORTE: Readonly<Record<string, LvArt>> = {
  los: 'los', gewerk: 'los',
  titel: 'titel',
  untertitel: 'untertitel', unterabschnitt: 'untertitel',
  position: 'position', pos: 'position', lvposition: 'position',
  hinweis: 'hinweistext', hinweistext: 'hinweistext', text: 'hinweistext',
};

const POSITIONSART_WORTE: Readonly<Record<string, LvPositionsart>> = {
  normal: 'normalposition', normalposition: 'normalposition', np: 'normalposition',
  bedarf: 'bedarfsposition', bedarfsposition: 'bedarfsposition', bp: 'bedarfsposition',
  eventual: 'bedarfsposition', eventualposition: 'bedarfsposition',
  alternativ: 'alternativposition', alternativposition: 'alternativposition',
  wahl: 'alternativposition', wahlposition: 'alternativposition',
  zuschlag: 'zuschlagsposition', zuschlagsposition: 'zuschlagsposition',
  grund: 'grundposition', grundposition: 'grundposition',
};

/**
 * Die Ebene, wenn die Quelle sie nicht nennt — **aus der OZ-Tiefe**.
 *
 * Eine OZ mit einer Stufe (`1`) ist ein Los, zwei ein Titel, drei ein
 * Untertitel, vier oder mehr eine Position — und eine Zeile mit Menge UND
 * Einheit ist immer eine Position, egal wie tief sie steht. Das ist eine
 * ABLEITUNG aus der Datei und keine Geschaeftsregel: sie steht hier, damit
 * eine Quelle ohne Artspalte nicht jede Zeile als Position ausgibt (und damit
 * jeden Titel mit einer Menge belegt). Die Vorschau zeigt das Ergebnis, ein
 * Mensch sieht es, und die Uebernahme schreibt erst danach.
 */
function arteAus(
  oz: string | null, menge: string | null, einheit: string | null,
): LvArt | null {
  if (menge !== null && einheit !== null) return 'position';
  if (oz === null || oz.trim() === '') return null;
  const stufen = oz.trim().split('.').filter((s) => s !== '').length;
  if (stufen <= 1) return 'los';
  if (stufen === 2) return 'titel';
  if (stufen === 3) return 'untertitel';
  return 'position';
}

/**
 * Cent aus einem Preisfeld — ueber `leseZahl` (Tausendstel) und dann auf Cent.
 *
 * **Die Rundung ist hier eine ABLEHNUNG, keine Rundung.** Ein Einheitspreis
 * mit einer dritten Dezimalstelle (`12,345 €`) ist entweder ein Tippfehler
 * oder eine andere Waehrungseinheit; ihn auf 1234 oder 1235 Cent zu
 * runden hiesse, sich fuer den Auftraggeber zu entscheiden. Die Zeile bekommt
 * einen Fehler und die Vorschau zeigt ihn.
 */
function centAus(roh: string): { readonly cent: string | null; readonly fehler: string | null } {
  const befund = leseZahl(roh);
  if (befund.wert === null) {
    return roh.trim() === ''
      ? { cent: null, fehler: null }
      : { cent: null, fehler: `„${roh.trim()}" ist kein Einheitspreis.` };
  }
  if (befund.wert % 10n !== 0n) {
    return {
      cent: null,
      fehler: `Einheitspreis „${roh.trim()}" hat mehr als zwei Dezimalstellen — `
        + 'die Anwendung rundet ihn nicht (Invariante 1).',
    };
  }
  return { cent: (befund.wert / 10n).toString(), fehler: null };
}

/* ---------------------------------------------------------------------------
 * Die eine implementierte Quelle
 * ------------------------------------------------------------------------ */

/**
 * CSV mit Semikolon — die Bruecke, bis O-41 beantwortet ist.
 *
 * Der Leser selbst ist NICHT nachgebaut: `leseCsv` aus
 * `raumbuch/tabelle.ts` erkennt das Trennzeichen ausserhalb von
 * Anfuehrungszeichen, versteht doppelte Anfuehrungszeichen und wirft das BOM
 * von Excel weg. Ein zweiter CSV-Leser waere ein zweiter Satz Fehler an
 * derselben Stelle.
 */
export const CSV_QUELLE: LvQuelle = {
  format: 'csv_semikolon',
  implementiert: true,
  lese(inhalt: string): QuellErgebnis {
    let tabelle;
    try {
      tabelle = leseCsv(inhalt);
    } catch (fehler: unknown) {
      if (fehler instanceof TabellenFehler) {
        throw new LvQuelleFehler(
          fehler.grund === 'leer' ? 'leer' : 'format', fehler.message, 422,
        );
      }
      throw fehler;
    }

    const zu = ordneSpaltenZu(tabelle.kopf);
    if (zu.oz === undefined || zu.kurztext === undefined) {
      throw new LvQuelleFehler(
        'kopfzeile',
        'In der Kopfzeile fehlt die Ordnungszahl oder der Kurztext. Erwartet werden '
        + 'Spalten wie OZ, Kurztext, Einheit, Menge, Einheitspreis.',
        422,
      );
    }

    const wert = (zeile: Readonly<Record<string, string>>, feld: Feld): string => {
      const spalte = zu[feld];
      return spalte === undefined ? '' : (zeile[spalte] ?? '').trim();
    };

    const zeilen = tabelle.zeilen.map((zeile, index): QuellZeile => {
      const fehler: string[] = [];
      const oz = wert(zeile, 'oz');
      const kurztext = wert(zeile, 'kurztext');
      const einheit = wert(zeile, 'einheit');

      const mengeRoh = wert(zeile, 'menge');
      const mengeBefund = leseZahl(mengeRoh);
      if (mengeRoh !== '' && mengeBefund.wert === null) {
        fehler.push(`„${mengeRoh}" ist keine Menge.`);
      }
      if (mengeBefund.mehrdeutig && mengeBefund.deutung !== null) {
        fehler.push(`Menge mehrdeutig, gelesen als ${mengeBefund.deutung}.`);
      }
      const menge = mengeBefund.wert === null ? null : alsNumerisch(mengeBefund.wert);

      const preis = centAus(wert(zeile, 'preis'));
      if (preis.fehler !== null) fehler.push(preis.fehler);

      const artRoh = normal(wert(zeile, 'art'));
      const art = (artRoh === '' ? null : ART_WORTE[artRoh] ?? null)
        ?? arteAus(oz === '' ? null : oz, menge, einheit === '' ? null : einheit);

      const posartRoh = normal(wert(zeile, 'positionsart'));
      const positionsart: LvPositionsart = posartRoh === ''
        ? 'unbestimmt'
        : POSITIONSART_WORTE[posartRoh] ?? 'unbestimmt';
      if (posartRoh !== '' && POSITIONSART_WORTE[posartRoh] === undefined) {
        fehler.push(
          `Positionsart „${wert(zeile, 'positionsart')}" ist unbekannt — die Zeile `
          + 'bleibt „unbestimmt" (offene Frage O-155).',
        );
      }

      if (oz === '') fehler.push('Ohne Ordnungszahl lässt sich die Zeile nicht einordnen.');
      if (kurztext === '') fehler.push('Ohne Kurztext ist die Zeile keine LV-Zeile.');
      if (art === null) fehler.push('Die Art der Zeile (Los, Titel, Position) ist unklar.');
      /**
       * Die beiden Bedingungen der Tabelle, hier lesbar vorweggenommen:
       * `lvp_einheit_bei_position` und `lvp_menge_bei_position` (0071). Ohne
       * sie schlaegt die UEBERNAHME fehl — mitten in der Transaktion, nach
       * der Vorschau, die alles gruen zeigte.
       */
      if (art === 'position' && einheit === '') {
        fehler.push('Eine Position braucht eine Einheit.');
      }
      if (art === 'position' && menge === null) {
        fehler.push('Eine Position braucht eine Vertragsmenge.');
      }

      return {
        zeilennummer: index + 1,
        rohdaten: zeile,
        oz: oz === '' ? null : oz,
        art,
        positionsart,
        kurztext: kurztext === '' ? null : kurztext,
        langtext: wert(zeile, 'langtext') === '' ? null : wert(zeile, 'langtext'),
        einheit: einheit === '' ? null : einheit,
        menge,
        einheitspreisCent: preis.cent,
        // CSV ist woertlich gelesen, nicht extrahiert (APR-03).
        konfidenz: null,
        fehler,
      };
    });

    return { kopf: tabelle.kopf, zeilen };
  },
};

/**
 * Ein Format, das es gibt und das wir NICHT lesen.
 *
 * Es wirft — mit dem Namen des Formats und dem Hinweis auf die offene Frage.
 * Das ist der ganze Zweck: die Auswahl in der Oberflaeche nennt alle Formate
 * (damit sichtbar ist, was noch fehlt), und der Versuch endet in einer
 * Auskunft statt in einem halb gelesenen Leistungsverzeichnis.
 */
function nichtImplementiert(format: LvFormat): LvQuelle {
  return {
    format,
    implementiert: false,
    lese(): QuellErgebnis {
      throw new LvQuelleFehler(
        'nicht_implementiert',
        `${LV_FORMAT_TEXT[format]} wird nicht gelesen. Bis zur Antwort auf O-41 `
        + '(in welchem Format kommen die Leistungsverzeichnisse an?) nimmt der Import '
        + 'CSV mit Semikolon — bitte die Datei so exportieren.',
      );
    },
  };
}

/** Die Quelle zu einem Format — implementiert oder ausdruecklich nicht. */
export function lvQuelle(format: LvFormat): LvQuelle {
  return format === 'csv_semikolon' ? CSV_QUELLE : nichtImplementiert(format);
}
