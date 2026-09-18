import 'server-only';

/** Die Formen der Annahmeseite — NEBEN `page.tsx` (Next.js erlaubt dort keinen
 *  weiteren Export; der Bau bricht, `tsc --noEmit` sieht es nicht). */

export interface AnnahmeKopf {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly netto_cent: string;
  readonly angebotsnummer: string | null;
  readonly kunde_id: string;
  readonly kunde: string;
  readonly entscheidung_notiz: string | null;
  readonly gueltig_bis: string | null;
  readonly versendet_am: string | null;
  readonly entschieden_am: string | null;
  readonly auftrag_id: string | null;
  readonly auftragsnummer: string | null;
  readonly hat_nummernkreis: boolean;
}

export interface Auswahl {
  readonly id: string;
  readonly name: string;
}

/** Die Feldklasse aus `auftraege/neu` — dieselbe Maske, dieselbe Bauart. */
export const FELD = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
  + 'p-s3 text-sm text-text';

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  schon_gewandelt: 'Aus diesem Angebot ist bereits ein Auftrag entstanden.',
  kein_entwurf:
    'Der Status dieses Angebots lässt diese Entscheidung nicht zu — ein Angebot, das '
    + 'nie beim Kunden war, kann er nicht annehmen.',
  nicht_entscheidbar:
    'Die Angaben sind unvollständig oder passen nicht zum Stand des Angebots.',
  nicht_gefunden: 'Dieses Angebot gibt es nicht.',
  kein_kreis:
    'Diese Gesellschaft führt keinen Auftragskreis — es gibt keine Auftragsnummer zu ziehen.',
  luecke: 'Der Nummernkreis ist lückenlos geführt und lässt diesen Zug nicht zu.',
};
