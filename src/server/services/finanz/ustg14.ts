/**
 * Der §14-UStG-Vorabpruefer (FIN-04, FIN-05, FIN-13, LEG-05).
 *
 * `02-datenmodell/05-FINANZEN.md` §6, `04-SEITENKARTE.md` §5.14.2. **Ein
 * reiner Dienst** — Festschreibung, Vorschau und API rufen genau diese Datei,
 * und keine von ihnen fuehrt eine eigene Liste.
 *
 * Die Datei zerfaellt in drei Teile, und die Trennung ist der Punkt:
 *
 *  1. `REGELN` — die Regelliste als DATEN. Jede Regel traegt ihr Feld, ihre
 *     Fundstelle, ihre Stufe und die Frage, ob §33 UStDV sie entfallen laesst.
 *     Weil sie Daten sind, kann ein Test ueber sie iterieren; eine Kette von
 *     `if`-Zweigen liesse sich nur einzeln nachbauen, und die eine vergessene
 *     Regel faellt dann niemandem auf.
 *  2. `pruefePflichtfelder(eingabe)` — REIN. Keine Datenbank, keine Uhr, kein
 *     `fetch`. Ein Tisch voller Eingaben, ein Befund je Eingabe.
 *  3. `ladePruefEingabe(db, id)` / `pruefeRechnung(db, id)` — der Zugriff.
 *     Er liest, was Teil 2 braucht, und entscheidet nichts.
 *
 * **Was dieser Dienst nie tut: rechnen.** Er liest Zahlen, die
 * `services/finanz/geld.ts` und `steuer/satz.ts` erzeugt haben, und meldet,
 * ob sie da sind und zueinander passen (Invariante 6). Er schlaegt keinen
 * Betrag vor und fuellt kein Feld.
 *
 * **Und er ist nicht die Sicherung.** Die Bedingung haelt die Datenbank
 * (`0104_rechnung_pflichtfelder.sql`): ein Aufrufer, der diesen Dienst
 * ueberspringt, bekommt beim COMMIT dieselbe Abweisung — nur ohne die
 * deutsche Feldliste, die ein Mensch lesen kann.
 */
import { type Cent, cent } from './geld.js';
import {
  offeneAbschlaege as ladeOffeneAbschlaege, offeneAbschlaegeSatz,
  type OffenerAbschlag,
} from './abschlag/index.js';
import { mengeAusPostgres, type MilliMenge } from './menge.js';
import type { Anschrift } from './kanonisch.js';
import {
  fehlendePflichtfelder, type FehlendesFeld, type XRechnungEingabe,
} from './xrechnung/index.js';

/**
 * Der schmale Treiberausschnitt, den jeder Dienst hier benutzt.
 *
 * Absichtlich hier noch einmal erklaert statt aus `rechnung.ts` importiert:
 * `rechnung.ts` importiert diese Datei, und ein Rueckimport machte aus zwei
 * Dateien einen Ring.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Die Fassung des Regelwerks, die eingefroren wird.
 *
 * Sie steht im Snapshot (`rechnung_snapshot.regelwerk_version`), damit eine
 * Betriebspruefung 2032 sehen kann, WELCHE Regeln 2026 gelaufen sind. Sie
 * aendert sich, sobald eine Regel dazukommt, wegfaellt oder ihre Stufe
 * wechselt — nie stillschweigend.
 */
export const REGELWERK_VERSION = 'ustg14.v1' as const;

export type Befundstufe = 'fehler' | 'warnung';

/** Ein einzelner Befund — Feld, Fundstelle, deutscher Satz, Sprungziel. */
export interface Befund {
  /** Der Feldschluessel, z. B. `leistender.anschrift`. Stabil, maschinenlesbar. */
  readonly feld: string;
  /** Die Fundstelle, z. B. `§14 Abs. 4 Nr. 1 UStG`. */
  readonly regel: string;
  /** Der Satz, den ein Mensch liest. Deutsch, und er nennt das Feld. */
  readonly textDe: string;
  /** DSH-04: der Datensatz, an dem sich der Mangel beheben laesst. */
  readonly link: string | null;
  readonly stufe: Befundstufe;
}

/** Eine Regel, die PR 47 ausdruecklich NICHT prueft — mit Grund. */
export interface NichtGeprueft {
  readonly regel: string;
  readonly grund: string;
  /**
   * Die Tabellen, deren FEHLEN diesen Eintrag begruendet — als Feld und nicht
   * als Fliesstext.
   *
   * Der erste Entwurf klaubte die Namen mit einem Ausdruck aus `grund`. Die
   * Gegenprobe im Test hat das sofort gemeldet: die Namen stehen dort in
   * Klammern, nicht in Backticks, und der Ausdruck fand zwei von sechs. Eine
   * Wache, die aus Prosa liest, prueft am Ende die Prosa.
   *
   * `tests/isolation/rechnung-pflichtfelder.test.ts` nimmt die Liste beim
   * Wort: gibt es eine dieser Tabellen, faellt der Eintrag — bei dem, der die
   * Tabelle anlegt, nicht bei dem Buchpruefer, der 2032 den eingefrorenen
   * Bericht liest.
   */
  readonly solangeOhne?: readonly string[];
}

export interface KleinbetragLage {
  /** Greift die Erleichterung des §33 UStDV auf DIESEN Beleg? */
  readonly greift: boolean;
  /** Die Schwelle, gegen die geprueft wurde — `null`, wenn es keine gibt. */
  readonly grenzeBruttoCent: Cent | null;
  readonly fundstelle: string | null;
  /** Ist die Schwelle noch unbestaetigt (O-175)? */
  readonly istPlatzhalter: boolean;
  /** Warum sie nicht greift — der Satz, den die Pruefseite zeigt. */
  readonly grund: string;
}

export interface PflichtfeldBericht {
  readonly geprueft: true;
  readonly regelwerkVersion: string;
  readonly fehler: readonly Befund[];
  readonly warnungen: readonly Befund[];
  readonly kleinbetrag: KleinbetragLage;
  readonly nichtGeprueft: readonly NichtGeprueft[];
}

// ---------------------------------------------------------------------------
// Die Eingabe — ein Tisch, keine Datenbank
// ---------------------------------------------------------------------------

export interface PruefBeteiligter {
  readonly name: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string | null;
  readonly ustId: string | null;
  readonly steuernummer: string | null;
}

export interface PruefPosition {
  readonly nr: number;
  /** `leistung · textzeile · zwischensumme`. */
  readonly art: string;
  readonly bezeichnung: string | null;
  /** In Tausendsteln (K-16). `null` auf einer Textzeile. */
  readonly mengeMilli: MilliMenge | null;
  readonly einheit: string | null;
  readonly hatMasseinheit: boolean;
  readonly nettoCent: Cent | null;
  readonly steuergruppe: string;
  readonly kategorie: string;
  /** LEG-05: laeuft der Satz vor dem Ende des Leistungszeitraums aus? */
  readonly gruppeGueltigBis: string | null;
}

export interface PruefSteuerzeile {
  readonly steuergruppe: string;
  readonly satzBp: number;
  readonly kategorie: string;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly befreiungsgrundText: string | null;
}

/** Der offene Kreis dieser Gesellschaft — §14 Abs. 4 Nr. 4 vor dem Zug. */
export interface PruefKreis {
  /**
   * O-01: `mandant.eigener_nummernkreis`. Eine ABTEILUNG stellt keine
   * Rechnungen aus, und das ist etwas anderes als „der Kreis fehlt noch" —
   * zwei verschiedene Menschen tun darauf zwei verschiedene Dinge.
   */
  readonly gesellschaftFakturiert: boolean;
  readonly vorhanden: boolean;
  readonly bezeichnung: string | null;
  readonly istPlatzhalter: boolean;
  readonly lueckenlos: boolean;
  readonly geschlossen: boolean;
}

export interface PruefGrenze {
  readonly grenzeBruttoCent: Cent;
  readonly fundstelle: string;
  readonly istPlatzhalter: boolean;
}

