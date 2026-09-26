/**
 * Bauprojekte anlegen, ändern, archivieren — in beiden Sprachen (D-82, D-592).
 *
 * **Die Rechtsbegriffe bleiben deutsch, auch im englischen Text.** Hier sind
 * es fünf, und jeder einzelne trägt Rechtsfolgen, die eine Übersetzung
 * verliert:
 *
 *  - **`VOB/B`** (Vergabe- und Vertragsordnung für Bauleistungen, Teil B) ist
 *    ein deutsches Klauselwerk. „German construction contract rules" ist eine
 *    Beschreibung, kein Name — und ein Vertrag verweist auf den Namen.
 *  - **`Aufmass`** ist die gemeinsame Feststellung der erbrachten Menge
 *    (§ 14 VOB/B); „measurement" trifft die vertragliche Bedeutung nicht.
 *  - **`Nachtrag`** ist die Forderung aus geänderter oder zusätzlicher
 *    Leistung (§ 2 VOB/B), nicht ein „change request".
 *  - **`Abnahme`** (§ 12 VOB/B, § 640 BGB) verschiebt Gefahr, Vergütung und
 *    Verjährung — „acceptance" sagt davon nichts.
 *  - **`Gewährleistung`** ist die Mängelhaftung nach der Abnahme.
 *
 * **Die Auftragssumme steht in ganzen Cent** (Invariante 1). Das Formular
 * sagt es mit der Zahl daneben, nicht mit einer Nachkommastelle, die sich
 * still in eine Gleitkommazahl verwandelt.
 */
import type { InternSprache } from '../intern.js';

export interface ProjektTexte {
  /* ── Überschriften und Wege ────────────────────────────────────────── */
  readonly modul: string;
  readonly neuTitel: string;
  readonly bearbeitenTitel: string;
  readonly alleProjekte: string;
  readonly neuesProjekt: string;
  readonly ersteAnlegen: string;

  /* ── Gliederung des Formulars ──────────────────────────────────────── */
  readonly woher: string;
  readonly was: string;
  readonly wann: string;
  readonly geld: string;

  /* ── Felder ────────────────────────────────────────────────────────── */
  readonly auftrag: string;
  readonly auftragWaehlen: string;
  readonly bezeichnung: string;
  readonly bezeichnungBeispiel: string;
  readonly art: string;
  readonly artHochbau: string;
  readonly artAusbau: string;
  readonly artRueckbau: string;
  readonly vertragsgrundlage: string;
  readonly grundlageWaehlen: string;
  readonly grundlageVob: string;
  readonly grundlageBgb: string;
  readonly verantwortlich: string;
  readonly ohneVerantwortlich: string;
  readonly sollBeginn: string;
  readonly sollEnde: string;
  readonly summe: string;
  readonly summeBeispiel: string;
  readonly einbehalt: string;
  readonly einbehaltBeispiel: string;
  readonly freiwillig: string;

  /* ── Sätze, die eine Entscheidung begründen ────────────────────────── */
  readonly auftragErklaerung: string;
  readonly kundeKommtVomAuftrag: string;
  readonly nummerIstAuftragsnummer: string;
  readonly grundlageErklaerung: string;
  readonly summeErklaerung: string;
  readonly einbehaltErklaerung: string;
  readonly keinAuftrag: string;
  readonly naechsterSchritt: string;

  /* ── Knöpfe und Abweisungen ────────────────────────────────────────── */
  readonly projektAnlegen: string;
  readonly aenderungenSpeichern: string;
  readonly keinSchreibrechtAnlegen: string;
}

