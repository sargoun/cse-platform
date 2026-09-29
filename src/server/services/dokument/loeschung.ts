import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import type { Bucket, Speicher } from '../../storage/adapter.js';

/**
 * Der EINE Weg, auf dem ein Dokument samt Datei verschwindet (DOC-07,
 * LEG-01, ACC-06, PR 64).
 *
 * Reihenfolge: zuerst die Zeile (weiches Loeschen — `geloescht_am`, mit
 * Grund und Person), dann das Objekt. Die Zeile entscheidet: ein Dokument
 * unter Loeschsperre weist die Datenbank ab (`kern.dokument_loeschsperre`),
 * eines, auf das sich eine Buchungszeile beruft, ebenso
 * (`fin.dokument_haengt_an_buchung`) — und dann wird auch das Objekt nicht
 * angefasst. Umgekehrt (erst Objekt, dann Zeile) laege im Bucket nichts
 * mehr, waehrend die Zeile noch auf die Datei zeigt: genau der Zustand, den
 * eine Betriebspruefung „Beleg nicht vorgelegt" nennt.
 *
 * Scheitert das Entfernen im Speicher NACH dem weichen Loeschen, wirft der
 * Adapter, die Transaktion des Aufrufers rollt die Zeile zurueck, und beides
 * steht wie vorher. Kein halber Zustand in keine Richtung.
 *
 * **Alle Fassungen gehen mit** (V-266, D-758). Seit V-219 traegt ein Dokument
 * je Fassung ein eigenes Objekt (`<mandant>/<kategorie>/<dokument>.v<n>`), und
 * die Zeile zeigt nur auf die neueste. Entfernt wurde bis hierher nur, was
 * das weiche Loeschen zurueckgab — Fassung 1 … n-1 blieben fuer immer im
 * Behaelter, auch nach Fristablauf (Art. 5 Abs. 1 lit. e, Art. 17 DSGVO) und
 * gerade dann, wenn eine aeltere Fassung inzwischen berichtigte Angaben
 * ueber einen Menschen traegt. Gelesen wird deshalb die ganze Kette, und die
 * AELTEREN Objekte gehen zuerst: scheitert eines davon, rollt die Zeile
 * zurueck, und die aktuelle Datei liegt noch — die Liste und der Abruf
 * zeigen dann weiter das, was die Zeile verspricht.
 *
 * **Sonst ruft niemand `entferne`.** Die Merge-Wache
 * `speicher-entfernen-nur-ueber-loeschung` laesst den Aufruf nur hier und an
 * den Stellen zu, die ein gerade hochgeladenes Objekt ohne Zeile
 * zuruecknehmen (die Waisen der Upload-Routen).
 */
export class LoeschungFehler extends Error {
  constructor(nachricht: string, readonly grund: 'nicht_gefunden' | 'gesperrt' | 'grund') {
    super(nachricht);
    this.name = 'LoeschungFehler';
  }
}

export interface DokumentLoeschen {
  readonly dokumentId: string;
  /** Warum — steht in `loeschgrund`, mindestens fuenf Zeichen. */
  readonly grund: string;
}

export interface Geloescht {
  readonly bucket: Bucket;
  /** Der Schlüssel, auf den die Zeile zeigte — die neueste Fassung. */
  readonly objektSchluessel: string;
  /**
   * Jedes entfernte Objekt, die älteren Fassungen zuerst, die neueste zuletzt
   * (V-266). Ein Dokument ohne Kette (vor V-219 abgelegt) hat genau eins.
   */
  readonly entfernt: readonly string[];
}

interface OrtRoh {
  readonly bucket: string;
  readonly objekt_schluessel: string;
}

function istRestriktion(fehler: unknown): fehler is Error & { code: string } {
  return fehler instanceof Error && (fehler as { code?: unknown }).code === '23001';
}

/**
 * **Eine von der Policy abgewiesene Zeile — und warum das ein zweiter Fall ist.**
 *
 * Fehlt das RECHT, faellt die Zeile aus dem `using` der Schreibpolicy: das
 * `update` trifft null Zeilen, und unten wird daraus `nicht_gefunden`. Ist die
 * Bindung dagegen NUR-LESEND (Gruppenansicht, Invariante 10), faellt sie am
 * `with check` — und das WIRFT. Bis V-026 kam diese Meldung roh beim Aufrufer
 * an: „new row violates row-level security policy", also ein 500er dort, wo
 * „hier wird nicht geschrieben" die Wahrheit ist.
 *
 * Gezaehlt wird sie als `gesperrt` und nicht als eigener Grund: fuer den
 * Aufrufer ist beides dasselbe — die Zeile bleibt, und die Datei wird nicht
 * angefasst. Der Nachtlauf zaehlt sie damit als „zurueckgehalten", und das
 * stimmt: zwischen Finden und Loeschen hat sich die Lage geaendert.
 */
function istPolicy(fehler: unknown): boolean {
  if (!(fehler instanceof Error)) return false;
  if ((fehler as { code?: unknown }).code === '42501') return true;
  return /row[- ]level security/iu.test(fehler.message);
}

export async function loescheDokument(
  kontext: SchreibKontext, speicher: Speicher, e: DokumentLoeschen,
): Promise<Geloescht> {
  const grund = e.grund.trim();
  if (grund.length < 5) throw new LoeschungFehler('Ein Löschgrund gehört dazu — mindestens fünf Zeichen.', 'grund');

  let zeilen: readonly OrtRoh[];
  try {
    zeilen = await kontext.schreibe<OrtRoh>(
      `update dokument
          set geloescht_am = now(), geloescht_von = app.aktueller_benutzer(), loeschgrund = $2
        where id = $1::uuid and mandant_id = app.aktiver_mandant() and geloescht_am is null
        returning bucket, objekt_schluessel`,
      [e.dokumentId, grund]);
  } catch (fehler: unknown) {
    if (istRestriktion(fehler)) throw new LoeschungFehler(fehler.message, 'gesperrt');
    if (istPolicy(fehler)) {
      throw new LoeschungFehler(
        'Diese Sitzung darf das Dokument nicht löschen — in der Gruppenansicht wird '
        + 'gar nicht geschrieben (Invariante 10). Es wurde nichts angefasst.',
        'gesperrt');
    }
    throw fehler;
  }
  const ort = zeilen[0];
  if (ort === undefined) {
    throw new LoeschungFehler('Das Dokument ist nicht erreichbar oder schon gelöscht.', 'nicht_gefunden');
  }
  /*
   * Die Kette unter DERSELBEN Bindung wie das weiche Löschen: `t_version_lesen`
   * (0009) verlangt `dokument.lesen`, das das UPDATE oben über `t_mandant`
   * ohnehin schon verlangt hat; der Nachtlauf liest über
   * `j_dokument_version_lesen` (0139). Alle Fassungen liegen im Behälter des
   * Dokuments (`legeFassungAn` legt sie dorthin).
   */
  const kette = await kontext.abfrage<{ objekt_schluessel: string }>(
    `select distinct v.objekt_schluessel
       from dokument_version v
      where v.dokument_id = $1::uuid and v.mandant_id = app.aktiver_mandant()
        and v.objekt_schluessel <> $2
      order by v.objekt_schluessel`,
    [e.dokumentId, ort.objekt_schluessel]);
  const entfernt = [...kette.map((v) => v.objekt_schluessel), ort.objekt_schluessel];
  for (const schluessel of entfernt) {
    await speicher.entferne(ort.bucket as Bucket, schluessel);
  }
  return { bucket: ort.bucket as Bucket, objektSchluessel: ort.objekt_schluessel, entfernt };
}
