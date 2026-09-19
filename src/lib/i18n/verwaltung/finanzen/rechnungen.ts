/**
 * `/[mandant]/finanzen/rechnungen` und `/rechnungen/neu` — in beiden Sprachen.
 *
 * **Das Ausgangsbuch und der Entwurf stehen in EINER Datei**, weil sie
 * dieselbe Teilflaeche sind: wer die Liste oeffnet, legt von dort den Entwurf
 * an und kommt ueber denselben Verweis zurueck. Die Einzelrechnung
 * (`/rechnungen/[id]` mit ihren neun Unterseiten) ist eine eigene Teilflaeche
 * und bekommt ihre eigene Datei — der Schnitt laeuft entlang der Arbeit, wie
 * in `zahlungen.ts` beschrieben.
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text** (siehe
 * `../basis.ts`): `Festschreibung`, `Storno`, `Abschlag`, `Schlussrechnung`
 * und `Nummernkreis` tragen Bedeutung aus UStG, GoBD und VOB. Wo einer stehen
 * bleibt, steht die Erklaerung in Klammern daneben — nie eine erfundene
 * Entsprechung. `Abgeschlossen` statt `Festgeschrieben` in der Pille ist eine
 * andere Sache: das ist DESIGN §5 und steht in der Seite, nicht hier.
 *
 * **Die deutschen Zeichenketten sind WORTGLEICH mit denen, die vorher im
 * Seitenrumpf standen.** `tests/e2e/rechnung.spec.ts`,
 * `ausgangsbuch.spec.ts`, `mahnung.spec.ts` und `zahlung.spec.ts` greifen
 * „Entwurf anlegen", „Neuer Entwurf" und „ohne — Entwurf" ueber ihre
 * Beschriftung. Ein besseres deutsches Wort waere hier ein gebrochener
 * Browsertest in vier Dateien — und die Umstellung soll die Sprache
 * beweglich machen, nicht den Text aendern.
 */
import type { InternSprache } from '../../intern.js';

export interface RechnungenTexte {
  /* ── Das Ausgangsbuch ──────────────────────────────────────────────── */
  readonly titel: string;
  readonly monatFilter: string;
  readonly alleZeigen: string;
  readonly neuerEntwurf: string;
  readonly keineRechnung: string;
  readonly tabelle: string;
  readonly ohneNummer: string;
  readonly brutto: string;
  readonly aufgehobenDurch: string;

  /**
   * Die Rechnungsarten — `rechnungsart`-Enum aus 0121.
   *
   * Der Schluessel ist der Enum-Wert und bleibt unangetastet; nur die
   * Beschriftung wechselt die Sprache.
   */
  readonly artNamen: Readonly<Record<
    'standard' | 'abschlag' | 'anzahlung' | 'schluss' | 'storno', string>>;

  /* ── Der neue Entwurf ──────────────────────────────────────────────── */
  readonly neuTitel: string;
  readonly alleRechnungen: string;
  readonly keinNummernkreis: string;

  /**
   * Der Platzhalter-Hinweis in drei Stuecken: zwischen ihnen stehen die
   * Bezeichnung des Kreises und die Maske als `<code>`. Ein einziger Satz
   * mit Platzhaltern koennte das Kursiv-Element nicht tragen.
   */
  readonly platzhalterVor: string;
  readonly platzhalterMitte: string;
  readonly platzhalterEnde: string;

  readonly ohneKunden: string;
  readonly leistungsort: string;
  readonly ohneFestenOrt: string;
  readonly leistungVon: string;
  readonly leistungBis: string;
  readonly zahlungsziel: string;
  readonly zahlungszielHinweis: string;
  readonly zahlungsart: string;
  readonly nichtAngegeben: string;
  readonly zahlungsartHinweis: string;
  readonly kopftext: string;
  readonly entwurfAnlegen: string;
}

