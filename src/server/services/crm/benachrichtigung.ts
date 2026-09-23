/**
 * Die Benachrichtigungsart der Wiedervorlage (CRM-04, NOT-01, NOT-03, V-146).
 *
 * **Der Befund, der diese Datei gebracht hat.** Lead- und Kontaktblatt bieten
 * seit PR 18 das Feld „Erinnerung" an, `lead_aktivitaet.erinnerung_am` wird
 * geschrieben und beim Verschieben mitgeführt — und nichts las den Wert. Wer
 * eine Erinnerung eintrug, bekam keine. Die Art steht hier, der Lauf, der
 * sie erzeugt, in `jobs/wiedervorlageErinnerung.ts` (D-640).
 *
 * **Nie sammelbar.** Eine Erinnerung ist ein ZEITPUNKT, den ein Mensch
 * gewählt hat. In einer Tageszusammenfassung käme sie am nächsten Morgen an —
 * also nach dem Termin, an den sie erinnern sollte.
 *
 * **Deutsch, wie jede Meldung an die Verwaltung** (`registry.ts`,
 * `benachrichtigung-sprachen.test.ts` §5). Der Text wird gespeichert, nicht
 * gerendert; übersetzt werden nur die Arten, die einen Arbeiter in
 * `/portal/mein` erreichen.
 *
 * **Das Ziel ist die Liste, nicht der Lead.** Eine Wiedervorlage hängt an
 * einem Lead ODER an einem Kunden; erledigen und verschieben lässt sie sich
 * an genau einer Stelle — `/crm/wiedervorlagen`. Die Liste öffnet in der
 * Vorgabe „nur meine", und die Erinnerung geht an den Zuständigen: er findet
 * sie dort, ohne zu filtern.
 */
import { sicherRegistriert, type ArtDefinition } from '../../benachrichtigung/registry.js';

/**
 * Aus dem Modulnamen zusammengesetzt — derselbe Grund wie in
 * `services/lead/benachrichtigung.ts`: ein blankes `'crm.…'` liest sich für
 * die Katalogwache wie ein erfundenes Recht.
 */
const MODUL = 'crm';
export const ART_WIEDERVORLAGE_ERINNERUNG = `${MODUL}.wiedervorlage_erinnerung`;

/**
 * Idempotent (D-493): `sicherRegistriert` prüft je Schlüssel, der Jobbootstrap
 * und die Einstellungsseite dürfen beide anmelden.
 */
export function registriereWiedervorlageArten(): readonly ArtDefinition[] {
  return sicherRegistriert([
    ({
      schluessel: ART_WIEDERVORLAGE_ERINNERUNG,
      titel: (k) => `Wiedervorlage: ${String(k.daten['betreff'] ?? 'ohne Betreff')}`,
      text: (k) => `Fällig am ${String(k.daten['faellig'] ?? '—')}. `
        + 'Sie haben für diese Wiedervorlage um eine Erinnerung gebeten.',
      ziel: (k) => (k.mandantSlug ? `/portal/${k.mandantSlug}/crm/wiedervorlagen` : null),
      kanaeleVorgabe: ['app', 'email'],
      // Nie sammeln: am nächsten Morgen gelesen heisst nach dem Termin gelesen.
      sammelbar: false,
    }),
  ]);
}