/**
 * Was die XRechnung zu dieser Rechnung sagt — VOR dem Festschreiben.
 *
 * **Warum das eine Regel der Vorpruefung ist und nicht erst des
 * Herunterladens.** FIN-11 macht die XRechnung zum EINZIGEN Weg, einen
 * oeffentlichen Auftraggeber abzurechnen. Faellt erst beim Herunterladen auf,
 * dass BT-41 oder die Leitweg-ID fehlt, ist die Rechnung laengst
 * festgeschrieben: unveraenderlich, mit gezogener Nummer, in der Kette. Der
 * einzige Ausweg waere dann ein Storno und eine neue Rechnung — wegen einer
 * fehlenden Telefonnummer.
 *
 * `pflicht` ist NICHT „der Kunde ist eine Behoerde". Es ist, was auf dem
 * Kundenstamm steht: `xrechnung_pflicht` oder
 * `ist_oeffentlicher_auftraggeber`. Beides pflegt ein Mensch; die Plattform
 * leitet es nirgends her.
 */
export interface XRechnungLage {
  readonly pflicht: boolean;
  readonly fehlend: readonly FehlendesFeld[];
}

export interface PruefEingabe {
  readonly rechnungId: string;
  readonly mandantSlug: string;
  readonly kundeId: string;
  readonly rechnungsart: string;
  /** Das Datum, das die Festschreibung stempeln wird (`app.berlin_heute()`). */
  readonly rechnungsdatum: string | null;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly vereinnahmungGeplantAm: string | null;
  readonly zahlungszielTage: number | null;
  readonly nettoGesamtCent: Cent;
  readonly steuerGesamtCent: Cent;
  readonly bruttoCent: Cent;
  readonly leistender: PruefBeteiligter;
  readonly empfaenger: PruefBeteiligter;
  /** `firma · behoerde · privat` — §14 Abs. 4 Nr. 9 haengt daran. */
  readonly empfaengerTyp: string;
  readonly positionen: readonly PruefPosition[];
  readonly steuerzeilen: readonly PruefSteuerzeile[];
  readonly kreis: PruefKreis;
  readonly kleinbetragGrenze: PruefGrenze | null;
  /**
   * Die Abschläge dieses Auftrags, die diese Rechnung NICHT abzieht (FIN-08).
   *
   * Leer bei allem, was keine Schlussrechnung ist — `offeneAbschlaege` kehrt
   * dort in einer Abfrage wieder um. Sie steht in der EINGABE und nicht in
   * der Regel, weil die Regeln rein sind: was die Datenbank weiss, bringt
   * `ladePruefEingabe` mit.
   */
  readonly offeneAbschlaege: readonly OffenerAbschlag[];
  /** Die XRechnung-Lage (FIN-11) — siehe `XRechnungLage`. */
  readonly xrechnung: XRechnungLage;
}

// ---------------------------------------------------------------------------
// §33 UStDV — wann die Erleichterung greift (FIN-13)
// ---------------------------------------------------------------------------

/**
 * Die Schwelle kommt aus `kleinbetrag_grenze` und steht NICHT als Konstante
 * im Code. Das ist keine Formsache: `ist_kleinbetrag` wird beim Festschreiben
 * eingefroren, und gegen eine einkompilierte Zahl geprueft wuerde am Tag einer
 * Gesetzesaenderung jede historische Rechnung neu bewertet.
 *
 * Drei Gruende, aus denen sie NICHT greift, und jeder wird benannt:
 *  · es gibt keine Schwellenzeile fuer das Ausstellungsdatum;
 *  · die Zeile ist noch ein Platzhalter (O-175) — ob die Gruppe von §33 UStDV
 *    ueberhaupt Gebrauch macht, hat niemand entschieden, und viele
 *    gewerbliche Kunden weisen eine Kleinbetragsrechnung zurueck;
 *  · der Beleg traegt eine Steuergruppe der Kategorie `AE` (§13b) oder `K`
 *    (innergemeinschaftlich) — §33 UStDV nimmt genau diese Faelle aus.
 *
 * Die dritte Bedingung steht wortgleich in `fin.kleinbetrag_greift` (0085).
 * Zwei Fassungen ohne gemeinsamen Test waeren zwei Auslegungen des §33 UStDV;
 * `tests/isolation/rechnung-pflichtfelder.test.ts` haelt sie gegeneinander.
 */
export function kleinbetragLage(eingabe: PruefEingabe): KleinbetragLage {
  const g = eingabe.kleinbetragGrenze;
  const betrag = eingabe.bruttoCent < 0n ? -eingabe.bruttoCent : eingabe.bruttoCent;

  if (g === null) {
    return {
      greift: false, grenzeBruttoCent: null, fundstelle: null, istPlatzhalter: false,
      grund: 'Für das Rechnungsdatum ist keine Kleinbetragsgrenze hinterlegt (§33 UStDV).',
    };
  }
  const basis = {
    grenzeBruttoCent: g.grenzeBruttoCent,
    fundstelle: g.fundstelle,
    istPlatzhalter: g.istPlatzhalter,
  };
  if (g.istPlatzhalter) {
    return {
      ...basis, greift: false,
      grund: 'Die Kleinbetragsgrenze ist ein unbestätigter Wert (O-175) — solange '
        + 'niemand entschieden hat, ob die Gruppe Kleinbetragsrechnungen ausstellt, '
        + 'gelten die vollen Pflichtangaben.',
    };
  }
  /**
   * **`>=` und nicht `>`** (D-322). SPEC FIN-13 sagt „Kleinbetragsrechnung
   * < €250", §33 UStDV sagt „deren Gesamtbetrag 250 Euro nicht übersteigt" —
   * bei genau 250,00 € gehen die zwei Lesarten um einen Cent auseinander.
   * Genommen wird die strengere: eine Rechnung mit vollständigen
   * Empfängerangaben ist nie rechtswidrig, eine zu Unrecht als Kleinbetrag
   * ausgestellte schon. Dieselbe Auslegung steht in `fin.kleinbetrag_greift`
   * (0085), damit der Auslöser nicht anders entscheidet als dieser Dienst.
   * // TODO(client, O-301): Gilt bei genau 250,00 € brutto die Erleichterung
   * des §33 UStDV?
   */
  if (betrag >= g.grenzeBruttoCent) {
    return {
      ...basis, greift: false,
      grund: `Der Bruttobetrag erreicht die Grenze des ${g.fundstelle} — die `
        + 'Erleichterung gilt nur unterhalb (O-301).',
    };
  }
  const ausgenommen = eingabe.steuerzeilen.some(
    (s) => (s.kategorie === 'AE' || s.kategorie === 'K')
      && (s.nettoCent !== 0n || s.steuerCent !== 0n),
  );
  if (ausgenommen) {
    return {
      ...basis, greift: false,
      grund: '§33 UStDV gilt nicht für die Fälle des §13b UStG und die '
        + 'innergemeinschaftliche Lieferung — die Empfängerangaben bleiben Pflicht.',
    };
  }
  return {
    ...basis, greift: true,
    grund: `Der Bruttobetrag liegt unter der Grenze des ${g.fundstelle}.`,
  };
}

// ---------------------------------------------------------------------------
// Die Regelliste (§6)
// ---------------------------------------------------------------------------

interface Regel {
  readonly feld: string;
  readonly regel: string;
  readonly stufe: Befundstufe;
  /**
   * Laesst §33 UStDV diese Regel bei einer Kleinbetragsrechnung entfallen?
   *
   * **Die fortlaufende Nummer steht hier ausdruecklich auf `false`.** Sie hat
   * keinen empfaengerbezogenen Teil, und die Lueckenlosigkeit des §14 Abs. 4
   * Nr. 4 UStG gilt fuer jeden ausgestellten Beleg. Die aeltere Lesart
   * „Regeln 2 und 5 entfallen" hat eine Regel genannt, die gar keinen solchen
   * Teil hat — und waere als Erlaubnis zu lesen gewesen, eine Rechnung ohne
   * Nummer auszustellen.
   */
  readonly kleinbetragEntfaellt: boolean;
  /** Jeder zurueckgegebene Satz wird ein eigener Befund. */
  readonly pruefe: (e: PruefEingabe, lage: KleinbetragLage) => readonly string[];
  readonly link?: (e: PruefEingabe) => string;
}

const leer: readonly string[] = [];
const istLeer = (wert: string | null): boolean => (wert ?? '').trim() === '';