export const RECHNUNGEN_TEXTE: Readonly<Record<InternSprache, RechnungenTexte>> = {
  de: {
    titel: 'Rechnungen',
    monatFilter: 'Rechnungsdatum im Monat',
    alleZeigen: 'alle zeigen',
    neuerEntwurf: 'Neuer Entwurf',
    keineRechnung:
      'Noch keine Rechnung. Ein Entwurf trägt keine Nummer — die entsteht '
      + 'erst beim Festschreiben, und deshalb hinterlässt ein verworfener '
      + 'Entwurf auch keine Lücke.',
    tabelle: 'Rechnungen dieser Gesellschaft mit Nummer, Kunde, Betrag und Zustand',
    ohneNummer: 'ohne — Entwurf',
    brutto: 'Brutto',
    aufgehobenDurch: 'aufgehoben durch',

    artNamen: {
      standard: 'Rechnung', abschlag: 'Abschlag', anzahlung: 'Anzahlung',
      schluss: 'Schlussrechnung', storno: 'Storno',
    },

    neuTitel: 'Neue Rechnung',
    alleRechnungen: 'Alle Rechnungen',
    keinNummernkreis:
      'Diese Gesellschaft hat keinen offenen Rechnungsnummernkreis. Ein '
      + 'Entwurf lässt sich anlegen, festschreiben aber nicht — die Nummer '
      + 'käme aus keinem Kreis (O-01, O-134).',

    platzhalterVor: 'Unbestätigter Wert: der Kreis „',
    platzhalterMitte: '" führt die Maske',
    platzhalterEnde:
      'als Platzhalter. Bis jemand sie bestätigt, wird keine Nummer daraus '
      + 'vergeben (O-134).',

    ohneKunden: 'Ohne Kunden keine Rechnung. Zuerst einen Kunden anlegen.',
    leistungsort: 'Leistungsort (Objekt)',
    ohneFestenOrt: '— ohne festen Ort —',
    leistungVon: 'Leistung von',
    leistungBis: 'Leistung bis',
    zahlungsziel: 'Zahlungsziel (Tage)',
    zahlungszielHinweis:
      'Leer lassen: dann wird die Kundenkondition oder die Einstellung der '
      + 'Gesellschaft genommen. Es gibt keinen Vorgabewert (O-66).',
    zahlungsart: 'Zahlungsart',
    nichtAngegeben: '— nicht angegeben —',
    zahlungsartHinweis:
      'UNTDID 4461. Für einen Kunden mit XRechnungspflicht ist die Angabe '
      + 'verpflichtend (BR-DE-1); ohne sie lässt sich der Beleg nicht '
      + 'festschreiben.',
    kopftext: 'Kopftext',
    entwurfAnlegen: 'Entwurf anlegen',
  },

  en: {
    titel: 'Invoices',
    monatFilter: 'Invoice date in month',
    alleZeigen: 'show all',
    neuerEntwurf: 'New draft',
    keineRechnung:
      'No invoice yet. A draft carries no number — the number is assigned '
      + 'only at Festschreibung (finalisation), and that is why a discarded '
      + 'draft leaves no gap.',
    tabelle: 'Invoices of this company with number, customer, amount and state',
    ohneNummer: 'none — draft',
    brutto: 'Gross',
    aufgehobenDurch: 'reversed by Storno',

    artNamen: {
      standard: 'Invoice', abschlag: 'Abschlag (interim invoice)',
      anzahlung: 'Anzahlung (advance payment)',
      schluss: 'Schlussrechnung (final invoice)', storno: 'Storno (reversing entry)',
    },

    neuTitel: 'New invoice',
    alleRechnungen: 'All invoices',
    keinNummernkreis:
      'This company has no open invoice number range (Nummernkreis). A draft '
      + 'can be created but not finalised (festgeschrieben) — the number '
      + 'would come from no range (O-01, O-134).',

    platzhalterVor: 'Unconfirmed value: the number range (Nummernkreis) “',
    platzhalterMitte: '” carries the mask',
    platzhalterEnde:
      'as a placeholder. Until someone confirms it, no number is issued from '
      + 'it (O-134).',

    ohneKunden: 'No invoice without a customer. Create a customer first.',
    leistungsort: 'Place of performance (site)',
    ohneFestenOrt: '— no fixed place —',
    leistungVon: 'Supply period from',
    leistungBis: 'Supply period to',
    zahlungsziel: 'Payment term (days)',
    zahlungszielHinweis:
      'Leave blank: the customer terms or the company setting are then used. '
      + 'There is no default value (O-66).',
    zahlungsart: 'Payment method',
    nichtAngegeben: '— not specified —',
    zahlungsartHinweis:
      'UNTDID 4461. For a customer subject to XRechnung the entry is '
      + 'mandatory (BR-DE-1); without it the document cannot be finalised '
      + '(festgeschrieben).',
    kopftext: 'Header text',
    entwurfAnlegen: 'Create draft',
  },
};
