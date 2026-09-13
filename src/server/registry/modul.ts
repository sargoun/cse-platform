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
  // `zahlung` (PR 54.1): Geld geht in JEDER Gesellschaft ein, unabhaengig
  // vom Gewerk. Es an ein Gewerk zu binden hiesse, einer Gesellschaft ihre
  // eigenen Forderungen zu verbergen, weil sie nicht reinigt.
  // `eingang` (PR 54.3) aus demselben Grund: jede Gesellschaft bekommt
  // Lieferantenrechnungen.
  // `nummernkreis` (PR 56): das Ausgangsbuch prueft die Lueckenlosigkeit der
  // Rechnungsnummern — jede Rechtseinheit hat einen Kreis, unabhaengig vom
  // Gewerk.
  // `mahnung` (PR 55): eine Forderung wird ueberfaellig, unabhaengig davon,
  // wofuer sie entstand.
  // `buchhaltung` (PR 59): jede Rechtseinheit fuehrt ein Hauptbuch und
  // exportiert es an denselben Steuerberater. Ein Gewerk aendert daran
  // nichts — es aendert nur, welche Konten haeufig vorkommen.
  'zahlung', 'eingang', 'nummernkreis', 'mahnung', 'buchhaltung',
  'qualitaet', 'nachweis', 'system', 'vergabe', 'agent', 'formular',
  'nachricht', 'versand', 'medien', 'abwesenheit', 'lead', 'kunde',
]);

/** Der Modulname eines Rechteschluessels — dieselbe Regel wie 0008. */
export function modulFuerRecht(recht: string): string {
  const punkt = recht.indexOf('.');
  return punkt === -1 ? recht : recht.slice(0, punkt);
}

/** Was eine Gesellschaft gebucht hat — und ob es ueberhaupt jemand eintrug. */
export interface Modulbuchung {
  readonly module: readonly string[];
  /**
   * `false` heisst „niemand hat es eingetragen" und filtert NICHTS; `true`
   * heisst „die Liste gilt", und dann bedeutet leer: kein Gewerk (0103).
   */
  readonly gepflegt: boolean;
}

/**
 * Ist das Modul dieses Rechts in dieser Gesellschaft freigeschaltet?
 *
 * **„Kein Gewerk gebucht" und „noch nicht eingetragen" sind zwei Aussagen**,
 * und eine leere Liste konnte nur eine davon machen. Die erste Fassung las
 * leer als „nicht hinterlegt" — mit gutem Grund: waere leer gleich „nichts
 * gebucht", machte ein vergessener Eintrag beim Anlegen einer Gesellschaft
 * aus einem Datenfehler einen Totalausfall. Nur passt diese Lesart nicht auf
 * CSE Operations, deren leere Liste die Aussage IST; ihr Verwalter sah genau
 * die drei Gewerke, die sie nicht hat.
 *
 * `gepflegt` trennt die beiden Faelle, ohne einen davon zu erfinden.
 *
 * // TODO(client, O-355): Wer trägt die Modulbuchung ein und pflegt das
 * Kennzeichen — Vertrag, Verwaltung oder Super-Admin über
 * `system.module_zuweisen`?
 */
export function modulAktiv(buchung: Modulbuchung, recht: string): boolean {
  const { module, gepflegt } = buchung;
  const modul = modulFuerRecht(recht);
  if (QUERSCHNITT.has(modul)) return true;
  if (!gepflegt) return true;
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
