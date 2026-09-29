/**
 * Die Sätze der CRM-Rückwege — nachgeschlagen nach einem SCHLÜSSEL aus der
 * Adresse, nie aus ihr gelesen (D-769, D-772, V-274, D-728).
 *
 * **Der Befund.** Die Routen des CRM schickten den deutschen Satz eines
 * Dienstes (`?meldung=`) und ihre Erfolgssätze (`?erfolg=`) durch die
 * Adresse, und die Seiten zeigten, was dort stand: in einer englischen Sitzung
 * deutsch, bei einem Tippfehler in einer Kennung samt der Eingabe, beim
 * Kundenzugang und beim Widerspruch den rohen Text der Datenbank — und bei
 * jedem präparierten Link dessen Text, als Warnung oder als Bestätigung des
 * Portals.
 *
 * **Jetzt reist der Schlüssel, und der Satz steht hier.** Je Seite eine
 * Tabelle: der fett gesetzte Anfang (`titel`), der allgemeine Satz für einen
 * Grund, den sie nicht kennt (`sonst`), ein Satz je Grund (`fehler`) und je
 * Erfolg (`erfolg`). Welche Gründe eine Route schicken kann, liest
 * `tests/kern/hilfen/gruende.ts` aus dem Quelltext; die Listen hier sind
 * dagegen geprüft.
 *
 * **Sprache.** Die Seiten dieses Bereichs stehen auf der Ausnahmeliste der
 * Übersetzungswache und sprechen deutsch; ihre Tabellen sind deutsch, in
 * derselben Form wie die zweisprachigen (`NurDeutsch`) — die Umstellung einer
 * Seite ergänzt `en`. Zweisprachig ist, was eine Seite liest, die der
 * Sitzungssprache folgt: die Wiedervorlage steht auch auf dem Leadblatt.
 *
 * **Keine Kennung, keine Eingabe, kein Schlüssel eines Rechts im Satz.** Ein
 * Recht steht mit seinem Namen da (`rechtName`, V-144), eine offene Frage mit
 * ihrer Nummer.
 */
import type { InternSprache } from '../intern.js';
import { rechtName } from '../rechtname.js';
import type { CrmGrund } from '../../../server/services/crm/anlegen.js';
import type { WiedervorlageErfolg } from '../../../server/services/crm/wiedervorlage.js';
import type { SteuerGrund, SteuerVorgang } from '../../../server/services/finanz/kunde-steuer.js';

