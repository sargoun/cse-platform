/**
 * Der Schluss eines Entwurfs: Gruss und Signatur der Gesellschaft (V-391,
 * O-115, D-829).
 *
 * Einstellungen › Identität führt je Gesellschaft eine E-Mail-Signatur
 * (`mandant_identitaet.email_signatur`). Die Antwortentwürfe im Recruiting und
 * die Akquiseentwürfe schlossen trotzdem mit festem Gruss und dem Namen der
 * Gesellschaft. Jetzt steht unter dem Gruss die Signatur, wenn eine
 * hinterlegt ist — sonst, wie bisher, der Name.
 *
 * **Kein doppelter Gruss.** Beginnt die Signatur selbst mit einem Gruss
 * („Mit freundlichen Grüßen", „Beste Grüße", „MfG", „Kind regards"), steht
 * sie allein: geprüft wird nur ihre erste Zeile. Eine Signatur, die mit dem
 * Namen beginnt, bekommt den Gruss davor.
 *
 * Die Signatur kommt aus einem Textfeld und trägt dessen Zeilenumbrüche
 * (`\r\n`); im Entwurf steht `\n` wie im übrigen Text.
 *
 * Rein und ohne Datenbank: der Dienst liest die Signatur, diese Datei setzt
 * nur den Schluss zusammen — und der Seed nimmt dieselbe Funktion.
 */

const GRUSS_IN_ERSTER_ZEILE = /\bgr(?:u|ü|ue)(?:ß|ss)|\bmfg\b|\bregards\b/iu;

export function schlussMitSignatur(
  gruss: string, gesellschaft: string, signatur: string | null,
): string {
  const text = (signatur ?? '').replaceAll(/\r\n?/gu, '\n').trim();
  if (text === '') return `${gruss}\n${gesellschaft}`;
  const ersteZeile = text.split('\n', 1)[0] ?? '';
  return GRUSS_IN_ERSTER_ZEILE.test(ersteZeile) ? text : `${gruss}\n${text}`;
}
