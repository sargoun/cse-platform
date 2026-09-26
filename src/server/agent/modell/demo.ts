import 'server-only';
import { createHash } from 'node:crypto';
import {
  type EinbettungErgebnis, type ModellPort, type TextAuftrag, type TextErgebnis,
} from './port.js';

/**
 * Der Demobetrieb — **ein Anbieter, der keiner ist**.
 *
 * **Wofür er da ist.** Eine Plattform, die man nicht laufen sehen kann, lässt
 * sich nicht beurteilen: der Freigabe-Posteingang bleibt leer, das
 * Agentenzentrum zeigt Nullen, und ob die Kette vom Vorschlag bis zur
 * Entscheidung trägt, weiss niemand. Dieser Port macht sie sichtbar, ohne
 * einen Auftragsverarbeiter zu brauchen.
 *
 * **Er ist kein Sprachmodell, und das ist Absicht.** Er formuliert aus
 * Vorlagen und aus Tatsachen, die vorher gerechnet wurden — deterministisch,
 * wiederholbar, ohne einen einzigen erfundenen Wert. Damit tut er an dieser
 * Stelle genau das, was ein echtes Modell auch dürfte (Invariante 6: die KI
 * rechnet nie), und nichts darüber hinaus. Wer ihn gegen OpenAI tauscht,
 * tauscht die Formulierung aus, nicht die Rechnung.
 *
 * **Warum er im Register mit drei grünen Flaggen steht.** Er läuft im eigenen
 * Prozess: kein Netzverkehr, kein Empfänger, keine Speicherung ausserhalb
 * dieser Datenbank. EU-Verarbeitung und Nullspeicherung sind hier keine
 * Behauptung über einen Anbieter, sondern Tatsachen über den Betrieb. Das
 * Residenztor ist erfüllt, nicht umgangen.
 *
 * **Und er trägt seinen Namen in jedem Schritt** (`demo:hausintern-v1`), damit
 * später niemand raten muss, welcher Entwurf aus welcher Quelle kam.
 */

export const DEMO_MODELL = 'demo:hausintern-v1';

/**
 * Die Vorlagen — je Vorgangsart ein Satzbau.
 *
 * **Warum Vorlagen und kein Zufall.** Ein Demobetrieb, der jedes Mal etwas
 * anderes schreibt, ist als Grundlage für einen Bildschirmtest wertlos: die
 * Prüfung könnte nicht sagen, was dastehen soll. Gleiche Tatsachen, gleicher
 * Satz — und wenn sich der Satz ändert, ändert ihn jemand hier.
 *
 * Die Platzhalter sind `{schluessel}` und werden NUR aus `tatsachen` gefüllt.
 * Ein Platzhalter ohne Tatsache bleibt stehen und fällt auf; er wird nicht
 * stillschweigend zu einer leeren Zeichenkette, denn ein Entwurf mit einer
 * Lücke ist besser als einer mit einer stillen Null.
 */
const VORLAGEN: Readonly<Record<string, string>> = {
  monatsrechnung_entwurf:
    'Die Monatsrechnung für {objekt} steht zur Freigabe: {zusammenfassung} '
    + 'Grundlage sind die erfassten Leistungen des Zeitraums {zeitraum}. '
    + 'Der Betrag ist gerechnet, nicht geschätzt — die Positionen stehen unten einzeln.',
  /*
   * **Der Lückensatz steht in `[[…]]` und entfällt ohne Lücke** (V-230,
   * D-724). Vorher stand hier „Für ein verbindliches Angebot fehlt uns noch
   * {offen}", und `offen` war fest „die Angabe zur Personenzahl" — in jeder
   * Antwort. Jetzt nennt der Satz nur leere Felder der Anfrage, und ist keines
   * leer, gibt es ihn nicht; ein stehengelassener Platzhalter wäre im Entwurf
   * an den Kunden sichtbar.
   */
  anfrage_antwort_entwurf:
    'Antwortentwurf an {empfaenger}: Vielen Dank für Ihre Anfrage vom {datum}. '
    + '{zusammenfassung} '
    + '[[Für die weitere Bearbeitung fehlen uns aus Ihrer Anfrage noch folgende Angaben: '
    + '{offen}. ]]'
    + 'Der Text ist ein Entwurf und geht erst nach Ihrer Freigabe hinaus.',
  interner_hinweis:
    'Hinweis für die Objektleitung: {zusammenfassung} Stand {stand}. '
    + 'Empfehlung: {empfehlung}',
  nachtrag_entwurf:
    'Nachtrag {nummer} zum Projekt {projekt}: {zusammenfassung} '
    + 'Die Mengen stammen aus dem Aufmass, die Preise aus dem Leistungsverzeichnis.',
  stellenanzeige_entwurf:
    'Stellenanzeige {titel} für {gesellschaft}: {zusammenfassung} '
    + 'Einsatzort {ort}, Beginn {beginn}. Der Entwurf nennt keine Angaben zu Alter, '
    + 'Geschlecht oder Herkunft (AGG) und geht erst nach Freigabe an ein Portal.',
  beitrag_veroeffentlichen:
    'Beitragsentwurf für {kanal}: {zusammenfassung} '
    + 'Der Beitrag zeigt nur freigegebene Referenzen (PRO-05) und wird erst nach '
    + 'Freigabe veröffentlicht.',
  buchung_uebernehmen:
    'Vorschlag zur Übernahme: {zusammenfassung} Der Beleg ist gelesen, die Felder '
    + 'stehen mit Quelle und Konfidenz daneben. Übernommen wird erst nach Freigabe.',
};

