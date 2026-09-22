/**
 * Die Wörter des Modellregisters — in beiden Sprachen (V-120, D-04).
 *
 * **Die drei Flaggen heissen hier, was sie bedeuten, und nicht, wie die
 * Spalte heisst.** `zero_retention` ist für den Betreiber kein Begriff; „Der
 * Anbieter behält die Texte nicht" ist einer. Der Spaltenname steht daneben
 * für den, der später in der Datenbank nachsieht.
 */
import type { InternSprache } from '../../intern.js';

export interface ModelleTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;

  readonly anbieter: string;
  readonly anbieterBeispiel: string;
  readonly modell: string;
  readonly modellBeispiel: string;
  readonly faehigkeit: string;
  readonly faehigkeitErklaerung: string;

  readonly flaggen: string;
  readonly euVerarbeitung: string;
  readonly euVerarbeitungErklaerung: string;
  readonly zeroRetention: string;
  readonly zeroRetentionErklaerung: string;
  readonly freigegeben: string;
  readonly freigegebenErklaerung: string;

  readonly nachweis: string;
  readonly nachweisErklaerung: string;
  readonly nachweisBeispiel: string;
  readonly bemerkung: string;
  readonly bemerkungBeispiel: string;

  readonly aufrufbar: string;
  readonly nichtAufrufbar: string;
  readonly geprueftVon: string;
  readonly geprueftAm: string;
  readonly freigeben: string;
  readonly sperren: string;
  readonly anlegen: string;
  readonly keine: string;
  readonly keineErklaerung: string;
  readonly keinSchreibrecht: string;
  readonly freiwillig: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const MODELLE_TEXTE: Readonly<Record<InternSprache, ModelleTexte>> = {
  de: {
    modul: 'Sprachmodelle',
    titel: 'Sprachmodelle',
    untertitel:
      'Welches Modell aufgerufen werden darf — und wer das bezeugt hat.',
    warum:
      'Der Schlüssel in der Umgebung öffnet die technische Tür. Diese Liste '
      + 'ist die zweite Frage: hat ein Mensch hingesehen und bestätigt, dass '
      + 'das Modell rechtlich benutzt werden darf? Ein Modell wird nur '
      + 'aufgerufen, wenn alle drei Bestätigungen stehen — eine davon ist '
      + 'nicht genug.',

    anbieter: 'Anbieter',
    anbieterBeispiel: 'z. B. openai',
    modell: 'Modellkennung',
    modellBeispiel: 'z. B. gpt-4o-mini',
    faehigkeit: 'Wofür',
    faehigkeitErklaerung:
      'Eine Zeile je Fähigkeit. Dasselbe Modell kann für Textentwürfe '
      + 'freigegeben sein und für die Belegerkennung nicht.',

    flaggen: 'Die drei Bestätigungen',
    euVerarbeitung: 'Die Verarbeitung findet in der EU statt',
    euVerarbeitungErklaerung:
      'Beim Anbieter eingestellt UND vertraglich zugesichert. Das Häkchen '
      + 'hier bestätigt beides — es stellt nichts ein.',
    zeroRetention: 'Der Anbieter behält die Texte nicht',
    zeroRetentionErklaerung:
      'Zero Retention: gesendeter Text wird nicht gespeichert und nicht zum '
      + 'Training verwendet. Steht in Ihrem Vertrag, nicht in dieser Software.',
    freigegeben: 'Ich gebe dieses Modell frei',
    freigegebenErklaerung:
      'Ihre Entscheidung. Mit dem Speichern stehen Ihr Name und der Zeitpunkt '
      + 'in der Zeile — deshalb gibt es hier kein Feld dafür.',

    nachweis: 'Nachweis (Link auf den Vertrag)',
    nachweisErklaerung:
      'Bei einer Freigabe erforderlich: der Auftragsverarbeitungsvertrag, auf '
      + 'den sie sich stützt. Er ist das, was eine Aufsichtsbehörde liest. '
      + 'Ersatzweise genügt eine Bemerkung, die sagt, worauf sie sich stützt.',
    nachweisBeispiel: 'https://…/dpa.pdf',
    bemerkung: 'Bemerkung',
    bemerkungBeispiel: 'z. B. DPA vom 22.09.2026, EU-Residenz bestätigt',

    aufrufbar: 'aufrufbar',
    nichtAufrufbar: 'nicht aufrufbar',
    geprueftVon: 'Bezeugt von',
    geprueftAm: 'am',
    freigeben: 'Freigeben',
    sperren: 'Freigabe zurücknehmen',
    anlegen: 'Modell eintragen',
    keine: 'Noch kein Modell eingetragen.',
    keineErklaerung:
      'Ohne eingetragenes und freigegebenes Modell bleibt jede KI-Funktion '
      + 'abgeschaltet — auch mit gültigem Schlüssel in der Umgebung. Das ist '
      + 'gewollt: der Schlüssel öffnet die Tür, diese Zeile ist die '
      + 'Bescheinigung.',
    keinSchreibrecht: 'Das Eintragen verlangt',
    freiwillig: '(freiwillig)',
    fehler: {
      anbieter_ungueltig:
        'Der Anbieter besteht aus Kleinbuchstaben, Ziffern, Strich und '
        + 'Unterstrich — zum Beispiel openai.',
      modell_fehlt: 'Ohne Modellkennung keine Zeile.',
      faehigkeit_unbekannt: 'Unbekannte Fähigkeit.',
      freigabe_unvollstaendig:
        'Eine Freigabe ohne EU-Verarbeitung und ohne Nullspeicherung bleibt '
        + 'wirkungslos — das Modell wäre trotzdem nicht aufrufbar. Bestätigen '
        + 'Sie beide, oder nehmen Sie die Freigabe heraus.',
      ohne_nachweis:
        'Zu einer Freigabe gehört der Nachweis: ein Link auf den Vertrag, '
        + 'oder wenigstens eine Bemerkung, worauf sie sich stützt.',
      nachweis_ungueltig: 'Der Nachweis ist eine https-Adresse — oder leer.',
      schon_vorhanden:
        'Dieses Modell ist für diese Fähigkeit schon eingetragen. Ändern Sie '
        + 'die vorhandene Zeile, statt eine zweite daneben zu stellen.',
      nicht_gefunden:
        'Diese Zeile gibt es nicht — oder die Freigabe bliebe wirkungslos, '
        + 'weil EU-Verarbeitung oder Nullspeicherung nicht bestätigt sind.',
      keine_kennung: 'Ohne Kennung keine Handlung.',
      kein_schreibrecht: 'Dafür fehlt das Recht.',
    },
  },

  en: {
    modul: 'Language models',
    titel: 'Language models',
    untertitel: 'Which model may be called — and who attested to it.',
    warum:
      'The key in the environment opens the technical door. This list is the '
      + 'second question: has a human looked and confirmed that the model may '
      + 'lawfully be used? A model is called only when all three '
      + 'confirmations stand — one of them is not enough.',

    anbieter: 'Provider',
    anbieterBeispiel: 'e.g. openai',
    modell: 'Model identifier',
    modellBeispiel: 'e.g. gpt-4o-mini',
    faehigkeit: 'Used for',
    faehigkeitErklaerung:
      'One row per capability. The same model may be approved for drafting '
      + 'text and not for reading receipts.',

    flaggen: 'The three confirmations',
    euVerarbeitung: 'Processing takes place in the EU',
    euVerarbeitungErklaerung:
      'Set at the provider AND assured contractually. The checkbox confirms '
      + 'both — it does not configure anything.',
    zeroRetention: 'The provider does not keep the texts',
    zeroRetentionErklaerung:
      'Zero retention: text sent is not stored and not used for training. '
      + 'That is in your contract, not in this software.',
    freigegeben: 'I approve this model',
    freigegebenErklaerung:
      'Your decision. On saving, your name and the moment are written into '
      + 'the row — which is why there is no field for them here.',

    nachweis: 'Evidence (link to the contract)',
    nachweisErklaerung:
      'Required for an approval: the data-processing agreement it rests on. '
      + 'It is what a supervisory authority reads. A note saying what it '
      + 'rests on will do instead.',
    nachweisBeispiel: 'https://…/dpa.pdf',
    bemerkung: 'Note',
    bemerkungBeispiel: 'e.g. DPA of 22.09.2026, EU residency confirmed',

    aufrufbar: 'callable',
    nichtAufrufbar: 'not callable',
    geprueftVon: 'Attested by',
    geprueftAm: 'on',
    freigeben: 'Approve',
    sperren: 'Withdraw approval',
    anlegen: 'Record model',
    keine: 'No model recorded yet.',
    keineErklaerung:
      'Without a recorded and approved model every AI function stays off — '
      + 'even with a valid key in the environment. That is deliberate: the '
      + 'key opens the door, this row is the attestation.',
    keinSchreibrecht: 'Recording one requires',
    freiwillig: '(optional)',
    fehler: {
      anbieter_ungueltig:
        'The provider consists of lower-case letters, digits, hyphen and '
        + 'underscore — for example openai.',
      modell_fehlt: 'No row without a model identifier.',
      faehigkeit_unbekannt: 'Unknown capability.',
      freigabe_unvollstaendig:
        'An approval without EU processing and without zero retention stays '
        + 'ineffective — the model would still not be callable. Confirm both, '
        + 'or remove the approval.',
      ohne_nachweis:
        'An approval needs evidence: a link to the contract, or at least a '
        + 'note saying what it rests on.',
      nachweis_ungueltig: 'The evidence is an https address — or empty.',
      schon_vorhanden:
        'This model is already recorded for this capability. Change the '
        + 'existing row rather than placing a second beside it.',
      nicht_gefunden:
        'No such row — or the approval would stay ineffective because EU '
        + 'processing or zero retention is not confirmed.',
      keine_kennung: 'No action without a reference.',
      kein_schreibrecht: 'That requires the right.',
    },
  },
};
