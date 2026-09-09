/**
 * Server Actions, die NICHT `authorize()` rufen — und was sie stattdessen tun.
 *
 * `authorize(akteur, …)` setzt einen Akteur voraus. Genau eine Art von Aktion
 * kann ihn nicht haben: die, die ihn ERZEUGT. Eine Anmeldung, die sich vorher
 * autorisieren müsste, könnte niemanden anmelden.
 *
 * Diese Liste ist deshalb keine Abschaltung, sondern eine Umleitung: jeder
 * Eintrag muss die Wache NENNEN, die stattdessen greift, und der Test prüft,
 * dass sie in der Datei wirklich aufgerufen wird. Eine Aktion ohne Wache steht
 * nicht darauf und bricht den Build — und eine, die hier steht, ohne ihre
 * Wache zu rufen, ebenfalls.
 */
export interface AndersBewacht {
  readonly datei: string;
  /** Der Name der Funktion, die stattdessen prüft. */
  readonly wache: string;
  readonly grund: string;
}

export const ANDERS_BEWACHT: readonly AndersBewacht[] = [
  {
    datei: 'src/app/dev/anmelden/page.tsx',
    wache: 'devFlaechenAn',
    grund:
      'Die Entwicklungsanmeldung STELLT die Sitzung aus; vor ihr gibt es keinen '
      + 'Akteur, den `authorize()` prüfen könnte. Bewacht wird sie durch '
      + '`devFlaechenAn()`: ohne CSE_DEV_FLAECHEN=1 liefert die Seite 404 und die '
      + 'Aktion wirft — und in einem Produktionsbuild ist der Schalter nicht '
      + 'gesetzt. Sie verschwindet mit PR 20, wenn Telefon + Einmalcode '
      + 'übernehmen; die echte Anmeldung wird derselbe Fall sein und gehört dann '
      + 'hierher, nicht in eine Ausnahme ohne Begründung.',
  },
];
