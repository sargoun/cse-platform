import 'server-only';

/**
 * Das Exportpaket: jede Buchungszeile mit ihrer Datei (ACC-03 Abnahme (4),
 * DOC-04, PR 59).
 *
 * **Was hier entsteht, ist das Manifest — nicht die Datei.** Die
 * DATEV-EXTF-Zeilen schreibt PR 60; hier steht die Paarung, auf die sich
 * jener Schreiber und jede Betriebsprüfung berufen: welche Buchungszeile
 * gehört zu welchem archivierten Dokument, unter welchem Pfad liegt es, und
 * mit welchem SHA-256 lässt sich prüfen, dass es noch dasselbe ist.
 *
 * **Ein Eintrag je DATEI, nicht je Zeile.** Eine Rechnung erzeugt vier bis
 * sechs Buchungszeilen und genau ein PDF. Ein Manifest, das das PDF sechsmal
 * führt, behauptet sechs Belege — und die Zahl unter „Belege im Zeitraum"
 * wäre falsch, ohne dass es jemandem auffällt. Die Zeilen zeigen deshalb auf
 * den Dateieintrag, und der zählt, wie viele es sind.
 *
 * **Es entsteht nichts, solange eine Zeile ihren Beleg noch nicht hat.** Die
 * Sperre steht in der Datenbank (`app.export_sperre_pruefen`), nicht hier —
 * damit sie auch dann gilt, wenn jemand später einen zweiten Schreiber baut
 * und diese Datei nicht kennt.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface PaketZeile {
  readonly buchungssatzId: string;
  readonly buchungId: string;
  readonly belegdatum: string;
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly sollHaben: 'soll' | 'haben';
  readonly umsatzCent: bigint;
  readonly buchungstext: string | null;
  readonly belegfeld1: string | null;
  /** Der Pfad im Paket — `belege/<belegnummer>.pdf`. Nie NULL: die Sperre. */
  readonly dateiPfad: string;
  readonly sha256: string;
}

export interface PaketDatei {
  readonly belegId: string;
  readonly dokumentId: string;
  readonly pfad: string;
  readonly bucket: string;
  readonly objektSchluessel: string;
  readonly sha256: string;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  /** Wie viele Buchungszeilen sich auf diese Datei berufen. */
  readonly zeilen: number;
}

export interface Exportpaket {
  readonly mandantId: string;
  readonly von: string;
  readonly bis: string;
  readonly zeilen: readonly PaketZeile[];
  readonly dateien: readonly PaketDatei[];
}

interface ZeileRoh {
  readonly buchungssatz_id: string;
  readonly buchung_id: string;
  readonly belegdatum: string;
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly soll_haben: 'soll' | 'haben';
  readonly umsatz_cent: string;
  readonly buchungstext: string | null;
  readonly belegfeld1: string | null;
  readonly beleg_id: string;
  readonly dokument_id: string;
  readonly bucket: string;
  readonly objekt_schluessel: string;
  readonly datei_sha256: string;
  readonly mime_typ: string;
  readonly groesse_bytes: string;
  readonly belegnummer: string | null;
}

/**
 * Der Pfad einer Datei IM Paket.
 *
 * Aus der Belegnummer, und alles ausser Buchstaben, Ziffern, Strich und
 * Unterstrich fällt weg — dieselbe Regel wie beim Dateinamen des Versands
 * (`xrechnung/dienst.ts`), und aus demselben Grund: eine Nummernmaske darf
 * `/` enthalten, und ein `/` im Pfad eines Archivs legt die Datei woanders ab
 * als das Manifest behauptet. Ohne Nummer entscheidet die Belegkennung — sie
 * ist eindeutig und kollidiert nicht.
 */
export function paketPfad(belegnummer: string | null, belegId: string): string {
  const roh = belegnummer ?? belegId;
  const sauber = roh.replace(/[^A-Za-z0-9_-]/gu, '-').replace(/-+/gu, '-');
  return `belege/${sauber === '' ? belegId : sauber}.pdf`;
}

export async function exportPaket(
  db: Abfrage, mandantId: string, von: string, bis: string,
): Promise<Exportpaket> {
  /*
   * **Zuerst die Sperre, dann die Abfrage.** Umgekehrt stünde erst ein
   * halbes Paket im Speicher und danach die Absage — und der nächste, der
   * diese Funktion benutzt, gäbe das halbe Paket versehentlich weiter.
   */
  await db.abfrage(
    'select app.export_sperre_pruefen($1::uuid, $2::date, $3::date)',
    [mandantId, von, bis]);

  const roh = await db.abfrage<ZeileRoh>(
    `select bs.id as buchungssatz_id, bs.buchung_id,
            bs.belegdatum::text as belegdatum, bs.konto, bs.gegenkonto,
            bs.soll_haben::text as soll_haben, bs.umsatz_cent::text,
            bs.buchungstext, bs.belegfeld1,
            b.id as beleg_id, b.belegnummer, b.datei_sha256,
            d.id as dokument_id, d.bucket, d.objekt_schluessel, d.mime_typ,
            d.groesse_bytes::text
       from buchungssatz bs
       join beleg b    on b.id = bs.beleg_id   and b.mandant_id = bs.mandant_id
       join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
      where bs.mandant_id = $1
        and bs.belegdatum between $2::date and $3::date
      order by bs.belegdatum, bs.buchung_id, bs.soll_haben, bs.id`,
    [mandantId, von, bis]);

  const dateien = new Map<string, { eintrag: PaketDatei; zeilen: number }>();
  const zeilen: PaketZeile[] = [];

  for (const z of roh) {
    const pfad = paketPfad(z.belegnummer, z.beleg_id);
    const vorhanden = dateien.get(z.beleg_id);
    if (vorhanden === undefined) {
      dateien.set(z.beleg_id, {
        eintrag: {
          belegId: z.beleg_id,
          dokumentId: z.dokument_id,
          pfad,
          bucket: z.bucket,
          objektSchluessel: z.objekt_schluessel,
          sha256: z.datei_sha256,
          mimeTyp: z.mime_typ,
          groesseBytes: Number(z.groesse_bytes),
          zeilen: 0,
        },
        zeilen: 1,
      });
    } else {
      vorhanden.zeilen += 1;
    }

    zeilen.push({
      buchungssatzId: z.buchungssatz_id,
      buchungId: z.buchung_id,
      belegdatum: z.belegdatum,
      konto: z.konto,
      gegenkonto: z.gegenkonto,
      sollHaben: z.soll_haben,
      umsatzCent: BigInt(z.umsatz_cent),
      buchungstext: z.buchungstext,
      belegfeld1: z.belegfeld1,
      dateiPfad: pfad,
      sha256: z.datei_sha256,
    });
  }

  return {
    mandantId,
    von,
    bis,
    zeilen,
    dateien: [...dateien.values()].map((d) => ({ ...d.eintrag, zeilen: d.zeilen })),
  };
}