/** Die Sätze einer Abweisung auf EINER Seite. */
export interface AbweisungTexte<G extends string> {
  /** Die fett gesetzten ersten Worte des Warnkastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt — nie der Schlüssel, nie Text aus der Adresse. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<G, string>>;
}

/** Dazu die Sätze der Bestätigungen — ein unbekannter Schlüssel zeigt keinen Kasten. */
export interface RueckwegTexte<G extends string, E extends string> extends AbweisungTexte<G> {
  readonly erfolg: Readonly<Record<E, string>>;
}

/**
 * Eine Tabelle für eine Seite der Ausnahmeliste: nur Deutsch, in derselben
 * Form wie die zweisprachigen — die Umstellung der Seite ergänzt `en`.
 */
export type NurDeutsch<T> = Readonly<Pick<Record<InternSprache, T>, 'de'>>;

const KUNDENDATEN = rechtName('crm.schreiben', 'de');
const FINANZEN = rechtName('finanzen.schreiben', 'de');

/* ── Neuer Kunde (`POST /api/crm/kunde`, `legeKundeAn`) ─────────────────── */

export const KUNDE_NEU_GRUENDE = [
  'name_fehlt', 'typ_fehlt', 'grundlage_ohne_quelle', 'kein_schreibrecht',
] as const satisfies readonly CrmGrund[];
export type KundeNeuGrund = (typeof KUNDE_NEU_GRUENDE)[number];

export const KUNDE_NEU_RUECKWEG: NurDeutsch<AbweisungTexte<KundeNeuGrund>> = {
  de: {
    titel: 'Nicht angelegt.',
    sonst: 'Der Kunde wurde nicht angelegt; es wurde nichts gespeichert.',
    fehler: {
      name_fehlt: 'Ein Kunde braucht einen Namen.',
      typ_fehlt: 'Bitte wählen Sie eine Art: Firma, Behörde oder Privat.',
      grundlage_ohne_quelle:
        'Zu einer Rechtsgrundlage gehört, woher sie stammt — sonst ist sie in einer Abmahnung '
        + 'nichts wert. Tragen Sie unter „Woher stammt sie?" ein, wo und wann sie erteilt '
        + 'wurde, zum Beispiel „Häkchen im Angebotsformular vom 12.03." — oder wählen Sie '
        + '„Keine".',
      kein_schreibrecht: `Dafür fehlt das Recht „${KUNDENDATEN}" in dieser Gesellschaft.`,
    },
  },
};

/* ── Hauptkontakt auf dem Kontaktblatt (`POST /api/crm/kunde`, `aktion=hauptkontakt`) ── */

export const HAUPTKONTAKT_GRUENDE = [
  'id_fehlt', 'kontakt_unbekannt', 'abgewiesen',
] as const satisfies readonly CrmGrund[];
export type HauptkontaktGrund = (typeof HAUPTKONTAKT_GRUENDE)[number];

export const HAUPTKONTAKT_RUECKWEG: NurDeutsch<AbweisungTexte<HauptkontaktGrund>> = {
  de: {
    titel: 'Der Hauptkontakt wurde nicht gesetzt.',
    sonst: 'Es wurde nichts geändert.',
    fehler: {
      id_fehlt:
        'Im Formular fehlte der Kunde oder der Kontakt. Öffnen Sie das Blatt neu und versuchen '
        + 'Sie es noch einmal.',
      kontakt_unbekannt:
        'Dieser Ansprechpartner gehört nicht mehr zu diesem Kunden, oder er ist ausgeschieden — '
        + 'das Blatt zeigt den aktuellen Stand.',
      abgewiesen: `Dafür fehlt das Recht „${KUNDENDATEN}" in dieser Gesellschaft.`,
    },
  },
};

/* ── Wiedervorlagen (`POST /api/crm/wiedervorlage`) ────────────────────────
 * Die Liste und das Kontaktblatt sprechen deutsch, das Leadblatt folgt der
 * Sitzung — daher zweisprachig.
 */

export const WIEDERVORLAGE_GRUENDE = [
  'nicht_gefunden', 'betreff_fehlt', 'ohne_bezug', 'ohne_frist', 'kein_schreibrecht',
  'ungueltiger_bezug', 'kein_lead', 'kein_kunde', 'kein_kontakt', 'fremder_kontakt',
  'zustaendig_ohne_zugang', 'ohne_grund', 'ohne_datum',
] as const satisfies readonly CrmGrund[];
export type WiedervorlageGrund = (typeof WIEDERVORLAGE_GRUENDE)[number];

export const WIEDERVORLAGE_RUECKWEG: Readonly<Record<InternSprache,
  RueckwegTexte<WiedervorlageGrund, WiedervorlageErfolg>>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Es wurde nichts geändert.',
    fehler: {
      nicht_gefunden:
        'Diese Wiedervorlage gibt es nicht mehr, oder sie ist schon erledigt — die Liste zeigt '
        + 'den aktuellen Stand.',
      betreff_fehlt: 'Eine Wiedervorlage braucht einen Betreff — er steht später allein in der Liste.',
      ohne_bezug: 'Eine Wiedervorlage hängt an einem Lead oder an einem Kunden.',
      ohne_frist:
        'Ohne Fälligkeit ist es eine Notiz und keine Wiedervorlage. Bitte tragen Sie ein, wann '
        + 'sie fällig ist.',
      kein_schreibrecht: `Dafür fehlt das Recht „${KUNDENDATEN}".`,
      ungueltiger_bezug:
        'Dieser Bezug ist ungültig. Öffnen Sie das Blatt neu und versuchen Sie es noch einmal.',
      kein_lead: 'Diesen Lead gibt es hier nicht.',
      kein_kunde: 'Diesen Kunden gibt es hier nicht.',
      kein_kontakt: 'Diesen Ansprechpartner gibt es hier nicht.',
      fremder_kontakt: 'Dieser Ansprechpartner gehört zu einem anderen Kunden.',
      zustaendig_ohne_zugang:
        'Zuständig kann nur sein, wer in diesem Bereich das CRM lesen darf — sonst sähe er die '
        + 'Wiedervorlage nie.',
      ohne_grund:
        'Ein Verschieben trägt einen Grund — sonst ist später nicht zu sehen, ob einmal aus '
        + 'gutem Grund oder viermal aus Gewohnheit verschoben wurde.',
      ohne_datum: 'Ohne neues Datum ist nichts verschoben.',
    },
    erfolg: {
      erledigt: 'Erledigt — mit der Serverzeit gestempelt.',
      verschoben: 'Verschoben. Der Grund steht als Notiz im Verlauf.',
      angelegt: 'Die Wiedervorlage steht — in der Liste, in den Aufgaben und im Kalender.',
      angelegt_ohne_aufgabe:
        'Die Wiedervorlage steht, auch im Kalender. In der Aufgabenliste erscheint sie nicht — '
        + `dafür fehlt das Recht „${rechtName('aufgabe.schreiben', 'de')}".`,
      angelegt_ohne_kalender:
        'Die Wiedervorlage steht, auch in den Aufgaben. Im Kalender erscheint sie nicht — dafür '
        + `fehlt das Recht „${rechtName('kalender.schreiben', 'de')}".`,
      angelegt_ohne_spiegel:
        'Die Wiedervorlage steht. In der Aufgabenliste und im Kalender erscheint sie nicht — '
        + `dafür fehlen die Rechte „${rechtName('aufgabe.schreiben', 'de')}" und `
        + `„${rechtName('kalender.schreiben', 'de')}".`,
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'Nothing was changed.',
    fehler: {
      nicht_gefunden:
        'This Wiedervorlage (follow-up) no longer exists, or it has already been done — the '
        + 'list shows the current state.',
      betreff_fehlt: 'A follow-up needs a subject — later it stands alone in the list.',
      ohne_bezug: 'A follow-up belongs to a Lead or to a customer.',
      ohne_frist: 'Without a due date it is a note, not a follow-up. Please enter when it is due.',
      kein_schreibrecht: `That needs the right “${rechtName('crm.schreiben', 'en')}”.`,
      ungueltiger_bezug: 'This reference is invalid. Reopen the page and try again.',
      kein_lead: 'There is no such Lead here.',
      kein_kunde: 'There is no such customer here.',
      kein_kontakt: 'There is no such contact person here.',
      fremder_kontakt: 'This contact person belongs to a different customer.',
      zustaendig_ohne_zugang:
        'Only someone who may read the CRM in this company can be responsible — otherwise they '
        + 'would never see the follow-up.',
      ohne_grund:
        'Postponing needs a reason — otherwise nobody can tell later whether it was postponed '
        + 'once for a good reason or four times out of habit.',
      ohne_datum: 'Without a new date nothing is postponed.',
    },
    erfolg: {
      erledigt: 'Done — stamped with the server time.',
      verschoben: 'Postponed. The reason is recorded as a note in the history.',
      angelegt: 'The follow-up is in place — in the list, in the tasks and in the calendar.',
      angelegt_ohne_aufgabe:
        'The follow-up is in place, in the calendar too. It does not appear in the task list — '
        + `that needs the right “${rechtName('aufgabe.schreiben', 'en')}”.`,
      angelegt_ohne_kalender:
        'The follow-up is in place, in the tasks too. It does not appear in the calendar — that '
        + `needs the right “${rechtName('kalender.schreiben', 'en')}”.`,
      angelegt_ohne_spiegel:
        'The follow-up is in place. It appears neither in the task list nor in the calendar — '
        + `that needs the rights “${rechtName('aufgabe.schreiben', 'en')}” and `
        + `“${rechtName('kalender.schreiben', 'en')}”.`,
    },
  },
};

