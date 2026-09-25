/**
 * `/[mandant]/finanzen/mahnungen`, `/mahnungen/[id]` und die Zahlungsakte
 * `/zahlungen/[id]` — in beiden Sprachen.
 *
 * **Warum die Zahlungsakte hier steht und nicht in `zahlungen.ts`.** Der
 * Schnitt laeuft entlang der ARBEIT, nicht entlang des Ordners (siehe den
 * Kopf von `zahlungen.ts`). Wer mahnt, oeffnet vorher die einzelne Zahlung:
 * ist die Forderung wirklich offen, oder liegt das Geld nur falsch
 * zugeordnet? Und wer eine Zahlung storniert, erzeugt genau die ueberfaellige
 * Forderung, die der Mahnlauf am naechsten Morgen aufgreift. Die beiden
 * Blaetter teilen `Grund`, `Begruendung`, `Storno` und den Satz ueber die
 * wieder offenen Forderungen.
 *
 * **Was die Zahlungsakte mit der Zahlungsliste teilt, steht NICHT hier**,
 * sondern weiter in `zahlungen.ts`: `titel`, `zahlungsmittel`, `referenz` und
 * vor allem `mittelNamen`. Zwei Tabellen mit denselben fuenf Zahlungsmitteln
 * waeren zwei Stellen, an denen beim naechsten Mal nur eine geaendert wird —
 * und dann heisst dieselbe `lastschrift` auf der Liste anders als auf dem
 * Beleg.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`): `Mahnung`, `Mahnstufe`, `Mahngebuehr`, `Storno`, `Skonto`,
 * `Lastschrift`, `Einschreiben` und `Bauabzugsteuer` tragen Rechtsbedeutung
 * (BGB §§286/288, UStG §17, EStG §48, GoBD). Im Englischen steht der deutsche
 * Begriff und DANEBEN eine kurze Erklaerung in Klammern — nie eine erfundene
 * Entsprechung. `Mahnwesen` heisst englisch „dunning" und nicht „reminders";
 * die Navigation traegt dieselbe Wahl seit `intern.ts`.
 *
 * **Die deutschen Zeichenketten sind WORTGLEICH mit denen, die vorher im
 * Seitenrumpf standen.** `tests/e2e/mahnung.spec.ts` und `zahlung.spec.ts`
 * greifen „Vorschlaege des Laufs", „Entwuerfe anlegen", „Geforderte
 * Positionen", „Versand dokumentieren", „Wohin sie gebucht wurde" und
 * „Stornieren" ueber ihre Beschriftung. Ein besseres deutsches Wort waere
 * hier ein gebrochener Browsertest.
 */
import type { InternSprache } from '../../intern.js';

export interface MahnungenTexte {
  /* ── Was auf mehreren der drei Blaetter steht ──────────────────────── */
  readonly rechnung: string;
  readonly entwurf: string;
  readonly grund: string;
  readonly begruendung: string;
  readonly offen: string;

  /* ── Die Mahnliste: `/finanzen/mahnungen` ──────────────────────────── */
  readonly titel: string;
  readonly vorschlaegeTitel: string;
  readonly keinVorschlag: string;
  readonly tabelleVorschlaege: string;
  readonly stufe: string;
  readonly forderung: string;
  readonly gebuehr: string;
  readonly verzugszins: string;
  readonly entwuerfeAnlegen: string;
  readonly entwurfOhneNummer: string;
  readonly uebergangenTitel: string;
  readonly tabelleUebergangen: string;
  readonly briefeTitel: string;
  readonly keineMahnung: string;
  readonly tabelleBriefe: string;

  /* ── Die Mahnakte: `/finanzen/mahnungen/[id]` ──────────────────────── */
  readonly mahnung: string;
  readonly alleMahnungen: string;
  readonly mahndatum: string;
  readonly zahlbarBis: string;
  readonly positionenTitel: string;
  readonly tabellePositionen: string;
  readonly verzugAb: string;
  readonly tage: string;
  /** Der Zinssatz p. a. als Prozent — vorher „Satz (bp)" mit Basispunkten (V-213). */
  readonly zinssatz: string;
  readonly zins: string;
  readonly mahngebuehr: string;
  readonly verzugszinsen: string;
  readonly gesamtbetrag: string;
  readonly verworfen: string;
  readonly freigabeErklaerung: string;
  readonly freigabePlatzhalter: string;
  readonly verwerfen: string;
  readonly verwerfenErklaerung: string;
  readonly verwerfenPlatzhalter: string;
  readonly versandTitel: string;

