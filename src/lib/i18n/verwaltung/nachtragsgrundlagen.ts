/**
 * Die Anspruchsgrundlagen der Nachträge — die Pflegeseite in beiden Sprachen
 * (BAU-04, V-384, O-23, D-800, D-842, D-592).
 *
 * **`Nachtrag`, `VOB/B` und die Fundstellen bleiben im englischen Text
 * deutsch**, wie in `bau.ts` und `gewerke.ts`: „§ 2 Abs. 6 VOB/B" ist eine
 * Fundstelle, keine Beschreibung, und die Bezeichnungen der Katalogzeilen sind
 * Daten aus dem Gesetzestext, die hier nicht übersetzt werden.
 *
 * **Jede Abweisung hat einen Satz.** Die Route schickt den GRUND als
 * `?fehler=` zurück (D-599); die Seite schlägt ihn nur als eigenen Eintrag
 * nach (D-728) und zeigt nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';
import type { NachtragGrundlageGrund } from '../../../server/services/bau/nachtrag-grundlage.js';

export interface NachtragsgrundlagenTexte {
  readonly modul: string;
  readonly titel: string;
  readonly einleitung: string;
  /** Die Voreinstellung (O-23) — und was „unbestätigt" heisst. */
  readonly voreinstellung: string;
  readonly leer: string;
  readonly keinSchreibrechtVor: string;
  readonly keinSchreibrechtNach: string;
  readonly unbestaetigt: string;
  readonly bestaetigt: string;
  readonly archiviert: string;
  readonly ankuendigung: string;
  readonly nachtraege: (anzahl: number) => string;
  readonly bestaetigen: string;
  readonly archivieren: string;
  readonly archivierenHinweis: (anzahl: number) => string;
  readonly wiederaufnehmen: string;
  readonly zuDenNachtraegen: string;
  readonly erfolg: Readonly<Record<string, string>>;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<NachtragGrundlageGrund, string>>;
  readonly fehlerUnbekannt: string;
}

