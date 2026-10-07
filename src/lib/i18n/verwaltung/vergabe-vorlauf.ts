/**
 * Der interne Vorlauf am Blatt der Vergabemappe — in beiden Sprachen (V-307,
 * O-112, D-839).
 *
 * Die Seite der Vergabemappe steht noch auf der Ausnahmeliste der
 * Übersetzungswache; die Sätze des Vorlaufs sind neu und deshalb zweisprachig
 * (`scripts/guards/uebersetzung-ausnahmen.ts`). „Vergabemappe" bleibt auch
 * englisch stehen: ein Begriff des Hauses, keine Oberfläche.
 */
import type { InternSprache } from '../intern.js';

export interface VorlaufTexte {
  readonly zeile: (tag: string, werktage: number) => string;
  readonly heute: string;
  readonly ueberschritten: string;
  readonly erledigt: string;
  readonly warnungHeute: string;
  readonly warnungUeberschritten: string;
  readonly voreinstellung: string;
}

export const VORLAUF_TEXTE: Readonly<Record<InternSprache, VorlaufTexte>> = {
  de: {
    zeile: (tag, werktage) =>
      `Intern fertig bis ${tag} — ${String(werktage)} Werktage vor der Abgabe.`,
    heute: 'Das ist heute.',
    ueberschritten: 'Dieser Tag ist vorbei.',
    erledigt: 'Die Mappe ist intern fertig.',
    warnungHeute:
      'Heute muss die Mappe intern fertig werden — danach bleiben Prüfung, Freigabe und das '
      + 'Hochladen.',
    warnungUeberschritten:
      'Der interne Abgabetag ist vorbei, und die Mappe ist noch nicht vollständig. Was jetzt '
      + 'fehlt, fehlt der Prüfung und der Freigabe.',
    voreinstellung:
      'Voreinstellung (O-112): fünf Werktage vor der amtlichen Frist; Werktag ist Montag bis '
      + 'Freitag ohne gesetzlichen Feiertag in Berlin.',
  },
  en: {
    zeile: (tag, werktage) =>
      `Internally complete by ${tag} — ${String(werktage)} working days before submission.`,
    heute: 'That is today.',
    ueberschritten: 'That day has passed.',
    erledigt: 'The Vergabemappe is internally complete.',
    warnungHeute:
      'The Vergabemappe must be internally complete today — review, approval and the upload '
      + 'still follow.',
    warnungUeberschritten:
      'The internal deadline has passed and the Vergabemappe is not complete yet. Whatever is '
      + 'missing now is missing from review and approval.',
    voreinstellung:
      'Default (O-112): five working days before the official deadline; a working day is Monday '
      + 'to Friday without a public holiday in Berlin.',
  },
};
