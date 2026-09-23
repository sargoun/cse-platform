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
 * die Antwort darf nichts ausführen: `nosniff`, eine CSP ohne Skript, und
 * `sandbox`. Eine hochgeladene Datei wird angezeigt, nicht gestartet.
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
       * Für ein PDF nur `frame-ancestors`: der PDF-Betrachter des Browsers
       * ist ein eingebettetes Modul, und `sandbox` oder ein `default-src
       * 'none'` (das `object-src` mitsperrt) liessen ihn nicht starten — ein
       * Beleg, der sich nicht öffnen lässt, ist keiner. Das ist dieselbe
       * Auslieferung wie bei einer signierten Supabase-Adresse.
       */
      'content-security-policy': mime === 'application/pdf'
        ? "frame-ancestors 'none'"
        : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
    },
  });
}
