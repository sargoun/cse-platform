/**
 * Der Gewerkekatalog des Bautagebuchs — in beiden Sprachen (BAU-07, V-182,
 * D-676, D-592).
 *
 * **`Gewerk`, `Bautagebuch` und `Mannstunden` bleiben im englischen Text
 * deutsch**, wie in `bau.ts`: sie sind die Wörter des Bautagebuchs, das im
 * Streitfall vorgelegt wird, und „trade" oder „man-hours" sind
 * Beschreibungen, keine Namen. Die Übersetzungen, die ein Gewerk selbst trägt
 * (en, ar, tr), sind Daten und stehen hier nicht — das Mitarbeiterportal liest
 * sie aus `gewerk.bezeichnung_i18n`, in der Sprache seines Bildschirms
 * (`listeGewerke` und `leseMannstunden` mit `sprache`, V-185), und fällt ohne
 * Eintrag auf die deutsche Bezeichnung zurück. Das sagt die Pflegeseite zu.
 *
 * **Jede Abweisung hat einen Satz.** Die Route schickt den GRUND als
 * `?fehler=` zurück (D-599); die Seite schlägt ihn nur als eigenen Eintrag
 * nach (D-728) und zeigt nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';
import type { GewerkGrund } from '../../../server/services/bau/gewerk.js';

export interface GewerkTexte {
  readonly modul: string;
  readonly titel: string;
  readonly einleitung: string;
  /** Die offene Frage, die dieser Katalog nicht beantwortet (O-159). */
  readonly offen: string;
  readonly leer: string;
  readonly keinSchreibrecht: string;

  readonly code: string;
  readonly codeHinweis: string;
  readonly bezeichnung: string;
  /**
   * Unter dem Namensfeld, wenn der Name schon an einem abgeschlossenen
   * Bautag steht (D-679): er ist dann fest, und die Seite sagt, was stattdessen
   * geht.
   */
  readonly bezeichnungFest: string;
  readonly uebersetzungen: string;
  readonly uebersetzungenHinweis: string;
  readonly sprache: Readonly<Record<'en' | 'ar' | 'tr', string>>;
  readonly leistungsbereich: string;
  readonly leistungsbereichHinweis: string;
  readonly sortierung: string;
  readonly bestaetigt: string;
  readonly bestaetigtHinweis: string;

  readonly unbestaetigt: string;
  readonly archiviert: string;
  readonly buchungen: (anzahl: number) => string;
  readonly neuTitel: string;
  readonly anlegen: string;
  readonly aendern: string;
  readonly speichern: string;
  readonly archivieren: string;
  readonly archivierenHinweis: string;
  readonly zumBautagebuch: string;

  readonly erfolg: Readonly<Record<string, string>>;
  readonly abgewiesen: string;
  readonly fehler: Readonly<Record<GewerkGrund, string>>;
  readonly fehlerUnbekannt: string;
}

