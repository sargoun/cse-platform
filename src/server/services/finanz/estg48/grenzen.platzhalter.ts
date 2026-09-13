import 'server-only';

/**
 * **Die Bagatellgrenzen des §48 Abs. 2 EStG — als PLATZHALTER.**
 *
 * // TODO(client, O-21): §48 EStG knüpft im Gesetzeswortlaut an die
 * Gegenleistung (Zahlung) an, SPEC FIN-10 an das Leistungsdatum — welchen
 * Stichtag muss die Plattform anwenden? Und gelten die Bagatellgrenzen des
 * §48 Abs. 2 EStG (5.000 € bzw. 15.000 € je Leistungsempfänger und Kalenderjahr)
 * für diese Gruppe, und wer zählt als Leistungsempfänger im Sinne der Norm?
 *
 * **`grenzeCent: null` ist die einzige Belegung, die hier stehen darf.** Die
 * Zahlen des Gesetzes sind bekannt; was NICHT bekannt ist, ist, ob und wie die
 * Gruppe sie anwendet — sie hängen daran, ob der Leistungsempfänger nur
 * steuerfreie Vermietungsumsätze erbringt, und diese Frage beantwortet kein
 * Feld im Kundenstamm.
 *
 * Die Richtung ist bewusst gewählt: ohne Grenze wird **immer** einbehalten.
 * Das ist die Seite, die nicht haftet (§48a Abs. 3 EStG) und die der Kunde
 * über seine Anrechnung zurückholt. Andersherum stünde eine nicht einbehaltene
 * Steuer im Raum, für die die Gruppe geradesteht.
 */
export interface Bagatellgrenze {
  /** `null` = keine angewandt, es wird immer einbehalten. */
  readonly grenzeCent: bigint | null;
  readonly fundstelle: string;
  readonly herkunft: string;
  readonly istPlatzhalter: boolean;
}

export const BAGATELLGRENZE_PLATZHALTER: Bagatellgrenze = {
  grenzeCent: null,
  fundstelle: '§48 Abs. 2 EStG',
  herkunft:
    'Nicht entschieden (O-21). Es wird ohne Bagatellgrenze einbehalten, bis der '
    + 'Steuerberater bestätigt hat, ob und für welche Leistungsempfänger die '
    + 'Grenzen des §48 Abs. 2 EStG anzuwenden sind.',
  istPlatzhalter: true,
};

/**
 * Der Stichtag, an dem §48 EStG und §13b UStG bewertet werden.
 *
 * **Bis O-21 beantwortet ist: `leistung_bis`.** Das ist die Fassung, die
 * `02-datenmodell/05-FINANZEN.md` §4.1 festhält, und sie ist EIN injizierter
 * Parameter — die Antwort ist eine Zeile hier plus ein Test, kein Umbau. Der
 * gewählte Wert wird auf der Rechnung gespeichert
 * (`bauabzugsteuer_satz_bp`, `freistellungsbescheinigung_id`), damit
 * nachvollziehbar bleibt, wonach entschieden wurde.
 */
export type StichtagQuelle = 'leistung_bis' | 'rechnungsdatum' | 'zahlung';

export const STICHTAG_QUELLE: StichtagQuelle = 'leistung_bis';
