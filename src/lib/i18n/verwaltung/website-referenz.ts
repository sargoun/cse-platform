/**
 * Die Wörter der Referenzpflege — in beiden Sprachen (V-154, PRO-05, D-592).
 *
 * **Der Befund, aus dem sie entstanden sind.** Eine Referenz liess sich nicht
 * anlegen: die Liste hatte keinen Knopf, die Route keine Handlung, der Dienst
 * kein `insert`. Die Wörter hier gehören zu dem Weg, der das jetzt tut — die
 * Liste, das Anlegeformular, der Hinweis auf dem Blatt der neuen Zeile und
 * der Verweis von der Kundenfreigabe am Auftrag.
 *
 * **`Kundenfreigabe` und `Auftrag` bleiben deutsch**, auch im englischen
 * Text: sie tragen die Bedeutung aus PRO-05 (die schriftliche Zustimmung, der
 * Vertrag), und die Rechtematrix kennt sie so. Erklärt wird in Klammern,
 * ersetzt wird nicht. „Referenz" selbst ist kein Rechtsbegriff und heisst
 * englisch „reference".
 */
import type { InternSprache } from '../intern.js';

export interface WebsiteReferenzTexte {
  /* ── Liste ──────────────────────────────────────────────────────────── */
  readonly neueReferenz: string;
  readonly leerWeg: string;
  readonly anlegenVerlangt: string;

  /* ── Anlegen ────────────────────────────────────────────────────────── */
  readonly wurzelTitel: string;
  readonly zurListe: string;
  readonly anlegenTitel: string;
  readonly anlegenEinleitung: string;
  readonly feldTitel: string;
  readonly feldSlug: string;
  readonly slugHinweis: string;
  readonly feldKunde: string;
  readonly kundeHinweis: string;
  readonly feldBeschreibung: string;
  readonly beschreibungHinweis: string;
  readonly feldJahr: string;
  readonly anlegen: string;
  readonly abbrechen: string;
  readonly ausAuftragTitel: (auftragsnummer: string) => string;
  readonly ausAuftragText: string;
  readonly auftragOhneFreigabe: string;
  readonly zurKundenfreigabe: string;
  readonly nurLesbarTitel: string;
  readonly nurLesbarText: string;
  readonly nichtAngelegt: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;

  /* ── Blatt der neuen Zeile ──────────────────────────────────────────── */
  readonly angelegtTitel: string;
  readonly angelegtText: string;
  readonly vorschlagTitel: (auftragsnummer: string) => string;
  readonly vorschlagText: string;
  readonly belegAusAuftrag: (
    auftragsnummer: string, ansprechpartner: string | null, schreiben: string | null,
  ) => string;

  /* ── Kundenfreigabe am Auftrag ──────────────────────────────────────── */
  readonly ausAuftragAnlegen: string;

  /*
   * ── Veröffentlichen / Zurückziehen abgewiesen ───────────────────────────
   * `api/website/referenzen` antwortete mit `{"fehler": grund}`; jetzt kommt
   * der Grund auf die Seite zurück, und hier steht der Satz (V-154).
   */
  readonly statusNichtGesetzt: string;
  readonly statusFehler: Readonly<Record<string, string>>;
  readonly statusFehlerSonst: string;
}

