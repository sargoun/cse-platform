/**
 * Die Freistellungsbescheinigungen nach § 48b EStG — die Pflegeseite in
 * beiden Sprachen (FIN-10, V-283, O-604, D-845, D-592).
 *
 * **`Freistellungsbescheinigung`, `Finanzamt` und `§ 48b EStG` bleiben im
 * englischen Text stehen**: sie sind die Namen des Belegs und der Behörde, die
 * auf ihm stehen. Erklärt wird in Klammern, ersetzt wird nicht.
 *
 * **Jede Abweisung hat einen Satz** (D-599, D-728): die Route schickt den
 * Grund als `?fehler=` zurück, die Seite schlägt ihn als eigenen Eintrag nach.
 */
import type { InternSprache } from '../../intern.js';
import type {
  FreistellungGrund, FreistellungStand,
} from '../../../../server/services/finanz/freistellung.js';

export interface FreistellungTexte {
  readonly modul: string;
  readonly titel: string;
  readonly einleitung: string;
  readonly voreinstellung: string;
  readonly leer: string;
  readonly keinSchreibrechtVor: string;
  readonly keinSchreibrechtNach: string;
  readonly spalteTraeger: string;
  readonly spalteNummer: string;
  readonly spalteZeitraum: string;
  readonly spalteUmfang: string;
  readonly spalteBeleg: string;
  readonly spalteStand: string;
  readonly kunde: string;
  readonly lieferant: string;
  readonly unbeschraenkt: string;
  readonly auftragsbezogen: (auftrag: string) => string;
  readonly ohneBeleg: string;
  readonly oeffnen: string;
  readonly belege: (anzahl: number) => string;
  readonly stand: Readonly<Record<FreistellungStand, string>>;
  readonly widerrufenAb: (tag: string) => string;

  readonly neuTitel: string;
  readonly feldTraeger: string;
  readonly lieferantErklaerung: string;
  readonly kundeErklaerung: string;
  readonly feldKunde: string;
  readonly feldLieferant: string;
  readonly traegerHinweis: string;
  readonly keineAuswahl: string;
  readonly feldNummer: string;
  readonly feldFinanzamt: string;
  readonly feldVon: string;
  readonly feldBis: string;
  readonly feldUmfang: string;
  readonly umfangAuftragsbezogen: string;
  readonly feldAuftrag: string;
  readonly feldBeleg: string;
  readonly belegHinweis: string;
  readonly keinBeleg: string;
  readonly anlegen: string;
  readonly festHinweis: string;

  readonly widerrufAb: string;
  readonly widerrufHinweis: string;
  readonly widerrufen: string;
  readonly belegVerknuepfen: string;
  readonly verknuepfen: string;

  readonly erfolg: Readonly<Record<string, string>>;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<FreistellungGrund, string>>;
  readonly fehlerUnbekannt: string;
}

