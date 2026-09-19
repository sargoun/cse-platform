import 'server-only';
import { leseNutzlast } from '../xrechnung/aus-snapshot.js';
import { KeinSnapshotFehler } from '../xrechnung/dienst.js';
import { baueCii, ciiSummen, type CiiSummen } from './cii.js';
import type { Cent } from '../geld.js';

/**
 * Die ZUGFeRD-Vorschau — die eingebettete CII und die Summenprobe, ohne das
 * PDF zu bauen (FIN-12, 04-SEITENKARTE.md §5.14.3).
 *
 * **Warum nicht `zugferdZurRechnung()`.** Die liefert das fertige PDF: 200 kB
 * Binärdaten mit eingebetteten Schriften, damit eine Seite eine XML anzeigen
 * kann, die daneben als Text vorliegt. Die Vorschau braucht die CII und die
 * acht Summen — beides kommt aus demselben Snapshot und denselben zwei
 * Funktionen, die der PDF-Bauer benutzt. Der Download bleibt der bestehende
 * Weg (`/api/finanzen/rechnungen/[id]/zugferd.pdf`); es entsteht kein zweiter
 * Erzeuger.
 *
 * **Aus dem Snapshot und nie aus lebenden Stammdaten** (K-12). Ein Entwurf hat
 * keinen Snapshot, also gibt es keine Vorschau — und das ist ein ZUSTAND, kein
 * Fehler: die Rechnung entsteht mit der Festschreibung.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface ZugferdVorschau {
  readonly nummer: string;
  /** Die eingebettete Rechnung als CII-XML, in lesbarer Form. */
  readonly cii: string;
  readonly summen: CiiSummen;
  /**
   * Die Summen, wie der Beleg selbst sie führt — aus derselben Nutzlast.
   *
   * Sie stehen NEBEN `summen`, damit die Probe sichtbar ist. Gleich müssen sie
   * sein; weichen sie ab, ist das keine Anzeigefrage, sondern ein Dokument,
   * das der Empfänger ablehnt.
   */
  readonly belegNettoCent: Cent;
  readonly belegSteuerCent: Cent;
  readonly belegBruttoCent: Cent;
  readonly belegZahlbetragCent: Cent;
  readonly festgeschriebenAm: string;
  readonly schemaVersion: string;
}

interface SnapshotZeile {
  readonly nummer: string | null;
  readonly schema_version: string | null;
  readonly nutzlast_bytes: Uint8Array | null;
}

/**
 * @throws KeinSnapshotFehler bei einem Entwurf oder einer Zeile ohne Snapshot.
 * @throws SnapshotZuAltFehler bei einer Nutzlast der Gestalt v1.
 * @throws XRechnungUnvollstaendigFehler wenn eine Pflichtangabe fehlt — die
 *   CII entsteht dann NICHT, und die Seite zeigt die ganze Liste.
 */
export async function zugferdVorschau(
  db: Abfrage, rechnungId: string,
): Promise<ZugferdVorschau | null> {
  const [zeile] = await db.abfrage<SnapshotZeile>(
    `select r.nummer, s.schema_version, s.nutzlast_bytes
       from rechnung r
       left join rechnung_snapshot s
         on s.mandant_id = r.mandant_id and s.rechnung_id = r.id
      where r.id = $1`,
    [rechnungId]);
  if (zeile === undefined) return null;
  if (zeile.nutzlast_bytes === null || zeile.schema_version === null) {
    throw new KeinSnapshotFehler(zeile.nummer);
  }

  const rechnung = leseNutzlast(zeile.nutzlast_bytes);
  return {
    nummer: rechnung.nummer,
    cii: baueCii(rechnung),
    summen: ciiSummen(rechnung),
    belegNettoCent: rechnung.nettoGesamtCent,
    belegSteuerCent: rechnung.steuerGesamtCent,
    belegBruttoCent: rechnung.bruttoCent,
    belegZahlbetragCent: rechnung.zahlbetragCent,
    festgeschriebenAm: rechnung.festgeschriebenAm,
    schemaVersion: zeile.schema_version,
  };
}

/**
 * Stimmt die Summenprobe?
 *
 * Vier Vergleiche und nicht einer: eine Abweichung im Netto hat eine andere
 * Ursache als eine im Zahlbetrag (dort steckt der Abschlagsabzug), und „die
 * Summen weichen ab" wäre die Auskunft, mit der niemand sucht.
 */
export interface Summenprobe {
  readonly ok: boolean;
  readonly abweichungen: readonly string[];
}

export function summenprobe(v: ZugferdVorschau): Summenprobe {
  const abweichungen: string[] = [];
  if (v.summen.netto !== v.belegNettoCent) abweichungen.push('Netto');
  if (v.summen.steuer !== v.belegSteuerCent) abweichungen.push('Umsatzsteuer');
  if (v.summen.brutto !== v.belegBruttoCent) abweichungen.push('Brutto');
  if (v.summen.zahlbetrag !== v.belegZahlbetragCent) abweichungen.push('Zahlbetrag');
  return { ok: abweichungen.length === 0, abweichungen };
}
