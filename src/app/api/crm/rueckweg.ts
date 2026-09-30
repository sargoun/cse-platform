import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel } from '@/server/auth/ursprung';

/**
 * Der Rückweg einer CRM-Route auf die Seite ihres Formulars — mit genau EINEM
 * Schlüssel in der Adresse, nie mit einem Satz (D-769, D-772, V-274).
 *
 * **Die Namen, unter denen er reist.**
 *  - `fehler`: der Grund einer Abweisung, wo die Seite nur eine Route kennt
 *    oder deren Gründe mit ihren übrigen teilt (Lead, Steuer, Konditionen,
 *    Zugang, Rechtsgrundlage).
 *  - `grund`: `POST /api/crm/kunde` — das Kontaktblatt liest `fehler` für den
 *    Sendeweg (V-101); ein gescheiterter Hauptkontakt ist keine Nachricht, die
 *    nicht hinausging (V-148).
 *  - `wiedervorlage`: `POST /api/crm/wiedervorlage` — ihre Formulare stehen
 *    auf dem Leadblatt und dem Kontaktblatt, und beide lesen `fehler` schon
 *    für andere Formulare. `betreff_fehlt` hiesse dort „Ein Lead braucht einen
 *    Betreff", `kein_kontakt` „braucht einen Ansprechpartner" — ein eigener
 *    Name, wie `?notiz=` für die Notiz (V-147).
 *  - `erfolg`: der Schlüssel einer Bestätigung.
 *
 * **Warum nicht `grundAufsFormular`.** Er kennt nur `fehler`, und ohne
 * `zurueck` gibt er `null` (dann JSON). Die CRM-Routen kehren immer zurück —
 * ohne `zurueck` auf `/portal`, wie bisher; eine fachliche Abweisung hatte bei
 * ihnen nie einen JSON-Weg, und dieser Schritt erfindet keinen.
 *
 * `zurueck` läuft durch `internesZiel`: ein Ziel ausserhalb dieser Anwendung
 * ist kein Rückweg, sondern eine offene Weiterleitung (D-560).
 */
export type RueckwegParameter = 'fehler' | 'grund' | 'wiedervorlage' | 'erfolg';

export function zurueckMitSchluessel(
  anfrage: NextRequest, zurueck: string, parameter: RueckwegParameter, schluessel: string,
): NextResponse {
  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(internesZiel(
    `${zurueck}${trenner}${parameter}=${encodeURIComponent(schluessel)}`,
    '/portal', anfrage), 303);
}