/** Der Satz, wenn eine Vorgangsart noch keine Vorlage hat — ehrlich statt erfunden. */
const OHNE_VORLAGE =
  'Für diese Vorgangsart gibt es im Demobetrieb noch keine Vorlage. Die Tatsachen '
  + 'stehen unten; der Text kommt, sobald ein Modell freigegeben ist.';

const PLATZHALTER = /\{([a-z_]+)\}/gu;

/**
 * Füllt die Platzhalter aus den Tatsachen.
 *
 * **Ein Satz in `[[…]]` ist optional:** fehlt eine Tatsache für einen seiner
 * Platzhalter, entfällt der ganze Satz — statt dass ein halber mit einem
 * sichtbaren `{platzhalter}` im Entwurf steht (V-230). Ausserhalb von `[[…]]`
 * bleibt ein Platzhalter ohne Tatsache stehen und fällt auf; er wird nicht
 * stillschweigend leer.
 */
export function fuelle(vorlage: string, tatsachen: Readonly<Record<string, string>>): string {
  const hat = (schluessel: string): boolean =>
    Object.hasOwn(tatsachen, schluessel) && tatsachen[schluessel] !== '';
  const ohneLeereSaetze = vorlage.replaceAll(/\[\[([^\]]*)\]\]/gu, (_treffer, satz: string) =>
    [...satz.matchAll(PLATZHALTER)].every((m) => hat(m[1]!)) ? satz : '');
  return ohneLeereSaetze.replaceAll(PLATZHALTER, (treffer, schluessel: string) =>
    (Object.hasOwn(tatsachen, schluessel) ? tatsachen[schluessel]! : treffer));
}

/**
 * **Die Einbettung ist ein Hash, kein Bedeutungsvektor — und sie sagt es.**
 *
 * Aus dem SHA-256 des Textes werden 1536 Zahlen abgeleitet und auf Länge 1
 * normiert. Damit ist sie: deterministisch (derselbe Text → derselbe Vektor),
 * verschieden für verschiedene Texte, und **ohne jede Ähnlichkeitsbedeutung**
 * — zwei Texte über dasselbe Thema liegen nicht näher beieinander als zwei
 * fremde.
 *
 * Das ist genau der Punkt: der Index lässt sich damit bauen, füllen, anzeigen
 * und ausräumen, der ganze Weg ist prüfbar — und die Ähnlichkeitssuche liefert
 * sichtbar Unsinn statt plausiblen Unsinn. Ein zufälliger Vektor sähe
 * genauso aus und wäre gefährlicher: seine Treffer wirkten brauchbar.
 */
function demoVektor(text: string): readonly number[] {
  const roh = createHash('sha256').update(text, 'utf8').digest();
  const zahlen: number[] = [];
  for (let i = 0; i < 1536; i += 1) {
    /* 32 Bytes Hash auf 1536 Stellen strecken — mit dem Index als Beimischung,
       damit sich die Bytes nicht schlicht achtundvierzigmal wiederholen. */
    const byte = roh[i % roh.length] ?? 0;
    const misch = (byte ^ ((i * 31) & 0xff)) / 255;
    zahlen.push(misch - 0.5);
  }
  const laenge = Math.sqrt(zahlen.reduce((s, z) => s + z * z, 0));
  return laenge === 0 ? zahlen : zahlen.map((z) => z / laenge);
}

/** Grob gezählt: vier Zeichen je Token, wie es die Anbieter selbst überschlagen. */
function tokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class DemoModell implements ModellPort {
  readonly anbieter = 'demo';
  readonly modell = DEMO_MODELL;

  entwerfe(auftrag: TextAuftrag): Promise<TextErgebnis> {
    const start = performance.now();
    const vorlage = VORLAGEN[auftrag.vorlage] ?? OHNE_VORLAGE;
    const text = fuelle(vorlage, auftrag.tatsachen);
    return Promise.resolve({
      text,
      verbrauch: {
        modell: this.modell,
        tokensEingabe: tokens(JSON.stringify(auftrag.tatsachen)),
        tokensAusgabe: tokens(text),
        dauerMs: Math.round(performance.now() - start),
      },
    });
  }

  bette(text: string): Promise<EinbettungErgebnis> {
    const start = performance.now();
    return Promise.resolve({
      vektor: demoVektor(text),
      verbrauch: {
        modell: this.modell,
        tokensEingabe: tokens(text),
        tokensAusgabe: 0,
        dauerMs: Math.round(performance.now() - start),
      },
    });
  }
}