export const FREISTELLUNG_TEXTE: Readonly<Record<InternSprache, FreistellungTexte>> = {
  de: {
    modul: 'Finanzen',
    titel: 'Freistellungsbescheinigungen',
    einleitung: 'Die Bescheinigungen nach § 48b EStG: ohne sie werden bei einer Bauleistung '
      + '15 % der Gegenleistung einbehalten, mit ihr nicht. Die des Lieferanten befreit die '
      + 'Gesellschaft vom Einbehalt auf seine Rechnung; die am Kunden steht auf der '
      + 'Ausgangsrechnung.',
    voreinstellung: 'Voreinstellung (O-604): die Buchhaltung pflegt die Bescheinigungen mit '
      + 'dem Schreibrecht der Finanzen. Eine Bescheinigung wird angelegt und nicht geändert — '
      + 'festgeschriebene Belege nennen ihre Nummer und ihren Zeitraum. Eine falsch erfasste '
      + 'wird widerrufen und neu angelegt.',
    leer: 'Für diese Gesellschaft ist keine Freistellungsbescheinigung erfasst.',
    keinSchreibrechtVor: 'Anlegen und widerrufen kann, wer',
    keinSchreibrechtNach: 'hält.',
    spalteTraeger: 'Für',
    spalteNummer: 'Nummer · Finanzamt',
    spalteZeitraum: 'Gültig',
    spalteUmfang: 'Umfang',
    spalteBeleg: 'Beleg',
    spalteStand: 'Stand',
    kunde: 'Kunde',
    lieferant: 'Lieferant',
    unbeschraenkt: 'unbeschränkt',
    auftragsbezogen: (auftrag) => `für Auftrag ${auftrag}`,
    ohneBeleg: 'ohne Beleg',
    oeffnen: 'Beleg öffnen',
    belege: (n) => (n === 0 ? 'auf keinem Beleg' : n === 1 ? 'auf 1 Beleg'
      : `auf ${String(n)} Belegen`),
    stand: {
      kuenftig: 'künftig',
      gueltig: 'gültig',
      abgelaufen: 'abgelaufen',
      widerrufen: 'widerrufen',
    },
    widerrufenAb: (tag) => `widerrufen ab ${tag}`,

    neuTitel: 'Bescheinigung erfassen',
    feldTraeger: 'Für',
    lieferantErklaerung: 'einen Lieferanten — er hat sie uns vorgelegt; auf seine Rechnungen '
      + 'wird dann nicht einbehalten.',
    kundeErklaerung: 'einen Kunden — sie ist seine; sie steht auf unserer Ausgangsrechnung an ihn.',
    feldKunde: 'Kunde',
    feldLieferant: 'Lieferant',
    traegerHinweis: 'Es zählt die Auswahl zum gewählten „Für"; die andere bleibt unbeachtet.',
    keineAuswahl: '— bitte wählen —',
    feldNummer: 'Nummer der Bescheinigung',
    feldFinanzamt: 'Ausstellendes Finanzamt',
    feldVon: 'Gültig ab',
    feldBis: 'Gültig bis',
    feldUmfang: 'Umfang',
    umfangAuftragsbezogen: 'auftragsbezogen — sie gilt für einen einzigen Auftrag',
    feldAuftrag: 'Auftrag (nur bei auftragsbezogener Bescheinigung)',
    feldBeleg: 'Beleg (Scan)',
    belegHinweis: 'Den Scan legen Sie unter Dokumente › Ablage in der Kategorie „Beleg" oder '
      + '„Buchhaltung" ab; hier wird er verknüpft.',
    keinBeleg: '— noch keiner —',
    anlegen: 'Bescheinigung erfassen',
    festHinweis: 'Nach dem Erfassen stehen Nummer, Finanzamt, Zeitraum und Umfang fest.',

    widerrufAb: 'Widerrufen ab',
    widerrufHinweis: 'Ab heute oder später — nie rückwirkend: für die Zeit davor durfte ohne '
      + 'Einbehalt ausgezahlt werden.',
    widerrufen: 'Widerruf festhalten',
    belegVerknuepfen: 'Beleg verknüpfen',
    verknuepfen: 'Verknüpfen',

    erfolg: {
      angelegt: 'Die Bescheinigung ist erfasst.',
      widerrufen: 'Der Widerruf ist festgehalten.',
      beleg: 'Der Beleg ist verknüpft.',
    },
    abgewiesen: 'Nichts wurde geändert.',
    fehler: {
      traeger_fehlt: 'Für wen gilt die Bescheinigung — bitte einen Kunden oder Lieferanten wählen.',
      traeger_unbekannt: 'Diesen Kunden oder Lieferanten gibt es in dieser Gesellschaft nicht.',
      nummer_fehlt: 'Die Nummer der Bescheinigung steht auf ihr — mindestens drei Zeichen.',
      nummer_vergeben: 'Eine Bescheinigung mit dieser Nummer ist schon erfasst.',
      finanzamt_fehlt: 'Welches Finanzamt hat sie ausgestellt?',
      zeitraum_ungueltig: 'Der Zeitraum braucht zwei Tage, und der zweite liegt nicht vor dem ersten.',
      auftrag_fehlt: 'Eine auftragsbezogene Bescheinigung gilt für EINEN Auftrag — bitte wählen.',
      auftrag_unbekannt: 'Diesen Auftrag gibt es in dieser Gesellschaft nicht.',
      nicht_gefunden: 'Diese Bescheinigung gibt es hier nicht.',
      schon_widerrufen: 'Diese Bescheinigung ist schon widerrufen.',
      widerruf_rueckwirkend: 'Ein Widerruf wirkt ab heute oder später — nie rückwirkend.',
      widerruf_nach_ablauf: 'Nach ihrem Ablauf widerriefe ein Widerruf nichts mehr.',
      beleg_unbekannt: 'Diesen Beleg gibt es in dieser Gesellschaft nicht.',
      beleg_vorhanden: 'Der Beleg ist schon verknüpft — er wird nicht getauscht.',
    },
    fehlerUnbekannt: 'Der Vorgang wurde abgewiesen.',
  },
  en: {
    modul: 'Finance',
    titel: 'Freistellungsbescheinigungen (§ 48b EStG)',
    einleitung: 'The exemption certificates under § 48b EStG: without one, 15 % of the '
      + 'consideration for construction work is withheld; with one, it is not. A supplier\'s '
      + 'certificate exempts the company from withholding on that supplier\'s invoice; a '
      + 'customer\'s appears on the outgoing invoice.',
    voreinstellung: 'Default (O-604): accounting maintains the certificates with the finance '
      + 'write right. A certificate is recorded and never edited — finalized documents name its '
      + 'number and validity. One recorded in error is revoked and recorded again.',
    leer: 'No Freistellungsbescheinigung is on file for this company.',
    keinSchreibrechtVor: 'Whoever holds',
    keinSchreibrechtNach: 'may record and revoke certificates.',
    spalteTraeger: 'For',
    spalteNummer: 'Number · Finanzamt',
    spalteZeitraum: 'Valid',
    spalteUmfang: 'Scope',
    spalteBeleg: 'Document',
    spalteStand: 'Status',
    kunde: 'Customer',
    lieferant: 'Supplier',
    unbeschraenkt: 'unrestricted',
    auftragsbezogen: (auftrag) => `for Auftrag ${auftrag}`,
    ohneBeleg: 'no document',
    oeffnen: 'Open document',
    belege: (n) => (n === 0 ? 'on no document' : n === 1 ? 'on 1 document'
      : `on ${String(n)} documents`),
    stand: {
      kuenftig: 'future',
      gueltig: 'valid',
      abgelaufen: 'expired',
      widerrufen: 'revoked',
    },
    widerrufenAb: (tag) => `revoked from ${tag}`,

    neuTitel: 'Record a certificate',
    feldTraeger: 'For',
    lieferantErklaerung: 'a supplier — they presented it to us; their invoices are then not '
      + 'subject to withholding.',
    kundeErklaerung: 'a customer — it is theirs; it appears on our outgoing invoice to them.',
    feldKunde: 'Customer',
    feldLieferant: 'Supplier',
    traegerHinweis: 'Only the selection matching the chosen "For" counts; the other is ignored.',
    keineAuswahl: '— please choose —',
    feldNummer: 'Certificate number',
    feldFinanzamt: 'Issuing Finanzamt (tax office)',
    feldVon: 'Valid from',
    feldBis: 'Valid until',
    feldUmfang: 'Scope',
    umfangAuftragsbezogen: 'tied to one Auftrag (order) — it applies to that Auftrag only',
    feldAuftrag: 'Auftrag (only for a certificate tied to one Auftrag)',
    feldBeleg: 'Document (scan)',
    belegHinweis: 'File the scan under Documents › Filing in the category "Beleg" or '
      + '"Buchhaltung"; here it is linked.',
    keinBeleg: '— none yet —',
    anlegen: 'Record certificate',
    festHinweis: 'Once recorded, number, Finanzamt, validity and scope are fixed.',

    widerrufAb: 'Revoked from',
    widerrufHinweis: 'Today or later — never backdated: for the time before, payment without '
      + 'withholding was allowed.',
    widerrufen: 'Record revocation',
    belegVerknuepfen: 'Link document',
    verknuepfen: 'Link',

    erfolg: {
      angelegt: 'The certificate is recorded.',
      widerrufen: 'The revocation is recorded.',
      beleg: 'The document is linked.',
    },
    abgewiesen: 'Nothing was changed.',
    fehler: {
      traeger_fehlt: 'Who is the certificate for — please choose a customer or supplier.',
      traeger_unbekannt: 'This customer or supplier does not exist in this company.',
      nummer_fehlt: 'The certificate number is printed on it — at least three characters.',
      nummer_vergeben: 'A certificate with this number is already on file.',
      finanzamt_fehlt: 'Which Finanzamt issued it?',
      zeitraum_ungueltig: 'The validity needs two days, and the second is not before the first.',
      auftrag_fehlt: 'A certificate tied to an Auftrag applies to ONE Auftrag — please choose it.',
      auftrag_unbekannt: 'This Auftrag does not exist in this company.',
      nicht_gefunden: 'This certificate does not exist here.',
      schon_widerrufen: 'This certificate is already revoked.',
      widerruf_rueckwirkend: 'A revocation takes effect today or later — never backdated.',
      widerruf_nach_ablauf: 'After it expires, a revocation would revoke nothing.',
      beleg_unbekannt: 'This document does not exist in this company.',
      beleg_vorhanden: 'A document is already linked — it is not swapped.',
    },
    fehlerUnbekannt: 'The action was refused.',
  },
};
