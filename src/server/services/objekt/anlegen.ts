/**
 * Ein Objekt anlegen, ändern und archivieren (OPS-01, V-001, V-020).
 *
 * **Warum das überhaupt fehlte.** Bis hierher entstand jede Objektzeile im
 * Seed (`db/seed/operations.ts:459`). Die Plattform konnte Objekte zeigen,
 * filtern, bebuchen und berechnen — aber kein einziges erfassen. Ein Betrieb,
 * der am Montag ein neues Gebäude übernimmt, hatte keinen Weg hinein.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ein Objekt ist ein ORT, kein Auftrag.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deshalb ist `kunde_id` nullbar und bleibt es auch hier: ein
 * Veranstaltungsort (REQ-03) existiert, bevor es einen Kundenstamm gibt, und
 * dasselbe Gebäude wird zu Recht von Eigentümer UND Mieter beauftragt. Die
 * kaufmännische Beziehung hängt am Auftrag. Wer das Formular mit einem
 * Pflicht-Kundenfeld baute, zwänge den Erfasser, sich einen Kunden
 * auszudenken — und eine erfundene Zuordnung ist schlimmer als keine.
 *
 * TODO(client, O-70): Voreinstellung — ein Gebäude ist EIN Objekt, auch wenn
 * zwei Kunden derselben Gesellschaft darin beauftragen; `kunde_id` bleibt dann
 * leer oder nennt den Hauptauftraggeber, die Zuordnung je Kunde hängt am
 * Auftrag (`auftrag.objekt_id`). Zwei Objekte für ein Haus hiessen zwei
 * Raumbücher, zwei Schlüsselsätze und zwei Objektnummern für dieselbe Tür.
 * Eine Konvention, keine Sperre — aber eine Rückfrage: findet `legeObjektAn`
 * unter derselben Anschrift schon ein Objekt der Gesellschaft
 * (`anschriftSchluessel`), legt es erst nach einer bewussten Bestätigung an
 * (`trotzDublette`; eine Wohnanlage mit einer Hausnummer bleibt möglich).
 * Gebaut mit V-361 (D-817). D-792.
 *
 * **Die Anschrift ist Pflicht, weil die Datenbank sie verlangt** (`strasse`,
 * `plz`, `ort` sind `NOT NULL`, `drizzle/0021_objekt_raumbuch.sql:118`). Das
 * ist keine Formularstrenge, sondern dieselbe Zusage an zwei Stellen: eine
 * Schicht, die auf ein Objekt ohne Anschrift eingeteilt wird, schickt jemanden
 * an keinen Ort.
 *
 * **Die Nummer wird in derselben Anweisung wie der `insert` gebildet** —
 * dieselbe Begründung wie bei der Kundennummer (`crm/anlegen.ts`): liefen
 * Zählen und Einfügen getrennt, bekämen zwei gleichzeitige Anlagen dieselbe
 * Zahl, und die zweite fiele auf `objekt_nummer_uk` mit einem Fehler, den der
 * Mensch davor nicht versteht.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { anschriftSchluessel, type Anschrift } from './anschrift.js';

export class ObjektFehler extends Error {
  constructor(
    nachricht: string, readonly grund: string, readonly status = 400,
    /**
     * Die Zahl, die ein Grund trägt (`einsaetze_offen`) — damit die Seite den
     * Satz in IHRER Sprache bilden kann, statt den deutschen aus der Adresse
     * zu zeigen (V-240).
     */
    readonly anzahl: number | null = null,
  ) {
    super(nachricht);
    this.name = 'ObjektFehler';
  }
}

