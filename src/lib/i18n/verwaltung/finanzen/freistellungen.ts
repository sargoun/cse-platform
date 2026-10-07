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
  readonly eigene: string;
  readonly kunde: string;
  readonly lieferant: string;
  readonly kundenHinweis: string;
  readonly eigeneFehlt: string;
  readonly keineEigeneGueltig: string;
  readonly ablaufHinweis: (nummer: string, bis: string, tage: number) => string;
  readonly unbeschraenkt: string;
  readonly auftragsbezogen: (auftrag: string) => string;
  readonly ohneBeleg: string;
  readonly oeffnen: string;
  readonly belege: (anzahl: number) => string;
  readonly stand: Readonly<Record<FreistellungStand, string>>;
  readonly widerrufenAb: (tag: string) => string;

  readonly neuTitel: string;
  readonly feldTraeger: string;
  readonly eigeneErklaerung: string;
  readonly lieferantErklaerung: string;
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
      + '15 % der Gegenleistung einbehalten, mit ihr nicht — und es zählt immer die des '
      + 'Leistenden (§ 48 Abs. 2 EStG). Die EIGENE der Gesellschaft legt sie ihren Kunden vor; '
      + 'sie steht auf der Ausgangsrechnung. Die eines Lieferanten befreit die Gesellschaft vom '
      + 'Einbehalt auf seine Rechnung.',
    voreinstellung: 'Voreinstellung (O-604): die Buchhaltung pflegt die Bescheinigungen mit '
      + 'dem Schreibrecht der Finanzen. Eine Bescheinigung wird angelegt und nicht geändert — '
      + 'festgeschriebene Belege nennen ihre Nummer und ihren Zeitraum. Eine falsch erfasste '
      + 'wird widerrufen und neu angelegt. Voreinstellung (O-130): an den Ablauf der eigenen '
      + 'erinnert die Plattform Buchhaltung und Geschäftsführung 60, 30 und 7 Tage vorher, '
      + 'solange keine Nachfolgerin erfasst ist.',
    leer: 'Für diese Gesellschaft ist keine Freistellungsbescheinigung erfasst.',
    keinSchreibrechtVor: 'Anlegen und widerrufen kann, wer',
    keinSchreibrechtNach: 'hält.',
    spalteTraeger: 'Für',
    spalteNummer: 'Nummer · Finanzamt',
    spalteZeitraum: 'Gültig',
    spalteUmfang: 'Umfang',
    spalteBeleg: 'Beleg',
    spalteStand: 'Stand',
    eigene: 'Diese Gesellschaft',
    kunde: 'Kunde',
    lieferant: 'Lieferant',
    kundenHinweis: 'Bescheinigungen von Kunden stehen auf dem Steuerblatt des Kunden. Auf '
      + 'Rechnungen der Gesellschaft wirken sie nicht: dort zählt die eigene.',
    eigeneFehlt: 'Die eigene Bescheinigung der Gesellschaft ist nicht erfasst. Erbringt sie '
      + 'Bauleistungen, behalten ihre Kunden ohne sie 15 % ein; ob sie eine hält und bis wann, '
      + 'trägt der Betreiber hier ein (O-130).',
    keineEigeneGueltig: 'Heute gilt keine eigene Bescheinigung der Gesellschaft — Kunden '
      + 'behalten bei Bauleistungen 15 % ein, bis eine neue erfasst ist.',
    ablaufHinweis: (nummer, bis, tage) => `Die eigene Bescheinigung ${nummer} gilt noch bis `
      + `${bis} (${String(tage)} ${tage === 1 ? 'Tag' : 'Tage'}). Eine neue beim Finanzamt `
      + 'beantragen und hier erfassen — dann endet dieser Hinweis.',
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
    feldTraeger: 'Wessen Bescheinigung',
    eigeneErklaerung: 'die eigene der Gesellschaft — ihr Finanzamt hat sie ausgestellt; sie '
      + 'steht auf den Ausgangsrechnungen, und Kunden behalten dann nicht ein.',
    lieferantErklaerung: 'die eines Lieferanten — er hat sie uns vorgelegt; auf seine Rechnungen '
      + 'wird dann nicht einbehalten.',
    feldLieferant: 'Lieferant',
    traegerHinweis: 'Den Lieferanten braucht nur seine Bescheinigung; bei der eigenen bleibt '
      + 'die Auswahl leer.',
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
      traeger_fehlt: 'Wessen Bescheinigung ist es — die eigene der Gesellschaft oder die eines '
        + 'Lieferanten (dann bitte ihn wählen)?',
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
      + 'consideration for construction work is withheld; with one, it is not — and it is '
      + 'always the certificate of the provider that counts (§ 48 (2) EStG). The company\'s OWN '
      + 'certificate is presented to its customers and appears on the outgoing invoice. A '
      + 'supplier\'s certificate exempts the company from withholding on that supplier\'s invoice.',
    voreinstellung: 'Default (O-604): accounting maintains the certificates with the finance '
      + 'write right. A certificate is recorded and never edited — finalized documents name its '
      + 'number and validity. One recorded in error is revoked and recorded again. Default '
      + '(O-130): the platform reminds accounting and management 60, 30 and 7 days before the '
      + 'company\'s own certificate expires, as long as no successor is on file.',
    leer: 'No Freistellungsbescheinigung is on file for this company.',
    keinSchreibrechtVor: 'Whoever holds',
    keinSchreibrechtNach: 'may record and revoke certificates.',
    spalteTraeger: 'For',
    spalteNummer: 'Number · Finanzamt',
    spalteZeitraum: 'Valid',
    spalteUmfang: 'Scope',
    spalteBeleg: 'Document',
    spalteStand: 'Status',
    eigene: 'This company',
    kunde: 'Customer',
    lieferant: 'Supplier',
    kundenHinweis: 'Customers\' certificates are kept on the customer\'s tax sheet. They have '
      + 'no effect on the company\'s invoices: there, the company\'s own certificate counts.',
    eigeneFehlt: 'The company\'s own certificate is not on file. If it performs construction '
      + 'work, its customers withhold 15 % without one; whether it holds one and until when is '
      + 'entered here by the operator (O-130).',
    keineEigeneGueltig: 'No own certificate of the company is valid today — customers withhold '
      + '15 % on construction work until a new one is on file.',
    ablaufHinweis: (nummer, bis, tage) => `The company's own certificate ${nummer} is valid `
      + `until ${bis} (${String(tage)} ${tage === 1 ? 'day' : 'days'}). Apply to the Finanzamt `
      + 'for a new one and record it here — then this notice ends.',
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
    feldTraeger: 'Whose certificate',
    eigeneErklaerung: 'the company\'s own — issued by its Finanzamt; it appears on outgoing '
      + 'invoices, and customers then do not withhold.',
    lieferantErklaerung: 'a supplier\'s — they presented it to us; their invoices are then not '
      + 'subject to withholding.',
    feldLieferant: 'Supplier',
    traegerHinweis: 'Only a supplier\'s certificate needs the supplier; for the company\'s own, '
      + 'leave it empty.',
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
      traeger_fehlt: 'Whose certificate is it — the company\'s own, or a supplier\'s (then '
        + 'please choose the supplier)?',
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
