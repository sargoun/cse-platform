/**
 * Die Wörter des Beitragsbilds im Social Media Center — in beiden Sprachen
 * (SOC-02, V-225, D-719, D-592).
 *
 * Die Beitragsseiten stehen noch auf der Ausnahmeliste der Übersetzungswache;
 * was hier dazukommt, kommt zweisprachig.
 */
import type { InternSprache } from '../intern.js';

export interface SocialBildTexte {
  readonly titel: string;
  readonly keines: string;
  readonly platzhalter: string;
  readonly datei: string;
  readonly alt: string;
  readonly altHinweis: string;
  readonly anhaengen: string;
  readonly ersetzen: string;
  readonly entfernen: string;
  readonly nurEntwurf: string;
  readonly ohneSpeicher: string;
  readonly rechte: string;
  readonly angehaengt: string;
  readonly entfernt: string;
  readonly nichtGespeichert: string;
  readonly fehler: Readonly<Record<string, string>>;
  readonly fehlerSonst: string;
  readonly neuHinweis: string;
}

export const SOCIAL_BILD_TEXTE: Readonly<Record<InternSprache, SocialBildTexte>> = {
  de: {
    titel: 'Bild',
    keines: 'Dieser Beitrag trägt kein Bild.',
    platzhalter: 'Platzhalterbild',
    datei: 'Bilddatei (PNG oder JPEG)',
    alt: 'Alternativtext',
    altHinweis:
      'Was auf dem Bild zu sehen ist — für alle, die es nicht sehen (PUB-09, BFSG). Pflicht.',
    anhaengen: 'Bild anhängen',
    ersetzen: 'Bild ersetzen',
    entfernen: 'Bild entfernen',
    nurEntwurf:
      'Das Bild ändert man nur am Entwurf: die Freigabe gilt für Text UND Bild, die vorlagen.',
    ohneSpeicher:
      'Der Dateispeicher ist nicht verbunden — ein Bild lässt sich nicht hochladen '
      + '(Einstellungen › Integrationen).',
    rechte:
      'Wer ein Bild anhängt, braucht die Rechte daran — und bei erkennbaren Personen deren '
      + 'Einwilligung. Welchen Nachweis die Plattform dafür verlangen soll, ist offen (O-939).',
    angehaengt: 'Das Bild hängt am Entwurf. Beim Vorlegen geht es mit in die Freigabe.',
    entfernt: 'Das Bild ist vom Entwurf entfernt. Die Datei bleibt im Speicher.',
    nichtGespeichert: 'Nicht gespeichert.',
    fehler: {
      bild_nicht_verbunden: 'Der Dateispeicher ist nicht verbunden. Es wurde nichts gespeichert.',
      bild_leer: 'Es war keine Datei dabei.',
      bild_zu_gross: 'Die Datei ist zu groß (höchstens 8 MB).',
      bild_typ: 'Ein Beitragsbild als PNG oder JPEG — erkannt am Inhalt, nicht am Dateinamen.',
      bild_alt_text_fehlt: 'Ein Bild braucht einen Alternativtext.',
      bild_kein_recht: 'Bilder legt ab, wer Beiträge schreiben darf.',
    },
    fehlerSonst: 'Das Bild wurde abgewiesen.',
    neuHinweis:
      'Ein Bild hängen Sie nach dem Anlegen am Entwurf an — mit Alternativtext; es geht beim '
      + 'Vorlegen mit in die Freigabe.',
  },
  en: {
    titel: 'Image',
    keines: 'This post has no image.',
    platzhalter: 'Placeholder image',
    datei: 'Image file (PNG or JPEG)',
    alt: 'Alternative text',
    altHinweis:
      'What the image shows — for everyone who cannot see it (PUB-09, BFSG). Required.',
    anhaengen: 'Attach image',
    ersetzen: 'Replace image',
    entfernen: 'Remove image',
    nurEntwurf:
      'The image is changed on the draft only: the approval covers the text AND the image '
      + 'that were submitted.',
    ohneSpeicher:
      'The file storage is not connected — no image can be uploaded (Settings › Integrations).',
    rechte:
      'Whoever attaches an image needs the rights to it — and, where people can be recognised, '
      + 'their consent. Which proof the platform should require is still open (O-939).',
    angehaengt: 'The image is attached to the draft. It goes into the approval on submission.',
    entfernt: 'The image has been removed from the draft. The file stays in storage.',
    nichtGespeichert: 'Not saved.',
    fehler: {
      bild_nicht_verbunden: 'The file storage is not connected. Nothing was saved.',
      bild_leer: 'No file was attached.',
      bild_zu_gross: 'The file is too large (8 MB at most).',
      bild_typ: 'A post image as PNG or JPEG — recognised by content, not by file name.',
      bild_alt_text_fehlt: 'An image needs an alternative text.',
      bild_kein_recht: 'Images are stored by whoever may write posts.',
    },
    fehlerSonst: 'The image was rejected.',
    neuHinweis:
      'Attach an image to the draft after creating it — with alternative text; it goes into the '
      + 'approval on submission.',
  },
};
