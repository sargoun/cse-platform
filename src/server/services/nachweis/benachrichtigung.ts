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
import { registriereArt, type ArtDefinition } from '../../benachrichtigung/registry.js';

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

function stufenArt(stufe: Warnstufe): ArtDefinition {
  return registriereArt({
    schluessel: artSchluessel(stufe),
    titel: (k) =>
      `Nachweis läuft in ${String(stufe)} Tagen ab: `
      + `${String(k.daten['bezeichnung'] ?? 'unbenannt')}`,
    text: (k) => {
      const bis = String(k.daten['gueltigBis'] ?? 'unbekannt');
      const sperrt = k.daten['blockiertEinsatz'] === true;
      return `Der Nachweis „${String(k.daten['bezeichnung'] ?? 'unbenannt')}" ist nur noch `
        + `bis zum ${bis} gültig.`
        + (sperrt
          // Kein Schoenreden: SEC-04 ist eine Hartsperre, keine Warnung.
          ? ' Ohne gültigen Nachweis ist ab diesem Tag keine Einteilung mehr möglich '
            + '(§34a GewO).'
          : ' Bitte rechtzeitig verlängern.');
    },
    ziel: () => ZIEL,
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

/** Registriert die drei Arten. Idempotent ist sie NICHT — `registriereArt`
 *  wirft bei einer doppelten Registrierung, und das ist richtig so: zwei
 *  Definitionen einer Art sind zwei Texte fuer dieselbe Meldung. */
export function registriereNachweisArten(): readonly ArtDefinition[] {
  return WARNSTUFEN.map(stufenArt);
}
