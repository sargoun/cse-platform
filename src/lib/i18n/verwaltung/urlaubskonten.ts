/**
 * Die Wörter der Urlaubskonten — in beiden Sprachen (V-117, V-118, D-592).
 *
 * **„0 Tage" und „nicht hinterlegt" sind zwei verschiedene Aussagen**, und im
 * Portal ist das der ganze Punkt: das erste ist eine Auskunft, das zweite eine
 * offene Frage. Stünde auf dem Bildschirm „Resturlaub: 0 Tage", wo niemand den
 * Anspruch eingetragen hat, wäre das schlicht falsch — und der Mensch, der es
 * liest, plant sein Jahr danach.
 */
import type { InternSprache } from '../intern.js';

export interface UrlaubskontenTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly jahr: string;
  readonly person: string;
  readonly anspruch: string;
  readonly anspruchOffen: string;
  readonly uebertrag: string;
  readonly verfaelltAm: string;
  readonly zusatz: string;
  readonly genommen: string;
  readonly verplant: string;
  readonly rest: string;
  readonly abgeschlossen: string;

  readonly eintragenTitel: string;
  readonly eintragenErklaerung: string;
  readonly anspruchErklaerung: string;
  readonly uebertragErklaerung: string;
  readonly zusatzErklaerung: string;
  readonly speichern: string;

  readonly keine: string;
  readonly keineErklaerung: string;
  readonly keinSchreibrecht: string;
  readonly freiwillig: string;
  readonly gespeichert: string;
  readonly fehler: Readonly<Record<string, string>>;
}

