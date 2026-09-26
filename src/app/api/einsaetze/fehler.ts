import {
  AnstellungNichtGefunden, ArbzgPruefungNichtErlaubt, BereitsEingeteilt, EinsatzNichtGefunden,
  GrundFehlt, SchichtStorniert, ZuordnungNichtGefunden,
} from '@/server/services/dienstplan/einteilung';

/**
 * Der Grund, unter dem das Schichtblatt einen Fachfehler der Einteilung in
 * seiner Sprache findet (`SCHICHT_TEXTE.fehler`, V-158).
 *
 * **Der Befund.** `POST /api/einsaetze/[id]/absagen` und `…/besetzen` werden
 * NUR von Formularen ohne JavaScript aufgerufen und antworteten auf jeden
 * Fachfehler mit `{"fehler": code}` — den deutschen Satz des Dienstes warfen
 * sie dabei weg. Wer als Absagegrund „ok" tippte (der Dienst verlangt drei
 * Zeichen, das Feld verlangte nur `required`), sah eine weisse Seite mit
 * `{"fehler":"ungueltige_eingabe"}`; ein Doppelklick auf „Einteilen" oder
 * eine veraltete Seite ebenso (`BereitsEingeteilt`, `SchichtStorniert`).
 *
 * **Warum ein Grund und nicht der Satz des Dienstes.** Drei der Sätze tragen
 * eine Kennung („Einteilung 3f2a… gibt es in dieser Gesellschaft nicht"), und
 * alle sind deutsch — das Schichtblatt spricht Deutsch und Englisch.
 *
 * `null` heisst: kein Fachfehler der Einteilung — der Aufrufer wirft weiter.
 * Ein Fehler mit `status` und `code`, den diese Liste nicht beim Namen kennt,
 * wird `abgewiesen`: lieber ein allgemeiner Satz als ein 500 für etwas, das
 * der Dienst absichtlich abgelehnt hat.
 */
export function einteilungsGrund(fehler: unknown): string | null {
  if (fehler instanceof GrundFehlt) return 'grund_fehlt';
  if (fehler instanceof ZuordnungNichtGefunden) return 'einteilung_weg';
  if (fehler instanceof SchichtStorniert) return 'schon_storniert';
  if (fehler instanceof BereitsEingeteilt) return 'bereits_eingeteilt';
  if (fehler instanceof AnstellungNichtGefunden) return 'anstellung_weg';
  if (fehler instanceof EinsatzNichtGefunden) return 'nicht_gefunden';
  if (fehler instanceof ArbzgPruefungNichtErlaubt) return 'kein_arbzg_recht';
  const status = (fehler as { status?: unknown } | null)?.status;
  const code = (fehler as { code?: unknown } | null)?.code;
  if (typeof status === 'number' && typeof code === 'string') return 'abgewiesen';
  return null;
}

/** Status und Code eines Fachfehlers — für den JSON-Aufrufer ohne Rückweg. */
export function fachStatus(fehler: unknown): { readonly status: number; readonly code: string } {
  const status = (fehler as { status?: unknown } | null)?.status;
  const code = (fehler as { code?: unknown } | null)?.code;
  return {
    status: typeof status === 'number' ? status : 400,
    code: typeof code === 'string' ? code : 'abgewiesen',
  };
}
