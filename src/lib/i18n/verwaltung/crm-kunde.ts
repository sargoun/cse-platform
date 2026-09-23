/**
 * Die Rückmeldungen auf dem Kundenblatt — in beiden Sprachen (V-148, D-642,
 * D-562, D-599).
 *
 * **Der Befund.** `POST /api/crm/kunde` leitete eine Abweisung mit
 * `?meldung=` auf das Kundenblatt zurück — und das Blatt nahm gar keine
 * Suchparameter an. Wer „Bestandskunde" oder „Einwilligung" wählte und nicht
 * sagte, woher sie stammt oder für welchen Kanal, bekam keinen Kontakt und
 * keinen Satz: das Formular war zu, die Eingaben weg, und es sah aus wie
 * gespeichert.
 *
 * Der Schlüssel (`?grund=`) wird übersetzt; der deutsche Satz der Route
 * (`?meldung=`) bleibt der Rückfall für einen Schlüssel, den diese Tabelle
 * nicht kennt — nie der Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';

export interface KundeRueckmeldungTexte {
  readonly nichtGespeichert: string;
  readonly kontaktFehler: Readonly<Record<string, string>>;
}

export const KUNDE_RUECKMELDUNG: Readonly<Record<InternSprache, KundeRueckmeldungTexte>> = {
  de: {
    nichtGespeichert: 'Der Ansprechpartner wurde nicht angelegt.',
    kontaktFehler: {
      name_fehlt: 'Ein Kontakt braucht mindestens einen Nachnamen.',
      grundlage_ohne_quelle:
        'Zu einer Rechtsgrundlage gehört, woher sie stammt (§ 7 UWG, LEG-08). Tragen Sie unter '
        + '„Woher stammt sie?" ein, wo und wann sie erteilt wurde — oder wählen Sie „Keine".',
      einwilligung_ohne_kanal:
        'Eine Einwilligung gilt für bestimmte Wege. Ohne Kanal ist sie eine Einwilligung in '
        + 'nichts — kreuzen Sie an, worein eingewilligt wurde.',
      nicht_angelegt: 'Der Kontakt wurde nicht angelegt — diesen Kunden gibt es hier nicht.',
    },
  },
  en: {
    nichtGespeichert: 'The contact was not created.',
    kontaktFehler: {
      name_fehlt: 'A contact needs at least a last name.',
      grundlage_ohne_quelle:
        'A legal basis needs its source (§ 7 UWG, LEG-08). Enter where and when it was given '
        + 'under "Where does it come from?" — or choose "None".',
      einwilligung_ohne_kanal:
        'Consent applies to specific channels. Without a channel it is consent to nothing — '
        + 'tick what was consented to.',
      nicht_angelegt: 'The contact was not created — this customer does not exist here.',
    },
  },
};
