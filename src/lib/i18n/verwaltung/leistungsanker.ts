/**
 * Die Wörter des Abrechnungsankers einer Schicht — in beiden Sprachen
 * (TIM-12, FIN-07, V-191, V-192, D-592).
 *
 * **Die Fachbegriffe bleiben deutsch, auch im englischen Text.**
 * „Leistungszeile", „Auftrag", „Turnus" und „Posten" tragen Bedeutung aus
 * Vertrag und Abrechnung; erklärt wird in Klammern, ersetzt wird nicht.
 */
import type { InternSprache } from '../intern.js';

/** Die Gründe, aus denen ein Anker abgewiesen wird (`LeistungsankerFehler`, Schicht, Posten). */
export const LEISTUNGSANKER_GRUENDE = [
  'leistung_unbekannt', 'leistung_beendet', 'leistung_anderer_auftrag',
  'nicht_manuell', 'leistung_hat_zeiten', 'posten_archiviert',
] as const;
export type LeistungsankerAbweisung = (typeof LEISTUNGSANKER_GRUENDE)[number];

export interface LeistungsankerTexte {
  readonly feld: string;
  readonly ohne: string;
  readonly position: string;
  /** Hinter einer Zeile, die nur als bisheriger Anker dasteht und nicht neu wählbar ist. */
  readonly nichtWaehlbar: string;
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
  /** Nach dem Speichern an einem Träger (Turnus, Posten): die künftigen Schichten. */
  readonly gesetzt: string;
  /** Nach dem Speichern an einer Einzelschicht (V-192) — sie hat keine „künftigen Schichten". */
  readonly gesetztEinzeln: string;
  readonly nurOhneZeit: string;
  /**
   * Der Dauerhinweis auf einer Einzelschicht mit erfasster Zeit (V-192). Kein
   * Fehlersatz: dort wurde nichts versucht, also auch nichts „nicht gespeichert".
   */
  readonly hatZeiten: string;
  /** Am archivierten Posten steht statt des Feldes dieser Satz (V-192). */
  readonly postenArchiviert: string;
  /** Über einer abgewiesenen Anlage (Serie, Turnus, Posten — V-192). */
  readonly nichtAngelegt: string;
  /** Ein Grund, den diese Tabelle nicht kennt — nie der Schlüssel aus der Adresse (V-192). */
  readonly fehlerSonst: string;
  readonly fehler: Readonly<Record<LeistungsankerAbweisung, string>>;
}

