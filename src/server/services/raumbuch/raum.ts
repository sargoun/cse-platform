/**
 * Ein EINZELNER Raum — lesen, aendern, archivieren (OPS-02, OPS-03).
 *
 * **Warum es diesen Dienst zusaetzlich zum Import gibt.**
 * `services/raumbuch/import.ts` ist der Massenweg: Datei hoch, Vorschau,
 * Uebernahme. Der Einzelweg fehlte ganz — und er ist der haeufigere: eine
 * Flaeche wird nachgemessen, ein Belag getauscht, ein Raum stillgelegt.
 * Dafuer eine CSV zu bauen ist kein Weg, sondern eine Abwesenheit.
 *
 * **Die m²-Eingabe laeuft durch `leseZahl`, nicht durch `Number()`.**
 * `"1.234,5"` ist 1234,5 und `"12.50"` ist mehrdeutig — deutsch 1250,
 * englisch 12,50, also ein Faktor 100 auf einer Flaeche, aus der ein Preis
 * wird. `Number("1.234,5")` waere `NaN`, `Number("1.234")` waere 1,234: ein
 * Tausendstel der Wahrheit, und nichts daran sieht falsch aus. Gespeichert
 * wird `numeric(12,3)` aus ganzzahligen Tausendsteln, nie ein
 * Fliesskommawert aus dem Browser.
 *
 * **Was an einem Raum haengt — und warum dieser Dienst es nicht verhindert.**
 * `flaeche_qm` und `belagsart_id` speisen jeden Reinigungspreis (OPS-02,
 * OPS-07) und jede Revier-Sollzeit. Eine Aenderung verschiebt Zahlen an vier
 * anderen Stellen. Das zu SPERREN waere falsch: ein nachgemessener Raum ist
 * die Wahrheit, und die Zahlen daneben sind es, die nachziehen muessen.
 * Dieser Dienst liefert deshalb MIT, was daran haengt, damit die Seite es
 * zeigen kann.
 *
 * // TODO(client, O-737): Aendert eine nachtraegliche Flaechen- oder Belagsartaenderung laufende Angebote und Auftraege — also muss die Kalkulation neu gerechnet und der Kunde informiert werden —, oder gilt sie nur fuer kuenftige Kalkulationen? Bis zur Antwort aendert sie nur den Raum, und die Seite nennt sichtbar, was daran haengt.
 */
import { alsNumerisch, leseZahl } from './tabelle.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class RaumFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'archiviert' | 'flaeche_unlesbar' | 'flaeche_null'
    | 'nummer_belegt' | 'bezeichnung_belegt' | 'ohne_kennung'
    | 'fremde_belagsart' | 'fremde_klasse') {
    super(nachricht);
    this.name = 'RaumFehler';
  }
}

export interface Raumblatt {
  readonly id: string;
  readonly objekt_id: string;
  readonly objekt: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  readonly flaeche_qm: string;
  readonly fenster_flaeche_qm: string | null;
  readonly belagsart_id: string | null;
  readonly belagsart: string | null;
  readonly reinigungsklasse_id: string | null;
  readonly reinigungsklasse: string | null;
  /**
   * **`bemerkung` steht hier NICHT — und das ist eine Entscheidung, keine
   * Luecke.**
   *
   * `drizzle/0021_objekt_raumbuch.sql` nimmt `raum.bemerkung` (wie
   * `objekt.bemerkung` und `objekt.zutritt_hinweis`) aus dem SPALTENRECHT von
   * `cse_app`: `revoke select on raum from cse_app`, dann ein `grant select
   * (…)` ohne diese Spalte. Der Grund steht dort woertlich — es sind interne
   * Notizen an einem Ort, den der Kunde selbst im Portal sieht („wo der
   * Schluessel liegt").
   *
   * Nachgemessen: ein `select r.bemerkung` antwortet als `cse_app` mit
   * `42501 permission denied for table raum` — Postgres meldet die TABELLE,
   * obwohl die Spalte fehlt, und das liest sich wie ein kaputtes Recht. Das
   * Raumblatt bietet das Feld deshalb gar nicht an: ein Feld, das niemand
   * zurueckliest, ist schlechter als keines.
   */
  readonly quell_schluessel: string | null;
  readonly sortierung: number;
  readonly archiviert_am: string | null;
  readonly geaendert: string | null;
}

