import 'server-only';
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';

/**
 * Die Meldung, die NOT-01 unter „schedule change" fuehrt (TIM-01, NOT-01,
 * NOT-03).
 *
 * **Sie hat gefehlt, und zwar genau diese eine.** Zwei `dienstplan.*`-Arten
 * waren registriert — `dienstplan.schicht_ohne_zeiteintrag` und
 * `dienstplan.morgen_unbesetzt`, beide aus dem Nachtwaechter
 * (`services/waechter/benachrichtigung.ts`) —, und das Modul `dienstplan`
 * steht in `MODUL_TITEL`. Es fehlte also kein Modulaufbau, sondern die Art
 * fuer die Bekanntgabe selbst: `dienstplan.veroeffentlichen` kam im Baum nur
 * im Rechtekatalog, im Routenregister und als Kommentar vor.
 *
 * **Ziel ist der eigene Plan, nicht der Verwaltungsvorgang.** Die Person
 * bekommt einen Verweis auf `/portal/mein/schichten` — ihre Schichten, in
 * ihrer Sprache, ueber alle Gesellschaften hinweg (EMP-14). Der
 * Veroeffentlichungsvorgang mit seinen Zahlen ueber die ganze Kolonne gehoert
 * der Planung; er waere fuer die Empfaengerin ein Ziel, das sie nicht oeffnen
 * darf, und NOT-03 nennt genau das den Fehler.
 *
 * **Kein Mandanten-Slug im Ziel.** `/portal/mein/…` ist Personen-Scope und
 * traegt kein `[mandant]`-Segment — ein Ziel aus dem Slug waere hier die
 * falsche Adresse, und `slugTor()` antwortete darauf mit 404 (Befund PR 12).
 *
 * **Nicht sammelbar.** Ein Dienstplan, den man am Einsatztag in einer
 * Tageszusammenfassung liest, ist einer, den man zu spaet liest.
 *
 * **Zusammengesetzter Schluessel** — ein Literal der Form `<modul>.<etwas>`
 * läse der Rechtekatalog-Scanner sonst als Rechteschluessel (K-19, D-493).
 */

const DIENSTPLAN = 'dienstplan';

export const ART_PLAN_VEROEFFENTLICHT = `${DIENSTPLAN}.plan_veroeffentlicht`;

/** Das eine Ziel — Personen-Scope, ohne Bereichssegment. */
export const ZIEL_MEINE_SCHICHTEN = '/portal/mein/schichten';

function planVeroeffentlicht(): ArtDefinition {
  return ({
    schluessel: ART_PLAN_VEROEFFENTLICHT,
    titel: (k) => `Dienstplan veröffentlicht: ${String(k.daten['zeitraum'] ?? '')}`,
    text: (k) => {
      const schichten = Number(k.daten['schichten'] ?? 0);
      const gesellschaft = k.daten['gesellschaft'];
      return `Der Dienstplan für ${String(k.daten['zeitraum'] ?? 'den Zeitraum')} ist `
        + 'veröffentlicht'
        + (typeof gesellschaft === 'string' && gesellschaft !== ''
          ? ` (${gesellschaft})` : '')
        + '. Für Sie sind darin '
        + (schichten === 1 ? '1 Schicht' : `${String(schichten)} Schichten`)
        + ' eingeteilt. Die Zeiten stehen in Europe/Berlin; eine Nachtschicht steht '
        + 'an dem Abend, an dem sie beginnt.';
    },
    ziel: () => ZIEL_MEINE_SCHICHTEN,
    kanaeleVorgabe: ['app'],
    sammelbar: false,
  });
}

/**
 * Idempotent (D-493): der Bootstrap laeuft im Test mehrfach, und
 * `sicherRegistriert` prueft je Schluessel — nicht ueber einen
 * Stellvertreter.
 */
export function registriereDienstplanArten(): readonly ArtDefinition[] {
  return sicherRegistriert([planVeroeffentlicht()]);
}
