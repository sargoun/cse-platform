import 'server-only';
import type { Speicher } from '../../storage/adapter.js';
import { ladeHoch } from '../dokument/upload.js';
import { pdfDateiname, zugferdZurRechnung, KeinSnapshotFehler }
  from '../finanz/xrechnung/dienst.js';

/**
 * Das Archiv der Ausgangsrechnung (ACC-03, DOC-04, § 147 AO, PR 59).
 *
 * **Warum ein Archiv, wenn sich das PDF nachbauen lässt.** `zugferdZurRechnung`
 * erzeugt das Dokument bei jedem Abruf neu, aus dem Snapshot (K-12), mit
 * `festgeschriebenAm` als Erzeugungszeitpunkt — es ist deterministisch, und
 * zwei Abrufe liefern dieselben Bytes. Das reicht für den Versand und nicht
 * für § 147 AO: verlangt ist das Dokument, das VORLAG, nicht eines, das sich
 * herstellen lässt.
 *
 * Der Unterschied ist heute unsichtbar und am Tag der nächsten Änderung an
 * der Vorlage überall auf einmal sichtbar — rückwirkend, für jede Rechnung,
 * und ohne Möglichkeit zu zeigen, welche Fassung der Kunde bekommen hat.
 *
 * **Nach dem Festschreiben, nicht davor.** Vorher gibt es keine Nummer und
 * keinen Snapshot; ein davor abgelegtes PDF wäre nicht das, was hinausgeht.
 * Deshalb ist das Ablegen ein eigener Schritt und nicht Teil von
 * `finalisiere`: dort liefe es innerhalb der Transaktion, die den
 * Nummernzähler unter `SELECT … FOR UPDATE` hält, und ein Netzaufruf in
 * diesem Fenster hielte den Zähler für jede andere Rechnung fest.
 *
 * **Bis er gelaufen ist, ist die Rechnung nicht exportfähig** — ihre
 * Buchungszeilen stehen in `buchungssatz_unvollstaendig`, und
 * `app.export_sperre_pruefen` verweigert. Das ist kein Versehen, sondern die
 * Aussage: ohne abgelegten Beleg keine DATEV-Datei.
 */

/**
 * Was dieser Dienst von einem Kontext braucht — und nicht mehr.
 *
 * Ein `SchreibKontext` erfuellt das strukturell; eine Job-Sitzung ebenso,
 * OHNE einen Benutzer erfinden zu muessen. Haette der Dienst den vollen
 * Kontext verlangt, muesste der naechtliche Lauf `benutzerId`, `scope` und
 * `portal` mit irgendetwas fuellen — und dieses Irgendetwas landete
 * frueher oder spaeter in einer Spalte, die jemand als Tatsache liest.
 */
