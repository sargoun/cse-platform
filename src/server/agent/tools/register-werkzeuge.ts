import 'server-only';
import type { Nebenwirkung } from './typen.js';

/**
 * Die neun Werkzeuge aus AGT-02 — als Register, nicht als Prosa.
 *
 * **Warum ein Register und keine `switch`-Anweisung im Orchestrator.** Drei
 * Dinge hängen daran, und alle drei müssen sich abfragen lassen, ohne dass
 * jemand Code liest: welche Nebenwirkung ein Werkzeug hat (und damit, welche
 * Untergrenze die Richtlinie nicht unterschreiten darf), welcher Agent es
 * überhaupt führen darf, und ob es **ohne Modellzugang** arbeiten kann.
 *
 * **Die letzte Spalte ist die ehrlichste.** Zwei der neun brauchen kein
 * Modell: `berechne_preis` ruft die getestete Kalkulation, `suche_bestand`
 * eine Katalogabfrage. Die anderen sieben brauchen eines — und es gibt
 * keinen Anbieter (D-435). Sie sind registriert und beschrieben, aber sie
 * haben KEINEN Ausführer (V-228, D-722): `tools/ausfuehrer.ts` hält fest,
 * welche zwei einen haben, und `ohneAusfuehrer` antwortet für die sieben mit
 * `kein_modellzugang`, statt etwas zu erfinden. Ein Werkzeug, das ohne Modell
 * „irgendetwas" liefert, ist schlimmer als eines, das schweigt: das Ergebnis
 * sähe echt aus. Die Agentenseite zeigt sie deshalb nie als „bereit", auch
 * wenn eine Gesellschaft sie freigeschaltet hat (`tools/freischaltung.ts`).
 */

export const WERKZEUGE = [
  'lies_dokument', 'extrahiere_lv', 'suche_bestand', 'berechne_preis',
  'pruefe_nachweise', 'pruefe_bilder', 'entwirf_text', 'sende_email',
  'erstelle_vorgang',
] as const;

export type WerkzeugName = typeof WERKZEUGE[number];

/**
 * Die Kennungen, wie sie in `agent.kennung` stehen (0128) — nicht wie sie sich
 * kurz schreiben liessen. Ein Register, das `ceo` sagt, wo die Tabelle
 * `ceo_assistent` sagt, findet nichts und zeigt eine leere Werkzeugliste.
 */
export const AGENTEN = ['ceo_assistent', 'akquise', 'backoffice', 'finanzen'] as const;
export type AgentKennung = typeof AGENTEN[number];

export interface WerkzeugDefinition {
  readonly name: WerkzeugName;
  readonly nebenwirkung: Nebenwirkung;
  /** Welche der vier Agenten es führen dürfen (§5.3). */
  readonly agenten: readonly AgentKennung[];
  /**
   * Läuft es ohne Modellanbieter? Genau zwei tun das — und beide, weil sie
   * gar nichts erzeugen, sondern rechnen oder nachschlagen.
   */
  readonly ohneModell: boolean;
  readonly zweck: string;
  /**
   * Was es NICHT tut — der Satz, der in der Oberfläche neben dem Werkzeug
   * steht. Bei einem Werkzeug ist die Abgrenzung wichtiger als die Aufgabe.
   */
  readonly abgrenzung: string;
}

