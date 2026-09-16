import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

/**
 * Die drei Zustandsseiten — 404, Fehler, Laden (DESIGN §5 „Status pages").
 *
 * **Warum eine Datei und nicht sechs.** Diese Seiten unterscheiden sich nur in
 * dem, was sie SAGEN. Ein Aufbau, der sechsmal geschrieben wird, laeuft
 * sechsmal auseinander — und zwar unbemerkt, weil niemand sie im Alltag
 * aufruft. Sie stehen deshalb hier einmal, und die Seiten daneben sind vier
 * Zeilen Text.
 *
 * **Und warum es sie ueberhaupt gibt.** 232 Aufrufe von `notFound()` fuehrten
 * auf Next.js' eigene Vorgabe: schwarz auf weiss, englisch, ohne Inter, ohne
 * einen Weg zurueck. Das ist die Seite, die jemand genau in dem Moment sieht,
 * in dem er ohnehin verloren ist.
 *
 * Die Regeln stehen in DESIGN §5 und sind hier Code:
 *
 *  - Gesagt wird, WAS passiert ist, nie was der Mensch falsch gemacht hat.
 *    Das Portal antwortet auf ein fehlendes RECHT mit demselben 404 wie auf
 *    eine fehlende SEITE (AUT-06) — der Text muss fuer beides stimmen und darf
 *    nicht verraten, welcher Fall es war.
 *  - Immer ein Weg weiter. Eine Zustandsseite ohne Verweis ist eine Sackgasse.
 *  - Keine Fehlermeldung auf dem Bildschirm. Der `digest` steht da, und nur er:
 *    er ist die Zeichenkette, die diesen Bildschirm mit der Protokollzeile
 *    verbindet.
 */
export function Zustandsseite({
  code, titel, erklaerung, aktionen, cse,
}: {
  /** Die Augenbraue — `404`, `500`, oder nichts (Ladeseite). */
  readonly code?: string;
  readonly titel: string;
  readonly erklaerung: ReactNode;
  readonly aktionen?: ReactNode;
  readonly cse: string;
}) {
  return (
    <main data-cse={cse}
          className="mx-auto flex min-h-[60vh] w-full max-w-form flex-col
                     justify-center gap-s5 px-s6 py-s9">
      {code === undefined ? null : (
        <p data-cse="zustand-code"
           className="text-micro uppercase tracking-[0.08em] text-text-subtle">
          {code}
        </p>
      )}
      <h1 className="text-h1 text-text hyphens-auto">{titel}</h1>
      <div className="max-w-prose text-base text-text-muted">{erklaerung}</div>
      {aktionen === undefined ? null : (
        <div className="flex flex-wrap gap-s3">{aktionen}</div>
      )}
    </main>
  );
}

/**
 * Ein Verweis, der wie ein Knopf aussieht (DESIGN §5 Buttons).
 *
 * `Button` ist ein `<button>`; ein Weg weiter ist ein `<a>`. Ein Knopf, der
 * navigiert, nimmt dem Menschen das mittlere Klicken, das Kopieren der Adresse
 * und die Vorschau in der Statusleiste — und einem Screenreader sagt er die
 * falsche Rolle (§9).
 */
export function ZustandKnopf({ href, variante = 'secondary', cse, children }: {
  readonly href: Route;
  readonly variante?: 'primary' | 'secondary';
  readonly cse: string;
  readonly children: ReactNode;
}) {
  const klasse = variante === 'primary'
    ? 'bg-brand text-white hover:bg-brand-hover active:bg-brand-press font-semibold'
    : 'bg-transparent border border-line-strong text-text hover:bg-surface-2';
  return (
    <Link href={href} data-cse={cse}
          className={`inline-flex min-h-11 items-center justify-center rounded-md
                      px-s5 py-s3 text-sm transition-colors duration-fast ${klasse}`}>
      {children}
    </Link>
  );
}