export interface NeuesObjekt {
  readonly bezeichnung: string;
  readonly strasse: string;
  readonly plz: string;
  readonly ort: string;
  /** Leer lassen heisst: die Plattform bildet sie aus dem Bestand. */
  readonly objektnummer?: string | undefined;
  readonly hausnummer?: string | undefined;
  readonly adresszusatz?: string | undefined;
  readonly land?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly gebaeudetyp?: string | undefined;
  readonly etagenAnzahl?: string | undefined;
  readonly zutrittHinweis?: string | undefined;
  readonly bemerkung?: string | undefined;
  /**
   * Breiten- und Längengrad als EINGABETEXT (V-170, OPS-01) — beide oder
   * keiner. Geprüft und in die Form von `numeric(9,6)` gebracht wird er in
   * `koordinatenAus`, nie über eine Gleitkommazahl.
   */
  readonly geoLat?: string | undefined;
  readonly geoLon?: string | undefined;
  /**
   * V-361 — der Mensch hat gesehen, dass es unter dieser Anschrift schon ein
   * Objekt gibt, und legt trotzdem an (ein weiteres Haus einer Wohnanlage).
   */
  readonly trotzDublette?: boolean | undefined;
}

/** Ein Objekt derselben Gesellschaft unter derselben Anschrift (V-361). */
export interface AnschriftDublette {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly plz: string;
  readonly ort: string;
}

/**
 * Die lebenden Objekte der aktiven Gesellschaft unter derselben Anschrift
 * (V-361, D-817).
 *
 * Gesucht wird je Postleitzahl in der Datenbank und verglichen im Dienst
 * (`anschriftSchluessel`): die Normalisierung — Umlaute, „Str.", Leerzeichen
 * — ist eine Regel, die einen Kern-Test braucht, und eine zweite Fassung in
 * SQL liefe ihr irgendwann davon. Archivierte Objekte zählen nicht: ein
 * Gebäude, das die Gesellschaft abgegeben hat, darf sie wieder übernehmen.
 */
export async function findeAnschriftDubletten(
  kontext: LeseKontext, anschrift: Anschrift,
): Promise<readonly AnschriftDublette[]> {
  const plz = anschrift.plz.trim();
  if (plz === '' || anschrift.strasse.trim() === '') return [];
  const schluessel = anschriftSchluessel(anschrift);
  const kandidaten = await kontext.abfrage<AnschriftDublette>(
    `select id, objektnummer, bezeichnung, strasse, hausnummer, plz, ort
       from objekt
      where mandant_id = app.aktiver_mandant() and archiviert_am is null
        and plz = $1
      order by objektnummer`, [plz]);
  return kandidaten.filter((o) => anschriftSchluessel(o) === schluessel);
}

