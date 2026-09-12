/**
 * XRechnung — UBL 2.1 nach EN 16931, CIUS XRechnung 3.0 (FIN-11).
 *
 * **Warum das ueberhaupt gebaut wird.** SPEC §9 sagt es in einem Satz: ohne
 * XRechnung kann die Gruppe oeffentliche Auftraggeber GAR NICHT abrechnen.
 * Seit dem 27.11.2020 nimmt der Bund keine Papier- und keine PDF-Rechnung
 * mehr an (E-Rechnungsverordnung §3); Berlin fordert sie ueber die ZRE, und
 * die Leitweg-ID (BT-10) ist das Feld, an dem die Zuordnung haengt. Eine
 * Rechnung ohne sie wird nicht bemaengelt, sondern abgewiesen.
 *
 * **Der Bauer liest den SNAPSHOT, nicht die Stammdaten** (K-12). Er bekommt
 * die kanonische Nutzlast — dieselbe Struktur, deren Bytes gehasht wurden.
 * Waere es eine frische Abfrage, aenderte eine spaetere Pflege des
 * Kundenstamms, was die XRechnung SAGT, waehrend die Kettenpruefung weiter
 * „intakt" meldet: zwei Dokumente zu einer Rechnungsnummer, und das zweite
 * beweist nichts.
 *
 * **Er erfindet nichts und rundet nichts.** Jeder Betrag kommt als
 * ganzzahliger Cent herein und wird nur in die Dezimalschreibweise gesetzt,
 * die UBL verlangt (Invariante 1). Fehlt ein Pflichtfeld, entsteht KEIN
 * Dokument: `XRechnungUnvollstaendigFehler` nennt jede fehlende
 * Geschaeftsanforderung mit ihrer BT-Nummer und ihrer Regel. Der leise
 * Ausfall waere ein Dokument, das gut aussieht und beim Empfaenger
 * durchfaellt — an einer Rechnung, die nach §14 UStG nicht mehr geaendert
 * werden darf und nur noch storniert werden kann.
 *
 * **Geprueft wird nicht hier.** Die KoSIT-Pruefung ist eine CI-Sache
 * (`tests/compliance/xrechnung/`); dieser Bauer behauptet nie, sein Ergebnis
 * sei gueltig. Er stellt nur sicher, dass die Felder da sind, die er selbst
 * kennt — und das ist eine schwaechere Aussage, mit Absicht.
 */
import { addiere, cent, type Cent } from '../geld.js';
import type {
  Anschrift, Kontakt, Position, RechnungVollstaendig, Steuerzeile, Zuschlag,
} from '../kanonisch.js';
import { mengeNachPostgres, type MilliMenge } from '../menge.js';
import { dokument, el, feld, type Element } from './xml.js';

/**
 * Was die Pflichtfeldpruefung liest — WENIGER als eine ganze Rechnung.
 *
 * **Warum eine eigene, schmalere Gestalt.** Dieselbe Pruefung wird zweimal
 * gebraucht, und die beiden Male haben verschieden viel in der Hand:
 *
 * 1. Beim BAUEN des Dokuments liegt die kanonische Nutzlast vor —
 *    `RechnungVollstaendig` erfuellt diese Schnittstelle von selbst, ohne
 *    eine Zeile Umwandlung.
 * 2. In der §14-VORPRUEFUNG (`ustg14.ts`) liegt sie NICHT vor: der Entwurf
 *    hat noch keine Nummer und keine Kettenposition, und die Nutzlast wird
 *    erst nach dem Zug gebaut (§5.6). Dort wird die Gestalt aus der
 *    Pruefabfrage zusammengesetzt.
 *
 * Die Alternative waere gewesen, die Liste der Pflichtfelder zweimal zu
 * schreiben — einmal fuer die Vorschau, einmal fuer das Dokument. Zwei
 * Listen driften auseinander, und zwar in der teuren Richtung: die Vorschau
 * sagt „vollstaendig", die Rechnung wird festgeschrieben, und der Bauer
 * weigert sich danach.
 */
export interface PruefbarePosition {
  readonly nr: number;
  readonly art: string;
  readonly einheit: string | null;
  readonly einheitCode: string | null;
  readonly nettoCent: Cent | null;
  readonly einzelpreisCent: Cent | null;
}

export interface PruefbareSteuerzeile {
  readonly steuersatzGruppe: string;
  readonly kategorie: string;
  readonly befreiungsgrundCode: string | null;
  readonly befreiungsgrundText: string | null;
}

