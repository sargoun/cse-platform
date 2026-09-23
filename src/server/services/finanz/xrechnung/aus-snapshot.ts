/**
 * Der Rueckweg: aus den GEHASHTEN BYTES zurueck in die Rechnung (K-12).
 *
 * **Warum ueberhaupt zurueck.** `01-ORDNERSTRUKTUR.md` §8: „`xrechnung.ts`,
 * `zugferd.ts` und `pdf/templates/rechnung.tsx` lesen alle den Snapshot."
 * Eine frische Abfrage waere bequemer und waere falsch: wird der Kundenstamm
 * gepflegt — neue Anschrift, neue USt-IdNr., ein korrigierter Name —, sagt
 * die XRechnung danach etwas anderes als die Rechnung, und die Kettenpruefung
 * meldet weiter „intakt", weil an der Kette nichts geaendert wurde. Zwei
 * Dokumente zu einer Rechnungsnummer, und das zweite beweist nichts.
 *
 * **Gelesen werden `nutzlast_bytes`, nicht `nutzlast`** (das `jsonb` daneben).
 * `jsonb` sortiert Schluessel um und formatiert Zahlen neu; die Bytes sind
 * das, was gehasht wurde. Wer die XRechnung aus ihnen baut, baut sie aus dem
 * Beweis — und eine Manipulation an der Zeile aendert dann beides zugleich:
 * das Dokument UND den Hash, der sie auffliegen laesst.
 *
 * **Jede Abweichung ist ein Fehler, keine Vorgabe.** Ein Leser, der ein
 * fehlendes Feld zu `null` ergaenzt, erzeugt aus einer beschaedigten Zeile
 * ein plausibles Dokument. Deshalb prueft hier jeder Zugriff die Gestalt und
 * wirft `SnapshotFehler` mit dem Pfad.
 */
import { cent, type Cent } from '../geld.js';
import type {
  Abzug, Anschrift, Bauabzugsteuer, Empfaenger, Kontakt, Leistender, Leistungsort,
  Position, Quelle, RechnungVollstaendig, Steuerzeile, Zahlungsangaben, Zuschlag,
} from '../kanonisch.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_V1, SCHEMA_VERSION_V2 }
  from '../kanonisch.js';
import { mengeAusPostgres, type MilliMenge } from '../menge.js';

export class SnapshotFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'SnapshotFehler';
  }
}

/**
 * Eine v1-Zeile laesst sich NICHT in eine XRechnung verwandeln — und das ist
 * kein Mangel dieses Lesers.
 *
 * v1 trug die Anschriften als eine Zeile (`"Musterstr. 1, 10115 Berlin, DE"`).
 * EN 16931 braucht Strasse, Ort, PLZ und Laendercode einzeln (BT-35, BT-37,
 * BT-38, BT-40). Sie aus der Zeile zu zerlegen hiesse raten: ein Komma ist
 * kein Feldtrenner, „Berlin, DE" und „Berlin" sind beide plausibel, und ein
 * falscher Laendercode macht aus der Rechnung eine abgewiesene Rechnung.
 *
 * Eine v1-Rechnung ist damit nicht verloren — sie ist nur nicht
 * maschinenlesbar zustellbar. Was sie braucht, ist ein Storno und eine neue
 * Rechnung unter v2, und das ist eine kaufmaennische Entscheidung.
 */
export class SnapshotZuAltFehler extends SnapshotFehler {
  constructor(version: string) {
    super(
      `Der Snapshot dieser Rechnung hat die Gestalt ${version}; eine XRechnung `
      + `braucht ${SCHEMA_VERSION}. Bis PR 52 trug die Nutzlast die Anschriften `
      + 'als EINE Zeile, und EN 16931 verlangt Strasse, Ort, PLZ und Laendercode '
      + 'einzeln (BT-35, BT-37, BT-38, BT-40). Sie daraus zu zerlegen waere '
      + 'geraten — und ein falscher Laendercode laesst die Rechnung beim '
      + 'Empfaenger durchfallen. Der Weg ist Storno und Neuausstellung.',
    );
    this.name = 'SnapshotZuAltFehler';
  }
}

type Objekt = Readonly<Record<string, unknown>>;

function objekt(wert: unknown, pfad: string): Objekt {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) {
    throw new SnapshotFehler(`${pfad}: Objekt erwartet, gefunden ${typeof wert}`);
  }
  return wert as Objekt;
}

