import { Hinweis } from '@/components/ui/Hinweis';
import type { ErfolgSatz } from '@/lib/i18n/verwaltung/personal-rueckweg';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Die Bestätigung eines Personalformulars — der Satz zum ERFOLGSschlüssel aus
 * der Adresse (V-273, D-771 Nachtrag, D-769 Nr. 1–2, D-728).
 *
 * Das Gegenstück zu `PersonalAbweisung`: die Route schickt nach einem Erfolg
 * nur einen Schlüssel (`?eingestellt=1`, `?erfolg=vertrag_gespeichert`), und
 * die Seite schlägt ihn nach — nur als eigener Eintrag. Anders als bei einer
 * Abweisung gibt es hier KEINEN allgemeinen Satz: ein Schlüssel, den die
 * Tabelle nicht kennt, zeigt gar nichts. „Gespeichert" zu sagen, ohne zu
 * wissen, was geschah, wäre eine Bestätigung, die ein Link erfinden kann.
 *
 * `role="status"` (über `rolle`): die Seite lädt nach dem Absenden neu, und ein
 * Screenreader sagt die Bestätigung an, ohne den Menschen zu unterbrechen.
 */
export function PersonalErfolg({ saetze, schluessel, cse }: {
  /** Die Erfolgssätze der Seite, nach Schlüssel (nicht `texte` — siehe `PersonalAbweisung`). */
  readonly saetze: Readonly<Record<string, ErfolgSatz>>;
  /** Der Schlüssel, wie er in der Adresse stand — nur nachgeschlagen. */
  readonly schluessel: string | readonly string[] | undefined;
  /** Der `data-cse`-Anker der Seite. */
  readonly cse: string;
}) {
  const eintrag = eigenerEintrag(saetze, schluessel);
  if (eintrag === undefined) return null;
  return (
    <Hinweis art="erfolg" rolle="status" cse={cse} className="mb-s5 max-w-prose">
      <strong>{eintrag.titel}</strong> {eintrag.satz}
    </Hinweis>
  );
}
