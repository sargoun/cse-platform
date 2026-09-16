/**
 * Markdown, das aus Daten entsteht — und die eine Zeile, an der eine Tabelle
 * zerbricht.
 *
 * **Der Befund dahinter.** Drei Dienste erzeugen Markdown-Tabellen aus
 * Datenbankwerten: die Verfahrensdokumentation (ACC-10), das
 * Verarbeitungsverzeichnis und das Löschkonzept (LEG-09). Zwei davon
 * maskierten nur den senkrechten Strich. Ein Firmenname, eine Rechtsgrundlage
 * oder ein Geschäftsführer mit einem Zeilenumbruch darin — und die Tabelle
 * bricht an dieser Stelle ab: alles danach wird zu neuen Zeilen, eine davon
 * womöglich zu einer neuen Kopfzeile.
 *
 * Das ist die stille Sorte Schaden. Das Dokument sieht aus wie ein Dokument,
 * es geht an eine Aufsicht, und dort fehlt eine Zeile, die niemand vermisst,
 * weil niemand weiss, dass sie da sein sollte. Gemeldet hat es die
 * Copilot-Runde auf PR 17.
 *
 * Deshalb steht die Maskierung hier und nicht dreimal nebeneinander: drei
 * Kopien sind drei Gelegenheiten, eine davon zu vergessen.
 */

/**
 * Ein Wert als Zelle einer Markdown-Tabelle.
 *
 * Der senkrechte Strich wird maskiert, der Zeilenumbruch — `\n`, `\r\n` und
 * das einzelne `\r` — wird zum Leerzeichen. Eine Zelle ist einzeilig; das ist
 * keine Einschränkung dieser Funktion, sondern von Markdown.
 */
export function markdownZelle(text: string): string {
  return text.replace(/\|/gu, '\\|').replace(/\r\n|\r|\n/gu, ' ');
}