function feld(o: Objekt, name: string, pfad: string): unknown {
  if (!(name in o)) {
    throw new SnapshotFehler(
      `${pfad}.${name} fehlt. §5.3 schreibt jeden Nullwert AUS — ein fehlendes `
      + 'Feld ist eine beschaedigte Zeile und kein leerer Wert.',
    );
  }
  return o[name];
}

/**
 * Ein Feld, das es in ÄLTEREN Gestalten noch nicht gab.
 *
 * `feld()` wirft, wenn ein Schlüssel fehlt, und das ist richtig: §5.3
 * schreibt jeden Nullwert AUS, ein fehlendes Feld ist damit eine beschädigte
 * Zeile. Für ein Feld, das erst in einer späteren Gestalt dazugekommen ist,
 * gilt das nicht — sein Fehlen in einer v2-Zeile ist deren Zustand, nicht
 * ihr Schaden.
 *
 * Deshalb eine eigene Funktion und nicht ein `?? null` in `feld()`: so bleibt
 * an jeder Aufrufstelle sichtbar, dass hier bewusst toleriert wird, und die
 * strenge Regel gilt überall sonst unverändert.
 */
function neuerFeldwert(o: Objekt, name: string, pfad: string): string | null {
  if (!(name in o)) return null;
  const w = o[name];
  if (w === null) return null;
  if (typeof w !== 'string') {
    throw new SnapshotFehler(`${pfad}.${name}: Zeichenkette oder null erwartet`);
  }
  return w;
}

function text(o: Objekt, name: string, pfad: string): string {
  const w = feld(o, name, pfad);
  if (typeof w !== 'string') {
    throw new SnapshotFehler(`${pfad}.${name}: Zeichenkette erwartet, gefunden ${typeof w}`);
  }
  return w;
}

function textOderNull(o: Objekt, name: string, pfad: string): string | null {
  const w = feld(o, name, pfad);
  if (w === null) return null;
  if (typeof w !== 'string') {
    throw new SnapshotFehler(`${pfad}.${name}: Zeichenkette oder null erwartet`);
  }
  return w;
}

function ganzzahl(o: Objekt, name: string, pfad: string): number {
  const w = feld(o, name, pfad);
  if (typeof w !== 'number' || !Number.isInteger(w)) {
    throw new SnapshotFehler(`${pfad}.${name}: ganze Zahl erwartet, gefunden ${String(w)}`);
  }
  return w;
}

function wahrheit(o: Objekt, name: string, pfad: string): boolean {
  const w = feld(o, name, pfad);
  if (typeof w !== 'boolean') {
    throw new SnapshotFehler(`${pfad}.${name}: true oder false erwartet`);
  }
  return w;
}

/**
 * Ein Betrag aus der Nutzlast.
 *
 * Er steht dort als JSON-Zahl in Cent (§5.3, Regel 1) und wird hier wieder
 * `bigint`. `Number.isSafeInteger` steht davor, weil `JSON.parse` bei einer
 * Zahl jenseits von 2^53 stillschweigend rundet — der Betrag waere dann um
 * ein paar Cent daneben, und niemand saehe, wo das passiert ist.
 */
function betrag(o: Objekt, name: string, pfad: string): Cent {
  const w = feld(o, name, pfad);
  if (typeof w !== 'number' || !Number.isSafeInteger(w)) {
    throw new SnapshotFehler(
      `${pfad}.${name}: ganzzahlige Cent erwartet, gefunden ${String(w)}`,
    );
  }
  return cent(BigInt(w));
}

function betragOderNull(o: Objekt, name: string, pfad: string): Cent | null {
  return feld(o, name, pfad) === null ? null : betrag(o, name, pfad);
}

function menge(o: Objekt, name: string, pfad: string): MilliMenge {
  return mengeAusPostgres(text(o, name, pfad));
}

function mengeOderNull(o: Objekt, name: string, pfad: string): MilliMenge | null {
  const w = textOderNull(o, name, pfad);
  return w === null ? null : mengeAusPostgres(w);
}

function liste(o: Objekt, name: string, pfad: string): readonly unknown[] {
  const w = feld(o, name, pfad);
  if (!Array.isArray(w)) throw new SnapshotFehler(`${pfad}.${name}: Liste erwartet`);
  return w as readonly unknown[];
}

// ---------------------------------------------------------------------------

function leseAnschrift(wert: unknown, pfad: string): Anschrift {
  const o = objekt(wert, pfad);
  return {
    zeile: text(o, 'zeile', pfad),
    strasse: textOderNull(o, 'strasse', pfad),
    zusatz: textOderNull(o, 'zusatz', pfad),
    plz: textOderNull(o, 'plz', pfad),
    ort: textOderNull(o, 'ort', pfad),
    land: text(o, 'land', pfad),
  };
}

