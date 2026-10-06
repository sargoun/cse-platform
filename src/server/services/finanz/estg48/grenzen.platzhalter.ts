import 'server-only';

/**
 * **Die Bagatellgrenzen des §48 Abs. 2 EStG — Voreinstellung: nicht
 * automatisch angewandt (O-21, D-779).**
 *
 * // TODO(client, O-21): Voreinstellung (D-779) — die Bagatellgrenze wird nicht
 * automatisch angewandt: ohne gültige Freistellungsbescheinigung wird
 * einbehalten, die Jahressumme steht zur Prüfung; Stichtag ist das
 * Leistungsende (`STICHTAG_QUELLE`).
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
    'Voreinstellung (O-21): die Bagatellgrenze des § 48 Abs. 2 EStG (5.000 € je '
    + 'Leistendem und Jahr) wird nicht automatisch angewandt — ohne gültige '
    + 'Freistellungsbescheinigung wird einbehalten, die Jahressumme steht zur Prüfung.',
  istPlatzhalter: true,
};

/**
 * Der Stichtag, an dem §48 EStG und §13b UStG bewertet werden.
 *
 * **Voreinstellung (O-21, D-779): `leistung_bis`.** Das ist die Fassung, die
 * `02-datenmodell/05-FINANZEN.md` §4.1 festhält, und sie ist EIN injizierter
 * Parameter — die Antwort ist eine Zeile hier plus ein Test, kein Umbau. Der
 * gewählte Wert wird auf der Rechnung gespeichert
 * (`bauabzugsteuer_satz_bp`, `freistellungsbescheinigung_id`), damit
 * nachvollziehbar bleibt, wonach entschieden wurde.
 */
export type StichtagQuelle = 'leistung_bis' | 'rechnungsdatum' | 'zahlung';

export const STICHTAG_QUELLE: StichtagQuelle = 'leistung_bis';
