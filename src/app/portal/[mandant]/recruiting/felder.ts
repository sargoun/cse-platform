/**
 * Die Feldklasse der Recruiting-Formulare — dieselbe Zeile wie in
 * `social/posts/neu` (DESIGN §5).
 *
 * Sie steht hier und nicht je Seite, weil vier Formulare sie brauchen und vier
 * Abschriften vier Gelegenheiten wären, eine Polsterung zu verschieben.
 */
export const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

/** Der flache Knopf der Sprungzeilen — ebenfalls viermal gebraucht. */
export const KNOPF = 'inline-flex min-h-11 items-center rounded-md border border-line '
  + 'px-s4 py-s3 text-sm text-text transition-colors duration-fast hover:bg-surface-2';
