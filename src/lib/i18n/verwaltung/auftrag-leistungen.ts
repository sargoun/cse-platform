/**
 * Die Leistungszeilen eines Auftrags (V-360, O-921, D-825) — in beiden
 * Sprachen.
 *
 * Die Zeilen sind der Anker für Turnus, Schicht, Zeiteintrag, Aufmass und
 * Rechnungszeile. Aus einem Angebot kommen sie bei der Annahme; danach legt
 * man nachträglich vereinbarte Leistungen an und beendet, was nicht mehr
 * geschuldet ist. Eine Preisanpassung ist eine neue, datierte Zeile.
 */
import type { InternSprache } from '../intern.js';

export interface AuftragLeistungenTexte {
  readonly titel: string;
  readonly einleitung: string;
  readonly zumAuftrag: string;
  readonly keineZeilen: string;
  readonly spalten: {
    readonly position: string;
    readonly bezeichnung: string;
    readonly menge: string;
    readonly einzelpreis: string;
    readonly gesamt: string;
    readonly steuer: string;
    readonly gueltig: string;
    readonly herkunft: string;
  };
  readonly ausAngebot: string;
  readonly vonHand: string;
  /** `{ab}` wird eingesetzt. */
  readonly ab: string;
  /** `{ab}` und `{bis}` werden eingesetzt. */
  readonly abBis: string;
  readonly beendet: string;
  readonly beendenTitel: string;
  readonly beendenZum: string;
  readonly beendenKnopf: string;
  readonly neuTitel: string;
  readonly neuHinweis: string;
  readonly bezeichnung: string;
  readonly beschreibung: string;
  readonly menge: string;
  readonly einheit: string;
  readonly einheitWaehlen: string;
  readonly einzelpreis: string;
  readonly einzelpreisHinweis: string;
  readonly steuersatz: string;
  readonly steuersatzWaehlen: string;
  readonly gueltigAb: string;
  readonly anlegenKnopf: string;
  readonly ohneSchreibrecht: string;
  readonly erfolg: Readonly<Record<string, string>>;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
}

