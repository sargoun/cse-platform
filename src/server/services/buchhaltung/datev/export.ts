import 'server-only';
import { createHash } from 'node:crypto';
import type { Speicher } from '../../../storage/adapter.js';
import { legeErzeugtAb } from '../../dokument/erzeugt.js';
import { exportPaket, type Exportpaket } from '../exportpaket.js';
import {
  FORMAT_SPEZIFIKATIONSABGELEITET, schreibeExtf, stapelBezeichnung,
  type ExtfBuchung, type ExtfKopf,
} from './extf.js';

/**
 * Der DATEV-Export als Vorgang (ACC-02, `05-FINANZEN.md` §9.4, PR 60).
 *
 * **Es gibt keine Übertragung an DATEV, und es wird keine vorgetäuscht.**
 * Diese Datei erzeugt eine Datei und legt sie ab. Wer sie dem Steuerberater
 * gibt, ist ein Mensch, und dass er es getan hat, vermerkt er selbst
 * (`status = 'uebergeben'`). Ein Knopf „an DATEV senden" wäre eine erfundene
 * Integration — es gibt keine Zugangsdaten und keine API dafür.
 *
 * **Drei Riegel vor der ersten Zeile**, und alle drei sitzen in der
 * Datenbank, nicht hier:
 *
 *  1. `app.export_sperre_pruefen` (PR 59) — keine Zeile ohne Beleg und ohne
 *     Konto im Zeitraum. Läuft über `exportPaket`.
 *  2. `app.datev_stammdaten` — die O-05-Angaben sind vollständig und
 *     bestätigt, oder es entsteht nichts.
 *  3. Die Policy auf `datev_export` verlangt `buchhaltung.exportieren`.
 *
 * Die Reihenfolge ist Absicht: erst die teure fachliche Prüfung, dann die
 * billige Rechteprüfung? Nein — umgekehrt wäre es billiger und schlechter.
 * Wer das Recht hat, aber einen unvollständigen Monat exportiert, soll den
 * fachlichen Satz lesen; wer das Recht nicht hat, soll gar nichts über den
 * Zustand der Buchhaltung erfahren. Deshalb prüft die Policy zuerst, beim
 * INSERT, und die fachlichen Sätze kommen davor nur aus Funktionen, die
 * selbst `buchhaltung.lesen` verlangen.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

export class ExportFehler extends Error {
  constructor(nachricht: string, readonly grund: 'stammdaten' | 'leer' | 'speicher') {
    super(nachricht);
    this.name = 'ExportFehler';
  }
}

export interface ExportErgebnis {
  readonly exportId: string;
  readonly bytes: Uint8Array;
  readonly dateiname: string;
  readonly sha256: string;
  readonly zeilen: number;
  readonly summeSollCent: bigint;
  readonly summeHabenCent: bigint;
  /** ⚑ Solange kein Kundenmuster vorliegt: true (O-05). */
  readonly formatUngeprueft: boolean;
  /** NULL, wenn kein Speicher verbunden ist — die Datei gibt es trotzdem. */
  readonly dokumentId: string | null;
}

interface StammdatenRoh {
  readonly berater_nummer: string;
  readonly mandanten_nummer: string;
  readonly kontenrahmen: string;
  readonly sachkontenlaenge: number;
  readonly wj_beginn_monat: number;
  readonly wj_beginn_tag: number;
  readonly versteuerungsart: string;
  readonly extf_version: string;
  readonly festschreibung: boolean;
}

/**
 * Der Wirtschaftsjahresbeginn, der VOR dem Zeitraum liegt.
 *
 * Monat und Tag stehen in den Stammdaten; das Jahr ergibt sich aus dem
 * Zeitraum. Ein abweichendes Wirtschaftsjahr (etwa 1. Juli) heisst, dass ein
 * Export im Mai 2027 auf den 1. Juli 2026 zeigt — nicht auf den 1. Juli 2027,
 * der noch nicht begonnen hat.
 *
 * Reine Zeichenkettenarithmetik über die ISO-Form; kein `Date`, weil ein
 * `Date` hier eine Zeitzone mitbrächte, die niemand gemeint hat (Invariante 2,
 * K-11).
 */
export function wirtschaftsjahrBeginn(
  von: string, monat: number, tag: number,
): string {
  const jahr = Number(von.slice(0, 4));
  const mm = String(monat).padStart(2, '0');
  const tt = String(tag).padStart(2, '0');
  const imSelbenJahr = `${String(jahr)}-${mm}-${tt}`;
  return imSelbenJahr <= von
    ? imSelbenJahr
    : `${String(jahr - 1)}-${mm}-${tt}`;
}