export const URLAUBSKONTEN_TEXTE:
Readonly<Record<InternSprache, UrlaubskontenTexte>> = {
  de: {
    modul: 'Urlaubskonten',
    titel: 'Urlaubskonten',
    untertitel:
      'Der Anspruch je Anstellung und Jahr — die Zahl, gegen die jeder '
      + 'Urlaubsantrag gerechnet wird.',
    jahr: 'Jahr',
    person: 'Person',
    anspruch: 'Anspruch',
    anspruchOffen: 'nicht hinterlegt',
    uebertrag: 'Übertrag aus dem Vorjahr',
    verfaelltAm: 'Übertrag verfällt am',
    zusatz: 'Zusatztage',
    genommen: 'Genommen',
    verplant: 'Verplant',
    rest: 'Rest',
    abgeschlossen: 'abgeschlossen',

    eintragenTitel: 'Anspruch eintragen',
    eintragenErklaerung:
      'Die Plattform leitet den Anspruch NICHT her. Die zwanzig Werktage des '
      + '§ 3 BUrlG sind das gesetzliche Mindestmass und fast nie die '
      + 'vereinbarte Zahl; sie steht im Arbeitsvertrag. Eine hergeleitete Zahl '
      + 'sähe aus wie eine vereinbarte und würde zur Grundlage eines '
      + 'Restanspruchs, den niemand zugesagt hat (O-18).',
    anspruchErklaerung:
      'Tage im Jahr, aus dem Arbeitsvertrag. Halbe Tage mit Komma: 25,5.',
    uebertragErklaerung:
      'Was aus dem Vorjahr übrig blieb. Ob und wie lange Resturlaub übergeht, '
      + 'ist Vertrags- und Tarifrecht — § 7 Abs. 3 BUrlG kennt den 31. März als '
      + 'Regelfall und viele Ausnahmen. Leer heisst „kein Übertrag erfasst".',
    zusatzErklaerung:
      'Tage, die nicht aus dem Jahresanspruch kommen — Schwerbehinderung '
      + '(§ 208 SGB IX), Schichtzulage, Jubiläum. Sie zählen mit, bleiben aber '
      + 'getrennt sichtbar.',
    speichern: 'Anspruch speichern',

    keine: 'Noch kein Urlaubskonto in diesem Jahr.',
    keineErklaerung:
      'Der Nachtlauf öffnet je aktiver Anstellung ein Konto. Solange keines da '
      + 'ist, rechnet jeder Urlaubsantrag gegen nichts.',
    keinSchreibrecht: 'Das Eintragen verlangt',
    freiwillig: '(freiwillig)',
    gespeichert: 'Der Anspruch ist gespeichert.',
    fehler: {
      menge_unlesbar:
        'Die Tage sind nicht lesbar. Erwartet wird eine Zahl mit höchstens drei '
        + 'Nachkommastellen — halbe Tage als 25,5.',
      jahr_abgeschlossen:
        'Dieses Urlaubsjahr ist abgeschlossen. Korrigiert wird im Folgejahr — '
        + 'ein abgeschlossenes Jahr nachträglich zu ändern hiesse, einen '
        + 'Restanspruch zu verschieben, der schon abgerechnet ist.',
      kein_konto: 'Für diese Anstellung gibt es in diesem Jahr kein Konto.',
      keine_anstellung: 'Bitte wählen Sie eine Anstellung.',
      kein_jahr: 'Bitte geben Sie ein Jahr an.',
      kein_anspruch: 'Bitte geben Sie die Urlaubstage an.',
      kein_datum: 'Das Verfallsdatum ist nicht lesbar.',
    },
  },

  en: {
    modul: 'Holiday accounts',
    titel: 'Holiday accounts',
    untertitel:
      'The entitlement per Anstellung and year — the figure every holiday '
      + 'request is measured against.',
    jahr: 'Year',
    person: 'Person',
    anspruch: 'Entitlement',
    anspruchOffen: 'not recorded',
    uebertrag: 'Carry-over from last year',
    verfaelltAm: 'Carry-over expires on',
    zusatz: 'Additional days',
    genommen: 'Taken',
    verplant: 'Planned',
    rest: 'Remaining',
    abgeschlossen: 'closed',

    eintragenTitel: 'Record the entitlement',
    eintragenErklaerung:
      'The platform does NOT derive the entitlement. The twenty working days '
      + 'of § 3 BUrlG are the statutory minimum and almost never the agreed '
      + 'figure; that one is in the employment contract. A derived figure would '
      + 'look like an agreed one and would become the basis of a remaining '
      + 'entitlement nobody promised (O-18).',
    anspruchErklaerung:
      'Days per year, from the employment contract. Half days with a comma: 25,5.',
    uebertragErklaerung:
      'What was left from last year. Whether and for how long remaining leave '
      + 'carries over is contract and collective-agreement law — § 7(3) BUrlG '
      + 'names 31 March as the rule and many exceptions. Empty means “no '
      + 'carry-over recorded”.',
    zusatzErklaerung:
      'Days that do not come from the annual entitlement — severe disability '
      + '(§ 208 SGB IX), shift allowance, anniversary. They count, but stay '
      + 'visible separately.',
    speichern: 'Save entitlement',

    keine: 'No holiday account in this year yet.',
    keineErklaerung:
      'The nightly run opens one account per active Anstellung. Until there is '
      + 'one, every holiday request is measured against nothing.',
    keinSchreibrecht: 'Recording it requires',
    freiwillig: '(optional)',
    gespeichert: 'The entitlement has been saved.',
    fehler: {
      menge_unlesbar:
        'The days are unreadable. Expected is a number with at most three '
        + 'decimals — half days as 25,5.',
      jahr_abgeschlossen:
        'This holiday year is closed. Corrections are made in the following '
        + 'year — changing a closed year afterwards would move a remaining '
        + 'entitlement that has already been settled.',
      kein_konto: 'There is no account for this Anstellung in this year.',
      keine_anstellung: 'Please choose an Anstellung.',
      kein_jahr: 'Please give a year.',
      kein_anspruch: 'Please give the holiday days.',
      kein_datum: 'The expiry date is unreadable.',
    },
  },
};
