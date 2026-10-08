/**
 * Krankheit im Urlaub — die Sätze des Abschnitts am Urlaubsantrag
 * (V-319, O-138, D-788, D-853, § 9 BUrlG).
 *
 * Zweisprachig wie die Verwaltung (de/en). Die Route schickt einen GRUND
 * (`?krankheit_fehler=<grund>`), nie einen Satz; die Seite schlägt ihn hier
 * nach — ein Grund, den die Tabelle nicht kennt, bekommt `sonst` (D-753).
 */
import type { InternSprache } from '../intern.js';
import type { KrankheitImUrlaubGrund } from '../../../server/services/abwesenheit/krankheit-im-urlaub.js';

export interface KrankheitImUrlaubTexte {
  readonly titel: string;
  readonly einleitung: string;
  readonly krankVon: string;
  readonly krankBis: string;
  readonly au: string;
  readonly auBis: string;
  readonly bemerkung: string;
  readonly art: string;
  readonly knopf: string;
  readonly fussnote: string;
  /** „Dafür braucht diese Sitzung zwei Rechte: {melden} und {genehmigen} — …" — um die zwei Rechte herum. */
  readonly rechteVor: string;
  readonly rechteUnd: string;
  readonly rechteNach: string;
  readonly nichtGenehmigt: string;
  readonly erfolg: string;
  readonly fehlerTitel: string;
  readonly sonst: string;
  readonly fehler: Readonly<Record<KrankheitImUrlaubGrund, string>>;
}

