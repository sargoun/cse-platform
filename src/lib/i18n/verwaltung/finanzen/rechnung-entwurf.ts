/**
 * Der Rechnungsentwurf nach dem Anlegen — Kopf, Zuordnung zu Auftrag und
 * Rechnungsart, Übernahme nach Abrechnungsart und Material (V-204, V-205,
 * V-206) in beiden Sprachen.
 *
 * Eine eigene Tabelle neben `rechnung-akte.ts` und `rechnungen.ts`, weil diese
 * Wörter auf BEIDEN Masken stehen — dem neuen Entwurf und dem Rechnungsblatt —
 * und die Abweisungen dieselben sind. Eine Abweisung reist als Schlüssel in
 * `?fehler=` und wird nur mit `eigenerEintrag()` nachgeschlagen (D-728).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`): `Abschlag`, `Schlussrechnung`, `Aufmaß`, `Abrechnungsart`,
 * `Vereinnahmung` tragen Rechtsbedeutung (UStG, VOB). Im Englischen steht der
 * deutsche Begriff mit kurzer Erklärung in Klammern.
 */
import type { InternSprache } from '../../intern.js';

export interface RechnungEntwurfTexte {
  /* ── Zuordnung (neuer Entwurf und Kopf) ──────────────────────────── */
  readonly auftrag: string;
  readonly ohneAuftrag: string;
  readonly auftragHinweis: string;
  /** Vor dem Namen des fehlenden Rechts (`<Recht>`). */
  readonly auftraegeVerdeckt: string;
  readonly rechnungsart: string;
  readonly rechnungsartHinweis: string;
  readonly vereinnahmung: string;
  readonly vereinnahmungHinweis: string;
  readonly leistungszeitraumPflicht: string;
  readonly fusstext: string;

  /* ── Der Kopf auf dem Rechnungsblatt ─────────────────────────────── */
  readonly kopfTitel: string;
  readonly kopfErklaerung: string;
  readonly kopfZahlungszielLeer: string;
  readonly kopfAbzugHinweis: string;
  readonly kopfSpeichern: string;
  readonly nichtGesetzt: string;

  /* ── Übernahme nach Abrechnungsart ───────────────────────────────── */
  readonly abrTitel: string;
  readonly abrErklaerung: string;
  readonly abrOhneAuftrag: string;
  readonly abrOhneZeitraum: string;
  readonly abrAbgewiesen: string;
  readonly abrZurAbrechnung: string;
  readonly abrArt: string;
  readonly abrProvisorisch: string;
  readonly abrGiltAb: string;
  readonly abrBefunde: string;
  readonly abrZeilen: string;
  readonly abrTabelle: string;
  readonly abrZeitraum: string;
  readonly abrKeineZeilen: string;
  readonly abrSchonUebernommen: string;
  /* V-207: was aus derselben Vereinbarung schon auf anderen Belegen steht. */
  readonly abrBisherTitel: string;
  readonly abrBisherEntwurf: string;
  readonly abrBisherHinweis: string;
  readonly abrLeistungszeile: string;
  readonly abrGanzerAuftrag: string;
  readonly abrVorschauFuerZeile: string;
  readonly abrAufmasse: string;
  readonly abrAufmasseHinweis: string;
  readonly abrKeineAufmasse: string;
  readonly abrFertigstellung: string;
  readonly abrFertigstellungHinweis: string;
  readonly abrUebernehmen: string;
  readonly aufmassStatus: Readonly<Record<string, string>>;

  /* ── Material ────────────────────────────────────────────────────── */
  readonly optionMaterial: string;
  readonly ausgabe: string;
  readonly einstandNetto: string;
  readonly materialHinweis: string;
  /** Vor dem Namen des fehlenden Rechts (`<Recht>`). */
  readonly ausgabenVerdeckt: string;

  /* ── Rückmeldungen ───────────────────────────────────────────────── */
  readonly nichtsGespeichert: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly hinweis: Readonly<Record<string, string>>;
}

