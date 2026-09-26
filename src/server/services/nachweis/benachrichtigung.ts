/**
 * Die Ablaufwarnungen 60/30/7 als Benachrichtigungsarten (SPEC §14, SEC-02,
 * EMP-08, NOT-01, NOT-03).
 *
 * **Drei Arten und nicht eine mit einer Stufenzahl im Text.** Der Unterschied
 * ist NOT-02: ein Mensch, der die Sechzig-Tage-Vorwarnung per E-Mail nicht mehr
 * will, aber die Sieben-Tage-Warnung schon, kann das nur einstellen, wenn die
 * beiden getrennte Arten sind — `benachrichtigung_praeferenz` ist je Art.
 *
 * **KEINE ist sammelbar.** Eine Ablaufwarnung, die in der Tagessammlung des
 * naechsten Morgens landet, wird nach der Frist gelesen; bei der
 * Sieben-Tage-Stufe ist das ein Achtel der verbleibenden Zeit. Dasselbe
 * Argument, mit dem `crm.lead_sla_ueberschritten` nicht sammelbar ist.
 *
 * **Das Ziel ist das Portal des MENSCHEN.** §11.2 ist ausdruecklich: der
 * Waechter „notifies the **person**". `/portal/mein/nachweise` traegt in der
 * Seitenkarte genau EMP-08/SEC-02/SEC-03 — die Seite, auf der der Mensch seine
 * eigenen Zertifikate mit persoenlicher Ablaufwarnung sieht.
 */
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';
import { setze, texteFuer } from '../../../lib/i18n/benachrichtigung.js';

/**
 * Die drei Stufen, die SPEC §14 woertlich nennt.
 *
 * `qualifikation.warnung_tage` kann je Zeile davon abweichen — eine
 * Qualifikation mit halbjaehriger Wiederbeschaffungszeit braucht eine andere
 * Vorwarnung. Fuer eine Stufe ohne registrierte Art wirft `erzeuge` einen
 * `ArtFehler`; der Waechter meldet sie dann als nicht zustellbar, statt sie
 * stillschweigend fallen zu lassen.
 */
export const WARNSTUFEN = [60, 30, 7] as const;

export type Warnstufe = (typeof WARNSTUFEN)[number];

/**
 * Der Artschluessel einer Stufe.
 *
 * Zusammengesetzt und nicht als Literal geschrieben: ein Zeichenkettenliteral
 * der Form `<modul>.<etwas>` in `src/**` wird vom Rechtekatalog-Scanner
 * (`scripts/katalog/benutzung.ts`) als Rechteschluessel gelesen und faende dort
 * keine Katalogzeile — ein roter Lauf fuer eine Benachrichtigungsart, die gar
 * kein Recht ist.
 */
export function artSchluessel(stufe: number): string {
  return `nachweis.ablauf_${String(stufe)}`;
}

const ZIEL = '/portal/mein/nachweise';

/**
 * **Die Warnung steht in der Sprache der Empfängerin** (V-102, O-889).
 *
 * Diese Meldung geht an einen ARBEITER, und sie kündigt eine Sperre nach
 * § 34a GewO an: ab dem genannten Tag ist keine Einteilung mehr möglich. Das
 * Arbeiterportal steht in vier Sprachen, weil die Menschen dort nicht alle
 * Deutsch lesen — die eine Meldung, die ihnen sagt, dass sie nicht mehr
 * arbeiten können, stand nur auf Deutsch da.
 *
 * `person.sprache` kommt vom Erzeuger herein (`ablauf.ts`); fehlt sie, gilt
 * Deutsch. Die Bezeichnung der Qualifikation bleibt, wie sie ist: sie zu
 * übersetzen hiesse, sie zu erfinden.
 */
function stufenArt(stufe: Warnstufe): ArtDefinition {
  return ({
    schluessel: artSchluessel(stufe),
    titel: (k) => setze(texteFuer(k.sprache).nachweisAblauf.titel, {
      tage: stufe,
      nachweis: String(k.daten['bezeichnung'] ?? 'unbenannt'),
    }),
    text: (k) => {
      const t = texteFuer(k.sprache).nachweisAblauf;
      const sperrt = k.daten['blockiertEinsatz'] === true;
      return setze(t.text, {
        nachweis: String(k.daten['bezeichnung'] ?? 'unbenannt'),
        bis: String(k.daten['gueltigBis'] ?? 'unbekannt'),
      })
        // Kein Schoenreden: SEC-04 ist eine Hartsperre, keine Warnung.
        + (sperrt ? t.sperrt : t.verlaengern);
    },
    ziel: () => ZIEL,
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/**
 * Registriert die drei Stufen — idempotent, wie Radar und Waechter (D-493).
 *
 * Dass `registriereArt` bei einer doppelten Registrierung wirft, bleibt
 * richtig: zwei Definitionen einer Art sind zwei Texte fuer dieselbe Meldung.
 * Der zweite Aufruf DIESER Funktion ist aber keine zweite Definition, sondern
 * ein zweiter Aufruf desselben Moduls — der Jobbootstrap laeuft im Test
 * mehrfach, und seit NOT-02 meldet `benachrichtigung/bootstrap.ts` alle Arten
 * an, um sie auf der Einstellungsseite aufzaehlen zu koennen.
 *
 * Geprueft wird JE STUFE. Die fruehere Fassung fragte „sind alle drei da?"
 * und meldete sonst alle drei neu an — waren zwei da und eine fehlte, warf
 * die Neuanmeldung ueber der ersten vorhandenen, und aus einer fehlenden
 * Warnstufe wurde ein Fehler bei jedem Seitenaufruf.
 */
export function registriereNachweisArten(): readonly ArtDefinition[] {
  return sicherRegistriert(WARNSTUFEN.map(stufenArt));
}