/** `EXTF_Buchungsstapel_2026-08-01_2026-08-31.csv` — ohne Umlaute, ohne Leerzeichen. */
export function exportDateiname(von: string, bis: string): string {
  return `EXTF_Buchungsstapel_${von}_${bis}.csv`;
}

export async function erzeugeDatevExport(
  db: Abfrage, speicher: Speicher, von: string, bis: string,
  /** HEREINGEGEBEN, nie hier gelesen — zwei Läufe müssen vergleichbar sein. */
  erzeugtAm: Date,
  ausgeloestVon: string,
): Promise<ExportErgebnis> {
  const mandantId = db.aktiverMandantId;

  /*
   * Die Stammdaten ZUERST. Sie werfen mit einem Satz, der jedes fehlende Feld
   * nennt — und sie zu holen, bevor das Paket gebaut wird, spart dem
   * Aufrufer, der sie nicht gepflegt hat, das Warten auf eine Abfrage über
   * einen ganzen Monat.
   */
  const [stamm] = await db.abfrage<StammdatenRoh>(
    'select * from app.datev_stammdaten($1::uuid)', [mandantId]);
  if (stamm === undefined) {
    throw new ExportFehler(
      'Für diese Gesellschaft sind keine DATEV-Stammdaten hinterlegt (O-05).',
      'stammdaten');
  }

  /* Die Exportsperre aus PR 59 sitzt in `exportPaket` — sie wirft, nicht wir. */
  const paket: Exportpaket = await exportPaket(db, mandantId, von, bis);

  if (paket.zeilen.length === 0) {
    throw new ExportFehler(
      `Im Zeitraum ${von} bis ${bis} steht keine Buchungszeile. Eine leere `
      + 'EXTF-Datei ist keine Aussage — sie sieht aus wie ein Monat ohne '
      + 'Geschäft.',
      'leer');
  }

  /*
   * **Kein `as`, und das ist hier keine Stilfrage.** Die erste Fassung stand
   * mit `as unknown as ExtfBuchung[]` da und trug ein Feld `festschreibung`,
   * das es auf `ExtfBuchung` gar nicht gibt — es heisst `festgeschrieben`.
   * Der Typecheck war gruen, und die Spalte `Festschreibung` waere in JEDER
   * Zeile leer geblieben: ein GoBD-Kennzeichen, das fehlt, ohne dass etwas
   * meldet. Ohne Zusicherung faellt genau das beim Uebersetzen auf.
   */
  const buchungen: readonly ExtfBuchung[] = paket.zeilen.map((z) => ({
    umsatzCent: z.umsatzCent,
    sollHaben: z.sollHaben,
    /*
     * `konto` kann hier nicht NULL sein — `app.export_sperre_pruefen` haette
     * sonst abgewiesen (PR 59). Der Riegel steht eine Ebene tiefer; hier
     * steht die Annahme, die er traegt.
     */
    konto: z.konto ?? '',
    gegenkonto: z.gegenkonto,
    buSchluessel: null,
    belegdatum: z.belegdatum,
    belegfeld1: z.belegfeld1,
    belegfeld2: null,
    buchungstext: z.buchungstext,
    leistungsdatum: null,
    festgeschrieben: z.festgeschrieben,
    buchungssatzId: z.buchungssatzId,
  }));

  const summe = (richtung: 'soll' | 'haben'): bigint => paket.zeilen
    .filter((z) => z.sollHaben === richtung)
    .reduce((s, z) => s + z.umsatzCent, 0n);
  const summeSoll = summe('soll');
  const summeHaben = summe('haben');

  const kopf: ExtfKopf = {
    beraterNummer: stamm.berater_nummer,
    mandantenNummer: stamm.mandanten_nummer,
    wjBeginn: wirtschaftsjahrBeginn(von, stamm.wj_beginn_monat, stamm.wj_beginn_tag),
    sachkontenlaenge: stamm.sachkontenlaenge,
    von,
    bis,
    bezeichnung: stapelBezeichnung(von, bis),
    kontenrahmen: stamm.kontenrahmen,
    festschreibung: stamm.festschreibung,
    exportiertVon: ausgeloestVon,
    erzeugtAm,
  };

  const bytes = schreibeExtf(kopf, buchungen);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  /*
   * **Die Zeile entsteht VOR der Ablage.** Der Vorgang ist die Aussage; das
   * Dokument ist sein Anhang. Ohne verbundenen Speicher bleibt `dokument_id`
   * NULL, und der Export ist trotzdem vollständig verzeichnet — mit Summen,
   * Zeilenzahl und Prüfwert. Umgekehrt (erst ablegen, dann verzeichnen) gäbe
   * es bei fehlendem Speicher gar keinen Vorgang, und die gestempelten Zeilen
   * zeigten ins Leere.
   */
  const [neu] = await db.schreibe<{ id: string }>(
    `insert into datev_export
       (mandant_id, von, bis, berater_nummer, mandanten_nummer, kontenrahmen,
        sachkontenlaenge, wj_beginn_monat, wj_beginn_tag, versteuerungsart,
        extf_version, festschreibung, zeilen, summe_soll_cent, summe_haben_cent,
        datei_sha256, format_ungeprueft, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::date, $3::date, $4, $5, $6::kontenrahmen, $7::integer,
             $8::smallint, $9::smallint, $10::versteuerungsart, $11, $12::boolean,
             $13::integer, $14::bigint, $15::bigint, $16, $17::boolean,
             'mensch', app.aktueller_benutzer())
     returning id`,
    [mandantId, von, bis, stamm.berater_nummer, stamm.mandanten_nummer,
      stamm.kontenrahmen, stamm.sachkontenlaenge, stamm.wj_beginn_monat,
      stamm.wj_beginn_tag, stamm.versteuerungsart, stamm.extf_version,
      stamm.festschreibung, paket.zeilen.length, summeSoll.toString(),
      summeHaben.toString(), sha256, FORMAT_SPEZIFIKATIONSABGELEITET]);

  if (neu === undefined) {
    throw new ExportFehler(
      'Der Exportvorgang liess sich nicht anlegen — fehlt buchhaltung.exportieren?',
      'stammdaten');
  }

  await db.schreibe(
    'select app.datev_zeilen_stempeln($1::uuid, $2::uuid, $3::date, $4::date)',
    [mandantId, neu.id, von, bis]);

  const dokumentId = await legeAb(db, speicher, neu.id, von, bis, bytes, erzeugtAm);

  return {
    exportId: neu.id,
    bytes,
    dateiname: exportDateiname(von, bis),
    sha256,
    zeilen: paket.zeilen.length,
    summeSollCent: summeSoll,
    summeHabenCent: summeHaben,
    formatUngeprueft: FORMAT_SPEZIFIKATIONSABGELEITET,
    dokumentId,
  };
}

