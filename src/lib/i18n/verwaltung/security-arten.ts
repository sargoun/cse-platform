/**
 * Die Wörter des Artenkatalogs der Sicherheit — Posten- und Schlüsselarten,
 * ihre Voreinstellung und ihre Pflege — in beiden Sprachen (O-148, D-783,
 * D-82, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** „Posten" ist
 * die zu besetzende Position an einem Objekt (SEC-01), „Postenart" und
 * „Schlüsselart" sind Katalogzeilen dieser Gesellschaft; erklärt wird in
 * Klammern, ersetzt wird nicht. „Voreinstellung" ist der Begriff der Weisung
 * (D-778): ein Wert, der gilt, bis der Betrieb ihn bestätigt oder ändert —
 * im Englischen „default", und das Wort steht daneben.
 */
import type { InternSprache } from '../intern.js';
import type { ArtSprache, ArtTabelle } from '../../../server/services/security/arten.js';

/** Was die Route als `?arten=` zurückgibt — ein Ergebnis oder ein Grund, nie Quelltext. */
export const ARTEN_MELDUNGEN = [
  'voreinstellung', 'voreinstellung_vorhanden', 'bestaetigt', 'archiviert', 'angelegt',
  'bezeichnung_fehlt', 'bezeichnung_zu_lang', 'uebersetzung_zu_lang', 'doppelt', 'nicht_gefunden',
] as const;
export type ArtenMeldung = (typeof ARTEN_MELDUNGEN)[number];

export interface ArtenKatalogTexte {
  readonly titel: string;
  readonly einzahl: string;
  readonly erklaerung: string;
}

export interface ArtenTexte {
  readonly katalog: Readonly<Record<ArtTabelle, ArtenKatalogTexte>>;
  /** Was eine Zeile der Voreinstellung ist und was Archivieren heisst. */
  readonly einleitung: string;
  /** Der leere Katalog: Satz, Liste der Voreinstellung, dann ein Punkt. */
  readonly keine: (einzahl: string) => string;
  readonly uebernehmenHinweis: string;
  readonly uebernehmenOhneRecht: string;
  readonly uebernehmen: string;
  readonly unbestaetigt: string;
  readonly bestaetigtWort: string;
  readonly bestaetigen: string;
  readonly archivieren: string;
  readonly ergaenzen: (einzahl: string) => string;
  readonly anlegen: (einzahl: string) => string;
  readonly bezeichnung: string;
  readonly uebersetzungFeld: (sprache: string) => string;
  readonly sprache: Readonly<Record<ArtSprache, string>>;
  readonly eigeneArt: string;
  readonly meldung: Readonly<Record<ArtenMeldung, string>>;
  /** Der Rückweg auf Posten › Neu — dort steht kein Katalogblock, also der Weg dahin. */
  readonly neuRueckweg: Readonly<Record<'voreinstellung' | 'voreinstellung_vorhanden', string>>;
  /** Auf Posten › Neu, solange der Katalog leer ist: die Voreinstellung und wo die Pflege steht. */
  readonly neuLeer: (liste: string) => string;
}