function fehlendeAnschrift(b: PruefBeteiligter): readonly string[] {
  const fehlt: string[] = [];
  if (istLeer(b.strasse)) fehlt.push('Straße');
  if (istLeer(b.plz)) fehlt.push('PLZ');
  if (istLeer(b.ort)) fehlt.push('Ort');
  return fehlt;
}

const gesellschaft = (e: PruefEingabe): string =>
  `/portal/${e.mandantSlug}/einstellungen/mandant`;
const kunde = (e: PruefEingabe): string =>
  `/portal/${e.mandantSlug}/crm/kunden/${e.kundeId}`;
const beleg = (e: PruefEingabe): string =>
  `/portal/${e.mandantSlug}/finanzen/rechnungen/${e.rechnungId}`;
const kreise = (e: PruefEingabe): string =>
  `/portal/${e.mandantSlug}/finanzen/nummernkreise`;
/**
 * Der Kopf des Entwurfs auf dem Rechnungsblatt (V-204, D-697). Bis dahin
 * verwiesen Leistungszeitraum und Zahlungsziel auf ein Blatt, das beides nur
 * ANZEIGTE — der Verweis fuehrte an die Stelle, an der man es nicht aendern
 * konnte.
 */
const kopf = (e: PruefEingabe): string => `${beleg(e)}#kopf`;

/**
 * **Die Liste, die die Abnahme meint** — ein Eintrag je §14-Abs.-4-Feld, in
 * der Reihenfolge des Gesetzes. `tests/kern/ustg14.test.ts` iteriert sie und
 * baut zu jedem Eintrag einen Beleg, dem genau dieses eine Feld fehlt.
 */
