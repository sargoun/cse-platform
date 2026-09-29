import { FARBEN_DRUCK, FARBEN_MARKE, MASSE_DRUCK } from '@/lib/design/theme';

/**
 * Die Druckregeln des Berichtsblatts (REP-07, DESIGN §11, V-227, V-269) —
 * als Funktion, damit sie sich ohne Browser prüfen lassen
 * (`tests/kern/bericht-druckblatt.test.ts`).
 *
 * **Sie gehören dem Blatt und nicht der globalen CSS:** ein `@page` im
 * Anwendungsstil legte den Rand auch auf jede andere Seite (dasselbe Muster
 * wie das Angebotsdokument und der Monatsnachweis).
 *
 * **Hoch oder quer, je nach Tabelle** (`blattFormat`): mehr als sechs Spalten
 * passen bei 10 pt nicht in 170 mm. Das Blatt ist dann am Bildschirm 297 mm
 * breit und druckt quer, statt dass der Browser es verkleinert oder
 * abschneidet. Die Köpfe brechen um, nur die Zahlen im Rumpf nicht; am
 * Bildschirm rollt die Tabelle in ihrem eigenen Behälter (`.rollbar`), und
 * auf dem Telefon hat das Blatt den Rand `--s4` statt 20 mm (D-420).
 */
export function druckblattStil(format: 'hoch' | 'quer'): string {
  return `
        .cse-blatt { background: ${FARBEN_DRUCK['druck-papier']};
                     color: ${FARBEN_DRUCK['druck-text']};
                     max-width: ${MASSE_DRUCK[format === 'quer' ? 'druck-blatt-quer' : 'druck-blatt-hoch']};
                     margin: 0 auto; padding: 20mm;
                     font-size: 10pt; line-height: 1.5; }
        .cse-blatt table { width: 100%; border-collapse: collapse; }
        .cse-blatt th, .cse-blatt td {
                     padding: ${MASSE_DRUCK['druck-zelle-y']} ${MASSE_DRUCK['druck-zelle-x']};
                     vertical-align: top; text-align: left; }
        .cse-blatt thead th { border-bottom: 1px solid ${FARBEN_DRUCK['druck-text']};
                              font-size: ${MASSE_DRUCK['druck-kopf-groesse']};
                              text-transform: uppercase;
                              letter-spacing: ${MASSE_DRUCK['druck-kopf-sperrung']}; }
        .cse-blatt tbody tr { border-bottom: 1px solid ${FARBEN_DRUCK['druck-linie-leicht']}; }
        .cse-blatt .zahl { text-align: right; font-variant-numeric: tabular-nums; }
        .cse-blatt td.zahl { white-space: nowrap; }
        .cse-blatt .rollbar { overflow-x: auto; }
        @media (max-width: 767.98px) { .cse-blatt { padding: var(--s4); } }
        .cse-blatt .leise { color: ${FARBEN_DRUCK['druck-text-leise']};
                            font-size: ${MASSE_DRUCK['druck-meta-groesse']}; }
        .cse-blatt .kopflinie { border: 0; border-top: 3px solid ${FARBEN_MARKE.red};
                                margin: ${MASSE_DRUCK['druck-block']} 0
                                        calc(2 * ${MASSE_DRUCK['druck-block']}); }
        .cse-blatt .fuss { border-top: 1px solid ${FARBEN_DRUCK['druck-linie']};
                           margin-top: calc(2 * ${MASSE_DRUCK['druck-block']});
                           padding-top: ${MASSE_DRUCK['druck-block']};
                           font-size: ${MASSE_DRUCK['druck-meta-groesse']};
                           color: ${FARBEN_DRUCK['druck-text-leise']}; }
        .cse-blatt .steuerung { display: flex; flex-wrap: wrap; align-items: center;
                                gap: ${MASSE_DRUCK['druck-block']};
                                margin-bottom: ${MASSE_DRUCK['druck-block']}; }
        @media print {
          @page { size: A4 ${format === 'quer' ? 'landscape' : 'portrait'}; margin: 20mm; }
          .cse-blatt { padding: 0; max-width: none; }
          .cse-blatt .rollbar { overflow: visible; }
          .cse-nicht-drucken { display: none; }
        }
`;
}
