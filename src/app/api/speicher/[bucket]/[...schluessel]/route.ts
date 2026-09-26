import { NextResponse, type NextRequest } from 'next/server';
import { BUCKETS, type Bucket } from '@/server/storage/adapter';
import { erkenneMime } from '@/server/storage/mime';
import { OrdnerSchluesselFehler, OrdnerSpeicher } from '@/server/storage/ordner';
import { waehleSpeicher } from '@/server/storage/waehle';

/**
 * `GET /api/speicher/[bucket]/[...schluessel]` — die signierte Auslieferung
 * des Vorführspeichers (V-131, D-623, DOC-03, SEC-A6).
 *
 * **Offen, aber nicht frei.** Die Route verlangt keine Sitzung — genau wie
 * eine signierte Supabase-Adresse keine verlangt: wer sie hat, hat sie von
 * einer Route bekommen, die Sitzung, Recht und Mandant geprüft und den Abruf
 * vermerkt hat. Die Route selbst prüft, was die Adresse trägt: Ablauf und
 * HMAC. Ohne beides: 403. Ist kein Vorführordner aktiv — also in jedem
 * Deployment —, gibt es die Route nicht: 404.
 *
 * **Der Typ kommt aus dem Inhalt**, nie aus dem Namen (`erkenneMime`), und
 * die Antwort traegt `nosniff`; was nicht angezeigt werden kann, kommt als
 * Anhang. Eine hochgeladene Datei wird angezeigt, nicht gestartet.
 */
export const dynamic = 'force-dynamic';

const ANZEIGBAR = /^(?:image\/(?:jpeg|png|gif|webp|tiff)|application\/pdf|video\/(?:mp4|quicktime))$/u;

function nichtGefunden(): NextResponse {
  return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
}

export async function GET(
  anfrage: NextRequest,
  { params }: { params: Promise<{ bucket: string; schluessel: string[] }> },
): Promise<NextResponse> {
  const ablage = waehleSpeicher();
  if (!(ablage instanceof OrdnerSpeicher)) return nichtGefunden();

  const { bucket, schluessel } = await params;
  if (!(BUCKETS as readonly string[]).includes(bucket)) return nichtGefunden();
  const pfad = schluessel.join('/');
  const ablauf = Number(anfrage.nextUrl.searchParams.get('ablauf') ?? '');
  const sig = anfrage.nextUrl.searchParams.get('sig') ?? '';

  /*
   * Der Schlüssel ZUERST, dann die Signatur. Ein Pfad, der aus dem Ordner
   * führt, ist keine Adresse mit falscher Unterschrift, sondern gar keine —
   * 404 und nicht 403, sonst sagte die Antwort, dass der Versuch „fast"
   * getroffen hat.
   */
  try {
    ablage.ort(bucket as Bucket, pfad);
  } catch (fehler: unknown) {
    if (fehler instanceof OrdnerSchluesselFehler) return nichtGefunden();
    throw fehler;
  }
  if (!ablage.pruefe(bucket as Bucket, pfad, ablauf, sig)) {
    return NextResponse.json({ fehler: 'signatur_ungueltig_oder_abgelaufen' }, { status: 403 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await ablage.hole(bucket as Bucket, pfad);
  } catch {
    return nichtGefunden();
  }

  const mime = erkenneMime(bytes) ?? 'application/octet-stream';
  return new NextResponse(new Uint8Array(bytes).buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'content-type': mime,
      'content-length': String(bytes.byteLength),
      'content-disposition': ANZEIGBAR.test(mime) ? 'inline' : 'attachment',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      /*
       * Keine eigene Content-Security-Policy: die allgemeine Regel aus
       * `next.config.ts` (`frame-ancestors 'none'`) ueberschreibt, was eine
       * Route hier setzt — gefunden in der Live-Pruefung (V-100). Was dieser
       * Behaelter ausliefert, fuehrt ohnehin nichts aus: PDF, Rasterbilder,
       * Video; XML und Office-Dateien kommen als Anhang. Ein SVG nimmt die
       * Ablage gar nicht erst an (`ERLAUBTE_MIME`).
       */
    },
  });
}