export const REGELN: readonly Regel[] = [
  {
    feld: 'leistender.name',
    regel: '§14 Abs. 4 Nr. 1 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: gesellschaft,
    pruefe: (e) => istLeer(e.leistender.name)
      ? ['Der vollständige Name der ausstellenden Gesellschaft fehlt.']
      : leer,
  },
  {
    feld: 'leistender.anschrift',
    regel: '§14 Abs. 4 Nr. 1 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: gesellschaft,
    pruefe: (e) => {
      const fehlt = fehlendeAnschrift(e.leistender);
      return fehlt.length === 0 ? leer
        : [`Der Anschrift der ausstellenden Gesellschaft fehlt: ${fehlt.join(', ')}.`];
    },
  },
  {
    /**
     * O-24. **Kein Vorgabewert und keine leere Zeichenkette.** Eine Rechnung
     * ohne diese Angabe berechtigt den Empfaenger nicht zum Vorsteuerabzug,
     * und eine erfundene Nummer waere schlimmer als gar keine.
     */
    feld: 'leistender.steuernummer',
    regel: '§14 Abs. 4 Nr. 2 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: gesellschaft,
    pruefe: (e) =>
      istLeer(e.leistender.ustId) && istLeer(e.leistender.steuernummer)
        ? ['Die Gesellschaft führt weder Steuernummer noch USt-IdNr. Ohne eine '
          + 'der beiden Angaben berechtigt die Rechnung den Empfänger nicht zum '
          + 'Vorsteuerabzug (O-24).']
        : leer,
  },
  {
    feld: 'rechnungsdatum',
    regel: '§14 Abs. 4 Nr. 3 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => istLeer(e.rechnungsdatum)
      ? ['Das Ausstellungsdatum fehlt. Es wird beim Festschreiben aus dem '
        + 'Berliner Kalendertag gesetzt — fehlt es hier, ist der Tag nicht '
        + 'auflösbar.']
      : leer,
  },
  {
    /**
     * Zum Zeitpunkt der Pruefung gibt es noch KEINE Nummer — sie entsteht
     * erst in der Festschreibungstransaktion (§5.5). Geprueft wird deshalb,
     * ob eine entstehen KANN: ein offener, bestaetigter, lueckenloser Kreis.
     */
    feld: 'nummer',
    regel: '§14 Abs. 4 Nr. 4 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: kreise,
    pruefe: (e) => {
      if (!e.kreis.vorhanden) {
        /**
         * **Wortgleich mit `fin.rechnung_nummer_ziehen`** (0077). Die
         * Vorabpruefung faengt diesen Fall jetzt frueher ab als die
         * Datenbank; saehe ein Mensch deshalb einen ANDEREN Satz, haette die
         * Reihenfolge der Pruefungen die Erklaerung veraendert.
         */
        if (!e.kreis.gesellschaftFakturiert) {
          return [`Rechnungskreis für ${e.leistender.name ?? ''} nicht freigegeben. `
            + 'O-01 ist offen: eine Abteilung fakturiert über eine der drei '
            + 'Gesellschaften, nicht unter eigener Nummer.'];
        }
        return ['Diese Gesellschaft hat keinen offenen Rechnungsnummernkreis. '
          + 'Ohne ihn entsteht keine fortlaufende Nummer (FIN-03, O-134).'];
      }
      const befunde: string[] = [];
      if (e.kreis.istPlatzhalter) {
        befunde.push(`Der Nummernkreis „${e.kreis.bezeichnung ?? ''}" ist noch ein `
          + 'unbestätigter Platzhalter — Maske und Rücksetzung hat niemand '
          + 'bestätigt (O-134). Eine Nummer aus ihm wäre eine erfundene.');
      }
      if (!e.kreis.lueckenlos) {
        befunde.push(`Der Nummernkreis „${e.kreis.bezeichnung ?? ''}" ist nicht als `
          + 'lückenlos gekennzeichnet. §14 Abs. 4 Nr. 4 UStG verlangt eine '
          + 'einmalig vergebene, fortlaufende Nummer.');
      }
      if (e.kreis.geschlossen) {
        befunde.push(`Der Nummernkreis „${e.kreis.bezeichnung ?? ''}" ist geschlossen `
          + 'und vergibt keine Nummern mehr.');
      }
      return befunde;
    },
  },
  {
    feld: 'empfaenger.name',
    regel: '§14 Abs. 4 Nr. 1 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: true,
    link: kunde,
    pruefe: (e) => istLeer(e.empfaenger.name)
      ? ['Der vollständige Name des Leistungsempfängers fehlt.']
      : leer,
  },
  {
    feld: 'empfaenger.anschrift',
    regel: '§14 Abs. 4 Nr. 1 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: true,
    link: kunde,
    pruefe: (e) => {
      const fehlt = fehlendeAnschrift(e.empfaenger);
      return fehlt.length === 0 ? leer
        : [`Der Anschrift des Leistungsempfängers fehlt: ${fehlt.join(', ')}.`];
    },
  },
  {
    /**
     * Menge und Art — und die Art heisst „handelsuebliche Bezeichnung".
     * `rp_leistung_vollstaendig` (0075) haelt dasselbe auf der Zeile; hier
     * steht es, weil ein Mensch die Positionsnummer genannt bekommen soll
     * statt eines CHECK-Namens.
     */
    feld: 'positionen',
    regel: '§14 Abs. 4 Nr. 5 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => {
      const zeilen = e.positionen.filter((p) => p.art === 'leistung');
      if (zeilen.length === 0) {
        return ['Die Rechnung hat keine Leistungsposition — es gibt nichts '
          + 'abzurechnen (Menge und Art der Leistung).'];
      }
      const befunde: string[] = [];
      for (const p of zeilen) {
        const fehlt: string[] = [];
        if (istLeer(p.bezeichnung)) fehlt.push('die handelsübliche Bezeichnung');
        if (p.mengeMilli === null || p.mengeMilli === 0n) fehlt.push('die Menge');
        if (istLeer(p.einheit) || !p.hatMasseinheit) fehlt.push('die Mengeneinheit');
        if (fehlt.length > 0) {
          befunde.push(`Position ${String(p.nr)}: es fehlt ${fehlt.join(' und ')}.`);
        }
      }
      return befunde;
    },
  },
  {
    /**
     * §14 Abs. 4 Nr. 6 UStG, ERSTE Alternative — und nur fuer die Belege, die
     * keine Vorauszahlungsrechnung sind. Eine unbedingte Pflicht machte jede
     * Abschlags- und Anzahlungsrechnung (FIN-08) unausstellbar, denn sie geht
     * hinaus, bevor irgendetwas geleistet ist.
     */
    feld: 'leistungszeitpunkt',
    regel: '§14 Abs. 4 Nr. 6 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: kopf,
    pruefe: (e) => {
      if (e.rechnungsart === 'abschlag' || e.rechnungsart === 'anzahlung') return leer;
      return istLeer(e.leistungVon) || istLeer(e.leistungBis)
        ? ['Der Leistungszeitraum fehlt. §14 Abs. 4 Nr. 6 UStG verlangt den '
          + 'Zeitpunkt der Lieferung oder sonstigen Leistung; er steht in '
          + '„Leistung von" und „Leistung bis".']
        : leer;
    },
  },
  {
    /**
     * §14 Abs. 4 Nr. 6 UStG, ZWEITE Alternative: der Hinweis auf die
     * Vorauszahlung. Eine Abschlags- oder Anzahlungsrechnung darf den
     * Leistungszeitraum weglassen — dann muss aber der Zeitpunkt der
     * VEREINNAHMUNG feststehen. Beides wegzulassen ist der Fall, den die
     * Datenbank in `rechnung_leistungszeitpunkt` (0075) ebenfalls abweist.
     */
    feld: 'vereinnahmung',
    regel: '§14 Abs. 4 Nr. 6 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: kopf,
    pruefe: (e) => {
      if (e.rechnungsart !== 'abschlag' && e.rechnungsart !== 'anzahlung') return leer;
      const hatZeitraum = !istLeer(e.leistungVon) && !istLeer(e.leistungBis);
      return hatZeitraum || !istLeer(e.vereinnahmungGeplantAm)
        ? leer
        : ['Diese Vorauszahlungsrechnung nennt weder einen Leistungszeitraum noch '
          + 'den Zeitpunkt der Vereinnahmung des Entgelts. §14 Abs. 4 Nr. 6 UStG '
          + 'verlangt eines von beiden.'];
    },
  },
  {
    /**
     * Das Entgelt, nach Steuersaetzen AUFGESCHLUESSELT. Genau diese Regel
     * laesst §33 UStDV bei der Kleinbetragsrechnung auf „Bruttobetrag und
     * Steuersatz" zusammenschrumpfen — nicht die Nummer, nicht der Satz.
     */
    feld: 'steuer.netto_je_gruppe',
    regel: '§14 Abs. 4 Nr. 7 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: true,
    link: beleg,
    pruefe: (e) => {
      const zeilen = e.positionen.filter((p) => p.art === 'leistung');
      if (zeilen.length === 0) return leer;
      const gebucht = new Set(e.steuerzeilen.map((s) => s.steuergruppe));
      const fehlend = [...new Set(zeilen.map((p) => p.steuergruppe))]
        .filter((g) => !gebucht.has(g));
      if (fehlend.length > 0) {
        return [`Für die Steuergruppe(n) ${fehlend.join(', ')} gibt es keine `
          + 'Steuerzeile — das Entgelt ist nicht nach Steuersätzen aufgeschlüsselt.'];
      }
      const summe = e.steuerzeilen.reduce((a, s) => a + s.nettoCent, 0n);
      return summe === e.nettoGesamtCent ? leer
        : [`Die Steuerzeilen tragen zusammen ein Entgelt von ${summe.toString()} Cent, `
          + `der Rechnungskopf weist ${e.nettoGesamtCent.toString()} Cent aus.`];
    },
  },
  {
    feld: 'steuer.satz_und_betrag',
    regel: '§14 Abs. 4 Nr. 8 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => {
      if (e.steuerzeilen.length === 0) {
        return ['Die Rechnung weist keinen Steuersatz und keinen Steuerbetrag aus.'];
      }
      const summe = e.steuerzeilen.reduce((a, s) => a + s.steuerCent, 0n);
      return summe === e.steuerGesamtCent ? leer
        : [`Die ausgewiesenen Steuerbeträge ergeben ${summe.toString()} Cent, der `
          + `Rechnungskopf weist ${e.steuerGesamtCent.toString()} Cent aus.`];
    },
  },
  {
    /**
     * „… oder im Fall einer Steuerbefreiung ein Hinweis darauf." Eine
     * Steuergruppe ausserhalb des Regelsatzes OHNE gedruckten Grund ergibt
     * einen Beleg, der an §14 UStG und am KoSIT-Pruefer gleichermassen
     * scheitert. Sie entfaellt auch bei der Kleinbetragsrechnung nicht: §33
     * UStDV nennt den Befreiungshinweis ausdruecklich weiter.
     */
    feld: 'steuer.befreiungshinweis',
    regel: '§14 Abs. 4 Nr. 8 UStG',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => e.steuerzeilen
      .filter((s) => s.kategorie !== 'S' && istLeer(s.befreiungsgrundText))
      .map((s) => `Die Steuergruppe ${s.steuergruppe} (Kategorie ${s.kategorie}) trägt `
        + 'keinen Hinweis auf die Steuerbefreiung beziehungsweise auf die '
        + 'Steuerschuldnerschaft des Leistungsempfängers.'),
  },
  {
    /**
     * §14 Abs. 4 Nr. 9 UStG in Verbindung mit §14b Abs. 1 S. 5: bei einer
     * Leistung an einen Nichtunternehmer IM ZUSAMMENHANG MIT EINEM
     * GRUNDSTUECK muss die Rechnung auf die zweijaehrige Aufbewahrungspflicht
     * des Empfaengers hinweisen. Fuer Gebaeudereinigung und Bau ist das der
     * Regelfall und keine Lehrbuchecke.
     *
     * **WARNUNG und nicht Fehler, und das ist eine Abweichung von §6 der
     * Kapitelvorlage** (D-323). Ob eine Leistung grundstuecksbezogen ist,
     * steht in keiner Spalte dieser Plattform; „jede Leistung an einen
     * Privatkunden" als Ersatz waere eine erfundene Rechtsregel (K-17), und
     * ein blockierender Fehler ohne erfuellbare Bedingung machte jede
     * Privatkundenrechnung unausstellbar.
     * // TODO(client, O-300): Erbringt die Gruppe Leistungen an Privatkunden
     * im Zusammenhang mit einem Grundstueck, und soll der §14b-Hinweis dann
     * auf JEDER Privatkundenrechnung stehen oder nur auf den
     * grundstuecksbezogenen? Im zweiten Fall braucht `auftrag` oder
     * `leistungskatalog_position` ein Merkmal „grundstuecksbezogen".
     */
    feld: 'aufbewahrungshinweis',
    regel: '§14 Abs. 4 Nr. 9 UStG',
    stufe: 'warnung',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => e.empfaengerTyp === 'privat'
      ? ['Der Empfänger ist eine Privatperson. Steht die Leistung im Zusammenhang '
        + 'mit einem Grundstück, verlangt §14 Abs. 4 Nr. 9 UStG den Hinweis auf die '
        + 'zweijährige Aufbewahrungspflicht (§14b Abs. 1 S. 5 UStG). Ob eine '
        + 'Leistung grundstücksbezogen ist, führt die Plattform nicht (O-300) — '
        + 'der Hinweis gehört bis zur Klärung von Hand in den Fußtext.']
      : leer,
  },
  {
    /**
     * §4.2: das Zahlungsziel hat KEINEN Vorgabewert. Ohne Faelligkeit gibt es
     * keinen Mahnlauf und keine §288-BGB-Zinsen — und `faellig_am` auf einer
     * unveraenderlichen Rechnung nachzureichen ist unmoeglich.
     */
    feld: 'zahlungsziel',
    regel: '§4.2, O-66',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: kopf,
    pruefe: (e) => e.zahlungszielTage === null
      ? ['Es ist kein Zahlungsziel hinterlegt. Ohne Fälligkeit geht kein Beleg '
        + 'hinaus; zu setzen im Kopf dieses Entwurfs. Bleibt das Feld dort leer, '
        + 'gilt die Kondition des Kunden oder die Einstellung '
        + '„finanzen.zahlungsziel_tage_standard" (O-66).']
      : leer,
  },
  {
    /** Invariante 1: `brutto = netto + steuer`, und zwar aus den Zeilen. */
    feld: 'summen',
    regel: 'Invariante 1, §4.9',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => e.bruttoCent === e.nettoGesamtCent + e.steuerGesamtCent ? leer
      : [`Der Bruttobetrag (${e.bruttoCent.toString()} Cent) ist nicht die Summe aus `
        + `Entgelt (${e.nettoGesamtCent.toString()}) und Steuer `
        + `(${e.steuerGesamtCent.toString()}).`],
  },
  {
    /**
     * LEG-05: eine Satzaenderung mitten im Leistungszeitraum. Warnung und
     * nicht Fehler — welcher Satz gilt, entscheidet der Zeitpunkt der
     * Leistung, und das kann im Einzelfall richtig sein. Stillschweigend
     * darueber hinweggehen darf die Pruefung trotzdem nicht.
     */
    feld: 'steuersatz.gueltigkeit',
    regel: 'LEG-05',
    stufe: 'warnung',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => {
      if (istLeer(e.leistungBis)) return leer;
      const bis = e.leistungBis ?? '';
      const betroffen = [...new Set(e.positionen
        .filter((p) => p.art === 'leistung' && p.gruppeGueltigBis !== null
          && p.gruppeGueltigBis < bis)
        .map((p) => p.steuergruppe))];
      return betroffen.map((g) => `Die Steuergruppe ${g} läuft vor dem Ende des `
        + `Leistungszeitraums (${bis}) aus. Prüfen Sie, welcher Satz für diese `
        + 'Leistung gilt (LEG-05).');
    },
  },
  /**
   * **FIN-08 — eine Schlussrechnung zieht jeden gestellten Abschlag ab.**
   *
   * Kein §14-Feld, sondern eine kaufmaennische Vollstaendigkeit — und sie
   * gehoert trotzdem hierher: der Bericht wird mit dem Snapshot eingefroren,
   * und „diese Schlussrechnung hat jeden Abschlag abgezogen" ist genau die
   * Aussage, die eine Betriebspruefung 2032 daraus lesen will.
   *
   * Eine Schlussrechnung, die einen Abschlag vergisst, verlangt dasselbe Geld
   * zweimal. Das faellt beim Kunden auf, nicht bei uns — und auf einem Beleg,
   * der dann schon unveraenderlich ist.
   */
  {
    feld: 'abschlag.abzug',
    regel: 'FIN-08, VOB/B §16 Abs. 3',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: beleg,
    pruefe: (e) => {
      const satz = offeneAbschlaegeSatz(e.offeneAbschlaege);
      return satz === null ? leer : [satz];
    },
  },
  /**
   * **FIN-11 — und der Grund, warum diese Regel SPERRT.**
   *
   * 05-API-KARTE §D sagt es fuer die Leitweg-ID ausdruecklich: bei einem
   * oeffentlichen Auftraggeber ist eine fehlende oder falsch geformte
   * Leitweg-ID sperrend, „weil FIN-11 die XRechnung zum einzigen Weg macht,
   * ihn ueberhaupt abzurechnen". Dasselbe gilt fuer die uebrigen
   * Pflichtangaben derselben Norm: eine Rechnung, die der Empfaenger nicht
   * annehmen KANN, ist keine gestellte Rechnung — sie ist eine gezogene
   * Nummer, eine unveraenderliche Zeile in der Kette und ein Storno, der
   * noch geschrieben werden muss.
   *
   * Die Liste kommt aus `xrechnung/index.ts` und wird hier NICHT zweitgeprueft
   * (siehe `XRechnungEingabe` dort): eine zweite Fassung derselben Liste
   * driftet, und zwar in der Richtung, in der die Vorschau „vollstaendig"
   * sagt und der Bauer sich danach weigert.
   *
   * Bei jedem anderen Kunden greift sie GAR NICHT — auch nicht als Warnung.
   * Eine Reinigungsrechnung an eine Hausverwaltung braucht kein BT-41, und
   * eine Warnung, die auf jedem zweiten Beleg steht, liest nach zwei Wochen
   * niemand mehr.
   */
  {
    feld: 'xrechnung.pflichtfelder',
    regel: 'FIN-11, EN 16931 / XRechnung 3.0',
    stufe: 'fehler',
    kleinbetragEntfaellt: false,
    link: kunde,
    pruefe: (e) => (e.xrechnung.pflicht
      ? e.xrechnung.fehlend.map(
        (f) => `${f.text} (${f.bt}, ${f.regel} — zu pflegen unter ${f.feld})`,
      )
      : leer),
  },
];

