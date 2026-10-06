/**
 * Veranstaltungen anlegen, ändern, archivieren — in beiden Sprachen
 * (D-82, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** Hier sind es
 * vier:
 *
 *  - **`Objekt`** ist der Ort, an dem bewacht wird — siehe `./objekte.ts`.
 *  - **`Einsatz`** ist die geplante Schicht; „assignment" trifft es nicht,
 *    weil derselbe Einsatz mehrere Menschen trägt.
 *  - **`Dienstanweisung`** ist die verbindliche Weisung für den Dienst nach
 *    § 34a GewO; „briefing" wäre eine Besprechung.
 *  - **`Anstellung`** ist die Beschäftigung bei EINER Gesellschaft (D-09) —
 *    ein Mensch kann zwei haben, und die Wachleitung gehört zu einer davon.
 *
 * **Beginn und Ende sind Berliner Wanduhrzeiten** (Invariante 2). Der
 * englische Text sagt das ebenso, weil eine in London getippte Uhrzeit sonst
 * eine Stunde daneben läge.
 */
import type { InternSprache } from '../intern.js';
import type { VeranstaltungGrund } from '../../../server/services/security/veranstaltung-anlegen.js';
import type {
  BewacherErfolg, BewacherGrund,
} from '../../../server/services/security/bewacherregister.js';

export interface VeranstaltungTexte {
  /* ── Überschriften und Wege ────────────────────────────────────────── */
  readonly modul: string;
  readonly neuTitel: string;
  readonly bearbeitenTitel: string;
  readonly alleVeranstaltungen: string;
  readonly neueVeranstaltung: string;
  readonly ersteAnlegen: string;

  /* ── Gliederung des Formulars ──────────────────────────────────────── */
  readonly fuerWen: string;
  readonly wo: string;
  readonly wann: string;
  readonly wieViele: string;

  /* ── Felder ────────────────────────────────────────────────────────── */
  readonly kunde: string;
  readonly kundeWaehlen: string;
  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly anlass: string;
  readonly anlassBeispiel: string;
  readonly objekt: string;
  readonly ohneObjekt: string;
  readonly ortText: string;
  readonly ortTextBeispiel: string;
  readonly beginn: string;
  readonly ende: string;
  readonly besucher: string;
  readonly sollBesetzung: string;
  readonly leitung: string;
  readonly ohneLeitung: string;
  readonly leistung: string;
  readonly ohneLeistung: string;
  readonly freiwillig: string;

  /* ── Sätze, die eine Entscheidung begründen ────────────────────────── */
  readonly ortErklaerung: string;
  readonly zeitErklaerung: string;
  readonly besetzungErklaerung: string;
  readonly leistungErklaerung: string;
  readonly besetzenIstSpaeter: string;
  readonly keinKunde: string;

  /* ── Knöpfe und Abweisungen ────────────────────────────────────────── */
  readonly veranstaltungAnlegen: string;
  readonly aenderungenSpeichern: string;
  readonly keinSchreibrechtAnlegen: string;
}

