/**
 * Die Kalkulation eines Angebots — Abweisungen und Kostenblöcke, in beiden
 * Sprachen (V-172, V-174, OPS-07, D-592).
 *
 * **Fachbegriffe bleiben deutsch** (`Kalkulation`, `Gemeinkosten`, `Wagnis
 * und Gewinn`, `Selbstkosten`): sie sind die Begriffe der Preisbegründung,
 * erklärt in Klammern, nicht ersetzt.
 *
 * **Die Abweisungen sind SCHLÜSSEL** der Route (`?fehler=…&feld=…`); die
 * Seite zeigt den Satz zum Schlüssel und nennt das Feld — nie den Schlüssel.
 */
import type { InternSprache } from '../intern.js';

export interface KalkulationTexte {
  readonly nichtBestaetigt: string;
  readonly fehler: Readonly<Record<string, string>>;
  /** Der Name des Feldes, das die Abweisung ausgelöst hat. */
  readonly feld: Readonly<Record<string, string>>;
  readonly imFeld: (feld: string) => string;

  /* ── Die fünf Blöcke (V-174) ───────────────────────────────────────── */
  readonly zusammensetzung: string;
  readonly zusammensetzungErklaerung: string;
  readonly block: Readonly<Record<'lohn' | 'material' | 'geraet' | 'gemeinkosten'
    | 'wagnisGewinn' | 'netto', string>>;
  /** Die Basis, auf die die Gemeinkosten rechnen — als Satz. */
  readonly basisSatz: Readonly<Record<string, string>>;
  /** Die Auswahl im Bestätigungsformular. */
  readonly basisOption: Readonly<Record<'lohn' | 'selbstkosten' | 'je_kostenart', string>>;

  /* ── Material und Gerät ────────────────────────────────────────────── */
  readonly materialTitel: string;
  readonly materialErklaerung: string;
  readonly materialLeer: string;
  readonly kostenart: Readonly<Record<string, string>>;
  readonly spalte: Readonly<Record<'kostenart' | 'bezeichnung' | 'menge' | 'einheit'
    | 'einzelpreis' | 'betrag', string>>;
  readonly zeileHinzufuegen: string;
  readonly zeileBerichtigen: string;
  readonly speichern: string;
  readonly mengeNullHinweis: string;
  readonly gesperrtFreigegeben: string;
  readonly gespeichert: string;
}