export async function ladeRaum(
  db: Abfrage, objektId: string, raumId: string,
): Promise<Raumblatt | null> {
  const [z] = await db.abfrage<Raumblatt>(
    `select r.id, r.objekt_id, o.bezeichnung as objekt,
            r.raumnummer, r.bezeichnung, r.etage, r.nutzungsart,
            r.flaeche_qm::text, r.fenster_flaeche_qm::text,
            r.belagsart_id, b.bezeichnung as belagsart,
            r.reinigungsklasse_id, rk.bezeichnung as reinigungsklasse,
            r.quell_schluessel, r.sortierung,
            to_char(r.archiviert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as archiviert_am,
            to_char(r.geaendert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as geaendert
       from raum r
       join objekt o on o.id = r.objekt_id
       left join belagsart b on b.id = r.belagsart_id
       left join reinigungsklasse rk on rk.id = r.reinigungsklasse_id
      /**
       * objekt_id steht MIT in der Bedingung, nicht nur die Raumkennung.
       *
       * Die Adresse lautet /objekte/[id]/raumbuch/[raumId], und beide
       * Segmente kommen vom Klienten. Ohne den Vergleich zeigte die Seite
       * einen Raum eines ANDEREN Objekts unter der Kopfzeile dieses Objekts
       * — im selben Mandanten, also von der RLS zu Recht nicht gestoppt.
       */
      where r.id = $2 and r.objekt_id = $1`, [objektId, raumId]);
  return z ?? null;
}

/** Die Reviere, in denen dieser Raum liegt — samt etwaigem Override. */
export interface RevierZeile {
  readonly revier_id: string;
  readonly revier: string;
  /**
   * Der Leistungswert, den DIESE Zuordnung setzt — `null` heisst „der der
   * Belagsart gilt".
   *
   * Die Spalte heisst `leistungswert_qm_pro_stunde` und nicht
   * `leistungswert_override`; auf `revier_raum` ist sie `cse_app` NICHT
   * entzogen (anders als auf `belagsart`, K-05), weil sie hier eine
   * Planungsgroesse dieses Reviers ist und keinen Katalogwert verraet.
   */
  readonly leistungswert: string | null;
  readonly sollzeit_minuten: string | null;
}

export async function ladeReviere(
  db: Abfrage, raumId: string,
): Promise<readonly RevierZeile[]> {
  return db.abfrage<RevierZeile>(
    `select rr.revier_id, rv.bezeichnung as revier,
            rr.leistungswert_qm_pro_stunde::text as leistungswert,
            rr.sollzeit_minuten::text as sollzeit_minuten
       from revier_raum rr
       join revier rv on rv.id = rr.revier_id
      where rr.raum_id = $1
      order by rv.bezeichnung`, [raumId]);
}

/** Woher dieser Raum stammt — `raum_import_historie`. */
export interface HerkunftZeile {
  readonly id: string;
  readonly aktion: string;
  readonly zeitpunkt: string;
  readonly quelle: string | null;
}

export async function ladeHerkunft(
  db: Abfrage, raumId: string,
): Promise<readonly HerkunftZeile[]> {
  return db.abfrage<HerkunftZeile>(
    `select rih.id, rih.aktion::text as aktion,
            to_char(rih.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as zeitpunkt,
            i.dateiname as quelle
       from raum_import_historie rih
       left join raumbuch_import i on i.id = rih.import_id
      where rih.raum_id = $1
      order by rih.erstellt_am desc
      limit 20`, [raumId]);
}

export interface Stammauswahl {
  readonly belagsarten: readonly { readonly id: string; readonly bezeichnung: string }[];
  readonly klassen: readonly { readonly id: string; readonly bezeichnung: string }[];
}

