/**
 * Reviere anlegen, ändern, archivieren — in beiden Sprachen (D-82, D-592).
 *
 * **`Revier` bleibt `Revier`, auch im englischen Text.** Es ist nicht
 * „district" und nicht „zone": es ist die Fläche, die eine Reinigungskraft in
 * EINEM Durchgang abarbeitet, und genau diese Einheit steht in der
 * Dienstanweisung, auf dem Leistungsnachweis und im Dienstplan. Im englischen
 * Text steht deshalb `Revier (the area one cleaner covers in one round)` — ein
 * erfundenes englisches Wort liesse den Begriff auf Papier und Bildschirm
 * auseinanderfallen.
 *
 * **Dasselbe gilt für `Objekt`, `Turnus`, `Einsatz` und
 * `Leistungsnachweis`** — siehe `./objekte.ts`, wo die Regel ausführlich
 * begründet ist.
 *
 * **Die Sollzeit heisst im Englischen „target minutes", nicht „duration".**
 * Sie ist ein GERECHNETER Zielwert (Σ m² ÷ Leistungswert) und als einzige
 * Dauer dieser Plattform gebrochen (K-16(c)); jede gemessene Dauer bleibt
 * ganzzahlig, weil sie Beweismittel ist. Die beiden gleich zu benennen wäre
 * genau die Verwechslung, die K-16 verhindern soll.
 */
import type { InternSprache } from '../intern.js';
import type { RevierGrund } from '../../../server/services/reinigung/revier.js';
import type {
  SonderleistungErfolg, SonderleistungGrund,
} from '../../../server/services/reinigung/sonderleistung.js';

export interface RevierTexte {
  /* ── Überschriften und Wege ────────────────────────────────────────── */
  /** Der Name des Moduls in der Spur — dasselbe Wort wie in der Leiste. */
  readonly modul: string;
  readonly neuTitel: string;
  readonly bearbeitenTitel: string;
  readonly alleReviere: string;
  readonly neuesRevier: string;
  readonly ersteAnlegen: string;

  /* ── Gliederung des Formulars ──────────────────────────────────────── */
  readonly wo: string;
  readonly was: string;
  readonly wann: string;
  readonly archivieren: string;

  /* ── Felder ────────────────────────────────────────────────────────── */
  readonly objekt: string;
  readonly objektWaehlen: string;
  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly kurzzeichen: string;
  readonly kurzzeichenBeispiel: string;
  readonly beschreibung: string;
  readonly beschreibungBeispiel: string;
  readonly sollzeit: string;
  readonly sollzeitBeispiel: string;
  readonly aktivAb: string;
  readonly aktivBis: string;
  readonly aktivBisOffen: string;
  readonly freiwillig: string;

  /* ── Sätze, die eine Entscheidung begründen ────────────────────────── */
  readonly objektBleibt: string;
  readonly objektPflicht: string;
  readonly sollzeitErklaerung: string;
  readonly sollzeitWirdGerechnet: string;
  readonly aktivAbErklaerung: string;
  readonly keinObjekt: string;
  readonly naechsterSchritt: string;
  readonly archivierenErklaerung: string;
  readonly archivierenKnopf: string;

  /* ── Knöpfe und Abweisungen ────────────────────────────────────────── */
  readonly revierAnlegen: string;
  readonly aenderungenSpeichern: string;
  readonly keinSchreibrechtAnlegen: string;
  readonly keinSchreibrechtAendern: string;
}

