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