export interface AngelegtesObjekt {
  readonly id: string;
  readonly objektnummer: string;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

function pflicht(wert: string | undefined, feld: string, grund: string): string {
  const t = wert?.trim() ?? '';
  if (t === '') throw new ObjektFehler(`${feld} fehlt.`, grund);
  return t;
}

/**
 * Die Etagenzahl kommt als Text aus einem Formular und geht als `smallint` in
 * die Spalte. Dazwischen liegt die einzige Stelle, an der „" und „drei" und
 * „-2" unterschieden werden müssen — und zwar hier, nicht in Postgres: ein
 * `invalid input syntax for type smallint` ist für den Menschen davor kein
 * Satz.
 */
function etagen(wert: string | undefined): number | null {
  const t = wert?.trim() ?? '';
  if (t === '') return null;
  if (!/^\d{1,3}$/.test(t)) {
    throw new ObjektFehler(
      'Die Zahl der Etagen ist eine ganze Zahl ohne Vorzeichen — '
      + 'das Untergeschoss zählt die Etagen nicht herunter.',
      'etagen_ungueltig');
  }
  return Number(t);
}

/**
 * Die Postleitzahl.
 *
 * Fünf Ziffern **nur für Deutschland**. Das ist keine erfundene Geschäftsregel,
 * sondern das Format der Deutschen Post; für jedes andere Land bleibt das Feld
 * freier Text, weil eine niederländische PLZ Buchstaben trägt und eine
 * Prüfung, die sie ablehnt, schlicht falsch wäre.
 */
function plzPruefen(plz: string, land: string): string {
  if (land === 'DE' && !/^\d{5}$/.test(plz)) {
    throw new ObjektFehler(
      'Eine deutsche Postleitzahl hat fünf Ziffern.', 'plz_ungueltig');
  }
  return plz;
}

/**
 * Eine Koordinate in Dezimalgrad — der Text, den `numeric(9,6)` erwartet
 * (V-170, OPS-01).
 *
 * **Warum das fehlte.** `objekt.geo_lat`/`geo_lon` gibt es seit 0021 mit
 * CHECKs, aber kein Weg schrieb sie. Das Bautagebuch meldete deshalb für jede
 * Baustelle „Keine Koordinaten am Objekt hinterlegt" — einen Pflegefehler,
 * den niemand beheben konnte, weil kein Formular danach fragte.
 *
 * **Komma UND Punkt sind Dezimaltrenner.** Eine Koordinate hat höchstens drei
 * Vorkommastellen, einen Tausenderpunkt gibt es darin nicht — `52.520008` aus
 * einer Karte und `52,520008` von einer deutschen Tastatur meinen dasselbe.
 *
 * **Gerundet wird auf sechs Nachkommastellen, in ganzen Zahlen.** Eine Karte
 * liefert gern `52.52000659999999`; sechs Stellen sind etwa zehn Zentimeter,
 * mehr trägt die Spalte nicht. Gerundet wird halb aufwärts vom Nullpunkt weg
 * — dieselbe Regel, die Postgres für `numeric` anwendet —, und zwar HIER, in
 * Mikrograd als `bigint`, damit die Datenbank einen Wert bekommt, den sie
 * nicht mehr anfassen muss. Eine Gleitkommazahl sieht dieser Weg nie.
 *
 * **Der Bereich ist der der CHECKs aus 0021** — ±90° Breite, ±180° Länge —
 * und wird hier mit einem Satz abgewiesen statt dort mit `23514`.
 */
export type KoordinatenArt = 'breite' | 'laenge';

const KOORDINATE = /^([+-]?)(\d{1,3})(?:[.,](\d{1,15}))?$/u;
const MIKRO = 1_000_000n;

export function leseKoordinate(roh: string, art: KoordinatenArt): string {
  // Nur aussen gekürzt: ein Leerzeichen MITTEN in der Zahl („5 2") ist kein
  // Tippfehler, den man still zusammenschiebt — daraus würde 52.
  const text = roh.trim().replace(/°$/u, '').trim();
  const treffer = KOORDINATE.exec(text);
  if (treffer === null) {
    throw new ObjektFehler(
      art === 'breite'
        ? 'Der Breitengrad ist keine Zahl in Dezimalgrad — z. B. 52,520008.'
        : 'Der Längengrad ist keine Zahl in Dezimalgrad — z. B. 13,404954.',
      'koordinate_ungueltig');
  }
  const [, zeichen = '', ganz = '0', bruch = ''] = treffer;
  const stellen = bruch.padEnd(7, '0');
  let mikro = BigInt(ganz) * MIKRO + BigInt(stellen.slice(0, 6));
  // Halb aufwärts auf dem BETRAG: die siebte Stelle entscheidet, ob der Rest
  // mindestens ein halbes Millionstel ist.
  if (Number(stellen[6]) >= 5) mikro += 1n;
  const grenze = (art === 'breite' ? 90n : 180n) * MIKRO;
  if (mikro > grenze) {
    throw new ObjektFehler(
      art === 'breite'
        ? 'Der Breitengrad liegt zwischen −90 und 90 Grad.'
        : 'Der Längengrad liegt zwischen −180 und 180 Grad.',
      'koordinate_bereich');
  }
  const negativ = zeichen === '-' && mikro !== 0n;
  return `${negativ ? '-' : ''}${String(mikro / MIKRO)}.`
    + `${String(mikro % MIKRO).padStart(6, '0')}`;
}

/**
 * Das Paar — beide Werte oder keiner (`objekt_geo_vollstaendig`, 0021).
 *
 * Ein halbes Paar ist kein Ort: mit einem Breitengrad allein liegt die
 * Baustelle auf einem Kreis um die Erde. Beide leer heisst „keine
 * Koordinaten", und beim Ändern räumt das ein vorhandenes Paar ab.
 */
export function koordinatenAus(
  lat: string | undefined, lon: string | undefined,
): { readonly lat: string; readonly lon: string } | null {
  const b = lat?.trim() ?? '';
  const l = lon?.trim() ?? '';
  if (b === '' && l === '') return null;
  if (b === '' || l === '') {
    throw new ObjektFehler(
      'Koordinaten sind ein Paar: Breiten- UND Längengrad, oder keines von beiden.',
      'koordinaten_paar');
  }
  return { lat: leseKoordinate(b, 'breite'), lon: leseKoordinate(l, 'laenge') };
}

/**
 * `52.520008` → `52,520008` — die gespeicherte Koordinate für ein deutsches
 * Formular und das Objektblatt. Reine Textarbeit, kein Umweg über `Number`.
 *
 * **In der englischen Oberfläche bleibt der Punkt** (V-240): `52.520008`.
 * Beides liest `leseKoordinate` zurück (Punkt oder Komma), also auch ein
 * englisch vorbelegtes Formular.
 */
export function koordinateAlsText(
  gespeichert: string | null, sprache?: string | null,
): string {
  if (gespeichert === null) return '';
  return sprache === 'en' ? gespeichert : gespeichert.replace('.', ',');
}

function landPruefen(wert: string | undefined): string {
  const t = (wert?.trim() ?? 'DE').toUpperCase();
  if (!/^[A-Z]{2}$/.test(t)) {
    throw new ObjektFehler(
      'Das Land ist ein Länderkürzel aus zwei Buchstaben (ISO 3166-1), z. B. DE.',
      'land_ungueltig');
  }
  return t;
}

/**
 * Die Objektnummer, wenn der Erfasser keine angibt.
 *
 * Sie wächst aus dem **Bestand dieser Gesellschaft** — und übernimmt damit von
 * selbst, was dort schon gilt: die Reinigung führt `OBJ-1001 ff.`, Security
 * `OBJ-2001 ff.`, der Bau `OBJ-3001 ff.`. Die Fortschreibung erfindet nichts,
 * sie zählt weiter.
 *
 * Nur der allererste Fall — eine Gesellschaft ohne ein einziges Objekt — hat
 * keinen Bestand, aus dem sich etwas ableiten liesse. Dort steht `1000` — die
 * Voreinstellung (O-888), kein Nummernkreis.
 * // TODO(client, O-888): Voreinstellung — die Tausenderstelle kodiert die
 * Gesellschaft NICHT: die Nummer ist je Gesellschaft eindeutig
 * (`objekt_nummer_uk`), und welche Gesellschaft ein Objekt führt, steht am
 * Objekt selbst. Die Plattform zählt im Bestand der Gesellschaft weiter, die
 * erste Nummer einer leeren Gesellschaft ist `OBJ-1001`, und das Feld ist von
 * Hand überschreibbar. Wie gebaut. D-799.
 */
export async function legeObjektAn(
  kontext: SchreibKontext, eingabe: NeuesObjekt,
): Promise<AngelegtesObjekt> {
  const bezeichnung = pflicht(eingabe.bezeichnung, 'Die Bezeichnung', 'bezeichnung_fehlt');
  const strasse = pflicht(eingabe.strasse, 'Die Strasse', 'strasse_fehlt');
  const ort = pflicht(eingabe.ort, 'Der Ort', 'ort_fehlt');
  const land = landPruefen(eingabe.land);
  const plz = plzPruefen(pflicht(eingabe.plz, 'Die Postleitzahl', 'plz_fehlt'), land);
  const nummer = leer(eingabe.objektnummer);
  const geo = koordinatenAus(eingabe.geoLat, eingabe.geoLon);

  /*
   * V-361: dasselbe Haus nicht zweimal — es sei denn, der Mensch hat die
   * vorhandenen Objekte gesehen und bestätigt. Die Zahl reist mit (V-240),
   * die Seite nennt die Objekte selbst.
   *
   * **Erst die Sperre auf Gesellschaft und Anschrift, dann die Suche** — bis
   * zum Ende der Transaktion, auch mit Bestätigung. Zwei gleichzeitige
   * Anlagen derselben Anschrift sahen sonst beide nichts und legten zwei
   * Objekte ohne Rückfrage an (verschiedene Objektnummern trägt
   * `objekt_nummer_uk` beide); jetzt wartet die zweite und findet die erste.
   */
  await kontext.schreibe(
    `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`objekt_anschrift:${kontext.aktiverMandantId}:${anschriftSchluessel({
      strasse, hausnummer: leer(eingabe.hausnummer), plz,
    })}`]);
  if (eingabe.trotzDublette !== true) {
    const dubletten = await findeAnschriftDubletten(kontext, {
      strasse, hausnummer: leer(eingabe.hausnummer), plz,
    });
    if (dubletten.length > 0) {
      throw new ObjektFehler(
        `Unter dieser Anschrift führt die Gesellschaft schon ${String(dubletten.length)} `
        + 'Objekt(e). Ein Gebäude ist ein Objekt — angelegt wird erst nach einer Bestätigung.',
        'anschrift_vorhanden', 409, dubletten.length);
    }
  }

  const zeilen = await kontext.schreibe<AngelegtesObjekt>(
    `insert into objekt
       (mandant_id, kunde_id, objektnummer, bezeichnung, gebaeudetyp,
        strasse, hausnummer, adresszusatz, plz, ort, land,
        etagen_anzahl, zutritt_hinweis, bemerkung, geo_lat, geo_lon, erstellt_von)
     select app.aktiver_mandant(), $1,
            coalesce($2, 'OBJ-' || (
              coalesce(max(substring(o.objektnummer from '^OBJ-(\\d+)$')::int), 1000) + 1
            )::text),
            $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14::numeric(9,6), $15::numeric(9,6),
            app.aktueller_benutzer()
       from objekt o
      where o.mandant_id = app.aktiver_mandant()
     returning id, objektnummer`,
    [leer(eingabe.kundeId), nummer, bezeichnung, leer(eingabe.gebaeudetyp),
      strasse, leer(eingabe.hausnummer), leer(eingabe.adresszusatz), plz, ort, land,
      etagen(eingabe.etagenAnzahl), leer(eingabe.zutrittHinweis),
      leer(eingabe.bemerkung), geo?.lat ?? null, geo?.lon ?? null],
  );

  const angelegt = zeilen[0];
  if (angelegt === undefined) {
    /*
     * Kein Treffer heisst hier nicht „nichts gefunden", sondern: die Policy
     * `t_mandant` hat den `insert` zurueckgewiesen. Ihr `with check` verlangt
     * `objekt.schreiben`; die Route prueft dasselbe Recht vorher, also ist
     * dieser Zweig der Fall, in dem jemand den Dienst direkt ruft.
     */
    throw new ObjektFehler(
      'Das Objekt wurde nicht angelegt — es fehlt das Recht objekt.schreiben '
      + 'in dieser Gesellschaft.', 'kein_schreibrecht', 403);
  }
  return angelegt;
}

export interface ObjektAenderung {
  readonly id: string;
  readonly bezeichnung: string;
  readonly strasse: string;
  readonly plz: string;
  readonly ort: string;
  readonly hausnummer?: string | undefined;
  readonly adresszusatz?: string | undefined;
  readonly land?: string | undefined;
  readonly kundeId?: string | undefined;
  readonly gebaeudetyp?: string | undefined;
  readonly etagenAnzahl?: string | undefined;
  readonly zutrittHinweis?: string | undefined;
  readonly bemerkung?: string | undefined;
  /** Beide oder keiner; beide leer räumt ein vorhandenes Paar ab (V-170). */
  readonly geoLat?: string | undefined;
  readonly geoLon?: string | undefined;
}

/**
 * Ein Objekt ändern (V-020).
 *
 * **Die Nummer ist nicht dabei.** Sie steht auf Schlüsselschildern, in
 * Dienstanweisungen und auf jedem Leistungsnachweis, der je zu diesem Objekt
 * unterschrieben wurde. Sie nachträglich zu ändern hiesse, alle diese Papiere
 * still falsch zu machen — und zwar ohne Spur, weil kein Beleg die alte Nummer
 * mitführt.
 */
export async function aendereObjekt(
  kontext: SchreibKontext, eingabe: ObjektAenderung,
): Promise<void> {
  const bezeichnung = pflicht(eingabe.bezeichnung, 'Die Bezeichnung', 'bezeichnung_fehlt');
  const strasse = pflicht(eingabe.strasse, 'Die Strasse', 'strasse_fehlt');
  const ort = pflicht(eingabe.ort, 'Der Ort', 'ort_fehlt');
  const land = landPruefen(eingabe.land);
  const plz = plzPruefen(pflicht(eingabe.plz, 'Die Postleitzahl', 'plz_fehlt'), land);
  const geo = koordinatenAus(eingabe.geoLat, eingabe.geoLon);

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update objekt
        set kunde_id = $2, bezeichnung = $3, gebaeudetyp = $4,
            strasse = $5, hausnummer = $6, adresszusatz = $7,
            plz = $8, ort = $9, land = $10,
            etagen_anzahl = $11, zutritt_hinweis = $12, bemerkung = $13,
            geo_lat = $14::numeric(9,6), geo_lon = $15::numeric(9,6),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [eingabe.id, leer(eingabe.kundeId), bezeichnung, leer(eingabe.gebaeudetyp),
      strasse, leer(eingabe.hausnummer), leer(eingabe.adresszusatz), plz, ort, land,
      etagen(eingabe.etagenAnzahl), leer(eingabe.zutrittHinweis),
      leer(eingabe.bemerkung), geo?.lat ?? null, geo?.lon ?? null],
  );
  if (zeilen[0] === undefined) {
    throw new ObjektFehler(
      'Dieses Objekt gibt es nicht mehr, oder es ist bereits archiviert.',
      'objekt_unbekannt', 404);
  }
}

/**
 * Ein Objekt archivieren (V-020).
 *
 * **Archivieren, nicht löschen** — Invariante 8 gilt hier auch ohne
 * Finanzbezug: an einem Objekt hängen Leistungsnachweise, Wachbücher und
 * Zeiteinträge, und ein `delete` machte aus jedem davon eine Zeile ohne Ort.
 * Die Archivierung nimmt das Objekt aus `objekt_nummer_uk` heraus (der Index
 * ist `where archiviert_am is null`), also darf dieselbe Nummer danach neu
 * vergeben werden. Das ist beabsichtigt: ein verkauftes Gebäude gibt seine
 * Nummer frei.
 *
 * **Ein Objekt mit laufenden Einsätzen wird nicht archiviert.** Sonst
 * verschwände der Ort unter den Füßen einer Kraft, die morgen früh dorthin
 * fährt.
 */
export async function archiviereObjekt(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const [offen] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from einsatz e
      where e.objekt_id = $1::uuid
        and e.status <> 'storniert'
        and e.ende_zeitpunkt >= now()`,
    [id],
  );
  if (offen !== undefined && offen.anzahl !== '0') {
    throw new ObjektFehler(
      `Zu diesem Objekt stehen noch ${offen.anzahl} Einsätze in der Zukunft. `
      + 'Stornieren Sie diese zuerst — sonst fährt morgen jemand an einen Ort, '
      + 'den es in der Plattform nicht mehr gibt.',
      'einsaetze_offen', 409, Number(offen.anzahl));
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update objekt
        set archiviert_am = now(),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [id],
  );
  if (zeilen[0] === undefined) {
    throw new ObjektFehler(
      'Dieses Objekt gibt es nicht mehr, oder es ist bereits archiviert.',
      'objekt_unbekannt', 404);
  }
}
