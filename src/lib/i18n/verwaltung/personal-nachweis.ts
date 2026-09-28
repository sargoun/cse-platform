/**
 * Die Wörter der Nachweisaufnahme — in beiden Sprachen (V-010, SEC-02).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** „Sachkunde
 * nach § 34a GewO" ist eine Prüfung mit einem Namen im Gesetz; „proficiency
 * test" ist keine Übersetzung davon, sondern eine andere Sache. Erklärt wird
 * in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

export interface NachweisErfassenTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly warum: string;

  readonly person: string;
  readonly personWaehlen: string;
  readonly qualifikation: string;
  readonly qualifikationWaehlen: string;
  readonly erfordertDokument: string;
  readonly laeuftAb: string;

  readonly gueltigAb: string;
  readonly gueltigBis: string;
  readonly gueltigBisErklaerung: string;
  readonly unbefristet: string;

  readonly nummer: string;
  readonly nummerBeispiel: string;
  readonly stelle: string;
  readonly stelleBeispiel: string;
  readonly ausgestelltAm: string;
  readonly dokument: string;
  readonly dokumentErklaerung: string;
  readonly ohneDokument: string;
  readonly freiwillig: string;

  readonly speichern: string;
  readonly abbrechen: string;
  readonly keinSchreibrecht: string;
  readonly keinePersonen: string;
  readonly keineQualifikationen: string;

  /* ── Die Entscheidung auf dem Einzelblatt ───────────────────────────── */
  readonly pruefung: string;
  readonly pruefungErklaerung: string;
  readonly bestaetigen: string;
  readonly bestaetigt: string;
  readonly widerrufen: string;
  readonly widerrufGrund: string;
  readonly widerrufenAm: string;

  readonly fehler: Readonly<Record<string, string>>;
  /**
   * Der Satz für einen Grund, den `fehler` nicht kennt (V-197) — nie der rohe
   * Schlüssel aus der Adresse.
   */
  readonly fehlerSonst: string;
}

