import 'server-only';
import type { AbschlagsBedingungen } from './bedingungen.js';

/**
 * **Der Platzhalter — und er zieht NICHTS ein.**
 *
 * // TODO(client, O-20): Behält die Gruppe einen Sicherheits- oder
 * Gewährleistungseinbehalt ein? Wenn ja: in welcher Höhe, auf welche
 * Grundlage (Auftragssumme oder Schlussrechnungssumme), über welche Frist ab
 * Abnahme, darf eine Bürgschaft ihn ablösen, und wird er schon vom Abschlag
 * abgezogen oder erst von der Schlussrechnung? Und nach welchen Bedingungen
 * werden Abschläge überhaupt gestellt — Zahlungsplan nach VOB/B §16 Abs. 1
 * nach dem Wert der erbrachten Leistung, fester Zahlungsplan, oder
 * Baufortschritt in Prozent?
 *
 * **`einbehalt: null` ist die einzige Belegung, die hier stehen darf.** Jeder
 * Zahlenwert — auch der branchenübliche — wäre eine Vertragsklausel, die
 * niemand vereinbart hat, auf einem Beleg, der nach dem Festschreiben
 * unveränderlich ist. Die Richtung ist bewusst gewählt: ohne Entscheidung
 * wird nichts einbehalten, der Kunde zahlt den vollen Betrag, und die Gruppe
 * trägt das Risiko einer Nachverhandlung. Andersherum stünde auf einer
 * Rechnung ein Abzug, für den es keine Grundlage gibt.
 *
 * Die Oberfläche zeigt `herkunft` wörtlich an, damit „kein Einbehalt" nicht
 * wie eine Entscheidung aussieht, sondern wie die offene Frage, die es ist.
 */
export const BEDINGUNGEN_PLATZHALTER: AbschlagsBedingungen = {
  einbehalt: null,
  vomAbschlag: false,
  herkunft:
    'Nicht entschieden (O-20). Es wird nichts einbehalten, bis der Mandant die '
    + 'Vertragsbedingung nach VOB/B §17 bestätigt hat.',
  istPlatzhalter: true,
};
