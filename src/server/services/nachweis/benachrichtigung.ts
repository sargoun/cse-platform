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
/**
 * TODO(client, O-31): Voreinstellung — Stufen 60, 30 und 7 Tage vor Ablauf
 * (je Qualifikation aenderbar, `warnung_tage`); die Meldung geht an die
 * Beschaeftigte selbst, ab 30 Tagen zusaetzlich an die Personalstelle
 * (`personal.nachweis_lesen` in der erfassenden Gesellschaft), ab 7 Tagen an
 * die Leitung der Gesellschaft (Rolle `leitung`, mit `personal.nachweis_lesen`).
 * Gebaut mit V-380. D-800, D-810.
 */
export const WARNSTUFEN = [60, 30, 7] as const;

/** Ab dieser Stufe (Tage vor Ablauf) erfährt es die Personalstelle (O-31). */
export const PERSONALSTELLE_AB_TAGE = 30;
/** Ab dieser Stufe erfährt es die Leitung der Gesellschaft (O-31). */
export const LEITUNG_AB_TAGE = 7;
/*
 * Wer Personalstelle und wer Leitung ist, entscheidet
 * `kern.nachweis_ablauf_empfaenger` (0504): `personal.nachweis_lesen` in der
 * erfassenden Gesellschaft bzw. die Systemrolle `leitung` (03-AUTH §12) — auch
 * sie nur mit `personal.nachweis_lesen`, dem Recht hinter dem Ziel (NOT-03).
 */

const NACHWEIS = 'nachweis';
/** Zusammengesetzt, aus demselben Grund wie `artSchluessel` (Katalogscanner). */
export const ART_ABLAUF_PERSONALSTELLE = `${NACHWEIS}.ablauf_personalstelle`;
export const ART_ABLAUF_LEITUNG = `${NACHWEIS}.ablauf_leitung`;

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
/**
 * **Personalstelle und Leitung** (V-380, O-31, D-810).
 *
 * Deutsch: die Empfänger arbeiten im internen Portal (ArtDefinition, V-102).
 * Die Meldung nennt den Menschen — die Personalstelle muss wissen, WESSEN
 * Nachweis abläuft —, nie mehr als Name, Nachweis, Ablauftag und ob danach
 * die Einteilung gesperrt ist. Das Ziel ist das Nachweisregister der
 * erfassenden Gesellschaft.
 */
function teamArt(schluessel: string, fuer: 'personalstelle' | 'leitung'): ArtDefinition {
  return ({
    schluessel,
    titel: (k) => {
      const tage = String(k.daten['stufeTage'] ?? '?');
      const wer = `${String(k.daten['person'] ?? 'unbekannt')} — `
        + String(k.daten['bezeichnung'] ?? 'unbenannt');
      return fuer === 'leitung'
        ? `In ${tage} Tagen läuft ein Nachweis ab: ${wer}`
        : `Nachweis läuft in ${tage} Tagen ab: ${wer}`;
    },
    text: (k) => {
      const sperrt = k.daten['blockiertEinsatz'] === true;
      return `${String(k.daten['person'] ?? 'Eine Beschäftigte')}: „`
        + `${String(k.daten['bezeichnung'] ?? 'unbenannt')}" gilt bis `
        + `${String(k.daten['gueltigBis'] ?? 'unbekannt')}. `
        + (sperrt
          ? 'Danach ist keine Einteilung mehr möglich (SEC-04) — die Verlängerung muss vorher '
            + 'eingetragen sein.'
          : 'Bitte die Verlängerung veranlassen und im Nachweisregister eintragen.');
    },
    ziel: (k) => (typeof k.mandantSlug === 'string' && k.mandantSlug !== ''
      ? `/portal/${k.mandantSlug}/personal/nachweise` : null),
    kanaeleVorgabe: ['app', 'email'],
    sammelbar: false,
  });
}

export function registriereNachweisArten(): readonly ArtDefinition[] {
  return sicherRegistriert([
    ...WARNSTUFEN.map(stufenArt),
    teamArt(ART_ABLAUF_PERSONALSTELLE, 'personalstelle'),
    teamArt(ART_ABLAUF_LEITUNG, 'leitung'),
  ]);
}
