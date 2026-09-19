import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SchreibKontext } from '../../kontext/index.js';
import { NichtVerbundenFehler, type Bucket, type Speicher } from '../../storage/adapter.js';
import { MAX_BYTES } from '../../storage/mime.js';
import { KATEGORIEN, type Kategorie } from './kategorie.js';
import { ladeHoch } from './upload.js';

/**
 * Ablegen — der Weg, auf dem ein Mensch eine Datei in die Ablage bringt
 * (DOC-01, DOC-03, DOC-05, DOC-06, SEC-A6, TIM-10).
 *
 * **Warum das ein Dienst ist und nicht drei Absaetze in einer Route.** Bis
 * hierher gab es fuenf Stellen, die `ladeHoch` rufen und danach `dokument`
 * und `dokument_version` schreiben — je einmal in der Behinderungsanzeige, im
 * Belegarchiv, in der Mahnung, im Eingangsrechnungsweg und in der
 * Vergabemappe. Jede davon schreibt dieselben vierzehn Spalten, und die
 * sechste haette sie abgeschrieben. Der Upload-Bildschirm ist die erste
 * Stelle, an der ein MENSCH die Datei mitbringt; die Reihenfolge, die ihn
 * sicher macht, steht in `upload.ts` und wird hier NICHT wiederholt, sondern
 * benutzt:
 *
 *   1. Groesse, 2. Typ aus den MAGIC BYTES, 3. Metadaten entfernen,
 *   4. Aufbewahrung, 5. speichern.
 *
 * **Was hier nicht gesetzt wird: `sichtbar_fuer_kunde`.** Das Umlegen ist
 * eine eigene Handlung mit einem eigenen Recht (`dokument.kunde_freigeben`,
 * DOC-04) und einer eigenen Seite. Ein Haekchen im Uploadformular haette den
 * schwaecheren Weg zum gleichen Ergebnis geoeffnet — genau der Defekt „zwei
 * Schreibflaechen ueber einer Spalte, mit zwei verschiedenen Rechten".
 *
 * `sichtbar_fuer_mitarbeiter` steht dagegen hier, und das ist kein
 * Widerspruch: die Spalte traegt kein eigenes Recht (Katalog), ihr Vorgabewert
 * ist `false` (0009), und es gibt heute ueberhaupt keinen Weg, sie zu setzen —
 * `/portal/mein/dokumente` ist damit fuer jedes selbst abgelegte Dokument
 * leer. DOC-04 verlangt eine AUSDRUECKLICHE Handlung, nicht ein eigenes
 * Recht; ein Kaestchen, das aus ist, bis jemand es anhakt, ist genau das.
 */

export class AblageFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'AblageFehler';
  }
}

export class BezugUnbekannt extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(was: 'kunde' | 'objekt') {
    super(
      was === 'kunde'
        ? 'Dieser Kunde gehört nicht zu dieser Gesellschaft.'
        : 'Dieses Objekt gehört nicht zu dieser Gesellschaft.',
    );
    this.name = 'BezugUnbekannt';
  }
}

/** Wie viele Schlagworte, und wie lang. Eine Anzeigegrenze, keine Fachregel. */
export const TAG_HOECHSTZAHL = 12;
export const TAG_LAENGE = 40;

/**
 * `"Rahmenvertrag, 2026 ,, rahmenvertrag"` → `['Rahmenvertrag', '2026']`.
 *
 * **Kleinschreibung entscheidet nicht ueber Gleichheit, aber ueber die
 * Doppelung.** Wer denselben Begriff zweimal tippt, meint ihn einmal; wer ihn
 * gross und klein tippt, meint ihn auch einmal. Die ERSTE Schreibweise
 * gewinnt, weil sie die ist, die der Mensch gesehen hat — eine
 * kleingeschriebene Ablage laese sich nicht mehr als „GmbH" schreiben.
 *
 * Rein, damit `tests/kern/dokument-ablage.test.ts` jeden Grenzfall ohne
 * Datenbank halten kann.
 */
export function leseTags(roh: string): readonly string[] {
  const gesehen = new Set<string>();
  const raus: string[] = [];
  for (const stueck of roh.split(',')) {
    const t = stueck.trim().slice(0, TAG_LAENGE);
    if (t === '') continue;
    const schluessel = t.toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    raus.push(t);
    if (raus.length >= TAG_HOECHSTZAHL) break;
  }
  return raus;
}

