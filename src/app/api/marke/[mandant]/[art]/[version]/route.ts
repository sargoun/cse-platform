import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  MARKE_BUCKET, eigenesMarkenbild, istMarkenbildArt, markenbildAdresse,
  oeffentlichesMarkenbild, typAusSchluessel, type Markenbild,
} from '@/server/services/mandant/markenbild';

/**
 * `GET /api/marke/[mandant]/[art]/[version]` — ein Logo, Avatar oder
 * Titelbild ausliefern (V-100, D-628, PUB-09, PUB-14, PRO-01).
 *
 * **Der Behälter ist privat; diese Route ist die Tür, und sie hat zwei
 * Schlösser.**
 *
 *  1. Die Identität ist VERÖFFENTLICHT (`oeffentlich_sichtbar`) — dann ist
 *     das Bild Teil der Website und darf von jedem geladen und von jedem
 *     Zwischenspeicher gehalten werden.
 *  2. Oder der Anfragende ist in GENAU dieser Gesellschaft angemeldet — die
 *     Vorschau in der Verwaltung, bevor etwas veröffentlicht ist. Dann
 *     `private, no-store`.
 *
 * Sonst 404 — nie 403: ein 403 sagte, dass es dort ein Bild gibt (AUT-06).
 *
 * **Die Version im Pfad** macht die Adresse unveränderlich: ein neues Logo
 * hat eine neue. Passt sie nicht mehr zum aktuellen Bild, kommt das aktuelle
 * mit kurzer Haltezeit — eine alte Seite im Zwischenspeicher zeigt dann das
 * neue Logo statt eines Lochs.
 *
 * **Der Typ kommt aus dem Schlüssel**, den nur `setzeMarkenbild` bildet und
 * den `mi_bildpfad_eigen` (0393) auf `svg|png|jpg` festlegt — also aus dem
 * Inhalt, den der Dienst beim Hochladen geprüft hat. Jede Antwort hier
 * bekommt eine CSP ohne jede Skriptquelle und mit `sandbox`
 * (`MARKENBILD_KOEPFE` in `next.config.ts`): auch wer die Adresse eines SVG
 * direkt öffnet, bekommt ein Bild und kein Dokument.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function nichtGefunden(): NextResponse {
  return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
}

/** Die veröffentlichte Fassung — oder `null`, auch wenn kein Renderer eingerichtet ist. */
async function oeffentlich(mandant: string, art: Parameters<typeof oeffentlichesMarkenbild>[2]) {
  try {
    return await oeffentlichLesen((kontext) => oeffentlichesMarkenbild(kontext, mandant, art));
  } catch {
    return null;
  }
}

export async function GET(
  _anfrage: NextRequest,
  { params }: { params: Promise<{ mandant: string; art: string; version: string }> },
): Promise<NextResponse> {
  const { mandant, art, version } = await params;
  if (!UUID.test(mandant) || !istMarkenbildArt(art)) return nichtGefunden();

  let bild: Markenbild | null = await oeffentlich(mandant, art);
  const istOeffentlich = bild !== null;

  if (bild === null) {
    const sitzung = await aktuelleSitzung();
    if (sitzung !== null && sitzung.aktiverMandantId === mandant) {
      bild = await (db().begin(async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, (kontext) => eigenesMarkenbild(kontext, mandant, art)),
      ) as Promise<Markenbild | null>);
    }
  }
  if (bild === null) return nichtGefunden();

  let bytes: Uint8Array;
  try {
    bytes = await waehleSpeicher().hole(MARKE_BUCKET, bild.pfad);
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json({ fehler: 'speicher_nicht_verbunden' }, { status: 503 });
    }
    return nichtGefunden();
  }

  const aktuell = markenbildAdresse(mandant, art, bild.pfad).endsWith(`/${version}`);
  const typ = typAusSchluessel(bild.pfad);
  return new NextResponse(new Uint8Array(bytes).buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'content-type': typ,
      'content-length': String(bytes.byteLength),
      'content-disposition': 'inline',
      'cache-control': !istOeffentlich
        ? 'private, no-store'
        : aktuell ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      /*
       * Die Content-Security-Policy mit `sandbox` steht NICHT hier: die
       * allgemeine Regel aus `next.config.ts` ueberschrieb sie (gefunden in
       * der Live-Pruefung). Sie kommt aus `MARKENBILD_KOEPFE` ueber eine
       * zweite Regel fuer genau diesen Pfad.
       */
    },
  });
}
