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
import type { ProjektGrund } from '../../../server/services/bau/projekt.js';

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
      + 'Umgang mit Nachträgen (§ 2 VOB/B gegen § 631 BGB). Voreinstellung (O-154): '
      + 'VOB/B — die Gruppe schliesst Bauverträge nach VOB/B; BGB wird hier ausdrücklich '
      + 'gewählt, wenn der Vertrag es sagt.',
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
      + '(§ 2 VOB/B versus § 631 BGB). Default (O-154): VOB/B — the group concludes '
      + 'construction contracts under VOB/B; choose BGB here explicitly when the contract '
      + 'says so.',
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

/**
 * Warum ein Bauvorhaben nicht gespeichert wurde — als SATZ, nachgeschlagen
 * nach dem GRUND, den `POST /api/bau/projekte` als `?fehler=` zurückschickt
 * (V-275, D-773, D-769).
 *
 * Bis dahin reiste der deutsche Satz des Dienstes als `?meldung=` mit und
 * stand roh über dem Formular — deutsch auch in einer englischen Sitzung, und
 * jeder präparierte Link schrieb seine eigene Warnung. Die Seite schlägt nur
 * als eigenen Eintrag nach (D-728); ein Grund, den die Tabelle nicht kennt,
 * bekommt `sonst`.
 *
 * **Ohne die Werte, die der Dienst einsetzt** (D-769 Nr. 5): die
 * Auftragsnummer eines schon verbauten Auftrags ist die Wahl im Formular, die
 * Zahl offener Nachträge steht auf dem Projektblatt — die Sätze kommen ohne
 * beides aus.
 */
export interface ProjektFehlerTexte {
  /** Die fett gesetzten ersten Worte des Kastens (DESIGN §5 „Notices"). */
  readonly titel: string;
  /** Für einen Grund, den die Tabelle nicht kennt. */
  readonly sonst: string;
  readonly fehler: Readonly<Record<ProjektGrund, string>>;
}

export const PROJEKT_FEHLER_TEXTE: Readonly<Record<InternSprache, ProjektFehlerTexte>> = {
  de: {
    titel: 'Nicht gespeichert.',
    sonst: 'Das Bauvorhaben wurde nicht gespeichert. Prüfen Sie die Angaben und versuchen Sie '
      + 'es noch einmal.',
    fehler: {
      id_fehlt: 'Welches Bauprojekt gemeint ist, fehlt — öffnen Sie es aus der Liste heraus.',
      auftrag_fehlt:
        'Ein Bauprojekt ist die Bauakte eines Auftrags — bitte den Auftrag wählen.',
      bezeichnung_fehlt: 'Ein Bauvorhaben braucht eine Bezeichnung.',
      art_unbekannt: 'Die Art eines Bauvorhabens ist Hochbau, Ausbau oder Rückbau.',
      vertragsgrundlage_fehlt:
        'Die Vertragsgrundlage ist VOB/B oder BGB — sie entscheidet über Fristen, Abnahme und '
        + 'Nachträge und wird deshalb nicht vorbelegt.',
      einbehalt_ungueltig:
        'Der Sicherheitseinbehalt steht in Basispunkten: 500 sind fünf Prozent. Erlaubt ist '
        + 'eine ganze Zahl von 0 bis 10000.',
      summe_ungueltig: 'Die Auftragssumme steht in ganzen Cent — 12.345,67 € sind 1234567.',
      auftrag_unbekannt: 'Diesen Auftrag gibt es in dieser Gesellschaft nicht.',
      projekt_vorhanden:
        'Zu diesem Auftrag gibt es bereits ein Bauprojekt. Ein Auftrag trägt genau eine '
        + 'Bauakte; ein zweites Vorhaben braucht einen zweiten Auftrag.',
      nicht_angelegt:
        'Das Bauprojekt wurde nicht angelegt. Prüfen Sie, ob Ihr Konto in dieser Gesellschaft '
        + 'den Bau bearbeiten darf.',
      status_unbekannt: 'Diesen Projektzustand gibt es nicht.',
      projekt_unbekannt:
        'Dieses Bauprojekt gibt es in dieser Gesellschaft nicht mehr, oder es ist archiviert '
        + '— die Liste zeigt den aktuellen Stand.',
      nachtraege_offen:
        'Dieses Bauvorhaben hat noch offene Nachträge. Über eine angemeldete Forderung ist zu '
        + 'entscheiden, bevor das Vorhaben aus der Liste verschwindet.',
    },
  },
  en: {
    titel: 'Not saved.',
    sonst: 'The construction project was not saved. Check the details and try again.',
    fehler: {
      id_fehlt: 'Which project is meant is missing — open it from the list.',
      auftrag_fehlt:
        'A construction project is the file of an order (Auftrag) — please choose the order.',
      bezeichnung_fehlt: 'A construction project needs a name.',
      art_unbekannt:
        'The kind of project is Hochbau (building), Ausbau (fit-out) or Rückbau (demolition).',
      vertragsgrundlage_fehlt:
        'The contract basis is VOB/B or BGB — it governs deadlines, Abnahme and Nachträge and '
        + 'is therefore never preset.',
      einbehalt_ungueltig:
        'The retention is given in basis points: 500 is five per cent. Allowed is a whole '
        + 'number from 0 to 10000.',
      summe_ungueltig: 'The order total is given in whole cents — €12,345.67 is 1234567.',
      auftrag_unbekannt: 'This order does not exist in this Gesellschaft (legal entity).',
      projekt_vorhanden:
        'A construction project already exists for this order. An order carries exactly one '
        + 'project file; a second project needs a second order.',
      nicht_angelegt:
        'The construction project was not created. Check whether your account may edit '
        + 'construction in this Gesellschaft.',
      status_unbekannt: 'This project state does not exist.',
      projekt_unbekannt:
        'This construction project no longer exists in this Gesellschaft, or it has been '
        + 'archived — the list shows the current state.',
      nachtraege_offen:
        'This project still has open Nachträge (claims for changed or additional work). A '
        + 'claim that has been filed must be decided before the project leaves the list.',
    },
  },
};