export const REVIER_TEXTE: Readonly<Record<InternSprache, RevierTexte>> = {
  de: {
    modul: 'Reinigung',
    neuTitel: 'Neues Revier',
    bearbeitenTitel: 'Revier bearbeiten',
    alleReviere: 'Alle Reviere',
    neuesRevier: 'Neues Revier',
    ersteAnlegen: 'Das erste zuschneiden.',

    wo: 'Wo',
    was: 'Was',
    wann: 'Ab wann',
    archivieren: 'Archivieren',

    objekt: 'Objekt',
    objektWaehlen: 'Objekt wählen',
    bezeichnung: 'Bezeichnung',
    bezeichnungBeispiel: 'z. B. Erdgeschoss Nord, Treppenhaus A–C',
    kurzzeichen: 'Kurzzeichen',
    kurzzeichenBeispiel: 'z. B. EG-N',
    beschreibung: 'Beschreibung',
    beschreibungBeispiel:
      'z. B. Flure, Teeküche, WC Damen und Herren — ohne Serverraum',
    sollzeit: 'Sollzeit je Durchgang (Minuten)',
    sollzeitBeispiel: 'z. B. 90',
    aktivAb: 'Aktiv ab',
    aktivBis: 'Aktiv bis',
    aktivBisOffen: 'leer = offen',
    freiwillig: '(freiwillig)',

    objektBleibt:
      'Das Objekt lässt sich später nicht wechseln. An einem Revier hängen '
      + 'Räume genau dieses Gebäudes, dazu Turnusse, Einsätze und '
      + 'Leistungsnachweise; ein Wechsel machte daraus eine Fläche an einer '
      + 'Adresse, an der sie nicht liegt. Wer die Fläche verlegt, archiviert '
      + 'und schneidet neu zu.',
    objektPflicht:
      'Ein Revier ist eine Fläche IN einem Gebäude. Ohne Objekt gäbe es keinen '
      + 'Ort, an den der Dienstplan jemanden schickt.',
    sollzeitErklaerung:
      'Die Sollzeit ist die Minutenzahl, aus der Einsatzdauer und Besetzung '
      + 'entstehen. Sie muss grösser als null sein — ein Revier mit 0 wäre eine '
      + 'Fläche, für die niemand eingeteilt wird, und das fiele erst auf, wenn '
      + 'sie schmutzig bleibt.',
    sollzeitWirdGerechnet:
      'Sobald dem Revier Räume zugeordnet sind, rechnet die Plattform diese '
      + 'Zahl selbst aus Fläche und Leistungswert (Σ m² ÷ Leistungswert) und '
      + 'überschreibt den hier eingetragenen Wert. Bis dahin gilt, was hier '
      + 'steht.',
    aktivAbErklaerung:
      'Gemeint ist der Berliner Geschäftstag, nicht der Zeitpunkt. Leer '
      + 'gelassen beginnt das Revier heute.',
    keinObjekt:
      'Für diese Gesellschaft ist noch kein Objekt erfasst. Ein Revier ist '
      + 'eine Fläche in einem Gebäude — erst das Gebäude, dann die Fläche.',
    naechsterSchritt:
      'Nach dem Anlegen geht es weiter zum Raumbuch des Reviers: dort werden '
      + 'die Räume zugeordnet, und daraus rechnet die Plattform die Sollzeit.',
    archivierenErklaerung:
      'Das Revier verschwindet aus allen Listen und lässt sich nicht mehr '
      + 'einteilen. Gelöscht wird nichts — an einem Revier hängen Turnusse, '
      + 'Einsätze und Leistungsnachweise, und ein Löschen machte aus jedem davon '
      + 'eine Zeile ohne Fläche.',
    archivierenKnopf: 'Revier archivieren',

    revierAnlegen: 'Revier anlegen',
    aenderungenSpeichern: 'Änderungen speichern',
    keinSchreibrechtAnlegen: 'Zum Anlegen fehlt Ihnen',
    keinSchreibrechtAendern: 'Zum Ändern fehlt Ihnen',
  },
  en: {
    modul: 'Cleaning',
    neuTitel: 'New Revier',
    bearbeitenTitel: 'Edit Revier',
    alleReviere: 'All Reviere',
    neuesRevier: 'New Revier',
    ersteAnlegen: 'Lay out the first one.',

    wo: 'Where',
    was: 'What',
    wann: 'From when',
    archivieren: 'Archive',

    objekt: 'Objekt (the site)',
    objektWaehlen: 'Choose an Objekt',
    bezeichnung: 'Name',
    bezeichnungBeispiel: 'e.g. Ground floor north, stairwells A–C',
    kurzzeichen: 'Short code',
    kurzzeichenBeispiel: 'e.g. EG-N',
    beschreibung: 'Description',
    beschreibungBeispiel:
      'e.g. corridors, kitchenette, both WCs — server room excluded',
    sollzeit: 'Target minutes per round',
    sollzeitBeispiel: 'e.g. 90',
    aktivAb: 'Active from',
    aktivBis: 'Active until',
    aktivBisOffen: 'empty = open-ended',
    freiwillig: '(optional)',

    objektBleibt:
      'The Objekt cannot be changed later. A Revier holds rooms of that one '
      + 'building, plus Turnusse (recurring schedules), Einsätze (planned '
      + 'shifts) and Leistungsnachweise (countersigned records of work '
      + 'performed); moving it would leave an area at an address it is not in. '
      + 'To move the area, archive this Revier and lay out a new one.',
    objektPflicht:
      'A Revier is an area INSIDE a building. Without an Objekt there is no '
      + 'place for the roster to send anyone to.',
    sollzeitErklaerung:
      'The target minutes are what shift length and staffing are derived from. '
      + 'The value must be greater than zero — a Revier with 0 is an area '
      + 'nobody is ever scheduled for, and that only shows once it stays dirty.',
    sollzeitWirdGerechnet:
      'As soon as rooms are assigned to this Revier, the platform computes '
      + 'this number itself from area and performance rate (Σ m² ÷ rate) and '
      + 'overwrites what you enter here. Until then, this value stands.',
    aktivAbErklaerung:
      'This is the Berlin business day, not a point in time. Left empty, the '
      + 'Revier starts today.',
    keinObjekt:
      'No Objekt has been recorded for this Gesellschaft (legal entity) yet. A '
      + 'Revier is an area inside a building — the building comes first.',
    naechsterSchritt:
      'After creating it you continue to the Revier’s room list: that is where '
      + 'rooms are assigned, and the target minutes are computed from them.',
    archivierenErklaerung:
      'The Revier disappears from every list and can no longer be scheduled. '
      + 'Nothing is deleted — Turnusse, Einsätze and Leistungsnachweise hang '
      + 'off a Revier, and deleting it would turn each of them into a row with '
      + 'no area.',
    archivierenKnopf: 'Archive Revier',

    revierAnlegen: 'Create Revier',
    aenderungenSpeichern: 'Save changes',
    keinSchreibrechtAnlegen: 'Creating one requires',
    keinSchreibrechtAendern: 'Editing requires',
  },
};

