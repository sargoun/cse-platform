import 'server-only';

/**
 * Die Form und die Fehlertexte der Versandseite — NEBEN `page.tsx`.
 *
 * Eine `page.tsx` exportiert nur, was Next.js kennt; jeder weitere Export
 * bricht `pnpm build`, und `tsc --noEmit` sieht es nicht. Dieselbe Begruendung
 * wie in `freigabe/daten.ts`.
 */

export interface VersandKopf {
  readonly id: string;
  readonly titel: string;
  readonly status: string;
  readonly netto_cent: string;
  readonly angebotsnummer: string | null;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly ansprechpartner: string | null;
  readonly ansprechpartner_email: string | null;
  readonly gueltig_bis: string | null;
  readonly freigegeben_am: string | null;
  readonly freigegeben_von: string | null;
  readonly versendet_am: string | null;
  readonly versendet_von: string | null;
  readonly positionen: string;
  readonly kalkulation_offen: boolean;
  readonly darf_kalkulation_lesen: boolean;
  readonly hat_nummernkreis: boolean;
}

export const FEHLERTEXT: Readonly<Record<string, string>> = {
  ohne_freigabe:
    'Der Preis ist nicht freigegeben. Das ist ein eigener Vorgang mit eigenem Recht.',
  kalkulation_platzhalter:
    'Die Kalkulation steht auf unbestätigten Werten (O-16, O-17, O-56).',
  kein_entwurf: 'Dieses Angebot ist nicht mehr im Entwurf.',
  ohne_positionen: 'Das Angebot trägt keine Leistungsposition.',
  kein_kreis:
    'Diese Gesellschaft führt keinen Angebotskreis — es gibt keine Nummer zu ziehen.',
  luecke:
    'Der Nummernkreis ist lückenlos geführt und lässt diesen Zug nicht zu.',
  nicht_gefunden: 'Dieses Angebot gibt es nicht.',
};