function leseKontakt(wert: unknown, pfad: string): Kontakt {
  const o = objekt(wert, pfad);
  return {
    name: textOderNull(o, 'name', pfad),
    telefon: textOderNull(o, 'telefon', pfad),
    email: textOderNull(o, 'email', pfad),
  };
}

function leseLeistender(wert: unknown): Leistender {
  const p = '$.leistender';
  const o = objekt(wert, p);
  return {
    id: text(o, 'id', p),
    name: text(o, 'name', p),
    rechtsform: textOderNull(o, 'rechtsform', p),
    anschrift: leseAnschrift(feld(o, 'anschrift', p), `${p}.anschrift`),
    kontakt: leseKontakt(feld(o, 'kontakt', p), `${p}.kontakt`),
    steuernummer: textOderNull(o, 'steuernummer', p),
    ustid: textOderNull(o, 'ustid', p),
    gericht: textOderNull(o, 'gericht', p),
    hrb: textOderNull(o, 'hrb', p),
    geschaeftsfuehrer: textOderNull(o, 'geschaeftsfuehrer', p),
    eadresse: textOderNull(o, 'eadresse', p),
    eadresseSchema: textOderNull(o, 'eadresse_schema', p),
    /* Neu in v3 (V-099). Eine v2-Zeile trägt sie nicht — das ist kein
       Schaden, sondern ihr Zustand. */
    fusszeile: neuerFeldwert(o, 'fusszeile', p),
  };
}

function leseEmpfaenger(wert: unknown): Empfaenger {
  const p = '$.empfaenger';
  const o = objekt(wert, p);
  return {
    id: text(o, 'id', p),
    name: text(o, 'name', p),
    anschrift: leseAnschrift(feld(o, 'anschrift', p), `${p}.anschrift`),
    ustid: textOderNull(o, 'ustid', p),
    leitwegId: textOderNull(o, 'leitweg_id', p),
    kaeuferReferenz: textOderNull(o, 'kaeufer_referenz', p),
    bestellnummer: textOderNull(o, 'bestellnummer', p),
    eadresse: textOderNull(o, 'eadresse', p),
    eadresseSchema: textOderNull(o, 'eadresse_schema', p),
  };
}

function leseObjekt(wert: unknown): Leistungsort | null {
  if (wert === null) return null;
  const p = '$.objekt';
  const o = objekt(wert, p);
  return {
    id: text(o, 'id', p),
    bezeichnung: text(o, 'bezeichnung', p),
    anschrift: leseAnschrift(feld(o, 'anschrift', p), `${p}.anschrift`),
  };
}

function leseQuelle(wert: unknown, pfad: string): Quelle {
  const o = objekt(wert, pfad);
  return {
    typ: text(o, 'typ', pfad),
    id: text(o, 'id', pfad),
    mengeAnteil: mengeOderNull(o, 'menge_anteil', pfad),
  };
}

function lesePosition(wert: unknown, i: number): Position {
  const p = `$.positionen[${String(i)}]`;
  const o = objekt(wert, p);
  return {
    nr: ganzzahl(o, 'nr', p),
    art: text(o, 'art', p),
    bezeichnung: text(o, 'bezeichnung', p),
    beschreibung: textOderNull(o, 'beschreibung', p),
    menge: mengeOderNull(o, 'menge', p),
    einheit: textOderNull(o, 'einheit', p),
    einheitCode: textOderNull(o, 'einheit_code', p),
    preisBasismenge: menge(o, 'preis_basismenge', p),
    einzelpreisCent: betragOderNull(o, 'einzelpreis_cent', p),
    rabattBp: ganzzahl(o, 'rabatt_bp', p),
    nettoCent: betragOderNull(o, 'netto_cent', p),
    steuersatzGruppe: text(o, 'steuersatz_gruppe', p),
    satzBp: ganzzahl(o, 'satz_bp', p),
    kategorie: text(o, 'kategorie', p),
    abrechnungsart: textOderNull(o, 'abrechnungsart', p),
    leistungVon: textOderNull(o, 'leistung_von', p),
    leistungBis: textOderNull(o, 'leistung_bis', p),
    quellen: liste(o, 'quellen', p).map((q, j) => leseQuelle(q, `${p}.quellen[${String(j)}]`)),
  };
}

