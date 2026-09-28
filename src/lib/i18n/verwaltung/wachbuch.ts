/**
 * Das Wachbuch der Leitstelle — die Sätze, die mit V-180 (Schlüssel) und
 * V-181 (Fotos) dazukamen, in beiden Sprachen (SEC-05, SEC-07, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text:** `Wachbuch`,
 * `Objekt`, `Posten` und die Art `Schlüssel` sind die Wörter des
 * Bewachungsgewerbes (§ 34a GewO) und stehen so in der Beweiskette.
 *
 * **Jede Abweisung hat einen Satz.** Die Route schickt den GRUND als
 * `?fehler=` zurück (D-599); die Seite schlägt ihn hier nach
 * (`eigenerEintrag`, D-728) und zeigt nie den Schlüssel selbst.
 *
 * **Der Rückfall sagt etwas anderes als die Überschrift.** Die Seiten setzen
 * `<strong>{abgewiesen}</strong> {fehler}`; war `fehlerUnbekannt` derselbe
 * Satz wie `abgewiesen`, stand ein unbekannter Grund doppelt da („Der Eintrag
 * wurde nicht geschrieben. Der Eintrag wurde nicht geschrieben."). Er sagt
 * deshalb, was jetzt zu tun ist (V-180).
 */
import type { InternSprache } from '../intern.js';

export interface WachbuchTexte {
  readonly schluessel: string;
  readonly schluesselHinweis: string;
  readonly keinSchluessel: string;
  readonly ohneSchluessel: string;
  readonly schluesselZeile: (schluessel: string) => string;
  readonly quittungVerweis: string;
  /**
   * Statt der Art „Schlüssel", wenn diese Anmeldung keinen Schlüssel lesen
   * darf — die Art könnte dann nur scheitern (V-180).
   */
  readonly schluesselOhneRecht: string;
  /** Der Verweis auf die Seite, die einen stornierten Eintrag ersetzt hat (V-180). */
  readonly zurRichtigstellung: string;
  /** Statt des Formulars, wenn diese Anmeldung das Buch nur lesen darf. */
  readonly richtigstellenOhneRecht: string;
  /**
   * V-181: Fotos an der Seite — nur beim Schreiben, nie danach. Die Liste
   * selbst spricht `AUFNAHMEN_TEXTE` (`./aufnahmen.ts`), dieselbe wie auf dem
   * Schichtblatt.
   */
  readonly fotos: string;
  readonly fotoHinweis: string;
  readonly fotoNichtVerbunden: string;
  readonly fotoAnzahl: (anzahl: number) => string;
  /** Die Aufnahmen der Schicht, an der die Seite hängt (Bezug `einsatz`). */
  readonly schichtFotosHinweis: string;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerUnbekannt: string;
}