export function istKategorie(wert: string): wert is Kategorie {
  return (KATEGORIEN as readonly string[]).includes(wert);
}

export interface AblageEingabe {
  readonly kategorie: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly tags: string;
  /** `''` heisst „kein Bezug" — nie eine leere Kennung. */
  readonly kundeId: string;
  readonly objektId: string;
  readonly sichtbarFuerMitarbeiter: boolean;
  readonly dateiname: string;
  readonly daten: Uint8Array;
  /** Was der Browser behauptet. Wird verglichen, nie geglaubt. */
  readonly behaupteterTyp: string;
}

export interface GeprueftAblage {
  readonly kategorie: Kategorie;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly tags: readonly string[];
  readonly kundeId: string | null;
  readonly objektId: string | null;
  readonly sichtbarFuerMitarbeiter: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Prueft die FELDER — nicht die Datei.
 *
 * Die Datei prueft `ladeHoch`, und zwar an den Bytes: Groesse, Magic Bytes,
 * Widerspruch zur Deklaration. Diese Funktion beantwortet nur, ob die
 * Beschriftung stimmt, und sie tut es rein.
 */
export function pruefeFelder(eingabe: AblageEingabe): GeprueftAblage {
  const titel = eingabe.titel.trim();
  if (titel === '') {
    throw new AblageFehler(
      'Der Titel ist Pflicht. Ein Dokument ohne Titel findet in der Ablage '
      + 'niemand wieder — auch nicht mit der Volltextsuche, denn die sucht darin.');
  }
  if (titel.length > 200) {
    throw new AblageFehler('Der Titel fasst 200 Zeichen.');
  }
  const kategorie = eingabe.kategorie.trim();
  if (!istKategorie(kategorie)) {
    throw new AblageFehler(
      'Unbekannte Kategorie. DOC-01 nennt genau neun, und die Aufbewahrungsfrist '
      + 'hängt an ihr — eine zehnte zu erfinden hiesse, eine Frist zu erfinden.');
  }
  const beschreibung = eingabe.beschreibung.trim();
  if (beschreibung.length > 2000) {
    throw new AblageFehler('Die Beschreibung fasst 2000 Zeichen.');
  }
  const kunde = eingabe.kundeId.trim();
  const objekt = eingabe.objektId.trim();
  if (kunde !== '' && !UUID.test(kunde)) throw new AblageFehler('Unbekannter Kunde.');
  if (objekt !== '' && !UUID.test(objekt)) throw new AblageFehler('Unbekanntes Objekt.');
  if (eingabe.daten.length === 0) {
    throw new AblageFehler('Es war keine Datei dabei.');
  }
  if (eingabe.daten.length > MAX_BYTES) {
    throw new AblageFehler(
      `Die Datei ist grösser als ${String(Math.trunc(MAX_BYTES / (1024 * 1024)))} MB.`);
  }
  return {
    kategorie,
    titel,
    beschreibung: beschreibung === '' ? null : beschreibung,
    tags: leseTags(eingabe.tags),
    kundeId: kunde === '' ? null : kunde,
    objektId: objekt === '' ? null : objekt,
    sichtbarFuerMitarbeiter: eingabe.sichtbarFuerMitarbeiter,
  };
}

export interface AblageErgebnis {
  readonly dokumentId: string;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly exifEntfernt: boolean;
  readonly sha256: string;
  readonly loeschsperre: boolean;
  readonly aufbewahrungBis: string | null;
}

/**
 * Legt eine mitgebrachte Datei ab — Bytes in den privaten Bucket, Zeile und
 * erste Version in die Datenbank.
 *
 * **Der Bezug wird GEPRUEFT und nicht durchgereicht.** `dokument.kunde_id`
 * und `dokument.objekt_id` tragen keinen Fremdschluessel (0009: die Ziele
 * kamen erst mit Phase 4), also gibt es keine Datenbankwache dagegen, eine
 * Kennung aus einer fremden Gesellschaft einzutragen. Die beiden Abfragen
 * unten laufen unter RLS: was diese Sitzung nicht sieht, gibt es fuer sie
 * nicht (AUT-06).
 *
 * **Und es entsteht keine Waise.** Der Bucket kennt kein Rollback, also
 * schreibt er als LETZTES — siehe den Puffer weiter unten.
 */
export async function legeAb(
  kontext: SchreibKontext, speicher: Speicher, roh: AblageEingabe,
): Promise<AblageErgebnis> {
  const eingabe = pruefeFelder(roh);

  if (eingabe.kundeId !== null) {
    const [k] = await kontext.abfrage<{ id: string }>(
      `select id from kunde where id = $1::uuid`, [eingabe.kundeId]);
    if (k === undefined) throw new BezugUnbekannt('kunde');
  }
  if (eingabe.objektId !== null) {
    const [o] = await kontext.abfrage<{ id: string }>(
      `select id from objekt where id = $1::uuid`, [eingabe.objektId]);
    if (o === undefined) throw new BezugUnbekannt('objekt');
  }

  /* Das Entstehungsjahr aus der DATENBANK, nie aus der Uhr des Prozesses
     (Invariante 5) — es entscheidet die Aufbewahrungsfrist (DOC-07). */
  const [jetzt] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from (now() at time zone 'Europe/Berlin'))::int as jahr`);
  if (jetzt === undefined) {
    /* Kein stiller Rueckfall auf die Prozessuhr: eine Frist, die vielleicht
       stimmt, ist hier schlechter als eine Ausnahme, die jemand sieht. */
    throw new Error('Die Datenbank hat kein Entstehungsjahr zurückgegeben.');
  }

  /**
   * **Der Bucket kennt kein Rollback — also schreibt er als LETZTES.**
   *
   * Die fuenf aelteren Uploadwege legen die Bytes zuerst ab und raeumen bei
   * einem Datenbankfehler hinterher auf. Das ist die zweitbeste Ordnung: sie
   * braucht einen Loeschweg (`Speicher.entferne`) an genau der Stelle, an der
   * DOC-07 keinen haben will, und das Aufraeumen kann selbst scheitern —
   * dann liegt die Waise doch da.
   *
   * Hier laeuft `ladeHoch` deshalb gegen einen PUFFER: Groessenpruefung,
   * Magic Bytes, Metadatenentfernung, Aufbewahrung und Hash geschehen
   * unveraendert und in derselben Reihenfolge, nur die Uebergabe an den
   * Speicher wartet. Erst wenn `dokument` und `dokument_version` stehen,
   * gehen die Bytes hinaus. Scheitert das, wirft es — und die Transaktion
   * nimmt beide Zeilen mit; es entsteht weder eine Waise noch eine Zeile
   * ohne Datei.
   *
   * Der Preis ist ehrlich: die Uebertragung liegt INNERHALB der Transaktion
   * und haelt sie so lange offen, wie die Datei gross ist. Das ist bei einer
   * Obergrenze von 256 MB vertretbar und die bessere Haelfte des Tauschs —
   * eine Datei im Bucket, auf die keine Zeile zeigt, findet niemand wieder.
   */
  if (!speicher.verbunden) throw new NichtVerbundenFehler('Supabase Storage');
  const puffer = new PufferSpeicher(speicher.verbunden);

  const hoch = await ladeHoch({
    mandantId: kontext.aktiverMandantId,
    kategorie: eingabe.kategorie,
    titel: eingabe.titel,
    dateiname: roh.dateiname,
    daten: roh.daten,
    ...(roh.behaupteterTyp === '' ? {} : { behaupteterTyp: roh.behaupteterTyp }),
  }, puffer, jetzt.jahr);

  await kontext.schreibe(
    /*
     * `mime_typ` ist der VERIFIZIERTE Typ aus den Magic Bytes, nie die
     * Behauptung des Browsers, und `mime_verifiziert` traegt keinen
     * Vorgabewert: eine vergessene Spalte wird damit zum Constraint-Fehler
     * statt zu einem stillen `false` (0009).
     *
     * `aufbewahrung_bis` und `loeschsperre` setzt der Ausloeser
     * `trg_dokument_aufbewahrung` ohnehin aus der Regel der Kategorie; sie
     * stehen hier mit, damit die Zeile auch ohne ihn vollstaendig waere.
     */
    `insert into dokument
       (id, mandant_id, kategorie, titel, beschreibung, tags,
        kunde_id, objekt_id, sichtbar_fuer_mitarbeiter,
        mime_typ, mime_verifiziert, groesse_bytes, bucket, objekt_schluessel,
        exif_entfernt, aufbewahrung_bis, loeschsperre, erstellt_von)
     values ($1::uuid, $2::uuid, $3::dokument_kategorie, $4, $5, $6::text[],
             $7::uuid, $8::uuid, $9,
             $10, true, $11, $12, $13, $14, $15::date, $16, app.aktueller_benutzer())`,
    [hoch.dokumentId, kontext.aktiverMandantId, eingabe.kategorie, eingabe.titel,
      eingabe.beschreibung, [...eingabe.tags], eingabe.kundeId, eingabe.objektId,
      eingabe.sichtbarFuerMitarbeiter, hoch.mimeTyp, hoch.groesseBytes, hoch.bucket,
      hoch.objektSchluessel, hoch.exifEntfernt, hoch.aufbewahrungBis, hoch.loeschsperre]);

  await kontext.schreibe(
    /* Version 1. Der SHA-256 haengt an der VERSION und nicht am Dokument:
       zwei Kopien desselben Hashes ohne etwas, das sie gleich haelt, driften
       — und zwar im Feld, auf dem die GoBD-Integritaet ruht (0009). */
    `insert into dokument_version
       (id, mandant_id, dokument_id, version, objekt_schluessel,
        sha256, groesse_bytes, mime_typ, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, 1, $4, $5, $6, $7, app.aktueller_benutzer())`,
    [randomUUID(), kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
      hoch.sha256, hoch.groesseBytes, hoch.mimeTyp]);

  /* Jetzt, und keine Zeile frueher. */
  await puffer.schreibeDurch(speicher);

  return {
    dokumentId: hoch.dokumentId,
    mimeTyp: hoch.mimeTyp,
    groesseBytes: hoch.groesseBytes,
    exifEntfernt: hoch.exifEntfernt,
    sha256: hoch.sha256,
    loeschsperre: hoch.loeschsperre,
    aufbewahrungBis: hoch.aufbewahrungBis,
  };
}

/**
 * Ein Speicher, der die Bytes ANNIMMT und noch nicht hinausgibt.
 *
 * Er erfuellt den Vertrag nur fuer den einen Schritt, um den es geht: EIN
 * `lege` je Upload. Lesen, Signieren und Entfernen sind hier keine
 * unvollstaendigen Umsetzungen, sondern Fehler — wer auf einem Puffer eine
 * signierte Adresse anfordert, hat den Puffer fuer den Speicher gehalten, und
 * ein stillschweigendes Durchreichen machte daraus einen zweiten Weg in den
 * Bucket.
 */
class PufferSpeicher implements Speicher {
  readonly verbunden: boolean;
  private inhalt: { bucket: Bucket; schluessel: string; daten: Uint8Array } | null = null;

  constructor(verbunden: boolean) {
    this.verbunden = verbunden;
  }

  lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void> {
    if (this.inhalt !== null) {
      return Promise.reject(new Error('Der Puffer trägt genau eine Datei je Ablage.'));
    }
    this.inhalt = { bucket, schluessel, daten };
    return Promise.resolve();
  }

  hole(): Promise<Uint8Array> {
    return Promise.reject(new Error('Ein Ablagepuffer liest nicht.'));
  }

  entferne(): Promise<void> {
    return Promise.reject(new Error('Ein Ablagepuffer löscht nicht (DOC-07).'));
  }

  signierteUrl(): Promise<string> {
    return Promise.reject(new Error('Ein Ablagepuffer signiert nicht (DOC-03).'));
  }

  /** Gibt die gepufferten Bytes an den ECHTEN Speicher weiter. */
  async schreibeDurch(echt: Speicher): Promise<void> {
    if (this.inhalt === null) {
      throw new Error('Es wurden keine Bytes gepuffert — die Ablage hat nichts abgelegt.');
    }
    await echt.lege(this.inhalt.bucket, this.inhalt.schluessel, this.inhalt.daten);
  }
}
