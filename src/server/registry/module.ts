/**
 * Welche Module eine Gesellschaft gebucht hat — und was daraus folgt.
 *
 * **Der Befund, der hierher fuehrte, kam vom Mandanten selbst**: „Ich klicke
 * `admin` und `leitung` an und sehe ueberall dasselbe." Er hatte recht, und
 * der Grund war nicht die Rolle. `navigation.ts` filtert ausschliesslich nach
 * RECHT, und die Plattformrollen `admin`, `leitung` und `super_admin` halten
 * `reinigung.lesen`, `security.lesen`, `wachbuch.lesen`, `schluessel.lesen`
 * mit `rolle.mandant_id is null` — also in JEDEM Bereich. Der Hochbau-Admin
 * bekam damit Sidebar-Punkte „Reinigung" und „Security" und erreichte
 * `/portal/bau/reinigung/reviere` mit 200, obwohl REALTIME Service nicht
 * reinigt.
 *
 * `mandant.module` gibt es seit 0001, ist `text[] not null default '{}'` —
 * und wurde im ganzen Baum nirgends gelesen. Die Spalte war eine Absicht
 * ohne Umsetzung.
 *
 * **Das Vokabular ist nicht neu.** 0008 schneidet die Rechte einer
 * Mitgliedschaft bereits so zu:
 *
 *     and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
 *
 * Ein Modul ist also der erste Abschnitt eines Rechteschluessels —
 * `reinigung` in `reinigung.lesen`, `security` in `security.schreiben`. Diese
 * Datei benutzt dasselbe Vokabular; zwei Modulbegriffe nebeneinander waeren
 * die naechste Falle.
 *
 * **Die Sperre ist eine SCHNITTMENGE, kein Zusatz** — wie bei 0008. Was die
 * Gesellschaft nicht gebucht hat, sieht niemand, auch nicht der Super-Admin:
 * sonst waere die Antwort auf „wer sieht das Reinigungsmodul der Bau-GmbH"
 * abhaengig von der Rolle statt von der Buchung.
 */

/**
 * Module, die JEDE Gesellschaft hat, ohne dass jemand sie bucht.
 *
 * Zeiterfassung, Dienstplan, Personal, Rechnungen, Dokumente und die
 * Systemverwaltung sind keine Gewerke, sondern der Betrieb selbst. Sie hier
 * aufzulisten ist keine Einschraenkung, sondern das Gegenteil: ohne die Liste
 * muesste jede Gesellschaft ihre Grundfunktionen einzeln gebucht bekommen,
 * und die erste vergessene Zeile waere ein Bereich ohne Zeiterfassung.
 *
 * **Die Gewerke stehen NICHT hier**: `reinigung`, `security`, `bau`. Genau
 * die sind die Frage, die `mandant.module` beantwortet.
 */
export const QUERSCHNITT: ReadonlySet<string> = new Set([
  'bericht', 'crm', 'objekt', 'raum', 'dienstplan', 'zeit', 'personal',
  'angebot', 'auftrag', 'kalkulation', 'katalog', 'finanzen', 'dokument',
  'qualitaet', 'nachweis', 'system', 'vergabe', 'agent', 'formular',
  'nachricht', 'versand', 'medien', 'abwesenheit', 'lead', 'kunde',
]);

/** Der Modulname eines Rechteschluessels — dieselbe Regel wie 0008. */
export function modulFuerRecht(recht: string): string {
  const punkt = recht.indexOf('.');
  return punkt === -1 ? recht : recht.slice(0, punkt);
}

/**
 * Ist das Modul dieses Rechts in dieser Gesellschaft freigeschaltet?
 *
 * **Eine leere Liste heisst „nicht hinterlegt", nicht „nichts".** Das ist
 * dieselbe Lesart wie bei `benutzer_mandant.module`, wo `null` „keine
 * Einschraenkung" bedeutet (0008) — nur dass die Spalte hier `not null
 * default '{}'` traegt und die leere Liste die Rolle des `null` uebernimmt.
 *
 * Die Gegenprobe zur anderen Lesart entscheidet es: waere leer gleich
 * „nichts gebucht", machte ein vergessener Eintrag beim Anlegen einer
 * Gesellschaft aus einem Datenfehler einen Totalausfall — ein Portal, das
 * niemandem etwas zeigt und dessen Ursache in einer Spalte steht, die
 * niemand ansieht. Ein nicht gesetzter Filter filtert nicht.
 *
 * // TODO(client, O-355): Soll eine Gesellschaft OHNE hinterlegte Module
 * alle Gewerke sehen (heutiges Verhalten) oder gar keines, und wer trägt die
 * Buchung ein — Vertrag, Verwaltung oder Super-Admin?
 */
export function modulAktiv(module: readonly string[], recht: string): boolean {
  const modul = modulFuerRecht(recht);
  if (QUERSCHNITT.has(modul)) return true;
  if (module.length === 0) return true;
  const gewerk = GEWERK_FUER_MODUL[modul];
  /*
   * Ein Modul, das in KEINER der beiden Tabellen steht, ist neu — und ein
   * neues Modul stillschweigend zu sperren waere die schlechtere von zwei
   * falschen Antworten: die Seite waere weg, die Ursache stuende in einer
   * Datei, in der niemand sucht. Es bleibt offen, bis jemand es einordnet.
   */
  if (gewerk === undefined) return true;
  return module.includes(gewerk);
}

/**
 * Welches GEWERK ein Rechtemodul traegt.
 *
 * `wachbuch`, `dienstanweisung` und `schluessel` sind eigene Rechtemodule
 * (§ 34a GewO trennt die Register), aber kein eigenes Gewerk: wer Security
 * bucht, bucht sie mit. Ohne diese Zuordnung muesste eine Gesellschaft drei
 * weitere Zeilen eintragen, und die erste vergessene liesse die Wache ihr
 * eigenes Buch nicht fuehren.
 *
 * Die Tabelle steht hier und nicht in der Datenbank, weil ein Gewerk ohne
 * Seiten, Rechte und Dienste kein Gewerk ist, sondern eine Zeile. Ein
 * viertes entsteht mit dem Code, der es traegt, und nicht mit einem Insert.
 */
export const GEWERK_FUER_MODUL: Readonly<Record<string, string>> = {
  reinigung: 'reinigung',
  security: 'security',
  wachbuch: 'security',
  dienstanweisung: 'security',
  schluessel: 'security',
  bau: 'bau',
};

/** Die drei Gewerke, aus denen gebucht wird. */
export const GEWERKE: readonly string[] = ['reinigung', 'security', 'bau'];