export const PROJEKT_TEXTE: Readonly<Record<InternSprache, ProjektTexte>> = {
  de: {
    modul: 'Bau',
    neuTitel: 'Neues Bauvorhaben',
    bearbeitenTitel: 'Bauvorhaben bearbeiten',
    alleProjekte: 'Alle Bauprojekte',
    neuesProjekt: 'Neues Bauvorhaben',
    ersteAnlegen: 'Das erste anlegen.',

    woher: 'Aus welchem Auftrag',
    was: 'Was gebaut wird',
    wann: 'Termine',
    geld: 'Geld und Sicherheiten',

    auftrag: 'Auftrag',
    auftragWaehlen: 'Auftrag wählen',
    bezeichnung: 'Bezeichnung des Vorhabens',
    bezeichnungBeispiel: 'z. B. Ausbau Dachgeschoss Lindenstrasse 4',
    art: 'Art',
    artHochbau: 'Hochbau — Neubau und Rohbau',
    artAusbau: 'Ausbau — Innenausbau, Trockenbau, Sanierung',
    artRueckbau: 'Rückbau — Abbruch und Entkernung',
    vertragsgrundlage: 'Vertragsgrundlage',
    grundlageWaehlen: 'Bitte wählen',
    grundlageVob: 'VOB/B',
    grundlageBgb: 'BGB (Werkvertrag)',
    verantwortlich: 'Bauleitung',
    ohneVerantwortlich: 'noch offen',
    sollBeginn: 'Soll-Beginn',
    sollEnde: 'Soll-Ende',
    summe: 'Auftragssumme netto (Cent)',
    summeBeispiel: 'z. B. 8770407 für 87.704,07 €',
    einbehalt: 'Sicherheitseinbehalt (Basispunkte)',
    einbehaltBeispiel: 'z. B. 500 für 5 %',
    freiwillig: '(freiwillig)',

    auftragErklaerung:
      'Ein Bauprojekt ist die Bauakte eines Auftrags — kein zweiter Vorgang '
      + 'daneben. Je Auftrag gibt es genau eines; Aufträge, die schon eines '
      + 'tragen, stehen deshalb nicht in der Liste. Ein Vorhaben ohne Auftrag '
      + 'wäre eine Baustelle ohne Vertrag.',
    kundeKommtVomAuftrag:
      'Kunde und Objekt werden aus dem Auftrag übernommen und hier nicht noch '
      + 'einmal gefragt. Zwei Felder für dieselbe Angabe können auseinanderlaufen '
      + '— und das fiele erst auf der Rechnung auf.',
    nummerIstAuftragsnummer:
      'Die Projektnummer ist die Auftragsnummer. Sie kommt damit aus dem '
      + 'bestätigten Nummernkreis und nicht aus einem erfundenen Format; nach '
      + 'welchem Schlüssel Bauvorhaben endgültig nummeriert werden, ist noch zu '
      + 'entscheiden (O-351).',
    grundlageErklaerung:
      'VOB/B oder BGB entscheidet über Fristen, Abnahme, Mängelrechte und den '
      + 'Umgang mit Nachträgen (§ 2 VOB/B gegen § 631 BGB). Deshalb ist das Feld '
      + 'nicht vorbelegt: eine stille Voreinstellung wäre eine Rechtswahl, die '
      + 'niemand getroffen hat.',
    summeErklaerung:
      'In ganzen Cent, ohne Komma und ohne Punkt. 87.704,07 € sind 8770407. '
      + 'Freiwillig — die Summe entsteht regulär aus dem Leistungsverzeichnis.',
    einbehaltErklaerung:
      'In Basispunkten: 500 sind fünf Prozent. Erlaubt ist 0 bis 10000. Ein '
      + 'Prozentwert wird nicht umgedeutet — 5 wären fünf Hundertstel Prozent.',
    keinAuftrag:
      'Es gibt keinen Auftrag ohne Bauakte in dieser Gesellschaft. Erst den '
      + 'Auftrag anlegen, dann das Vorhaben — die kaufmännische Seite kommt zuerst.',
    naechsterSchritt:
      'Nach dem Anlegen geht es weiter zum Leistungsverzeichnis: ohne Position '
      + 'gibt es nichts, wogegen ein Aufmass laufen könnte.',

    projektAnlegen: 'Bauvorhaben anlegen',
    aenderungenSpeichern: 'Änderungen speichern',
    keinSchreibrechtAnlegen: 'Zum Anlegen fehlt Ihnen',
  },
  en: {
    modul: 'Construction',
    neuTitel: 'New construction project',
    bearbeitenTitel: 'Edit construction project',
    alleProjekte: 'All construction projects',
    neuesProjekt: 'New construction project',
    ersteAnlegen: 'Create the first one.',

    woher: 'From which Auftrag',
    was: 'What is being built',
    wann: 'Dates',
    geld: 'Money and retentions',

    auftrag: 'Auftrag (the order)',
    auftragWaehlen: 'Choose an Auftrag',
    bezeichnung: 'Project name',
    bezeichnungBeispiel: 'e.g. Loft conversion Lindenstrasse 4',
    art: 'Type',
    artHochbau: 'Hochbau — new build and shell construction',
    artAusbau: 'Ausbau — fit-out, drywall, refurbishment',
    artRueckbau: 'Rückbau — demolition and strip-out',
    vertragsgrundlage: 'Contractual basis',
    grundlageWaehlen: 'Please choose',
    grundlageVob: 'VOB/B',
    grundlageBgb: 'BGB (Werkvertrag — contract for work)',
    verantwortlich: 'Site management',
    ohneVerantwortlich: 'not yet assigned',
    sollBeginn: 'Planned start',
    sollEnde: 'Planned end',
    summe: 'Net order value (cents)',
    summeBeispiel: 'e.g. 8770407 for 87,704.07 €',
    einbehalt: 'Sicherheitseinbehalt — retention (basis points)',
    einbehaltBeispiel: 'e.g. 500 for 5 %',
    freiwillig: '(optional)',

    auftragErklaerung:
      'A construction project is the site file of an Auftrag (the order) — not a '
      + 'second record beside it. There is exactly one per Auftrag, so orders that '
      + 'already carry one are not listed. A project without an Auftrag would be a '
      + 'building site without a contract.',
    kundeKommtVomAuftrag:
      'Kunde (customer) and Objekt (site) are taken from the Auftrag and not asked '
      + 'again here. Two fields for the same fact can drift apart — and that only '
      + 'shows up on the invoice.',
    nummerIstAuftragsnummer:
      'The project number is the Auftragsnummer (the order number). It therefore '
      + 'comes from a confirmed number range rather than an invented format; which '
      + 'key construction projects are finally numbered by is still to be decided '
      + '(O-351).',
    grundlageErklaerung:
      'VOB/B or BGB decides deadlines, Abnahme (formal acceptance), defect rights '
      + 'and how Nachträge (claims for changed or additional work) are handled '
      + '(§ 2 VOB/B versus § 631 BGB). That is why this field has no default: a '
      + 'silent preset would be a choice of law nobody made.',
    summeErklaerung:
      'In whole cents, no decimal separator. 87,704.07 € is 8770407. Optional — '
      + 'the value normally follows from the Leistungsverzeichnis (bill of '
      + 'quantities).',
    einbehaltErklaerung:
      'In basis points: 500 is five percent. Allowed range is 0 to 10000. A '
      + 'percentage is not reinterpreted — 5 would be five hundredths of a percent.',
    keinAuftrag:
      'There is no Auftrag without a site file in this Gesellschaft (legal entity). '
      + 'Create the Auftrag first, then the project — the commercial side comes '
      + 'first.',
    naechsterSchritt:
      'After creating it you continue to the Leistungsverzeichnis (bill of '
      + 'quantities): without a position there is nothing for an Aufmass (the '
      + 'joint measurement of work performed) to run against.',

    projektAnlegen: 'Create project',
    aenderungenSpeichern: 'Save changes',
    keinSchreibrechtAnlegen: 'Creating one requires',
  },
};
