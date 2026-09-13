import 'server-only';
import { addiere, cent, type Cent } from '../geld.js';
import type {
  Anschrift, Kontakt, Position, RechnungVollstaendig, Steuerzeile, Zuschlag,
} from '../kanonisch.js';
import { dokument, el, feld, type Element } from '../xrechnung/xml.js';
import {
  XRechnungUnvollstaendigFehler, abrechenbarePositionen, betrag, bpAlsProzent,
  centAlsBetrag, fehlendePflichtfelder, mengeDurchreichen, type UblOptionen,
} from '../xrechnung/index.js';

/**
 * ZUGFeRD 2.x — dieselbe Rechnung in UN/CEFACT CII (FIN-12, PR 53).
 *
 * **Warum ein ZWEITES Format, wenn die XRechnung schon steht.** Es sind zwei
 * verschiedene Empfänger. Die XRechnung (UBL) geht an öffentliche
 * Auftraggeber, die sie über einen Prüfdienst einlesen. ZUGFeRD geht an
 * gewerbliche Kunden, die eine PDF-Rechnung erwarten — und in dieser PDF
 * liegt dieselbe Rechnung noch einmal maschinenlesbar. Wer das Papier
 * ansieht, sieht eine Rechnung; wer die Datei einliest, bekommt Daten. EN
 * 16931 ist die gemeinsame Semantik, CII und UBL sind zwei Syntaxen dafür.
 *
 * **Die Zahlen kommen aus derselben Quelle wie im UBL-Bauer, Zeile für
 * Zeile.** `summeZeilen`, `summeNachlass`, `summeZuschlag` und
 * `bereitsGezahlt` werden hier genauso gebildet wie dort; ein Test hält beide
 * Dokumente gegeneinander, und zwar auf den Cent. Zwei Bauer, die dieselbe
 * Rechnung verschieden addieren, ist genau der Fehler, den ein Empfänger erst
 * bemerkt, wenn er das eine Format gegen das andere prüft — und dann steht
 * eine unveränderliche Rechnung im Raum (§14 UStG).
 *
 * **Dieselbe Vorprüfung, dieselbe Weigerung.** `fehlendePflichtfelder` ist
 * der Prüfer beider Formate. Was als XRechnung nicht entsteht, entsteht auch
 * nicht als ZUGFeRD — sonst wäre das eine Format die Hintertür für eine
 * Rechnung, die das andere als unvollständig abgewiesen hat.
 *
 * **Was er NICHT tut: er baut kein PDF.** Das ist `pdfa3.ts`. Dieser Bauer
 * erzeugt die XML-Datei, die dort eingebettet wird — getrennt, weil sie
 * getrennt prüfbar ist.
 */

/**
 * Das Profil (BT-24 in CII-Schreibweise).
 *
 * `urn:cen.eu:en16931:2017` ist das EN-16931-Profil („COMFORT" in der
 * ZUGFeRD-Sprache): der volle Umfang der Norm, ohne die deutschen
 * Zusatzregeln der XRechnung. Genau das ist für einen gewerblichen Empfänger
 * richtig — `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`
 * verlangte Felder wie die Leitweg-ID, die es bei ihm nicht gibt.
 */
export const CII_GUIDELINE = 'urn:cen.eu:en16931:2017';

/** Der Dateiname, unter dem ZUGFeRD 2.x die XML im PDF erwartet. */
export const CII_DATEINAME = 'factur-x.xml';

const NS = {
  'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  'xmlns:ram':
    'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
} as const;

/**
 * CII datiert im Format 102 — `CCYYMMDD`, ohne Bindestriche.
 *
 * Das Attribut `format` ist Pflicht und der einzige Hinweis darauf, wie die
 * Ziffernfolge zu lesen ist. Ein ISO-Datum mit Bindestrichen unter `102`
 * wäre syntaktisch ein Datum und semantisch keines.
 *
 * Ein leeres Datum ergibt KEIN leeres Element, sondern gar keines: ein
 * `<ram:IssueDateTime/>` ohne Inhalt ist nach der Sequenz vorhanden und nach
 * dem Datentyp ungültig — der Prüfer des Empfängers meldet das als
 * Typfehler, nicht als fehlendes Feld.
 */
function datumsElement(name: string, iso: string | null): Element | null {
  if (iso === null || iso.trim() === '') return null;
  const ziffern = iso.slice(0, 10).replace(/-/gu, '');
  return el(name, [feld('udt:DateTimeString', ziffern, { format: '102' })]);
}