/**
 * Die Auswahl der Stammtabellen.
 *
 * `belagsart` wird OHNE `leistungswert_qm_pro_stunde` gelesen — die Spalte
 * ist `cse_app` entzogen (K-05), und ein `select *` faellt hier mit
 * `permission denied for column`. Wer den Leistungswert sehen will, geht
 * ueber `app.leistungswerte_lesen`.
 *
 * Und `belagsart` hat KEIN `archiviert_am`: sie ist zeitlich versioniert
 * (`gueltig_ab`/`gueltig_bis`, D-93). Gefiltert wird deshalb auf den heute
 * geltenden Satz — eine Belagsart anzubieten, die gestern abgelaufen ist,
 * hiesse einen Raum auf einen Katalogwert zu setzen, den keine Kalkulation
 * mehr findet (genau der Fall, den `ohneGueltigenLeistungswert` meldet).
 */
export async function ladeStammauswahl(db: Abfrage): Promise<Stammauswahl> {
  const belagsarten = await db.abfrage<{ id: string; bezeichnung: string }>(
    `select id, bezeichnung from belagsart
      where gueltig_ab <= app.berlin_heute()
        and (gueltig_bis is null or gueltig_bis >= app.berlin_heute())
      order by bezeichnung`);
  const klassen = await db.abfrage<{ id: string; bezeichnung: string }>(
    `select id, bezeichnung from reinigungsklasse
      where archiviert_am is null order by bezeichnung`);
  return { belagsarten, klassen };
}

export interface RaumEingabe {
  readonly raumnummer?: string | null;
  readonly bezeichnung?: string | null;
  readonly etage?: string | null;
  readonly nutzungsart?: string | null;
  /** Deutsche Zahl, Pflicht: `flaeche_qm` ist NOT NULL mit CHECK > 0. */
  readonly flaecheQm: string;
  readonly fensterFlaecheQm?: string | null;
  readonly belagsartId?: string | null;
  readonly reinigungsklasseId?: string | null;
  /** Kein `bemerkung` — siehe `Raumblatt`: die Spalte ist `cse_app` entzogen. */
  readonly sortierung?: number;
}

function leer(wert: string | null | undefined): string | null {
  return wert === null || wert === undefined || wert.trim() === '' ? null : wert.trim();
}

/** Eine deutsche Flaechenangabe in `numeric(12,3)` — oder ein benannter Fehler. */
function flaeche(roh: string | null, feld: string, pflicht: boolean): string | null {
  if (roh === null) {
    if (pflicht) {
      throw new RaumFehler(`${feld} ist Pflicht — ohne Fläche gibt es keine Kalkulation`,
                           'flaeche_unlesbar');
    }
    return null;
  }
  const befund = leseZahl(roh);
  if (befund.wert === null) {
    throw new RaumFehler(
      `${feld}: „${roh}" ist keine lesbare Zahl. Deutsch schreiben: 12,5 — der Punkt `
      + 'ist der Tausendertrenner.', 'flaeche_unlesbar');
  }
  if (befund.wert < 0n) {
    throw new RaumFehler(`${feld} ist nicht negativ`, 'flaeche_null');
  }
  if (pflicht && befund.wert === 0n) {
    // `raum_flaeche_positiv` verlangt > 0. Null m² waere ein Raum, der in
    // jede Summe eingeht und zu keiner beitraegt.
    throw new RaumFehler(
      `${feld} muss größer als null sein — ein Raum ohne Fläche trägt zu keinem Preis bei`,
      'flaeche_null');
  }
  return alsNumerisch(befund.wert);
}

function alsRaumFehler(fehler: unknown): never {
  if (typeof fehler === 'object' && fehler !== null) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23505') {
      if (f.constraint_name === 'raum_natuerlich_uk') {
        throw new RaumFehler(
          'In dieser Etage trägt schon ein Raum diese Nummer', 'nummer_belegt');
      }
      if (f.constraint_name === 'raum_bezeichnung_uk') {
        throw new RaumFehler(
          'In dieser Etage trägt schon ein Raum ohne Nummer diese Bezeichnung',
          'bezeichnung_belegt');
      }
      if (f.constraint_name === 'raum_quelle_uk') {
        throw new RaumFehler(
          'Ein Raum mit demselben Quellschlüssel besteht schon in diesem Objekt',
          'nummer_belegt');
      }
    }
    if (f.code === '23503') {
      if (f.constraint_name === 'raum_belagsart_fk') {
        throw new RaumFehler(
          'Diese Belagsart gehört nicht zu dieser Gesellschaft', 'fremde_belagsart');
      }
      if (f.constraint_name === 'raum_reinigungsklasse_fk') {
        throw new RaumFehler(
          'Diese Reinigungsklasse gehört nicht zu dieser Gesellschaft', 'fremde_klasse');
      }
    }
    if (f.code === '23514' && f.constraint_name === 'raum_flaeche_positiv') {
      throw new RaumFehler('Die Fläche muss größer als null sein', 'flaeche_null');
    }
  }
  throw fehler as Error;
}

