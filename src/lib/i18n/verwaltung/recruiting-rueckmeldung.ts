/**
 * Die Rückmeldungen der Recruiting-Formulare — in beiden Sprachen (V-148,
 * D-642, D-562, D-599).
 *
 * **Der Befund.** Vier Recruiting-Seiten schicken ihr Formular mit
 * `zurueck` auf sich selbst, und `fuehreRecruitingAus` hängt bei einer
 * Abweisung `?fehler=<grund>` an. Keine der vier nahm Suchparameter an. Ein
 * Bewertungskriterium ohne Begründung wurde abgewiesen (`ohne_begruendung`),
 * die Seite lud neu, alle Eingaben waren weg — und kein Satz sagte warum.
 *
 * **Je Seite eine eigene Tabelle.** Derselbe Schlüssel meint auf zwei Seiten
 * Verschiedenes: `unvollstaendig` ist auf der Bewertung „keine Zeile
 * ausgefüllt", auf der neuen Stelle „Titel oder Beschreibung fehlt". Ein
 * gemeinsamer Satz wäre auf mindestens einer Seite falsch.
 *
 * **Nie der Schlüssel selbst.** Ein unbekannter Grund fällt auf den
 * allgemeinen Satz zurück; `unbrauchbare_frist` sagt niemandem etwas.
 */
import type { InternSprache } from '../intern.js';

export interface RecruitingRueckmeldungTexte {
  readonly nichtGespeichert: string;
  readonly abgewiesen: string;
  readonly eingabenErneut: string;
  readonly bewertung: Readonly<Record<string, string>>;
  readonly entscheidung: Readonly<Record<string, string>>;
  readonly stelleNeu: Readonly<Record<string, string>>;
  readonly veroeffentlichung: Readonly<Record<string, string>>;
  readonly veroeffentlicht: string;
}

export const RECRUITING_RUECKMELDUNG: Readonly<Record<InternSprache, RecruitingRueckmeldungTexte>> = {
  de: {
    nichtGespeichert: 'Nicht gespeichert.',
    abgewiesen: 'Der Vorgang wurde abgewiesen.',
    eingabenErneut: 'Die Eingaben sind nicht übernommen — bitte erneut eintragen.',
    bewertung: {
      nicht_gefunden: 'Diese Bewerbung gibt es nicht.',
      unvollstaendig:
        'Eine Zeile ist unvollständig: jede Zeile mit Punkten braucht das Kriterium, gegen das '
        + 'geprüft wurde — und mindestens eine Zeile muss ausgefüllt sein.',
      ohne_begruendung:
        'Ein Kriterium hat keine Begründung. Eine Punktzahl ohne Grund ist im AGG-Streit nichts '
        + 'wert — § 22 AGG kehrt die Beweislast um.',
      unbrauchbare_bewertung:
        'Gewicht und Punkte müssen ganze Zahlen sein: das Gewicht zwischen 0 und 100, die Punkte '
        + 'zwischen 0 und 10.',
    },
    entscheidung: {
      nicht_gefunden: 'Diese Bewerbung gibt es nicht.',
      unbrauchbares_ergebnis: 'Eingestellt oder abgelehnt — etwas Drittes gibt es hier nicht.',
      ohne_begruendung: 'Eine Entscheidung ohne Begründung ist im AGG-Streit nichts wert.',
      unvollstaendig: 'Eine Entscheidung ohne Begründung ist im AGG-Streit nichts wert.',
      schon_entschieden:
        'Diese Bewerbung ist bereits entschieden. Eine Entscheidung gibt es je Bewerbung genau '
        + 'einmal.',
      abgewiesen: 'Die Entscheidung wurde nicht geschrieben.',
    },
    stelleNeu: {
      unvollstaendig:
        'Eine Stelle braucht einen Titel und eine Beschreibung. Ein leerer Entwurf sähe in der '
        + 'Liste aus wie eine fertige Anzeige.',
      unbrauchbare_stunden: 'Wochenstunden zwischen 1 und 60, in halben Stunden.',
      unbrauchbare_frist: 'Die Bewerbungsfrist ist kein Tag, den der Kalender kennt.',
      kein_schreibrecht: 'Die Stelle wurde nicht angelegt.',
    },
    veroeffentlichung: {
      nicht_gefunden: 'Diese Stelle gibt es nicht.',
      unbekannt: 'Diese Stelle gibt es nicht.',
      unbekanntes_ziel: 'Dieses Ziel kennt die Plattform nicht.',
      nicht_freigegeben:
        'Ein Entwurf geht nicht hinaus. Die Stelle braucht zuerst eine Freigabe (Invariante 7).',
      geschlossen:
        'Diese Stelle ist geschlossen. Eine zurückgezogene Anzeige geht nicht noch einmal hinaus.',
      falscher_status: 'Diese Anzeige steht bereits auf der Karriereseite.',
      kanal_nicht_verbunden:
        'Diese Börse ist nicht verbunden. Der Versuch ist mit Datum und Grund vermerkt — '
        + 'hinausgegangen ist nichts.',
      veroeffentlichung_fehlgeschlagen:
        'Die Börse hat den Versuch nicht angenommen. Er ist mit Datum und Grund vermerkt.',
    },
    veroeffentlicht: 'Veröffentlicht und vermerkt.',
  },
  en: {
    nichtGespeichert: 'Not saved.',
    abgewiesen: 'The request was refused.',
    eingabenErneut: 'Your entries were not kept — please enter them again.',
    bewertung: {
      nicht_gefunden: 'This application does not exist.',
      unvollstaendig:
        'A row is incomplete: every row with points needs the criterion it was assessed '
        + 'against — and at least one row must be filled in.',
      ohne_begruendung:
        'A criterion has no reason. A score without a reason is worthless in an AGG dispute — '
        + '§ 22 AGG reverses the burden of proof.',
      unbrauchbare_bewertung:
        'Weight and points must be whole numbers: the weight between 0 and 100, the points '
        + 'between 0 and 10.',
    },
    entscheidung: {
      nicht_gefunden: 'This application does not exist.',
      unbrauchbares_ergebnis: 'Hired or rejected — there is no third option here.',
      ohne_begruendung: 'A decision without a reason is worthless in an AGG dispute.',
      unvollstaendig: 'A decision without a reason is worthless in an AGG dispute.',
      schon_entschieden:
        'This application has already been decided. There is exactly one decision per '
        + 'application.',
      abgewiesen: 'The decision was not recorded.',
    },
    stelleNeu: {
      unvollstaendig:
        'A position needs a title and a description. An empty draft would look like a '
        + 'finished advertisement in the list.',
      unbrauchbare_stunden: 'Weekly hours between 1 and 60, in half hours.',
      unbrauchbare_frist: 'The application deadline is not a calendar day.',
      kein_schreibrecht: 'The position was not created.',
    },
    veroeffentlichung: {
      nicht_gefunden: 'This position does not exist.',
      unbekannt: 'This position does not exist.',
      unbekanntes_ziel: 'The platform does not know this destination.',
      nicht_freigegeben:
        'A draft does not go out. The position needs an approval first (invariant 7).',
      geschlossen:
        'This position is closed. A withdrawn advertisement does not go out again.',
      falscher_status: 'This advertisement is already on the careers page.',
      kanal_nicht_verbunden:
        'This job board is not connected. The attempt is recorded with date and reason — '
        + 'nothing went out.',
      veroeffentlichung_fehlgeschlagen:
        'The job board did not accept the attempt. It is recorded with date and reason.',
    },
    veroeffentlicht: 'Published and recorded.',
  },
};
