import 'server-only';
import { cent, type Cent } from '../geld.js';

/**
 * **Ob ein Skonto gewaehrt wird, hat niemand entschieden — und deshalb wird
 * keiner angeboten.**
 *
 * // TODO(client, O-177): Werden Skonti gewaehrt — in welcher Hoehe, mit
 * welcher Frist, und ab welcher Differenz gilt eine Unterzahlung als
 * Skontoabzug statt als offener Restbetrag?
 *
 * **Warum die Toleranz 0 ist und nicht „ein paar Cent".** Die Toleranz
 * entscheidet, wann eine Unterzahlung dem Erfassenden als Skonto VORGESCHLAGEN
 * wird. Jeder Wert groesser null ist eine Vertragsklausel: er erliesse dem
 * Kunden Geld, das er schuldet, und er taete es still. Mit 0 bleibt jede
 * Unterzahlung ein offener Rest — sichtbar, mahnbar, und von einem Menschen
 * ausdruecklich als Skonto zu buchen, wenn sie einer ist.
 *
 * Die Richtung ist bewusst gewaehlt: ohne Entscheidung wird nichts erlassen.
 * Andersherum verschwaende die Gruppe Geld, das niemand vereinbart hat.
 */
export interface SkontoRegel {
  /** Ab welcher Unterzahlung ein Skonto vorgeschlagen wird. */
  readonly toleranzCent: Cent;
  readonly herkunft: string;
  readonly istPlatzhalter: boolean;
}

export const SKONTO_PLATZHALTER: SkontoRegel = {
  toleranzCent: cent(0n),
  herkunft:
    'Nicht entschieden (O-177). Jede Unterzahlung bleibt ein offener Rest, bis '
    + 'ein Mensch sie ausdruecklich als Skonto bucht.',
  istPlatzhalter: true,
};
