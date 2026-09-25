import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { MimeFehler } from '@/server/storage/mime';
import { AblageFehler, FassungFehler, legeFassungAn } from '@/server/services/dokument/ablage';

/**
 * `POST /api/dokumente/[id]/version` — eine neue Fassung eines bestehenden
 * Dokuments ablegen (DOC-05, DOC-06, V-219, D-713).
 *
 * Die Adresse ist die aus `05-API-KARTE.md` (`POST /api/dokumente/[id]/version`).
 * Ein `multipart`-POST wie beim Ablegen (`api/dokumente/upload`): die
 * MIME-Prüfung findet an den BYTES statt, bevor irgendetwas im Bucket liegt.
 *
 * **Recht: `dokument.schreiben`** — wer ablegen darf, darf eine neue Fassung
 * ablegen. Die alte bleibt Zeile und Datei; überschrieben wird nichts.
 *
 * **Ein Formular bekommt seine Seite zurück** (D-599): Erfolg als
 * `?fassung=<n>`, eine Abweisung als `?vorgang=fassung&fehler=<grund>` über
 * das Feld `zurueck` (`internesZiel` lässt nur Pfade dieser Anwendung durch).
 * Ohne `zurueck` antwortet die Route als JSON.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert : '';
}

/** Der Grund einer Abweisung — ein Schlüssel für die Seite, nie ein Satz in der Adresse. */
function grundVon(fehler: unknown): string | null {
  if (fehler instanceof FassungFehler) return fehler.grund;
  if (fehler instanceof NichtVerbundenFehler) return 'speicher';
  if (fehler instanceof MimeFehler) return `datei_${fehler.grund}`;
  if (fehler instanceof AblageFehler) return 'datei_zu_gross';
  return null;
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (!UUID.test(id)) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });

  const daten = await anfrage.formData().catch(() => null);
  if (daten === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }
  const datei = daten.get('datei');
  const zurueck = feld(daten, 'zurueck');
  const speicher = waehleSpeicher();

  try {
    if (!(datei instanceof File) || datei.size === 0) {
      throw new FassungFehler('Es war keine Datei dabei.', 'leer');
    }
    const bytes = new Uint8Array(await datei.arrayBuffer());
    const { slug, version } = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(sitzung, { recht: 'dokument.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        /* Der Slug kommt aus der SITZUNG, nie aus dem Formular (Invariante 3). */
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        const ergebnis = await legeFassungAn(kontext, speicher, id, {
          dateiname: datei.name,
          daten: bytes,
          behaupteterTyp: datei.type,
        });
        return { slug: m?.slug ?? '', version: ergebnis.version };
      })) as Promise<{ slug: string; version: number }>);
    return NextResponse.redirect(
      internesZiel(`/portal/${slug}/dokumente/${id}?fassung=${String(version)}`, '/portal',
        anfrage),
      303);
  } catch (fehler: unknown) {
    const grund = grundVon(fehler);
    if (grund !== null) {
      if (zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        return NextResponse.redirect(
          internesZiel(`${zurueck}${trenner}fehler=${encodeURIComponent(grund)}`, '/portal',
            anfrage),
          303);
      }
      const status = grund === 'nicht_gefunden' ? 404
        : grund === 'kein_recht' ? 403
          : grund === 'speicher' ? 503 : grund.startsWith('datei_') || grund === 'leer' ? 400 : 409;
      return NextResponse.json({ fehler: grund }, { status });
    }
    const antwort = autorisierungsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