export const ARTEN_TEXTE: Readonly<Record<InternSprache, ArtenTexte>> = {
  de: {
    katalog: {
      postenart: {
        titel: 'Postenarten',
        einzahl: 'Postenart',
        erklaerung: 'Die Postenart ordnet einen Posten ein — Objektschutz, Empfang, Streife — und steht auf Plan und Postenblatt.',
      },
      schluesselart: {
        titel: 'Schlüsselarten',
        einzahl: 'Schlüsselart',
        erklaerung: 'Die Schlüsselart sagt, was ausgegeben wird — mechanisch, General-, Gruppenschlüssel, Transponder, Chipkarte — und steht auf der Quittung.',
      },
    },
    einleitung: 'Eine Zeile der Voreinstellung (O-148, D-783) gilt als unbestätigt, bis jemand sie bestätigt oder archiviert; eine selbst angelegte Art gilt als bestätigt. Archiviert wird, nicht gelöscht — was auf eine Art zeigt, bleibt lesbar.',
    keine: (einzahl) => `Keine ${einzahl} hinterlegt. Voreinstellung (O-148):`,
    uebernehmenHinweis: 'Übernehmen Sie sie mit einem Klick und bestätigen oder archivieren Sie danach, was die Gesellschaft nicht führt.',
    uebernehmenOhneRecht: 'Übernehmen kann sie, wer das Schreibrecht des Moduls hält.',
    uebernehmen: 'Voreinstellung übernehmen',
    unbestaetigt: 'unbestätigt (Voreinstellung, O-148)',
    bestaetigtWort: 'bestätigt',
    bestaetigen: 'Bestätigen',
    archivieren: 'Archivieren',
    ergaenzen: (einzahl) => `${einzahl} ergänzen`,
    anlegen: (einzahl) => `${einzahl} anlegen`,
    bezeichnung: 'Bezeichnung',
    uebersetzungFeld: (sprache) => `${sprache} (Mitarbeiterportal, freiwillig)`,
    sprache: { en: 'Englisch', ar: 'Arabisch', tr: 'Türkisch' },
    eigeneArt: 'Eine eigene Art gilt als Entscheidung der Gesellschaft und trägt keinen Voreinstellungsvermerk. Der innere Schlüssel entsteht aus der Bezeichnung.',
    meldung: {
      voreinstellung: 'Die Arten der Voreinstellung sind angelegt — unbestätigt, bis Sie sie bestätigen oder archivieren.',
      voreinstellung_vorhanden: 'Nichts angelegt: jede Art der Voreinstellung steht schon im Katalog oder wurde archiviert.',
      bestaetigt: 'Die Art ist bestätigt — sie gilt jetzt als Entscheidung der Gesellschaft.',
      archiviert: 'Die Art ist archiviert. Was auf sie zeigt, bleibt lesbar; neu gewählt wird sie nicht mehr.',
      angelegt: 'Die Art ist angelegt und gilt als bestätigt.',
      bezeichnung_fehlt: 'Nichts angelegt: eine Art braucht eine Bezeichnung mit mindestens einem Buchstaben oder einer Ziffer.',
      bezeichnung_zu_lang: 'Nichts angelegt: die Bezeichnung hat höchstens 120 Zeichen.',
      uebersetzung_zu_lang: 'Nichts angelegt: eine Übersetzung hat höchstens 120 Zeichen.',
      doppelt: 'Nichts angelegt: eine Art mit dieser Bezeichnung führt der Katalog schon.',
      nicht_gefunden: 'Nichts geändert: diese Art gibt es in diesem Katalog nicht (mehr) — die Seite war vielleicht veraltet.',
    },
    neuRueckweg: {
      voreinstellung: 'Die Postenarten der Voreinstellung sind angelegt — unbestätigt (O-148). Bestätigen oder archivieren Sie sie auf der Postenliste.',
      voreinstellung_vorhanden: 'Nichts angelegt: jede Art der Voreinstellung steht schon im Katalog oder wurde archiviert. Eine eigene Art ergänzen Sie auf der Postenliste.',
    },
    neuLeer: (liste) => `Keine Arten hinterlegt — der Posten wird ohne Art angelegt. Voreinstellung (O-148): ${liste}; bestätigen, ergänzen und archivieren können Sie sie auf der Postenliste.`,
  },
  en: {
    katalog: {
      postenart: {
        titel: 'Postenarten (post types)',
        einzahl: 'Postenart',
        erklaerung: 'The Postenart classifies a Posten (guard post) — static guarding, reception, patrol — and appears on the roster and the post sheet.',
      },
      schluesselart: {
        titel: 'Schlüsselarten (key types)',
        einzahl: 'Schlüsselart',
        erklaerung: 'The Schlüsselart says what is handed out — mechanical, master, group key, transponder, chip card — and appears on the receipt.',
      },
    },
    einleitung: 'A row from the Voreinstellung (default, O-148, D-783) counts as unconfirmed until someone confirms or archives it; a type you add yourself counts as confirmed. Rows are archived, never deleted — whatever points at a type stays readable.',
    keine: (einzahl) => `No ${einzahl} on file. Voreinstellung (default, O-148):`,
    uebernehmenHinweis: 'Adopt them with one click, then confirm or archive whatever this company does not use.',
    uebernehmenOhneRecht: 'Adopting them requires the write right of this module.',
    uebernehmen: 'Adopt the defaults',
    unbestaetigt: 'unconfirmed (Voreinstellung, O-148)',
    bestaetigtWort: 'confirmed',
    bestaetigen: 'Confirm',
    archivieren: 'Archive',
    ergaenzen: (einzahl) => `Add a ${einzahl}`,
    anlegen: (einzahl) => `Create ${einzahl}`,
    bezeichnung: 'Name (German)',
    uebersetzungFeld: (sprache) => `${sprache} (worker portal, optional)`,
    sprache: { en: 'English', ar: 'Arabic', tr: 'Turkish' },
    eigeneArt: 'A type you add is this company’s own decision and carries no default marker. The internal key is derived from the name.',
    meldung: {
      voreinstellung: 'The default types have been created — unconfirmed until you confirm or archive them.',
      voreinstellung_vorhanden: 'Nothing created: every default type is already in the catalogue or has been archived.',
      bestaetigt: 'The type is confirmed — it now counts as this company’s decision.',
      archiviert: 'The type is archived. Whatever points at it stays readable; it can no longer be chosen.',
      angelegt: 'The type has been created and counts as confirmed.',
      bezeichnung_fehlt: 'Nothing created: a type needs a name with at least one letter or digit.',
      bezeichnung_zu_lang: 'Nothing created: the name may have at most 120 characters.',
      uebersetzung_zu_lang: 'Nothing created: a translation may have at most 120 characters.',
      doppelt: 'Nothing created: the catalogue already has a type with this name.',
      nicht_gefunden: 'Nothing changed: this type is not (or no longer) in this catalogue — the page may have been stale.',
    },
    neuRueckweg: {
      voreinstellung: 'The default Postenarten have been created — unconfirmed (O-148). Confirm or archive them on the Posten list.',
      voreinstellung_vorhanden: 'Nothing created: every default type is already in the catalogue or has been archived. Add your own type on the Posten list.',
    },
    neuLeer: (liste) => `No types on file — the Posten is created without a type. Voreinstellung (default, O-148): ${liste}; confirm, add and archive them on the Posten list.`,
  },
};