export const KALKULATION_TEXTE: Readonly<Record<InternSprache, KalkulationTexte>> = {
  de: {
    nichtBestaetigt: 'Nichts bestätigt, nichts neu gerechnet.',
    fehler: {
      keine_zahl:
        'Ein Wert ist keine gültige Zahl oder liegt außerhalb des Bereichs — Beträge in Euro '
        + '(z. B. 29,00), Mengen mit höchstens drei Nachkommastellen, die Zuschläge in Prozent '
        + 'von 0 bis 1.000, der Frequenzfaktor größer als null. Nichts davon ist negativ.',
      unvollstaendig:
        'Es fehlt eine Angabe: Stundensatz, Gemeinkostenbasis, Gemeinkosten- und '
        + 'Wagnis-/Gewinnzuschlag gehören zusammen; eine Kostenzeile braucht Art, '
        + 'Bezeichnung, Menge, Einheit und Einzelpreis.',
      eingefroren:
        'Diese Kalkulation ist festgeschrieben — das Angebot ist versendet. Ein anderer '
        + 'Preis braucht ein neues Angebot.',
      nicht_gefunden: 'Zu diesem Angebot gibt es keine Kalkulation.',
      basis_offen:
        'Gemeinkosten je Kostenart brauchen einen Satz je Kostenart, und die sind noch offen '
        + '(O-16). Bitte Lohnkosten oder Selbstkosten wählen.',
      preis_freigegeben:
        'Der Preis dieses Angebots ist freigegeben. Eine Kostenzeile änderte ihn — ein anderer '
        + 'Preis braucht eine neue Angebotsversion (O-732).',
      ohne_lohn:
        'Material und Gerät brauchen eine Leistungszeile mit Lohn, die sie im Angebot trägt — '
        + 'diese Kalkulation hat keine.',
    },
    feld: {
      stundensatz: 'Stundenverrechnungssatz',
      gemeinkosten: 'Gemeinkostenzuschlag',
      wagnisGewinn: 'Wagnis und Gewinn',
      frequenzFaktor: 'Frequenzfaktor',
      gemeinkostenBasis: 'Gemeinkosten rechnen auf',
      kostenart: 'Art',
      bezeichnung: 'Bezeichnung',
      menge: 'Menge',
      einheit: 'Einheit',
      einzelpreis: 'Einzelpreis',
    },
    imFeld: (feld) => `Betroffen: ${feld}.`,

    zusammensetzung: 'Woraus der Preis besteht',
    zusammensetzungErklaerung:
      'Die fünf Kostenblöcke dieser Kalkulation (OPS-07). Material und Gerät sind die Summe '
      + 'der unten erfassten Zeilen — vorbelegt wird nichts.',
    block: {
      lohn: 'Lohnkosten',
      material: 'Material',
      geraet: 'Gerät',
      gemeinkosten: 'Gemeinkosten',
      wagnisGewinn: 'Wagnis und Gewinn',
      netto: 'Angebotssumme netto',
    },
    basisSatz: {
      lohn: 'Die Gemeinkosten rechnen auf die Lohnkosten.',
      selbstkosten: 'Die Gemeinkosten rechnen auf Lohn, Material und Gerät zusammen.',
      je_kostenart: 'Gemeinkosten je Kostenart sind offen (O-16) — so wird nicht gerechnet.',
    },
    basisOption: {
      lohn: 'Lohnkosten',
      selbstkosten: 'Selbstkosten (Lohn + Material + Gerät)',
      je_kostenart: 'je Kostenart — offen (O-16)',
    },

    materialTitel: 'Material und Gerät',
    materialErklaerung:
      'Reinigungsmittel, Verbrauchsmaterial, Maschinen — je Zeile Menge × Einzelpreis, '
      + 'eingetragen von Ihnen, nie geschätzt. Die Summe geht in den Preis und wird wie '
      + 'Gemeinkosten, Wagnis und Gewinn anteilig auf die Leistungszeilen verteilt (O-208). '
      + 'Nach jeder Zeile rechnet die Kalkulation den Preis neu.',
    materialLeer:
      'Noch keine Material- oder Gerätekosten erfasst — der Preis enthält nur Lohn und '
      + 'Zuschläge.',
    kostenart: { material: 'Material', geraet: 'Gerät' },
    spalte: {
      kostenart: 'Art', bezeichnung: 'Bezeichnung', menge: 'Menge', einheit: 'Einheit',
      einzelpreis: 'Einzelpreis', betrag: 'Betrag',
    },
    zeileHinzufuegen: 'Zeile hinzufügen',
    zeileBerichtigen: 'Berichtigen',
    speichern: 'Speichern und neu rechnen',
    mengeNullHinweis:
      'Gelöscht wird nichts: eine Zeile, die nicht mehr gelten soll, bekommt die Menge 0 und '
      + 'bleibt als Beleg stehen.',
    gesperrtFreigegeben:
      'Der Preis ist freigegeben. Material und Gerät lassen sich hier nicht mehr ändern — '
      + 'ein anderer Preis braucht eine neue Angebotsversion (O-732).',
    gespeichert: 'Die Kostenzeile ist gespeichert, der Preis neu gerechnet.',
  },
  en: {
    nichtBestaetigt: 'Nothing was confirmed and nothing recalculated.',
    fehler: {
      keine_zahl:
        'A value is not a valid number or is out of range — amounts in euro (e.g. 29,00), '
        + 'quantities with at most three decimals, the surcharges in percent from 0 to 1,000, '
        + 'the frequency factor above zero. None of them is negative.',
      unvollstaendig:
        'A value is missing: hourly rate, overhead base, overhead surcharge and risk/profit '
        + 'surcharge belong together; a cost line needs kind, name, quantity, unit and unit '
        + 'price.',
      eingefroren:
        'This Kalkulation (costing) is locked — the offer has been sent. A different price '
        + 'needs a new offer.',
      nicht_gefunden: 'There is no Kalkulation (costing) for this offer.',
      basis_offen:
        'Overhead per cost type needs a rate per cost type, and those are still open (O-16). '
        + 'Please choose labour cost or Selbstkosten (prime cost).',
      preis_freigegeben:
        'The price of this offer has been released. A cost line would change it — a '
        + 'different price needs a new offer version (O-732).',
      ohne_lohn:
        'Material and equipment need a service line with labour that carries them in the '
        + 'offer — this costing has none.',
    },
    feld: {
      stundensatz: 'Hourly charge-out rate',
      gemeinkosten: 'Gemeinkosten (overhead) surcharge',
      wagnisGewinn: 'Wagnis und Gewinn (risk and profit)',
      frequenzFaktor: 'Frequency factor',
      gemeinkostenBasis: 'Overhead is charged on',
      kostenart: 'Kind',
      bezeichnung: 'Name',
      menge: 'Quantity',
      einheit: 'Unit',
      einzelpreis: 'Unit price',
    },
    imFeld: (feld) => `Affected: ${feld}.`,

    zusammensetzung: 'What the price is made of',
    zusammensetzungErklaerung:
      'The five cost blocks of this Kalkulation (OPS-07). Material and equipment are the sum '
      + 'of the lines entered below — nothing is pre-filled.',
    block: {
      lohn: 'Labour cost',
      material: 'Material',
      geraet: 'Equipment',
      gemeinkosten: 'Gemeinkosten (overhead)',
      wagnisGewinn: 'Wagnis und Gewinn (risk and profit)',
      netto: 'Offer total, net',
    },
    basisSatz: {
      lohn: 'Overhead is charged on labour cost.',
      selbstkosten: 'Overhead is charged on labour, material and equipment together.',
      je_kostenart: 'Overhead per cost type is open (O-16) — it is not calculated that way.',
    },
    basisOption: {
      lohn: 'Labour cost',
      selbstkosten: 'Selbstkosten (labour + material + equipment)',
      je_kostenart: 'per cost type — open (O-16)',
    },

    materialTitel: 'Material and equipment',
    materialErklaerung:
      'Cleaning agents, consumables, machines — each line quantity × unit price, entered by '
      + 'you, never estimated. The total goes into the price and, like overhead, risk and '
      + 'profit, is spread proportionally over the service lines (O-208). After each line the '
      + 'costing recalculates the price.',
    materialLeer:
      'No material or equipment cost entered yet — the price contains labour and surcharges '
      + 'only.',
    kostenart: { material: 'Material', geraet: 'Equipment' },
    spalte: {
      kostenart: 'Kind', bezeichnung: 'Name', menge: 'Quantity', einheit: 'Unit',
      einzelpreis: 'Unit price', betrag: 'Amount',
    },
    zeileHinzufuegen: 'Add line',
    zeileBerichtigen: 'Correct',
    speichern: 'Save and recalculate',
    mengeNullHinweis:
      'Nothing is deleted: a line that should no longer count gets quantity 0 and stays as a '
      + 'record.',
    gesperrtFreigegeben:
      'The price has been released. Material and equipment can no longer be changed here — a '
      + 'different price needs a new offer version (O-732).',
    gespeichert: 'The cost line has been saved and the price recalculated.',
  },
};
