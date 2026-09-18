import 'server-only';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';

/** Feldklasse, Anzeigehilfe und Fehlertexte des Raumblatts — NEBEN `page.tsx`. */

export const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

/**
 * Ein `numeric`-Wert aus Postgres als deutsche Zahl fuer ein Textfeld.
 *
 * Postgres liefert `"12.500"`; das Feld erwartet `"12,5"`, weil `leseZahl`
 * beim Zuruecklesen deutsch liest. Wuerde hier `12.500` stehen, laese
 * `leseZahl` es als GRUPPIERTE Zahl — 12500 m² statt 12,5. Ein Formular, das
 * seinen eigenen Wert beim Speichern um den Faktor 1000 verschiebt, ist die
 * teuerste Art von Feld.
 *
 * `formatiereMenge` liefert die deutsche Anzeige ohne Tausenderpunkte fuer
 * kleine Werte; fuer grosse traegt sie sie, und `leseZahl` liest sie richtig
 * zurueck (`GRUPPIERT` plus Komma).
 */
export function deutscheAnzeige(wert: string | null): string {
  if (wert === null) return '';
  return formatiereMenge(mengeAusPostgresOderNull(wert));
}

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  flaeche_unlesbar:
    'Die Fläche war nicht lesbar. Deutsch schreiben: 12,5 — der Punkt ist der '
    + 'Tausendertrenner.',
  flaeche_null:
    'Die Fläche muss größer als null sein. Ein Raum ohne Fläche trägt zu keinem Preis bei.',
  ohne_kennung:
    'Nummer oder Bezeichnung ist Pflicht — sonst ist der Raum in der Liste von jedem '
    + 'anderen unbenannten nicht zu unterscheiden.',
  nummer_belegt: 'In dieser Etage trägt schon ein Raum diese Nummer.',
  bezeichnung_belegt:
    'In dieser Etage trägt schon ein Raum ohne Nummer diese Bezeichnung.',
  fremde_belagsart: 'Diese Belagsart gehört nicht zu dieser Gesellschaft.',
  fremde_klasse: 'Diese Reinigungsklasse gehört nicht zu dieser Gesellschaft.',
  archiviert:
    'Dieser Raum ist stillgelegt und wird nicht mehr geändert — ein wieder genutzter '
    + 'Raum ist eine neue Zeile.',
  nicht_gefunden: 'Diesen Raum gibt es in diesem Objekt nicht.',
  kein_recht: 'Ihnen fehlt objekt.schreiben.',
};
