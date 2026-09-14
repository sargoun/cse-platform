import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { SchreibKontext } from '../../../kontext/index.js';
import type { Bucket, Speicher } from '../../../storage/adapter.js';
import { ladeHoch } from '../../dokument/upload.js';
import { legeBelegAn } from '../eingangsrechnung.js';
import type { ERechnungExtrakt } from './erechnung.js';
import { legeEingangsVorschlagAn, type VorschlagErgebnis } from './vorschlag.js';

/**
 * Eine gelesene E-Rechnung ABLEGEN — Datei, Dokument, Version, Beleg,
 * Vorschlag; in dieser Reihenfolge und in einer Transaktion (ACC-03, ACC-05).
 *
 * Der eine Weg fuer drei Aufrufer: die Hochladeroute, den Seed und die
 * Vorrichtung der Browsersuite. Vorher stand die Folge nur in der Route, und
 * ein Seed, der sie nachbaut, waere die zweite Fassung, die irgendwann eine
 * Spalte vergisst — `loeschsperre`, `aufbewahrung_bis` — und Belege
 * hinterlaesst, die es im Betrieb nie geben koennte.
 *
 * **Der Speicher zuerst, und ohne Speicher nichts.** `ladeHoch` legt die
 * Bytes ab, bevor eine Zeile entsteht; ein `SupabaseSpeicher` ohne
 * Zugangsdaten wirft `NichtVerbundenFehler`, und die Transaktion traegt dann
 * nichts. Ein Beleg zeigt auf eine Version samt SHA-256, und die Version auf
 * ein Objekt, das es gibt — sonst ist es kein Beleg, sondern eine Behauptung.
 *
 * `nachAblage` nennt dem Aufrufer das Objekt, sobald es liegt: scheitert
 * danach ein Insert, kann er es wieder entfernen (die Route tut das) — ein
 * Objekt ohne Zeile ist eine Waise, keine Datei.
 *
 * **Dieselben Bytes ein zweites Mal legen nichts nach.** Der Vorschlag ist
 * ueber `externe_ref = erechnung:<sha256>` wiederholbar (`vorschlag.ts`);
 * die Pruefung steht HIER vor dem Upload, damit ein zweiter Upload nicht
 * ein zweites Dokument und einen zweiten Beleg hinterlaesst, die auf
 * denselben Vorschlag zeigen. `neu: false`, und die Kennungen des ersten.
 */
export interface ERechnungAblegen {
  /** Der Name der hochgeladenen Datei (PDF oder XML). */
  readonly dateiname: string;
  /** Die Bytes, wie sie kamen — beim ZUGFeRD-PDF das PDF, nicht die XML. */
  readonly bytes: Uint8Array;
  readonly behaupteterTyp?: string;
  /** Die gelesene XML — beim PDF der Anhang. */
  readonly xml: string;
  /** Was der Posteingang als Quelle nennt, z. B. `rechnung.pdf › factur-x.xml`. */
  readonly quelleAnzeige: string;
  readonly extrakt: ERechnungExtrakt;
  /** Das Jahr, in dem der Beleg entstand (Aufbewahrungsfrist) — nicht aus der Uhr. */
  readonly entstehungsJahr: number;
  readonly nachAblage?: (ort: { readonly bucket: Bucket; readonly pfad: string }) => void;
}

export interface ERechnungAbgelegt {
  readonly dokumentId: string;
  readonly dokumentVersionId: string;
  readonly belegId: string;
  readonly sha256: string;
  readonly vorschlag: VorschlagErgebnis;
}

export async function legeERechnungAb(
  kontext: SchreibKontext, speicher: Speicher, e: ERechnungAblegen,
): Promise<ERechnungAbgelegt> {
  const sha256 = createHash('sha256').update(e.bytes).digest('hex');
  const [da] = await kontext.abfrage<{
    freigabe_id: string; unsichere: number; risiko: string; beleg_id: string;
    dokument_id: string; dokument_version_id: string;
  }>(
    `select f.id as freigabe_id, f.unsichere_felder_anzahl as unsichere, f.risiko::text as risiko,
            b.id as beleg_id, b.dokument_id, b.dokument_version_id
       from freigabe f
       join beleg b on b.id = f.bezug_id and b.mandant_id = f.mandant_id
      where f.externe_ref = $1 and f.mandant_id = $2::uuid and f.bezug_typ = 'beleg'`,
    [`erechnung:${sha256}`, kontext.aktiverMandantId]);
  if (da !== undefined) {
    return {
      dokumentId: da.dokument_id, dokumentVersionId: da.dokument_version_id, belegId: da.beleg_id,
      sha256,
      vorschlag: { freigabeId: da.freigabe_id, neu: false, unsichereFelder: da.unsichere, risiko: da.risiko },
    };
  }

  const nummer = e.extrakt.nutzlast.rechnungsnummer ?? 'ohne Nummer';
  const hoch = await ladeHoch({
    mandantId: kontext.aktiverMandantId,
    kategorie: 'buchhaltung',
    titel: `E-Rechnung ${nummer}`,
    dateiname: e.dateiname,
    daten: e.bytes,
    /* `exactOptionalPropertyTypes`: die Eigenschaft fehlt, statt `undefined`
       zu tragen — „nicht behauptet", nicht „als undefiniert behauptet". */
    ...(e.behaupteterTyp === undefined ? {} : { behaupteterTyp: e.behaupteterTyp }),
  }, speicher, e.entstehungsJahr);
  e.nachAblage?.({ bucket: hoch.bucket, pfad: hoch.objektSchluessel });

  await kontext.schreibe(
    `insert into dokument (id, mandant_id, kategorie, titel, mime_typ,
                           mime_verifiziert, groesse_bytes, bucket,
                           objekt_schluessel, exif_entfernt, aufbewahrung_bis,
                           loeschsperre, erstellt_von)
     values ($1, $2, 'buchhaltung', $3, $4, true, $5, $6, $7, $8, $9::date, $10,
             app.aktueller_benutzer())`,
    [hoch.dokumentId, kontext.aktiverMandantId, `E-Rechnung ${nummer}`, hoch.mimeTyp,
      hoch.groesseBytes, hoch.bucket, hoch.objektSchluessel, hoch.exifEntfernt,
      hoch.aufbewahrungBis, hoch.loeschsperre]);
  const versionId = randomUUID();
  await kontext.schreibe(
    `insert into dokument_version (id, mandant_id, dokument_id, version,
                                   objekt_schluessel, sha256, groesse_bytes,
                                   mime_typ, erstellt_von)
     values ($1, $2, $3, 1, $4, $5, $6, $7, app.aktueller_benutzer())`,
    [versionId, kontext.aktiverMandantId, hoch.dokumentId, hoch.objektSchluessel,
      hoch.sha256, hoch.groesseBytes, hoch.mimeTyp]);
  const belegId = await legeBelegAn(kontext, {
    typ: 'eingangsrechnung', quelle: 'upload',
    dokumentId: hoch.dokumentId, dokumentVersionId: versionId,
    dateiSha256: hoch.sha256, belegdatum: e.extrakt.nutzlast.rechnungsdatum,
    betragBruttoCent: e.extrakt.nutzlast.bruttoCent,
  });
  const vorschlag = await legeEingangsVorschlagAn(kontext, {
    dokumentId: hoch.dokumentId, belegId, dateiname: e.quelleAnzeige, sha256: hoch.sha256,
    xml: e.xml,
  });
  return { dokumentId: hoch.dokumentId, dokumentVersionId: versionId, belegId,
    sha256: hoch.sha256, vorschlag };
}
