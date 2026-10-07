/**
 * Die Wörter von Einstellungen › Rechnungen — in beiden Sprachen (V-373,
 * O-933, D-836).
 *
 * Die zwei Regeln heißen hier, was sie für den Beleg bedeuten, nicht wie der
 * Wert in der Datenbank heißt: „frei" und „gleich" stehen nur in Klammern
 * daneben, für den, der später in `mandant_einstellung` nachsieht.
 */
import type { InternSprache } from '../../intern.js';

export interface RechnungsEinstellungTexte {
  readonly modul: string;
  readonly titel: string;
  readonly untertitel: string;
  readonly leistungsortTitel: string;
  readonly leistungsortErklaerung: string;
  readonly frei: string;
  readonly freiErklaerung: string;
  readonly gleich: string;
  readonly gleichErklaerung: string;
  readonly voreinstellung: string;
  readonly gilt: string;
  readonly nichtGesetzt: string;
  readonly speichern: string;
  readonly keinSchreibrechtVor: string;
  readonly keinSchreibrechtNach: string;
  readonly gesetzt: string;
  readonly unveraendert: string;
  readonly fehler: Readonly<Record<string, string>>;
  /** Für einen Grund, den die Seite nicht kennt — nie der Grund selbst (V-250). */
  readonly fehlerSonst: string;
}

export const RECHNUNGS_EINSTELLUNG_TEXTE:
  Readonly<Record<InternSprache, RechnungsEinstellungTexte>> = {
    de: {
      modul: 'Einstellungen',
      titel: 'Rechnungen',
      untertitel: 'Regeln, nach denen die Rechnungen dieser Gesellschaft entstehen.',
      leistungsortTitel: 'Leistungsort',
      leistungsortErklaerung:
        'Darf das Objekt einer Rechnung einem anderen Kunden zugeordnet sein als dem '
        + 'Rechnungsempfänger? Üblich ist ja: eine Hausverwaltung empfängt die Rechnung für '
        + 'das Haus eines Eigentümers, ein Generalunternehmer für die Baustelle seines '
        + 'Bauherrn. Die Regel gilt beim Anlegen und beim Ändern eines Entwurfs; '
        + 'festgeschriebene Rechnungen bleiben, wie sie sind.',
      frei: 'Jedes sichtbare Objekt (frei)',
      freiErklaerung:
        'Der Leistungsort darf einem anderen Kunden gehören. Geprüft wird, ob die Person, '
        + 'die den Entwurf anlegt, das Objekt sehen darf.',
      gleich: 'Nur Objekte des Rechnungsempfängers (gleich)',
      gleichErklaerung:
        'Ein Objekt, das einem anderen Kunden zugeordnet ist, wird abgewiesen. Ein Objekt '
        + 'ohne Kunden bleibt erlaubt.',
      voreinstellung:
        'Voreinstellung (O-933): jedes sichtbare Objekt — der Leistungsort darf einem anderen '
        + 'Kunden gehören. Sie gilt, solange hier nichts gesetzt ist.',
      gilt: 'Es gilt:',
      nichtGesetzt: 'nicht gesetzt — es gilt die Voreinstellung',
      speichern: 'Regel speichern',
      keinSchreibrechtVor: 'Ändern darf diese Regel, wer',
      keinSchreibrechtNach: 'hält.',
      gesetzt: 'Die Regel ist gespeichert. Sie gilt ab dem nächsten Entwurf.',
      unveraendert: 'Diese Regel war schon eingestellt — nichts geändert.',
      fehler: {
        unbekannte_regel: 'Diese Regel gibt es nicht — gewählt werden kann „frei" oder „gleich".',
      },
      fehlerSonst: 'Die Regel ließ sich nicht speichern.',
    },
    en: {
      modul: 'Settings',
      titel: 'Invoices',
      untertitel: 'Rules that govern how this company’s invoices are created.',
      leistungsortTitel: 'Place of service',
      leistungsortErklaerung:
        'May the site (Objekt) of an invoice belong to a customer other than the invoice '
        + 'recipient? Usually yes: a property manager receives the invoice for an owner’s '
        + 'building, a general contractor for the client’s construction site. The rule applies '
        + 'when a draft is created or changed; finalised invoices stay as they are.',
      frei: 'Any visible site (frei)',
      freiErklaerung:
        'The place of service may belong to another customer. What is checked is whether the '
        + 'person creating the draft may see the site.',
      gleich: 'Only sites of the invoice recipient (gleich)',
      gleichErklaerung:
        'A site assigned to another customer is rejected. A site without a customer remains '
        + 'allowed.',
      voreinstellung:
        'Default (O-933): any visible site — the place of service may belong to another '
        + 'customer. It applies as long as nothing is set here.',
      gilt: 'In effect:',
      nichtGesetzt: 'not set — the default applies',
      speichern: 'Save rule',
      keinSchreibrechtVor: 'Whoever holds',
      keinSchreibrechtNach: 'may change this rule.',
      gesetzt: 'The rule is saved. It applies from the next draft.',
      unveraendert: 'This rule was already in effect — nothing changed.',
      fehler: {
        unbekannte_regel: 'There is no such rule — choose “frei” or “gleich”.',
      },
      fehlerSonst: 'The rule could not be saved.',
    },
  };
