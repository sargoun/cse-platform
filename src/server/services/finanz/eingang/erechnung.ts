/**
 * E-Rechnung lesen — XRechnung (UBL 2.1), CII (EN 16931, ZUGFeRD/Factur-X)
 * — und daraus einen VORSCHLAG fuer eine Eingangsrechnung bauen (ACC-05,
 * PR 63).
 *
 * **Was dieses Modul ist: deterministisch.** Eine E-Rechnung ist strukturiert;
 * jeder Wert steht in einem benannten Element. Es gibt hier kein Modell, kein
 * Raten und keine Konfidenz „nach Gefuehl": jedes Feld nennt das Element, aus
 * dem es stammt, und traegt Befunde, die TATSACHEN ueber die Daten sind —
 * eine Summe geht auf oder sie geht nicht auf, eine IBAN stimmt oder sie
 * stimmt nicht (`freigabe/konfidenz.ts`). OCR fuer gescannte PDF ist ein
 * anderer Weg; er hat keinen Anbieter (O-135) und ist hier NICHT vertreten —
 * ein PDF ohne eingebettete XML liefert keinen Vorschlag, und die Oberflaeche
 * sagt das.
 *
 * **Was dieses Modul NICHT tut: schreiben oder rechnen, was zaehlt.** Es liest
 * die Betraege, die der Lieferant nennt, und prueft sie nach; die Rechenprobe
 * ist eine Kontrolle, keine Bildung einer neuen Zahl (Invariante 6). Was am
 * Ende in `eingangsrechnung` steht, entscheidet ein Mensch in der Freigabe
 * (Invariante 7) — dieses Modul liefert die Nutzlast und die Nachweise.
 *
 * **Geld als `bigint`-Cent, gelesen ueber Zeichenketten** (Invariante 1).
 * `"1190.00"` wird zu `119000n`, nie ueber `Number`. Mehr als zwei
 * Nachkommastellen sind ein Befund, keine Rundung.
 */
import { formatiereGeld, type Cent, cent } from '../geld.js';
import type { Befund, Pruefung } from '../../freigabe/konfidenz.js';
import {
  XmlLeseFehler, alle, kind, kinder, leseXml, pfad, text, type Knoten,
} from '../xml-lesen.js';

export type ERechnungFormat = 'ubl' | 'cii';

export class ERechnungFehler extends Error {
  constructor(nachricht: string, readonly grund: 'kein_xml' | 'kein_format' | 'unvollstaendig') {
    super(nachricht);
    this.name = 'ERechnungFehler';
  }
}

/** Ein Feld, wie es das Modul liefert — ohne Dokument, das bindet der Dienst. */
export interface Rohfeld {
  /** JSON-Pointer in die Nutzlast, z. B. `/nettoCent`. */
  readonly feldPfad: string;
  readonly bezeichnung: string;
  /** Die Darstellung fuer den Menschen — nie Eingabe einer Rechnung. */
  readonly wert: string | null;
  /** Der Elementpfad in der XML, z. B. `Invoice/LegalMonetaryTotal/TaxExclusiveAmount`. */
  readonly zelle: string;
  /** Der Text, wie er im Element steht. */
  readonly zitat: string | null;
  readonly befunde: readonly Befund[];
}

export interface Steuerzeile {
  readonly kategorie: string;
  readonly satzBp: number;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
}

export interface Lieferant {
  readonly name: string | null;
  readonly ustId: string | null;
  readonly steuernummer: string | null;
  readonly iban: string | null;
  readonly bic: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string | null;
  readonly email: string | null;
}

/** Die Nutzlast des Vorschlags — GENAU das, was bei Freigabe uebernommen wird. */
export interface ERechnungNutzlast {
  readonly format: ERechnungFormat;
  readonly lieferant: Lieferant;
  readonly rechnungsnummer: string | null;
  readonly rechnungsartCode: string | null;
  readonly rechnungsdatum: string | null;
  readonly faelligAm: string | null;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly kaeuferReferenz: string | null;
  readonly bestellnummer: string | null;
  readonly waehrung: string | null;
  readonly nettoCent: Cent | null;
  readonly steuerCent: Cent | null;
  readonly bruttoCent: Cent | null;
  readonly bereitsGezahltCent: Cent | null;
  readonly zahlbetragCent: Cent | null;
  readonly steuerzeilen: readonly Steuerzeile[];
  readonly positionenAnzahl: number;
}

export interface ERechnungExtrakt {
  readonly format: ERechnungFormat;
  readonly nutzlast: ERechnungNutzlast;
  readonly felder: readonly Rohfeld[];
}

