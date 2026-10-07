/**
 * Der interne Vorlauf einer Vergabemappe (V-307, O-112, D-786, D-839).
 *
 * Die amtliche Frist steht an der Bekanntmachung (`ausschreibung.frist_angebot`).
 * Bis zu ihr muss die Mappe nicht nur vollständig, sondern auch hochgeladen
 * sein — und dazwischen liegen Prüfung, Freigabe und eine Plattform, die am
 * letzten Tag gern langsam ist. Der Vorlauf ist der Tag, an dem die Mappe
 * intern fertig sein muss.
 *
 * // TODO(client, O-112): Voreinstellung — fünf Werktage interner Vorlauf vor
 * der amtlichen Frist, dieselbe Zahl wie die Fristwarnung des Radars
 * (`FRIST_KNAPP_TAGE`, RAD-06); Werktag ist Montag bis Freitag ohne
 * gesetzlichen Feiertag in Berlin (`lib/datum/werktage.ts`). D-786, D-839.
 *
 * **Gerechnet, nicht gespeichert.** Die Frist kann sich ändern (eine
 * Bieterfrage verlängert sie); ein gespeicherter Vorlauftag liefe ihr nicht
 * nach. Er entsteht deshalb bei jedem Lesen aus der Frist, die gerade gilt.
 */
import { werktageVor } from '../../../lib/datum/werktage.js';

/** Voreinstellung (O-112): fünf Werktage. */
export const VORLAUF_WERKTAGE = 5;

/**
 * Wo die Mappe gegenüber ihrem Vorlauf steht.
 *
 * - `offen` — der interne Tag liegt noch vor uns;
 * - `heute` — heute ist der interne Tag;
 * - `ueberschritten` — der interne Tag ist vorbei, die Mappe ist es nicht;
 * - `erledigt` — die Mappe ist vollständig, freigegeben oder eingereicht.
 */
export type VorlaufStand = 'offen' | 'heute' | 'ueberschritten' | 'erledigt';

export interface InternerVorlauf {
  /** Der Berliner Kalendertag, an dem die Mappe intern fertig sein muss. */
  readonly internFaelligAm: string;
  readonly stand: VorlaufStand;
  readonly werktage: number;
}

/** Die Mappenstände, in denen die interne Arbeit getan ist. */
const ERLEDIGT: ReadonlySet<string> = new Set(['vollstaendig', 'freigegeben', 'eingereicht']);

/**
 * Der Vorlauf zu einer Frist. `fristTag` und `heute` sind Berliner
 * Kalendertage (`JJJJ-MM-TT`) — die Uhrzeit der Frist spielt keine Rolle:
 * fünf Werktage vor einer Frist um 10 Uhr sind dieselben wie vor einer um
 * 23:59 Uhr. Ohne Frist oder für eine verworfene Mappe: `null`.
 */
export function internerVorlauf(
  fristTag: string | null, heute: string, mappenstand: string,
): InternerVorlauf | null {
  if (fristTag === null || mappenstand === 'verworfen') return null;
  const internFaelligAm = werktageVor(fristTag, VORLAUF_WERKTAGE);
  const stand: VorlaufStand = ERLEDIGT.has(mappenstand) ? 'erledigt'
    : heute < internFaelligAm ? 'offen'
      : heute === internFaelligAm ? 'heute' : 'ueberschritten';
  return { internFaelligAm, stand, werktage: VORLAUF_WERKTAGE };
}
