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
  {
    datei: 'src/app/auth/login/page.tsx',
    wache: 'meldeAnMitKennwort',
    grund:
      'AUT-01, derselbe Fall wie die drei darüber: wer ein Kennwort eingibt, ist noch '
      + 'niemand. Bewacht wird die Aktion durch `meldeAnMitKennwort` und die Funktion '
      + 'dahinter — `app.kennwort_anmelden` (0155) bremst ZUERST '
      + '(`app.versuch_protokollieren`, AUT-07), vergleicht den bcrypt-Hash in der '
      + 'Datenbank und stellt die Sitzung in derselben Anweisung aus. Eine Bremse in '
      + 'dieser Seite wäre eine, die der nächste Aufrufer umgeht.',
  },
  {
    datei: 'src/app/auth/passwort-vergessen/page.tsx',
    wache: 'legeKennwortTokenAn',
    grund:
      'AUT-01. Wer sein Kennwort vergessen hat, ist per Definition nicht angemeldet. '
      + '`app.kennwort_token_anlegen` (0155) antwortet IMMER gleich — ob es zu der '
      + 'Adresse ein Konto gibt, steht weder auf dem Bildschirm noch in der Laufzeit — '
      + 'und lässt ältere offene Token desselben Zwecks verfallen.',
  },
  {
    datei: 'src/app/auth/passwort-neu/page.tsx',
    wache: 'loeseKennwortTokenEin',
    grund:
      'AUT-01, AUT-04. Der Ausweis ist der Token aus der Mail, nicht eine Sitzung — bei '
      + 'einer Einladung gibt es noch gar kein aktives Konto. '
      + '`app.kennwort_token_einloesen` prüft, verbraucht und setzt in EINER Anweisung '
      + 'mit `for update`; zwei getrennte Schritte liessen ein Fenster, in dem derselbe '
      + 'Link zweimal gilt.',
  },
  {
    datei: 'src/app/auth/zwei-faktor/pruefen/page.tsx',
    wache: 'pruefeFaktor',
    grund:
      'AUT-02. Die Sitzung steht bereits — sie ist aber `aal1`, und genau das prüft '
      + '`authorize()` NICHT: es fragt nach einem Recht, und hier geht es um die Stufe '
      + 'der Anmeldung selbst. `pruefeFaktor` liest das Geheimnis über '
      + '`app.faktor_geheimnis`, das an `app.aktueller_benutzer()` hängt (also an genau '
      + 'dieser Sitzung), und `app.faktor_schritt_verbrauchen` macht jeden Code '
      + 'einmalig. Die Anhebung auf aal2 gilt nur der Sitzung, deren Token vorliegt.',
  },
  {
    datei: 'src/app/auth/zwei-faktor/wiederherstellung/page.tsx',
    wache: 'loeseWiederherstellungscodeEin',
    grund:
      'AUT-02, derselbe Schritt mit dem anderen Beweis. '
      + '`app.wiederherstellungscode_einloesen` prüft gegen die Codes DES GEBUNDENEN '
      + 'Kontos (`app.aktueller_benutzer()`) und streicht den Code in derselben '
      + 'Anweisung — ein zweites Einlösen trifft null Zeilen.',
  },
  {
    datei: 'src/app/auth/zwei-faktor/einrichten/page.tsx',
    wache: 'bestaetigeFaktorMitToken',
    grund:
      'AUT-02, AUT-04. Zwei Ausweise: im Regelfall die gebundene Sitzung (aal1, '
      + '`app.faktor_*` hängen an `app.aktueller_benutzer()`), bei einer Einladung der '
      + 'Token — ein eingeladenes Konto ist noch nicht `aktiv` und hat deshalb keine '
      + 'Sitzung. `app.token_faktor_bestaetigen` prüft den Token, bestätigt den Faktor, '
      + 'aktiviert das Konto und verbraucht den Token zusammen oder gar nicht.',
  },
];