export interface XRechnungEingabe {
  readonly nummer: string;
  /**
   * BT-3 — auf einem ENTWURF `null`.
   *
   * Der Code entsteht erst beim Zug der Nummer (`fin.rechnung_nummer_ziehen`),
   * und die Vorpruefung laeuft davor. Er wird deshalb nur geprueft, wenn er
   * schon da ist; ihn vorher zu verlangen hiesse, jeden Entwurf abzuweisen.
   */
  readonly rechnungsartCode: string | null;
  readonly leistender: {
    readonly name: string;
    readonly anschrift: Anschrift;
    readonly kontakt: Kontakt;
    readonly steuernummer: string | null;
    readonly ustid: string | null;
    readonly eadresse: string | null;
    readonly eadresseSchema: string | null;
  };
  readonly empfaenger: {
    readonly name: string;
    readonly anschrift: Anschrift;
    readonly leitwegId: string | null;
    readonly kaeuferReferenz: string | null;
    readonly eadresse: string | null;
    readonly eadresseSchema: string | null;
  };
  readonly zahlung: {
    readonly zahlungsmittelCode: string | null;
    readonly bankkonto: { readonly iban: string } | null;
  };
  readonly steuerzeilen: readonly PruefbareSteuerzeile[];
  readonly positionen: readonly PruefbarePosition[];
}

/**
 * Die Kennung, an der ein Pruefer erkennt, wogegen er pruefen soll (BT-24).
 *
 * **Falsch gesetzt ist sie schlimmer als fehlend, und das ist hier passiert.**
 * Der erste Entwurf trug `urn:xoev-de:kosit:standard:xrechnung_3.0` — die
 * Schreibweise der Fassung 2.x. Zur 3.0 hat die KoSIT den Bezeichner auf
 * `urn:xeinkauf.de:kosit:xrechnung_3.0` umgestellt. Das Dokument war damit
 * wohlgeformt, vollstaendig und inhaltlich richtig; der Pruefer meldete
 * `noScenarioMatched` und wies es ab, OHNE einen einzigen inhaltlichen Fehler
 * zu nennen. Gefunden hat das der echte KoSIT-Lauf, nicht eine Zeile, die ich
 * mir ausgedacht habe — und genau deshalb steht er in CI.
 */
export const CUSTOMIZATION_ID
  = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

/** BT-23 — der Geschaeftsprozess. XRechnung schreibt diesen Wert vor. */
export const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

const NS = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac':
    'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc':
    'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

/**
 * Die UNTDID-1001-Codes, die in ein UBL-`Invoice`-Dokument gehoeren.
 *
 * 381 (Gutschrift) steht bewusst NICHT darauf: eine Gutschrift ist in UBL ein
 * `CreditNote`-Dokument mit eigenen Elementnamen, kein `Invoice` mit anderem
 * Code. `fin.rechnung_nummer_ziehen` vergibt heute nur 380, 384 und 386 —
 * eine Stornorechnung ist bei uns eine Rechnung mit umgekehrten Vorzeichen
 * (K-12, §5.5) und traegt 384. Kaeme spaeter ein 381 hinzu, faellt es hier
 * auf, statt ein `Invoice` mit unmoeglichem Code zu erzeugen.
 */
const ERLAUBTE_ARTCODES: ReadonlySet<string> = new Set(['380', '384', '386']);

export interface FehlendesFeld {
  /** `BT-41`, `BG-16` … — die Nummer, die im Pruefbericht des Empfaengers steht. */
  readonly bt: string;
  /** Die Regel, die es verlangt — `BR-DE-6`, `BR-CO-26` … */
  readonly regel: string;
  /** Wo der Wert gepflegt wird, in der Sprache des Portals. */
  readonly feld: string;
  readonly text: string;
}

export class XRechnungUnvollstaendigFehler extends Error {
  readonly fehlend: readonly FehlendesFeld[];

  constructor(nummer: string, fehlend: readonly FehlendesFeld[]) {
    super(
      `Zu Rechnung ${nummer} entsteht keine XRechnung: `
      + `${String(fehlend.length)} Pflichtangabe(n) fehlen — `
      + fehlend.map((f) => `${f.bt} (${f.regel}): ${f.text}`).join('; '),
    );
    this.name = 'XRechnungUnvollstaendigFehler';
    this.fehlend = fehlend;
  }
}

export class XRechnungFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'XRechnungFehler';
  }
}

// ---------------------------------------------------------------------------
// Zahlen
// ---------------------------------------------------------------------------

/**
 * Cent → `"1234.56"`. Punkt als Dezimaltrenner, immer zwei Stellen.
 *
 * Kein `toFixed`, kein `Intl`: beide gehen ueber `number`, und ein Betrag
 * jenseits von 2^53 Cent verlaesst den sicheren Bereich. `bigint` und
 * Zeichenketten tun das nie. Das Minus steht VOR der Zahl und nicht vor dem
 * Nachkommateil — `-0.05` und nicht `0.-05`, was die naive Zerlegung ergibt.
 */
export function centAlsBetrag(wert: Cent): string {
  const negativ = wert < 0n;
  const betrag = negativ ? -wert : wert;
  const ganz = betrag / 100n;
  const rest = betrag % 100n;
  return `${negativ ? '-' : ''}${ganz.toString(10)}.${rest.toString(10).padStart(2, '0')}`;
}

