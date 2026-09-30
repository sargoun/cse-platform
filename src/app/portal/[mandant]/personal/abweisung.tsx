import { Hinweis } from '@/components/ui/Hinweis';
import type { PersonalRueckwegTexte } from '@/lib/i18n/verwaltung/personal-rueckweg';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * Die Abweisung eines Personalformulars — der SATZ zum Grund aus `?fehler=`
 * (V-273, D-771, D-769, D-728).
 *
 * `fuehrePersonalAus` (`api/personal/gemeinsam.ts`) schickt eine Abweisung
 * als `?fehler=<grund>` auf die Seite des Formulars zurück. Sechs Seiten
 * zeigen sie — Einstellen, Vertrag, Entgelt, Beenden, Stammdaten,
 * Zusammenführen —, jede mit ihrer eigenen Tabelle
 * (`lib/i18n/verwaltung/personal-rueckweg.ts`), alle mit diesem einen
 * Nachschlagen: nur als eigener Eintrag (`?fehler=__proto__` fände sonst
 * `Object.prototype`, und React stürzte an einem Objekt als Kind), und ein
 * Grund, den die Tabelle nicht kennt, wird ihr allgemeiner Satz. Der Wert aus
 * der Adresse selbst steht nie auf dem Schirm.
 *
 * `role="alert"` (über `rolle`): die Seite lädt nach dem Absenden neu, und ein
 * Screenreader soll den Satz ansagen, statt oben neu anzufangen (DESIGN §9).
 */
export function PersonalAbweisung({ saetze, grund, cse }: {
  /**
   * Die Tabelle der Seite — ihre Gründe sind Schlüssel, nachgeschlagen als
   * Zeichenkette. Nicht `texte`: unter diesem Namen reichen die Seiten des
   * Arbeiterportals ihre Satztabelle weiter, und die Prüfung der Leser
   * (`satztabellen-leser.test.ts`) hielte jedes `{ texte }` für einen davon.
   */
  readonly saetze: PersonalRueckwegTexte<string>;
  /** Der Suchparameter `fehler`, wie er in der Adresse stand — nur nachgeschlagen. */
  readonly grund: string | readonly string[] | undefined;
  /** Der `data-cse`-Anker der Seite (die Browserprüfungen kennen ihn). */
  readonly cse: string;
}) {
  if (typeof grund !== 'string') return null;
  return (
    <Hinweis art="warnung" rolle="alert" cse={cse} className="mb-s5 max-w-prose">
      <strong>{saetze.titel}</strong>{' '}
      {eigenerEintrag(saetze.fehler, grund) ?? saetze.sonst}
    </Hinweis>
  );
}
