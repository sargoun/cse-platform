/**
 * Das Wachbuch der Leitstelle — die Sätze, die mit V-180 (Schlüssel) dazukamen,
 * in beiden Sprachen (SEC-05, SEC-07, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text:** `Wachbuch`,
 * `Objekt`, `Posten` und die Art `Schlüssel` sind die Wörter des
 * Bewachungsgewerbes (§ 34a GewO) und stehen so in der Beweiskette.
 *
 * **Jede Abweisung hat einen Satz.** Die Route schickt den GRUND als
 * `?fehler=` zurück (D-599); die Seite schlägt ihn hier nach
 * (`eigenerEintrag`, D-728) und zeigt nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';

export interface WachbuchTexte {
  readonly schluessel: string;
  readonly schluesselHinweis: string;
  readonly keinSchluessel: string;
  readonly ohneSchluessel: string;
  readonly schluesselZeile: (schluessel: string) => string;
  readonly quittungVerweis: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerUnbekannt: string;
}

/** Die Schlüsselquittung und ihre Seite im Wachbuch (V-180). */
export interface QuittungWachbuchTexte {
  readonly imWachbuch: string;
  readonly imWachbuchHinweis: string;
  readonly wachbuchVerweis: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerUnbekannt: string;
}

export const QUITTUNG_WACHBUCH_TEXTE: Readonly<Record<InternSprache, QuittungWachbuchTexte>> = {
  de: {
    imWachbuch: 'Zugleich im Wachbuch des Objekts vermerken',
    imWachbuchHinweis: 'Schreibt in derselben Buchung eine Seite der Art „Schlüssel" — '
      + 'Sie stehen darauf als Urheber, mit Ihrer Beschäftigung in dieser Gesellschaft.',
    wachbuchVerweis: 'Im Wachbuch',
    abgewiesen: 'Die Quittung wurde nicht geschrieben.',
    fehler: {
      pflichtfeld_fehlt: 'Welches Ereignis wird quittiert?',
      ungueltige_eingabe: 'Die Angaben sind unvollständig — Empfänger und Unterschrift '
        + 'gehören zu jeder Übergabe und Rücknahme.',
      ungueltiger_zustand: 'Dieser Schlüssel ist bereits ausgegeben und nicht '
        + 'zurückgenommen — erst die Rücknahme, dann eine neue Übergabe.',
      nicht_gefunden: 'Diesen Schlüssel oder diesen Empfänger gibt es hier nicht.',
      kein_wachbuchrecht: 'Ins Wachbuch schreibt, wer das Wachbuch führen darf. Die '
        + 'Quittung ohne Wachbuchseite ist möglich — dann das Häkchen weglassen.',
      kein_urheber: 'Eine Wachbuchseite trägt ihren Urheber als Beschäftigung in dieser '
        + 'Gesellschaft — dieses Konto hat hier keine. Ohne das Häkchen lässt sich '
        + 'quittieren.',
    },
    fehlerUnbekannt: 'Die Quittung wurde nicht geschrieben.',
  },
  en: {
    imWachbuch: 'Also record in the Objekt\'s Wachbuch',
    imWachbuchHinweis: 'Writes a page of type "Schlüssel" in the same booking — you '
      + 'appear on it as the author, with your employment at this company.',
    wachbuchVerweis: 'In the Wachbuch',
    abgewiesen: 'The receipt was not written.',
    fehler: {
      pflichtfeld_fehlt: 'Which event is being receipted?',
      ungueltige_eingabe: 'The details are incomplete — recipient and signature belong '
        + 'to every hand-over and return.',
      ungueltiger_zustand: 'This key is already handed out and not returned — first the '
        + 'return, then a new hand-over.',
      nicht_gefunden: 'This key or this recipient does not exist here.',
      kein_wachbuchrecht: 'Only someone who may keep the Wachbuch writes into it. The '
        + 'receipt without a Wachbuch page is possible — leave the tick off.',
      kein_urheber: 'A Wachbuch page carries its author as an employment with this '
        + 'company — this account has none here. Without the tick you can receipt.',
    },
    fehlerUnbekannt: 'The receipt was not written.',
  },
};