/**
 * Basispunkte → Prozent als Dezimalzahl: `1900` → `"19.00"`, `700` → `"7.00"`.
 *
 * EN 16931 fuehrt den Satz als Prozentwert (BT-119), nicht als Faktor. Ein
 * `0.19` waere 0,19 % — dieselbe Verwechslung, die eine 19-%-Rechnung mit
 * 0,19 % Steuer beim Pruefer durchfallen laesst, weil die Summe nicht passt.
 */
export function bpAlsProzent(bp: number): string {
  if (!Number.isInteger(bp)) {
    throw new XRechnungFehler(`Steuersatz ist keine ganze Zahl Basispunkte: ${String(bp)}`);
  }
  const negativ = bp < 0;
  const betrag = Math.abs(bp);
  return `${negativ ? '-' : ''}${String(Math.trunc(betrag / 100))}`
    + `.${String(betrag % 100).padStart(2, '0')}`;
}

/**
 * Eine Menge als UBL-Dezimalzahl.
 *
 * Dieselbe Umwandlung wie in der Nutzlast (`mengeAlsText`): drei
 * Nachkommastellen, Punkt als Trenner, gerechnet auf `bigint`. Hier eine
 * zweite zu schreiben hiesse, dass XRechnung und Snapshot bei derselben Menge
 * verschiedene Zahlen zeigen koennen — und eine davon waere falsch.
 */
function mengeDurchreichen(menge: MilliMenge | null): string | null {
  return menge === null ? null : mengeNachPostgres(menge);
}

function leer(wert: string | null | undefined): boolean {
  return wert === null || wert === undefined || wert.trim() === '';
}

/**
 * Der Betrag OHNE Vorzeichen.
 *
 * UBL fuehrt Nachlaesse und Zuschlaege als positive Zahlen und unterscheidet
 * sie am `ChargeIndicator`, nicht am Vorzeichen. Ein negatives `cbc:Amount`
 * ergaebe einen Nachlass, der die Summe ERHOEHT — BR-CO-13 faellt darueber,
 * und wer nur auf die Endsumme sieht, merkt es nicht.
 */
function betrag(wert: Cent): Cent {
  return wert < 0n ? cent(-wert) : wert;
}

// ---------------------------------------------------------------------------
// Was fehlen darf und was nicht
// ---------------------------------------------------------------------------

export interface UblOptionen {
  /**
   * Die Kennung des Verkaeufers als elektronische Adresse (BT-34) und ihr
   * Schema (EAS-Codeliste). Steht in der Nutzlast; die Optionen tragen nur
   * den Notnagel fuer den Fall, dass ein Mandant beides noch nicht gepflegt
   * hat — und der Notnagel ist ein FEHLER, keine Vorgabe.
   */
  readonly leitwegPflicht: boolean;
}

/**
 * Der Pflichtfeldbericht — vor dem ersten Element, nicht waehrenddessen.
 *
 * Ein Bauer, der beim ersten fehlenden Feld abbricht, schickt den Menschen
 * am Bildschirm fuenfmal hintereinander in dieselbe Maske. Gesammelt wird
 * deshalb alles, und erst danach geworfen.
 */