export const RECHNUNG_ENTWURF_TEXTE: Readonly<Record<InternSprache, RechnungEntwurfTexte>> = {
  de: {
    auftrag: 'Auftrag (optional)',
    ohneAuftrag: '— ohne Auftrag —',
    auftragHinweis:
      'Nur Aufträge des gewählten Kunden. Erst mit dem Auftrag werden Abschläge, '
      + 'Stunden aus der Zeiterfassung, Vertragszeilen und die Abrechnungsart '
      + 'erreichbar — und die Prüfung auf fehlende Zeiterfassung (FIN-18).',
    auftraegeVerdeckt: 'Aufträge sind für Sie nicht sichtbar. Dafür fehlt das Recht',
    rechnungsart: 'Rechnungsart',
    rechnungsartHinweis:
      'Abschlag und Anzahlung gehen hinaus, bevor alles geleistet ist; eine '
      + 'Schlussrechnung zieht die Abschläge ihres Auftrags ab.',
    vereinnahmung: 'Vereinnahmung geplant am',
    vereinnahmungHinweis:
      'Nur bei Abschlag und Anzahlung: statt des Leistungszeitraums, solange er '
      + 'noch nicht feststeht (§14 Abs. 4 Nr. 6 UStG).',
    leistungszeitraumPflicht:
      'Pflicht bei Rechnung und Schlussrechnung. Bei Abschlag und Anzahlung der '
      + 'Zeitraum oder der Tag der Vereinnahmung.',
    fusstext: 'Fußtext',

    kopfTitel: 'Kopf des Entwurfs',
    kopfErklaerung:
      'Solange der Beleg ein Entwurf ist, lässt sich hier alles ändern — auch '
      + 'Auftrag und Rechnungsart. Die Nummer entsteht erst beim Festschreiben.',
    kopfZahlungszielLeer:
      'Leer: die Kondition des Kunden oder die Einstellung der Gesellschaft wird '
      + 'neu ermittelt. Es gibt keinen Vorgabewert (O-66).',
    kopfAbzugHinweis:
      'Wechseln Rechnungsart oder Auftrag einer Schlussrechnung, wirken die '
      + 'abgezogenen Abschläge nicht mehr; „Abschläge abziehen" stellt sie wieder her.',
    kopfSpeichern: 'Kopf speichern',
    nichtGesetzt: '—',

    abrTitel: 'Nach Abrechnungsart übernehmen',
    abrErklaerung:
      'Die Zeilen entstehen aus der Abrechnungsart, die am Auftrag hinterlegt ist, '
      + 'für den Leistungszeitraum dieses Entwurfs — mit Beleg unter jeder Zeile '
      + '(Zeiteintrag, Aufmaß, Abruf oder die Vereinbarung selbst).',
    abrOhneAuftrag:
      'Ohne Auftrag gibt es keine Abrechnungsart. Zuerst im Kopf einen Auftrag zuordnen.',
    abrOhneZeitraum:
      'Der Leistungszeitraum ist der Abrechnungszeitraum. Zuerst im Kopf „Leistung von" '
      + 'und „Leistung bis" setzen.',
    abrAbgewiesen: 'Die Abrechnung lässt sich so nicht rechnen:',
    abrZurAbrechnung: 'Abrechnung des Auftrags',
    abrArt: 'Abrechnungsart',
    abrProvisorisch: 'provisorisch (O-04)',
    abrGiltAb: 'Vereinbarung gilt ab',
    abrBefunde: 'Befunde der Abrechnungsregel',
    abrZeilen: 'Diese Zeilen entstehen',
    abrTabelle: 'Vorschau der Zeilen aus der Abrechnungsart',
    abrZeitraum: 'Zeitraum',
    abrKeineZeilen: 'Nach dieser Abrechnungsart entsteht im Zeitraum keine Zeile.',
    abrSchonUebernommen:
      'Aus dieser Vereinbarung stehen schon Zeilen auf dem Entwurf. Ein zweites Mal '
      + 'wird sie nicht übernommen.',
    abrBisherTitel: 'Aus dieser Vereinbarung schon berechnet',
    abrBisherEntwurf: 'Entwurf vom',
    abrBisherHinweis:
      'Derselbe Monat, dasselbe Los wird nicht ein zweites Mal berechnet. Frei wird ein '
      + 'Anspruch erst, wenn sein Beleg storniert oder verworfen ist. Eine Schlussrechnung '
      + 'sieht die festgeschriebenen Abschläge ihres Auftrags hier nicht — sie zieht sie ab.',
    abrLeistungszeile: 'Leistungszeile',
    abrGanzerAuftrag: '— ganzer Auftrag —',
    abrVorschauFuerZeile: 'Vorschau für diese Zeile',
    abrAufmasse: 'Aufmaßblätter',
    abrAufmasseHinweis:
      'Abgerechnet wird nur, was ausdrücklich gewählt ist — ein still '
      + 'übersprungenes Blatt wäre eine Rechnung mit fehlender Leistung.',
    abrKeineAufmasse: 'Zu diesem Auftrag gibt es kein Aufmaßblatt.',
    abrFertigstellung:
      'Fertigstellungsgrad in %, Gesamtstand (nur bei anteiliger Abrechnung)',
    abrFertigstellungHinweis:
      'Zum Beispiel „40" oder „62,5": der Stand der ganzen Leistung, nicht der Zuwachs '
      + 'seit der letzten Rechnung — bisher Berechnetes wird abgezogen (O-932). Leer bei '
      + 'Abrechnung nach Abnahme.',
    abrUebernehmen: 'Zeilen übernehmen',
    aufmassStatus: {
      entwurf: 'Entwurf',
      vorgelegt: 'vorgelegt',
      gegengezeichnet: 'gegengezeichnet',
      einseitig_festgestellt: 'einseitig festgestellt',
      abgelehnt: 'abgelehnt',
      storniert: 'storniert',
    },

    optionMaterial: 'Material — Ausgabe als Beleg',
    ausgabe: 'Ausgabe',
    einstandNetto: 'Einstand netto',
    materialHinweis:
      'Den Einzelpreis setzen Sie selbst: ob Material zum Einstand oder mit '
      + 'Aufschlag weiterberechnet wird, ist nicht entschieden (O-931). Eine '
      + 'Ausgabe steht auf höchstens einer Rechnungszeile.',
    ausgabenVerdeckt:
      'Weiterberechenbare Ausgaben sind für Sie nicht sichtbar. Dafür fehlt das Recht',

    nichtsGespeichert: 'Nichts wurde gespeichert.',
    abgewiesen: 'Der Vorgang wurde abgewiesen.',
    fehler: {
      ungueltig:
        'Eine Zahl oder ein Datum war nicht lesbar — Menge in Tausendsteln, Preise in '
        + 'Cent, Zahlungsziel in ganzen Tagen, Daten aus dem Kalenderfeld.',
      unvollstaendig: 'Es fehlte eine Pflichtangabe.',
      leistungszeitpunkt_fehlt:
        'Der Leistungszeitraum fehlt oder ist unvollständig. Bei Abschlag und '
        + 'Anzahlung genügt der Tag der Vereinnahmung (§14 Abs. 4 Nr. 6 UStG).',
      zeitraum_verkehrt: 'Der Leistungszeitraum endet vor seinem Beginn.',
      auftrag_passt_nicht:
        'Der Auftrag gehört zu einem anderen Kunden, ist storniert oder für Sie '
        + 'nicht sichtbar.',
      rechnungsart_unbekannt: 'Diese Rechnungsart kann ein Entwurf nicht tragen.',
      zuordnung_gebunden:
        'Der Auftrag lässt sich nicht mehr wechseln: an Zeilen dieses Entwurfs hängen '
        + 'Belege aus dem bisherigen Auftrag. Den Entwurf verwerfen und neu anlegen.',
      kein_entwurf: 'Dieser Beleg ist kein Entwurf mehr und ändert sich nicht (Invariante 4).',
      nicht_gefunden: 'Diesen Beleg gibt es nicht.',
      unbekannte_steuergruppe:
        'Eine Steuergruppe gilt am Leistungsdatum nicht. Der Satz einer Zeile wird '
        + 'nicht still umgeschrieben.',
      mehrdeutige_steuergruppe:
        'Eine Steuergruppe steht auf diesem Beleg mit zwei datierten Sätzen.',
      unbekannte_einheit: 'Diese Mengeneinheit ist nicht angelegt.',
      basismenge_ungueltig: 'Die Preisbasismenge muss positiv sein.',
      quelle_passt_nicht:
        'Der Beleg passt nicht zu dieser Rechnung: anderer Auftrag oder Kunde, nicht '
        + 'weiterberechenbar oder nicht freigegeben.',
      quelle_fehlt: 'Der Beleg fehlt oder ist für Sie nicht sichtbar.',
      ohne_quelle:
        'Eine von Hand erfasste Zeile braucht eine Begründung (mindestens drei Zeichen).',
      schon_abgerechnet: 'Dieser Beleg ist schon auf einer Rechnungszeile abgerechnet.',
      anteil_fehlt: 'Ein Aufmaß wird anteilig abgerechnet — die Menge fehlt.',
      keine_abrechnungsart:
        'Für den Auftrag ist im Leistungszeitraum keine Abrechnungsart hinterlegt — oder '
        + 'mehrere auf einzelnen Leistungszeilen; dann je Leistungszeile übernehmen.',
      parameter_offen: 'Die Abrechnungsvereinbarung hat offene Parameter (O-04).',
      unbekannte_abrechnungsart: 'Zu dieser Abrechnungsart gibt es keine Umsetzung.',
      befund_blockiert:
        'Die Abrechnungsregel meldet einen blockierenden Befund; er steht in der Vorschau.',
      nichts_abzurechnen:
        'Im Leistungszeitraum gibt es nach dieser Abrechnungsart nichts abzurechnen.',
      schon_uebernommen:
        'Diese Vereinbarung — beim Aufmaß: dieses Blatt — steht schon auf dem Entwurf.',
      aufmass_nicht_abrechenbar: 'Ein gewähltes Aufmaßblatt ist nicht abrechenbar.',
      kein_preis: 'Der Abrechnung fehlt ein vereinbarter Preis.',
      keine_menge: 'Der Abrechnung fehlt eine Menge oder ein lesbarer Zeitraum.',
      ausserhalb_lv: 'Eine Aufmaßzeile liegt außerhalb des Leistungsverzeichnisses.',
      fertigstellung_ungueltig:
        'Der Fertigstellungsgrad ist keine Prozentangabe zwischen 0 und 100.',
      kennung_ungueltig: 'Eine Auswahl war nicht lesbar.',
    },
    hinweis: {
      kopf_gespeichert: 'Der Kopf ist gespeichert.',
      abzug_zurueckgenommen:
        'Der Kopf ist gespeichert. Die abgezogenen Abschläge gehörten zur bisherigen '
        + 'Zuordnung und wirken nicht mehr.',
      uebernommen: 'Die Zeilen sind übernommen — mit Beleg unter jeder Zeile.',
    },
  },

  en: {
    auftrag: 'Order (Auftrag, optional)',
    ohneAuftrag: '— no order —',
    auftragHinweis:
      'Only orders of the selected customer. Only with an order do the Abschläge '
      + '(interim invoices), hours from time recording, contract lines and the '
      + 'billing type (Abrechnungsart) become reachable — and the check for missing '
      + 'time recording (FIN-18).',
    auftraegeVerdeckt: 'Orders are not visible to you. The missing permission is',
    rechnungsart: 'Invoice type (Rechnungsart)',
    rechnungsartHinweis:
      'Abschlag and Anzahlung go out before everything is delivered; a '
      + 'Schlussrechnung (final invoice) deducts the Abschläge of its order.',
    vereinnahmung: 'Planned receipt of payment (Vereinnahmung)',
    vereinnahmungHinweis:
      'Abschlag and Anzahlung only: instead of the supply period while it is not '
      + 'yet known (§14(4) no. 6 UStG).',
    leistungszeitraumPflicht:
      'Required for an invoice and a Schlussrechnung. For Abschlag and Anzahlung '
      + 'the period or the day of receipt (Vereinnahmung).',
    fusstext: 'Footer text',

    kopfTitel: 'Draft header',
    kopfErklaerung:
      'While the document is a draft, everything here can be changed — including '
      + 'order and invoice type. The number is only assigned at Festschreibung '
      + '(finalisation).',
    kopfZahlungszielLeer:
      'Blank: the customer terms or the company setting are determined again. '
      + 'There is no default value (O-66).',
    kopfAbzugHinweis:
      'If the invoice type or the order of a Schlussrechnung changes, the deducted '
      + 'Abschläge no longer apply; “Deduct Abschläge” restores them.',
    kopfSpeichern: 'Save header',
    nichtGesetzt: '—',

    abrTitel: 'Take over by billing type (Abrechnungsart)',
    abrErklaerung:
      'The lines are created from the billing type stored on the order, for the '
      + 'supply period of this draft — with evidence under every line (time entry, '
      + 'Aufmaß, call-off or the agreement itself).',
    abrOhneAuftrag:
      'Without an order there is no billing type. Assign an order in the header first.',
    abrOhneZeitraum:
      'The supply period is the billing period. Set “Supply period from” and “to” in '
      + 'the header first.',
    abrAbgewiesen: 'The billing cannot be calculated like this (message in German):',
    abrZurAbrechnung: 'Billing of the order',
    abrArt: 'Billing type (Abrechnungsart)',
    abrProvisorisch: 'provisional (O-04)',
    abrGiltAb: 'Agreement valid from',
    abrBefunde: 'Findings of the billing rule (in German)',
    abrZeilen: 'These lines will be created',
    abrTabelle: 'Preview of the lines from the billing type',
    abrZeitraum: 'Period',
    abrKeineZeilen: 'This billing type creates no line in the period.',
    abrSchonUebernommen:
      'Lines from this agreement are already on the draft. It is not taken over a '
      + 'second time.',
    abrBisherTitel: 'Already billed from this agreement',
    abrBisherEntwurf: 'Draft of',
    abrBisherHinweis:
      'The same month, the same lot is not billed a second time. A claim becomes free '
      + 'again only when its document is cancelled (Storno) or discarded. A '
      + 'Schlussrechnung does not see the finalised Abschläge of its order here — it '
      + 'deducts them.',
    abrLeistungszeile: 'Contract line',
    abrGanzerAuftrag: '— whole order —',
    abrVorschauFuerZeile: 'Preview for this line',
    abrAufmasse: 'Aufmaß sheets (measurement)',
    abrAufmasseHinweis:
      'Only what is explicitly selected is billed — a silently skipped sheet would '
      + 'be an invoice with missing work.',
    abrKeineAufmasse: 'There is no Aufmaß sheet for this order.',
    abrFertigstellung: 'Degree of completion in %, overall (partial billing only)',
    abrFertigstellungHinweis:
      'For example “40” or “62,5” (German decimal comma): the state of the whole work, '
      + 'not the increase since the last invoice — what was billed before is deducted '
      + '(O-932). Blank when billing on acceptance.',
    abrUebernehmen: 'Take over lines',
    aufmassStatus: {
      entwurf: 'draft',
      vorgelegt: 'submitted',
      gegengezeichnet: 'countersigned',
      einseitig_festgestellt: 'determined unilaterally',
      abgelehnt: 'rejected',
      storniert: 'cancelled',
    },

    optionMaterial: 'Material — expense (Ausgabe) as evidence',
    ausgabe: 'Expense (Ausgabe)',
    einstandNetto: 'cost net',
    materialHinweis:
      'You set the unit price yourself: whether material is passed on at cost or '
      + 'with a mark-up has not been decided (O-931). An expense appears on at most '
      + 'one invoice line.',
    ausgabenVerdeckt:
      'Expenses that can be passed on are not visible to you. The missing permission is',

    nichtsGespeichert: 'Nothing was saved.',
    abgewiesen: 'The request was rejected.',
    fehler: {
      ungueltig:
        'A number or a date could not be read — quantity in thousandths, prices in '
        + 'cents, payment term in whole days, dates from the calendar field.',
      unvollstaendig: 'A required entry was missing.',
      leistungszeitpunkt_fehlt:
        'The supply period is missing or incomplete. For Abschlag and Anzahlung the '
        + 'day of receipt (Vereinnahmung) is enough (§14(4) no. 6 UStG).',
      zeitraum_verkehrt: 'The supply period ends before it begins.',
      auftrag_passt_nicht:
        'The order belongs to another customer, is cancelled or is not visible to you.',
      rechnungsart_unbekannt: 'A draft cannot carry this invoice type.',
      zuordnung_gebunden:
        'The order can no longer be changed: lines of this draft carry evidence from '
        + 'the previous order. Discard the draft and create a new one.',
      kein_entwurf:
        'This document is no longer a draft and does not change (invariant 4).',
      nicht_gefunden: 'This document does not exist.',
      unbekannte_steuergruppe:
        'A tax group is not valid on the date of supply. The rate of a line is not '
        + 'rewritten silently.',
      mehrdeutige_steuergruppe:
        'A tax group appears on this document with two dated rates.',
      unbekannte_einheit: 'This unit of measure has not been set up.',
      basismenge_ungueltig: 'The price base quantity must be positive.',
      quelle_passt_nicht:
        'The evidence does not fit this invoice: another order or customer, not '
        + 'marked for passing on, or not approved.',
      quelle_fehlt: 'The evidence is missing or not visible to you.',
      ohne_quelle:
        'A line entered by hand needs a justification (at least three characters).',
      schon_abgerechnet: 'This evidence is already billed on an invoice line.',
      anteil_fehlt: 'An Aufmaß is billed proportionally — the quantity is missing.',
      keine_abrechnungsart:
        'No billing type is stored for the order in the supply period — or several on '
        + 'individual contract lines; then take over per contract line.',
      parameter_offen: 'The billing agreement has open parameters (O-04).',
      unbekannte_abrechnungsart: 'There is no implementation of this billing type.',
      befund_blockiert:
        'The billing rule reports a blocking finding; it is shown in the preview.',
      nichts_abzurechnen: 'This billing type has nothing to bill in the supply period.',
      schon_uebernommen:
        'This agreement — for an Aufmaß: this sheet — is already on the draft.',
      aufmass_nicht_abrechenbar: 'A selected Aufmaß sheet cannot be billed.',
      kein_preis: 'The billing lacks an agreed price.',
      keine_menge: 'The billing lacks a quantity or a readable period.',
      ausserhalb_lv: 'An Aufmaß line lies outside the bill of quantities.',
      fertigstellung_ungueltig: 'The degree of completion is not a percentage from 0 to 100.',
      kennung_ungueltig: 'A selection could not be read.',
    },
    hinweis: {
      kopf_gespeichert: 'The header has been saved.',
      abzug_zurueckgenommen:
        'The header has been saved. The deducted Abschläge belonged to the previous '
        + 'assignment and no longer apply.',
      uebernommen: 'The lines have been taken over — with evidence under every line.',
    },
  },
};
