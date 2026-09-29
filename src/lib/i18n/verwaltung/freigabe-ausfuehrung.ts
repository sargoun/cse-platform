/**
 * Warum die AUSFÜHRUNG einer genehmigten Freigabe abgewiesen wurde — als
 * SATZ, nachgeschlagen nach einem GRUND (D-769, D-774, D-728).
 *
 * **Der Befund.** `POST /api/freigaben/[id]/entscheidung` schickte bei einer
 * abgewiesenen Übernahme `?fehler=ausfuehrung` und den Satz des Dienstes als
 * `?meldung=`; das Blatt zeigte ihn roh — also auch jeden Text eines
 * präparierten Links, unter „Nicht entschieden.". Der Grund lag die ganze Zeit
 * an `AusfuehrungAbgewiesen`, geschickt wurde er nur einem Programm.
 *
 * **Die Entscheidung rollt mit zurück** (dieselbe Transaktion, §4.8): jeder
 * Satz sagt deshalb, dass sie nicht gespeichert ist, wo das nicht schon aus
 * dem Grund folgt.
 *
 * **Deutsch, in der Form der zweisprachigen Tabellen.** Das Blatt steht auf
 * der Ausnahmeliste der Übersetzungswache; kommt es herunter, ergänzt die
 * Umstellung hier nur `en`. Die Sätze der ENTSCHEIDUNG stehen weiter in
 * `FEHLER_TEXT` neben dem Blatt (`freigaben/darstellung.ts`).
 */

/** Jeder Grund einer abgewiesenen Ausführung — `ausfuehrung_` und der Grund von `AusfuehrungAbgewiesen`. */
export const AUSFUEHRUNG_FEHLER_GRUENDE = [
  'ausfuehrung_keine_erechnung', 'ausfuehrung_nicht_gefunden', 'ausfuehrung_nicht_genehmigt',
  'ausfuehrung_unvollstaendig', 'ausfuehrung_schon_uebernommen', 'ausfuehrung_kein_recht',
] as const;
export type AusfuehrungFehlerGrund = (typeof AUSFUEHRUNG_FEHLER_GRUENDE)[number];

export interface AusfuehrungRueckwegTexte {
  readonly fehler: Readonly<Record<AusfuehrungFehlerGrund, string>>;
}

export const AUSFUEHRUNG_RUECKWEG_TEXTE: Readonly<Record<'de', AusfuehrungRueckwegTexte>> = {
  de: {
    fehler: {
      ausfuehrung_unvollstaendig:
        'Die Übernahme ging nicht: im Vorschlag fehlen Lieferant, Nummer, Datum oder Beträge, er '
        + 'lautet auf eine Fremdwährung, oder eine Steuerzeile hat keine eindeutige '
        + 'Steuersatzgruppe (O-363). Er lässt sich nur von Hand erfassen; die Entscheidung wurde '
        + 'nicht gespeichert.',
      ausfuehrung_kein_recht:
        'Die Übernahme legt eine Eingangsrechnung an — das tut nur, wer Eingangsrechnungen '
        + 'erfassen darf, und diesem Konto fehlt das. Die Entscheidung wurde nicht gespeichert.',
      ausfuehrung_nicht_genehmigt:
        'Übernommen wird nur eine genehmigte Freigabe; diese steht inzwischen anders — die Seite '
        + 'zeigt den aktuellen Stand.',
      ausfuehrung_nicht_gefunden:
        'Die Freigabe ist nicht mehr erreichbar. Die Entscheidung wurde nicht gespeichert.',
      ausfuehrung_schon_uebernommen:
        'Dieser Vorschlag ist schon übernommen — die Eingangsrechnung gibt es bereits.',
      ausfuehrung_keine_erechnung:
        'Der Vorschlag trägt keine lesbare E-Rechnung, übernommen wird nichts. Die Entscheidung '
        + 'wurde nicht gespeichert.',
    },
  },
};