export const VERANSTALTUNG_TEXTE: Readonly<Record<InternSprache, VeranstaltungTexte>> = {
  de: {
    modul: 'Sicherheit',
    neuTitel: 'Neue Veranstaltung',
    bearbeitenTitel: 'Veranstaltung bearbeiten',
    alleVeranstaltungen: 'Alle Veranstaltungen',
    neueVeranstaltung: 'Neue Veranstaltung',
    ersteAnlegen: 'Die erste erfassen.',

    fuerWen: 'Für wen',
    wo: 'Wo',
    wann: 'Wann',
    wieViele: 'Wie viele',

    kunde: 'Kunde',
    kundeWaehlen: 'Kunde wählen',
    bezeichnung: 'Bezeichnung',
    bezeichnungBeispiel: 'z. B. Sommerfest Werkhalle 3',
    anlass: 'Anlass',
    anlassBeispiel: 'z. B. Firmenjubiläum, Messe, Konzert',
    objekt: 'Objekt dieser Gesellschaft',
    ohneObjekt: 'kein Objekt — Anschrift unten eintragen',
    ortText: 'Anschrift als Text',
    ortTextBeispiel: 'z. B. Festplatz Rummelsburger Bucht, Zugang Ost',
    beginn: 'Beginn (Berliner Zeit)',
    ende: 'Ende (Berliner Zeit)',
    besucher: 'Erwartete Besucher',
    sollBesetzung: 'Sollbesetzung (Personen)',
    leitung: 'Wachleitung',
    ohneLeitung: 'noch offen',
    leistung: 'Auftragsposition',
    ohneLeistung: 'keine — handerfasst',
    freiwillig: '(freiwillig)',

    ortErklaerung:
      'Entweder ein Objekt dieser Gesellschaft oder eine Anschrift als Text — '
      + 'eines von beidem ist Pflicht. Ein Straßenfest, ein Messestand, ein '
      + 'gemieteter Saal ist kein Objekt im Bestand und braucht trotzdem eine '
      + 'Wache, die weiss, wohin sie fährt.',
    zeitErklaerung:
      'Beide Angaben sind Berliner Wanduhrzeit. Eine Veranstaltung über '
      + 'Mitternacht endet am Folgetag — dann gehört der nächste Tag ins Feld, '
      + 'nicht eine Uhrzeit vor dem Beginn.',
    besetzungErklaerung:
      'Die vereinbarte Stärke. Ob sie zugleich die Mindeststärke ist — ob also '
      + 'ein unterbesetzter Dienst als nicht erbracht gilt —, ist noch zu '
      + 'entscheiden (O-210). Die Plattform zeigt deshalb Zahlen und keine Ampel.',
    leistungErklaerung:
      'Freiwillig. Voreinstellung (O-703): die Wachleitung erfasst den '
      + 'Veranstaltungsauftrag von Hand und verbindet ihn mit der Auftragsposition, '
      + 'sobald der Vertrieb sie angelegt hat — beides geht: mit Position verbinden '
      + 'oder ohne erfassen.',
    besetzenIstSpaeter:
      'Das Anlegen teilt noch niemanden ein. Die Besetzung steht auf dem Blatt '
      + 'der Veranstaltung und verlangt ein eigenes Recht — wer den Auftrag '
      + 'erfasst, besetzt ihn nicht zwangsläufig.',
    keinKunde:
      'Für diese Gesellschaft ist kein Kunde erfasst. Eine Veranstaltung wird '
      + 'für jemanden bewacht — erst der Kunde, dann der Termin.',

    veranstaltungAnlegen: 'Veranstaltung anlegen',
    aenderungenSpeichern: 'Änderungen speichern',
    keinSchreibrechtAnlegen: 'Zum Anlegen fehlt Ihnen',
  },
  en: {
    modul: 'Security',
    neuTitel: 'New event',
    bearbeitenTitel: 'Edit event',
    alleVeranstaltungen: 'All events',
    neueVeranstaltung: 'New event',
    ersteAnlegen: 'Record the first one.',

    fuerWen: 'For whom',
    wo: 'Where',
    wann: 'When',
    wieViele: 'How many',

    kunde: 'Kunde (customer)',
    kundeWaehlen: 'Choose a Kunde',
    bezeichnung: 'Name',
    bezeichnungBeispiel: 'e.g. Summer party, hall 3',
    anlass: 'Occasion',
    anlassBeispiel: 'e.g. company anniversary, trade fair, concert',
    objekt: 'Objekt of this Gesellschaft',
    ohneObjekt: 'no Objekt — enter an address below',
    ortText: 'Address as free text',
    ortTextBeispiel: 'e.g. Festplatz Rummelsburger Bucht, east entrance',
    beginn: 'Start (Berlin time)',
    ende: 'End (Berlin time)',
    besucher: 'Expected visitors',
    sollBesetzung: 'Required headcount',
    leitung: 'Guard supervisor',
    ohneLeitung: 'not yet assigned',
    leistung: 'Order position',
    ohneLeistung: 'none — recorded by hand',
    freiwillig: '(optional)',

    ortErklaerung:
      'Either an Objekt (site) of this Gesellschaft or an address as free text — '
      + 'one of the two is required. A street festival, a trade-fair stand, a '
      + 'rented hall is no Objekt on file and still needs a guard who knows where '
      + 'to go.',
    zeitErklaerung:
      'Both are Berlin wall-clock times. An event running past midnight ends on '
      + 'the following day — then the next date belongs in the field, not a time '
      + 'earlier than the start.',
    besetzungErklaerung:
      'The agreed strength. Whether it is also the MINIMUM — whether an '
      + 'understaffed shift counts as not performed — is still to be decided '
      + '(O-210). The platform therefore shows numbers, not a traffic light.',
    leistungErklaerung:
      'Optional. Default (O-703): the guard management records the event order by '
      + 'hand and links it to the order position once sales has created it — both '
      + 'work: linked to a position, or recorded without one.',
    besetzenIstSpaeter:
      'Creating it does not schedule anyone yet. Staffing lives on the event’s own '
      + 'page and requires a separate right — whoever records the order does not '
      + 'necessarily staff it.',
    keinKunde:
      'No Kunde is on file for this Gesellschaft (legal entity). An event is '
      + 'guarded for someone — the customer comes first, then the date.',

    veranstaltungAnlegen: 'Create event',
    aenderungenSpeichern: 'Save changes',
    keinSchreibrechtAnlegen: 'Creating one requires',
  },
};

