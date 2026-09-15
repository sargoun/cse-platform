/**
 * Die Benachrichtigungsarten dieser Domaene (NOT-01, NOT-03).
 *
 * `crm.neuer_lead` ist SAMMELBAR: zwanzig Anfragen an einem Messetag sind
 * zwanzig Einzelmeldungen, und wer zwanzig Meldungen bekommt, liest keine.
 * `crm.lead_sla_ueberschritten` ist es NICHT — eine Fristueberschreitung, die
 * in einer Tageszusammenfassung landet, wird am naechsten Morgen gelesen, also
 * nach der Frist.
 */
import { findeArt, registriereArt, type ArtDefinition } from '../../benachrichtigung/registry.js';

const ziel = (slug: string | null | undefined, leadId: string): string | null =>
  (slug ? `/portal/${slug}/crm/leads/${leadId}` : null);

/**
 * Aus dem Modulnamen zusammengesetzt, wie bei Radar und Waechter — und das
 * ist nicht Geschmack.
 *
 * Ein Artschluessel hat dieselbe Form wie ein RECHTESCHLUESSEL
 * (`<modul>.<etwas>`; die Datenbank erzwingt sie fuer Benachrichtigungen per
 * CHECK). `scripts/katalog/benutzung.ts` sucht genau diese Form und meldet
 * jeden Fund ohne Katalogzeile als „dauerhaft leerer Bildschirm" — es sei
 * denn, er steht unter `schluessel:` oder ist zusammengesetzt. Ein blankes
 * `const ART_NEU = 'crm.neuer_lead'` liest sich fuer die Wache wie ein
 * erfundenes Recht.
 */
const MODUL = 'crm';
export const ART_NEUER_LEAD = `${MODUL}.neuer_lead`;
export const ART_LEAD_SLA = `${MODUL}.lead_sla_ueberschritten`;

/**
 * Idempotent, wie bei den Radar- und Waechterarten (D-493).
 *
 * Der Jobbootstrap laeuft im Test mehrfach, und seit dem Einstellungsbildschirm
 * (NOT-02) meldet ausserdem `benachrichtigung/bootstrap.ts` alle Arten an, um
 * sie aufzaehlen zu koennen. Ein `registriereArt`, das beim zweiten Aufruf
 * wirft, machte daraus einen Fehler bei jedem zweiten Seitenaufruf.
 */
export function registriereLeadArten(): readonly ArtDefinition[] {
  const da = findeArt(ART_NEUER_LEAD);
  if (da !== undefined) {
    const zweite = findeArt(ART_LEAD_SLA);
    return zweite === undefined ? [da] : [da, zweite];
  }
  return [
    registriereArt({
      schluessel: ART_NEUER_LEAD,
      titel: (k) => `Neue Anfrage: ${String(k.daten['betreff'] ?? 'ohne Betreff')}`,
      text: (k) => `${String(k.daten['firma'] ?? 'Unbekannt')} hat eine Anfrage gesendet.`
        + (k.daten['slaFrist'] === null || k.daten['slaFrist'] === undefined
          ? ' Für dieses Formular ist keine Reaktionszeit hinterlegt.'
          : ` Zu beantworten bis ${String(k.daten['slaFrist'])}.`),
      ziel: (k) => (k.objektId === '' ? null : ziel(k.mandantSlug, k.objektId)),
      kanaeleVorgabe: ['app', 'email'],
      sammelbar: true,
    }),
    registriereArt({
      schluessel: ART_LEAD_SLA,
      titel: (k) => `Reaktionszeit überschritten: ${String(k.daten['leadnummer'] ?? '')}`,
      text: (k) => `Die zugesagte Reaktionszeit ist abgelaufen, ohne dass eine `
        + `Antwort erfasst wurde. Stufe ${String(k.daten['stufe'] ?? 1)}.`,
      ziel: (k) => (k.objektId === '' ? null : ziel(k.mandantSlug, k.objektId)),
      kanaeleVorgabe: ['app', 'email'],
      // Nie sammeln: am nächsten Morgen gelesen heisst nach der Frist gelesen.
      sammelbar: false,
    }),
  ];
}
