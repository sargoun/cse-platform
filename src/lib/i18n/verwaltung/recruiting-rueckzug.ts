/**
 * Der Rückzug einer Bewerbung auf dem Bewerbungsblatt (V-363, O-200, D-812).
 *
 * Kein Urteil über einen Menschen: die Bewerberin hat zurückgezogen, und
 * hier steht, wer es vermerkt hat und wie sie es erklärt hat. Danach wird die
 * Bewerbung nicht mehr entschieden; die Aufbewahrungsfrist läuft wie bei
 * einer Absage.
 */
import type { InternSprache } from '../intern.js';

export interface RecruitingRueckzugTexte {
  readonly titel: string;
  readonly erklaerung: string;
  readonly vermerk: string;
  readonly vermerkHinweis: string;
  readonly knopf: string;
  /** Die Bestätigung nach dem Vermerk. */
  readonly erledigt: string;
  /** Die Zeile im Steckbrief. */
  readonly zurueckgezogen: string;
  /** `{wann}` und `{wer}` werden eingesetzt. */
  readonly amVon: string;
  readonly vermerkt: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
}

export const RECRUITING_RUECKZUG_TEXTE: Readonly<Record<InternSprache, RecruitingRueckzugTexte>> = {
  de: {
    titel: 'Rückzug vermerken',
    erklaerung:
      'Wenn die Bewerberin ihre Bewerbung zurückzieht, steht das hier — mit Ihrem Namen und '
      + 'dem Weg, auf dem sie es erklärt hat. Danach wird die Bewerbung nicht mehr entschieden; '
      + 'die Aufbewahrungsfrist läuft wie bei einer Absage.',
    vermerk: 'Vermerk',
    vermerkHinweis: 'Wie und wann sie zurückgezogen hat, etwa „per E-Mail am 3. Oktober“.',
    knopf: 'Rückzug vermerken',
    erledigt: 'Der Rückzug ist vermerkt. Die Bewerbung wird nicht mehr entschieden.',
    zurueckgezogen: 'Zurückgezogen',
    amVon: '{wann} · vermerkt von {wer}',
    vermerkt: 'Vermerk',
    fehler: {
      ohne_vermerk: 'Der Vermerk sagt, wie die Bewerberin zurückgezogen hat — mindestens drei Zeichen.',
      nicht_offen: 'Diese Bewerbung ist nicht mehr offen — entschieden oder schon zurückgezogen.',
      nicht_gefunden: 'Diese Bewerbung gibt es nicht.',
      unbekannt: 'Diese Bewerbung gibt es nicht.',
    },
    fehlerSonst: 'Der Rückzug wurde nicht vermerkt.',
  },
  en: {
    titel: 'Record withdrawal',
    erklaerung:
      'When the applicant withdraws the application, it is recorded here — with your name and '
      + 'the way they declared it. After that the application is no longer decided; the retention '
      + 'period runs as after a rejection.',
    vermerk: 'Note',
    vermerkHinweis: 'How and when they withdrew, for example “by email on 3 October”.',
    knopf: 'Record withdrawal',
    erledigt: 'The withdrawal is recorded. The application is no longer decided.',
    zurueckgezogen: 'Withdrawn',
    amVon: '{wann} · recorded by {wer}',
    vermerkt: 'Note',
    fehler: {
      ohne_vermerk: 'The note says how the applicant withdrew — at least three characters.',
      nicht_offen: 'This application is no longer open — decided or already withdrawn.',
      nicht_gefunden: 'This application does not exist.',
      unbekannt: 'This application does not exist.',
    },
    fehlerSonst: 'The withdrawal was not recorded.',
  },
};
