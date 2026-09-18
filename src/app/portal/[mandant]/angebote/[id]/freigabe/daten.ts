import 'server-only';

/**
 * Die Formen und der Fehlertext der Preisfreigabe — NEBEN `page.tsx`.
 *
 * Eine `page.tsx` exportiert nur, was Next.js kennt: jeder weitere Export
 * bricht den Bau mit „Property … is incompatible with index signature", und
 * `tsc --noEmit` sieht es nicht, weil `.next/types` dann noch nicht existiert.
 * Der Fehler erscheint erst in `pnpm build` und in der Browsersuite, dort als
 * „Timed out waiting from config.webServer" — eine Meldung, die wie ein
 * kaputter Server aussieht und ein verschobener Helfer ist.
 */

export interface Kopf {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly netto_cent: string;
  readonly angebotsnummer: string | null;
  readonly kunde: string;
  readonly gueltig_bis: string | null;
  readonly freigegeben_am: string | null;
  readonly freigegeben_von: string | null;
  readonly versendet_am: string | null;
  readonly positionen: string;
  readonly kalkulation_id: string | null;
  readonly satz_cent: string | null;
  readonly gemeinkosten_basis: string | null;
  readonly gemeinkosten_bp: number | null;
  readonly wagnis_gewinn_bp: number | null;
  readonly bemerkung: string | null;
  readonly kopf_offen: boolean;
  readonly frequenz_offen: boolean;
  readonly grundlage_offen: boolean;
  readonly irgendwas_offen: boolean;
  readonly darf_kalkulation_lesen: boolean;
}

/** Eine Steuersatzgruppe dieses Angebots — gruppiert, nicht summiert. */
export interface SteuerZeile {
  readonly steuersatz_bp: number;
  readonly steuer_kennzeichen: string;
  readonly netto_cent: string;
  readonly zeilen: string;
}

/** Basispunkte als deutsche Prozentanzeige: `1550` → `15,5`. */
export function alsProzent(bp: number | null): string {
  if (bp === null) return '—';
  const ganz = Math.trunc(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? String(ganz) : `${String(ganz)},${String(rest).padStart(2, '0')}`;
}

/**
 * Die `grund`-Schluessel der Dienste als Saetze.
 *
 * Sie kommen als `?fehler=` zurueck, weil das Geruest ein abgewiesenes
 * Formular auf seine Seite zurueckschickt (D-562) statt auf eine weisse Seite
 * mit JSON. Ein Schluessel ohne Satz waere derselbe Fehler auf halbem Weg.
 */
export const FEHLERTEXT: Readonly<Record<string, string>> = {
  kalkulation_offen:
    'Die Kalkulation steht noch auf unbestätigten Werten — erst bestätigen, dann freigeben.',
  schon_freigegeben:
    'Der Preis war bereits freigegeben. Eine zweite Freigabe gibt es nicht (O-732).',
  kein_entwurf:
    'Dieses Angebot ist nicht mehr im Entwurf; sein Preis lässt sich nicht mehr freigeben.',
  ohne_positionen:
    'Das Angebot trägt keine Leistungsposition — es gibt keinen Preis freizugeben.',
  nicht_gefunden: 'Dieses Angebot gibt es nicht.',
  kein_recht: 'Ihnen fehlt angebot.preis_freigeben.',
};
