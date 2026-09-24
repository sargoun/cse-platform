import { istPortalSprache, type PortalSprache } from '@/lib/i18n/texte';

/**
 * Die eigene Portalsprache setzen (EMP-12).
 *
 * **Warum diese Datei NICHT unter `services/` liegt.** Das Dienstregister
 * (`registry/dienste.ts`) verlangt von jedem schreibenden Dienst ein
 * Schreibrecht aus dem Katalog — zu Recht: ein Dienst dort ist eine
 * MODULOPERATION, und die traegt ein Modulrecht. Die eigene Sprache ist
 * keine: §12.4 markiert den Zugriff aufs eigene Konto als Selbstzugriff
 * (`S`), und einen Schluessel dafuer zu erfinden, den man anschliessend JEDER
 * Rolle bindet, pruefte nichts und behauptete zu pruefen (K-19).
 *
 * Das Haus hat fuer diesen Fall schon einen Ort: `server/benachrichtigung/
 * posteingang.ts` schreibt ebenfalls (`oeffne`, `markiereAlleGelesen`), traegt
 * ebenfalls kein Modulrecht und ist ebenfalls an `app.aktueller_benutzer()`
 * gebunden — und liegt ebenfalls neben `services/` statt darin. Diese Datei
 * folgt dem, statt eine Ausnahme IN die Wache zu schreiben.
 *
 * **Warum es einen Dienst dafür gibt und keine Zeile in der Route.** Welche
 * der beiden Spalten gilt, ist eine Regel und keine Formalie: `benutzer.sprache`
 * trägt seit 0007 den Kommentar „Nur für Konten OHNE person_id: sonst gewinnt
 * person.sprache". Wer das in der Route schreibt, schreibt es beim zweiten
 * Aufrufer anders — und dann steht die Sprache an zwei Stellen und zwei
 * Bildschirme widersprechen sich.
 */

/** Der schmale Schreibzugriff — kein Mandant, denn die Sprache hat keinen. */
export interface SprachZugriff {
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  /** Die Person hinter dem Konto, oder `null` bei einem Konto ohne Mensch. */
  readonly personId: string | null;
}

export class UnbekannteSpracheFehler extends Error {
  constructor(readonly wert: string) {
    super(`„${wert}" ist keine der vier Portalsprachen.`);
    this.name = 'UnbekannteSpracheFehler';
  }
}

export class SpracheNichtGesetztFehler extends Error {
  constructor() {
    super('Die Sprache wurde nicht gesetzt.');
    this.name = 'SpracheNichtGesetztFehler';
  }
}

/**
 * Setzt die Sprache dort, wo sie GILT — und nur dort.
 *
 * **Eine Spalte, nicht beide.** Hat das Konto eine Person, gewinnt
 * `person.sprache` (§3.2); `benutzer.sprache` daneben zu schreiben hiesse,
 * einen Wert zu pflegen, den niemand liest, und beim nächsten Lesefehler
 * stünde die falsche Quelle im Verdacht. Hat es keine, ist `benutzer.sprache`
 * die einzige Quelle.
 *
 * **Null Zeilen sind ein Fehlschlag, kein Erfolg.** Die Policies
 * (`t_person_selbstpflege`, `t_benutzer_selbstpflege`) weisen eine fremde
 * Zeile und eine lesende Sitzung still ab — `update` meldet dann schlicht
 * nichts. Ein Bildschirm, der danach „gespeichert" sagt, wäre die teuerste
 * Art von Rückmeldung: die Sprache stünde beim nächsten Laden wieder auf
 * dem alten Wert, und niemand wüsste warum.
 */
export async function setzeEigeneSprache(
  zugriff: SprachZugriff, wert: string,
): Promise<PortalSprache> {
  const sprache = wert.trim();
  if (!istPortalSprache(sprache)) throw new UnbekannteSpracheFehler(sprache);

  /*
   * **`geaendert_am` steht hier NICHT.** Ein Auslöser setzt es
   * (`trg_person_geaendert_am` → `setze_geaendert_am`), und es steht auch
   * nicht im Spaltenrecht — es mitzuschreiben ist deshalb nicht bloss
   * überflüssig, sondern ein `permission denied for table person`: Postgres
   * prüft JEDE Spalte der `set`-Liste gegen das Recht, und eine davon fehlt.
   * Gefunden hat es die Isolationsprüfung, die den Weg wirklich fährt.
   */
  const zeilen = zugriff.personId === null
    ? await zugriff.schreibe<{ id: string }>(
      `update benutzer set sprache = $1::sprache
        where id = app.aktueller_benutzer()
        returning id`, [sprache])
    : await zugriff.schreibe<{ id: string }>(
      `update person set sprache = $1::sprache
        where id = app.aktuelle_person()
        returning id`, [sprache]);

  if (zeilen.length === 0) throw new SpracheNichtGesetztFehler();
  return sprache;
}

/** Der schmale Lesezugriff — in der gebundenen Transaktion des Aufrufers. */
export interface SprachLeser {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  /** Die Person hinter dem Konto, oder `null` bei einem Konto ohne Mensch. */
  readonly personId: string | null;
  readonly benutzerId: string;
}

/**
 * Liest die eigene Sprache von dort, wo sie GILT — dieselbe Regel wie beim
 * Schreiben: mit Person `person.sprache`, ohne `benutzer.sprache`.
 *
 * Die eigene Zeile darf jede Sitzung lesen (`t_person_lesen`,
 * `t_benutzer_lesen`). Faellt die Abfrage leer aus oder steht dort keine der
 * vier Portalsprachen, ist die Antwort `null` — „keine Wahl getroffen", nicht
 * ein Fehler (das Tor, V-165: die Bereichswahl fragt dasselbe).
 */
export async function leseEigeneSprache(leser: SprachLeser): Promise<PortalSprache | null> {
  const [sp] = leser.personId !== null
    ? await leser.abfrage<{ sprache: string | null }>(
      `select sprache from person where id = $1`, [leser.personId])
    : await leser.abfrage<{ sprache: string | null }>(
      `select sprache from benutzer where id = $1`, [leser.benutzerId]);
  const roh = sp?.sprache ?? '';
  return istPortalSprache(roh) ? roh : null;
}
