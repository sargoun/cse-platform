import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsPortalSitzung } from './sitzung.js';
import type { Speicher } from '../../storage/adapter.js';
import { extrahiereERechnung } from '../../services/finanz/eingang/erechnung.js';
import { legeERechnungAb } from '../../services/finanz/eingang/ablage.js';

/**
 * Eine E-Rechnung im Posteingang — der Vorschlag, den die Freigabe zur
 * Eingangsrechnung macht (PR 63, ACC-05, APR-01 … APR-03).
 *
 * **Nur mit Speicher.** Ein Beleg zeigt auf eine Dokumentversion samt
 * SHA-256, und die Version auf ein Objekt, das es gibt (ACC-03). Ist kein
 * Objektspeicher verbunden, legt dieser Seed NICHTS an und sagt es —
 * dieselbe Regel wie bei den Lieferanten in `index.ts`: eine Zeile, die auf
 * Bytes zeigt, die niemand oeffnen kann, ist kein Demodatum, sondern ein
 * spaeter gemeldeter Fehler. Die Browsersuite, die ohne Speicher laeuft, baut
 * sich ihre Vorrichtung selbst (`tests/e2e/hilfen/erechnung-vorrichtung.ts`)
 * und sagt das dort.
 *
 * **Derselbe Weg wie im Portal.** Die Datei geht durch `extrahiereERechnung`
 * und `legeERechnungAb` in einer Portalsitzung (`alsPortalSitzung`) — nicht
 * als Eigentuemer, nicht mit eigenen Inserts. Was der Seed hinterlaesst, hat
 * jede Policy und jeden Trigger passiert, die ein Upload auch passiert.
 *
 * **Wiederholbar** ueber `externe_ref = erechnung:<sha256>` der Bytes: der
 * zweite Lauf legt weder Datei noch Beleg noch Vorschlag nach.
 *
 * Der Lieferant ist der aus dem Stamm (`Hygiene Nord Handels GmbH`, ohne
 * USt-IdNr. und IBAN — O-183); die Zuordnung laeuft deshalb ueber den Namen,
 * und der Vorschlag zeigt genau das als Feld.
 */
type Sql = postgres.Sql<Record<string, unknown>>;

export interface EingangErgebnis {
  readonly status: 'angelegt' | 'vorhanden' | 'nicht_verbunden' | 'kein_konto';
  readonly freigabeId: string | null;
  readonly unsichereFelder: number;
}

export interface ERechnungBeispiel {
  readonly rechnungsnummer: string;
  /** ISO-Kalendertag. */
  readonly rechnungsdatum: string;
  readonly faelligAm: string;
  readonly leistungVon: string;
  readonly leistungBis: string;
  readonly lieferantName: string;
  readonly kaeuferName: string;
}

export const BEISPIEL_REINIGUNG: ERechnungBeispiel = {
  rechnungsnummer: 'HN-2026-08117',
  rechnungsdatum: '2026-08-28',
  faelligAm: '2026-09-27',
  leistungVon: '2026-08-01',
  leistungBis: '2026-08-31',
  lieferantName: 'Hygiene Nord Handels GmbH',
  kaeuferName: 'CSE Dienstleistungen GmbH',
};

/**
 * Eine XRechnung (UBL 2.1) ueber 1.250,00 € netto + 19 % = 1.487,50 € —
 * Verbrauchsmaterial fuer einen Monat. Handgeschrieben und knapp: die
 * Elemente, die EN 16931 fuer Kopf, Verkaeufer, Summen und Steuer verlangt,
 * eine Position, keine Erfindung darueber hinaus.
 */
export function beispielERechnungUbl(b: ERechnungBeispiel = BEISPIEL_REINIGUNG): string {
  const x = (s: string): string => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${x(b.rechnungsnummer)}</cbc:ID>
  <cbc:IssueDate>${b.rechnungsdatum}</cbc:IssueDate>
  <cbc:DueDate>${b.faelligAm}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>Objekt Kurfürstendamm — Verbrauchsmaterial</cbc:BuyerReference>
  <cac:InvoicePeriod>
    <cbc:StartDate>${b.leistungVon}</cbc:StartDate>
    <cbc:EndDate>${b.leistungBis}</cbc:EndDate>
  </cac:InvoicePeriod>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>Ostender Straße 8</cbc:StreetName>
        <cbc:CityName>Berlin</cbc:CityName>
        <cbc:PostalZone>13353</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE811223344</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(b.lieferantName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>Rechnungswesen</cbc:Name>
        <cbc:Telephone>+49 30 4500000</cbc:Telephone>
        <cbc:ElectronicMail>rechnung@hygiene-nord.example</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>Kurfürstendamm 201</cbc:StreetName>
        <cbc:CityName>Berlin</cbc:CityName>
        <cbc:PostalZone>10719</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(b.kaeuferName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${x(b.rechnungsnummer)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>DE02100500000054540402</cbc:ID>
      <cbc:Name>${x(b.lieferantName)}</cbc:Name>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms>
    <cbc:Note>Zahlbar innerhalb von 30 Tagen ohne Abzug.</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">237.50</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1250.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">237.50</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">1250.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">1250.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1487.50</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1487.50</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1250.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Verbrauchsmaterial Reinigung — Monatslieferung August 2026</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">1250.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</ubl:Invoice>\n`;
}

/**
 * Legt die Beispielrechnung fuer die Reinigungsgesellschaft ab — oder sagt,
 * warum nicht. `speicher === null` heisst: kein Objektspeicher verbunden.
 */
export async function seedEingang(
  sql: Sql, ids: ReadonlyMap<string, string>, speicher: Speicher | null,
  beispiel: ERechnungBeispiel = BEISPIEL_REINIGUNG,
): Promise<EingangErgebnis> {
  const mandantId = ids.get('reinigung');
  if (mandantId === undefined || speicher === null) {
    return { status: 'nicht_verbunden', freigabeId: null, unsichereFelder: 0 };
  }
  const xml = beispielERechnungUbl(beispiel);
  const bytes = new TextEncoder().encode(xml);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const [da] = await sql<{ id: string; unsichere: number }[]>`
    select id, unsichere_felder_anzahl as unsichere from freigabe
     where mandant_id = ${mandantId} and externe_ref = ${`erechnung:${sha256}`}`;
  if (da !== undefined) {
    return { status: 'vorhanden', freigabeId: da.id, unsichereFelder: da.unsichere };
  }

  /*
   * Wer ablegt: die Administration oder Leitung der Gesellschaft — wie in
   * `konto.ts`. Unter mehreren Administrationen (seit V-164 traegt die
   * Reinigung zwei) zuerst eine OHNE Modulliste, dann die E-Mail — nie die
   * Reihenfolge der Tabelle (V-168).
   */
  const [konto] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel, bm.module is not null, b.email limit 1`;
  if (konto === undefined) return { status: 'kein_konto', freigabeId: null, unsichereFelder: 0 };

  const extrakt = extrahiereERechnung(xml);
  const abgelegt = await alsPortalSitzung(sql, mandantId, konto.id, (kontext) =>
    legeERechnungAb(kontext, speicher, {
      dateiname: `${beispiel.rechnungsnummer}.xml`,
      bytes,
      behaupteterTyp: 'application/xml',
      xml,
      quelleAnzeige: `${beispiel.rechnungsnummer}.xml`,
      extrakt,
      entstehungsJahr: Number(beispiel.rechnungsdatum.slice(0, 4)),
    }));
  return {
    status: 'angelegt',
    freigabeId: abgelegt.vorschlag.freigabeId,
    unsichereFelder: abgelegt.vorschlag.unsichereFelder,
  };
}
