import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { istUuid } from '@/lib/uuid';
import {
  NichtVerbundenFehler, SIGNATUR_SEKUNDEN, SupabaseSpeicher, type Bucket,
} from '@/server/storage/adapter';

/**
 * `GET /api/mein/dokumente/[id]/datei` — der Abruf einer freigegebenen Datei
 * aus dem Mitarbeiterportal (EMP-11, DOC-03, DOC-04, SEC-A6, Art. 15 DSGVO,
 * K-02, K-18, AUT-06).
 *
 * ===========================================================================
 * Warum diese Route neben `api/dokumente/[id]/datei` steht
 * ===========================================================================
 *
 * Die interne Route prueft `dokument.lesen` im aktiven Mandanten. Die Rolle
 * `mitarbeiter` haelt dieses Recht nicht — und soll es nicht halten: sie soll
 * nicht die Rechnungsablage sehen, sondern ihre freigegebene Unterlage. Der
 * Zugang der Kraft ist deshalb kein Recht, sondern ein Subjektpraedikat
 * (`dokument.t_person`, 0009: freigegeben, nicht geloescht, eigene
 * Gesellschaft). Diese Route ist der Weg dazu, und sie traegt genau deshalb
 * **kein** `authorize` — „nur der Betroffene" laesst sich als Recht nicht
 * ausdruecken (K-19, 04-SEITENKARTE §7). Bewacht ist sie durch die Sitzung,
 * den serverseitig abgeleiteten Mandanten (K-02) und die Policies.
 *
 * ===========================================================================
 * Der Weg: PER -> M1, und der Mandant kommt aus dem DOKUMENT
 * ===========================================================================
 *
 *  1. **Personen-Scope**: die Zeile wird dort aufgeloest, wo `t_person` die
 *     Abgrenzung traegt. Eine fremde oder nicht freigegebene Kennung liefert
 *     null Zeilen — und das ist 404, nie 403 (AUT-06): dass es das Dokument in
 *     einer anderen Gesellschaft gibt, ist selbst eine Auskunft.
 *  2. **Der Mandant kommt aus der gelesenen Zeile**, nie aus der Anfrage
 *     (K-02, Invariante 3). Ein Feld dafuer gibt es hier nicht.
 *  3. **`withTenant` mit `portal: 'mitarbeiter'`**: die K-04-Decke
 *     (`p_ma_ceiling`) bleibt damit stehen. Wer hier `intern` setzte, hoebe
 *     sie fuer diese Anfrage auf.
 *  4. **Die Spur VOR der Adresse**, in derselben Transaktion (DOC-03, SEC-A6):
 *     `dokument_zugriff` ueber `t_selbst_m1` (0361). Scheitert das Signieren
 *     danach, rollt der Vermerk mit zurueck — ein vermerkter Abruf ohne Datei
 *     waere die falsche Luege.
 *
 * **Ohne verbundenen Speicher gibt es keine Adresse**, und die Route sagt das
 * (503). Kein oeffentlicher Pfad als Ausweichweg, keine erfundene Adresse
 * (CLAUDE.md, „No fake integrations").
 *
 * ===========================================================================
 * Warum hier `Sec-Fetch-Site` steht und nicht `istGleicherUrsprung`
 * ===========================================================================
 *
 * Das Ursprungstor verlangt einen `Origin`-Kopf. Ein Browser schickt ihn bei
 * einer normalen Verweisnavigation NICHT — die Route waere damit fuer genau
 * die Bedienung geschlossen, fuer die es sie gibt: ein Link auf einem
 * Diensttelefon, ohne JavaScript.
 *
 * Was hier trotzdem abzuwehren ist, ist klein und real: ein fremdes
 * `<img src="…/datei">` erzeugte eine PROTOKOLLZEILE, die niemand ausgeloest
 * hat. Die Datei bekaeme die fremde Seite dadurch nicht zu lesen (die
 * signierte Adresse landet im Browser des Opfers, nicht im Skript des
 * Angreifers), aber eine Auskunft nach Art. 15 mit erfundenen Abrufen ist
 * wertlos.
 *
 * `Sec-Fetch-Site: cross-site` ist genau dieser Fall, und moderne Browser
 * setzen den Kopf von sich aus. **Fehlt er, geht die Anfrage durch** — ein
 * altes Telefon ohne diesen Kopf ist die Zielgruppe dieser Seite und kein
 * Angreifer. Fail-open ist hier richtig, weil das Schutzgut die
 * Protokollqualitaet ist und nicht der Inhalt: die Sitzung und die Policies
 * entscheiden weiter darueber, WER etwas bekommt.
 */
export const dynamic = 'force-dynamic';

interface OrtRoh {
  readonly mandant_id: string;
  readonly bucket: string;
  readonly objekt_schluessel: string;
}

/** Eine eingebettete Anfrage von einer fremden Seite — sonst `false`. */
function fremdeEinbettung(anfrage: NextRequest): boolean {
  return anfrage.headers.get('sec-fetch-site') === 'cross-site';
}

export async function GET(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!istUuid(id)) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  if (fremdeEinbettung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  /*
   * Ein Konto ohne Person hat keine Beschaeftigung, also auch keine
   * freigegebene Unterlage. 404, nicht 403 (AUT-06).
   */
  if (sitzung.personId === null || sitzung.personId === '') {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const speicher = new SupabaseSpeicher();
  try {
    const ort = await (db().begin(async (tx: postgres.TransactionSql) => {
      const zeile = await withPersonScope(tx, sitzung, async (kontext) => {
        const [d] = await kontext.abfrage<OrtRoh>(
          `select d.mandant_id, d.bucket, d.objekt_schluessel
             from dokument d
            where d.id = $1::uuid`,
          [id],
        );
        return d ?? null;
      });
      if (zeile === null) return null;

      /*
       * Ohne verbundenen Speicher wird auch nichts vermerkt: die Spur sagt
       * „jemand hat diese Datei geholt", und geholt hat sie dann niemand.
       */
      if (!speicher.verbunden) throw new NichtVerbundenFehler('Supabase Storage');

      const imMandanten: Sitzung = {
        ...sitzung,
        ansicht: 'mandant',
        aktiverMandantId: zeile.mandant_id,
        // `mitarbeiter` BLEIBT — die K-04-Decke auf `dokument` haengt daran.
        portal: 'mitarbeiter',
      };
      await withTenant(tx, imMandanten, async (kontext) => {
        await kontext.schreibe(
          `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
           values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
          [zeile.mandant_id, id],
        );
      });
      return zeile;
    }) as Promise<OrtRoh | null>);

    if (ort === null) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });

    const url = await speicher.signierteUrl(
      ort.bucket as Bucket, ort.objekt_schluessel, SIGNATUR_SEKUNDEN);
    return NextResponse.redirect(url, 303);
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json(
        { fehler: 'speicher_nicht_verbunden',
          meldung: 'Der Dateispeicher ist nicht verbunden — es gibt keine Adresse, die '
            + 'ausgegeben werden könnte.' },
        { status: 503 });
    }
    throw fehler;
  }
}