export interface ArchivKontext {
  readonly aktiverMandantId: string;
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  schreibe<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type ArchivGrund =
  | 'archiviert'
  /** Lag schon im Archiv — der Lauf ist wiederholbar. */
  | 'schon_archiviert'
  /** Noch nicht festgeschrieben: es gibt nichts Endgültiges abzulegen. */
  | 'nicht_festgeschrieben'
  /** Kein Snapshot — dann gibt es auch kein Dokument (K-12). */
  | 'kein_snapshot';

export interface ArchivErgebnis {
  readonly grund: ArchivGrund;
  readonly belegId: string | null;
  readonly dokumentId: string | null;
  readonly sha256: string | null;
  /** Wie viele Buchungszeilen den Beleg dabei bekommen haben. */
  readonly zeilen: number;
}

interface KopfRoh {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsdatum: string | null;
  readonly kunde_id: string;
  readonly beleg_id: string | null;
  readonly ist_storno: boolean;
}

export class BelegarchivFehler extends Error {
  constructor(nachricht: string, readonly grund: ArchivGrund) {
    super(nachricht);
    this.name = 'BelegarchivFehler';
  }
}

/**
 * Legt das ZUGFeRD-PDF einer festgeschriebenen Rechnung ab und hängt es als
 * Beleg an die Rechnung und an ihre Buchungszeilen.
 *
 * Wiederholbar: eine Rechnung, die schon einen Beleg trägt, wird nicht
 * zweimal abgelegt. Der Wiederholungsfall ist der Normalfall — der Lauf
 * geht jede Nacht über dieselbe Menge.
 */
export async function archiviereRechnungsbeleg(
  kontext: ArchivKontext,
  speicher: Speicher,
  rechnungId: string,
): Promise<ArchivErgebnis> {
  const [kopf] = await kontext.abfrage<KopfRoh>(
    `select r.id, r.nummer, r.status::text as status,
            r.rechnungsdatum::text as rechnungsdatum, r.kunde_id, r.beleg_id,
            (r.rechnungsart = 'storno') as ist_storno
       from rechnung r
      where r.id = $1`,
    [rechnungId]);

  if (kopf === undefined) {
    throw new BelegarchivFehler(
      `Rechnung ${rechnungId} nicht gefunden.`, 'nicht_festgeschrieben');
  }
  if (kopf.beleg_id !== null) {
    return {
      grund: 'schon_archiviert', belegId: kopf.beleg_id, dokumentId: null,
      sha256: null, zeilen: 0,
    };
  }
  if (kopf.status !== 'festgeschrieben' || kopf.nummer === null
      || kopf.rechnungsdatum === null) {
    return {
      grund: 'nicht_festgeschrieben', belegId: null, dokumentId: null,
      sha256: null, zeilen: 0,
    };
  }

  let pdf: Uint8Array;
  try {
    const erzeugt = await zugferdZurRechnung(
      { abfrage: kontext.abfrage.bind(kontext) }, rechnungId);
    if (erzeugt === null) {
      return {
        grund: 'nicht_festgeschrieben', belegId: null, dokumentId: null,
        sha256: null, zeilen: 0,
      };
    }
    pdf = erzeugt.pdf;
  } catch (fehler) {
    if (fehler instanceof KeinSnapshotFehler) {
      return {
        grund: 'kein_snapshot', belegId: null, dokumentId: null,
        sha256: null, zeilen: 0,
      };
    }
    throw fehler;
  }

  /*
   * **Das Jahr kommt aus dem Rechnungsdatum, nicht aus der Uhr** (Invariante
   * 2, Invariante 5). Die Aufbewahrungsfrist läuft ab dem Ende des Jahres,
   * in dem der Beleg ENTSTANDEN ist; ein Nachlauf im Januar rechnete sonst
   * ein Jahr zu lang, und das fiele erst in neun Jahren auf.
   */
  const jahr = Number(kopf.rechnungsdatum.slice(0, 4));
  /*
   * **`storno` wird zu `gutschrift`, und das ist kein Wortspiel.**
   * `rechnungsart` beschreibt die Rolle im Rechnungswesen (Abschlag,
   * Schluss, Storno); `beleg_typ` beschreibt, WAS fuer ein Dokument im
   * Archiv liegt. Eine Stornorechnung ist dort eine Gutschrift — so heisst
   * das Papier, und so sucht der Prüfer danach.
   */
  const titel = `${kopf.ist_storno ? 'Stornorechnung' : 'Rechnung'} ${kopf.nummer}`;

  const hoch = await ladeHoch(
    {
      mandantId: kontext.aktiverMandantId,
      kategorie: 'buchhaltung',
      titel,
      dateiname: pdfDateiname(kopf.nummer),
      daten: pdf,
      behaupteterTyp: 'application/pdf',
      bucket: 'archiv',
    },
    speicher, jahr);

  /**
   * **Ab hier liegt eine Datei im Bucket, die die Transaktion nicht mehr
   * zurücknimmt.** Dieselbe Vorrichtung wie beim Mahnschreiben: schlägt einer
   * der folgenden Schreibvorgänge fehl, rollt alles zurück und das Objekt
   * bliebe als Waise — eine Rechnung mit Kundenname und Beträgen, auf die
   * keine Zeile zeigt und die deshalb weder auffindbar noch löschbar ist.
   */
  try {
    await kontext.schreibe(
      `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                             mime_verifiziert, groesse_bytes, bucket,
                             objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                             loeschsperre, kunde_id, erstellt_von)
       values ($1::uuid, $2::uuid, 'buchhaltung', $3, $4, true, $5::bigint, $6,
               $7, $8, $9::date, $10, $11::uuid, app.aktueller_benutzer())`,
      [hoch.dokumentId, kontext.aktiverMandantId, titel, hoch.mimeTyp,
       String(hoch.groesseBytes), hoch.bucket, hoch.objektSchluessel,
       hoch.exifEntfernt, hoch.aufbewahrungBis, hoch.loeschsperre, kopf.kunde_id]);

    await kontext.schreibe(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ, erstellt_von)
       values ($1::uuid, $2::uuid, 1, $3, $4, $5::bigint, $6, app.aktueller_benutzer())`,
      [kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
       hoch.sha256, String(hoch.groesseBytes), hoch.mimeTyp]);

    /*
     * Dokument, Version und Prüfwert werden GELESEN, nicht behauptet — der
     * `insert … select` in `legeBelegAn` (0130-Befund) lässt die Zeile nur
     * entstehen, wenn die drei zusammengehören. Hier steht er ausgeschrieben,
     * weil der Typ ein anderer ist als dort.
     *
     * **`erstellt_von_art = 'system'`, nicht `'mensch'`.** Kein Mensch stellt
     * dieses PDF her; die Plattform rendert es aus dem Snapshot, und der
     * nächtliche Lauf hat ohnehin keinen angemeldeten Benutzer —
     * `app.aktueller_benutzer()` ist dort NULL, und `beleg_akteur_stimmig`
     * wiese die Zeile ab. Die Alternative wäre gewesen, den auslösenden
     * Benutzer einzutragen, wenn es einen gibt: dann stünde auf demselben
     * Beleg mal ein Name und mal keiner, je nachdem, wer zuerst hinsah.
     */
    const [beleg] = await kontext.schreibe<{ id: string }>(
      `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                          dokument_version_id, datei_sha256, belegdatum,
                          erstellt_von_art, erstellt_von_dienst)
       select app.aktiver_mandant(), $1, $2::beleg_typ, 'erzeugt'::beleg_quelle,
              v.dokument_id, v.id, v.sha256, $3::date,
              'system', 'dienst:belegarchiv'
         from dokument_version v
        where v.dokument_id = $4::uuid
          and v.mandant_id = app.aktiver_mandant()
          and v.sha256 = $5
       returning id`,
      [kopf.nummer, kopf.ist_storno ? 'gutschrift' : 'ausgangsrechnung',
       kopf.rechnungsdatum, hoch.dokumentId, hoch.sha256]);

    if (beleg === undefined) {
      throw new BelegarchivFehler(
        'Dokument, Version und Prüfwert gehören nicht zusammen — es entsteht kein '
        + 'Beleg.', 'kein_snapshot');
    }

    const [gesetzt] = await kontext.schreibe<{ zeilen: number }>(
      'select app.rechnung_beleg_setzen($1::uuid, $2::uuid, $3::uuid) as zeilen',
      [kontext.aktiverMandantId, rechnungId, beleg.id]);

    return {
      grund: 'archiviert',
      belegId: beleg.id,
      dokumentId: hoch.dokumentId,
      sha256: hoch.sha256,
      zeilen: Number(gesetzt?.zeilen ?? 0),
    };
  } catch (fehler) {
    try {
      await speicher.entferne(hoch.bucket, hoch.objektSchluessel);
    } catch {
      /*
       * Auch das Aufräumen kann scheitern. Dann bleibt ein verwaistes Objekt
       * — und es bleibt AUFFINDBAR, weil keine `dokument`-Zeile darauf zeigt;
       * genau daran erkennt es der Waisenlauf. Der ursprüngliche Fehler wird
       * dadurch nicht verdeckt.
       */
    }
    throw fehler;
  }
}

/** Die noch nicht abgelegten festgeschriebenen Rechnungen, älteste zuerst. */
export async function offeneArchivierungen(
  kontext: ArchivKontext, grenze = 200,
): Promise<readonly string[]> {
  const zeilen = await kontext.abfrage<{ id: string }>(
    `select id from rechnung
      where beleg_id is null and status = 'festgeschrieben'
      order by rechnungsdatum, nummer_laufend
      limit $1`,
    [grenze]);
  return zeilen.map((z) => z.id);
}
