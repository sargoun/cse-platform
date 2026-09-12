import type { ZinsMethode } from './zins.js';

/**
 * **Wie gemahnt wird, hat niemand entschieden — und deshalb wird nicht
 * gemahnt.**
 *
 * // TODO(client, O-19): Wie viele Mahnstufen, in welchen Abständen, mit
 * welcher Gebühr je Stufe, und werden Verzugszinsen erhoben (§288 BGB: B2B
 * Basiszins + 9 Prozentpunkte, B2C + 5 Prozentpunkte) oder darauf verzichtet?
 * Ab wann läuft der Verzug — mit Fälligkeit, erst nach der ersten Mahnung,
 * oder dreissig Tage nach Zugang der Rechnung (§286 Abs. 3 BGB)? Und nach
 * welcher Tageszählung wird gerechnet?
 *
 * **Die Richtung ist bewusst gewählt.** Ohne Entscheidung wird NICHT gemahnt:
 * `mahnstufe.ist_platzhalter` steht auf `true`, der Lauf erzeugt nichts, und
 * die Oberfläche sagt warum. Andersherum ginge ein Brief mit einer geratenen
 * Gebühr an einen echten Kunden — und eine Mahngebühr ohne Vereinbarung ist
 * eine Forderung ohne Grundlage, die die Gruppe nicht mehr zurückholt.
 *
 * **Die gesetzlichen Aufschläge stehen hier trotzdem**, weil sie im Gesetz
 * stehen und nicht in einer Vereinbarung: §288 Abs. 1 BGB fünf, Abs. 2 neun
 * Prozentpunkte über dem Basiszins. Was offen ist, ist NICHT ihre Höhe,
 * sondern ob und auf wen sie angewandt werden.
 */

/** §288 Abs. 1 BGB — gegenüber einem Verbraucher. */
export const AUFSCHLAG_B2C_BP = 500;
/** §288 Abs. 2 BGB — wenn kein Verbraucher beteiligt ist. */
export const AUFSCHLAG_B2B_BP = 900;

export interface MahnRegel {
  /** Wie viele Stufen die Gruppe führt. `null` heisst: nicht entschieden. */
  readonly stufen: number | null;
  /** Die Gebühr je Stufe in Cent. Leer heisst: keine, weil keine vereinbart. */
  readonly gebuehrCent: readonly bigint[];
  /** Die Tageszählung. `null` heisst: es wird kein Zins gerechnet. */
  readonly zinsMethode: ZinsMethode | null;
  readonly herkunft: string;
  readonly istPlatzhalter: boolean;
}

export const MAHNREGEL_PLATZHALTER: MahnRegel = {
  stufen: null,
  gebuehrCent: [],
  zinsMethode: null,
  herkunft:
    'Nicht entschieden (O-19). Solange keine Stufe bestätigt ist, erzeugt der '
    + 'Mahnlauf keinen Entwurf; wo eine bestätigte Stufe ohne Zinsart steht, '
    + 'nennt der Brief nur die Hauptforderung.',
  istPlatzhalter: true,
};