export function fehlendePflichtfelder(
  r: XRechnungEingabe,
  optionen: UblOptionen,
): readonly FehlendesFeld[] {
  const fehlt: FehlendesFeld[] = [];
  const m = (bt: string, regel: string, feldName: string, text: string): void => {
    fehlt.push({ bt, regel, feld: feldName, text });
  };

  // --- Der Leistende (BG-4, BG-5, BG-6) ---
  if (leer(r.leistender.name)) {
    m('BT-27', 'BR-06', 'mandant.firma', 'Der Name der ausstellenden Gesellschaft fehlt.');
  }
  pruefeAnschrift(r.leistender.anschrift, 'leistender', fehlt);

  if (leer(r.leistender.kontakt.name)) {
    m('BT-41', 'BR-DE-6', 'mandant.rechnung_kontakt_name',
      'Die Kontaktstelle der Gesellschaft fehlt — die XRechnung verlangt sie, '
      + 'und sie wird nicht erfunden.');
  }
  if (leer(r.leistender.kontakt.telefon)) {
    m('BT-42', 'BR-DE-7', 'mandant.telefon', 'Die Rufnummer der Gesellschaft fehlt.');
  }
  if (leer(r.leistender.kontakt.email)) {
    m('BT-43', 'BR-DE-8', 'mandant.email', 'Die E-Mail-Adresse der Gesellschaft fehlt.');
  }
  /**
   * BR-DE-16: Steuernummer ODER USt-IdNr. — eine von beiden reicht, und
   * genau deshalb steht hier ein ODER und keine zwei Pruefungen. Eine
   * Gesellschaft ohne USt-IdNr. rechnet im Inland voellig regulaer mit der
   * Steuernummer ab; sie hier zu verlangen, wiese gueltige Rechnungen ab.
   */
  if (leer(r.leistender.ustid) && leer(r.leistender.steuernummer)) {
    m('BT-31/BT-32', 'BR-DE-16', 'mandant.ust_id',
      'Weder USt-IdNr. noch Steuernummer der Gesellschaft ist hinterlegt.');
  }
  if (leer(r.leistender.eadresse)) {
    m('BT-34', 'BR-62', 'mandant (elektronische Adresse)',
      'Die elektronische Adresse der Gesellschaft fehlt.');
  } else if (leer(r.leistender.eadresseSchema)) {
    m('BT-34-1', 'BR-62', 'mandant (EAS-Schema)',
      'Zur elektronischen Adresse der Gesellschaft fehlt das Schema (EAS-Code).');
  }

  // --- Der Empfaenger (BG-7, BG-8) ---
  if (leer(r.empfaenger.name)) {
    m('BT-44', 'BR-07', 'kunde.name', 'Der Name des Leistungsempfängers fehlt.');
  }
  pruefeAnschrift(r.empfaenger.anschrift, 'empfaenger', fehlt);
  if (leer(r.empfaenger.eadresse)) {
    m('BT-49', 'BR-63', 'kunde.elektronische_adresse',
      'Die elektronische Adresse des Leistungsempfängers fehlt.');
  } else if (leer(r.empfaenger.eadresseSchema)) {
    m('BT-49-1', 'BR-63', 'kunde (EAS-Schema)',
      'Zur elektronischen Adresse des Empfängers fehlt das Schema (EAS-Code).');
  }

  /**
   * **BT-10 — das Feld, an dem die ganze Uebung haengt.**
   *
   * BR-DE-15 macht die Kaeuferreferenz in jeder XRechnung zur Pflicht; bei
   * einem oeffentlichen Auftraggeber IST sie die Leitweg-ID, und ohne sie
   * findet die Rechnung ihren Empfaenger im Portal nicht. Sie wird nie
   * geraten: welche Leitweg-ID zu welchem Auftraggeber gehoert und ueber
   * welchen Weg (ZRE, OZG-RE, Landesportal, Peppol) eingeliefert wird, ist
   * O-22 und eine Auskunft des Kunden.
   */
  const referenz = r.empfaenger.leitwegId ?? r.empfaenger.kaeuferReferenz;
  if (leer(referenz)) {
    m('BT-10', 'BR-DE-15', 'kunde.leitweg_id',
      optionen.leitwegPflicht
        ? 'Die Leitweg-ID des öffentlichen Auftraggebers fehlt (O-22).'
        : 'Die Käuferreferenz fehlt; bei einem öffentlichen Auftraggeber ist das '
          + 'die Leitweg-ID (O-22).');
  }

  // --- Zahlung (BG-16) ---
  if (leer(r.zahlung.zahlungsmittelCode)) {
    m('BT-81', 'BR-DE-1', 'rechnung.zahlungsmittel_code',
      'Die Zahlungsart fehlt (UNTDID 4461).');
  }
  /**
   * BR-DE-13: bei SEPA-Ueberweisung (58) ist die IBAN Pflicht. Bei einer
   * anderen Zahlungsart ist sie es nicht — eine Lastschrift traegt statt
   * dessen das Mandat. Deshalb haengt die Pruefung am Code und nicht an der
   * Frage, ob ein Bankkonto gepflegt ist.
   */
  if (r.zahlung.zahlungsmittelCode === '58' && leer(r.zahlung.bankkonto?.iban)) {
    m('BT-84', 'BR-DE-13', 'mandant.iban',
      'Zur SEPA-Überweisung fehlt die IBAN der Gesellschaft.');
  }

  // --- Zeilen und Steuer ---
  if (r.steuerzeilen.length === 0) {
    m('BG-23', 'BR-45', 'rechnung_steuer',
      'Die Rechnung trägt keine einzige Steueraufteilung.');
  }
  for (const s of r.steuerzeilen) {
    if (s.kategorie !== 'S' && s.kategorie !== 'Z'
      && leer(s.befreiungsgrundText) && leer(s.befreiungsgrundCode)) {
      m('BT-120/BT-121', 'BR-E-10, BR-AE-10, BR-IC-10',
        `steuersatz_gruppe ${s.steuersatzGruppe}`,
        `Zur Steuerkategorie ${s.kategorie} fehlt der Befreiungsgrund.`);
    }
  }
  for (const p of abrechenbarePositionen(r)) {
    if (leer(p.einheitCode)) {
      m('BT-130', 'BR-23', `Position ${String(p.nr)} · Einheit`,
        `Zur Einheit „${p.einheit ?? '—'}" ist kein UN/ECE-Rec-20-Code hinterlegt (O-174).`);
    }
    if (p.nettoCent === null) {
      m('BT-131', 'BR-24', `Position ${String(p.nr)}`, 'Der Zeilenbetrag fehlt.');
    }
    if (p.einzelpreisCent === null) {
      m('BT-146', 'BR-26', `Position ${String(p.nr)}`, 'Der Einzelpreis fehlt.');
    }
  }

  if (r.rechnungsartCode !== null && !ERLAUBTE_ARTCODES.has(r.rechnungsartCode)) {
    m('BT-3', 'BR-DE-17', 'rechnung.rechnungsart_code',
      `Der Rechnungsart-Code ${JSON.stringify(r.rechnungsartCode)} gehört nicht in ein `
      + 'UBL-Invoice-Dokument.');
  }

  return fehlt;
}

