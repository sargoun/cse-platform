import { rechtName, type RechtSprache } from '@/lib/i18n/rechtname';

/**
 * Ein Rechteschlüssel als SATZ — und der Schlüssel im `title`.
 *
 * **Der Befund (Nutzerbericht).** Über vierhundert Stellen im Portal zeigten
 * einem Menschen den rohen Schlüssel: „Ihnen fehlt `kalkulation.lesen`".
 * Für die Objektleitung, die das liest, ist das Quelltext. Sie erfährt, dass
 * ihr etwas fehlt, aber nicht WAS — und kann deshalb auch nicht danach
 * fragen. Ein Hinweis, den der Adressat nicht in eine Bitte übersetzen kann,
 * ist kein Hinweis.
 *
 * **Der technische Schlüssel verschwindet trotzdem nicht.** Er steht im
 * `title` und in `data-recht`: wer ein Recht tatsächlich vergibt — die
 * Administration — braucht ihn wortwörtlich, und die Rechtematrix kennt nur
 * ihn. Die Browserläufe greifen ebenfalls `data-recht` und nicht das Wort,
 * das sich mit der Sprache ändert.
 *
 * **Der Name steht in Anführungszeichen, weil er ein NAME ist.** Ohne sie
 * las der Satz sich falsch: „Ihnen fehlt Kalkulationen lesen“ ist kein
 * deutscher Satz. Mit ihnen trägt jede Stellung: „Ihnen fehlt ‚Kalkulationen
 * lesen‘“, „wer ‚Bauvorhaben schreiben‘ hält“, „ein eigenes Recht
 * (‚Preise freigeben‘)“. Deutsch setzt „…“, Englisch “…”.
 */
const ANFUEHRUNG: Readonly<Record<RechtSprache, readonly [string, string]>> = {
  de: ['\u201e', '\u201c'],
  en: ['\u201c', '\u201d'],
};

export function Recht({ schluessel, sprache = 'de' }: {
  readonly schluessel: string;
  readonly sprache?: RechtSprache | string | null;
}) {
  const s: RechtSprache = sprache === 'en' ? 'en' : 'de';
  const [auf, zu] = ANFUEHRUNG[s];
  return (
    <span
      className="font-medium text-text"
      data-cse="recht"
      data-recht={schluessel}
      title={schluessel}
    >
      {auf}{rechtName(schluessel, s)}{zu}
    </span>
  );
}
