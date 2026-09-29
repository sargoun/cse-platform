import type { NextRequest, NextResponse } from 'next/server';
import { ohneSitzungAntwort } from '@/server/auth/antwort';

/**
 * Die zweite Linie der Formulare im Mitarbeiterportal: ein Fehler der
 * DATENBANK als Grund (V-187, V-188, V-189, D-599).
 *
 * **Der Befund.** `POST /api/mein/antraege` und `POST /api/mein/abwesenheit`
 * antworteten auf jede Abweisung mit JSON, und auf eine Abweisung der
 * Datenbank — `check_violation` aus `antrag_pflichtfelder`, die
 * Ausschlussbedingung `ab_keine_dublette` — gar nicht: der Fehler trug keinen
 * `status`, die Route warf ihn weiter, und die Kraft sah eine rohe 500. Beide
 * Formulare laufen ohne JavaScript; eine JSON-Antwort ist dort genauso eine
 * weisse Seite wie der Absturz.
 *
 * **Der Rückweg selbst ist `grundAufsFormularweg`** (`api/formular-antwort.ts`,
 * V-198): der Grund als `?fehler=`, die Maske mit ihren Eingaben — aber nur
 * mit Auswahlen und Tagen. Freitext reist NICHT in der Adresse: die Bemerkung
 * einer Krankmeldung darf `cse_app` nicht einmal lesen (0073, Art. 9 DSGVO),
 * und eine Adresse landet in Verlauf und Protokollen. Hier stand bis zur
 * Zusammenführung mit V-198 ein eigener Rückweg (`zurMaske`); zwei Weichen für
 * dieselbe Frage wären beim nächsten Umbau zwei verschiedene geworden
 * (D-692 Nachsatz).
 */

/**
 * Ohne Sitzung (401) auf einem Schreibweg der Beschäftigten (D-766, V-256).
 *
 * **Der Wächter vor dem Formular war JSON** — auch für die Kraft, deren
 * Sitzung abgelaufen war, während sie im Treppenhaus das Wachbuch schrieb:
 * `{"fehler":"keine_sitzung"}` auf weissem Grund, in keiner ihrer vier
 * Sprachen, ohne Weg zurück (D-692 Nr. 7, abgelöst durch D-766). Jetzt geht
 * ein Browserformular auf DIE Anmeldung, die sie hat — Mobilnummer und Code,
 * `/auth/mitarbeiter` —, und von dort zurück auf die Seite des Formulars.
 * Ein Programm bekommt dasselbe JSON wie bisher.
 *
 * Die Entscheidung selbst steht in `ohneSitzungAntwort`; hier steht nur,
 * welche Anmeldung diese Routen haben. `daten` sind die schon gelesenen
 * Felder, wo die Route den Rumpf vor der Sitzung liest (die Schichtwege).
 */
export function ohneSitzungBeschaeftigte(anfrage: NextRequest, daten?: FormData): NextResponse {
  return ohneSitzungAntwort(anfrage, null, { anmeldung: 'beschaeftigte', felder: daten });
}

/** Ein Grund, den die Datenbank für eine Eingabe liefert. */
export type DatenbankGrund = 'ueberlappt' | 'ungueltige_eingabe' | 'kein_datum';

/**
 * Ein Fehler der DATENBANK als Grund — oder `null`, wenn er keiner ist, den
 * ein Mensch mit seiner Eingabe verursacht hat.
 *
 * Nur die SQLSTATEs, die aus einer Eingabe entstehen können: die
 * Ausschlussbedingung (`23P01`, dieselbe Meldung doppelt), eine Prüfbedingung
 * oder ein Auslöser (`23514`), ein Fremdschlüssel (`23503`, eine Auswahl, die
 * es in dieser Gesellschaft nicht gibt) und ein Datum, das es nicht gibt
 * (`22007`/`22008`, etwa der 31.02.). Alles andere bleibt ein Serverfehler —
 * und wird weitergeworfen, statt als „Eingabe prüfen" verkleidet zu werden.
 */
export function datenbankGrund(fehler: unknown): DatenbankGrund | null {
  if (typeof fehler !== 'object' || fehler === null) return null;
  const code = (fehler as { code?: unknown }).code;
  if (code === '23P01') return 'ueberlappt';
  if (code === '23514' || code === '23503') return 'ungueltige_eingabe';
  if (code === '22007' || code === '22008') return 'kein_datum';
  return null;
}

/**
 * Der HTTP-Status eines Datenbankgrunds für einen Aufrufer ohne Formular
 * (D-599: ein Programm bekommt JSON) — dieselbe Zahl wie die Büroroute
 * `api/personal/abwesenheit`: die doppelte Meldung ist ein Konflikt mit einer
 * vorhandenen Zeile, alles andere eine Eingabe, die nicht passt.
 */
export function datenbankStatus(grund: DatenbankGrund): number {
  return grund === 'ueberlappt' ? 409 : 400;
}