function pruefeAnschrift(
  a: Anschrift,
  wer: 'leistender' | 'empfaenger',
  fehlt: FehlendesFeld[],
): void {
  const [strasse, ort, plz, land] = wer === 'leistender'
    ? ['BT-35', 'BT-37', 'BT-38', 'BT-40'] as const
    : ['BT-50', 'BT-52', 'BT-53', 'BT-55'] as const;
  const regelStrasse = wer === 'leistender' ? 'BR-DE-3' : 'BR-DE-10';
  const regelOrt = wer === 'leistender' ? 'BR-DE-4' : 'BR-DE-11';
  const regelPlz = wer === 'leistender' ? 'BR-DE-5' : 'BR-DE-12';
  const wo = wer === 'leistender' ? 'Gesellschaft' : 'Leistungsempfänger';
  const quelle = wer === 'leistender' ? 'mandant' : 'kunde';

  if (leer(a.strasse)) {
    fehlt.push({
      bt: strasse, regel: regelStrasse, feld: `${quelle}.strasse`,
      text: `Die Straße der ${wo} fehlt.`,
    });
  }
  if (leer(a.ort)) {
    fehlt.push({
      bt: ort, regel: regelOrt, feld: `${quelle}.ort`, text: `Der Ort der ${wo} fehlt.`,
    });
  }
  if (leer(a.plz)) {
    fehlt.push({
      bt: plz, regel: regelPlz, feld: `${quelle}.plz`,
      text: `Die Postleitzahl der ${wo} fehlt.`,
    });
  }
  /**
   * BR-09 verlangt den Laendercode ohne Ausnahme, und er muss ein
   * ISO-3166-1-alpha-2-Code sein. Ein leeres Feld faellt auf; ein „Deutschland"
   * oder „DEU" faellt beim Pruefer auf — deshalb wird hier die FORM geprueft
   * und nicht nur die Anwesenheit.
   */
  if (!/^[A-Z]{2}$/u.test(a.land)) {
    fehlt.push({
      bt: land, regel: 'BR-09', feld: `${quelle}.land`,
      text: `Der Ländercode der ${wo} ist kein ISO-3166-1-alpha-2-Code `
        + `(${JSON.stringify(a.land)}).`,
    });
  }
}

/**
 * Nur echte Leistungszeilen werden UBL-Zeilen.
 *
 * `textzeile` und `zwischensumme` sind Darstellung: sie tragen keinen Betrag
 * und keine Menge. Als `InvoiceLine` ausgegeben ergaeben sie Zeilen ohne
 * `LineExtensionAmount` — BR-24 abgewiesen — und ihre Summe passte nicht mehr
 * zu BT-106.
 */
function abrechenbarePositionen<T extends { readonly art: string }>(
  r: { readonly positionen: readonly T[] },
): readonly T[] {
  return r.positionen.filter((p) => p.art === 'leistung');
}

// ---------------------------------------------------------------------------
// Die Bausteine
// ---------------------------------------------------------------------------

function anschriftElement(a: Anschrift): Element {
  return el('cac:PostalAddress', [
    feld('cbc:StreetName', a.strasse),
    feld('cbc:AdditionalStreetName', a.zusatz),
    feld('cbc:CityName', a.ort),
    feld('cbc:PostalZone', a.plz),
    el('cac:Country', [feld('cbc:IdentificationCode', a.land)]),
  ]);
}

function kontaktElement(k: Kontakt): Element {
  return el('cac:Contact', [
    feld('cbc:Name', k.name),
    feld('cbc:Telephone', k.telefon),
    feld('cbc:ElectronicMail', k.email),
  ]);
}

/**
 * Die Steuerkennzeichnung einer Zeile oder eines Nachlasses.
 *
 * `TaxScheme/ID` ist immer `VAT` — auch bei Reverse Charge und bei
 * Steuerbefreiung. Die Kategorie sagt, WAS gilt (`AE`, `E`, `S`), das Schema
 * sagt, um welche Steuerart es ueberhaupt geht. Wer hier `AE` statt `VAT`
 * setzt, faellt bei BR-CL-... durch.
 */
