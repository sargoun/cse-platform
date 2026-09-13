import 'server-only';

/**
 * Die EINE Stelle, an der aus einer Rechnungskennung eine XRechnung wird.
 *
 * Route und Portalseite rufen dieselbe Funktion. Zwei Wege zum selben
 * Dokument sind zwei Gelegenheiten, die Mandantengrenze oder den
 * Snapshot-Vorrang (K-12) an einer davon zu vergessen — und das ist genau der
 * Fehler, den niemand sieht: die Seite zeigt die richtige Rechnung, die
 * Adresse liefert eine andere.
 */
import { baueZugferdPdf } from '../zugferd/pdfa3.js';
import { baueUbl, type UblOptionen } from './index.js';
import { leseNutzlast } from './aus-snapshot.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class KeinSnapshotFehler extends Error {
  constructor(nummer: string | null) {
    super(
      nummer === null
        ? 'Diese Rechnung ist ein Entwurf: eine XRechnung entsteht erst bei der '
          + 'Festschreibung, weil sie die Nummer und den Zeitpunkt traegt.'
        : `Zu Rechnung ${nummer} gibt es keinen Snapshot. Ohne ihn entstuende `
          + 'die XRechnung aus den heutigen Stammdaten und nicht aus dem Beleg '
          + '(K-12) — das waere ein zweites Dokument zu derselben Nummer.',
    );
    this.name = 'KeinSnapshotFehler';
  }
}

interface SnapshotZeile {
  readonly nummer: string | null;
  readonly schema_version: string | null;
  readonly nutzlast_bytes: Uint8Array | null;
  readonly ist_pflicht: boolean;
}

/**
 * Die XRechnung zu einer festgeschriebenen Rechnung.
 *
 * Der Aufrufer bringt einen Mandantenkontext mit (`withTenant`); RLS besorgt
 * die Abgrenzung, und eine fremde Rechnung liefert null Zeilen — daraus wird
 * beim Aufrufer ein 404, nie ein 403 (AUT-06).
 *
 * @throws KeinSnapshotFehler bei einem Entwurf oder einer Zeile ohne Snapshot.
 * @throws SnapshotZuAltFehler bei einer Nutzlast der Gestalt v1.
 * @throws XRechnungUnvollstaendigFehler wenn eine Pflichtangabe fehlt.
 */
export async function ublZurRechnung(
  db: Abfrage, rechnungId: string,
): Promise<{ readonly xml: string; readonly nummer: string } | null> {
  const [zeile] = await db.abfrage<SnapshotZeile>(
    `select r.nummer, s.schema_version, s.nutzlast_bytes,
            (k.xrechnung_pflicht or k.ist_oeffentlicher_auftraggeber) as ist_pflicht
       from rechnung r
       join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
       left join rechnung_snapshot s on s.rechnung_id = r.id
      where r.id = $1`,
    [rechnungId],
  );
  if (zeile === undefined) return null;
  if (zeile.nutzlast_bytes === null || zeile.schema_version === null) {
    throw new KeinSnapshotFehler(zeile.nummer);
  }

  const rechnung = leseNutzlast(zeile.nutzlast_bytes);
  /**
   * `leitwegPflicht` steuert nur den WORTLAUT der Meldung, nicht die Strenge:
   * BR-DE-15 verlangt BT-10 in jeder XRechnung. Bei einem oeffentlichen
   * Auftraggeber heisst das Feld Leitweg-ID, und die Meldung sagt das — sonst
   * sucht jemand nach einer „Kaeuferreferenz", die in keiner Maske so heisst.
   */
  const optionen: UblOptionen = { leitwegPflicht: zeile.ist_pflicht };
  return { xml: baueUbl(rechnung, optionen), nummer: rechnung.nummer };
}

/**
 * Dasselbe für ZUGFeRD: die Rechnung als PDF/A-3 mit eingebetteter CII
 * (FIN-12, PR 53).
 *
 * **Aus demselben Snapshot wie die XRechnung** (K-12). Beide Formate lesen
 * dieselben Bytes; sie können deshalb gar nicht auseinanderlaufen, auch wenn
 * sich die Stammdaten längst geändert haben.
 *
 * `erzeugtAm` ist das FESTSCHREIBUNGSDATUM und nicht die Uhr: derselbe Beleg
 * ergibt dadurch bei jedem Abruf byte-gleich dasselbe PDF (Invariante 5,
 * K-11). Wer zweimal herunterlädt, bekommt zweimal dieselbe Datei — und ihr
 * SHA-256 taugt als Nachweis.
 */
export async function zugferdZurRechnung(
  db: Abfrage, rechnungId: string,
): Promise<{ readonly pdf: Uint8Array; readonly nummer: string } | null> {
  const [zeile] = await db.abfrage<SnapshotZeile>(
    `select r.nummer, s.schema_version, s.nutzlast_bytes,
            (k.xrechnung_pflicht or k.ist_oeffentlicher_auftraggeber) as ist_pflicht
       from rechnung r
       join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
       left join rechnung_snapshot s on s.rechnung_id = r.id
      where r.id = $1`,
    [rechnungId],
  );
  if (zeile === undefined) return null;
  if (zeile.nutzlast_bytes === null || zeile.schema_version === null) {
    throw new KeinSnapshotFehler(zeile.nummer);
  }

  const rechnung = leseNutzlast(zeile.nutzlast_bytes);
  const pdf = await baueZugferdPdf(rechnung, {
    erzeugtAm: new Date(rechnung.festgeschriebenAm),
  });
  return { pdf, nummer: rechnung.nummer };
}

/** Der Dateiname des PDF — dieselbe Regel wie beim XML-Dateinamen. */
export function pdfDateiname(nummer: string): string {
  return dateiname(nummer).replace(/\.xml$/u, '.pdf');
}

/**
 * Der Dateiname, unter dem das Dokument das Haus verlaesst.
 *
 * Aus der Rechnungsnummer, und alles ausser Buchstaben, Ziffern, Strich und
 * Unterstrich faellt weg. Eine Nummernmaske darf `/` enthalten (`2026/00017`
 * ist eine gaengige Form), und ein `/` im `Content-Disposition` ist ein
 * Pfadtrenner — der Browser legte die Datei dann irgendwo ab oder verwuerfe
 * den Namen ganz.
 */
export function dateiname(nummer: string): string {
  const sauber = nummer.replace(/[^A-Za-z0-9_-]/gu, '-').replace(/-+/gu, '-');
  return `xrechnung-${sauber === '' ? 'rechnung' : sauber}.xml`;
}