export const NACHWEIS_ERFASSEN_TEXTE:
Readonly<Record<InternSprache, NachweisErfassenTexte>> = {
  de: {
    modul: 'Personal',
    titel: 'Nachweis aufnehmen',
    untertitel: 'Sachkunde nach § 34a GewO, Erste Hilfe, Führungszeugnis — '
      + 'die Urkunde, die vor einem Posten steht.',
    warum:
      'Der Nachweis hängt am MENSCHEN, nicht an der Beschäftigung: wer in zwei '
      + 'Gesellschaften arbeitet, hat seine Sachkunde einmal. Eingetragen wird, '
      + 'wer ihn aufnimmt — nicht, wer ihn sehen darf.',

    person: 'Mensch',
    personWaehlen: 'Menschen wählen',
    qualifikation: 'Qualifikation',
    qualifikationWaehlen: 'Qualifikation wählen',
    erfordertDokument: 'Urkunde nötig',
    laeuftAb: 'läuft ab',

    gueltigAb: 'Gültig ab',
    gueltigBis: 'Gültig bis',
    gueltigBisErklaerung:
      'Leer lassen heisst: die Standardgültigkeit der Qualifikation wird '
      + 'gerechnet. Läuft sie nicht ab, bleibt das Feld leer — und leer heisst '
      + 'dann unbefristet, nicht vergessen.',
    unbefristet: 'unbefristet',

    nummer: 'Nummer der Urkunde',
    nummerBeispiel: 'IHK-Nr. 12345',
    stelle: 'Ausstellende Stelle',
    stelleBeispiel: 'IHK Berlin',
    ausgestelltAm: 'Ausgestellt am',
    dokument: 'Dokument',
    dokumentErklaerung:
      'Wo die Qualifikation eine Urkunde verlangt, wird der Nachweis ohne sie '
      + 'nicht gültig (DOC-01). Laden Sie sie zuerst unter Dokumente hoch.',
    ohneDokument: 'kein Dokument',
    freiwillig: '(freiwillig)',

    speichern: 'Nachweis aufnehmen',
    abbrechen: 'Zurück zum Register',
    keinSchreibrecht: 'Einen Nachweis aufzunehmen verlangt',
    keinePersonen: 'In dieser Gesellschaft ist niemand beschäftigt.',
    keineQualifikationen: 'Es ist keine Qualifikation angelegt.',

    pruefung: 'Prüfung',
    pruefungErklaerung:
      'Bestätigen heisst: ein Mensch hat die Urkunde gesehen. Wer das war, '
      + 'setzt die Datenbank aus der Sitzung — ein Name, den jemand über sich '
      + 'selbst einträgt, ist keine Bestätigung. Widerrufen wird mit Grund; '
      + 'gelöscht wird nichts.',
    bestaetigen: 'Bestätigen',
    bestaetigt: 'Bestätigt von',
    widerrufen: 'Widerrufen',
    widerrufGrund: 'Grund des Widerrufs',
    widerrufenAm: 'Widerrufen am',

    fehler: {
      unvollstaendig: 'Es fehlt eine Angabe — bitte sehen Sie die Felder durch.',
      nicht_gefunden:
        'Dieser Nachweis ist nicht erreichbar — oder schon entschieden: bestätigt '
        + 'oder widerrufen. Laden Sie das Blatt neu, dann steht der Stand da.',
      abgewiesen:
        'Die Datenbank hat die Zeile abgewiesen — fehlt das Recht in dieser '
        + 'Gesellschaft, oder gehört der Mensch nicht zu ihr?',
      dokument_fehlt: 'Diese Qualifikation wird nur mit hinterlegter Urkunde gültig (DOC-01).',
      schon_vorhanden:
        'Für diesen Menschen, diese Qualifikation und dieses Startdatum gibt es '
        + 'schon einen Nachweis.',
      grund_fehlt: 'Ein Widerruf ohne Grund ist keine Auskunft.',
      zeitraum: 'Das Ende der Gültigkeit liegt vor ihrem Beginn.',
    },
    fehlerSonst: 'Der Schritt lief nicht durch. Der Nachweis steht, wie er war.',
  },

  en: {
    modul: 'Personnel',
    titel: 'Record a certificate',
    untertitel: 'Sachkunde (§ 34a GewO proficiency test), first aid, '
      + 'Führungszeugnis (police clearance) — the document that stands before a post.',
    warum:
      'The certificate hangs off the PERSON, not the Anstellung (employment): '
      + 'somebody working for two entities holds their Sachkunde once. What is '
      + 'recorded is who entered it — not who may see it.',

    person: 'Person',
    personWaehlen: 'Choose a person',
    qualifikation: 'Qualification',
    qualifikationWaehlen: 'Choose a qualification',
    erfordertDokument: 'document required',
    laeuftAb: 'expires',

    gueltigAb: 'Valid from',
    gueltigBis: 'Valid until',
    gueltigBisErklaerung:
      'Leaving it blank derives the qualification’s standard validity. Where it '
      + 'does not expire the field stays empty — and empty then means open-ended, '
      + 'not forgotten.',
    unbefristet: 'open-ended',

    nummer: 'Certificate number',
    nummerBeispiel: 'IHK no. 12345',
    stelle: 'Issuing body',
    stelleBeispiel: 'IHK Berlin',
    ausgestelltAm: 'Issued on',
    dokument: 'Document',
    dokumentErklaerung:
      'Where the qualification requires a document the certificate does not become '
      + 'valid without one (DOC-01). Upload it under Documents first.',
    ohneDokument: 'no document',
    freiwillig: '(optional)',

    speichern: 'Record certificate',
    abbrechen: 'Back to the register',
    keinSchreibrecht: 'Recording a certificate requires',
    keinePersonen: 'Nobody is employed by this Gesellschaft (legal entity).',
    keineQualifikationen: 'No qualification has been set up.',

    pruefung: 'Check',
    pruefungErklaerung:
      'Confirming means: a person has seen the document. Who that was is set by '
      + 'the database from the session — a name somebody types about themselves '
      + 'is not a confirmation. Revoking takes a reason; nothing is deleted.',
    bestaetigen: 'Confirm',
    bestaetigt: 'Confirmed by',
    widerrufen: 'Revoke',
    widerrufGrund: 'Reason for revocation',
    widerrufenAm: 'Revoked on',

    fehler: {
      unvollstaendig: 'Something is missing — please check the fields.',
      nicht_gefunden:
        'This certificate is not reachable — or already decided: confirmed or '
        + 'revoked. Reload the page to see its current state.',
      abgewiesen:
        'The database refused the row — is the right missing in this Gesellschaft, '
        + 'or does the person not belong to it?',
      dokument_fehlt: 'This qualification only becomes valid with a document (DOC-01).',
      schon_vorhanden:
        'A certificate already exists for this person, this qualification and this '
        + 'start date.',
      grund_fehlt: 'A revocation without a reason is no answer.',
      zeitraum: 'The end of validity lies before its start.',
    },
    fehlerSonst: 'The step did not go through. The certificate is as it was.',
  },
};