/**
 * Die Regeln des §6, die PR 47 ausdruecklich NICHT prueft — mit dem PR, der
 * sie bringt.
 *
 * Sie stehen im Bericht und damit im Snapshot. Ein Bericht, der nur seine
 * erfuellten Regeln nennt, liest sich 2032 wie eine vollstaendige Pruefung;
 * das hier ist die ehrliche Fassung.
 */
export const NICHT_GEPRUEFT: readonly NichtGeprueft[] = [
  { regel: '§14 Abs. 4 Nr. 7 UStG (im Voraus vereinbarte Minderung)',
    grund: 'Ob eine Minderung VEREINBART wurde, steht in keiner Spalte — nur die '
      + 'gebuchte steht in rechnung_zuschlag (BG-20).' },
  /**
   * **Seit PR 51 wird §13b geprueft — nur nicht HIER.** Der Riegel sitzt in
   * der Datenbank: `fin.reverse_charge_pruefen` weist eine Rechnung mit
   * verlagerter Steuerschuld ab, zu der am Leistungsdatum kein Nachweis
   * vorliegt — und zwar auch an der Anwendung vorbei. Was dieser Bericht
   * nicht leistet, ist die VORSCHAU darauf: der Trigger meldet sich beim
   * Festschreiben, nicht beim Pruefen, und die Meldung ist ein
   * Datenbankfehler und kein Befund mit Link.
   *
   * Die andere Richtung bleibt ganz offen und ist keine technische Frage:
   * ob eine Rechnung, die Umsatzsteuer ausweist, OBWOHL ein Nachweis
   * vorliegt, falsch ist, haengt daran, was tatsaechlich geleistet wurde —
   * ein Mensch setzt die Leistungsart, und die Plattform leitet sie nicht ab
   * (D-389).
   */
  { regel: 'FIN-09, LEG-06 — §13b UStG (Vorschau)',
    grund: 'Der Riegel steht (fin.reverse_charge_pruefen, PR 51): ohne datierten '
      + 'Nachweis entsteht keine Rechnung mit verlagerter Steuerschuld. Dieser '
      + 'Bericht zeigt das aber nicht VORHER an, und ob eine ausgewiesene '
      + 'Umsatzsteuer trotz vorliegendem Nachweis falsch ist, entscheidet die '
      + 'tatsaechliche Leistung und kein Datensatz.' },
  /**
   * **Der Abzug selbst wird seit PR 50 geprueft** (Regel `abschlag.abzug`
   * oben). Was offen bleibt, ist die Frage davor: ob die Abschlaege dem
   * VEREINBARTEN Zahlungsplan folgen — nach VOB/B §16 Abs. 1 nach dem Wert
   * der erbrachten Leistung, nach festem Plan, oder nach Baufortschritt. Ohne
   * `abschlagsplan` gibt es keinen Soll-Stand, gegen den sich das pruefen
   * liesse, und ohne O-20 keine Regel, nach der er entstuende.
   */
  { regel: 'FIN-08, OPS-05 — Abschlaege folgen dem vereinbarten Zahlungsplan',
    grund: 'Der ABZUG wird geprueft (Regel abschlag.abzug). Der PLAN nicht: '
      + 'abschlagsplan gibt es noch nicht, und nach welchen Bedingungen '
      + 'Abschlaege gestellt werden, ist offen (O-20).',
    solangeOhne: ['abschlagsplan'] },
  /**
   * **Der Einbehalt wird seit PR 51 gerechnet** (`estg48/abzug.ts`, gegen die
   * Bescheinigung am Leistungsdatum). Was fehlt, ist die dritte der drei
   * Auslagen des §48: die Bagatellgrenze. Ohne sie gibt es genau zwei
   * Ausgaenge statt drei — Bescheinigung oder Einbehalt —, und der dritte
   * (kein Einbehalt, weil die Gegenleistung des Jahres unter der Grenze
   * bleibt) faellt ersatzlos weg. Zu viel einzubehalten ist rechtswidrig und
   * die Gruppe haftet fuer das, was sie zu Unrecht einbehalten hat; deshalb
   * steht hier ein Platzhalter mit `grenzeCent: null` und keine Zahl.
   */
  { regel: 'FIN-10, LEG-06 — §48 EStG Bagatellgrenze',
    grund: 'Der Einbehalt wird gerechnet (PR 51). Die Bagatellgrenze nicht: '
      + 'bauabzugsteuer_freigrenze gibt es nicht, und welche Grenze zu welchem '
      + 'Stichtag gilt, ist offen (O-21).',
    solangeOhne: ['bauabzugsteuer_freigrenze'] },
  /**
   * **Die Pflichtfelder werden seit PR 52 geprueft** (Regel
   * `xrechnung.pflichtfelder` oben, und zwar SPERREND, wenn der Kunde eine
   * XRechnung verlangt). **Und der Einlieferungsweg wird seit `0181`
   * protokolliert**: `rechnung_versand` haelt je Versand den Kanal, den
   * Empfaenger, das Artefakt, den SHA-256 der Nutzlast und den Menschen, der
   * ihn freigegeben hat — append-only bis auf den Zustand (K-12).
   *
   * Diesen Satz hier stehen zu lassen, nachdem die Tabelle da war, waere
   * genau der Fehler, den `rechnung-pflichtfelder.test.ts` seit PR 49
   * bewacht: der Bericht wird mit dem Snapshot EINGEFROREN, und eine falsche
   * Angabe in einem unveraenderlichen Beleg ist teurer als eine fehlende.
   *
   * Offen bleibt zweierlei. Erstens die Zuordnung Beleg → versendete Fassung:
   * `rechnung_dokument` gibt es nicht, `rechnung_versand.rechnung_dokument_id`
   * steht ohne Elterntabelle, und damit ist der Nutzlast-Hash der einzige
   * Bezug auf das Dokument, das hinausging. Das ZUGFeRD-PDF liegt im
   * Belegarchiv (ACC-03, `jobs/belegarchiv.ts`) — als EIN Beleg an der
   * Rechnung, nicht als die Fassung, die dieser Versand getragen hat.
   * Zweitens ist elektronisch kein Weg verbunden: fuer E-Mail, Peppol, ZRE
   * und OZG-RE laesst `fin.rechnung_versand_kanal_verbunden` allein
   * `nicht_verbunden` zu (O-36, O-22).
   */
  { regel: 'FIN-11 — Aufbewahrung und Einlieferungsnachweis der XRechnung',
    grund: 'Die Pflichtfelder werden geprueft (Regel xrechnung.pflichtfelder, PR 52), '
      + 'und der Einlieferungsweg wird seit 0181 in rechnung_versand protokolliert. '
      + 'Offen bleibt die Zuordnung Beleg → versendete Fassung: rechnung_dokument '
      + 'gibt es nicht, rechnung_versand.rechnung_dokument_id steht ohne '
      + 'Elterntabelle. Und elektronisch ist kein Weg verbunden (O-36, O-22) — '
      + 'zulaessig ist allein der Zustand nicht_verbunden.',
    solangeOhne: ['rechnung_dokument'] },
  /*
   * Diese beiden standen bis PR 49 auf „kommt noch" — und blieben stehen,
   * nachdem PR 49 sie gebracht hatte. Der Bericht wird mit dem Snapshot
   * EINGEFROREN: jede ab dann festgeschriebene Rechnung haette dauerhaft
   * behauptet, ihre Herkunft sei nicht geprueft worden, obwohl beides in
   * derselben Transaktion geprueft wurde. Eine falsche Angabe in einem
   * unveraenderlichen Beleg ist teurer als eine fehlende.
   *
   * Sie bleiben in der Liste, weil die Liste sagt, was DIESER Pruefer nicht
   * tut — nur sagt der Grund jetzt, wer es stattdessen tut.
   */
  { regel: 'FIN-07 — Herkunft je Position',
    grund: 'Nicht hier, sondern beim Anlegen der Position: `PositionAnlegen.quellen` '
      + 'ist Pflicht ohne Vorgabewert (D-370), und `rechnungsposition_quelle` '
      + 'haelt die Doppelabrechnungssperre (0107). Eine Zeile ohne Herkunft '
      + 'entsteht gar nicht erst, also gibt es hier nichts nachzupruefen.' },
  { regel: 'FIN-18 — Auftrag ohne erfasste Zeit',
    grund: 'Nicht hier, sondern in `finalisiere()`: `pruefeZeiterfassung` laeuft vor '
      + 'dem Zug der Nummer, und eine Uebergehung steht mit Begruendung im '
      + '`audit_log` UND als `fin18` in diesem Bericht.' },
];