function anschriftElement(a: Anschrift): Element {
  /* Reihenfolge nach der CII-Sequenz — sie ist nicht dieselbe wie in UBL. */
  return el('ram:PostalTradeAddress', [
    feld('ram:PostcodeCode', a.plz),
    feld('ram:LineOne', a.strasse),
    feld('ram:LineTwo', a.zusatz),
    feld('ram:CityName', a.ort),
    feld('ram:CountryID', a.land),
  ]);
}

function kontaktElement(k: Kontakt): Element | null {
  if (k.name === null && k.telefon === null && k.email === null) return null;
  return el('ram:DefinedTradeContact', [
    feld('ram:PersonName', k.name),
    k.telefon === null ? null : el('ram:TelephoneUniversalCommunication', [
      feld('ram:CompleteNumber', k.telefon),
    ]),
    k.email === null ? null : el('ram:EmailURIUniversalCommunication', [
      feld('ram:URIID', k.email),
    ]),
  ]);
}

/**
 * Die Steuerkennung — `VA` für die USt-IdNr., `FC` für die Steuernummer.
 *
 * Beide dürfen nebeneinander stehen, und für §13b und §48 EStG ist das kein
 * Beiwerk: der Empfänger muss sehen, wer da abrechnet.
 */
function steuerRegistrierungen(ustid: string | null, steuernummer: string | null):
readonly (Element | null)[] {
  return [
    ustid === null ? null : el('ram:SpecifiedTaxRegistration', [
      feld('ram:ID', ustid, { schemeID: 'VA' }),
    ]),
    steuernummer === null ? null : el('ram:SpecifiedTaxRegistration', [
      feld('ram:ID', steuernummer, { schemeID: 'FC' }),
    ]),
  ];
}

/**
 * Eine Steuerzeile (BG-23) — und der Grund, warum `RateApplicablePercent`
 * auch bei 0 dasteht.
 *
 * BR-CO-17 rechnet `BT-117 = BT-116 × BT-119 / 100` nach. Bei einer
 * steuerfreien Gruppe ist der Satz 0, und weglassen hiesse: der Prüfer
 * rechnet gegen `undefined` statt gegen null.
 */
function steuerElement(z: Steuerzeile): Element {
  return el('ram:ApplicableTradeTax', [
    feld('ram:CalculatedAmount', centAlsBetrag(z.steuerCent)),
    feld('ram:TypeCode', 'VAT'),
    feld('ram:ExemptionReason', z.befreiungsgrundText),
    feld('ram:BasisAmount', centAlsBetrag(z.nettoCent)),
    feld('ram:CategoryCode', z.kategorie),
    feld('ram:ExemptionReasonCode', z.befreiungsgrundCode),
    feld('ram:RateApplicablePercent', bpAlsProzent(z.satzBp)),
  ]);
}

function zuschlagElement(z: Zuschlag): Element {
  const istZuschlag = z.art === 'zuschlag';
  return el('ram:SpecifiedTradeAllowanceCharge', [
    feld('ram:ChargeIndicator', null),
    el('ram:ChargeIndicator', [feld('udt:Indicator', istZuschlag ? 'true' : 'false')]),
    feld('ram:CalculationPercent', z.satzBp === null ? null : bpAlsProzent(z.satzBp)),
    feld('ram:BasisAmount', z.basisCent === null ? null : centAlsBetrag(z.basisCent)),
    feld('ram:ActualAmount', centAlsBetrag(betrag(z.betragCent))),
    feld('ram:ReasonCode', z.grundCode),
    feld('ram:Reason', z.bezeichnung),
    el('ram:CategoryTradeTax', [
      feld('ram:TypeCode', 'VAT'),
      feld('ram:CategoryCode', z.gruppeKategorie),
      feld('ram:RateApplicablePercent', bpAlsProzent(z.gruppeSatzBp)),
    ]),
  ]);
}

function positionElement(p: Position): Element {
  return el('ram:IncludedSupplyChainTradeLineItem', [
    el('ram:AssociatedDocumentLineDocument', [feld('ram:LineID', String(p.nr))]),
    el('ram:SpecifiedTradeProduct', [
      feld('ram:Name', p.bezeichnung),
      feld('ram:Description', p.beschreibung),
    ]),
    el('ram:SpecifiedLineTradeAgreement', [
      el('ram:NetPriceProductTradePrice', [
        feld('ram:ChargeAmount',
          p.einzelpreisCent === null ? null : centAlsBetrag(p.einzelpreisCent)),
        feld('ram:BasisQuantity', mengeDurchreichen(p.preisBasismenge),
          { unitCode: p.einheitCode ?? '' }),
      ]),
    ]),
    el('ram:SpecifiedLineTradeDelivery', [
      feld('ram:BilledQuantity', mengeDurchreichen(p.menge),
        { unitCode: p.einheitCode ?? '' }),
    ]),
    el('ram:SpecifiedLineTradeSettlement', [
      el('ram:ApplicableTradeTax', [
        feld('ram:TypeCode', 'VAT'),
        feld('ram:CategoryCode', p.kategorie),
        feld('ram:RateApplicablePercent', bpAlsProzent(p.satzBp)),
      ]),
      p.leistungVon === null && p.leistungBis === null ? null
        : el('ram:BillingSpecifiedPeriod', [
          datumsElement('ram:StartDateTime', p.leistungVon),
          datumsElement('ram:EndDateTime', p.leistungBis),
        ]),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', [
        feld('ram:LineTotalAmount',
          p.nettoCent === null ? null : centAlsBetrag(p.nettoCent)),
      ]),
    ]),
  ]);
}