export const GEWERK_TEXTE: Readonly<Record<InternSprache, GewerkTexte>> = {
  de: {
    modul: 'Bau',
    titel: 'Gewerkekatalog',
    einleitung: 'Die Gewerke, nach denen das Bautagebuch die Mannstunden eines Tages '
      + 'führt. Ohne ein Gewerk lässt sich keine Mannstundenzeile anlegen — weder in der '
      + 'Verwaltung noch im Mitarbeiterportal.',
    offen: 'Offene Frage: welche Gewerke führt die Gesellschaft, und folgt die Liste den '
      + 'STLB-Bau-Leistungsbereichen (O-159)? Die Plattform schlägt keines vor. Was hier '
      + 'ohne das Häkchen „bestätigt" steht, trägt im Bautagebuch den Zusatz „unbestätigt".',
    leer: 'Noch kein Gewerk eingetragen.',
    keinSchreibrecht: 'Gewerke trägt ein, wer das Bautagebuch führen darf — dieses Konto '
      + 'hält das Recht dafür nicht.',
    code: 'Code',
    codeHinweis: '1 bis 12 Zeichen, z. B. TRO. Er steht vor jeder Mannstundenzeile und '
      + 'lässt sich später nicht ändern.',
    bezeichnung: 'Bezeichnung',
    bezeichnungFest: 'Dieser Name steht schon an einem abgeschlossenen Bautag und bleibt '
      + 'deshalb, wie er ist — sonst zeigte der Tag einen anderen Namen als beim Abschluss. '
      + 'Ein neuer Name heißt: archivieren und neu eintragen; der Code wird dabei frei.',
    uebersetzungen: 'Bezeichnung im Mitarbeiterportal',
    uebersetzungenHinweis: 'Freiwillig. Ohne Übersetzung sieht die Kraft die deutsche '
      + 'Bezeichnung.',
    sprache: { en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch' },
    leistungsbereich: 'Leistungsbereich (STLB-Bau)',
    leistungsbereichHinweis: 'Freiwillig, z. B. 039 — ein Anzeigewert, keine Prüfung.',
    sortierung: 'Reihenfolge',
    bestaetigt: 'Bestätigt',
    bestaetigtHinweis: 'Nur ankreuzen, wenn die Gesellschaft dieses Gewerk so festgelegt hat.',
    unbestaetigt: 'unbestätigt',
    archiviert: 'archiviert',
    buchungen: (anzahl) => (anzahl === 1 ? '1 Mannstundenzeile' : `${String(anzahl)} Mannstundenzeilen`),
    neuTitel: 'Gewerk eintragen',
    anlegen: 'Eintragen',
    aendern: 'Ändern',
    speichern: 'Speichern',
    archivieren: 'Archivieren',
    archivierenHinweis: 'Archiviert heißt: für neue Mannstunden nicht mehr wählbar. '
      + 'Gebuchte Zeilen bleiben lesbar; gelöscht wird nie.',
    zumBautagebuch: 'Zum Bautagebuch',
    erfolg: {
      angelegt: 'Das Gewerk ist eingetragen.',
      geaendert: 'Die Änderung ist gespeichert.',
      archiviert: 'Das Gewerk ist archiviert. Gebuchte Mannstunden bleiben lesbar.',
    },
    abgewiesen: 'Nicht gespeichert.',
    fehler: {
      unvollstaendig: 'Ein Gewerk braucht eine Bezeichnung; die Reihenfolge ist eine ganze '
        + 'Zahl von 0 bis 999.',
      code_form: 'Der Code hat 1 bis 12 Zeichen: Buchstaben, Ziffern, Binde- oder Unterstrich.',
      doppelt: 'Diesen Code führt schon ein lebendes Gewerk dieser Gesellschaft.',
      nicht_gefunden: 'Dieses Gewerk gibt es hier nicht (oder es ist archiviert).',
      schon_archiviert: 'Dieses Gewerk ist schon archiviert.',
      name_fest: 'Der Name steht schon an einem abgeschlossenen Bautag — umbenannt, zeigte '
        + 'dieser Tag einen anderen Namen als beim Abschluss. Archivieren Sie das Gewerk und '
        + 'tragen Sie es unter dem neuen Namen neu ein.',
    },
    fehlerUnbekannt: 'Einen Grund dafür nennt diese Seite nicht — bitte die Angaben prüfen '
      + 'und erneut speichern.',
  },
  en: {
    modul: 'Construction',
    titel: 'Gewerk catalogue',
    einleitung: 'The Gewerke by which the Bautagebuch records a day\'s Mannstunden. Without '
      + 'a Gewerk no Mannstunden line can be created — neither in administration nor in '
      + 'the employee portal.',
    offen: 'Open question: which Gewerke does the company keep, and does the list follow '
      + 'the STLB-Bau work sections (O-159)? The platform suggests none. Anything entered '
      + 'without the "confirmed" tick carries the note "unconfirmed" in the Bautagebuch.',
    leer: 'No Gewerk entered yet.',
    keinSchreibrecht: 'Gewerke are entered by whoever may keep the Bautagebuch — this '
      + 'account does not hold that right.',
    code: 'Code',
    codeHinweis: '1 to 12 characters, e.g. TRO. It precedes every Mannstunden line and '
      + 'cannot be changed later.',
    bezeichnung: 'Name',
    bezeichnungFest: 'This name already appears on a closed Bautag and therefore stays as it '
      + 'is — otherwise that day would show a different name than when it was closed. A new '
      + 'name means: archive and enter anew; the code becomes free again.',
    uebersetzungen: 'Name in the employee portal',
    uebersetzungenHinweis: 'Optional. Without a translation the worker sees the German name.',
    sprache: { en: 'English', ar: 'Arabic', tr: 'Turkish' },
    leistungsbereich: 'Work section (STLB-Bau)',
    leistungsbereichHinweis: 'Optional, e.g. 039 — shown, not checked.',
    sortierung: 'Order',
    bestaetigt: 'Confirmed',
    bestaetigtHinweis: 'Tick only if the company has defined this Gewerk this way.',
    unbestaetigt: 'unconfirmed',
    archiviert: 'archived',
    buchungen: (anzahl) => (anzahl === 1 ? '1 Mannstunden line' : `${String(anzahl)} Mannstunden lines`),
    neuTitel: 'Enter a Gewerk',
    anlegen: 'Enter',
    aendern: 'Change',
    speichern: 'Save',
    archivieren: 'Archive',
    archivierenHinweis: 'Archived means: no longer selectable for new Mannstunden. Booked '
      + 'lines stay readable; nothing is ever deleted.',
    zumBautagebuch: 'To the Bautagebuch',
    erfolg: {
      angelegt: 'The Gewerk has been entered.',
      geaendert: 'The change has been saved.',
      archiviert: 'The Gewerk has been archived. Booked Mannstunden stay readable.',
    },
    abgewiesen: 'Not saved.',
    fehler: {
      unvollstaendig: 'A Gewerk needs a name; the order is a whole number from 0 to 999.',
      code_form: 'The code has 1 to 12 characters: letters, digits, hyphen or underscore.',
      doppelt: 'A living Gewerk of this company already uses this code.',
      nicht_gefunden: 'This Gewerk does not exist here (or it is archived).',
      schon_archiviert: 'This Gewerk is already archived.',
      name_fest: 'The name already appears on a closed Bautag — renamed, that day would show '
        + 'a different name than when it was closed. Archive the Gewerk and enter it anew '
        + 'under the new name.',
    },
    fehlerUnbekannt: 'This page has no reason on record for it — please check the details and '
      + 'save again.',
  },
};