export const NACHTRAGSGRUNDLAGEN_TEXTE: Readonly<Record<InternSprache, NachtragsgrundlagenTexte>> = {
  de: {
    modul: 'Bau',
    titel: 'Anspruchsgrundlagen',
    einleitung: 'Die Grundlagen, unter denen ein Nachtrag angemeldet wird. Ein Nachtrag wählt '
      + 'genau eine davon — nie Freitext, nie vorbelegt. Archiviert steht eine Grundlage nicht '
      + 'mehr zur Wahl; Nachträge, die schon auf ihr stehen, behalten sie.',
    voreinstellung: 'Voreinstellung (O-23): die vollständige Liste aus dem Gesetzestext — '
      + '§ 1 Abs. 3 und 4, § 2 Abs. 3 bis 8 VOB/B und § 650b BGB. Unbestätigt ist nicht der '
      + 'Text, sondern ob diese Gesellschaft die Grundlage verwendet: bestätigen Sie, was gilt, '
      + 'und archivieren Sie, was nicht gilt. Was unbestätigt bleibt, trägt im Nachtrag den '
      + 'Zusatz „unbestätigter Wert".',
    leer: 'Für diese Gesellschaft ist keine Grundlage hinterlegt.',
    keinSchreibrechtVor: 'Bestätigen und archivieren kann, wer',
    keinSchreibrechtNach: 'hält.',
    unbestaetigt: 'unbestätigt',
    bestaetigt: 'bestätigt',
    archiviert: 'archiviert',
    ankuendigung: 'Ankündigung vor Ausführungsbeginn erforderlich',
    nachtraege: (n) => (n === 0
      ? 'kein Nachtrag auf dieser Grundlage'
      : n === 1 ? '1 Nachtrag auf dieser Grundlage'
        : `${String(n)} Nachträge auf dieser Grundlage`),
    bestaetigen: 'Bestätigen',
    archivieren: 'Archivieren',
    archivierenHinweis: (n) => (n === 0
      ? 'Archiviert steht sie in keinem neuen Nachtrag mehr zur Wahl.'
      : `Archiviert steht sie in keinem neuen Nachtrag mehr zur Wahl; die ${String(n)} `
        + 'Nachträge auf ihr behalten sie.'),
    wiederaufnehmen: 'Wieder aufnehmen',
    zuDenNachtraegen: 'Alle Nachträge',
    erfolg: {
      bestaetigt: 'Die Grundlage ist bestätigt.',
      archiviert: 'Die Grundlage ist archiviert.',
      wiederaufgenommen: 'Die Grundlage steht wieder zur Wahl.',
    },
    abgewiesen: 'Nichts wurde geändert.',
    fehler: {
      nicht_gefunden: 'Diese Grundlage gibt es in dieser Gesellschaft nicht.',
      schon_bestaetigt: 'Diese Grundlage ist schon bestätigt.',
      archiviert: 'Diese Grundlage ist archiviert — erst wieder aufnehmen, dann bestätigen.',
      schon_archiviert: 'Diese Grundlage ist schon archiviert.',
      nicht_archiviert: 'Diese Grundlage ist nicht archiviert.',
      schluessel_vergeben: 'Eine lebende Grundlage trägt denselben Schlüssel — diese bleibt '
        + 'archiviert.',
    },
    fehlerUnbekannt: 'Der Vorgang wurde abgewiesen.',
  },
  en: {
    modul: 'Bau',
    titel: 'Claim bases',
    einleitung: 'The legal bases under which a Nachtrag (change order) is announced. A '
      + 'Nachtrag chooses exactly one — never free text, never preselected. An archived basis '
      + 'is no longer offered; Nachträge that already stand on it keep it.',
    voreinstellung: 'Default (O-23): the complete list from the statute — § 1 Abs. 3 and 4, '
      + '§ 2 Abs. 3 to 8 VOB/B and § 650b BGB. What is unconfirmed is not the text but whether '
      + 'this company uses the basis: confirm what applies and archive what does not. Whatever '
      + 'stays unconfirmed is marked "unconfirmed value" on the Nachtrag.',
    leer: 'No basis is on file for this company.',
    keinSchreibrechtVor: 'Whoever holds',
    keinSchreibrechtNach: 'may confirm and archive.',
    unbestaetigt: 'unconfirmed',
    bestaetigt: 'confirmed',
    archiviert: 'archived',
    ankuendigung: 'announcement required before work starts',
    nachtraege: (n) => (n === 0
      ? 'no Nachtrag on this basis'
      : n === 1 ? '1 Nachtrag on this basis' : `${String(n)} Nachträge on this basis`),
    bestaetigen: 'Confirm',
    archivieren: 'Archive',
    archivierenHinweis: (n) => (n === 0
      ? 'Once archived, it is no longer offered for a new Nachtrag.'
      : `Once archived, it is no longer offered for a new Nachtrag; the ${String(n)} `
        + 'Nachträge on it keep it.'),
    wiederaufnehmen: 'Restore',
    zuDenNachtraegen: 'All Nachträge',
    erfolg: {
      bestaetigt: 'The basis is confirmed.',
      archiviert: 'The basis is archived.',
      wiederaufgenommen: 'The basis is offered again.',
    },
    abgewiesen: 'Nothing was changed.',
    fehler: {
      nicht_gefunden: 'This basis does not exist in this company.',
      schon_bestaetigt: 'This basis is already confirmed.',
      archiviert: 'This basis is archived — restore it first, then confirm it.',
      schon_archiviert: 'This basis is already archived.',
      nicht_archiviert: 'This basis is not archived.',
      schluessel_vergeben: 'A live basis carries the same key — this one stays archived.',
    },
    fehlerUnbekannt: 'The action was refused.',
  },
};