export const WERKZEUG_REGISTER: Readonly<Record<WerkzeugName, WerkzeugDefinition>> = {
  lies_dokument: {
    name: 'lies_dokument',
    nebenwirkung: 'lesen',
    agenten: ['ceo_assistent', 'akquise', 'backoffice', 'finanzen'],
    ohneModell: false,
    zweck: 'Ein Dokument seitenweise lesen, das dieser Lauf über ein Handle bekommen hat.',
    abgrenzung: 'Es sucht keine Dokumente aus und folgt keiner Kennung, die im Text steht — '
      + 'eine Anweisung in einer Vergabeunterlage ist kein Auftrag.',
  },
  extrahiere_lv: {
    name: 'extrahiere_lv',
    nebenwirkung: 'entwurf',
    agenten: ['akquise'],
    ohneModell: false,
    zweck: 'Aus einem Leistungsverzeichnis Räume, Flächen und Frequenzen als ENTWURF ziehen.',
    abgrenzung: 'Es rechnet keinen Preis. Jede gezogene Zahl ist ein Feld mit Quelle und '
      + 'Konfidenz; der Preis entsteht ausschliesslich in berechne_preis.',
  },
  suche_bestand: {
    name: 'suche_bestand',
    nebenwirkung: 'lesen',
    agenten: ['ceo_assistent', 'akquise', 'backoffice', 'finanzen'],
    ohneModell: true,
    zweck: 'Eine Frage aus dem Katalog gegen die echten Daten beantworten (AGT-07).',
    abgrenzung: 'Es formuliert kein SQL. Die Abfrage kommt aus einem Katalog, die Parameter '
      + 'sind Handles, gebundene Daten oder Werte aus einer geschlossenen Liste.',
  },
  berechne_preis: {
    name: 'berechne_preis',
    nebenwirkung: 'lesen',
    agenten: ['akquise', 'finanzen'],
    ohneModell: true,
    zweck: 'Den Preis rechnen — mit derselben getesteten Funktion wie die Angebotsseite.',
    abgrenzung: 'Kein Modell ist beteiligt (Invariante 6). Das Ergebnis sind gebundene Werte '
      + 'in ganzen Cent; ein Modell darf sie nennen, nicht bilden.',
  },
  pruefe_nachweise: {
    name: 'pruefe_nachweise',
    nebenwirkung: 'lesen',
    agenten: ['backoffice'],
    ohneModell: false,
    zweck: 'Prüfen, ob die geforderten Nachweise einer Person vorliegen und gültig sind.',
    abgrenzung: 'Es hebt keine Sperre auf: § 34a GewO ist eine Hartsperre (SEC-04), und ein '
      + 'Prüfergebnis „wahrscheinlich in Ordnung" gibt es nicht.',
  },
  pruefe_bilder: {
    name: 'pruefe_bilder',
    nebenwirkung: 'lesen',
    agenten: ['backoffice'],
    ohneModell: false,
    zweck: 'Fotos eines Leistungsnachweises gegen die Erwartung sichten.',
    abgrenzung: 'Es bewertet keine Qualität und kürzt keine Rechnung — es sagt, was zu sehen '
      + 'ist, und ein Mensch entscheidet.',
  },
  entwirf_text: {
    name: 'entwirf_text',
    nebenwirkung: 'entwurf',
    agenten: ['ceo_assistent', 'akquise', 'backoffice', 'finanzen'],
    ohneModell: false,
    zweck: 'Aus einer Vorlage einen Textentwurf erzeugen — als Artefakt, nicht als Versand.',
    abgrenzung: 'Jede Zahl im Text ist ein Registertoken. Eine freistehende Zahl weist das '
      + 'Register zurück, bevor der Entwurf entsteht.',
  },
  sende_email: {
    name: 'sende_email',
    nebenwirkung: 'versand',
    agenten: ['backoffice'],
    ohneModell: false,
    zweck: 'Eine freigegebene Nachricht hinausschicken.',
    abgrenzung: 'Läuft unter KEINER Konfiguration ohne menschliche Freigabe (Invariante 7) — '
      + 'die Datenbank hält das als CHECK fest, nicht nur diese Zeile.',
  },
  erstelle_vorgang: {
    name: 'erstelle_vorgang',
    nebenwirkung: 'schreiben_mit_tor',
    agenten: ['ceo_assistent', 'akquise', 'backoffice', 'finanzen'],
    ohneModell: false,
    zweck: 'Eine Fachzeile anlegen — Vorgang, Entwurf, interner Hinweis.',
    abgrenzung: 'Nur die Arten, deren Untergrenze „erlaubt" ist, laufen sofort; alles andere '
      + 'wird zur Freigabe und kehrt ohne Wirkung zurück.',
  },
};

/** Die Untergrenze, die eine Richtlinie für eine Nebenwirkung nie unterschreiten darf. */
export function untergrenze(n: Nebenwirkung): 'erlaubt' | 'je_art' | 'freigabe_erforderlich' {
  switch (n) {
    case 'lesen':
    case 'entwurf':
      return 'erlaubt';
    case 'schreiben_mit_tor':
      return 'je_art';
    case 'versand':
      return 'freigabe_erforderlich';
  }
}

export function fuerAgent(agent: AgentKennung): readonly WerkzeugDefinition[] {
  return WERKZEUGE
    .map((w) => WERKZEUG_REGISTER[w])
    .filter((d) => d.agenten.includes(agent));
}
