/**
 * Die Benachrichtigungsarten dieser Domaene (NOT-01, NOT-03).
 *
 * `crm.neuer_lead` ist SAMMELBAR: zwanzig Anfragen an einem Messetag sind
 * zwanzig Einzelmeldungen, und wer zwanzig Meldungen bekommt, liest keine.
 * `crm.lead_sla_ueberschritten` ist es NICHT — eine Fristueberschreitung, die
 * in einer Tageszusammenfassung landet, wird am naechsten Morgen gelesen, also
 * nach der Frist.
 */
import { registriereArt, type ArtDefinition } from '../../benachrichtigung/registry.js';

const ziel = (mandant: string, leadId: string): string => `/portal/${mandant}/crm/leads/${leadId}`;

export function registriereLeadArten(): readonly ArtDefinition[] {
  return [
    registriereArt({
      schluessel: 'crm.neuer_lead',
      titel: (k) => `Neue Anfrage: ${String(k.daten['betreff'] ?? 'ohne Betreff')}`,
      text: (k) => `${String(k.daten['firma'] ?? 'Unbekannt')} hat eine Anfrage gesendet.`
        + (k.daten['slaFrist'] === null || k.daten['slaFrist'] === undefined
          ? ' Für dieses Formular ist keine Reaktionszeit hinterlegt.'
          : ` Zu beantworten bis ${String(k.daten['slaFrist'])}.`),
      ziel: (k) => (k.objektId === '' ? null : ziel(k.mandantId, k.objektId)),
      kanaeleVorgabe: ['app', 'email'],
      sammelbar: true,
    }),
    registriereArt({
      schluessel: 'crm.lead_sla_ueberschritten',
      titel: (k) => `Reaktionszeit überschritten: ${String(k.daten['leadnummer'] ?? '')}`,
      text: (k) => `Die zugesagte Reaktionszeit ist abgelaufen, ohne dass eine `
        + `Antwort erfasst wurde. Stufe ${String(k.daten['stufe'] ?? 1)}.`,
      ziel: (k) => (k.objektId === '' ? null : ziel(k.mandantId, k.objektId)),
      kanaeleVorgabe: ['app', 'email'],
      // Nie sammeln: am nächsten Morgen gelesen heisst nach der Frist gelesen.
      sammelbar: false,
    }),
  ];
}