/**
 * Warum eine Veranstaltung nicht gespeichert wurde — als SATZ, nachgeschlagen
 * nach dem GRUND, den `POST /api/security/veranstaltungen` als `?fehler=`
 * zurückschickt (V-275, D-773, D-769).
 *
 * Bis dahin reiste der deutsche Satz des Dienstes als `?meldung=` mit und
 * stand roh über dem Formular — deutsch auch in einer englischen Sitzung, und
 * jeder präparierte Link schrieb seine eigene Warnung. Die Seite schlägt nur
 * als eigenen Eintrag nach (D-728); ein Grund, den die Tabelle nicht kennt,
 * bekommt `sonst`, nie den Schlüssel und nie Text aus der Adresse.
 *
 * **Ohne die Werte, die der Dienst einsetzt:** welches der beiden Zeitfelder
 * die Form verfehlt, wie viele Schichten noch offen sind — die Seite sagt
 * den Satz ohne sie (D-769 Nr. 5).
 */
export interface VeranstaltungFehlerTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<VeranstaltungGrund, string>>;
}

export const VERANSTALTUNG_FEHLER_TEXTE:
Readonly<Record<InternSprache, VeranstaltungFehlerTexte>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Die Veranstaltung wurde nicht gespeichert. Prüfen Sie die Angaben und versuchen '
      + 'Sie es noch einmal.',
    fehler: {
      id_fehlt:
        'Welche Veranstaltung gemeint ist, fehlt — öffnen Sie sie aus der Liste heraus.',
      bezeichnung_fehlt: 'Eine Veranstaltung braucht eine Bezeichnung.',
      kunde_fehlt:
        'Eine Veranstaltung wird für einen Kunden bewacht — bitte den Kunden wählen.',
      ort_fehlt:
        'Eine Veranstaltung braucht einen Ort: entweder ein Objekt dieser Gesellschaft oder '
        + 'eine Anschrift als Text. Ohne beides weiss die Wache nicht, wohin sie fährt.',
      zeitpunkt_ungueltig:
        'Beginn und Ende brauchen je ein Datum und eine Uhrzeit, beides Berliner Zeit.',
      fenster_ungueltig:
        'Das Ende liegt vor dem Beginn oder auf ihm. Eine Veranstaltung über Mitternacht '
        + 'endet am Folgetag — dann gehört der nächste Tag ins Feld.',
      zahl_ungueltig:
        'Die Sollbesetzung ist eine ganze Zahl von 1 bis 999, die erwartete Besucherzahl '
        + 'eine ganze Zahl ab 0.',
      nicht_angelegt:
        'Die Veranstaltung wurde nicht angelegt. Prüfen Sie, ob Ihr Konto in dieser '
        + 'Gesellschaft die Security bearbeiten darf.',
      veranstaltung_unbekannt:
        'Diese Veranstaltung gibt es in dieser Gesellschaft nicht mehr, oder sie ist '
        + 'archiviert — die Liste zeigt den aktuellen Stand.',
      einsaetze_offen:
        'Für diese Veranstaltung stehen noch Schichten in der Zukunft. Erst die Einteilung '
        + 'auflösen, dann archivieren — sonst fährt jemand zu einem Termin, den es nicht '
        + 'mehr gibt.',
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'The event was not saved. Check the details and try again.',
    fehler: {
      id_fehlt: 'Which event is meant is missing — open it from the list.',
      bezeichnung_fehlt: 'An event needs a name.',
      kunde_fehlt: 'An event is guarded for a Kunde (customer) — please choose one.',
      ort_fehlt:
        'An event needs a location: either an Objekt (site) of this Gesellschaft or an '
        + 'address as free text. Without either, the guard does not know where to go.',
      zeitpunkt_ungueltig:
        'Start and end each need a date and a time, both in Berlin time.',
      fenster_ungueltig:
        'The end is before the start or equal to it. An event running past midnight ends on '
        + 'the following day — then the next date belongs in the field.',
      zahl_ungueltig:
        'The required headcount is a whole number from 1 to 999, the expected visitors a '
        + 'whole number from 0.',
      nicht_angelegt:
        'The event was not created. Check whether your account may edit security in this '
        + 'Gesellschaft (legal entity).',
      veranstaltung_unbekannt:
        'This event no longer exists in this Gesellschaft, or it has been archived — the '
        + 'list shows the current state.',
      einsaetze_offen:
        'Shifts in the future are still scheduled for this event. Remove the staffing first, '
        + 'then archive — otherwise someone drives to an appointment that no longer exists.',
    },
  },
};