/* ── Steuerblatt (`POST /api/crm/kunde/steuer`) ─────────────────────────────
 * Welche Gründe die Route schicken kann, steht als `STEUER_GRUENDE` am
 * Dienst; die Tabelle ist daran gebunden (`Record<SteuerGrund, …>`).
 */

export const STEUER_RUECKWEG: NurDeutsch<RueckwegTexte<SteuerGrund, SteuerVorgang>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Es wurde nichts geändert.',
    fehler: {
      art_unbekannt:
        'Diese Leistungsart gibt es nicht. Zur Wahl stehen Bauleistungen und Gebäudereinigung '
        + '(O-104).',
      umfang_unbekannt:
        'Diesen Umfang gibt es nicht. Eine Bescheinigung ist unbeschränkt oder auftragsbezogen.',
      dokument_keine_kennung:
        'Das Feld für das Dokument erwartet dessen Kennung aus der Adresszeile (36 Zeichen, mit '
        + 'Bindestrichen) — keine Belegnummer und keinen Dateinamen.',
      auftrag_keine_kennung:
        'Das Feld „Auftrag" erwartet die Kennung aus der Adresszeile des Auftrags (36 Zeichen, '
        + 'mit Bindestrichen) — nicht die Auftragsnummer.',
      grundlage_fehlt:
        'Zu einem §13b-Status gehört seine Grundlage — womit ist er belegt? Beispiel: '
        + '„Bestätigung USt 1 TG vom 12.01.2025" oder „schriftliche Erklärung des Kunden vom '
        + '03.03." Ohne Belegangabe ist der Status in einer Prüfung nichts wert (O-104).',
      ohne_beginn: 'Ohne Beginn gibt es keine Zeitscheibe.',
      zeitraum_verdreht: 'Das Ende liegt vor dem Beginn.',
      ueberlapp:
        'Für diese Leistungsart ist schon ein Status hinterlegt, dessen Zeitraum sich mit dem '
        + 'eingegebenen überschneidet — er steht unter § 13b in der Liste der Zeitscheiben. Zwei '
        + 'überlappende Zeiträume liessen offen, welcher am Leistungsdatum gilt: beenden Sie den '
        + 'bestehenden zuerst.',
      ueberlapp_gleichzeitig:
        'Für diese Leistungsart wurde gerade ein überlappender Zeitraum eingetragen. Laden Sie '
        + 'die Seite neu.',
      nummer_fehlt:
        'Die Nummer der Bescheinigung fehlt — sie ist das, womit das Finanzamt sie wiederfindet.',
      finanzamt_fehlt: 'Welches Finanzamt hat sie ausgestellt?',
      zeitraum_fehlt:
        'Eine Freistellungsbescheinigung gilt für einen Zeitraum — beide Tage gehören dazu. Sie '
        + 'wird am Leistungsdatum geprüft, nicht heute.',
      umfang_unstimmig:
        'Umfang und Auftrag passen nicht zusammen: eine auftragsbezogene Bescheinigung braucht '
        + 'den Auftrag, für den sie gilt; eine unbeschränkte gilt für jeden Auftrag und nennt '
        + 'keinen einzelnen.',
      ohne_datum:
        'Ab welchem Tag ist sie widerrufen? Ohne Datum wäre offen, welche Leistungen noch gedeckt '
        + 'waren.',
      weg_unbekannt: 'Diesen Übertragungsweg gibt es nicht.',
      format_unbekannt: 'Dieses Rechnungsformat gibt es nicht.',
      schema_fehlt:
        'Eine elektronische Adresse ohne Schema (BT-49-1) ist nicht auflösbar — 0204 für die '
        + 'Leitweg-ID, EM für E-Mail, 0088 für eine GLN.',
      kein_schreibrecht:
        `Dafür fehlt ein Recht: die Rechnungsangaben ändert, wer „${KUNDENDATEN}" hält; `
        + `§13b-Status, Freistellungsbescheinigung und Widerruf trägt ein, wer „${FINANZEN}" hält.`,
      nicht_angelegt: 'Der Eintrag wurde nicht angelegt — die Datenbank hat ihn nicht angenommen.',
      nicht_gefunden:
        'Das gibt es hier nicht mehr: die Bescheinigung ist schon widerrufen, oder der Kunde ist '
        + 'archiviert. Die Seite zeigt den aktuellen Stand.',
    },
    erfolg: {
      erechnung:
        'Die Rechnungsangaben sind gespeichert. Ob damit versendet werden kann, steht oben im '
        + 'Versandstand.',
      bauleistender:
        'Die Zeitscheibe ist angelegt. Die Antwort zum Stichtag oben ist damit neu berechnet — '
        + 'aus der geprüften Funktion, nicht aus dieser Seite.',
      bescheinigung:
        'Die Freistellungsbescheinigung ist erfasst. Geprüft wird sie am Leistungsdatum, nicht '
        + 'heute.',
      widerruf:
        'Der Widerruf ist eingetragen. Die Bescheinigung bleibt lesbar — jede Rechnung, die sich '
        + 'auf sie beruft, muss herleitbar bleiben.',
    },
  },
};