/**
 * Legt die Datei ab — und verschweigt einen fehlenden Speicher nicht.
 *
 * Ist keiner verbunden, gibt es kein Dokument und `null` kommt zurück. Das ist
 * keine Ausnahme, sondern der dokumentierte Zustand: die Datei geht an den
 * Aufrufer (der Browser lädt sie), der Vorgang steht in der Datenbank, und die
 * Oberfläche sagt, dass keine Archivkopie existiert.
 */
async function legeAb(
  db: Abfrage, speicher: Speicher, exportId: string, von: string, bis: string,
  bytes: Uint8Array, erzeugtAm: Date,
): Promise<string | null> {
  if (!speicher.verbunden) return null;

  const titel = `DATEV-Buchungsstapel ${von} bis ${bis}`;
  /*
   * `legeErzeugtAb` und nicht `ladeHoch`: eine EXTF-Datei ist Text und hat
   * keine Magic Bytes, also weist der Upload-Pfad sie ab — zu Recht, denn sie
   * ist kein Upload. Die Bytes stammen zwanzig Zeilen weiter oben aus dieser
   * Datei; geprueft wird stattdessen, dass sie wirklich Text sind.
   */
  const hoch = await legeErzeugtAb(
    {
      mandantId: db.aktiverMandantId,
      kategorie: 'buchhaltung',
      titel,
      dateiname: exportDateiname(von, bis),
      daten: bytes,
      mimeTyp: 'text/csv',
      bucket: 'archiv',
    },
    speicher, erzeugtAm.getUTCFullYear());

  try {
    await db.schreibe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                             mime_verifiziert, groesse_bytes, bucket,
                             objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                             loeschsperre, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, false, $8::date, $9, app.aktueller_benutzer())`,
      [hoch.dokumentId, db.aktiverMandantId, titel, hoch.mimeTyp,
        String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
        hoch.aufbewahrungBis, hoch.loeschsperre]);

    await db.schreibe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ, erstellt_von)
       values ($1::uuid, $2::uuid, 1, $3, $4, $5::bigint, $6, app.aktueller_benutzer())`,
      [db.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
        hoch.sha256, String(hoch.groesseBytes), hoch.mimeTyp]);

    /* `dokument_id` steht in der Ausnahmeliste des Unveraenderlichkeits-Ausloesers. */
    await db.schreibe(
      'update datev_export set dokument_id = $2::uuid where id = $1::uuid',
      [exportId, hoch.dokumentId]);

    return hoch.dokumentId;
  } catch (fehler) {
    try {
      await speicher.entferne(hoch.bucket, hoch.objektSchluessel);
    } catch {
      /* Der urspruengliche Fehler wird davon nicht verdeckt. */
    }
    throw fehler;
  }
}