export const KRANKHEIT_IM_URLAUB_TEXTE: Readonly<Record<InternSprache, KrankheitImUrlaubTexte>> = {
  de: {
    titel: 'Krankheit im Urlaub',
    einleitung:
      'War die Person während dieses genehmigten Urlaubs arbeitsunfähig krank und liegt die '
      + 'AU-Bescheinigung vor, werden die kranken Arbeitstage nicht auf den Urlaub angerechnet '
      + '(§ 9 BUrlG). Hier wird die Krankheit erfasst, und die Tage gehen in derselben Transaktion '
      + 'auf das Urlaubskonto des Urlaubsjahres zurück. Der Urlaub selbst bleibt, wie er genehmigt '
      + 'wurde — er verlängert sich nicht.',
    krankVon: 'Krank vom',
    krankBis: 'Krank bis',
    au: 'Die AU-Bescheinigung liegt vor',
    auBis: 'Bescheinigung gültig bis (leer = wie „krank bis")',
    bemerkung: 'Bemerkung (Gesundheitsdatum — nur mit eigenem Recht lesbar)',
    art: 'Abwesenheitsart',
    knopf: 'Krankheit erfassen und Urlaubstage gutschreiben',
    fussnote:
      'Voreinstellung (O-138): mit Bescheinigung werden die Arbeitstage des Urlaubs gutgeschrieben, '
      + 'an denen die Person krank war — gerechnet wie der Urlaub selbst, ohne Wochenenden und '
      + 'Berliner Feiertage. Wird die Krankheit storniert, werden die Tage wieder abgezogen.',
    rechteVor: 'Die Krankheit im Urlaub braucht zwei Rechte:',
    rechteUnd: 'und',
    rechteNach: '— die Gutschrift ändert, was der genehmigte Urlaub kostet. Dieser Sitzung fehlt mindestens eines.',
    nichtGenehmigt:
      'Der Urlaub dieses Antrags ist nicht mehr genehmigt. Eine Krankheit wird dann als '
      + 'gewöhnliche Krankmeldung erfasst.',
    erfolg:
      'Die Krankheit ist erfasst, und die kranken Urlaubstage sind dem Urlaubskonto gutgeschrieben '
      + '(§ 9 BUrlG) — der Stand oben zeigt es.',
    fehlerTitel: 'Die Krankheit im Urlaub wurde nicht erfasst.',
    sonst: 'Es wurde nichts geändert.',
    fehler: {
      nicht_gefunden: 'Diesen Antrag oder seinen Urlaub gibt es nicht mehr — die Seite zeigt den aktuellen Stand.',
      kein_urlaub: 'Dieser Antrag ist kein Urlaubsantrag; nur ein Urlaub, der auf das Urlaubskonto zählt, wird unterbrochen.',
      nicht_genehmigt: 'Der Urlaub ist nicht mehr genehmigt — die Seite zeigt den aktuellen Stand.',
      au_fehlt:
        'Ohne AU-Bescheinigung werden keine Urlaubstage gutgeschrieben (§ 9 BUrlG: durch ärztliches '
        + 'Zeugnis nachgewiesen). Die Krankheit wird dann als gewöhnliche Krankmeldung erfasst.',
      ausserhalb: 'Die Krankheit liegt nicht im Zeitraum des Urlaubs.',
      keine_arbeitstage:
        'Die kranken Tage im Urlaub sind Wochenenden oder Feiertage — sie haben keinen Urlaubstag '
        + 'gekostet, es gibt nichts gutzuschreiben.',
      keine_art:
        'Im Katalog unterbricht keine Abwesenheitsart den Urlaub, oder die gewählte nicht '
        + '(Stammdaten › Abwesenheitsarten, O-138).',
      art_ungeklaert: 'Für diese Abwesenheitsart ist nicht hinterlegt, ob sie bezahlt ist (O-139).',
      schon_erfasst:
        'In diesem Zeitraum ist schon eine Krankheit erfasst. Ist sie ohne Gutschrift erfasst, wird '
        + 'sie mit dem Grund „wird als Krankheit im Urlaub erfasst" storniert und hier neu erfasst.',
      konto_fehlt:
        'Für das Urlaubsjahr gibt es kein offenes Urlaubskonto; ein abgeschlossenes Jahr wird nicht '
        + 'rückwirkend geändert (O-18).',
      zu_viel:
        'Es würden mehr Tage gutgeschrieben, als der Urlaub noch kostet — er ist schon gutgeschrieben '
        + 'oder wurde mit einer anderen Arbeitswoche genehmigt.',
      au_bis_vor_von: '„Bescheinigung gültig bis" liegt vor dem ersten Krankheitstag.',
      au_bis_kein_datum: '„Bescheinigung gültig bis" ist kein Kalendertag. Bitte das Datum prüfen.',
      kein_datum: 'Der Krankheitszeitraum braucht zwei Tage; das Ende liegt nicht vor dem Anfang.',
      kein_recht: 'Dafür fehlt dieser Sitzung ein Recht — die Seite nennt, welches.',
    },
  },
  en: {
    titel: 'Sickness during leave',
    einleitung:
      'If the person was unfit for work during this approved leave and the doctor\'s certificate '
      + 'is available, the sick working days are not counted against the leave (§ 9 BUrlG). The '
      + 'sickness is recorded here, and the days go back to the leave account of the leave year in '
      + 'the same transaction. The leave itself stays as approved — it is not extended.',
    krankVon: 'Sick from',
    krankBis: 'Sick until',
    au: 'The doctor\'s certificate is available',
    auBis: 'Certificate valid until (empty = as "sick until")',
    bemerkung: 'Note (health data — readable only with its own right)',
    art: 'Absence type',
    knopf: 'Record sickness and credit leave days',
    fussnote:
      'Default (O-138): with a certificate, the leave\'s working days on which the person was sick '
      + 'are credited — counted like the leave itself, without weekends and Berlin public holidays. '
      + 'If the sickness is cancelled, the days are deducted again.',
    rechteVor: 'Sickness during leave needs two rights:',
    rechteUnd: 'and',
    rechteNach: '— the credit changes what the approved leave costs. This session lacks at least one of them.',
    nichtGenehmigt:
      'The leave of this request is no longer approved. A sickness is then recorded as an ordinary '
      + 'sick note.',
    erfolg:
      'The sickness is recorded, and the sick leave days are credited to the leave account '
      + '(§ 9 BUrlG) — the balance above shows it.',
    fehlerTitel: 'The sickness during leave was not recorded.',
    sonst: 'Nothing was changed.',
    fehler: {
      nicht_gefunden: 'This request or its leave no longer exists — the page shows the current state.',
      kein_urlaub: 'This request is not a leave request; only leave that counts against the leave account is interrupted.',
      nicht_genehmigt: 'The leave is no longer approved — the page shows the current state.',
      au_fehlt:
        'Without a doctor\'s certificate no leave days are credited (§ 9 BUrlG: proven by a medical '
        + 'certificate). The sickness is then recorded as an ordinary sick note.',
      ausserhalb: 'The sickness does not fall within the leave.',
      keine_arbeitstage:
        'The sick days during the leave are weekends or public holidays — they did not cost a leave '
        + 'day, there is nothing to credit.',
      keine_art:
        'No absence type in the catalogue interrupts leave, or the chosen one does not '
        + '(Master data › Absence types, O-138).',
      art_ungeklaert: 'It is not recorded whether this absence type is paid (O-139).',
      schon_erfasst:
        'A sickness is already recorded for this period. If it was recorded without a credit, cancel '
        + 'it with the reason "recorded as sickness during leave" and record it again here.',
      konto_fehlt:
        'There is no open leave account for the leave year; a closed year is not changed '
        + 'retroactively (O-18).',
      zu_viel:
        'More days would be credited than the leave still costs — it has already been credited, or it '
        + 'was approved with a different working week.',
      au_bis_vor_von: '"Certificate valid until" is before the first sick day.',
      au_bis_kein_datum: '"Certificate valid until" is not a calendar date. Please check the date.',
      kein_datum: 'The sickness needs two dates; the end is not before the start.',
      kein_recht: 'This session lacks a right for that — the page names which one.',
    },
  },
};
