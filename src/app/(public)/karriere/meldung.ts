import { BEWERBUNG_EMAIL } from '@/server/services/recruiting/dienst';

/**
 * Die Sätze, mit denen das Bewerbungsformular eine Abweisung erklärt
 * (REC-03, D-599, V-158).
 *
 * **Der Befund.** `POST /api/karriere/bewerbung` wird ausschliesslich vom
 * Formular ohne JavaScript aufgerufen — und antwortete auf jeden Fehler mit
 * JSON: `{"fehler":"unvollstaendig"}`, `{"fehler":"zu_viele"}`,
 * `{"fehler":"nicht_gefunden"}`. Der Browser nimmt bei `type="email"` etwa
 * `name@firma` an, der Dienst verlangt einen Punkt nach dem `@`; eine
 * Bewerberin sah dann eine geschweifte Klammer statt eines Satzes, auf einer
 * weissen Seite, ihre Nachricht weg. D-599 hat genau das für das
 * Angebotsformular als Fehler festgestellt und behoben — für die Bewerbung
 * nicht.
 *
 * **Deutsch, weil `/karriere` deutsch ist** (`NUR_DEUTSCH`, O-512). Wird der
 * Karrierebereich übersetzt, wird diese Tabelle eine je Sprache — die
 * Schlüssel bleiben.
 *
 * **Die eingegebenen Werte reisen NICHT zurück.** Name, E-Mail, Telefon und
 * Nachricht in einer Adresse stünden in jedem Zugriffsprotokoll und im
 * Verlauf des Browsers. Deshalb verhindert das Formular die häufigste
 * Abweisung schon VOR dem Absenden (`pattern` am E-Mail-Feld, dieselbe Regel
 * wie im Dienst), und der Satz sagt ehrlich, dass nichts angekommen ist.
 */
export const BEWERBUNG_MELDUNG: Readonly<Record<string, string>> = {
  unvollstaendig:
    'Ihre Bewerbung ist nicht angekommen: Name und eine E-Mail-Adresse, unter der wir '
    + 'Sie erreichen (etwa name@firma.de), sind Pflicht. Bitte füllen Sie das Formular '
    + 'noch einmal aus.',
  zu_viele:
    'Von dieser Verbindung kamen in kurzer Zeit sehr viele Bewerbungen. Ihre ist nicht '
    + 'angekommen — bitte versuchen Sie es später noch einmal.',
  kein_bereich:
    'Ihre Bewerbung ist nicht angekommen: bitte wählen Sie, bei welcher Gesellschaft '
    + 'Sie arbeiten möchten.',
  stelle_geschlossen:
    'Diese Stelle ist nicht mehr ausgeschrieben, und Ihre Bewerbung ist nicht angekommen. '
    + 'Unten stehen die offenen Stellen — oder Sie bewerben sich initiativ.',
};

/** Der Satz, wenn der Grund keiner der bekannten ist. Nie der rohe Grund. */
export const BEWERBUNG_MELDUNG_SONST =
  'Ihre Bewerbung ist nicht angekommen. Bitte versuchen Sie es noch einmal.';

/** Der Satz zu einem Grund aus der Adresse — oder `undefined`, wenn keiner da ist. */
export function bewerbungsMeldung(grund: unknown): string | undefined {
  if (typeof grund !== 'string' || grund === '') return undefined;
  return BEWERBUNG_MELDUNG[grund] ?? BEWERBUNG_MELDUNG_SONST;
}

/**
 * Die E-Mail-Form des Dienstes (`recruiting/dienst.ts`, `bewerbung_email_form`)
 * — als `pattern` für das Feld. Ein `type="email"` allein lässt `name@firma`
 * durch; der Dienst nicht.
 *
 * Aus der Regel des Dienstes ABGELEITET und nicht abgeschrieben: zwei Kopien
 * laufen auseinander, und dann weist der Dienst ab, was das Feld durchliess —
 * genau der Befund. `pattern` ist implizit verankert, also ohne `^…$`.
 */
export const EMAIL_MUSTER = BEWERBUNG_EMAIL.source.replace(/^\^/u, '').replace(/\$$/u, '');
