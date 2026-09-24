/**
 * Aufgaben und Dokumente an einem Auftrag oder Bau-Projekt — in beiden
 * Sprachen (V-176, OPS-11, D-592).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text**: `Auftrag`,
 * `Mandant` — erklärt in Klammern, nicht ersetzt (siehe `./basis.ts`).
 *
 * Die Zustände einer Aufgabe und die neun Kategorien der Ablage (DOC-01)
 * stehen hier in Worten; ein Blatt zeigt nie den Aufzählungswert.
 *
 * **Zwei Blätter, ein Bauteil**: was sich zwischen Auftrag und Projekt
 * unterscheidet, steht je Art (`AkteArt`) — der Satz „An diesem Auftrag hängt
 * nichts" ist auf dem Projektblatt falsch, weil dort auch die Aufgaben am
 * Projekt selbst zählen.
 */
import type { InternSprache } from '../intern.js';

export type AkteArt = 'auftrag' | 'projekt';

type AufgabeZustand = 'offen' | 'in_arbeit' | 'wartend' | 'erledigt' | 'abgebrochen';
type Kategorie = 'kunde' | 'vertrag' | 'angebot' | 'rechnung' | 'beleg' | 'mitarbeiter'
  | 'projekt' | 'buchhaltung' | 'unternehmen';

export interface VorgangAkteTexte {
  /* ── Aufgaben ──────────────────────────────────────────────────────── */
  readonly aufgabenTitel: string;
  readonly aufgabenErklaerung: Readonly<Record<AkteArt, string>>;
  readonly aufgabenOffen: (n: number) => string;
  readonly aufgabenUeberfaellig: (n: number) => string;
  readonly aufgabenLeer: Readonly<Record<AkteArt, string>>;
  readonly aufgabenKeineOffenen: (geschlossen: number) => string;
  readonly aufgabenWeitere: (n: number) => string;
  readonly aufgabenAlle: Readonly<Record<AkteArt, string>>;
  readonly aufgabeAnlegen: string;
  readonly aufgabenOhneRecht: string;
  readonly ohneFrist: string;
  readonly ueberfaellig: string;
  readonly zustand: Readonly<Record<AufgabeZustand, string>>;

  /* ── Dokumente ─────────────────────────────────────────────────────── */
  readonly dokumenteTitel: string;
  readonly dokumenteErklaerung: Readonly<Record<AkteArt, string>>;
  readonly dokumenteLeer: Readonly<Record<AkteArt, string>>;
  readonly dokumenteWeitere: (n: number) => string;
  readonly dokumentAblegen: string;
  readonly dokumenteOhneRecht: string;
  readonly abgelegtAm: (tag: string) => string;
  readonly kategorie: Readonly<Record<Kategorie, string>>;
  readonly kategorieUnbekannt: string;

  /* ── Das Bau-Projekt ───────────────────────────────────────────────── */
  /**
   * Jedes Projekt hängt an genau einem Auftrag (`projekt.auftrag_id not
   * null`, 0071). `null`: die Sitzung sieht dessen Nummer nicht
   * (`auftrag.lesen` fehlt).
   */
  readonly projektAmAuftrag: (auftragsnummer: string | null) => string;

  /* ── Die Aufgabenliste, gefiltert auf einen Auftrag oder ein Projekt ── */
  readonly filterAuftrag: (titel: string) => string;
  readonly filterProjekt: (titel: string) => string;
  readonly filterAufheben: string;
  readonly zumAuftrag: string;
  readonly zumProjekt: string;
  readonly auftragUnbekannt: string;
  readonly projektUnbekannt: string;

  /* ── Die Ablage ────────────────────────────────────────────────────── */
  readonly feldAuftrag: string;
  readonly feldAuftragHinweis: string;
  readonly keinAuftrag: string;
}