/**
 * Was nach einem Schreibversuch im Bewacherregister oben auf der Liste steht —
 * nachgeschlagen nach dem SCHLÜSSEL aus `?erfolg=` bzw. dem GRUND aus
 * `?fehler=` (V-275, D-773, D-769).
 *
 * Bis dahin schickte `POST /api/security/bewacherregister` die Sätze selbst in
 * `?ok=` und `?fehler=`, und die Seite zeigte sie roh — bei einem unbekannten
 * Eintrag mit dessen voller Kennung. **Nur deutsch, in derselben Form wie die
 * zweisprachigen Tabellen:** die Seite steht noch auf der Ausnahmeliste der
 * Übersetzungswache; stellt jemand sie um, kommt hier nur `en` dazu.
 *
 * Ein unbekannter Erfolgsschlüssel zeigt keinen Kasten (wie auf der
 * Eingangsrechnung, V-216); ein unbekannter Grund bekommt `sonst`.
 */
export interface BewacherregisterTexte {
  /** Die ersten Worte des Erfolgskastens. */
  readonly gespeichert: string;
  readonly erfolg: Readonly<Record<BewacherErfolg, string>>;
  /** Die ersten Worte des Warnkastens. */
  readonly titel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<BewacherGrund, string>>;
}

export const BEWACHERREGISTER_TEXTE: Readonly<Record<'de', BewacherregisterTexte>> = {
  de: {
    gespeichert: 'Gespeichert.',
    erfolg: {
      erfasst: 'Der Registereintrag ist erfasst — handerfasst, ohne Abgleich.',
      fortgeschrieben:
        'Der Registereintrag ist fortgeschrieben; die Änderung steht im Protokoll.',
    },
    titel: 'Nicht gespeichert.',
    sonst: 'Der Registereintrag wurde nicht gespeichert. Prüfen Sie die Angaben und '
      + 'versuchen Sie es noch einmal.',
    fehler: {
      pflichtangaben_fehlen: 'Person, Bewacher-ID und Status sind Pflicht.',
      eintrag_fehlt:
        'Welcher Registereintrag fortgeschrieben werden soll, fehlt — öffnen Sie ihn aus '
        + 'der Liste heraus.',
      bewacher_id_ungueltig:
        'Die Bewacher-ID hat 1 bis 32 Zeichen. Ein Format wird nicht geprüft — Voreinstellung '
        + '(O-40): übernommen wird, was die Behörde ausgestellt hat.',
      status_unbekannt:
        'Diesen Status kennt das Register nicht — bitte einen aus der Auswahl nehmen.',
      datum_ungueltig:
        '„Registriert seit", „Gültig bis" und die beiden Prüfdaten sind Kalendertage.',
      zeitraum_ungueltig: '„Gültig bis" liegt vor „Registriert seit".',
      nicht_angelegt:
        'Der Eintrag wurde nicht angelegt — die Person ist in dieser Gesellschaft nicht '
        + 'sichtbar, oder Ihr Konto darf hier nicht schreiben.',
      eintrag_unbekannt:
        'Diesen Registereintrag gibt es in dieser Gesellschaft nicht mehr, oder er ist '
        + 'erloschen — die Liste zeigt den aktuellen Stand.',
    },
  },
};