/**
 * Warum ein Revier nicht gespeichert wurde — als SATZ, nachgeschlagen nach
 * dem GRUND, den `POST /api/reinigung/reviere` als `?fehler=` zurückschickt
 * (V-275, D-773, D-769).
 *
 * Bis dahin reiste der deutsche Satz des Dienstes als `?meldung=` mit und
 * stand roh über dem Formular — deutsch auch in einer englischen Sitzung, und
 * jeder präparierte Link schrieb seine eigene Warnung. Die Seite schlägt nur
 * als eigenen Eintrag nach (D-728); ein Grund, den die Tabelle nicht kennt,
 * bekommt `sonst`. Kein Satz nennt ein Recht als Schlüssel (D-741).
 */
export interface RevierFehlerTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<RevierGrund, string>>;
}

export const REVIER_FEHLER_TEXTE: Readonly<Record<InternSprache, RevierFehlerTexte>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Das Revier wurde nicht gespeichert. Prüfen Sie die Angaben und versuchen Sie es '
      + 'noch einmal.',
    fehler: {
      id_fehlt: 'Welches Revier gemeint ist, fehlt — öffnen Sie es aus der Liste heraus.',
      objekt_fehlt: 'Ein Revier gehört zu einem Objekt — bitte eines auswählen.',
      bezeichnung_fehlt: 'Ein Revier braucht eine Bezeichnung.',
      sollzeit_ungueltig:
        'Die Sollzeit ist eine Zahl grösser als null — sie ist die Minutenzahl, aus der die '
        + 'Einsatzdauer und damit die Besetzung entsteht.',
      nicht_angelegt:
        'Das Revier wurde nicht angelegt. Gibt es das gewählte Objekt in dieser Gesellschaft '
        + 'noch, und darf Ihr Konto hier die Reinigung bearbeiten?',
      revier_unbekannt:
        'Dieses Revier gibt es in dieser Gesellschaft nicht mehr, oder es ist archiviert — '
        + 'die Liste zeigt den aktuellen Stand.',
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'The Revier was not saved. Check the details and try again.',
    fehler: {
      id_fehlt: 'Which Revier is meant is missing — open it from the list.',
      objekt_fehlt: 'A Revier belongs to an Objekt (site) — please choose one.',
      bezeichnung_fehlt: 'A Revier needs a name.',
      sollzeit_ungueltig:
        'The target minutes are a number greater than zero — they are what shift length and '
        + 'staffing are derived from.',
      nicht_angelegt:
        'The Revier was not created. Does the chosen Objekt still exist in this Gesellschaft '
        + '(legal entity), and may your account edit cleaning here?',
      revier_unbekannt:
        'This Revier no longer exists in this Gesellschaft, or it has been archived — the '
        + 'list shows the current state.',
    },
  },
};