/**
 * Die CII-Fassung einer festgeschriebenen Rechnung — oder gar nichts.
 *
 * @throws XRechnungUnvollstaendigFehler wenn eine Pflichtangabe fehlt; mit
 *   derselben Liste, die auch die XRechnung verweigert hätte.
 */
export function baueCii(
  r: RechnungVollstaendig,
  optionen: UblOptionen = { leitwegPflicht: false },
): string {
  const fehlt = fehlendePflichtfelder(r, optionen);
  if (fehlt.length > 0) throw new XRechnungUnvollstaendigFehler(r.nummer, fehlt);

  const positionen = abrechenbarePositionen(r);

  /* Dieselben vier Summen wie im UBL-Bauer — Zeile für Zeile dieselbe Regel. */
  const summeZeilen = addiere(...positionen.map((p) => p.nettoCent ?? cent(0n)));
  const summeNachlass = addiere(
    ...r.zuschlaege.filter((z) => z.art !== 'zuschlag').map((z) => betrag(z.betragCent)),
  );
  const summeZuschlag = addiere(
    ...r.zuschlaege.filter((z) => z.art === 'zuschlag').map((z) => betrag(z.betragCent)),
  );
  const bereitsGezahlt = addiere(
    ...r.abzuege.flatMap((x) => [x.abzugNettoCent, x.abzugSteuerCent]),
  );

  const hinweise: readonly (string | null)[] = [
    r.kopftext, r.steuerhinweis, ...r.hinweise, r.fusstext,
  ];

  const wurzel = el('rsm:CrossIndustryInvoice', [
    el('rsm:ExchangedDocumentContext', [
      el('ram:GuidelineSpecifiedDocumentContextParameter', [
        feld('ram:ID', CII_GUIDELINE),
      ]),
    ]),

    el('rsm:ExchangedDocument', [
      feld('ram:ID', r.nummer),
      feld('ram:TypeCode', r.rechnungsartCode),
      datumsElement('ram:IssueDateTime', r.rechnungsdatum),
      ...hinweise
        .filter((h): h is string => h !== null && h.trim() !== '')
        .map((h) => el('ram:IncludedNote', [feld('ram:Content', h)])),
    ]),

    el('rsm:SupplyChainTradeTransaction', [
      ...positionen.map((p) => positionElement(p)),

      el('ram:ApplicableHeaderTradeAgreement', [
        feld('ram:BuyerReference',
          r.empfaenger.leitwegId ?? r.empfaenger.kaeuferReferenz),
        el('ram:SellerTradeParty', [
          feld('ram:Name', r.leistender.name),
          kontaktElement(r.leistender.kontakt),
          anschriftElement(r.leistender.anschrift),
          r.leistender.eadresse === null ? null
            : el('ram:URIUniversalCommunication', [
              feld('ram:URIID', r.leistender.eadresse,
                { schemeID: r.leistender.eadresseSchema ?? '' }),
            ]),
          ...steuerRegistrierungen(r.leistender.ustid, r.leistender.steuernummer),
        ]),
        el('ram:BuyerTradeParty', [
          feld('ram:Name', r.empfaenger.name),
          anschriftElement(r.empfaenger.anschrift),
          r.empfaenger.eadresse === null ? null
            : el('ram:URIUniversalCommunication', [
              feld('ram:URIID', r.empfaenger.eadresse,
                { schemeID: r.empfaenger.eadresseSchema ?? '' }),
            ]),
          ...steuerRegistrierungen(r.empfaenger.ustid, null),
        ]),
      ]),

      el('ram:ApplicableHeaderTradeDelivery', [
        /*
         * BT-72: der Tag der Leistung. CII kennt dafür ein Ereignis, UBL eine
         * Periode — dieselbe Aussage, zwei Formen. Steht nur ein Zeitraum
         * fest, trägt das Ereignis seinen letzten Tag, und der Zeitraum steht
         * unten noch einmal vollständig.
         */
        (r.leistungBis ?? r.leistungVon) === null ? null
          : el('ram:ActualDeliverySupplyChainEvent', [
            datumsElement('ram:OccurrenceDateTime', r.leistungBis ?? r.leistungVon),
          ]),
      ]),

      el('ram:ApplicableHeaderTradeSettlement', [
        feld('ram:InvoiceCurrencyCode', r.waehrung),
        r.zahlung.zahlungsmittelCode === null ? null
          : el('ram:SpecifiedTradeSettlementPaymentMeans', [
            feld('ram:TypeCode', r.zahlung.zahlungsmittelCode),
            r.zahlung.bankkonto === null ? null
              : el('ram:PayeePartyCreditorFinancialAccount', [
                feld('ram:IBANID', r.zahlung.bankkonto.iban),
                feld('ram:AccountName', r.zahlung.bankkonto.kontoinhaber),
              ]),
            r.zahlung.bankkonto?.bic == null ? null
              : el('ram:PayeeSpecifiedCreditorFinancialInstitution', [
                feld('ram:BICID', r.zahlung.bankkonto.bic),
              ]),
          ]),
        ...r.steuerzeilen.map((z) => steuerElement(z)),
        r.leistungVon === null && r.leistungBis === null ? null
          : el('ram:BillingSpecifiedPeriod', [
            datumsElement('ram:StartDateTime', r.leistungVon),
            datumsElement('ram:EndDateTime', r.leistungBis),
          ]),
        ...r.zuschlaege.map((z) => zuschlagElement(z)),
        r.zahlung.zahlungsbedingungText === null && r.zahlung.faelligAm === null ? null
          : el('ram:SpecifiedTradePaymentTerms', [
            feld('ram:Description', r.zahlung.zahlungsbedingungText),
            datumsElement('ram:DueDateDateTime', r.zahlung.faelligAm),
          ]),
        /*
         * Die Endsummen (BG-22) — in der Reihenfolge, die die CII-Sequenz
         * verlangt, und mit denselben Werten wie `cac:LegalMonetaryTotal`
         * in der XRechnung. `ram:TaxTotalAmount` ist der einzige Betrag hier,
         * der die Währung als Attribut trägt; die übrigen tun es nicht, und
         * ein `currencyID` an ihnen wiese das Dokument ab.
         */
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', [
          feld('ram:LineTotalAmount', centAlsBetrag(summeZeilen)),
          feld('ram:ChargeTotalAmount', centAlsBetrag(summeZuschlag)),
          feld('ram:AllowanceTotalAmount', centAlsBetrag(summeNachlass)),
          feld('ram:TaxBasisTotalAmount', centAlsBetrag(r.nettoGesamtCent)),
          feld('ram:TaxTotalAmount', centAlsBetrag(r.steuerGesamtCent),
            { currencyID: r.waehrung }),
          feld('ram:GrandTotalAmount', centAlsBetrag(r.bruttoCent)),
          feld('ram:TotalPrepaidAmount', centAlsBetrag(bereitsGezahlt)),
          feld('ram:DuePayableAmount', centAlsBetrag(r.zahlbetragCent)),
        ]),
      ]),
    ]),
  ], NS);

  return dokument(wurzel);
}