// ---------------------------------------------------------------------------
// Die reine Pruefung
// ---------------------------------------------------------------------------

/**
 * **Rein.** Keine Datenbank, keine Uhr, kein Netz — dieselbe Eingabe ergibt
 * denselben Bericht, und deshalb laesst sich die Regelliste tabellengetrieben
 * pruefen.
 */
export function pruefePflichtfelder(eingabe: PruefEingabe): PflichtfeldBericht {
  const lage = kleinbetragLage(eingabe);
  const fehler: Befund[] = [];
  const warnungen: Befund[] = [];

  for (const regel of REGELN) {
    if (lage.greift && regel.kleinbetragEntfaellt) continue;
    for (const text of regel.pruefe(eingabe, lage)) {
      const befund: Befund = {
        feld: regel.feld,
        regel: regel.regel,
        textDe: text,
        link: regel.link === undefined ? null : regel.link(eingabe),
        stufe: regel.stufe,
      };
      (regel.stufe === 'fehler' ? fehler : warnungen).push(befund);
    }
  }

  return {
    geprueft: true,
    regelwerkVersion: REGELWERK_VERSION,
    fehler,
    warnungen,
    kleinbetrag: lage,
    nichtGeprueft: NICHT_GEPRUEFT,
  };
}

/**
 * Der Bericht in der Form, die in `rechnung_snapshot.pflichtfeld_pruefung`
 * liegt — Schluessel in Schlangenschrift wie jede andere jsonb-Nutzlast, und
 * Cent als TEXT.
 *
 * Cent als Text, weil `JSON.stringify` an einem `bigint` wirft und eine
 * Umwandlung nach `number` ab 2^53 Cent stillschweigend rundet. Dieselbe
 * Regel wie in `kanonisch.ts`.
 */
export function berichtAlsJson(b: PflichtfeldBericht): Record<string, unknown> {
  const alsZeile = (x: Befund): Record<string, unknown> => ({
    feld: x.feld, regel: x.regel, text_de: x.textDe, link: x.link, stufe: x.stufe,
  });
  return {
    geprueft: b.geprueft,
    regelwerk_version: b.regelwerkVersion,
    fehler: b.fehler.map(alsZeile),
    warnungen: b.warnungen.map(alsZeile),
    kleinbetrag: {
      greift: b.kleinbetrag.greift,
      grenze_brutto_cent: b.kleinbetrag.grenzeBruttoCent === null
        ? null : b.kleinbetrag.grenzeBruttoCent.toString(),
      fundstelle: b.kleinbetrag.fundstelle,
      ist_platzhalter: b.kleinbetrag.istPlatzhalter,
      grund: b.kleinbetrag.grund,
    },
    /*
     * `solangeOhne` gehoert MIT in den Snapshot. Der Bericht wird eingefroren
     * und 2032 gelesen; „kommt mit PR 51" ist dann eine Behauptung ohne
     * Beleg, waehrend die Tabellenliste sie pruefbar macht — es steht dann
     * nachlesbar da, WORAN die Pruefung damals fehlte. Die Serialisierung
     * hatte das Feld stillschweigend fallen lassen; gemeldet vom
     * Copilot-Durchgang auf PR #7.
     */
    nicht_geprueft: b.nichtGeprueft.map((n) => ({
      regel: n.regel,
      grund: n.grund,
      ...(n.solangeOhne === undefined ? {} : { solange_ohne: [...n.solangeOhne] }),
    })),
  };
}

/** Die Abweisung, die die Festschreibung wirft. Sie traegt den ganzen Bericht. */
export class PflichtfeldFehler extends Error {
  readonly grund = 'pflichtfelder' as const;

  constructor(readonly bericht: PflichtfeldBericht) {
    super(
      `Die Rechnung erfüllt §14 UStG noch nicht — ${String(bericht.fehler.length)} `
      + `Pflichtangabe(n) fehlen: ${bericht.fehler.map((f) => f.textDe).join(' ')}`,
    );
    this.name = 'PflichtfeldFehler';
  }
}

