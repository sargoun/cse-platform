/**
 * `/.well-known/security.txt` nach RFC 9116 — und der Grund, warum es sie
 * meistens NICHT gibt.
 *
 * `04-SEITENKARTE.md` §2.5 ist hier nicht weich, sondern verbietet die
 * Veroeffentlichung ohne Gegenstueck: „`/.well-known/security.txt` ships only
 * with a monitored mailbox behind it; a contact address nobody reads is worse
 * than no file at all." Und das ist keine Formalie. Diese Datei ist eine
 * Einladung an jeden, der eine Luecke findet, sie UNS zu melden statt sie zu
 * verkaufen. Steht dort eine Adresse, die niemand liest, passiert genau das
 * Umgekehrte: der Melder wartet, bekommt keine Antwort, und veroeffentlicht
 * nach dreissig Tagen. Die Datei hat dann Schaden angerichtet, nicht Nutzen.
 *
 * Deshalb gibt `sicherheitTxt()` `null` zurueck, solange kein Postfach benannt
 * ist, und der Handler antwortet 404. Eine erfundene Adresse waere genau die
 * vorgetaeuschte Anbindung, die CLAUDE.md ausschliesst.
 *
 * // TODO(client, O-35): Welches Postfach empfaengt Sicherheitsmeldungen, wer
 * liest es, und in welcher Frist wird geantwortet? Ohne Antwort bleibt
 * `/.well-known/security.txt` ein 404 — mit Absicht.
 */

/** Der Schluessel in `plattform_einstellung`, unter dem das Postfach steht. */
export const SCHLUESSEL_KONTAKT = 'sicherheit.kontakt';
/** Optional: die Adresse einer Richtlinienseite (`Policy`). */
export const SCHLUESSEL_RICHTLINIE = 'sicherheit.richtlinie';

export interface SicherheitsKontakt {
  /**
   * Ein `mailto:`- oder `https:`-Wert nach RFC 9116 §2.5.3. Eine nackte
   * E-Mail-Adresse ist KEIN gueltiger `Contact`-Wert — sie steht in der Datei
   * und wird von Werkzeugen nicht erkannt.
   */
  readonly kontakt: string;
  readonly richtlinie?: string | null;
}

/** RFC 9116 §2.5.3: `Contact` traegt eine URI, kein nacktes `a@b.de`. */
export function istKontaktWert(wert: unknown): wert is string {
  return typeof wert === 'string'
    && /^(?:mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+|tel:\+?[0-9 ()-]+)$/u.test(wert.trim());
}

/**
 * Die Datei, oder `null`.
 *
 * `jetzt` kommt von der SERVERUHR des Aufrufers und nicht aus dem Browser
 * (Invariante 5): `Expires` ist ein Pflichtfeld nach RFC 9116 §2.5.5, und
 * eine Datei, deren Ablauf aus einer fremden Uhr stammt, ist entweder schon
 * abgelaufen oder ein Jahr zu lang gueltig.
 *
 * `Expires` steht auf **Serveruhr + 12 Monate**. Der RFC verlangt „less than
 * a year" als Empfehlung; zwoelf Monate ab Auslieferung heisst, dass die
 * Angabe nie veraltet, weil die Datei bei jedem Abruf neu entsteht
 * (`force-dynamic`).
 */
export function sicherheitTxt(
  kontakt: SicherheitsKontakt | null,
  basis: string,
  jetzt: Date,
): string | null {
  if (kontakt === null) return null;
  if (!istKontaktWert(kontakt.kontakt)) return null;

  const ablauf = new Date(jetzt.getTime());
  ablauf.setUTCFullYear(ablauf.getUTCFullYear() + 1);

  const zeilen: string[] = [
    '# Sicherheitsmeldungen an die CSE-Gruppe (RFC 9116).',
    '# Bitte keine personenbezogenen Daten Dritter mitsenden.',
    '',
    `Contact: ${kontakt.kontakt.trim()}`,
    `Expires: ${ablauf.toISOString().replace(/\.\d{3}Z$/u, 'Z')}`,
    // Die Reihenfolge ist die Vorliebe, nicht die Faehigkeit: deutsch zuerst,
    // weil die Meldung von einem Menschen gelesen wird, der deutsch arbeitet.
    'Preferred-Languages: de, en',
    `Canonical: ${basis}/.well-known/security.txt`,
  ];
  if (typeof kontakt.richtlinie === 'string' && kontakt.richtlinie.trim() !== '') {
    zeilen.push(`Policy: ${kontakt.richtlinie.trim()}`);
  }
  return `${zeilen.join('\n')}\n`;
}
