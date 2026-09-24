/**
 * Der Auftrag — Assistent, Pflege und Abweisungen, in beiden Sprachen
 * (V-172, V-173, OPS-05, OPS-10, D-592).
 *
 * **Fachbegriffe bleiben deutsch, auch im englischen Text**: `Auftrag`,
 * `Objekt`, `Nummernkreis`, `Mandant` — erklärt in Klammern, nicht ersetzt
 * (siehe `./basis.ts`).
 *
 * **Die Abweisungen sind SCHLÜSSEL**, die die Routen zurückgeben
 * (`?fehler=…`). Die Seite zeigt den Satz zum Schlüssel und für einen
 * unbekannten Schlüssel `nichtAngelegt` — nie den Schlüssel selbst.
 */
import type { InternSprache } from '../intern.js';

export interface AuftragTexte {
  /** Über jeder Abweisung: was NICHT passiert ist. */
  readonly nichtAngelegt: string;
  readonly nichtGespeichert: string;
  /** Die Abweisungen des Assistenten und der Pflege, je Schlüssel. */
  readonly fehler: Readonly<Record<string, string>>;
}

export const AUFTRAG_TEXTE: Readonly<Record<InternSprache, AuftragTexte>> = {
  de: {
    nichtAngelegt: 'Der Auftrag wurde nicht angelegt.',
    nichtGespeichert: 'Es wurde nichts geändert.',
    fehler: {
      unvollstaendig: 'Es fehlt eine Pflichtangabe — Kunde, Bezeichnung, Art, Leitung oder Start.',
      keine_zahl:
        'Personalbedarf oder Wochenstunden ist keine Zahl. Erlaubt sind Ziffern mit '
        + 'Tausenderpunkt und Dezimalkomma, z. B. 1.234,5 — ohne Einheit.',
      ausserhalb_bereich:
        'Personalbedarf (ganze Personen, 0 bis 5.000) oder Wochenstunden (0 bis 10.000) liegt '
        + 'außerhalb des Bereichs.',
      datum_ungueltig: 'Start oder Laufzeit ist kein gültiges Datum.',
      laufzeit_vor_start: 'Die Laufzeit endet vor dem Start.',
      kunde_unbekannt: 'Diesen Kunden gibt es in dieser Gesellschaft nicht (mehr).',
      objekt_unbekannt: 'Dieses Objekt gibt es in dieser Gesellschaft nicht (mehr).',
      verantwortlich_fremd:
        'Die gewählte Leitung arbeitet nicht in dieser Gesellschaft. Verantwortlich kann nur '
        + 'sein, wer hier Mitglied ist.',
      kein_kreis:
        'Für Aufträge ist in dieser Gesellschaft kein Nummernkreis eingerichtet '
        + '(Finanzen › Nummernkreise).',
      platzhalter: 'Der Auftragskreis ist noch ein Platzhalter und vergibt keine Nummer.',
      geschlossen: 'Der Auftragskreis ist geschlossen.',
      definer_kreis: 'Der Auftragskreis ist nicht richtig eingerichtet.',
      maske_ungueltig: 'Die Nummernmaske des Auftragskreises ist ungültig.',
    },
  },
  en: {
    nichtAngelegt: 'The Auftrag (order) was not created.',
    nichtGespeichert: 'Nothing was changed.',
    fehler: {
      unvollstaendig:
        'A required field is missing — customer, name, type, manager or start.',
      keine_zahl:
        'Staff required or weekly hours is not a number. Digits with a thousands dot and a '
        + 'decimal comma are accepted, e.g. 1.234,5 — without a unit.',
      ausserhalb_bereich:
        'Staff required (whole people, 0 to 5,000) or weekly hours (0 to 10,000) is out of '
        + 'range.',
      datum_ungueltig: 'Start or end of term is not a valid date.',
      laufzeit_vor_start: 'The term ends before the start.',
      kunde_unbekannt: 'This customer does not exist (any more) in this Mandant (company).',
      objekt_unbekannt: 'This Objekt (site) does not exist (any more) in this Mandant (company).',
      verantwortlich_fremd:
        'The chosen manager does not work in this Mandant (company). Only a member can be '
        + 'responsible.',
      kein_kreis:
        'No Nummernkreis (number sequence) for orders is set up in this Mandant (company) '
        + '(Finance › Number sequences).',
      platzhalter: 'The order number sequence is still a placeholder and issues no number.',
      geschlossen: 'The order number sequence is closed.',
      definer_kreis: 'The order number sequence is not set up correctly.',
      maske_ungueltig: 'The number mask of the order sequence is invalid.',
    },
  },
};