  /* ── Das Schreiben (V-213, V-214) ───────────────────────────────────── */
  readonly schreibenTitel: string;
  /** Unter der Vorschau: das Schreiben ist deutsch, auch in englischer Oberfläche. */
  readonly schreibenErklaerung: string;
  readonly schreibenOeffnen: string;
  readonly schreibenSigniert: string;
  readonly schreibenOhneRecht: string;
  readonly mahntextFehlt: string;
  /** Vor der Liste der leeren Briefkopfangaben. */
  readonly briefkopfFehlt: string;
  /** Hinter der Liste: wo sie gepflegt werden. */
  readonly briefkopfPflege: string;
  readonly briefkopfAngaben: Readonly<Record<
    'anschrift' | 'registergericht' | 'registernummer' | 'geschaeftsfuehrung', string>>;
  readonly versandErklaerung: string;

  /* ── Abschliessen (V-084) ────────────────────────────────────────────── */
  readonly erledigenTitel: string;
  readonly erledigenErklaerung: string;
  readonly erledigenKnopf: string;
  readonly weg: string;
  readonly empfaenger: string;

  /** Die Wege des Versands — die `value`-Schluessel des Formulars. */
  readonly versandarten: Readonly<Record<'brief' | 'einschreiben' | 'bote', string>>;

  /* ── Die Zahlungsakte: `/finanzen/zahlungen/[id]` ──────────────────── */
  readonly zahlung: string;
  readonly vom: string;

  /**
   * Der Stornovermerk in zwei Stuecken: zwischen ihnen stehen der Tag und der
   * Grund. Das zweite Stueck beginnt mit dem Punkt, der den Grund schliesst.
   */
  readonly storniertAmVor: string;
  readonly storniertAmNach: string;

  readonly wertstellung: string;
  readonly konto: string;
  readonly zuordnungTitel: string;
  readonly keineZuordnung: string;
  readonly tabelleZuordnung: string;
  readonly beleg: string;
  readonly guthabenDesKunden: string;

  /** Steht HINTER dem Restbetrag, deshalb ohne fuehrendes Grosswort. */
  readonly restOhneForderung: string;

  readonly stornoTitel: string;
  readonly stornoGrundLabel: string;
  readonly stornoPlatzhalter: string;
  readonly stornoErklaerung: string;
  readonly stornieren: string;

  /**
   * Die Arten einer Zuordnung — `zahlung_zuordnung.art`-Enum aus 0121.
   *
   * Der Schluessel ist der Enum-Wert und bleibt unangetastet; nur die
   * Beschriftung wechselt die Sprache.
   */
  readonly zuordnungsarten: Readonly<Record<
    'zahlung' | 'skonto' | 'gebuehr' | 'differenz' | 'mahngebuehr' | 'zins'
    | 'bauabzugsteuer_einbehalt' | 'ueberzahlung', string>>;
}