export const AUFTRAG_LEISTUNGEN_TEXTE: Readonly<Record<InternSprache, AuftragLeistungenTexte>> = {
  de: {
    titel: 'Leistungszeilen',
    einleitung:
      'Was dieser Auftrag schuldet, Position für Position. Turnus, Schichten, Zeiten, Aufmass '
      + 'und Rechnung hängen an diesen Zeilen. Aus einem Angebot kommen sie bei der Annahme; '
      + 'eine nachträglich vereinbarte Leistung wird hier angelegt, eine nicht mehr geschuldete '
      + 'beendet — gelöscht wird keine.',
    zumAuftrag: 'Zum Auftrag',
    keineZeilen:
      'Dieser Auftrag hat noch keine Leistungszeile. Ohne sie hängt keine Schicht und keine Zeit '
      + 'an einer vereinbarten Position, und keine Abrechnungsart findet einen Preis.',
    spalten: {
      position: 'Pos.',
      bezeichnung: 'Leistung',
      menge: 'Menge',
      einzelpreis: 'Einzelpreis',
      gesamt: 'Gesamt',
      steuer: 'Steuer',
      gueltig: 'Gültig',
      herkunft: 'Herkunft',
    },
    ausAngebot: 'aus dem Angebot',
    vonHand: 'nachträglich vereinbart',
    ab: 'ab {ab}',
    abBis: '{ab} bis {bis}',
    beendet: 'beendet',
    beendenTitel: 'Zeile beenden',
    beendenZum: 'Letzter Tag',
    beendenKnopf: 'Beenden',
    neuTitel: 'Leistung anlegen',
    neuHinweis:
      'Eine Preisanpassung ist eine neue Zeile ab dem Stichtag (Voreinstellung O-921): die '
      + 'bisherige zum Vortag beenden, die neue mit dem neuen Preis anlegen. Turnus und künftige '
      + 'Schichten hängt die Planung danach an die neue Zeile. Der Auftragswert ändert sich '
      + 'dabei nicht.',
    bezeichnung: 'Bezeichnung',
    beschreibung: 'Beschreibung',
    menge: 'Menge',
    einheit: 'Einheit',
    einheitWaehlen: 'Einheit wählen',
    einzelpreis: 'Einzelpreis (netto, €)',
    einzelpreisHinweis: 'Punkt trennt die Tausender, Komma die Cent — „1.250,00".',
    steuersatz: 'Steuersatz',
    steuersatzWaehlen: 'Steuersatz wählen',
    gueltigAb: 'Gültig ab',
    anlegenKnopf: 'Leistung anlegen',
    ohneSchreibrecht: 'Leistungszeilen anlegen und beenden darf, wer Aufträge schreiben darf.',
    erfolg: {
      angelegt: 'Die Leistung ist angelegt.',
      beendet: 'Die Zeile ist beendet. Sie bleibt mit ihren Zeiten und Rechnungen stehen.',
    },
    fehler: {
      unbekannter_auftrag: 'Diesen Auftrag gibt es nicht — oder diese Sitzung darf ihn nicht ändern.',
      auftrag_beendet:
        'Ein abgeschlossener oder stornierter Auftrag vereinbart keine Leistungen mehr.',
      ohne_bezeichnung: 'Eine Leistung braucht eine Bezeichnung.',
      zu_lang: 'Eine Angabe ist zu lang.',
      keine_menge:
        'Das ist keine Menge — höchstens drei Nachkommastellen, kein Tausenderpunkt, nicht null.',
      kein_betrag:
        'Das ist kein Betrag in deutscher Schreibweise, oder er ist negativ — „1.250,00".',
      keine_einheit: 'Diese Einheit gibt es nicht.',
      kein_steuersatz: 'Dieser Steuersatz gilt am Stichtag nicht.',
      kein_datum: 'Das ist kein Kalendertag.',
      vor_auftragsbeginn: 'Eine Leistung beginnt nicht vor dem Auftrag.',
      nach_laufzeit: 'Eine Leistung beginnt nicht nach dem Ende der Laufzeit des Auftrags.',
      unbekannte_zeile: 'Diese Zeile gibt es an diesem Auftrag nicht.',
      schon_beendet: 'Diese Zeile endet schon an diesem Tag oder früher.',
      ende_vor_beginn: 'Eine Zeile endet nicht vor ihrem ersten Tag.',
      zeit_danach:
        'Nach diesem Tag stehen schon Zeiten an dieser Zeile. Sie endet frühestens am Tag der '
        + 'letzten erfassten Zeit.',
      schichten_danach:
        'Nach diesem Tag sind noch Schichten an dieser Zeile geplant. Erst die Schichten an eine '
        + 'andere Zeile hängen oder absagen, dann beenden.',
      unbekannter_vorgang: 'Dieser Vorgang ist unbekannt.',
    },
    fehlerSonst: 'Der Vorgang wurde abgewiesen.',
  },
  en: {
    titel: 'Service lines',
    einleitung:
      'What this order owes, line by line. Rota, shifts, times, measurements and invoices hang on '
      + 'these lines. From an offer they come when it is accepted; a service agreed later is '
      + 'added here, one no longer owed is ended — none is deleted.',
    zumAuftrag: 'To the order',
    keineZeilen:
      'This order has no service line yet. Without one no shift and no time hangs on an agreed '
      + 'line, and no billing type finds a price.',
    spalten: {
      position: 'No.',
      bezeichnung: 'Service',
      menge: 'Quantity',
      einzelpreis: 'Unit price',
      gesamt: 'Total',
      steuer: 'Tax',
      gueltig: 'Valid',
      herkunft: 'Source',
    },
    ausAngebot: 'from the offer',
    vonHand: 'agreed later',
    ab: 'from {ab}',
    abBis: '{ab} to {bis}',
    beendet: 'ended',
    beendenTitel: 'End line',
    beendenZum: 'Last day',
    beendenKnopf: 'End',
    neuTitel: 'Add service',
    neuHinweis:
      'A price change is a new line from its effective date (default O-921): end the current line '
      + 'on the day before, add the new one with the new price. Planning then moves the rota and '
      + 'future shifts to the new line. The order value does not change.',
    bezeichnung: 'Name',
    beschreibung: 'Description',
    menge: 'Quantity',
    einheit: 'Unit',
    einheitWaehlen: 'Choose a unit',
    einzelpreis: 'Unit price (net, €)',
    einzelpreisHinweis: 'German notation: dot for thousands, comma for cents — “1.250,00”.',
    steuersatz: 'Tax rate',
    steuersatzWaehlen: 'Choose a tax rate',
    gueltigAb: 'Valid from',
    anlegenKnopf: 'Add service',
    ohneSchreibrecht: 'Adding and ending service lines requires the right to write orders.',
    erfolg: {
      angelegt: 'The service has been added.',
      beendet: 'The line has been ended. It stays with its times and invoices.',
    },
    fehler: {
      unbekannter_auftrag: 'This order does not exist — or this session may not change it.',
      auftrag_beendet: 'A completed or cancelled order agrees no further services.',
      ohne_bezeichnung: 'A service needs a name.',
      zu_lang: 'An entry is too long.',
      keine_menge:
        'That is not a quantity — at most three decimal places, no thousands separator, not zero.',
      kein_betrag: 'That is not an amount in German notation, or it is negative — “1.250,00”.',
      keine_einheit: 'This unit does not exist.',
      kein_steuersatz: 'This tax rate does not apply on the effective date.',
      kein_datum: 'That is not a calendar day.',
      vor_auftragsbeginn: 'A service does not start before the order.',
      nach_laufzeit: 'A service does not start after the end of the order term.',
      unbekannte_zeile: 'This line does not exist on this order.',
      schon_beendet: 'This line already ends on this day or earlier.',
      ende_vor_beginn: 'A line does not end before its first day.',
      zeit_danach:
        'Times are already recorded on this line after this day. It ends at the earliest on the day '
        + 'of the last recorded time.',
      schichten_danach:
        'Shifts are still planned on this line after this day. Move them to another line or cancel '
        + 'them first, then end it.',
      unbekannter_vorgang: 'This action is unknown.',
    },
    fehlerSonst: 'The request was refused.',
  },
};
