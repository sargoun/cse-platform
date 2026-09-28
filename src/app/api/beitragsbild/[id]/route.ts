import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler, SIGNATUR_SEKUNDEN, type Bucket } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import {
  eigenesBeitragsbild, oeffentlichesBeitragsbild, type MedienOrt,
} from '@/server/services/social/beitragsbild';

/**
 * `GET /api/beitragsbild/[id]` — ein Beitragsbild ausliefern (SOC-02, SOC-05,
 * DOC-03, V-225, D-719).
 *
 * **Der Behälter ist privat; diese Route ist die Tür.** Sie gibt keine
 * Bytes heraus, sondern leitet auf eine SIGNIERTE Adresse, die nach
 * `SIGNATUR_SEKUNDEN` verfällt (Stack: „signed URLs only") — und nur, wenn
 * das Bild an einem veröffentlichten, nicht zurückgezogenen Beitrag hängt
 * oder die anfragende Sitzung zu dieser Gesellschaft gehört und Beiträge
 * lesen darf (`social.lesen`, Vorschau am Entwurf). Sonst 404, nie 403
 * (AUT-06).
 *
 * Die Weiterleitung selbst wird nicht zwischengespeichert: sie zeigt auf eine
 * Adresse, die in einer Viertelstunde nicht mehr gilt.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function nichtGefunden(): NextResponse {
  return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
}

async function oeffentlich(id: string): Promise<MedienOrt | null> {
  try {
    return await oeffentlichLesen((k) => oeffentlichesBeitragsbild(k, id));
  } catch {
    return null;
  }
}

export async function GET(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return nichtGefunden();

  let ort = await oeffentlich(id);
  if (ort === null) {
    const sitzung = await aktuelleSitzung();
    if (sitzung !== null && sitzung.aktiverMandantId !== null) {
      ort = await (db().begin(async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, (k) => eigenesBeitragsbild(k, id))) as Promise<MedienOrt | null>);
    }
  }
  if (ort === null) return nichtGefunden();

  let url: string;
  try {
    url = await waehleSpeicher().signierteUrl(ort.bucket as Bucket, ort.schluessel,
      SIGNATUR_SEKUNDEN);
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json({ fehler: 'speicher_nicht_verbunden' }, { status: 503 });
    }
    return nichtGefunden();
  }
  const antwort = NextResponse.redirect(new URL(url, erwarteterUrsprung(anfrage)), 303);
  antwort.headers.set('cache-control', 'private, no-store');
  return antwort;
}