/**
 * Was nach einem Schreibversuch auf `/reinigung/sonderleistungen` oben steht —
 * nachgeschlagen nach dem SCHLÜSSEL aus `?erfolg=` bzw. dem GRUND aus
 * `?fehler=` (V-275, D-773, D-769).
 *
 * Bis dahin schickte `POST /api/reinigung/sonderleistungen` die Sätze selbst
 * in `?ok=` und `?fehler=`, und die Seite zeigte sie roh. **Nur deutsch, in
 * derselben Form wie die zweisprachigen Tabellen:** die Seite steht noch auf
 * der Ausnahmeliste der Übersetzungswache; stellt jemand sie um, kommt hier
 * nur `en` dazu.
 *
 * **Ohne die Werte, die der Satz der Route einsetzte:** „jetzt" und „vorher"
 * beim Zustandswechsel — der neue Zustand steht in der Liste darunter, und
 * er ist die Eingabe des Formulars, die nie zurück in die Adresse reist
 * (D-769 Nr. 5). Ein unbekannter Erfolgsschlüssel zeigt keinen Kasten, ein
 * unbekannter Grund bekommt `sonst`. Kein Satz nennt ein Recht als
 * Schlüssel (D-741).
 */
export interface SonderleistungTexte {
  /** Die ersten Worte des Erfolgskastens. */
  readonly gespeichert: string;
  readonly erfolg: Readonly<Record<SonderleistungErfolg, string>>;
  /** Die ersten Worte des Warnkastens. */
  readonly titel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<SonderleistungGrund, string>>;
}

