import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { waehleSpeicher } from '@/server/storage/waehle';
import { MedienFehler, legeBeitragsbildAn } from '@/server/services/social/beitragsbild';
import { SocialFehler, setzeBeitragsbild } from '@/server/services/social/dienst';

/**
 * `POST /api/social/beitraege/[id]/bild` — einem ENTWURF ein Bild anhängen,
 * es ersetzen oder entfernen (SOC-02, V-225, D-719).
 *
 * Ein `multipart`-POST wie beim Ablegen eines Dokuments: der Typ wird an den
 * BYTES geprüft, bevor irgendetwas im Behälter liegt. Recht:
 * `social.schreiben` — dasselbe wie für Text und Kanäle des Entwurfs; nach
 * dem Vorlegen bindet die Freigabe an genau dieses Bild (`legeVor`).
 *
 * Ein Formular bekommt seine Seite zurück (D-599): Erfolg als `?bild=1`,
 * eine Abweisung als `?fehler=bild_<grund>`.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function feld(daten: FormData, name: string): string {
  const wert = daten.get(name);
  return typeof wert === 'string' ? wert : '';
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
  if (daten === null) return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  const entfernen = feld(daten, 'aktion') === 'entfernen';
  const datei = daten.get('datei');
  const speicher = waehleSpeicher();

  try {
    const slug = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(sitzung, { recht: 'social.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (entfernen) {
          await setzeBeitragsbild(kontext, id, null);
        } else {
          if (!(datei instanceof File) || datei.size === 0) {
            throw new MedienFehler('leer', 'Es war keine Datei dabei.');
          }
          const medienId = await legeBeitragsbildAn(kontext, speicher, {
            daten: new Uint8Array(await datei.arrayBuffer()),
            alt: feld(daten, 'alt'),
          });
          await setzeBeitragsbild(kontext, id, medienId);
        }
        return m?.slug ?? '';
      })) as Promise<string>);
    return NextResponse.redirect(
      internesZiel(`/portal/${slug}/social/posts/${id}?bild=${entfernen ? 'entfernt' : '1'}`,
        '/portal', anfrage), 303);
  } catch (fehler: unknown) {
    const grund = fehler instanceof MedienFehler ? `bild_${fehler.grund}`
      : fehler instanceof SocialFehler ? fehler.grund : null;
    if (grund !== null) {
      const zurueck = feld(daten, 'zurueck');
      if (zurueck !== '') {
        const trenner = zurueck.includes('?') ? '&' : '?';
        return NextResponse.redirect(
          internesZiel(`${zurueck}${trenner}fehler=${encodeURIComponent(grund)}`, '/portal',
            anfrage), 303);
      }
      return NextResponse.json({ fehler: grund }, {
        status: grund === 'bild_nicht_verbunden' ? 503 : grund === 'unbekannt' ? 404 : 409,
      });
    }
    const antwort = autorisierungsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