export const LEISTUNGSANKER_TEXTE: Readonly<Record<InternSprache, LeistungsankerTexte>> = {
  de: {
    feld: 'Leistungszeile (Abrechnung)',
    ohne: 'ohne Leistungszeile — die Zeit hängt an keiner Abrechnung',
    position: 'Pos.',
    nichtWaehlbar: 'nicht wählbar',
    bisherNichtGelistet: 'bisherige Leistungszeile (bleibt, wie sie ist)',
    erklaerung:
      'Jede Stunde auf diesen Schichten übernimmt die Leistungszeile beim Erfassen. Ohne '
      + 'sie steht sie unter „Zeit ohne Auftrag" und in keiner Stundenabrechnung. Schon '
      + 'erfasste Zeit behält, was sie hatte. Hinter jeder Zeile stehen Kunde und Objekt '
      + 'ihres Auftrags — prüfen Sie, ob sie zu dieser Schicht gehören.',
    keinLeserecht: 'Leistungszeilen sieht nur, wer Aufträge lesen darf:',
    bleibt: 'Die Leistungszeile bleibt, wie sie ist.',
    keineZeilen:
      'Es gibt keine wählbare Leistungszeile — sie entsteht an einem laufenden Auftrag. '
      + 'Ohne sie hängt die Zeit an keiner Abrechnung.',
    speichern: 'Leistungszeile speichern',
    gesetzt:
      'Die Leistungszeile ist gespeichert. Künftige Schichten ohne erfasste Zeit tragen sie.',
    gesetztEinzeln:
      'Die Leistungszeile ist gespeichert. Jede Zeit, die auf dieser Schicht erfasst wird, '
      + 'übernimmt sie.',
    nurOhneZeit:
      'Die Leistungszeile einer Einzelschicht lässt sich ändern, solange auf ihr keine Zeit '
      + 'erfasst ist.',
    hatZeiten:
      'Auf dieser Schicht ist schon Zeit erfasst; ihre Einträge haben die Leistungszeile '
      + 'übernommen, die die Schicht damals trug. Hier lässt sie sich deshalb nicht mehr ändern.',
    postenArchiviert: 'Dieser Posten ist archiviert; seine Leistungszeile bleibt, wie sie war.',
    nichtAngelegt: 'Nicht angelegt.',
    fehlerSonst: 'Die Eingabe wurde abgewiesen. Nichts wurde gespeichert.',
    fehler: {
      leistung_unbekannt:
        'Diese Leistungszeile gibt es in dieser Gesellschaft nicht, oder sie ist für Sie nicht '
        + 'sichtbar. Nichts wurde gespeichert.',
      leistung_beendet:
        'Diese Leistungszeile gilt nicht mehr, oder ihr Auftrag läuft nicht (storniert, '
        + 'abgeschlossen oder noch nicht aktiv). Nichts wurde gespeichert.',
      leistung_anderer_auftrag:
        'Diese Leistungszeile gehört zu einem anderen Auftrag als dem, den die Schicht von Hand '
        + 'nennt. Nichts wurde gespeichert.',
      nicht_manuell:
        'Eine Serienschicht trägt die Leistungszeile ihres Turnus oder Postens — ändern Sie '
        + 'sie dort.',
      leistung_hat_zeiten:
        'Auf dieser Schicht ist schon Zeit erfasst; ihre Einträge haben die Leistungszeile '
        + 'übernommen, die die Schicht damals trug. Nichts wurde gespeichert.',
      posten_archiviert:
        'Dieser Posten ist archiviert; seine Leistungszeile lässt sich nicht mehr ändern. Nichts '
        + 'wurde gespeichert.',
    },
  },
  en: {
    feld: 'Leistungszeile (billing line)',
    ohne: 'no Leistungszeile — the time is not attached to any billing',
    position: 'item',
    nichtWaehlbar: 'not selectable',
    bisherNichtGelistet: 'current Leistungszeile (stays as it is)',
    erklaerung:
      'Every hour recorded on these shifts takes over the Leistungszeile when it is recorded. '
      + 'Without one it is listed under "time without an order" and in no hourly billing. '
      + 'Time already recorded keeps what it had. Each line shows the Kunde (customer) and '
      + 'Objekt of its Auftrag — check that they belong to this shift.',
    keinLeserecht: 'Only people who may read orders see billing lines:',
    bleibt: 'The Leistungszeile stays as it is.',
    keineZeilen:
      'There is no selectable Leistungszeile — it is created on a running Auftrag (order). '
      + 'Without one the time is not attached to any billing.',
    speichern: 'Save Leistungszeile',
    gesetzt: 'The Leistungszeile is saved. Future shifts without recorded time carry it.',
    gesetztEinzeln:
      'The Leistungszeile is saved. All time recorded on this shift takes it over.',
    nurOhneZeit:
      'The Leistungszeile of a single shift can be changed as long as no time is recorded on it.',
    hatZeiten:
      'Time has already been recorded on this shift; its entries took over the Leistungszeile '
      + 'the shift carried then. It can therefore no longer be changed here.',
    postenArchiviert: 'This Posten is archived; its Leistungszeile stays as it was.',
    nichtAngelegt: 'Not created.',
    fehlerSonst: 'The input was refused. Nothing was saved.',
    fehler: {
      leistung_unbekannt:
        'This Leistungszeile does not exist in this Gesellschaft, or it is not visible to you. '
        + 'Nothing was saved.',
      leistung_beendet:
        'This Leistungszeile is no longer valid, or its Auftrag is not running (cancelled, '
        + 'closed or not yet active). Nothing was saved.',
      leistung_anderer_auftrag:
        'This Leistungszeile belongs to a different Auftrag than the one named by hand on the '
        + 'shift. Nothing was saved.',
      nicht_manuell:
        'A shift from a series carries the Leistungszeile of its Turnus or Posten — change it '
        + 'there.',
      leistung_hat_zeiten:
        'Time has already been recorded on this shift; its entries took over the '
        + 'Leistungszeile the shift carried then. Nothing was saved.',
      posten_archiviert:
        'This Posten is archived; its Leistungszeile can no longer be changed. Nothing was '
        + 'saved.',
    },
  },
};
