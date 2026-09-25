/**
 * Die Wörter des Stellenentwurfs durch den Agenten und des Bearbeitens eines
 * Entwurfs — in beiden Sprachen (REC-02, V-222, D-716, D-592).
 *
 * **Nur die neuen Abschnitte.** Die Stellenseiten stehen noch auf der
 * eingefrorenen Ausnahmeliste der Übersetzungswache; was dazukommt, kommt
 * zweisprachig.
 *
 * **Nie der Schlüssel selbst.** Ein unbekannter Grund aus der Adresse fällt
 * auf den allgemeinen Satz zurück (`eigenerEintrag`, D-728).
 */
import type { InternSprache } from '../intern.js';

export interface RecruitingStellenentwurfTexte {
  readonly agentTitel: string;
  readonly agentErklaerung: string;
  readonly agentOhneRecht: string;
  readonly titel: string;
  readonly einsatzort: string;
  readonly beginn: string;
  readonly beginnHinweis: string;
  readonly aufgaben: string;
  readonly aufgabenHinweis: string;
  readonly anforderungen: string;
  readonly anforderungenHinweis: string;
  readonly objekt: string;
  readonly objektKeins: string;
  readonly objektHinweis: string;
  /** `{objekt}`, `{zusagen}`, `{schichten}` werden eingesetzt. */
  readonly objektZeile: string;
  readonly wochenstunden: string;
  readonly frist: string;
  readonly fristHinweis: string;
  readonly agentKnopf: string;
  readonly handTitel: string;
  readonly entworfen: string;
  readonly bearbeitet: string;
  readonly bearbeitenTitel: string;
  readonly bearbeitenErklaerung: string;
  readonly beschreibung: string;
  readonly beschreibungHinweis: string;
  readonly speichern: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
}

