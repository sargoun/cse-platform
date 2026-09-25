/**
 * Verlangte Nachweise eines Postens oder einer Veranstaltung — in beiden
 * Sprachen (V-179, SEC-01, SEC-04, SEC-08, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text:** `Posten`,
 * `Objekt`, `Veranstaltung`, `Bewacherregister` und „§ 34a GewO" tragen die
 * Bedeutung aus Gewerberecht und Vertrag; erklärt wird daneben, ersetzt wird
 * nicht.
 *
 * **Jede Abweisung hat einen Satz.** Die Route schickt den GRUND als
 * `?fehler=` zurück (D-599); die Seite schlägt ihn hier nach
 * (`eigenerEintrag`, D-728) und zeigt nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';
import type {
  AnforderungBereich, AnforderungGrund,
} from '../../../server/services/security/anforderung.js';

export interface AnforderungTexte {
  readonly titel: string;
  readonly leer: string;
  readonly sperre: string;
  readonly warnung: string;
  readonly jede: string;
  readonly mindestens: (n: number) => string;
  readonly register: string;
  readonly unbestaetigt: string;
  readonly abDatum: (datum: string) => string;
  readonly bereich: Readonly<Record<AnforderungBereich, string>>;
  readonly archivieren: string;

  readonly neuTitel: string;
  readonly neuErklaerung: string;
  readonly qualifikation: string;
  readonly qualifikationWaehlen: string;
  readonly keineQualifikation: string;
  readonly geltungsbereich: string;
  readonly bereichWahl: Readonly<Record<AnforderungBereich, string>>;
  readonly art: string;
  readonly artSperre: string;
  readonly artWarnung: string;
  readonly wer: string;
  readonly werJede: string;
  readonly werMindestens: string;
  readonly mindestanzahl: string;
  readonly registerFrage: string;
  readonly gueltigAb: string;
  readonly rechtsgrundlage: string;
  readonly rechtsgrundlageBeispiel: string;
  readonly bestaetigt: string;
  readonly bestaetigtErklaerung: string;
  readonly anlegen: string;
  readonly nachzug: string;
  readonly keinSchreibrecht: string;

  readonly angelegt: string;
  readonly archiviert: string;
  readonly fehler: Readonly<Record<AnforderungGrund, string>>;
  readonly fehlerUnbekannt: string;
}

export const ANFORDERUNG_TEXTE: Readonly<Record<InternSprache, AnforderungTexte>> = {
  de: {
    titel: 'Verlangte Nachweise',
    leer: 'Für diesen Einsatzort ist keine Qualifikation hinterlegt — auch keine '
      + 'mandantenweite. Eine Einteilung wird dann als ungeprüft aufgezeichnet, nicht '
      + 'als bestanden (§9.5).',
    sperre: 'Sperre',
    warnung: 'Warnung',
    jede: 'jede eingesetzte Person',
    mindestens: (n) => (n === 1 ? 'mindestens eine Person' : `mindestens ${String(n)} Personen`),
    register: 'zusätzlich Eintragung im Bewacherregister',
    unbestaetigt: 'Anforderung unbestätigt (O-342)',
    abDatum: (datum) => `gilt ab ${datum}`,
    bereich: {
      posten: 'dieser Posten',
      veranstaltung: 'diese Veranstaltung',
      objekt: 'das ganze Objekt',
      mandant: 'die ganze Gesellschaft',
    },
    archivieren: 'Archivieren',

    neuTitel: 'Nachweis verlangen',
    neuErklaerung: 'Eine Sperre lässt keine Einteilung zu, bei der der Nachweis am '
      + 'Schichttag fehlt oder abgelaufen ist (SEC-04). Schichten, die schon im Plan '
      + 'stehen und noch nicht begonnen haben, werden sofort neu bewertet; begonnene '
      + 'bleiben bei dem, was damals verlangt war.',
    qualifikation: 'Qualifikation',
    qualifikationWaehlen: '— bitte wählen —',
    keineQualifikation: 'Der Qualifikationskatalog ist leer. Qualifikationen pflegt die '
      + 'Verwaltung unter Stammdaten → Qualifikationen.',
    geltungsbereich: 'Gilt für',
    bereichWahl: {
      posten: 'nur diesen Posten',
      veranstaltung: 'nur diese Veranstaltung',
      objekt: 'jede Schicht an diesem Objekt',
      mandant: 'jede Schicht dieser Gesellschaft',
    },
    art: 'Wirkung',
    artSperre: 'Sperre — ohne Nachweis keine Einteilung',
    artWarnung: 'Warnung — Einteilung möglich, Hinweis im Plan',
    wer: 'Wer muss ihn haben?',
    werJede: 'jede eingesetzte Person',
    werMindestens: 'mindestens so viele Personen (nur als Warnung)',
    mindestanzahl: 'Anzahl',
    registerFrage: 'Zusätzlich eine gültige Eintragung im Bewacherregister verlangen '
      + '(§ 34a Abs. 1a GewO)',
    gueltigAb: 'Gilt ab',
    rechtsgrundlage: 'Rechtsgrundlage (Anzeigetext)',
    rechtsgrundlageBeispiel: '§ 34a GewO',
    bestaetigt: 'Aus Vertrag oder Dienstanweisung bestätigt',
    bestaetigtErklaerung: 'Ohne dieses Häkchen steht die Anforderung als unbestätigt '
      + 'im Plan — solange offen ist, welche Nachweise der Posten verlangt (O-342).',
    anlegen: 'Nachweis verlangen',
    nachzug: 'Welche Qualifikation ein Posten verlangt, entscheidet die Gesellschaft '
      + '(O-342) — hier wird eingetragen, nichts vorgeschlagen.',
    keinSchreibrecht: 'Eintragen darf, wer die Sicherheit bearbeiten darf.',

    angelegt: 'Die Anforderung gilt ab sofort — künftige Schichten sind neu bewertet.',
    archiviert: 'Die Anforderung ist archiviert. Begonnene Schichten behalten sie in '
      + 'ihrem Stand; künftige verlangen sie nicht mehr.',
    fehler: {
      unvollstaendig: 'Bitte Qualifikation, Wirkung und Geltungsbereich angeben; die '
        + 'Anzahl ist eine ganze Zahl von 1 bis 99.',
      nicht_gefunden: 'Diesen Eintrag gibt es hier nicht.',
      qualifikation_unbekannt: 'Diese Qualifikation steht nicht (mehr) im Katalog.',
      kein_objekt: 'Diese Veranstaltung hängt an keinem Objekt — tragen Sie die '
        + 'Anforderung für die Veranstaltung selbst ein.',
      bereich_passt_nicht: 'Dieser Geltungsbereich passt nicht zu dieser Seite.',
      sperre_nur_jeder: 'Eine Sperre gilt heute für jede eingesetzte Person. „Mindestens '
        + 'eine Person" lässt sich nur als Warnung eintragen.',
      doppelt: 'Diese Qualifikation wird für diesen Bereich schon verlangt. Zum Ändern '
        + 'die bestehende archivieren und neu eintragen.',
      schon_archiviert: 'Diese Anforderung ist schon archiviert.',
    },
    fehlerUnbekannt: 'Die Anforderung wurde nicht gespeichert.',
  },
  en: {
    titel: 'Required credentials',
    leer: 'No qualification is required for this deployment site — not even '
      + 'company-wide. An assignment is then recorded as unchecked, not as passed '
      + '(§9.5).',
    sperre: 'Block',
    warnung: 'Warning',
    jede: 'every deployed person',
    mindestens: (n) => (n === 1 ? 'at least one person' : `at least ${String(n)} persons`),
    register: 'plus an entry in the Bewacherregister',
    unbestaetigt: 'requirement unconfirmed (O-342)',
    abDatum: (datum) => `applies from ${datum}`,
    bereich: {
      posten: 'this Posten',
      veranstaltung: 'this Veranstaltung',
      objekt: 'the whole Objekt',
      mandant: 'the whole company',
    },
    archivieren: 'Archive',

    neuTitel: 'Require a credential',
    neuErklaerung: 'A block rejects any assignment where the credential is missing or '
      + 'expired on the shift day (SEC-04). Shifts already in the plan that have not '
      + 'started are re-assessed immediately; started shifts keep what was required '
      + 'then.',
    qualifikation: 'Qualification',
    qualifikationWaehlen: '— please choose —',
    keineQualifikation: 'The qualification catalogue is empty. Administration maintains '
      + 'it under master data → qualifications.',
    geltungsbereich: 'Applies to',
    bereichWahl: {
      posten: 'this Posten only',
      veranstaltung: 'this Veranstaltung only',
      objekt: 'every shift at this Objekt',
      mandant: 'every shift of this company',
    },
    art: 'Effect',
    artSperre: 'Block — no assignment without the credential',
    artWarnung: 'Warning — assignment possible, flagged in the plan',
    wer: 'Who must hold it?',
    werJede: 'every deployed person',
    werMindestens: 'at least this many persons (warning only)',
    mindestanzahl: 'Number',
    registerFrage: 'Also require a valid entry in the Bewacherregister '
      + '(§ 34a (1a) GewO)',
    gueltigAb: 'Applies from',
    rechtsgrundlage: 'Legal basis (display text)',
    rechtsgrundlageBeispiel: '§ 34a GewO',
    bestaetigt: 'Confirmed by contract or Dienstanweisung',
    bestaetigtErklaerung: 'Without this tick the requirement is shown as unconfirmed '
      + 'in the plan — as long as it is open which credentials the Posten requires '
      + '(O-342).',
    anlegen: 'Require credential',
    nachzug: 'Which qualification a Posten requires is the company\'s decision (O-342) '
      + '— this form records it and suggests nothing.',
    keinSchreibrecht: 'Recording requires the right to edit security.',

    angelegt: 'The requirement applies from now on — future shifts have been '
      + 're-assessed.',
    archiviert: 'The requirement is archived. Started shifts keep it in their record; '
      + 'future shifts no longer require it.',
    fehler: {
      unvollstaendig: 'Please state qualification, effect and scope; the number is a '
        + 'whole number from 1 to 99.',
      nicht_gefunden: 'This entry does not exist here.',
      qualifikation_unbekannt: 'This qualification is not (or no longer) in the catalogue.',
      kein_objekt: 'This Veranstaltung has no Objekt — record the requirement for the '
        + 'Veranstaltung itself.',
      bereich_passt_nicht: 'This scope does not fit this page.',
      sperre_nur_jeder: 'A block currently applies to every deployed person. "At least '
        + 'one person" can only be recorded as a warning.',
      doppelt: 'This qualification is already required for this scope. To change it, '
        + 'archive the existing one and record it again.',
      schon_archiviert: 'This requirement is already archived.',
    },
    fehlerUnbekannt: 'The requirement was not saved.',
  },
};