// ---------------------------------------------------------------------------
// Lesen einzelner Werte — jede Pruefung ist eine Tatsache
// ---------------------------------------------------------------------------

const ok = (pruefung: Pruefung): Befund => ({ pruefung, bestanden: true, hinweis: null });
const nein = (pruefung: Pruefung, hinweis: string): Befund => ({ pruefung, bestanden: false, hinweis });

/** `"1190.00"` → `119000n`; drei Nachkommastellen sind ein Befund, keine Rundung. */
export function centAusBetrag(roh: string): Cent | null {
  const t = roh.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(t);
  if (m === null) return null;
  const nach = (m[3] ?? '').padEnd(2, '0');
  const wert = BigInt(m[2]!) * 100n + BigInt(nach);
  return cent(m[1] === '-' ? -wert : wert);
}

/** `"19.00"` → `1900`; `"7"` → `700`. Basispunkte ueber die Zeichenkette. */
export function bpAusProzent(roh: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/u.exec(roh.trim());
  if (m === null) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** ISO `2026-09-11` oder CII `20260911` (Format 102) → ISO. */
export function isoDatum(roh: string): string | null {
  const t = roh.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/u.exec(t) ?? /^(\d{4})(\d{2})(\d{2})$/u.exec(t);
  if (iso === null) return null;
  const [, j, m, d] = iso;
  const tag = new Date(Date.UTC(Number(j), Number(m) - 1, Number(d)));
  if (tag.getUTCFullYear() !== Number(j) || tag.getUTCMonth() !== Number(m) - 1
      || tag.getUTCDate() !== Number(d)) {
    return null;
  }
  return `${j}-${m}-${d}`;
}

/** IBAN nach ISO 13616: Laendercode, Pruefziffer, Modulo 97 — ueber BigInt. */
export function ibanGueltig(roh: string): boolean {
  const iban = roh.replace(/\s+/gu, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;
  const umgestellt = iban.slice(4) + iban.slice(0, 4);
  const ziffern = umgestellt.replace(/[A-Z]/gu, (z) => String(z.charCodeAt(0) - 55));
  return BigInt(ziffern) % 97n === 1n;
}

function deutschesDatum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Das Zitat: der Text des Knotens, oder `null`. */
const zitatVon = (k: Knoten | null): string | null => text(k);

interface Gelesen<T> {
  readonly wert: T | null;
  readonly feld: Rohfeld;
}

function liesBetrag(
  k: Knoten | null, zelle: string, feldPfad: string, bezeichnung: string,
): Gelesen<Cent> {
  const roh = zitatVon(k);
  if (roh === null) {
    return { wert: null, feld: { feldPfad, bezeichnung, wert: null, zelle, zitat: null,
      befunde: [nein('formatpruefung', `${bezeichnung} fehlt in der Datei`)] } };
  }
  const wert = centAusBetrag(roh);
  if (wert === null) {
    return { wert: null, feld: { feldPfad, bezeichnung, wert: roh, zelle, zitat: roh,
      befunde: [nein('formatpruefung', `${bezeichnung} ist kein Betrag mit hoechstens zwei Nachkommastellen: ${roh}`)] } };
  }
  return { wert, feld: { feldPfad, bezeichnung, wert: formatiereGeld(wert), zelle, zitat: roh,
    befunde: [ok('formatpruefung')] } };
}

function liesDatum(
  k: Knoten | null, zelle: string, feldPfad: string, bezeichnung: string, pflicht: boolean,
): Gelesen<string> {
  const roh = zitatVon(k);
  if (roh === null) {
    return { wert: null, feld: { feldPfad, bezeichnung, wert: null, zelle, zitat: null,
      befunde: pflicht ? [nein('formatpruefung', `${bezeichnung} fehlt in der Datei`)] : [ok('formatpruefung')] } };
  }
  const iso = isoDatum(roh);
  if (iso === null) {
    return { wert: null, feld: { feldPfad, bezeichnung, wert: roh, zelle, zitat: roh,
      befunde: [nein('formatpruefung', `${bezeichnung} ist kein Kalendertag: ${roh}`)] } };
  }
  return { wert: iso, feld: { feldPfad, bezeichnung, wert: deutschesDatum(iso), zelle, zitat: roh,
    befunde: [ok('formatpruefung')] } };
}

function liesText(
  k: Knoten | null, zelle: string, feldPfad: string, bezeichnung: string, pflicht: boolean,
): Gelesen<string> {
  const roh = zitatVon(k);
  if (roh === null) {
    return { wert: null, feld: { feldPfad, bezeichnung, wert: null, zelle, zitat: null,
      befunde: pflicht ? [nein('formatpruefung', `${bezeichnung} fehlt in der Datei`)] : [ok('formatpruefung')] } };
  }
  return { wert: roh, feld: { feldPfad, bezeichnung, wert: roh, zelle, zitat: roh,
    befunde: [ok('formatpruefung')] } };
}

// ---------------------------------------------------------------------------
// Die Vokabulare
// ---------------------------------------------------------------------------

export function erkenneFormat(wurzel: Knoten): ERechnungFormat | null {
  if (wurzel.name === 'Invoice' || wurzel.name === 'CreditNote') return 'ubl';
  if (wurzel.name === 'CrossIndustryInvoice') return 'cii';
  return null;
}

interface Rohlage {
  readonly nummer: Knoten | null;
  readonly artCode: Knoten | null;
  readonly datum: Knoten | null;
  readonly faellig: Knoten | null;
  readonly von: Knoten | null;
  readonly bis: Knoten | null;
  readonly kaeuferReferenz: Knoten | null;
  readonly bestellnummer: Knoten | null;
  readonly waehrung: Knoten | null;
  readonly lieferantName: Knoten | null;
  readonly lieferantUstId: Knoten | null;
  readonly lieferantSteuernummer: Knoten | null;
  readonly lieferantStrasse: Knoten | null;
  readonly lieferantPlz: Knoten | null;
  readonly lieferantOrt: Knoten | null;
  readonly lieferantLand: Knoten | null;
  readonly lieferantEmail: Knoten | null;
  readonly iban: Knoten | null;
  readonly bic: Knoten | null;
  readonly netto: Knoten | null;
  readonly steuer: Knoten | null;
  readonly brutto: Knoten | null;
  readonly gezahlt: Knoten | null;
  readonly zahlbetrag: Knoten | null;
  readonly steuerzeilen: readonly { kategorie: Knoten | null; prozent: Knoten | null;
    basis: Knoten | null; betrag: Knoten | null; zelle: string }[];
  readonly positionen: number;
  readonly zellen: Readonly<Record<string, string>>;
}

function ublLage(w: Knoten): Rohlage {
  const wurzel = w.name;
  const verkaeufer = pfad(w, 'AccountingSupplierParty', 'Party');
  const steuerschemen = verkaeufer === null ? [] : kinder(verkaeufer, 'PartyTaxScheme');
  const mitSchema = (id: string): Knoten | null =>
    steuerschemen.find((s) => text(pfad(s, 'TaxScheme', 'ID')) === id)?.kinder
      .find((c) => c.name === 'CompanyID') ?? null;
  const zahlung = kind(w, 'PaymentMeans');
  const konto = zahlung === null ? null : kind(zahlung, 'PayeeFinancialAccount');
  const summen = kind(w, 'LegalMonetaryTotal');
  const steuerTotal = kind(w, 'TaxTotal');
  const zeilen = steuerTotal === null ? [] : kinder(steuerTotal, 'TaxSubtotal');
  const P = (...n: string[]): string => [wurzel, ...n].join('/');
  const zeitraum = kind(w, 'InvoicePeriod');
  return {
    nummer: kind(w, 'ID'),
    artCode: kind(w, wurzel === 'CreditNote' ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'),
    datum: kind(w, 'IssueDate'),
    faellig: kind(w, 'DueDate'),
    von: zeitraum === null ? null : kind(zeitraum, 'StartDate'),
    bis: zeitraum === null ? null : kind(zeitraum, 'EndDate'),
    kaeuferReferenz: kind(w, 'BuyerReference'),
    bestellnummer: pfad(w, 'OrderReference', 'ID'),
    waehrung: kind(w, 'DocumentCurrencyCode'),
    lieferantName: verkaeufer === null ? null
      : (pfad(verkaeufer, 'PartyLegalEntity', 'RegistrationName') ?? pfad(verkaeufer, 'PartyName', 'Name')),
    lieferantUstId: mitSchema('VAT'),
    lieferantSteuernummer: mitSchema('FC'),
    lieferantStrasse: verkaeufer === null ? null : pfad(verkaeufer, 'PostalAddress', 'StreetName'),
    lieferantPlz: verkaeufer === null ? null : pfad(verkaeufer, 'PostalAddress', 'PostalZone'),
    lieferantOrt: verkaeufer === null ? null : pfad(verkaeufer, 'PostalAddress', 'CityName'),
    lieferantLand: verkaeufer === null ? null : pfad(verkaeufer, 'PostalAddress', 'Country', 'IdentificationCode'),
    lieferantEmail: verkaeufer === null ? null : pfad(verkaeufer, 'Contact', 'ElectronicMail'),
    iban: konto === null ? null : kind(konto, 'ID'),
    bic: konto === null ? null : pfad(konto, 'FinancialInstitutionBranch', 'ID'),
    netto: summen === null ? null : kind(summen, 'TaxExclusiveAmount'),
    steuer: steuerTotal === null ? null : kind(steuerTotal, 'TaxAmount'),
    brutto: summen === null ? null : kind(summen, 'TaxInclusiveAmount'),
    gezahlt: summen === null ? null : kind(summen, 'PrepaidAmount'),
    zahlbetrag: summen === null ? null : kind(summen, 'PayableAmount'),
    steuerzeilen: zeilen.map((z, i) => ({
      kategorie: pfad(z, 'TaxCategory', 'ID'),
      prozent: pfad(z, 'TaxCategory', 'Percent'),
      basis: kind(z, 'TaxableAmount'),
      betrag: kind(z, 'TaxAmount'),
      zelle: P('TaxTotal', `TaxSubtotal[${String(i + 1)}]`),
    })),
    positionen: kinder(w, wurzel === 'CreditNote' ? 'CreditNoteLine' : 'InvoiceLine').length,
    zellen: {
      nummer: P('ID'), artCode: P('InvoiceTypeCode'), datum: P('IssueDate'), faellig: P('DueDate'),
      von: P('InvoicePeriod', 'StartDate'), bis: P('InvoicePeriod', 'EndDate'),
      kaeuferReferenz: P('BuyerReference'), bestellnummer: P('OrderReference', 'ID'),
      waehrung: P('DocumentCurrencyCode'),
      lieferantName: P('AccountingSupplierParty', 'Party', 'PartyLegalEntity', 'RegistrationName'),
      lieferantUstId: P('AccountingSupplierParty', 'Party', 'PartyTaxScheme', 'CompanyID'),
      lieferantSteuernummer: P('AccountingSupplierParty', 'Party', 'PartyTaxScheme[FC]', 'CompanyID'),
      lieferantAnschrift: P('AccountingSupplierParty', 'Party', 'PostalAddress'),
      lieferantEmail: P('AccountingSupplierParty', 'Party', 'Contact', 'ElectronicMail'),
      iban: P('PaymentMeans', 'PayeeFinancialAccount', 'ID'),
      bic: P('PaymentMeans', 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID'),
      netto: P('LegalMonetaryTotal', 'TaxExclusiveAmount'), steuer: P('TaxTotal', 'TaxAmount'),
      brutto: P('LegalMonetaryTotal', 'TaxInclusiveAmount'),
      gezahlt: P('LegalMonetaryTotal', 'PrepaidAmount'),
      zahlbetrag: P('LegalMonetaryTotal', 'PayableAmount'),
    },
  };
}

function ciiLage(w: Knoten): Rohlage {
  const dok = kind(w, 'ExchangedDocument');
  const trans = kind(w, 'SupplyChainTradeTransaction');
  const vertrag = trans === null ? null : kind(trans, 'ApplicableHeaderTradeAgreement');
  const abrechnung = trans === null ? null : kind(trans, 'ApplicableHeaderTradeSettlement');
  const verkaeufer = vertrag === null ? null : kind(vertrag, 'SellerTradeParty');
  const registrierungen = verkaeufer === null ? [] : kinder(verkaeufer, 'SpecifiedTaxRegistration');
  const mitSchema = (schema: string): Knoten | null =>
    registrierungen.map((r) => kind(r, 'ID')).find((id) => id?.attribute['schemeID'] === schema) ?? null;
  const zahlung = abrechnung === null ? null : kind(abrechnung, 'SpecifiedTradeSettlementPaymentMeans');
  const summen = abrechnung === null ? null : kind(abrechnung, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const zeitraum = abrechnung === null ? null : kind(abrechnung, 'BillingSpecifiedPeriod');
  const termine = abrechnung === null ? null : kind(abrechnung, 'SpecifiedTradePaymentTerms');
  const zeilen = abrechnung === null ? [] : kinder(abrechnung, 'ApplicableTradeTax');
  const datumIn = (k: Knoten | null): Knoten | null => (k === null ? null : kind(k, 'DateTimeString'));
  const P = (...n: string[]): string => ['CrossIndustryInvoice', ...n].join('/');
  const S = (...n: string[]): string => P('SupplyChainTradeTransaction', 'ApplicableHeaderTradeSettlement', ...n);
  const A = (...n: string[]): string => P('SupplyChainTradeTransaction', 'ApplicableHeaderTradeAgreement', ...n);
  return {
    nummer: dok === null ? null : kind(dok, 'ID'),
    artCode: dok === null ? null : kind(dok, 'TypeCode'),
    datum: dok === null ? null : datumIn(kind(dok, 'IssueDateTime')),
    faellig: termine === null ? null : datumIn(kind(termine, 'DueDateDateTime')),
    von: zeitraum === null ? null : datumIn(kind(zeitraum, 'StartDateTime')),
    bis: zeitraum === null ? null : datumIn(kind(zeitraum, 'EndDateTime')),
    kaeuferReferenz: vertrag === null ? null : kind(vertrag, 'BuyerReference'),
    bestellnummer: vertrag === null ? null : pfad(vertrag, 'BuyerOrderReferencedDocument', 'IssuerAssignedID'),
    waehrung: abrechnung === null ? null : kind(abrechnung, 'InvoiceCurrencyCode'),
    lieferantName: verkaeufer === null ? null : kind(verkaeufer, 'Name'),
    lieferantUstId: mitSchema('VA'),
    lieferantSteuernummer: mitSchema('FC'),
    lieferantStrasse: verkaeufer === null ? null : pfad(verkaeufer, 'PostalTradeAddress', 'LineOne'),
    lieferantPlz: verkaeufer === null ? null : pfad(verkaeufer, 'PostalTradeAddress', 'PostcodeCode'),
    lieferantOrt: verkaeufer === null ? null : pfad(verkaeufer, 'PostalTradeAddress', 'CityName'),
    lieferantLand: verkaeufer === null ? null : pfad(verkaeufer, 'PostalTradeAddress', 'CountryID'),
    lieferantEmail: verkaeufer === null ? null
      : pfad(verkaeufer, 'DefinedTradeContact', 'EmailURIUniversalCommunication', 'URIID'),
    iban: zahlung === null ? null : pfad(zahlung, 'PayeePartyCreditorFinancialAccount', 'IBANID'),
    bic: zahlung === null ? null : pfad(zahlung, 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID'),
    netto: summen === null ? null : kind(summen, 'TaxBasisTotalAmount'),
    steuer: summen === null ? null : kind(summen, 'TaxTotalAmount'),
    brutto: summen === null ? null : kind(summen, 'GrandTotalAmount'),
    gezahlt: summen === null ? null : kind(summen, 'TotalPrepaidAmount'),
    zahlbetrag: summen === null ? null : kind(summen, 'DuePayableAmount'),
    steuerzeilen: zeilen.map((z, i) => ({
      kategorie: kind(z, 'CategoryCode'),
      prozent: kind(z, 'RateApplicablePercent'),
      basis: kind(z, 'BasisAmount'),
      betrag: kind(z, 'CalculatedAmount'),
      zelle: S(`ApplicableTradeTax[${String(i + 1)}]`),
    })),
    positionen: trans === null ? 0 : kinder(trans, 'IncludedSupplyChainTradeLineItem').length,
    zellen: {
      nummer: P('ExchangedDocument', 'ID'), artCode: P('ExchangedDocument', 'TypeCode'),
      datum: P('ExchangedDocument', 'IssueDateTime'),
      faellig: S('SpecifiedTradePaymentTerms', 'DueDateDateTime'),
      von: S('BillingSpecifiedPeriod', 'StartDateTime'), bis: S('BillingSpecifiedPeriod', 'EndDateTime'),
      kaeuferReferenz: A('BuyerReference'),
      bestellnummer: A('BuyerOrderReferencedDocument', 'IssuerAssignedID'),
      waehrung: S('InvoiceCurrencyCode'),
      lieferantName: A('SellerTradeParty', 'Name'),
      lieferantUstId: A('SellerTradeParty', 'SpecifiedTaxRegistration[VA]', 'ID'),
      lieferantSteuernummer: A('SellerTradeParty', 'SpecifiedTaxRegistration[FC]', 'ID'),
      lieferantAnschrift: A('SellerTradeParty', 'PostalTradeAddress'),
      lieferantEmail: A('SellerTradeParty', 'DefinedTradeContact', 'EmailURIUniversalCommunication', 'URIID'),
      iban: S('SpecifiedTradeSettlementPaymentMeans', 'PayeePartyCreditorFinancialAccount', 'IBANID'),
      bic: S('SpecifiedTradeSettlementPaymentMeans', 'PayeeSpecifiedCreditorFinancialInstitution', 'BICID'),
      netto: S('SpecifiedTradeSettlementHeaderMonetarySummation', 'TaxBasisTotalAmount'),
      steuer: S('SpecifiedTradeSettlementHeaderMonetarySummation', 'TaxTotalAmount'),
      brutto: S('SpecifiedTradeSettlementHeaderMonetarySummation', 'GrandTotalAmount'),
      gezahlt: S('SpecifiedTradeSettlementHeaderMonetarySummation', 'TotalPrepaidAmount'),
      zahlbetrag: S('SpecifiedTradeSettlementHeaderMonetarySummation', 'DuePayableAmount'),
    },
  };
}

// ---------------------------------------------------------------------------
// Die Rechenprobe — kaufmaennisch gerundet, exakt verglichen
// ---------------------------------------------------------------------------

/** `netto × satz`, kaufmaennisch auf Cent gerundet — ueber BigInt, nie ueber float. */
export function steuerAus(nettoCent: Cent, satzBp: number): Cent {
  const negativ = nettoCent < 0n;
  const abs = negativ ? -nettoCent : nettoCent;
  const roh = (abs * BigInt(satzBp) + 5000n) / 10000n;
  return cent(negativ ? -roh : roh);
}

// ---------------------------------------------------------------------------
// Der Extrakt
// ---------------------------------------------------------------------------

/**
 * Liest eine E-Rechnung und liefert Nutzlast und Felder.
 *
 * Wirft nur, wenn die Datei keine E-Rechnung IST (kein XML, kein bekanntes
 * Vokabular). Alles andere — fehlende Pflichtfelder, Summen, die nicht
 * aufgehen, eine Fremdwaehrung — ist ein BEFUND am Feld: der Vorschlag
 * entsteht, und der Mensch sieht, was nicht stimmt (APR-03).
 */
export function extrahiereERechnung(xml: string): ERechnungExtrakt {
  let wurzel: Knoten;
  try {
    wurzel = leseXml(xml);
  } catch (fehler: unknown) {
    if (fehler instanceof XmlLeseFehler) {
      throw new ERechnungFehler(fehler.message, 'kein_xml');
    }
    throw fehler;
  }
  const format = erkenneFormat(wurzel);
  if (format === null) {
    throw new ERechnungFehler(
      `Die Datei ist kein XRechnung-, CII- oder ZUGFeRD-Datensatz (Wurzel <${wurzel.name}>). `
      + 'Ein anderes XML ist keine E-Rechnung.',
      'kein_format');
  }
  const lage = format === 'ubl' ? ublLage(wurzel) : ciiLage(wurzel);
  const z = lage.zellen;
  const felder: Rohfeld[] = [];
  const nimm = <T,>(g: Gelesen<T>): T | null => { felder.push(g.feld); return g.wert; };

  const nummer = nimm(liesText(lage.nummer, z['nummer']!, '/rechnungsnummer', 'Rechnungsnummer des Lieferanten', true));
  const artCode = nimm(liesText(lage.artCode, z['artCode']!, '/rechnungsartCode', 'Rechnungsart (Code)', false));
  const datum = nimm(liesDatum(lage.datum, z['datum']!, '/rechnungsdatum', 'Rechnungsdatum', true));
  const faellig = nimm(liesDatum(lage.faellig, z['faellig']!, '/faelligAm', 'Fällig am', false));
  const von = nimm(liesDatum(lage.von, z['von']!, '/leistungVon', 'Leistungszeitraum von', false));
  const bis = nimm(liesDatum(lage.bis, z['bis']!, '/leistungBis', 'Leistungszeitraum bis', false));
  const kaeuferReferenz = nimm(liesText(lage.kaeuferReferenz, z['kaeuferReferenz']!, '/kaeuferReferenz', 'Käuferreferenz', false));
  const bestellnummer = nimm(liesText(lage.bestellnummer, z['bestellnummer']!, '/bestellnummer', 'Bestellnummer', false));

  /* Waehrung: EUR, sonst Befund (O-05 — eine Fremdwaehrung wird nicht als Euro gefuehrt). */
  const waehrungRoh = zitatVon(lage.waehrung);
  const waehrung = waehrungRoh;
  felder.push({
    feldPfad: '/waehrung', bezeichnung: 'Währung', wert: waehrungRoh, zelle: z['waehrung']!, zitat: waehrungRoh,
    befunde: [waehrungRoh === 'EUR' ? ok('formatpruefung')
      : nein('formatpruefung', waehrungRoh === null
        ? 'Die Datei nennt keine Währung'
        : `Rechnung in ${waehrungRoh} — diese Plattform bucht nur EUR (O-05)`)],
  });

  /* Lieferant */
  const name = nimm(liesText(lage.lieferantName, z['lieferantName']!, '/lieferant/name', 'Lieferant', true));
  const ustIdRoh = zitatVon(lage.lieferantUstId);
  const ustId = ustIdRoh === null ? null : ustIdRoh.replace(/\s+/gu, '').toUpperCase();
  felder.push({
    feldPfad: '/lieferant/ustId', bezeichnung: 'USt-IdNr. des Lieferanten', wert: ustId,
    zelle: z['lieferantUstId']!, zitat: ustIdRoh,
    befunde: [ustId === null ? ok('formatpruefung')
      : /^[A-Z]{2}[A-Z0-9]{2,12}$/u.test(ustId) && (!ustId.startsWith('DE') || /^DE\d{9}$/u.test(ustId))
        ? ok('formatpruefung')
        : nein('formatpruefung', `USt-IdNr. hat nicht die erwartete Form: ${ustIdRoh ?? ''}`)],
  });
  const steuernummer = nimm(liesText(lage.lieferantSteuernummer, z['lieferantSteuernummer']!, '/lieferant/steuernummer', 'Steuernummer des Lieferanten', false));
  const strasse = zitatVon(lage.lieferantStrasse);
  const plz = zitatVon(lage.lieferantPlz);
  const ort = zitatVon(lage.lieferantOrt);
  const land = zitatVon(lage.lieferantLand);
  const anschrift = [strasse, [plz, ort].filter((x) => x !== null).join(' ') || null, land]
    .filter((x) => x !== null && x !== '').join(', ');
  felder.push({
    feldPfad: '/lieferant/strasse', bezeichnung: 'Anschrift des Lieferanten',
    wert: anschrift === '' ? null : anschrift, zelle: z['lieferantAnschrift']!,
    zitat: anschrift === '' ? null : anschrift,
    befunde: [ort === null ? nein('formatpruefung', 'Die Anschrift des Lieferanten nennt keinen Ort') : ok('formatpruefung')],
  });
  const email = nimm(liesText(lage.lieferantEmail, z['lieferantEmail']!, '/lieferant/email', 'E-Mail des Lieferanten', false));

  const ibanRoh = zitatVon(lage.iban);
  const iban = ibanRoh === null ? null : ibanRoh.replace(/\s+/gu, '').toUpperCase();
  felder.push({
    feldPfad: '/lieferant/iban', bezeichnung: 'IBAN des Lieferanten', wert: iban,
    zelle: z['iban']!, zitat: ibanRoh,
    befunde: [iban === null ? ok('formatpruefung')
      : ibanGueltig(iban) ? ok('formatpruefung')
        : nein('formatpruefung', `IBAN-Prüfsumme stimmt nicht: ${ibanRoh ?? ''}`)],
  });
  const bic = nimm(liesText(lage.bic, z['bic']!, '/lieferant/bic', 'BIC', false));

  /* Betraege */
  const netto = nimm(liesBetrag(lage.netto, z['netto']!, '/nettoCent', 'Netto'));
  const steuer = nimm(liesBetrag(lage.steuer, z['steuer']!, '/steuerCent', 'Umsatzsteuer'));
  const brutto = nimm(liesBetrag(lage.brutto, z['brutto']!, '/bruttoCent', 'Brutto'));
  const gezahltG = lage.gezahlt === null ? null : liesBetrag(lage.gezahlt, z['gezahlt']!, '/bereitsGezahltCent', 'Bereits gezahlt');
  const gezahlt = gezahltG === null ? null : nimm(gezahltG);
  const zahlbetragG = lage.zahlbetrag === null ? null : liesBetrag(lage.zahlbetrag, z['zahlbetrag']!, '/zahlbetragCent', 'Zahlbetrag');
  const zahlbetrag = zahlbetragG === null ? null : nimm(zahlbetragG);

  /*
   * Die Rechenprobe am Brutto: Netto + Steuer = Brutto, und Brutto − bereits
   * gezahlt = Zahlbetrag. Eine Summe, die nicht aufgeht, macht das BRUTTO
   * unsicher — es ist der Betrag, der bezahlt wuerde.
   */
  const bruttoFeld = felder.find((f) => f.feldPfad === '/bruttoCent');
  if (bruttoFeld !== undefined && netto !== null && steuer !== null && brutto !== null) {
    const proben: Befund[] = [];
    proben.push(netto + steuer === brutto ? ok('rechenprobe')
      : nein('rechenprobe', `Netto ${formatiereGeld(netto)} + USt ${formatiereGeld(steuer)} ergibt `
        + `${formatiereGeld(cent(netto + steuer))}, die Datei nennt ${formatiereGeld(brutto)}`));
    if (zahlbetrag !== null) {
      const erwartet = cent(brutto - (gezahlt ?? cent(0n)));
      proben.push(erwartet === zahlbetrag ? ok('rechenprobe')
        : nein('rechenprobe', `Brutto abzüglich bereits gezahlt ergibt ${formatiereGeld(erwartet)}, `
          + `der Zahlbetrag lautet ${formatiereGeld(zahlbetrag)}`));
    }
    felder[felder.indexOf(bruttoFeld)] = { ...bruttoFeld, befunde: [...bruttoFeld.befunde, ...proben] };
  }

  /* Steuerzeilen: je Zeile Format, Satzprobe, und die Summen gegen den Kopf. */
  const steuerzeilen: Steuerzeile[] = [];
  let summeBasis = 0n;
  let summeSteuer = 0n;
  lage.steuerzeilen.forEach((s, i) => {
    const kategorie = zitatVon(s.kategorie);
    const prozentRoh = zitatVon(s.prozent);
    const satzBp = prozentRoh === null ? null : bpAusProzent(prozentRoh);
    const basisRoh = zitatVon(s.basis);
    const betragRoh = zitatVon(s.betrag);
    const basis = basisRoh === null ? null : centAusBetrag(basisRoh);
    const betrag = betragRoh === null ? null : centAusBetrag(betragRoh);
    const befunde: Befund[] = [];
    if (kategorie === null || satzBp === null || basis === null || betrag === null) {
      befunde.push(nein('formatpruefung', 'Die Steuerzeile ist unvollständig (Kategorie, Satz, Basis, Betrag)'));
    } else {
      befunde.push(ok('formatpruefung'));
      const erwartet = steuerAus(basis, satzBp);
      befunde.push(erwartet === betrag ? ok('rechenprobe')
        : nein('rechenprobe', `${formatiereGeld(basis)} × ${(satzBp / 100).toFixed(2).replace('.', ',')} % ergibt `
          + `${formatiereGeld(erwartet)}, die Datei nennt ${formatiereGeld(betrag)}`));
      steuerzeilen.push({ kategorie, satzBp, nettoCent: basis, steuerCent: betrag });
      summeBasis += basis;
      summeSteuer += betrag;
    }
    const satzText = satzBp === null ? (prozentRoh ?? '?') : `${(satzBp / 100).toFixed(2).replace('.', ',')} %`;
    felder.push({
      feldPfad: `/steuerzeilen/${String(i)}`,
      bezeichnung: `Steuerzeile ${kategorie ?? '?'} ${satzText}`,
      wert: basis === null || betrag === null ? null
        : `${formatiereGeld(basis)} netto · ${formatiereGeld(betrag)} USt`,
      zelle: s.zelle, zitat: [basisRoh, betragRoh].filter((x) => x !== null).join(' / ') || null,
      befunde,
    });
  });
  if (steuerzeilen.length > 0 && netto !== null && steuer !== null) {
    const nettoFeld = felder.find((f) => f.feldPfad === '/nettoCent')!;
    const steuerFeld = felder.find((f) => f.feldPfad === '/steuerCent')!;
    felder[felder.indexOf(nettoFeld)] = { ...nettoFeld, befunde: [...nettoFeld.befunde,
      summeBasis === netto ? ok('rechenprobe')
        : nein('rechenprobe', `Die Steuerzeilen summieren ${formatiereGeld(cent(summeBasis))} netto, der Kopf nennt ${formatiereGeld(netto)}`)] };
    felder[felder.indexOf(steuerFeld)] = { ...steuerFeld, befunde: [...steuerFeld.befunde,
      summeSteuer === steuer ? ok('rechenprobe')
        : nein('rechenprobe', `Die Steuerzeilen summieren ${formatiereGeld(cent(summeSteuer))} USt, der Kopf nennt ${formatiereGeld(steuer)}`)] };
  } else if (steuerzeilen.length === 0) {
    const steuerFeld = felder.find((f) => f.feldPfad === '/steuerCent')!;
    felder[felder.indexOf(steuerFeld)] = { ...steuerFeld, befunde: [...steuerFeld.befunde,
      nein('rechenprobe', 'Die Datei nennt keine Steuerzeile — der Steuersatz lässt sich nicht bestimmen')] };
  }

  const nutzlast: ERechnungNutzlast = {
    format,
    lieferant: { name, ustId, steuernummer, iban, bic, strasse, plz, ort, land, email },
    rechnungsnummer: nummer,
    rechnungsartCode: artCode,
    rechnungsdatum: datum,
    faelligAm: faellig,
    leistungVon: von,
    leistungBis: bis,
    kaeuferReferenz,
    bestellnummer,
    waehrung,
    nettoCent: netto,
    steuerCent: steuer,
    bruttoCent: brutto,
    bereitsGezahltCent: gezahlt,
    zahlbetragCent: zahlbetrag,
    steuerzeilen,
    positionenAnzahl: lage.positionen,
  };
  return { format, nutzlast, felder };
}

/** Alle Nachfahren — fuer Tests und Diagnosen, die ein Element suchen. */
export const _alle = alle;