export const SONDERLEISTUNG_TEXTE: Readonly<Record<'de', SonderleistungTexte>> = {
  de: {
    gespeichert: 'Gespeichert.',
    erfolg: {
      abruf_erfasst: 'Der Abruf ist erfasst.',
      status_gesetzt: 'Der Zustand des Abrufs ist geändert — die Liste unten zeigt ihn.',
      abruf_storniert: 'Der Abruf ist storniert — mit Grund und Urheber, und nicht gelöscht.',
      zeitwert_gesetzt: 'Der Zeitwert der Katalogzeile ist gesetzt.',
    },
    titel: 'Nicht gespeichert.',
    sonst: 'Es wurde nichts gespeichert. Prüfen Sie die Angaben und versuchen Sie es noch '
      + 'einmal.',
    fehler: {
      position_fehlt: 'Die Katalogposition fehlt.',
      zustand_unvollstaendig: 'Abruf und Zustand sind Pflicht.',
      storno_unvollstaendig: 'Abruf und Stornogrund sind Pflicht.',
      abruf_unvollstaendig:
        'Objekt, Katalogposition, Bezeichnung und „Beauftragt am" sind Pflicht.',
      objekt_unbekannt:
        'Das Objekt gehört nicht zu dieser Gesellschaft, oder Ihrem Konto fehlt das Recht, '
        + 'Objekte zu lesen — ohne das Objekt ist kein Kunde bekannt.',
      objekt_ohne_kunde:
        'An diesem Objekt hängt kein Kunde. Ein Abruf ohne Kunde lässt sich nicht abrechnen — '
        + 'bitte zuerst den Kunden am Objekt hinterlegen.',
      bezeichnung_fehlt: 'Ein Abruf braucht eine Bezeichnung.',
      beauftragt_am_ungueltig: '„Beauftragt am" ist ein Kalendertag.',
      ausfuehrung_ungueltig: '„Ausführung von" und „Ausführung bis" sind Kalendertage.',
      ausfuehrung_fenster: 'Das Ausführungsende liegt vor dem Beginn.',
      menge_ohne_einheit:
        'Menge und Einheit gehören zusammen — eine Menge ohne Einheit ist keine Menge.',
      menge_ungueltig: 'Die Menge ist eine Zahl mit höchstens drei Dezimalstellen.',
      nicht_angelegt:
        'Der Abruf wurde nicht angelegt — Objekt, Kunde, Revier oder Katalogposition gehört '
        + 'nicht zu dieser Gesellschaft, oder Ihr Konto darf hier nicht schreiben.',
      stornogrund_fehlt: 'Ein Storno braucht einen Grund.',
      zeitwert_ungueltig:
        'Der Zeitwert ist eine Zahl in Minuten mit höchstens drei Dezimalstellen.',
      zeitwert_nicht_positiv: 'Der Zeitwert ist grösser als null.',
      status_unveraendert: 'Der Abruf steht schon in diesem Zustand.',
      abgerechnet_unveraenderlich:
        'Ein abgerechneter Abruf ist unveränderlich — er steht in einer festgeschriebenen '
        + 'Rechnung. Korrigiert wird die Rechnung (Storno), nicht der Abruf.',
      storniert_endgueltig:
        'Ein stornierter Abruf wird nicht wiederbelebt. Für eine erneute Beauftragung '
        + 'entsteht ein neuer Abruf.',
      abgerechnet_nur_rechnung:
        'Den Stempel „Abgerechnet" setzt die Rechnungsübernahme und nur sie. Von Hand gesetzt '
        + 'behauptete er eine Rechnung, die es nicht gibt.',
      storno_ueber_status:
        'Ein Storno braucht einen Grund und einen Urheber — es läuft über „Abruf stornieren", '
        + 'nicht über den Status.',
      status_beim_erfassen: 'Dieser Zustand lässt sich beim Erfassen nicht setzen.',
      bereits_storniert: 'Dieser Abruf ist bereits storniert.',
      abgerechnet_kein_storno:
        'Ein abgerechneter Abruf lässt sich nicht stornieren — er steht in einer '
        + 'festgeschriebenen Rechnung. Korrigiert wird durch Storno der Rechnung.',
      abruf_unbekannt:
        'Diesen Abruf gibt es in dieser Gesellschaft nicht mehr — die Liste zeigt den '
        + 'aktuellen Stand.',
      katalogzeile_unbekannt:
        'Diese Katalogzeile gibt es in dieser Gesellschaft nicht — die Liste zeigt den '
        + 'aktuellen Stand.',
    },
  },
};