function steuerKategorie(kategorie: string, satzBp: number, elementName: string): Element {
  return el(elementName, [
    feld('cbc:ID', kategorie),
    feld('cbc:Percent', bpAlsProzent(satzBp)),
    el('cac:TaxScheme', [feld('cbc:ID', 'VAT')]),
  ]);
}

function steuerZeileElement(s: Steuerzeile): Element {
  return el('cac:TaxSubtotal', [
    feld('cbc:TaxableAmount', centAlsBetrag(s.nettoCent), { currencyID: '' }),
    feld('cbc:TaxAmount', centAlsBetrag(s.steuerCent), { currencyID: '' }),
    el('cac:TaxCategory', [
      feld('cbc:ID', s.kategorie),
      feld('cbc:Percent', bpAlsProzent(s.satzBp)),
      feld('cbc:TaxExemptionReasonCode', s.befreiungsgrundCode),
      feld('cbc:TaxExemptionReason', s.befreiungsgrundText),
      el('cac:TaxScheme', [feld('cbc:ID', 'VAT')]),
    ]),
  ]);
}

/**
 * Ein Nachlass oder Zuschlag auf Dokumentebene (BG-20 / BG-21).
 *
 * `ChargeIndicator` entscheidet, welcher von beiden es ist — und er entscheidet
 * zugleich, ob der Betrag in BT-107 oder in BT-108 summiert wird. Vertauscht
 * ergibt sich eine Rechnung, deren Endsumme um das Doppelte des Nachlasses
 * danebenliegt, und BR-CO-13 weist sie ab.
 */
function zuschlagElement(z: Zuschlag): Element {
  const istZuschlag = z.art === 'zuschlag';
  return el('cac:AllowanceCharge', [
    feld('cbc:ChargeIndicator', istZuschlag ? 'true' : 'false'),
    feld('cbc:AllowanceChargeReasonCode', z.grundCode),
    feld('cbc:AllowanceChargeReason', z.bezeichnung),
    feld('cbc:MultiplierFactorNumeric', z.satzBp === null ? null : bpAlsProzent(z.satzBp)),
    feld('cbc:Amount', centAlsBetrag(betrag(z.betragCent)), { currencyID: '' }),
    feld('cbc:BaseAmount', z.basisCent === null ? null : centAlsBetrag(z.basisCent),
      { currencyID: '' }),
    steuerKategorie(z.gruppeKategorie, z.gruppeSatzBp, 'cac:TaxCategory'),
  ]);
}

function positionElement(p: Position, waehrung: string): Element {
  const menge = mengeDurchreichen(p.menge);
  return el('cac:InvoiceLine', [
    feld('cbc:ID', String(p.nr)),
    feld('cbc:InvoicedQuantity', menge, { unitCode: p.einheitCode ?? '' }),
    feld('cbc:LineExtensionAmount', p.nettoCent === null ? null : centAlsBetrag(p.nettoCent),
      { currencyID: waehrung }),
    p.leistungVon === null && p.leistungBis === null ? null : el('cac:InvoicePeriod', [
      feld('cbc:StartDate', p.leistungVon),
      feld('cbc:EndDate', p.leistungBis),
    ]),
    el('cac:Item', [
      feld('cbc:Description', p.beschreibung),
      feld('cbc:Name', p.bezeichnung),
      steuerKategorie(p.kategorie, p.satzBp, 'cac:ClassifiedTaxCategory'),
    ]),
    el('cac:Price', [
      feld('cbc:PriceAmount',
        p.einzelpreisCent === null ? null : centAlsBetrag(p.einzelpreisCent),
        { currencyID: waehrung }),
      feld('cbc:BaseQuantity', mengeDurchreichen(p.preisBasismenge),
        { unitCode: p.einheitCode ?? '' }),
    ]),
  ]);
}

/**
 * Die Waehrung wird NACHTRAEGLICH gesetzt, nicht an jedem Aufrufpunkt.
 *
 * `currencyID` steht an jedem einzelnen Betragselement, und UBL weist ein
 * Dokument ab, in dem zwei Betraege verschiedene Waehrungen nennen. Sie an
 * vierzig Stellen durchzureichen hiess, sie an vierzig Stellen vergessen zu
 * koennen; die Bausteine setzen deshalb ein leeres `currencyID`, und dieser
 * Durchgang fuellt genau die leeren. Ein bereits gesetzter Wert (die Zeilen
 * tragen ihn direkt) bleibt unberuehrt — und zwei verschiedene faenden sich
 * damit sofort.
 */
function mitWaehrung(element: Element, waehrung: string): Element {
  const attribute = element.attribute['currencyID'] === ''
    ? { ...element.attribute, currencyID: waehrung }
    : element.attribute;
  return {
    name: element.name,
    attribute,
    text: element.text,
    kinder: element.kinder.map((k) => mitWaehrung(k, waehrung)),
  };
}

