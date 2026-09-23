import type postgres from 'postgres';
import { erwarteterUrsprung } from '@/server/auth/ursprung';
import { NextResponse, type NextRequest } from 'next/server';
import { istUuid } from '@/lib/uuid';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withTenant } from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { authorize } from '@/server/auth/authorize';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { NichtVerbundenFehler, SIGNATUR_SEKUNDEN, type Bucket } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';

/**
 * `GET /api/buchhaltung/buchungen/[id]/beleg` — das archivierte Dokument zu
 * einer Buchungszeile (ACC-03, DOC-03, DOC-04).
 *
 * **Eine Weiterleitung, keine Datei.** Die Route liest nie Bytes und reicht
 * nie welche durch; sie stellt eine signierte Adresse aus und leitet dorthin
 * um. Der Unterschied ist nicht Bequemlichkeit: würde sie den Inhalt
 * durchreichen, wäre SIE die Adresse, unter der das Dokument liegt — dauerhaft,
 * ohne Ablauf, und jeder weitergegebene Link bliebe gültig, solange die
 * Sitzung besteht. Die Signatur läuft nach `SIGNATUR_SEKUNDEN` ab.
 *
 * **404 und nicht 403 für eine fremde Zeile** (AUT-06, SEC-A3): die Abfrage
 * läuft im Mandantenkontext, eine fremde Zeile liefert nichts, und „nicht da"
 * ist byte-gleich mit „nicht erlaubt".
 *
 * **Ohne verbundenen Speicher: 409 mit Klartext, nie eine erfundene URL.**
 * Ein Link, der ins Leere zeigt, sieht aus wie ein kaputtes Dokument; die
 * ehrliche Antwort ist, dass der Speicher nicht angeschlossen ist.
 */
export const dynamic = 'force-dynamic';

interface OrtRoh {
  readonly bucket: string;
  readonly objekt_schluessel: string;
  readonly geloescht_am: string | null;
}

export async function GET(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!istUuid(id)) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
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
          { recht: 'buchhaltung.lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const [zeile] = await kontext.abfrage<OrtRoh>(
          `select d.bucket, d.objekt_schluessel, d.geloescht_am::text as geloescht_am
             from buchungssatz bs
             join beleg b    on b.id = bs.beleg_id   and b.mandant_id = bs.mandant_id
             join dokument d on d.id = b.dokument_id and d.mandant_id = b.mandant_id
            where bs.id = $1`,
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

  /*
   * Ein weich geloeschtes Dokument wird nicht ausgeliefert. Es KANN hier
   * heute nicht stehen — `fin.dokument_haengt_an_buchung` (0132) weist das
   * Loeschen ab, solange eine Buchung sich beruft. Die Pruefung bleibt
   * trotzdem: sie kostet nichts, und sie ist die Stelle, an der ein spaeter
   * gelockerter Riegel auffaellt, statt still ein Dokument herauszugeben,
   * das jemand fuer entfernt haelt.
   */
  if (ort.geloescht_am !== null) {
    return NextResponse.json({ fehler: 'geloescht' }, { status: 410 });
  }

  const speicher = waehleSpeicher();
  try {
    const url = await speicher.signierteUrl(
      ort.bucket as Bucket, ort.objekt_schluessel, SIGNATUR_SEKUNDEN);
    /* Eine relative Adresse (Vorführspeicher, V-131) wird gegen den eigenen
       Ursprung aufgelöst; eine absolute (Supabase) bleibt, wie sie ist. */
    return NextResponse.redirect(new URL(url, erwarteterUrsprung(anfrage)), 302);
  } catch (fehler) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json(
        {
          fehler: 'speicher_nicht_verbunden',
          text: 'Der Objektspeicher ist nicht verbunden. Das Dokument liegt, '
            + 'aber es lässt sich von hier nicht ausliefern.',
        },
        { status: 409 });
    }
    throw fehler;
  }
}
