import { eigenerEintrag } from '@/lib/nachschlagen';
import type { Sprache } from '@/lib/sprache';
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
 * **Eine Tabelle je Sprache, dieselben Schlüssel** (V-393, D-82): der
 * Karrierebereich steht deutsch unter `/karriere` und englisch unter
 * `/en/karriere`. `BEWERBUNG_MELDUNG` bleibt die deutsche — und die, die ein
 * Programm als `meldung` im JSON bekommt.
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

/**
 * Dieselben Gründe englisch — die Schlüssel der deutschen Tabelle, keiner mehr
 * (`tests/kern/karriere-englisch.test.ts` hält beide gleich).
 */
export const BEWERBUNG_MELDUNG_EN: Readonly<Record<string, string>> = {
  unvollstaendig:
    'Your application has not arrived: a name and an email address at which we can '
    + 'reach you (such as name@company.com) are required. Please fill in the form again.',
  zu_viele:
    'A great many applications came from this connection in a short time. Yours has '
    + 'not arrived — please try again later.',
  kein_bereich:
    'Your application has not arrived: please choose the company you would like to '
    + 'work for.',
  stelle_geschlossen:
    'This position is no longer advertised, and your application has not arrived. The '
    + 'open positions are listed below — or you can apply without a vacancy.',
};

/** Der Satz, wenn der Grund keiner der bekannten ist. Nie der rohe Grund. */
export const BEWERBUNG_MELDUNG_SONST =
  'Ihre Bewerbung ist nicht angekommen. Bitte versuchen Sie es noch einmal.';
const BEWERBUNG_MELDUNG_SONST_EN =
  'Your application has not arrived. Please try again.';

/**
 * Der Satz zu einem Grund aus der Adresse — oder `undefined`, wenn keiner da ist.
 *
 * **Nur ein EIGENER Schlüssel der Tabelle zählt** (V-159, `eigenerEintrag`).
 * Hier stand der gewöhnliche Zugriff mit Rückfall (`TABELLE[grund] ?? SONST`):
 * `?fehler=__proto__` fand
 * `Object.prototype`, der Rückfall griff nicht, und `/karriere`,
 * `/karriere/initiativbewerbung` und `/karriere/<id>/bewerbung` antworteten
 * mit einer Fehlerseite — auf eine Adresse, die jeder tippen kann.
 */
export function bewerbungsMeldung(grund: unknown, sprache: Sprache = 'de'): string | undefined {
  if (typeof grund !== 'string' || grund === '') return undefined;
  return sprache === 'en'
    ? eigenerEintrag(BEWERBUNG_MELDUNG_EN, grund) ?? BEWERBUNG_MELDUNG_SONST_EN
    : eigenerEintrag(BEWERBUNG_MELDUNG, grund) ?? BEWERBUNG_MELDUNG_SONST;
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