// ---------------------------------------------------------------------------
// Der Bauer
// ---------------------------------------------------------------------------

/**
 * Die XRechnung zu einer festgeschriebenen Rechnung — oder gar nichts.
 *
 * @throws XRechnungUnvollstaendigFehler wenn eine Pflichtangabe fehlt. Der
 *   Fehler traegt die Liste, damit die Oberflaeche sie in EINEM Durchgang
 *   zeigen kann.
 */
export function baueUbl(
  r: RechnungVollstaendig,
  optionen: UblOptionen = { leitwegPflicht: false },
): string {
  const fehlt = fehlendePflichtfelder(r, optionen);
  if (fehlt.length > 0) throw new XRechnungUnvollstaendigFehler(r.nummer, fehlt);

  const w = r.waehrung;
  const referenz = r.empfaenger.leitwegId ?? r.empfaenger.kaeuferReferenz;
  const positionen = abrechenbarePositionen(r);

  /**
   * BT-106 ist die SUMME DER ZEILEN, nicht `netto_gesamt_cent`.
   *
   * Die beiden gehen auseinander, sobald ein Nachlass auf Dokumentebene
   * existiert: BT-109 = BT-106 − BT-107 + BT-108, und BR-CO-13 rechnet das
   * nach. Wer hier die Kopfsumme einsetzt, baut eine Rechnung, die in sich
   * nicht aufgeht — und zwar erst dann, wenn zum ersten Mal ein Nachlass
   * gewaehrt wird.
   */
  const summeZeilen = addiere(...positionen.map((p) => p.nettoCent ?? cent(0n)));
  const summeNachlass = addiere(
    ...r.zuschlaege.filter((z) => z.art !== 'zuschlag').map((z) => betrag(z.betragCent)),
  );
  const summeZuschlag = addiere(
    ...r.zuschlaege.filter((z) => z.art === 'zuschlag').map((z) => betrag(z.betragCent)),
  );

  /**
   * BT-113 „bereits gezahlt" traegt die abgezogenen Abschlaege (FIN-08).
   *
   * Das ist die Stelle, an der eine Schlussrechnung im EN-16931-Modell
   * ueberhaupt abbildbar ist: die Zeilen und die Steuer zeigen die GANZE
   * Leistung, und der Abzug steht als geleistete Zahlung daneben. Zoege man
   * ihn von den Zeilen ab, stimmte die ausgewiesene Umsatzsteuer nicht mehr
   * mit dem ueberein, was tatsaechlich geschuldet ist.
   */
  const bereitsGezahlt = addiere(
    ...r.abzuege.flatMap((x) => [x.abzugNettoCent, x.abzugSteuerCent]),
  );

  const wurzel = el('Invoice', [
    feld('cbc:CustomizationID', CUSTOMIZATION_ID),
    feld('cbc:ProfileID', PROFILE_ID),
    feld('cbc:ID', r.nummer),
    feld('cbc:IssueDate', r.rechnungsdatum),
    feld('cbc:DueDate', r.zahlung.faelligAm),
    feld('cbc:InvoiceTypeCode', r.rechnungsartCode),
    feld('cbc:Note', r.steuerhinweis),
    feld('cbc:DocumentCurrencyCode', w),
    feld('cbc:BuyerReference', referenz),

    r.leistungVon === null && r.leistungBis === null ? null : el('cac:InvoicePeriod', [
      feld('cbc:StartDate', r.leistungVon),
      feld('cbc:EndDate', r.leistungBis),
    ]),
    r.empfaenger.bestellnummer === null ? null : el('cac:OrderReference', [
      feld('cbc:ID', r.empfaenger.bestellnummer),
    ]),

    el('cac:AccountingSupplierParty', [
      el('cac:Party', [
        feld('cbc:EndpointID', r.leistender.eadresse,
          { schemeID: r.leistender.eadresseSchema ?? '' }),
        el('cac:PartyName', [feld('cbc:Name', r.leistender.name)]),
        anschriftElement(r.leistender.anschrift),
        r.leistender.ustid === null ? null : el('cac:PartyTaxScheme', [
          feld('cbc:CompanyID', r.leistender.ustid),
          el('cac:TaxScheme', [feld('cbc:ID', 'VAT')]),
        ]),
        /**
         * Die Steuernummer geht mit `FC` („Fiscal Code") heraus, die
         * USt-IdNr. mit `VAT`. Beide unter `VAT` zu fuehren ergaebe zwei
         * `PartyTaxScheme` mit demselben Schema — BR-CO-9 faellt darueber.
         */
        r.leistender.steuernummer === null ? null : el('cac:PartyTaxScheme', [
          feld('cbc:CompanyID', r.leistender.steuernummer),
          el('cac:TaxScheme', [feld('cbc:ID', 'FC')]),
        ]),
        /**
         * **Ohne `RegistrationAddress`** — und das Registergericht hat hier
         * keinen Platz.
         *
         * Der erste Entwurf trug es als `RegistrationAddress/CityName`, weil
         * §35a GmbHG es auf jedem Geschaeftsbrief verlangt. EN 16931 kennt
         * dafuer kein BT, und UBL-CR-185 sagt ausdruecklich, dass ein
         * UBL-Rechnungsdokument dieses Element nicht fuehren soll; der
         * KoSIT-Pruefer nahm das Dokument an und meldete den Verstoss.
         * Angenommen mit Beanstandung ist ein Zustand, in dem niemand
         * arbeiten will.
         *
         * Verloren geht nichts: das Registergericht steht im Snapshot und auf
         * dem PDF, das die XRechnung nach FIN-12 begleitet. Die
         * Handelsregisternummer bleibt — fuer die gibt es BT-30.
         */
        el('cac:PartyLegalEntity', [
          feld('cbc:RegistrationName', r.leistender.name),
          feld('cbc:CompanyID', r.leistender.hrb),
        ]),
        kontaktElement(r.leistender.kontakt),
      ]),
    ]),

    el('cac:AccountingCustomerParty', [
      el('cac:Party', [
        feld('cbc:EndpointID', r.empfaenger.eadresse,
          { schemeID: r.empfaenger.eadresseSchema ?? '' }),
        el('cac:PartyName', [feld('cbc:Name', r.empfaenger.name)]),
        anschriftElement(r.empfaenger.anschrift),
        r.empfaenger.ustid === null ? null : el('cac:PartyTaxScheme', [
          feld('cbc:CompanyID', r.empfaenger.ustid),
          el('cac:TaxScheme', [feld('cbc:ID', 'VAT')]),
        ]),
        el('cac:PartyLegalEntity', [feld('cbc:RegistrationName', r.empfaenger.name)]),
      ]),
    ]),

    /**
     * BG-13 — der Leistungsort. Er steht hier, weil eine Gebaeudereinigung
     * oder ein Wachdienst an einem Objekt erbracht wird und nicht am Sitz des
     * Kunden; ohne ihn kann der Empfaenger die Rechnung im Haus nicht
     * zuordnen.
     */
    r.objekt === null ? null : el('cac:Delivery', [
      feld('cbc:ActualDeliveryDate', r.leistungBis),
      el('cac:DeliveryLocation', [anschriftElement(r.objekt.anschrift)]),
      el('cac:DeliveryParty', [
        el('cac:PartyName', [feld('cbc:Name', r.objekt.bezeichnung)]),
      ]),
    ]),

    el('cac:PaymentMeans', [
      feld('cbc:PaymentMeansCode', r.zahlung.zahlungsmittelCode),
      feld('cbc:PaymentID', r.nummer),
      r.zahlung.bankkonto === null ? null : el('cac:PayeeFinancialAccount', [
        feld('cbc:ID', r.zahlung.bankkonto.iban),
        feld('cbc:Name', r.zahlung.bankkonto.kontoinhaber),
        r.zahlung.bankkonto.bic === null ? null
          : el('cac:FinancialInstitutionBranch', [feld('cbc:ID', r.zahlung.bankkonto.bic)]),
      ]),
    ]),
    r.zahlung.zahlungsbedingungText === null ? null : el('cac:PaymentTerms', [
      feld('cbc:Note', r.zahlung.zahlungsbedingungText),
    ]),

    ...r.zuschlaege.map(zuschlagElement),

    el('cac:TaxTotal', [
      feld('cbc:TaxAmount', centAlsBetrag(r.steuerGesamtCent), { currencyID: '' }),
      ...r.steuerzeilen.map(steuerZeileElement),
    ]),

    el('cac:LegalMonetaryTotal', [
      feld('cbc:LineExtensionAmount', centAlsBetrag(summeZeilen), { currencyID: '' }),
      feld('cbc:TaxExclusiveAmount', centAlsBetrag(r.nettoGesamtCent), { currencyID: '' }),
      feld('cbc:TaxInclusiveAmount', centAlsBetrag(r.bruttoCent), { currencyID: '' }),
      feld('cbc:AllowanceTotalAmount', centAlsBetrag(summeNachlass), { currencyID: '' }),
      feld('cbc:ChargeTotalAmount', centAlsBetrag(summeZuschlag), { currencyID: '' }),
      feld('cbc:PrepaidAmount', centAlsBetrag(bereitsGezahlt), { currencyID: '' }),
      feld('cbc:PayableAmount', centAlsBetrag(r.zahlbetragCent), { currencyID: '' }),
    ]),

    ...positionen.map((p) => positionElement(p, w)),
  ], NS);

  return dokument(mitWaehrung(wurzel, w));
}