export const WACHBUCH_TEXTE: Readonly<Record<InternSprache, WachbuchTexte>> = {
  de: {
    schluessel: 'Schlüssel (bei Art Schlüssel Pflicht)',
    schluesselHinweis: 'Nur Schlüssel des gewählten Objekts werden angenommen.',
    keinSchluessel: 'Für die Objekte dieser Gesellschaft ist noch kein Schlüssel erfasst '
      + '— Schlüssel legt die Schlüsselverwaltung an.',
    ohneSchluessel: '— keiner —',
    schluesselZeile: (schluessel) => `Schlüssel ${schluessel}`,
    quittungVerweis: 'Zur Quittung',
    abgewiesen: 'Der Eintrag wurde nicht geschrieben.',
    fehler: {
      pflichtfeld_fehlt: 'Objekt, Art, Betreff und Text gehören zu jedem Eintrag.',
      schluessel_fehlt: 'Ein Schlüsseleintrag nennt den Schlüssel, um den es geht.',
      grund_fehlt: 'Eine Korrektur braucht einen Grund.',
      ungueltige_eingabe: 'Die Eingabe ist unvollständig — bitte Betreff und Text prüfen.',
      fremder_schluessel: 'Dieser Schlüssel gehört zu einem anderen Objekt.',
      fremder_kontrollpunkt: 'Dieser Kontrollpunkt gehört zu einem anderen Objekt.',
      fremder_posten: 'Dieser Posten gehört zu einem anderen Objekt.',
      fremder_einsatz: 'Diese Schicht gehört zu einem anderen Objekt.',
      fremder_veranstaltung: 'Diese Veranstaltung gehört zu einem anderen Objekt.',
      kein_urheber: 'Ein Wachbucheintrag trägt seinen Urheber als Beschäftigung in dieser '
        + 'Gesellschaft — dieses Konto hat hier keine.',
      nicht_gefunden: 'Diesen Eintrag gibt es hier nicht.',
      ungueltiger_zustand: 'Dieser Eintrag ist bereits storniert — die Korrektur knüpft an '
        + 'den Eintrag an, der ihn ersetzt hat.',
    },
    fehlerUnbekannt: 'Der Eintrag wurde nicht geschrieben.',
  },
  en: {
    schluessel: 'Key (required for type Schlüssel)',
    schluesselHinweis: 'Only keys of the selected Objekt are accepted.',
    keinSchluessel: 'No key is recorded for this company\'s Objekte yet — keys are '
      + 'created in key management.',
    ohneSchluessel: '— none —',
    schluesselZeile: (schluessel) => `Key ${schluessel}`,
    quittungVerweis: 'To the receipt',
    abgewiesen: 'The entry was not written.',
    fehler: {
      pflichtfeld_fehlt: 'Objekt, type, subject and text belong to every entry.',
      schluessel_fehlt: 'A key entry names the key it concerns.',
      grund_fehlt: 'A correction needs a reason.',
      ungueltige_eingabe: 'The input is incomplete — please check subject and text.',
      fremder_schluessel: 'This key belongs to another Objekt.',
      fremder_kontrollpunkt: 'This checkpoint belongs to another Objekt.',
      fremder_posten: 'This Posten belongs to another Objekt.',
      fremder_einsatz: 'This shift belongs to another Objekt.',
      fremder_veranstaltung: 'This Veranstaltung belongs to another Objekt.',
      kein_urheber: 'A Wachbuch entry carries its author as an employment with this '
        + 'company — this account has none here.',
      nicht_gefunden: 'This entry does not exist here.',
      ungueltiger_zustand: 'This entry is already cancelled — the correction attaches to '
        + 'the entry that replaced it.',
    },
    fehlerUnbekannt: 'The entry was not written.',
  },
};