export const RECRUITING_STELLENENTWURF_TEXTE:
Readonly<Record<InternSprache, RecruitingStellenentwurfTexte>> = {
  de: {
    agentTitel: 'Vom Agenten entwerfen lassen',
    agentErklaerung:
      'Der Back-office-Agent formuliert aus Ihren Angaben die Beschreibung. Titel, Ort, Beginn '
      + 'und Anforderungen geben Sie an — das Modell setzt keine Zahl und kein Kriterium. '
      + 'Heraus kommt ein Entwurf, den Sie prüfen, bearbeiten und zur Freigabe vorlegen; '
      + 'veröffentlicht wird nichts von selbst.',
    agentOhneRecht: 'Einen Agenten beauftragt, wer dieses Recht hält:',
    titel: 'Titel',
    einsatzort: 'Einsatzort',
    beginn: 'Beginn',
    beginnHinweis: 'Wie in der Anzeige zu lesen — z. B. „ab sofort" oder „ab 01.11.2026".',
    aufgaben: 'Aufgaben — eine je Zeile',
    aufgabenHinweis: 'Stichpunkte; der Agent macht daraus Sätze.',
    anforderungen: 'Anforderungen — eine je Zeile',
    anforderungenHinweis:
      'Schreiben Sie selbst: die Bewertung läuft später gegen diese Zeilen (REC-05). Der Agent '
      + 'übernimmt sie unverändert und erfindet keine dazu.',
    objekt: 'Bedarf aus dem Dienstplan',
    objektKeins: 'Kein Objekt',
    objektHinweis:
      'Wählen Sie ein Objekt, nennt der Entwurf die offenen Zusagen der nächsten vier Wochen — '
      + 'gezählt vom Dienstplan, nicht vom Modell.',
    objektZeile: '{objekt}: {zusagen} offene Zusagen in {schichten} Schichten',
    wochenstunden: 'Wochenstunden',
    frist: 'Bewerbungsfrist',
    fristHinweis: 'Leer heisst: offen, bis die Stelle geschlossen wird.',
    agentKnopf: 'Entwurf erstellen lassen',
    handTitel: 'Von Hand anlegen',
    entworfen:
      'Der Agent hat die Beschreibung entworfen. Lesen und bearbeiten Sie sie, bevor Sie die '
      + 'Anzeige zur Freigabe vorlegen.',
    bearbeitet: 'Der Entwurf ist gespeichert.',
    bearbeitenTitel: 'Entwurf bearbeiten',
    bearbeitenErklaerung:
      'Bearbeitet wird ein Entwurf, an dem keine Freigabe hängt. Wer ihn zuletzt bearbeitet '
      + 'hat, steht im Prüfprotokoll.',
    beschreibung: 'Beschreibung',
    beschreibungHinweis: 'Auf der Karriereseite steht genau dieser Text.',
    speichern: 'Änderungen speichern',
    fehler: {
      falscher_status:
        'Bearbeitet und vorgelegt wird ein Entwurf. Was schon freigegeben oder veröffentlicht '
        + 'ist, trägt eine Freigabe für genau diesen Text.',
      gleichzeitig: 'Jemand anderes war einen Augenblick schneller. Bitte die Seite neu laden.',
      kein_schreibrecht:
        'Die Freigabe wurde nicht angelegt. Fehlt Ihnen das Recht dazu, sagt es Ihnen die '
        + 'Person, die Ihre Rolle vergeben hat.',
      schon_vorgelegt:
        'Diese Anzeige liegt im Freigabe-Posteingang. Bearbeitet wird sie erst wieder, wenn die '
        + 'Freigabe abgelehnt ist.',
      unbekannt: 'Diese Stelle gibt es nicht.',
      unvollstaendig: 'Titel und Beschreibung sind Pflicht.',
      unbrauchbare_stunden: 'Wochenstunden zwischen 1 und 60, in halben Stunden.',
      unbrauchbare_frist: 'Die Bewerbungsfrist ist kein Tag, den der Kalender kennt.',
    },
    fehlerSonst: 'Der Vorgang wurde abgewiesen.',
  },
  en: {
    agentTitel: 'Have the agent draft it',
    agentErklaerung:
      'The back-office agent writes the description from your details. You give the title, '
      + 'location, start and requirements — the model sets no figure and no criterion. The '
      + 'result is a draft that you review, edit and submit for approval; nothing is published '
      + 'on its own.',
    agentOhneRecht: 'An agent is commissioned by whoever holds this permission:',
    titel: 'Title',
    einsatzort: 'Place of work',
    beginn: 'Start',
    beginnHinweis: 'As it should read in the advertisement — e.g. “ab sofort” or “ab 01.11.2026”.',
    aufgaben: 'Duties — one per line',
    aufgabenHinweis: 'Bullet points; the agent turns them into sentences.',
    anforderungen: 'Requirements — one per line',
    anforderungenHinweis:
      'Write these yourself: applications are later assessed against these lines (REC-05). The '
      + 'agent keeps them unchanged and invents none.',
    objekt: 'Demand from the roster',
    objektKeins: 'No site',
    objektHinweis:
      'If you choose a site, the draft names the open confirmations for the next four weeks — '
      + 'counted by the roster, not by the model.',
    objektZeile: '{objekt}: {zusagen} open confirmations in {schichten} shifts',
    wochenstunden: 'Weekly hours',
    frist: 'Application deadline',
    fristHinweis: 'Empty means: open until the position is closed.',
    agentKnopf: 'Create draft',
    handTitel: 'Create by hand',
    entworfen:
      'The agent has drafted the description. Read and edit it before you submit the '
      + 'advertisement for approval.',
    bearbeitet: 'The draft has been saved.',
    bearbeitenTitel: 'Edit draft',
    bearbeitenErklaerung:
      'Only a draft without a pending approval is edited. Whoever edited it last is recorded in '
      + 'the audit log.',
    beschreibung: 'Description',
    beschreibungHinweis: 'The careers page shows exactly this text.',
    speichern: 'Save changes',
    fehler: {
      falscher_status:
        'Only a draft is edited and submitted. What is already approved or published carries '
        + 'an approval for exactly this text.',
      gleichzeitig: 'Someone else was a moment faster. Please reload the page.',
      kein_schreibrecht:
        'The approval was not created. If you lack the permission, the person who assigned your '
        + 'role can tell you.',
      schon_vorgelegt:
        'This advertisement is in the approval inbox. It can be edited again once the approval '
        + 'has been rejected.',
      unbekannt: 'This position does not exist.',
      unvollstaendig: 'Title and description are required.',
      unbrauchbare_stunden: 'Weekly hours between 1 and 60, in half hours.',
      unbrauchbare_frist: 'The application deadline is not a calendar day.',
    },
    fehlerSonst: 'The request was refused.',
  },
};
