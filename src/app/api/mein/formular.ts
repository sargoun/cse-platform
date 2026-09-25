import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel } from '@/server/auth/ursprung';
import { maskeMitEingaben } from '@/lib/formular/maske';

/**
 * Der Rückweg eines abgewiesenen Formulars im Mitarbeiterportal (V-187,
 * V-188, D-599).
 *
 * **Der Befund.** `POST /api/mein/antraege` und `POST /api/mein/abwesenheit`
 * antworteten auf jede Abweisung mit JSON, und auf eine Abweisung der
 * Datenbank — `check_violation` aus `antrag_pflichtfelder`, die
 * Ausschlussbedingung `ab_keine_dublette` — gar nicht: der Fehler trug keinen
 * `status`, die Route warf ihn weiter, und die Kraft sah eine rohe 500. Beide
 * Formulare laufen ohne JavaScript; eine JSON-Antwort ist dort genauso eine
 * weisse Seite wie der Absturz.
 *
 * **Die Maske kommt mit ihren Eingaben zurück** (`maskeMitEingaben`) — aber
 * nur mit Auswahlen und Tagen. Freitext reist NICHT in der Adresse: die
 * Bemerkung einer Krankmeldung darf `cse_app` nicht einmal lesen (0073,
 * Art. 9 DSGVO), und eine Adresse landet in Verlauf und Protokollen. Die
 * Seite sagt stattdessen, dass die Nachricht noch einmal einzugeben ist.
 */
export function zurMaske(
  anfrage: NextRequest,
  maske: string,
  grund: string,
  werte: Readonly<Record<string, string | null | undefined>>,
): NextResponse {
  return NextResponse.redirect(
    internesZiel(maskeMitEingaben(maske, grund, werte), maske, anfrage), 303);
}

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
export function datenbankGrund(
  fehler: unknown,
): 'ueberlappt' | 'ungueltige_eingabe' | 'kein_datum' | null {
  if (typeof fehler !== 'object' || fehler === null) return null;
  const code = (fehler as { code?: unknown }).code;
  if (code === '23P01') return 'ueberlappt';
  if (code === '23514' || code === '23503') return 'ungueltige_eingabe';
  if (code === '22007' || code === '22008') return 'kein_datum';
  return null;
}