export async function speichereRaum(
  db: Abfrage, objektId: string, raumId: string, eingabe: RaumEingabe,
): Promise<void> {
  const [vorher] = await db.abfrage<{ id: string; archiviert_am: Date | null }>(
    `select id, archiviert_am from raum
      where id = $2 and objekt_id = $1 for update`, [objektId, raumId]);
  if (vorher === undefined) throw new RaumFehler('Raum nicht gefunden', 'nicht_gefunden');
  if (vorher.archiviert_am !== null) {
    throw new RaumFehler(
      'Dieser Raum ist archiviert. Er wird nicht mehr geändert — ein wieder genutzter '
      + 'Raum ist eine neue Zeile.', 'archiviert');
  }

  const nummer = leer(eingabe.raumnummer);
  const bezeichnung = leer(eingabe.bezeichnung);
  /**
   * Eines von beiden muss da sein.
   *
   * Die Datenbank laesst beide leer zu — `raum_natuerlich_uk` gilt nur WHERE
   * `raumnummer is not null`, `raum_bezeichnung_uk` nur WHERE sie null ist
   * und `bezeichnung` nicht. Ein Raum ohne beides ist deshalb erlaubt und
   * gleichzeitig unauffindbar: er steht in der Liste als „ohne Nummer / —"
   * und laesst sich von jedem anderen solchen Raum nicht unterscheiden.
   */
  if (nummer === null && bezeichnung === null) {
    throw new RaumFehler(
      'Ein Raum braucht eine Nummer oder eine Bezeichnung — sonst ist er in der Liste '
      + 'von jedem anderen unbenannten Raum nicht zu unterscheiden', 'ohne_kennung');
  }

  const qm = flaeche(leer(eingabe.flaecheQm), 'Fläche', true);
  const glas = flaeche(leer(eingabe.fensterFlaecheQm), 'Fensterfläche', false);

  try {
    await db.abfrage(
      `update raum
          set raumnummer = $3, bezeichnung = $4, etage = $5, nutzungsart = $6,
              flaeche_qm = $7::numeric, fenster_flaeche_qm = $8::numeric,
              belagsart_id = $9, reinigungsklasse_id = $10,
              sortierung = $11
        where id = $2 and objekt_id = $1`,
      [objektId, raumId, nummer, bezeichnung, leer(eingabe.etage),
       leer(eingabe.nutzungsart), qm, glas,
       leer(eingabe.belagsartId), leer(eingabe.reinigungsklasseId),
       eingabe.sortierung ?? 0]);
  } catch (fehler) {
    alsRaumFehler(fehler);
  }
}

/**
 * Stilllegen — `archiviert_am`, nie DELETE.
 *
 * `verhindere_loeschung` weist ein DELETE ohnehin ab (Invariante 8), und das
 * ist richtig: an einem Raum haengen Angebotszeilen, Kalkulationszeilen,
 * Qualitaetspruefungen und Revierzuordnungen. Ihn zu entfernen loeschte die
 * Herkunft von Zahlen, die ein Kunde bezahlt hat.
 *
 * Nebenwirkung mit Absicht: alle drei Eindeutigkeitsindizes gelten nur WHERE
 * `archiviert_am is null`, die Nummer wird also fuer einen Nachfolger frei.
 */
export async function archiviereRaum(
  db: Abfrage, objektId: string, raumId: string,
): Promise<void> {
  const [z] = await db.abfrage<{ id: string }>(
    `update raum set archiviert_am = now()
      where id = $2 and objekt_id = $1 and archiviert_am is null
      returning id`, [objektId, raumId]);
  if (z === undefined) {
    throw new RaumFehler(
      'Raum nicht gefunden oder schon archiviert', 'nicht_gefunden');
  }
}