const DE: WebsiteReferenzTexte = {
  neueReferenz: 'Neue Referenz',
  leerWeg:
    'Legen Sie das erste an. Es entsteht als Entwurf und bleibt unsichtbar, bis der '
    + 'Kunde schriftlich zugestimmt hat und die Veröffentlichung entschieden ist.',
  anlegenVerlangt: 'Anlegen verlangt zusätzlich das Recht',

  wurzelTitel: 'Website',
  zurListe: 'Referenzen',
  anlegenTitel: 'Neue Referenz',
  anlegenEinleitung:
    'Ein abgeschlossenes Projekt für das Profil dieser Gesellschaft. Es entsteht als '
    + 'Entwurf und ohne Kundenfreigabe. Öffentlich wird es erst, wenn die schriftliche '
    + 'Zustimmung des Kunden mit Datum und Beleg eingetragen ist und jemand mit eigenem '
    + 'Recht veröffentlicht — drei Schritte, drei Entscheidungen.',
  feldTitel: 'Titel',
  feldSlug: 'Slug — der letzte Teil der Adresse',
  slugHinweis:
    'Leer lassen: er entsteht aus dem Titel. Ist die Referenz einmal öffentlich, bricht '
    + 'jede Änderung eingehende Verweise.',
  feldKunde: 'Kundenname',
  kundeHinweis: 'Er erscheint nur mit Kundenfreigabe auf der Website.',
  feldBeschreibung: 'Beschreibung',
  beschreibungHinweis:
    'Was gemacht wurde. Nie Auftragswert, Ansprechpartner oder Vertragsinhalte — die '
    + 'Referenz ist eine eigene Formulierung für die Öffentlichkeit.',
  feldJahr: 'Jahr',
  anlegen: 'Als Entwurf anlegen',
  abbrechen: 'Abbrechen',
  ausAuftragTitel: (nr) => `Vorbelegt aus Auftrag ${nr}.`,
  ausAuftragText:
    'Übernommen sind Titel und Kundenname, sonst nichts. Prüfen Sie beides — die '
    + 'Bezeichnung im Auftrag ist selten die Überschrift, unter der ein Kunde öffentlich '
    + 'genannt werden möchte.',
  auftragOhneFreigabe:
    'Dieser Auftrag trägt keine geltende Kundenfreigabe. Vorbelegt wurde deshalb nichts.',
  zurKundenfreigabe: 'Zur Kundenfreigabe am Auftrag',
  nurLesbarTitel: 'Hier lässt sich nichts anlegen.',
  nurLesbarText:
    'Eine Referenz anzulegen verlangt beide Rechte — das zweite verlangt die Datenbank '
    + 'für jeden Schreibvorgang auf dieser Tabelle, auch für das Anlegen:',
  nichtAngelegt: 'Nichts wurde angelegt.',
  fehler: {
    titel_fehlt: 'Eine Referenz ohne Titel hat keine Überschrift.',
    slug_form:
      'Der Slug besteht aus Kleinbuchstaben, Ziffern und einzelnen Bindestrichen — er ist '
      + 'Teil der öffentlichen Adresse.',
    slug_vergeben:
      'Diese Adresse trägt in dieser Gesellschaft schon eine andere Referenz — auch eine '
      + 'gelöschte hält ihren Slug. Tragen Sie einen anderen Slug ein; aus dem Titel '
      + 'ergäbe sich gerade der belegte.',
    jahr_ungueltig: 'Das Jahr liegt zwischen 1990 und 2100 — oder es bleibt leer.',
    kein_freigaberecht:
      'Eine Referenz anzulegen verlangt das Recht, Kundenfreigaben zu erfassen. Es fehlt '
      + 'dieser Sitzung.',
    nicht_angelegt: 'Die Referenz wurde nicht angelegt. Bitte laden Sie die Seite neu.',
    unbekannte_handlung: 'Diese Handlung kennt die Route nicht.',
  },
  fehlerSonst: 'Die Anlage wurde abgewiesen.',

  angelegtTitel: 'Angelegt — als Entwurf und ohne Kundenfreigabe.',
  angelegtText:
    'Öffentlich ist noch nichts. Der nächste Schritt steht unten: die schriftliche '
    + 'Zustimmung des Kunden mit Datum und Beleg.',
  vorschlagTitel: (nr) => `Datum und Beleg sind aus der Kundenfreigabe am Auftrag ${nr} vorgeschlagen.`,
  vorschlagText:
    'Gespeichert ist davon noch nichts. Prüfen Sie, ob die Zustimmung des Kunden auch '
    + 'diese Referenz mit diesem Text deckt, und speichern Sie dann selbst (offen: O-913).',
  belegAusAuftrag: (nr, ansprechpartner, schreiben) =>
    `Kundenfreigabe am Auftrag ${nr}`
    + (ansprechpartner === null ? '' : `, erklärt von ${ansprechpartner}`)
    + (schreiben === null ? '' : `, Schreiben „${schreiben}“`)
    + '.',

  ausAuftragAnlegen: 'Referenz aus diesem Auftrag anlegen',

  statusNichtGesetzt: 'Der Stand auf der Website hat sich nicht geändert.',
  statusFehler: {
    ohne_kundenfreigabe:
      'Diese Referenz trägt keine Kundenfreigabe (mehr). Ohne sie darf der Kundenname '
      + 'nicht auf die Website — tragen Sie zuerst die Zustimmung mit Datum und Beleg ein.',
    nicht_gefunden: 'Diese Referenz gibt es hier nicht.',
    nicht_geaendert:
      'Der Stand wurde nicht gesetzt — dieser Sitzung fehlt das Schreibrecht.',
  },
  statusFehlerSonst: 'Die Handlung wurde abgewiesen.',
};