/** Die Summen, die ein Prüfer gegen die XRechnung hält — als Zahlen, nicht als Text. */
export interface CiiSummen {
  readonly zeilen: Cent;
  readonly nachlass: Cent;
  readonly zuschlag: Cent;
  readonly netto: Cent;
  readonly steuer: Cent;
  readonly brutto: Cent;
  readonly gezahlt: Cent;
  readonly zahlbetrag: Cent;
}

/**
 * Dieselben acht Summen, die `baueCii` in das Dokument schreibt.
 *
 * Sie stehen hier als Funktion, damit ein Test sie gegen die XRechnung halten
 * kann, ohne XML zu lesen — und damit beide Bauer nachweislich dieselbe
 * Rechnung addieren.
 */
export function ciiSummen(r: RechnungVollstaendig): CiiSummen {
  const positionen = abrechenbarePositionen(r);
  return {
    zeilen: addiere(...positionen.map((p) => p.nettoCent ?? cent(0n))),
    nachlass: addiere(
      ...r.zuschlaege.filter((z) => z.art !== 'zuschlag').map((z) => betrag(z.betragCent))),
    zuschlag: addiere(
      ...r.zuschlaege.filter((z) => z.art === 'zuschlag').map((z) => betrag(z.betragCent))),
    netto: r.nettoGesamtCent,
    steuer: r.steuerGesamtCent,
    brutto: r.bruttoCent,
    gezahlt: addiere(...r.abzuege.flatMap((x) => [x.abzugNettoCent, x.abzugSteuerCent])),
    zahlbetrag: r.zahlbetragCent,
  };
}