function leseZuschlag(wert: unknown, i: number): Zuschlag {
  const p = `$.zuschlaege[${String(i)}]`;
  const o = objekt(wert, p);
  return {
    art: text(o, 'art', p),
    bezeichnung: text(o, 'bezeichnung', p),
    grundCode: textOderNull(o, 'grund_code', p),
    basisCent: betragOderNull(o, 'basis_cent', p),
    satzBp: feld(o, 'satz_bp', p) === null ? null : ganzzahl(o, 'satz_bp', p),
    betragCent: betrag(o, 'betrag_cent', p),
    steuersatzGruppe: text(o, 'steuersatz_gruppe', p),
    gruppeSatzBp: ganzzahl(o, 'gruppe_satz_bp', p),
    gruppeKategorie: text(o, 'gruppe_kategorie', p),
  };
}

function leseSteuerzeile(wert: unknown, i: number): Steuerzeile {
  const p = `$.steuerzeilen[${String(i)}]`;
  const o = objekt(wert, p);
  return {
    steuersatzGruppe: text(o, 'steuersatz_gruppe', p),
    kategorie: text(o, 'kategorie', p),
    satzBp: ganzzahl(o, 'satz_bp', p),
    nettoCent: betrag(o, 'netto_cent', p),
    steuerCent: betrag(o, 'steuer_cent', p),
    befreiungsgrundCode: textOderNull(o, 'befreiungsgrund_code', p),
    befreiungsgrundText: textOderNull(o, 'befreiungsgrund_text', p),
  };
}

function leseAbzug(wert: unknown, i: number): Abzug {
  const p = `$.abzuege[${String(i)}]`;
  const o = objekt(wert, p);
  return {
    abschlagNummer: text(o, 'abschlag_nummer', p),
    steuersatzGruppe: text(o, 'steuersatz_gruppe', p),
    abzugNettoCent: betrag(o, 'abzug_netto_cent', p),
    abzugSteuerCent: betrag(o, 'abzug_steuer_cent', p),
  };
}

function leseBauabzugsteuer(wert: unknown): Bauabzugsteuer {
  const p = '$.bauabzugsteuer';
  const o = objekt(wert, p);
  const fsb = feld(o, 'freistellungsbescheinigung', p);
  const fp = `${p}.freistellungsbescheinigung`;
  return {
    pflichtig: wahrheit(o, 'pflichtig', p),
    satzBp: feld(o, 'satz_bp', p) === null ? null : ganzzahl(o, 'satz_bp', p),
    grundlageCent: betragOderNull(o, 'grundlage_cent', p),
    einbehaltCent: betrag(o, 'einbehalt_cent', p),
    freistellungsbescheinigung: fsb === null ? null : (() => {
      const f = objekt(fsb, fp);
      return {
        nummer: text(f, 'nummer', fp),
        finanzamt: text(f, 'finanzamt', fp),
        gueltigVon: text(f, 'gueltig_von', fp),
        gueltigBis: text(f, 'gueltig_bis', fp),
        umfang: text(f, 'umfang', fp),
      };
    })(),
  };
}

function leseZahlung(wert: unknown): Zahlungsangaben {
  const p = '$.zahlung';
  const o = objekt(wert, p);
  const konto = feld(o, 'bankkonto', p);
  const kp = `${p}.bankkonto`;
  return {
    bankkonto: konto === null ? null : (() => {
      const k = objekt(konto, kp);
      return {
        iban: text(k, 'iban', kp),
        bic: textOderNull(k, 'bic', kp),
        kontoinhaber: text(k, 'kontoinhaber', kp),
      };
    })(),
    zahlungsmittelCode: textOderNull(o, 'zahlungsmittel_code', p),
    zahlungsbedingungText: textOderNull(o, 'zahlungsbedingung_text', p),
    zahlungszielTage: feld(o, 'zahlungsziel_tage', p) === null
      ? null : ganzzahl(o, 'zahlungsziel_tage', p),
    faelligAm: textOderNull(o, 'faellig_am', p),
    skontoBp: feld(o, 'skonto_bp', p) === null ? null : ganzzahl(o, 'skonto_bp', p),
    skontoTage: feld(o, 'skonto_tage', p) === null ? null : ganzzahl(o, 'skonto_tage', p),
  };
}

/**
 * Die Rechnung, wie sie festgeschrieben wurde — aus den Bytes des Snapshots.
 *
 * @throws SnapshotZuAltFehler bei einer v1-Zeile (siehe dort).
 * @throws SnapshotFehler bei jeder anderen Abweichung, mit dem Pfad im Text.
 */