export const VORGANG_AKTE_TEXTE: Readonly<Record<InternSprache, VorgangAkteTexte>> = {
  de: {
    aufgabenTitel: 'Aufgaben',
    aufgabenErklaerung: {
      auftrag: 'Was an diesem Auftrag zu tun ist — offene, nach Frist geordnet (OPS-11).',
      projekt: 'Was an diesem Projekt und an seinem Auftrag zu tun ist — offene, nach Frist '
        + 'geordnet (OPS-11).',
    },
    aufgabenOffen: (n) => (n === 0 ? 'Nichts offen.' : `${String(n)} offen`),
    aufgabenUeberfaellig: (n) => `${String(n)} überfällig`,
    aufgabenLeer: {
      auftrag: 'An diesem Auftrag hängt noch keine Aufgabe.',
      projekt: 'An diesem Projekt und an seinem Auftrag hängt noch keine Aufgabe.',
    },
    aufgabenKeineOffenen: (n) =>
      `Keine offene Aufgabe — ${String(n)} erledigt oder abgebrochen.`,
    aufgabenWeitere: (n) => `und ${String(n)} weitere offene`,
    aufgabenAlle: {
      auftrag: 'Alle Aufgaben dieses Auftrags',
      projekt: 'Alle Aufgaben dieses Projekts',
    },
    aufgabeAnlegen: 'Aufgabe anlegen',
    aufgabenOhneRecht: 'Die Aufgaben sieht, wer dieses Recht hält:',
    ohneFrist: 'ohne Frist',
    ueberfaellig: 'überfällig',
    zustand: {
      offen: 'offen', in_arbeit: 'in Arbeit', wartend: 'wartet',
      erledigt: 'erledigt', abgebrochen: 'abgebrochen',
    },

    dokumenteTitel: 'Dokumente',
    dokumenteErklaerung: {
      auftrag: 'Was an diesem Auftrag abgelegt ist — Vertrag, Leistungsverzeichnis, '
        + 'Protokolle, Schriftverkehr.',
      projekt: 'Was am Auftrag dieses Projekts abgelegt ist — Vertrag, '
        + 'Leistungsverzeichnis, Protokolle, Schriftverkehr.',
    },
    dokumenteLeer: {
      auftrag: 'An diesem Auftrag hängt noch kein Dokument.',
      projekt: 'Am Auftrag dieses Projekts hängt noch kein Dokument.',
    },
    dokumenteWeitere: (n) => `und ${String(n)} weitere in der Ablage`,
    dokumentAblegen: 'Dokument ablegen',
    dokumenteOhneRecht: 'Die Dokumente sieht, wer dieses Recht hält:',
    abgelegtAm: (t) => `abgelegt am ${t}`,
    kategorie: {
      kunde: 'Kunde', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung',
      beleg: 'Beleg', mitarbeiter: 'Mitarbeiter', projekt: 'Projekt',
      buchhaltung: 'Buchhaltung', unternehmen: 'Unternehmen',
    },
    kategorieUnbekannt: 'ohne Kategorie',

    projektAmAuftrag: (nr) => (nr === null
      ? 'Aufgaben und Dokumente dieses Projekts hängen an seinem Auftrag — dazu kommen die '
        + 'Aufgaben am Projekt selbst.'
      : `Aufgaben und Dokumente dieses Projekts hängen an seinem Auftrag ${nr} — dazu `
        + 'kommen die Aufgaben am Projekt selbst.'),

    filterAuftrag: (titel) => `Auftrag: ${titel}`,
    filterProjekt: (titel) => `Projekt: ${titel}`,
    filterAufheben: 'Filter aufheben',
    zumAuftrag: 'Zum Auftrag',
    zumProjekt: 'Zum Projekt',
    auftragUnbekannt:
      'Diesen Auftrag gibt es hier nicht — oder diese Sitzung sieht ihn nicht. Gezeigt werden '
      + 'alle Aufgaben.',
    projektUnbekannt:
      'Dieses Projekt gibt es hier nicht — oder diese Sitzung sieht es nicht. Gezeigt werden '
      + 'alle Aufgaben.',

    feldAuftrag: 'Auftrag (optional)',
    feldAuftragHinweis:
      'Das Dokument erscheint dann auf dem Auftragsblatt — und auf dem Blatt eines '
      + 'Bau-Projekts, das an diesem Auftrag hängt.',
    keinAuftrag: '— kein Auftrag —',
  },
  en: {
    aufgabenTitel: 'Tasks',
    aufgabenErklaerung: {
      auftrag: 'What has to be done on this Auftrag (order) — open ones, by deadline (OPS-11).',
      projekt: 'What has to be done on this project and on its Auftrag (order) — open ones, '
        + 'by deadline (OPS-11).',
    },
    aufgabenOffen: (n) => (n === 0 ? 'Nothing open.' : `${String(n)} open`),
    aufgabenUeberfaellig: (n) => `${String(n)} overdue`,
    aufgabenLeer: {
      auftrag: 'No task is attached to this order yet.',
      projekt: 'No task is attached to this project or its order yet.',
    },
    aufgabenKeineOffenen: (n) => `No open task — ${String(n)} done or cancelled.`,
    aufgabenWeitere: (n) => `and ${String(n)} more open`,
    aufgabenAlle: {
      auftrag: 'All tasks of this order',
      projekt: 'All tasks of this project',
    },
    aufgabeAnlegen: 'Create task',
    aufgabenOhneRecht: 'The tasks are visible to whoever holds this right:',
    ohneFrist: 'no deadline',
    ueberfaellig: 'overdue',
    zustand: {
      offen: 'open', in_arbeit: 'in progress', wartend: 'waiting',
      erledigt: 'done', abgebrochen: 'cancelled',
    },

    dokumenteTitel: 'Documents',
    dokumenteErklaerung: {
      auftrag: 'What is filed on this order — contract, bill of quantities, minutes, '
        + 'correspondence.',
      projekt: 'What is filed on the order of this project — contract, bill of quantities, '
        + 'minutes, correspondence.',
    },
    dokumenteLeer: {
      auftrag: 'No document is attached to this order yet.',
      projekt: 'No document is attached to the order of this project yet.',
    },
    dokumenteWeitere: (n) => `and ${String(n)} more in the document store`,
    dokumentAblegen: 'File a document',
    dokumenteOhneRecht: 'The documents are visible to whoever holds this right:',
    abgelegtAm: (t) => `filed on ${t}`,
    kategorie: {
      kunde: 'Customer', vertrag: 'Contract', angebot: 'Quote', rechnung: 'Invoice',
      beleg: 'Receipt', mitarbeiter: 'Employee', projekt: 'Project',
      buchhaltung: 'Accounting', unternehmen: 'Company',
    },
    kategorieUnbekannt: 'no category',

    projektAmAuftrag: (nr) => (nr === null
      ? 'Tasks and documents of this project are attached to its order — plus the tasks on '
        + 'the project itself.'
      : `Tasks and documents of this project are attached to its order ${nr} — plus the `
        + 'tasks on the project itself.'),

    filterAuftrag: (titel) => `Order: ${titel}`,
    filterProjekt: (titel) => `Project: ${titel}`,
    filterAufheben: 'Clear filter',
    zumAuftrag: 'Open the order',
    zumProjekt: 'Open the project',
    auftragUnbekannt:
      'This order does not exist here — or this session cannot see it. All tasks are shown.',
    projektUnbekannt:
      'This project does not exist here — or this session cannot see it. All tasks are shown.',

    feldAuftrag: 'Order (optional)',
    feldAuftragHinweis:
      'The document then appears on the order sheet — and on the sheet of a construction '
      + 'project attached to this order.',
    keinAuftrag: '— no order —',
  },
};