// ---------------------------------------------------------------------------
// Der Zugriff — er liest, und er entscheidet nichts
// ---------------------------------------------------------------------------

interface KopfZeile {
  readonly mandant_slug: string;
  readonly kunde_id: string;
  readonly rechnungsart: string;
  readonly status: string;
  readonly heute: string;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly vereinnahmung_geplant_am: string | null;
  readonly zahlungsziel_tage: number | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly m_name: string;
  readonly m_strasse: string | null;
  readonly m_plz: string | null;
  readonly m_ort: string | null;
  readonly m_land: string | null;
  readonly m_ust_id: string | null;
  readonly m_steuernummer: string | null;
  readonly m_fakturiert: boolean;
  readonly k_typ: string;
  readonly k_name: string | null;
  readonly k_strasse: string | null;
  readonly k_plz: string | null;
  readonly k_ort: string | null;
  readonly k_land: string | null;
  readonly k_ust_id: string | null;
  readonly k_steuernummer: string | null;
  readonly rechnungsart_code: string | null;
  readonly zahlungsmittel_code: string | null;
  readonly verkaeufer_eadresse: string | null;
  readonly verkaeufer_eadresse_schema: string | null;
  readonly kaeufer_eadresse: string | null;
  readonly kaeufer_eadresse_schema: string | null;
  readonly m_kontakt_name: string | null;
  readonly m_kontakt_telefon: string | null;
  readonly m_kontakt_email: string | null;
  readonly m_iban: string | null;
  readonly k_leitweg_id: string | null;
  readonly k_kaeufer_referenz: string | null;
  readonly k_xrechnung_pflicht: boolean;
}

/**
 * **Die Anschrift wird aufgeloest wie beim Drucken**, nicht wie in der
 * Stammdatenmaske: traegt der Kunde eine abweichende Rechnungsadresse, ist SIE
 * die Anschrift des §14 Abs. 4 Nr. 1 UStG. Dieselbe Aufloesung wie in
 * `KOPF_SQL` in `rechnung.ts`; stuenden hier die Stammdatenspalten, meldete
 * die Pruefung „vollstaendig" fuer eine Anschrift, die auf dem Beleg gar
 * nicht steht.
 *
 * `app.berlin_heute()` und nicht die Prozessuhr: der Kalendertag dieser
 * Domaene kommt aus der Datenbank (K-11, `cse/no-client-clock`).
 */
const KOPF_SQL = `
  select m.slug as mandant_slug, r.kunde_id::text as kunde_id,
         r.rechnungsart::text as rechnungsart, r.status::text as status,
         to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute,
         to_char(coalesce(r.rechnungsdatum, app.berlin_heute()), 'YYYY-MM-DD')
           as rechnungsdatum,
         to_char(r.leistung_von, 'YYYY-MM-DD') as leistung_von,
         to_char(r.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
         to_char(r.vereinnahmung_geplant_am, 'YYYY-MM-DD') as vereinnahmung_geplant_am,
         r.zahlungsziel_tage,
         r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text, r.brutto_cent::text,
         m.firma as m_name, m.strasse as m_strasse, m.plz as m_plz, m.ort as m_ort,
         m.land as m_land, m.ust_id as m_ust_id, m.steuernummer as m_steuernummer,
         k.typ::text as k_typ,
         case when k.rechnungsadresse_abweichend
              then coalesce(nullif(k.rechnung_name, ''), k.name) else k.name end as k_name,
         case when k.rechnungsadresse_abweichend
              then k.rechnung_strasse else k.strasse end as k_strasse,
         case when k.rechnungsadresse_abweichend
              then k.rechnung_plz else k.plz end as k_plz,
         case when k.rechnungsadresse_abweichend
              then k.rechnung_ort else k.ort end as k_ort,
         case when k.rechnungsadresse_abweichend
              then coalesce(k.rechnung_land, k.land) else k.land end as k_land,
         k.ust_id as k_ust_id, k.steuernummer as k_steuernummer,
         -- FIN-11. Alles ab hier speist NUR die Regel xrechnung.pflichtfelder.
         r.rechnungsart_code, r.zahlungsmittel_code,
         -- Der WIRKSAME Wert, nicht der gespeicherte. (Keine Backticks in
         -- diesem Kommentar: er steht IN einem Template-Literal.)
         --
         -- Die vier Spalten auf rechnung sind beim Entwurf noch leer; gefuellt
         -- werden sie erst beim Festschreiben, von fin.eadresse_einfrieren
         -- (0120) — und diese Vorpruefung laeuft davor. Ohne coalesce meldete
         -- sie BT-34 und BT-49 als fehlend und blockierte damit genau die
         -- Rechnung, die eine Millisekunde spaeter beide Werte bekommt.
         --
         -- Derselbe Ausdruck wie im Trigger, mit Absicht: was hier gruen ist,
         -- muss dort auch entstehen. Gehen die beiden auseinander, sagt die
         -- Vorschau etwas anderes als der Beleg.
         coalesce(r.verkaeufer_eadresse, m.elektronische_adresse) as verkaeufer_eadresse,
         coalesce(r.verkaeufer_eadresse_schema, m.elektronische_adresse_schema)
           as verkaeufer_eadresse_schema,
         coalesce(r.kaeufer_eadresse, k.elektronische_adresse) as kaeufer_eadresse,
         coalesce(r.kaeufer_eadresse_schema, k.elektronische_adresse_schema)
           as kaeufer_eadresse_schema,
         m.rechnung_kontakt_name as m_kontakt_name,
         m.telefon as m_kontakt_telefon, m.email as m_kontakt_email,
         m.iban as m_iban,
         k.leitweg_id as k_leitweg_id, k.kaeufer_referenz as k_kaeufer_referenz,
         (k.xrechnung_pflicht or k.ist_oeffentlicher_auftraggeber) as k_xrechnung_pflicht
    from rechnung r
    join mandant m on m.id = r.mandant_id
    join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
   where r.id = $1`;

export class PruefEingabeFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PruefEingabeFehler';
  }
}