/** Die Schlüsselquittung und ihre Seite im Wachbuch (V-180). */
export interface QuittungWachbuchTexte {
  readonly imWachbuch: string;
  readonly imWachbuchHinweis: string;
  /**
   * Statt des Häkchens, wenn dieses Konto hier keine Beschäftigung hat: die
   * Seite trüge keinen Urheber, und das Häkchen könnte nur scheitern (D-674).
   */
  readonly imWachbuchOhneUrheber: string;
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
    imWachbuchOhneUrheber: 'Eine Seite im Wachbuch des Objekts schreibt diese Quittung nicht: '
      + 'der Urheber einer Seite ist eine Beschäftigung in dieser Gesellschaft, und dieses '
      + 'Konto hat hier keine.',
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
    fehlerUnbekannt: 'Einen Grund dafür nennt diese Seite nicht. Bitte die Angaben prüfen '
      + 'und erneut quittieren; bleibt es dabei, die Administration informieren.',
  },
  en: {
    imWachbuch: 'Also record in the Objekt\'s Wachbuch',
    imWachbuchHinweis: 'Writes a page of type "Schlüssel" in the same booking — you '
      + 'appear on it as the author, with your employment at this company.',
    imWachbuchOhneUrheber: 'This receipt does not write a page in the Objekt\'s Wachbuch: the '
      + 'author of a page is an employment with this company, and this account has none here.',
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
    fehlerUnbekannt: 'This page has no reason on record for it. Please check the details and '
      + 'receipt again; if it persists, inform the administration.',
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
    schluesselOhneRecht: 'Die Art „Schlüssel" schreibt, wer die Schlüssel dieser Gesellschaft '
      + 'lesen darf — dieses Konto hält das Recht dafür nicht.',
    zurRichtigstellung: 'Zur Richtigstellung',
    richtigstellenOhneRecht: 'Richtigstellen darf, wer das Wachbuch führt — dieses Konto darf '
      + 'es nur lesen.',
    fotos: 'Fotos',
    fotoHinweis: 'Freiwillig. Die Fotos gehören zu diesem Eintrag und lassen sich später '
      + 'nicht ergänzen — ein späteres Foto ist ein neuer Eintrag. Ortsdaten werden vor '
      + 'dem Speichern entfernt.',
    fotoNichtVerbunden: 'Der Medienspeicher ist nicht verbunden — Fotos lassen sich gerade '
      + 'nicht anhängen. Der Eintrag selbst geht.',
    fotoAnzahl: (anzahl) => (anzahl === 1 ? '1 Foto' : `${String(anzahl)} Fotos`),
    schichtFotosHinweis: 'Was die Wache während dieser Schicht über „Fotos" aufgenommen hat — '
      + 'sie hängen an der Schicht, nicht an dieser Seite.',
    abgewiesen: 'Der Eintrag wurde nicht geschrieben.',
    fehler: {
      pflichtfeld_fehlt: 'Objekt, Art, Betreff und Text gehören zu jedem Eintrag.',
      foto_zu_gross: 'Ein Foto ist zu groß — bitte ohne dieses Foto oder mit einem kleineren '
        + 'erneut senden.',
      foto_leer: 'Ein Foto ist leer.',
      foto_typ_unbekannt: 'Eine Datei ist kein erkennbares Foto.',
      foto_typ_nicht_erlaubt: 'Dieser Dateityp ist für Fotos nicht zugelassen.',
      foto_widerspruch: 'Eine Datei ist nicht das, als was sie ausgegeben wird.',
      foto_bereinigung: 'Aus einem Foto ließen sich die Ortsdaten nicht entfernen, deshalb '
        + 'wurde nichts gespeichert.',
      speicher_nicht_verbunden: 'Der Medienspeicher ist nicht verbunden — bitte ohne Foto '
        + 'senden.',
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
    fehlerUnbekannt: 'Einen Grund dafür nennt diese Seite nicht. Bitte die Angaben prüfen '
      + 'und erneut senden; bleibt es dabei, die Administration informieren.',
  },
  en: {
    schluessel: 'Key (required for type Schlüssel)',
    schluesselHinweis: 'Only keys of the selected Objekt are accepted.',
    keinSchluessel: 'No key is recorded for this company\'s Objekte yet — keys are '
      + 'created in key management.',
    ohneSchluessel: '— none —',
    schluesselZeile: (schluessel) => `Key ${schluessel}`,
    quittungVerweis: 'To the receipt',
    schluesselOhneRecht: 'The type "Schlüssel" is written by whoever may read this company\'s '
      + 'keys — this account does not hold that right.',
    zurRichtigstellung: 'To the correction',
    richtigstellenOhneRecht: 'Corrections are written by whoever keeps the Wachbuch — this '
      + 'account may only read it.',
    fotos: 'Photos',
    fotoHinweis: 'Optional. The photos belong to this entry and cannot be added later — a '
      + 'later photo is a new entry. Location data is removed before saving.',
    fotoNichtVerbunden: 'The media storage is not connected — photos cannot be attached right '
      + 'now. The entry itself works.',
    fotoAnzahl: (anzahl) => (anzahl === 1 ? '1 photo' : `${String(anzahl)} photos`),
    schichtFotosHinweis: 'What the guard recorded under "Photos" during this shift — they '
      + 'belong to the shift, not to this page.',
    abgewiesen: 'The entry was not written.',
    fehler: {
      pflichtfeld_fehlt: 'Objekt, type, subject and text belong to every entry.',
      foto_zu_gross: 'A photo is too large — please send again without this photo or with a '
        + 'smaller one.',
      foto_leer: 'A photo is empty.',
      foto_typ_unbekannt: 'A file is not a recognisable photo.',
      foto_typ_nicht_erlaubt: 'This file type is not allowed for photos.',
      foto_widerspruch: 'A file is not what it claims to be.',
      foto_bereinigung: 'Location data could not be removed from a photo, so nothing was saved.',
      speicher_nicht_verbunden: 'The media storage is not connected — please send without a '
        + 'photo.',
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
    fehlerUnbekannt: 'This page has no reason on record for it. Please check the details and '
      + 'send again; if it persists, inform the administration.',
  },
};