export function leseNutzlast(bytes: Uint8Array | string): RechnungVollstaendig {
  const roh = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8');
  let geparst: unknown;
  try {
    geparst = JSON.parse(roh);
  } catch (fehler) {
    throw new SnapshotFehler(
      `Die Nutzlast ist kein gueltiges JSON: ${(fehler as Error).message}`,
    );
  }

  const o = objekt(geparst, '$');
  const version = text(o, 'schema', '$');
  if (version === SCHEMA_VERSION_V1) throw new SnapshotZuAltFehler(version);
  /*
   * **v2 UND v3 sind beide gültig** (V-099), und das ist kein Nachlassen der
   * Strenge: v3 fügt ein Feld HINZU (`leistender.fusszeile`). Eine v2-Zeile
   * hat es nicht, weil sie entstand, bevor die Fusszeile überhaupt ein
   * Dokument erreichte — sie liest sich vollständig, und ihre Kette bleibt
   * heil.
   *
   * v1 ist der andere Fall: dort fehlen Strasse, Ort, PLZ und Ländercode
   * einzeln, und aus einer Zeile liessen sie sich nur raten. Deshalb steht
   * v1 weiterhin als Fehler da und v2 nicht.
   */
  if (version !== SCHEMA_VERSION && version !== SCHEMA_VERSION_V2) {
    throw new SnapshotFehler(
      `Unbekannte Gestalt ${JSON.stringify(version)}. Bekannt sind `
      + `${SCHEMA_VERSION_V1} (zu alt), ${SCHEMA_VERSION_V2} und ${SCHEMA_VERSION}.`,
    );
  }

  return {
    leistender: leseLeistender(feld(o, 'leistender', '$')),
    empfaenger: leseEmpfaenger(feld(o, 'empfaenger', '$')),
    nummernkreisId: text(o, 'nummernkreis_id', '$'),
    nummer: text(o, 'nummer', '$'),
    kettePosition: ganzzahl(o, 'kette_position', '$'),
    rechnungsart: text(o, 'rechnungsart', '$'),
    rechnungsartCode: text(o, 'rechnungsart_code', '$'),
    rechnungsdatum: text(o, 'rechnungsdatum', '$'),
    leistungVon: textOderNull(o, 'leistung_von', '$'),
    leistungBis: textOderNull(o, 'leistung_bis', '$'),
    vereinnahmungGeplantAm: textOderNull(o, 'vereinnahmung_geplant_am', '$'),
    objekt: leseObjekt(feld(o, 'objekt', '$')),
    sprache: text(o, 'sprache', '$'),
    waehrung: text(o, 'waehrung', '$'),
    kopftext: textOderNull(o, 'kopftext', '$'),
    fusstext: textOderNull(o, 'fusstext', '$'),
    steuerhinweis: textOderNull(o, 'steuerhinweis', '$'),
    hinweise: liste(o, 'hinweise', '$').map((h, i) => {
      if (typeof h !== 'string') {
        throw new SnapshotFehler(`$.hinweise[${String(i)}]: Zeichenkette erwartet`);
      }
      return h;
    }),
    positionen: liste(o, 'positionen', '$').map(lesePosition),
    zuschlaege: liste(o, 'zuschlaege', '$').map(leseZuschlag),
    steuerzeilen: liste(o, 'steuerzeilen', '$').map(leseSteuerzeile),
    abzuege: liste(o, 'abzuege', '$').map(leseAbzug),
    nettoGesamtCent: betrag(o, 'netto_gesamt_cent', '$'),
    steuerGesamtCent: betrag(o, 'steuer_gesamt_cent', '$'),
    bruttoCent: betrag(o, 'brutto_cent', '$'),
    abzugBruttoCent: betrag(o, 'abzug_brutto_cent', '$'),
    zahlbetragCent: betrag(o, 'zahlbetrag_cent', '$'),
    bauabzugsteuer: leseBauabzugsteuer(feld(o, 'bauabzugsteuer', '$')),
    ueberweisungsbetragCent: betrag(o, 'ueberweisungsbetrag_cent', '$'),
    zahlung: leseZahlung(feld(o, 'zahlung', '$')),
    istKleinbetrag: wahrheit(o, 'ist_kleinbetrag', '$'),
    kleinbetragGrenzeCent: betragOderNull(o, 'kleinbetrag_grenze_cent', '$'),
    reverseCharge: wahrheit(o, 'reverse_charge', '$'),
    reverseChargeGrundlage: textOderNull(o, 'reverse_charge_grundlage', '$'),
    festgeschriebenAm: text(o, 'festgeschrieben_am', '$'),
    festgeschriebenVon: text(o, 'festgeschrieben_von', '$'),
  };
}
