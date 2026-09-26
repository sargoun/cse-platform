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
      'Freiwillig. Woher ein Veranstaltungsauftrag entsteht — aus einer '
      + 'Auftragsposition, aus dem Vertrieb oder handerfasst von der Wachleitung '
      + '—, ist noch zu entscheiden (O-703). Bis dahin lässt sich beides: mit '
      + 'Position verbinden oder ohne erfassen.',
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
      'Optional. Where an event order originates — from an order position, from '
      + 'sales, or recorded by hand by the guard management — is still to be '
      + 'decided (O-703). Until then both work: linked to a position, or recorded '
      + 'without one.',
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
