/**
 * Der geschlossene Iconsatz aus DESIGN §5 "Icons".
 *
 * Vorher standen hier Unicode-Zeichen: `▤` fuer die Uebersicht, `⛓` fuer
 * Auftraege, `☺` fuer Personal. Das sieht auf einem Rechner ordentlich aus
 * und auf dem naechsten nicht — die Glyphe kommt aus der Systemschrift, nicht
 * aus dem Entwurf. `⛓` ist auf einer Plattform ein Kettenglied, auf der
 * naechsten ein Emoji in Farbe, und `currentColor` erreicht sie nie: ein
 * Zeichen im aktiven Navigationspunkt bleibt grau, waehrend der Text daneben
 * weiss wird.
 *
 * Darum liegen die Pfade hier — als Daten, nicht als Bibliothek. Eine
 * Abhaengigkeit fuer vierzig Striche waere ein weiterer Lieferant im
 * Stack-Vertrag (CLAUDE.md), der laut ist, wenn er sich aendert, und still,
 * wenn er verschwindet.
 *
 * Gezeichnet wird auf `24×24`, mit Strich `1.75`, ohne Fuellung. Jede Figur
 * bleibt innerhalb von `2 … 22`, damit die Strichbreite an keiner Kante
 * abgeschnitten wird.
 */

/** Die Namen sind die Domaenenwoerter, nicht die Zeichnung (DESIGN §5). */
export const ICON_PFADE = {
  // --- Navigation ---------------------------------------------------------
  uebersicht: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  // Eine Kontaktkarte, nicht noch ein Hoerer: `crm` und `telefon` standen
  // auf demselben Bild, und zwei Navigationspunkte mit einem Icon sind
  // fuer den, der sie scannt, ein Punkt.
  crm: 'M3 5h18v14H3zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16.5a3.2 3.2 0 0 1 6 0M14.5 10h4M14.5 13.5h3',
  objekt: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M9 12h.01M15 12h.01',
  dienstplan: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M8 17h2M14 14h2M14 17h2',
  zeit: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  personal: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M16.5 11.5a3 3 0 1 0 0-6M18 14.2a5 5 0 0 1 4 4.8V20',
  angebot: 'M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h5',
  auftrag: 'M5 3h9l5 5v13H5zM14 3v5h5M8.5 14.5l2 2 4.5-4.5',
  rechnung: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9.5 8h5.5M9.5 12h5M9.5 16h3',
  dokument: 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h8',
  einstellungen:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM12 2.5l1.3 2.4 2.7-.4.5 2.7 2.4 1.3-1.3 2.4 1.3 2.4-2.4 1.3-.5 2.7-2.7-.4L12 21.5l-1.3-2.4-2.7.4-.5-2.7-2.4-1.3L6.4 13 5.1 10.6l2.4-1.3.5-2.7 2.7.4z',
  freigabe: 'M20 6.5L9.5 17 4 11.5M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8',
  wachbuch: 'M4 4a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2zM19 16H6a2 2 0 0 0-2 2M9 7h7M9 11h5',
  aufmass: 'M2.5 15.5l13-13 6 6-13 13zM7 7l2 2M10 4.5l2 2M11.5 11l2 2M15 7.5l2 2',
  ausschreibung: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5M11 8v3l2 1.5',
  ki: 'M9 3h6v3h3v6h3v6h-6v3H9v-3H3v-6h3V6h3zM10 10h4v4h-4z',
  gruppe: 'M12 2.5l8 4v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9v-6zM9 12l2 2 4-4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1.5A5.5 5.5 0 0 1 9.5 14h5a5.5 5.5 0 0 1 5.5 5.5V21',
  euro: 'M18.5 6.2A7 7 0 0 0 8.2 9m10.3 8.8A7 7 0 0 1 8.2 15M3.5 10.5h9M3.5 13.5h9',

  // --- Zeit und Ort -------------------------------------------------------
  heute: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  kalender: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  uhr: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2',
  standort: 'M12 21c0 0 7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  telefon: 'M4 5a2 2 0 0 1 2-2h2l2 4-2 2a12 12 0 0 0 6 6l2-2 4 2v2a2 2 0 0 1-2 2A16 16 0 0 1 4 5z',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',

  // --- Werkzeuge ----------------------------------------------------------
  suche: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  plus: 'M12 5v14M5 12h14',
  export: 'M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  'import': 'M12 3v12M8 11l4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  stift: 'M4 20l.9-4.2L16 4.7a2.1 2.1 0 0 1 3 3L7.9 18.9zM14.5 6.5l3 3',
  papierkorb: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6',
  auge: 'M2.5 12C6 6.5 18 6.5 21.5 12C18 17.5 6 17.5 2.5 12zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  schloss: 'M5 11h14v10H5zM8 11V7.5a4 4 0 0 1 8 0V11M12 15v2.5',

  // --- Richtung und Zustand ----------------------------------------------
  'pfeil-rechts': 'M4 12h15M13 6l6 6-6 6',
  'pfeil-runter': 'M12 4v15M6 13l6 6 6-6',
  'chevron-rechts': 'M9 5l7 7-7 7',
  menue: 'M4 7h16M4 12h16M4 17h16',
  schliessen: 'M6 6l12 12M18 6L6 18',
  warnung: 'M12 3l9.5 17H2.5zM12 9.5v4.5M12 17h.01',
  ok: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7.8 12.2l2.8 2.8 5.6-5.6',
  fehler: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6M15 9l-6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6h.01',
} as const;

export type IconName = keyof typeof ICON_PFADE;

/** DESIGN §5: vier Groessen, keine fuenfte am Aufrufort. */
export const ICON_GROESSEN = { sm: 16, md: 18, lg: 24, xl: 32 } as const;

export type IconGroesse = keyof typeof ICON_GROESSEN;

/**
 * Ist der Name im geschlossenen Satz? Fuer Registerdaten und alles aus der DB.
 *
 * `Object.hasOwn`, nicht `in`: `in` laeuft die Prototypenkette hoch, und
 * `'toString' in ICON_PFADE` ist `true`. Der Name kaeme durch die Pruefung,
 * `ICON_PFADE['toString']` gaebe eine FUNKTION zurueck, und die stuende dann
 * als `d`-Attribut im SVG — kein Fehler, kein Bild, nur ein leerer Platz.
 */
export function istIconName(wert: unknown): wert is IconName {
  return typeof wert === 'string' && Object.hasOwn(ICON_PFADE, wert);
}
