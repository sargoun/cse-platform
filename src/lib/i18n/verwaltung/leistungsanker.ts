/**
 * Die Wörter des Abrechnungsankers einer Schicht — in beiden Sprachen
 * (TIM-12, FIN-07, V-191, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.**
 * „Leistungszeile", „Auftrag", „Turnus" und „Posten" tragen Bedeutung aus
 * Vertrag und Abrechnung; erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

/** Die Gründe, aus denen ein Anker abgewiesen wird (`LeistungsankerFehler`, Schicht). */
export const LEISTUNGSANKER_GRUENDE = [
  'leistung_unbekannt', 'leistung_beendet', 'leistung_anderer_auftrag',
  'nicht_manuell', 'leistung_hat_zeiten',
] as const;
export type LeistungsankerAbweisung = (typeof LEISTUNGSANKER_GRUENDE)[number];

export interface LeistungsankerTexte {
  readonly feld: string;
  readonly ohne: string;
  readonly position: string;
  readonly beendet: string;
  /**
   * Der bisherige Anker, wenn er in der Liste fehlt (V-192) — er bleibt
   * gewählt, statt dass „ohne" ihn beim Speichern löst.
   */
  readonly bisherNichtGelistet: string;
  readonly erklaerung: string;
  readonly keinLeserecht: string;
  readonly bleibt: string;
  readonly keineZeilen: string;
  readonly speichern: string;
  readonly gesetzt: string;
  readonly nurOhneZeit: string;
  readonly fehler: Readonly<Record<LeistungsankerAbweisung, string>>;
}

export const LEISTUNGSANKER_TEXTE: Readonly<Record<InternSprache, LeistungsankerTexte>> = {
  de: {
    feld: 'Leistungszeile (Abrechnung)',
    ohne: 'ohne Leistungszeile — die Zeit hängt an keiner Abrechnung',
    position: 'Pos.',
    beendet: 'beendet',
    bisherNichtGelistet: 'bisherige Leistungszeile (bleibt, wie sie ist)',
    erklaerung:
      'Jede Stunde auf diesen Schichten übernimmt die Leistungszeile beim Erfassen. Ohne '
      + 'sie steht sie unter „Zeit ohne Auftrag" und in keiner Stundenabrechnung. Schon '
      + 'erfasste Zeit behält, was sie hatte.',
    keinLeserecht: 'Leistungszeilen sieht nur, wer Aufträge lesen darf:',
    bleibt: 'Die Leistungszeile bleibt, wie sie ist.',
    keineZeilen:
      'Es gibt keine laufende Leistungszeile. Sie entsteht am Auftrag — ohne sie hängt die '
      + 'Zeit an keiner Abrechnung.',
    speichern: 'Leistungszeile speichern',
    gesetzt:
      'Die Leistungszeile ist gespeichert. Künftige Schichten ohne erfasste Zeit tragen sie.',
    nurOhneZeit:
      'Die Leistungszeile einer Einzelschicht lässt sich ändern, solange auf ihr keine Zeit '
      + 'erfasst ist.',
    fehler: {
      leistung_unbekannt:
        'Diese Leistungszeile gibt es in dieser Gesellschaft nicht, oder sie ist für Sie nicht '
        + 'sichtbar. Nichts wurde gespeichert.',
      leistung_beendet:
        'Diese Leistungszeile gilt nicht mehr, oder ihr Auftrag ist storniert. Nichts wurde '
        + 'gespeichert.',
      leistung_anderer_auftrag:
        'Diese Leistungszeile gehört zu einem anderen Auftrag als dem, den die Schicht nennt. '
        + 'Nichts wurde gespeichert.',
      nicht_manuell:
        'Eine Serienschicht trägt die Leistungszeile ihres Turnus oder Postens — ändern Sie '
        + 'sie dort.',
      leistung_hat_zeiten:
        'Auf dieser Schicht ist schon Zeit erfasst; ihre Einträge haben die Leistungszeile '
        + 'übernommen, die die Schicht damals trug. Nichts wurde gespeichert.',
    },
  },
  en: {
    feld: 'Leistungszeile (billing line)',
    ohne: 'no Leistungszeile — the time is not attached to any billing',
    position: 'item',
    beendet: 'ended',
    bisherNichtGelistet: 'current Leistungszeile (stays as it is)',
    erklaerung:
      'Every hour recorded on these shifts takes over the Leistungszeile when it is recorded. '
      + 'Without one it is listed under "time without an order" and in no hourly billing. '
      + 'Time already recorded keeps what it had.',
    keinLeserecht: 'Only people who may read orders see billing lines:',
    bleibt: 'The Leistungszeile stays as it is.',
    keineZeilen:
      'There is no current Leistungszeile. It is created on the Auftrag (order) — without one '
      + 'the time is not attached to any billing.',
    speichern: 'Save Leistungszeile',
    gesetzt: 'The Leistungszeile is saved. Future shifts without recorded time carry it.',
    nurOhneZeit:
      'The Leistungszeile of a single shift can be changed as long as no time is recorded on it.',
    fehler: {
      leistung_unbekannt:
        'This Leistungszeile does not exist in this Gesellschaft, or it is not visible to you. '
        + 'Nothing was saved.',
      leistung_beendet:
        'This Leistungszeile is no longer valid, or its Auftrag is cancelled. Nothing was saved.',
      leistung_anderer_auftrag:
        'This Leistungszeile belongs to a different Auftrag than the one the shift names. '
        + 'Nothing was saved.',
      nicht_manuell:
        'A shift from a series carries the Leistungszeile of its Turnus or Posten — change it '
        + 'there.',
      leistung_hat_zeiten:
        'Time has already been recorded on this shift; its entries took over the '
        + 'Leistungszeile the shift carried then. Nothing was saved.',
    },
  },
};