const EN: WebsiteReferenzTexte = {
  neueReferenz: 'New reference',
  leerWeg:
    'Create the first one. It starts as a draft and stays invisible until the customer '
    + 'has agreed in writing and publication has been decided.',
  anlegenVerlangt: 'Creating one additionally requires the right',

  wurzelTitel: 'Website',
  zurListe: 'References',
  anlegenTitel: 'New reference',
  anlegenEinleitung:
    'A completed project for this Gesellschaft’s (legal entity’s) profile. It starts as a '
    + 'draft and without Kundenfreigabe (customer release). It only becomes public once '
    + 'the customer’s written consent is recorded with date and evidence and someone with '
    + 'their own right publishes it — three steps, three decisions.',
  feldTitel: 'Title',
  feldSlug: 'Slug — the last part of the address',
  slugHinweis:
    'Leave empty: it is derived from the title. Once the reference is public, every change '
    + 'breaks incoming links.',
  feldKunde: 'Customer name',
  kundeHinweis: 'It only appears on the website with a Kundenfreigabe.',
  feldBeschreibung: 'Description',
  beschreibungHinweis:
    'What was done. Never the order value, contact persons or contract terms — the '
    + 'reference is its own wording for the public.',
  feldJahr: 'Year',
  anlegen: 'Create as draft',
  abbrechen: 'Cancel',
  ausAuftragTitel: (nr) => `Prefilled from Auftrag (order) ${nr}.`,
  ausAuftragText:
    'Title and customer name were copied, nothing else. Check both — the order’s label is '
    + 'rarely the heading under which a customer wants to be named in public.',
  auftragOhneFreigabe:
    'This Auftrag carries no valid Kundenfreigabe. Nothing was prefilled.',
  zurKundenfreigabe: 'To the Kundenfreigabe on the Auftrag',
  nurLesbarTitel: 'Nothing can be created here.',
  nurLesbarText:
    'Creating a reference requires both rights — the database demands the second for every '
    + 'write to this table, creating included:',
  nichtAngelegt: 'Nothing was created.',
  fehler: {
    titel_fehlt: 'A reference without a title has no heading.',
    slug_form:
      'The slug consists of lower-case letters, digits and single hyphens — it is part of '
      + 'the public address.',
    slug_vergeben:
      'Another reference of this Gesellschaft already holds this address — a deleted one '
      + 'keeps its slug too. Enter a different slug; the title would produce the taken one.',
    jahr_ungueltig: 'The year lies between 1990 and 2100 — or stays empty.',
    kein_freigaberecht:
      'Creating a reference requires the right to record customer releases. This session '
      + 'does not hold it.',
    nicht_angelegt: 'The reference was not created. Please reload the page.',
    unbekannte_handlung: 'The route does not know this action.',
  },
  fehlerSonst: 'Creating it was refused.',

  angelegtTitel: 'Created — as a draft and without Kundenfreigabe.',
  angelegtText:
    'Nothing is public yet. The next step is below: the customer’s written consent with '
    + 'date and evidence.',
  vorschlagTitel: (nr) => `Date and evidence are suggested from the Kundenfreigabe on Auftrag ${nr}.`,
  vorschlagText:
    'None of it is saved yet. Check whether the customer’s consent also covers this '
    + 'reference with this text, then save it yourself (open: O-913).',
  belegAusAuftrag: (nr, ansprechpartner, schreiben) =>
    `Kundenfreigabe on Auftrag ${nr}`
    + (ansprechpartner === null ? '' : `, declared by ${ansprechpartner}`)
    + (schreiben === null ? '' : `, letter “${schreiben}”`)
    + '.',

  ausAuftragAnlegen: 'Create a reference from this Auftrag',

  statusNichtGesetzt: 'Its state on the website did not change.',
  statusFehler: {
    ohne_kundenfreigabe:
      'This reference carries no Kundenfreigabe (any more). Without it the customer’s '
      + 'name must not go on the website — record the consent with date and evidence first.',
    nicht_gefunden: 'This reference does not exist here.',
    nicht_geaendert: 'The state was not set — this session lacks the right to write.',
  },
  statusFehlerSonst: 'The action was refused.',
};

export const WEBSITE_REFERENZ_TEXTE: Readonly<Record<InternSprache, WebsiteReferenzTexte>> = {
  de: DE, en: EN,
};