export const MAHNUNGEN_TEXTE: Readonly<Record<InternSprache, MahnungenTexte>> = {
  de: {
    rechnung: 'Rechnung',
    entwurf: 'Entwurf',
    grund: 'Grund',
    begruendung: 'Begründung',
    offen: 'Offen',

    titel: 'Mahnungen',
    vorschlaegeTitel: 'Vorschläge des Laufs',
    keinVorschlag:
      'Kein Vorschlag. Entweder ist nichts überfällig — oder alles '
      + 'Überfällige steht unten unter „Übergangen“, mit Grund.',
    tabelleVorschlaege: 'Mahnvorschläge mit Kunde, Stufe, Forderung, Gebühr, Zins und Summe',
    stufe: 'Stufe',
    forderung: 'Forderung',
    gebuehr: 'Gebühr',
    verzugszins: 'Verzugszins',
    entwuerfeAnlegen: 'Entwürfe anlegen',
    entwurfOhneNummer:
      'Ein Entwurf trägt keine Nummer und geht nirgendwohin. Die Nummer '
      + 'entsteht mit der Freigabe, der Versand ist ein Schritt danach.',
    uebergangenTitel: 'Übergangen — und warum',
    tabelleUebergangen: 'Überfällige Forderungen, die nicht gemahnt werden, mit Grund',
    briefeTitel: 'Mahnungen',
    keineMahnung: 'Es liegt keine Mahnung vor.',
    tabelleBriefe: 'Mahnungen mit Nummer, Kunde, Stufe, Summe und Zustand',

    mahnung: 'Mahnung',
    alleMahnungen: 'Alle Mahnungen',
    mahndatum: 'Mahndatum',
    zahlbarBis: 'Zahlbar bis',
    positionenTitel: 'Geforderte Positionen',
    tabellePositionen:
      'Positionen der Mahnung mit Rechnung, Betrag, Verzugsbeginn, Tagen, Satz und Zins',
    verzugAb: 'Verzug ab',
    tage: 'Tage',
    zinssatz: 'Satz p. a.',
    zins: 'Zins',
    mahngebuehr: 'Mahngebühr',
    verzugszinsen: 'Verzugszinsen',
    gesamtbetrag: 'Gesamtbetrag',
    verworfen: 'Verworfen',
    freigabeErklaerung:
      'Die Freigabe hält fest, wer genau diese Beträge genehmigt hat. Erst '
      + 'mit ihr zieht die Datenbank die Nummer — ein Entwurf trägt keine.',
    freigabePlatzhalter: 'Zahlungserinnerung nach Rücksprache freigegeben',
    verwerfen: 'Verwerfen',
    verwerfenErklaerung:
      'Der Entwurf bleibt mit seinem Grund stehen — gelöscht wird nichts '
      + '(Invariante 8).',
    verwerfenPlatzhalter: 'Kunde hat nachweislich am Vortag gezahlt',
    versandTitel: 'Versand dokumentieren',

    schreibenTitel: 'Das Schreiben',
    schreibenErklaerung:
      'So geht die Mahnung hinaus: Briefkopf, Anschrift, Mahntext der Stufe, '
      + 'Forderungen und Pflichtangaben. Wer freigibt, gibt genau diesen Text frei.',
    schreibenOeffnen: 'Abgelegtes Schreiben öffnen (PDF)',
    schreibenSigniert:
      'Das Schreiben, wie es hinausging — der Beleg für den Verzugsbeginn. Der '
      + 'Verweis ist eine zeitlich begrenzte, signierte Adresse.',
    schreibenOhneRecht:
      'Das abgelegte Schreiben öffnet, wer Dokumente lesen darf.',
    mahntextFehlt:
      'Für diese Stufe ist kein Mahntext hinterlegt — das Schreiben nennt nur die '
      + 'Forderungen. Gepflegt wird er unter Einstellungen › Mahnwesen.',
    briefkopfFehlt: 'Im Briefkopf fehlen:',
    briefkopfPflege: 'Gepflegt werden sie unter Einstellungen › Unternehmensdaten.',
    briefkopfAngaben: {
      anschrift: 'Anschrift',
      registergericht: 'Registergericht',
      registernummer: 'Registernummer',
      geschaeftsfuehrung: 'Geschäftsführung',
    },
    erledigenTitel: 'Erledigt',
    erledigenErklaerung:
      'Die Sache ist beigelegt — bezahlt, verrechnet oder auf anderem Weg. Die '
      + 'Mahnung bleibt vollständig stehen; nur ihr Zustand sagt es. Ob ein '
      + 'bezahlter offener Posten seine Mahnung von selbst schliesst, ist offen '
      + '(O-902) — bis dahin setzt es ein Mensch, und er sieht dabei den Betrag.',
    erledigenKnopf: 'Als erledigt vermerken',
    versandErklaerung:
      'Es gibt keinen automatischen Versand: die Mahnung geht als Brief, '
      + 'Einschreiben oder durch Boten hinaus, und hier wird festgehalten, '
      + 'dass sie hinausgegangen ist. Erst danach läuft der Verzug — und '
      + 'erst dann ist die nächste Stufe möglich.',
    weg: 'Weg',
    empfaenger: 'Empfänger',

    versandarten: {
      brief: 'Brief', einschreiben: 'Einschreiben', bote: 'Bote',
    },

    zahlung: 'Zahlung',
    vom: 'vom',

    storniertAmVor: 'Storniert am',
    storniertAmNach: '. Die betroffenen Forderungen sind dadurch wieder offen.',

    wertstellung: 'Wertstellung',
    konto: 'Konto',
    zuordnungTitel: 'Wohin sie gebucht wurde',
    keineZuordnung:
      'Diese Zahlung ist keiner Forderung zugeordnet. Das Geld ist da und '
      + 'steht in keiner Rechnung.',
    tabelleZuordnung: 'Zuordnungen dieser Zahlung mit Art, Betrag und Beleg',
    beleg: 'Beleg',
    guthabenDesKunden: 'Guthaben des Kunden',
    restOhneForderung: 'dieser Zahlung sind keiner Forderung zugeordnet.',

    stornoTitel: 'Zahlung stornieren',
    stornoGrundLabel: 'Grund — er steht später allein in den Büchern',
    stornoPlatzhalter: 'Lastschrift vom Kunden zurückgegeben',
    stornoErklaerung:
      'Die Zahlung wird nicht gelöscht (Invariante 8). Sie bleibt mit ihrem '
      + 'Grund stehen, und die Forderungen, die sie geschlossen hat, sind '
      + 'danach wieder offen.',
    stornieren: 'Stornieren',

    zuordnungsarten: {
      zahlung: 'Zahlung',
      skonto: 'Skonto (§17 UStG)',
      gebuehr: 'Bankgebühr',
      differenz: 'Abgeschriebene Differenz',
      mahngebuehr: 'Mahngebühr',
      zins: 'Verzugszinsen',
      bauabzugsteuer_einbehalt: 'Einbehalt §48 EStG',
      ueberzahlung: 'Überzahlung — als Guthaben geführt',
    },
  },

  en: {
    rechnung: 'Invoice',
    entwurf: 'Draft',
    grund: 'Reason',
    begruendung: 'Justification',
    offen: 'Open',

    titel: 'Mahnungen (dunning letters)',
    vorschlaegeTitel: 'Proposals from the run',
    keinVorschlag:
      'No proposal. Either nothing is overdue — or everything overdue is '
      + 'listed below under “Passed over”, with its reason.',
    tabelleVorschlaege:
      'Dunning proposals with customer, Mahnstufe, receivable, fee, interest and total',
    stufe: 'Mahnstufe (level)',
    forderung: 'Receivable',
    gebuehr: 'Fee',
    verzugszins: 'Default interest',
    entwuerfeAnlegen: 'Create drafts',
    entwurfOhneNummer:
      'A draft carries no number and goes nowhere. The number is assigned '
      + 'with the approval; dispatch is a step after that.',
    uebergangenTitel: 'Passed over — and why',
    tabelleUebergangen: 'Overdue receivables that are not being dunned, with the reason',
    briefeTitel: 'Dunning letters',
    keineMahnung: 'There is no Mahnung (dunning letter).',
    tabelleBriefe: 'Mahnungen with number, customer, Mahnstufe, total and state',

    mahnung: 'Mahnung',
    alleMahnungen: 'All Mahnungen',
    mahndatum: 'Date of the Mahnung',
    zahlbarBis: 'Payable by',
    positionenTitel: 'Items demanded',
    tabellePositionen:
      'Items of the Mahnung with invoice, amount, start of default, days, rate and interest',
    verzugAb: 'In default from',
    tage: 'Days',
    zinssatz: 'Rate p.a.',
    zins: 'Interest',
    mahngebuehr: 'Mahngebühr (dunning fee)',
    verzugszinsen: 'Default interest',
    gesamtbetrag: 'Total amount',
    verworfen: 'Discarded',
    freigabeErklaerung:
      'The approval records who approved exactly these amounts. Only with it '
      + 'does the database draw the number — a draft carries none.',
    freigabePlatzhalter: 'Zahlungserinnerung approved after consultation',
    verwerfen: 'Discard',
    verwerfenErklaerung:
      'The draft stays on record with its reason — nothing is deleted '
      + '(Invariant 8).',
    verwerfenPlatzhalter: 'Customer demonstrably paid the day before',
    versandTitel: 'Record dispatch',

    schreibenTitel: 'The letter',
    schreibenErklaerung:
      'This is how the Mahnung goes out: letterhead, address, text of the '
      + 'Mahnstufe, claims and mandatory company details. The letter is in German, '
      + 'as it is sent. Whoever approves it approves exactly this text.',
    schreibenOeffnen: 'Open the filed letter (PDF)',
    schreibenSigniert:
      'The letter as it was sent — the record of when default began. The link is '
      + 'a signed address that expires.',
    schreibenOhneRecht:
      'The filed letter can be opened by anyone allowed to read documents.',
    mahntextFehlt:
      'No text is stored for this Mahnstufe — the letter lists the claims only. '
      + 'It is maintained under Settings › Mahnwesen (dunning).',
    briefkopfFehlt: 'Missing from the letterhead:',
    briefkopfPflege: 'They are maintained under Settings › Unternehmensdaten (company details).',
    briefkopfAngaben: {
      anschrift: 'address',
      registergericht: 'register court',
      registernummer: 'register number',
      geschaeftsfuehrung: 'managing directors',
    },
    erledigenTitel: 'Settled',
    erledigenErklaerung:
      'The matter is closed — paid, offset, or settled some other way. The Mahnung '
      + '(dunning letter) stays on file in full; only its state says so. Whether a '
      + 'paid open item closes its Mahnung by itself is open (O-902) — until then a '
      + 'human sets it, and sees the amount while doing so.',
    erledigenKnopf: 'Mark as settled',
    versandErklaerung:
      'There is no automatic dispatch: the Mahnung goes out as a letter, as '
      + 'Einschreiben (registered post) or by courier, and what is recorded '
      + 'here is that it went out. Only after that does default run — and '
      + 'only then is the next Mahnstufe possible.',
    weg: 'Channel',
    empfaenger: 'Recipient',

    versandarten: {
      brief: 'Letter', einschreiben: 'Einschreiben (registered post)', bote: 'Courier',
    },

    zahlung: 'Payment',
    vom: 'dated',

    storniertAmVor: 'Storno (reversing entry) recorded on',
    storniertAmNach: '. The receivables concerned are open again as a result.',

    wertstellung: 'Value date',
    konto: 'Account',
    zuordnungTitel: 'Where it was booked',
    keineZuordnung:
      'This payment is not allocated to any receivable. The money is there '
      + 'and appears on no invoice.',
    tabelleZuordnung: 'Allocations of this payment with type, amount and document',
    beleg: 'Document',
    guthabenDesKunden: 'Credit balance of the customer',
    restOhneForderung: 'of this payment is not allocated to any receivable.',

    stornoTitel: 'Reverse the payment (Storno)',
    stornoGrundLabel: 'Reason — later it stands alone in the books',
    stornoPlatzhalter: 'Lastschrift (direct debit) returned by the customer',
    stornoErklaerung:
      'The payment is not deleted (Invariant 8). It stays on record with its '
      + 'reason, and the receivables it closed are open again afterwards.',
    stornieren: 'Storno (reversing entry)',

    zuordnungsarten: {
      zahlung: 'Payment',
      skonto: 'Skonto (early-payment discount, §17 UStG)',
      gebuehr: 'Bank charge',
      differenz: 'Difference written off',
      mahngebuehr: 'Mahngebühr (dunning fee)',
      zins: 'Default interest',
      bauabzugsteuer_einbehalt: 'Bauabzugsteuer retention (§48 EStG)',
      ueberzahlung: 'Overpayment — carried as a credit balance',
    },
  },
};
