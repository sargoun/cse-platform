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
  {
    datei: 'src/app/auth/mitarbeiter/page.tsx',
    wache: 'codeAnfordern',
    grund:
      'Die echte Anmeldung (EMP-01, PR 20) — derselbe Fall wie die Dev-Anmeldung '
      + 'darüber, und der Grund, aus dem diese Liste überhaupt existiert: wer einen '
      + 'Code anfordert, ist noch niemand, und `authorize()` hätte keinen Akteur zu '
      + 'prüfen. Bewacht wird sie durch `codeAnfordern`, und zwar nicht in dieser '
      + 'Datei, sondern in `app.zugang_code_anfordern` (0114) dahinter: die Funktion '
      + 'entscheidet still, ob es die Nummer gibt, und bremst bei drei offenen Codes '
      + 'je Zugang. Eine Bremse in dieser Seite wäre eine, die der nächste Aufrufer '
      + 'umgeht.',
  },
  {
    datei: 'src/app/auth/mitarbeiter/code/page.tsx',
    wache: 'codeEinloesen',
    grund:
      'Der zweite Schritt derselben Anmeldung. `codeEinloesen` führt auf '
      + '`app.zugang_code_einloesen` (0114), das den Code im selben Aufruf prüft UND '
      + 'verbraucht — mit `for update`, damit zwei gleichzeitige Einlösungen '
      + 'serialisieren. Erst danach entsteht ein Akteur; vorher gibt es keinen, den '
      + '`authorize()` prüfen könnte.',
  },
];