/** Liest genau das, was `pruefePflichtfelder` braucht — und nicht mehr. */
export async function ladePruefEingabe(
  db: Abfrage, rechnungId: string,
): Promise<PruefEingabe> {
  const [kopf] = await db.abfrage<KopfZeile>(KOPF_SQL, [rechnungId]);
  if (kopf === undefined) {
    throw new PruefEingabeFehler(`Rechnung ${rechnungId} nicht gefunden`);
  }

  const positionen = await db.abfrage<{
    position_nr: number; positionsart: string; bezeichnung: string;
    menge: string | null; einheit: string | null; masseinheit_id: string | null;
    unece_code: string | null; einzelpreis_cent: string | null;
    netto_cent: string | null; gruppe: string; kategorie: string;
    gueltig_bis: string | null;
  }>(
    `select p.position_nr, p.positionsart::text as positionsart, p.bezeichnung,
            p.menge::text as menge, p.einheit,
            p.masseinheit_id::text as masseinheit_id, p.netto_cent::text,
            e.unece_code, p.einzelpreis_cent::text,
            g.schluessel as gruppe, p.kategorie::text as kategorie,
            to_char(g.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
       from rechnungsposition p
       join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
       left join masseinheit e on e.id = p.masseinheit_id
      where p.rechnung_id = $1
      order by p.position_nr`,
    [rechnungId],
  );

  const steuerzeilen = await db.abfrage<{
    gruppe: string; satz_bp: number; kategorie: string;
    netto_cent: string; steuer_cent: string; befreiungsgrund_text: string | null;
    befreiungsgrund_code: string | null;
  }>(
    `select g.schluessel as gruppe, s.satz_bp, s.kategorie::text as kategorie,
            s.netto_cent::text, s.steuer_cent::text, s.befreiungsgrund_text,
            s.befreiungsgrund_code
       from rechnung_steuer s
       join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
      where s.rechnung_id = $1 and (s.netto_cent <> 0 or s.steuer_cent <> 0)
      order by g.schluessel`,
    [rechnungId],
  );

  /**
   * Der Kreis auf dem OFFENEN Schluessel, nie ueber das heutige Jahr — genau
   * wie `fin.rechnung_nummer_ziehen` (§5.6). Eine Suche nach `jahr = 2026`
   * fände einen fortlaufenden Kreis (`jahr = 0`) nicht, und die Vorschau
   * meldete „kein Kreis" fuer jede Gesellschaft, die ueber Jahre
   * durchnummeriert.
   */
  const [kreis] = await db.abfrage<{
    bezeichnung: string; ist_platzhalter: boolean; lueckenlos: boolean;
    geschlossen: boolean;
  }>(
    `select nk.bezeichnung, nk.ist_platzhalter, nk.lueckenlos,
            (nk.geschlossen_am is not null) as geschlossen
       from nummernkreis nk
      where nk.mandant_id = app.aktiver_mandant()
        and nk.kreis_typ = 'ausgangsrechnung'
        and nk.kontext_id is null
        and nk.geschlossen_am is null`,
  );

  /**
   * Die Schwelle des §33 UStDV, GUELTIG AM AUSSTELLUNGSTAG — versioniert und
   * nicht als Konstante. Die jüngste gültige Zeile gewinnt.
   */
  const [grenze] = await db.abfrage<{
    grenze_brutto_cent: string; fundstelle: string; ist_platzhalter: boolean;
  }>(
    `select g.grenze_brutto_cent::text, g.fundstelle, g.ist_platzhalter
       from kleinbetrag_grenze g
      where ($1::date) >= g.gueltig_von
        and (g.gueltig_bis is null or ($1::date) <= g.gueltig_bis)
      order by g.gueltig_von desc
      limit 1`,
    [kopf.rechnungsdatum],
  );

  /**
   * FIN-11: dieselbe Liste wie beim Bauen des Dokuments, aus derselben
   * Funktion — nur auf einem Entwurf, dem die Nummer und der Artcode noch
   * fehlen. Der Aufwand ist eine Gestaltumwandlung und kein zweites
   * Regelwerk; siehe `XRechnungEingabe`.
   */
  const anschrift = (
    strasse: string | null, plz: string | null, ort: string | null, land: string | null,
  ): Anschrift => ({
    zeile: '', strasse, zusatz: null, plz, ort, land: land ?? '',
  });

  const xrechnungEingabe: XRechnungEingabe = {
    rechnungsartCode: kopf.rechnungsart_code,
    leistender: {
      name: kopf.m_name,
      anschrift: anschrift(kopf.m_strasse, kopf.m_plz, kopf.m_ort, kopf.m_land),
      kontakt: {
        name: kopf.m_kontakt_name,
        telefon: kopf.m_kontakt_telefon,
        email: kopf.m_kontakt_email,
      },
      steuernummer: kopf.m_steuernummer,
      ustid: kopf.m_ust_id,
      eadresse: kopf.verkaeufer_eadresse,
      eadresseSchema: kopf.verkaeufer_eadresse_schema,
    },
    empfaenger: {
      name: kopf.k_name ?? '',
      anschrift: anschrift(kopf.k_strasse, kopf.k_plz, kopf.k_ort, kopf.k_land),
      leitwegId: kopf.k_leitweg_id,
      kaeuferReferenz: kopf.k_kaeufer_referenz,
      eadresse: kopf.kaeufer_eadresse,
      eadresseSchema: kopf.kaeufer_eadresse_schema,
    },
    zahlung: {
      zahlungsmittelCode: kopf.zahlungsmittel_code,
      bankkonto: kopf.m_iban === null ? null : { iban: kopf.m_iban },
    },
    steuerzeilen: steuerzeilen.map((z) => ({
      steuersatzGruppe: z.gruppe,
      kategorie: z.kategorie,
      befreiungsgrundCode: z.befreiungsgrund_code,
      befreiungsgrundText: z.befreiungsgrund_text,
    })),
    positionen: positionen.map((p) => ({
      nr: p.position_nr,
      art: p.positionsart,
      einheit: p.einheit,
      einheitCode: p.unece_code,
      nettoCent: p.netto_cent === null ? null : cent(BigInt(p.netto_cent)),
      einzelpreisCent: p.einzelpreis_cent === null ? null : cent(BigInt(p.einzelpreis_cent)),
    })),
  };

  const beteiligter = (
    name: string | null, strasse: string | null, plz: string | null, ort: string | null,
    land: string | null, ustId: string | null, steuernummer: string | null,
  ): PruefBeteiligter => ({ name, strasse, plz, ort, land, ustId, steuernummer });

  return {
    rechnungId,
    mandantSlug: kopf.mandant_slug,
    kundeId: kopf.kunde_id,
    rechnungsart: kopf.rechnungsart,
    rechnungsdatum: kopf.rechnungsdatum,
    leistungVon: kopf.leistung_von,
    leistungBis: kopf.leistung_bis,
    vereinnahmungGeplantAm: kopf.vereinnahmung_geplant_am,
    zahlungszielTage: kopf.zahlungsziel_tage,
    nettoGesamtCent: cent(BigInt(kopf.netto_gesamt_cent)),
    steuerGesamtCent: cent(BigInt(kopf.steuer_gesamt_cent)),
    bruttoCent: cent(BigInt(kopf.brutto_cent)),
    leistender: beteiligter(kopf.m_name, kopf.m_strasse, kopf.m_plz, kopf.m_ort,
      kopf.m_land, kopf.m_ust_id, kopf.m_steuernummer),
    empfaenger: beteiligter(kopf.k_name, kopf.k_strasse, kopf.k_plz, kopf.k_ort,
      kopf.k_land, kopf.k_ust_id, kopf.k_steuernummer),
    empfaengerTyp: kopf.k_typ,
    positionen: positionen.map((p) => ({
      nr: p.position_nr,
      art: p.positionsart,
      bezeichnung: p.bezeichnung,
      mengeMilli: p.menge === null ? null : mengeAusPostgres(p.menge),
      einheit: p.einheit,
      hatMasseinheit: p.masseinheit_id !== null,
      nettoCent: p.netto_cent === null ? null : cent(BigInt(p.netto_cent)),
      steuergruppe: p.gruppe,
      kategorie: p.kategorie,
      gruppeGueltigBis: p.gueltig_bis,
    })),
    steuerzeilen: steuerzeilen.map((s) => ({
      steuergruppe: s.gruppe,
      satzBp: s.satz_bp,
      kategorie: s.kategorie,
      nettoCent: cent(BigInt(s.netto_cent)),
      steuerCent: cent(BigInt(s.steuer_cent)),
      befreiungsgrundText: s.befreiungsgrund_text,
    })),
    kreis: kreis === undefined
      ? { gesellschaftFakturiert: kopf.m_fakturiert, vorhanden: false,
          bezeichnung: null, istPlatzhalter: false,
          lueckenlos: false, geschlossen: false }
      : { gesellschaftFakturiert: kopf.m_fakturiert, vorhanden: true,
          bezeichnung: kreis.bezeichnung,
          istPlatzhalter: kreis.ist_platzhalter, lueckenlos: kreis.lueckenlos,
          geschlossen: kreis.geschlossen },
    kleinbetragGrenze: grenze === undefined ? null : {
      grenzeBruttoCent: cent(BigInt(grenze.grenze_brutto_cent)),
      fundstelle: grenze.fundstelle,
      istPlatzhalter: grenze.ist_platzhalter,
    },
    /*
     * FIN-08. Bei allem, was keine Schlussrechnung ist, kehrt die Abfrage in
     * einer Anweisung mit einer leeren Liste zurueck — die Regel kostet dort
     * nichts.
     */
    offeneAbschlaege: await ladeOffeneAbschlaege(db, rechnungId),
    xrechnung: {
      pflicht: kopf.k_xrechnung_pflicht,
      fehlend: fehlendePflichtfelder(xrechnungEingabe, { leitwegPflicht: true }),
    },
  };
}

/**
 * Der EINE Einstieg für Festschreibung, Vorschau und API (§6, Abnahme 4).
 *
 * Er liest und schreibt nichts — die Vorschau darf ihn deshalb auch in einer
 * Nur-Lese-Sitzung aufrufen.
 */
export async function pruefeRechnung(
  db: Abfrage, rechnungId: string,
): Promise<PflichtfeldBericht> {
  return pruefePflichtfelder(await ladePruefEingabe(db, rechnungId));
}
