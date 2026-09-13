import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withTenant } from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { authorize } from '@/server/auth/authorize';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import {
  NichtVerbundenFehler, SIGNATUR_SEKUNDEN, SupabaseSpeicher, type Bucket,
} from '@/server/storage/adapter';

/**
 * `GET /api/buchhaltung/datev/[id]/datei` — die archivierte EXTF-Datei
 * (ACC-02, DOC-03).
 *
 * Dieselbe Vorrichtung wie beim Buchungsbeleg (D-436): eine Weiterleitung auf
 * eine signierte, nach fünfzehn Minuten ablaufende Adresse, nie ein
 * Durchreichen der Bytes. Wäre diese Route die Adresse, bliebe jeder
 * weitergegebene Link gültig, solange die Sitzung besteht — und in dieser
 * Datei stehen sämtliche Buchungen eines Monats.
 *
 * **`buchhaltung.exportieren` und nicht `buchhaltung.lesen`**, anders als
 * beim einzelnen Beleg: wer das Hauptbuch liest, bekommt damit nicht die
 * Datei in die Hand, die an das Steuerbüro geht.
 */
export const dynamic = 'force-dynamic';

interface OrtRoh {
  readonly bucket: string;
  readonly objekt_schluessel: string;
  readonly geloescht_am: string | null;
}

export async function GET(
  _anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  let ort: OrtRoh;
  try {
    ort = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'buchhaltung.exportieren' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const [zeile] = await kontext.abfrage<OrtRoh>(
          `select d.bucket, d.objekt_schluessel, d.geloescht_am::text as geloescht_am
             from datev_export e
             join dokument d on d.id = e.dokument_id and d.mandant_id = e.mandant_id
            where e.id = $1`,
          [id]);
        if (zeile === undefined) throw new NichtGefundenFehler();
        return zeile;
      }))) as OrtRoh;
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }

  if (ort.geloescht_am !== null) {
    return NextResponse.json({ fehler: 'geloescht' }, { status: 410 });
  }

  const speicher = new SupabaseSpeicher();
  try {
    const url = await speicher.signierteUrl(
      ort.bucket as Bucket, ort.objekt_schluessel, SIGNATUR_SEKUNDEN);
    return NextResponse.redirect(url, 302);
  } catch (fehler) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json(
        {
          fehler: 'speicher_nicht_verbunden',
          text: 'Der Objektspeicher ist nicht verbunden. Der Stapel ist '
            + 'verzeichnet, die Archivkopie lässt sich von hier nicht ausliefern.',
        },
        { status: 409 });
    }
    throw fehler;
  }
}
