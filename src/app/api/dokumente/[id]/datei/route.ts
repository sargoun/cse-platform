import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withTenant } from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { authorize } from '@/server/auth/authorize';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { istUuid } from '@/lib/uuid';
import {
  NichtVerbundenFehler, SIGNATUR_SEKUNDEN, SupabaseSpeicher, type Bucket,
} from '@/server/storage/adapter';

/**
 * `GET /api/dokumente/[id]/datei` — der Abruf einer Datei aus der Ablage
 * (DOC-03, SEC-A6, D-478).
 *
 * **Es gibt keine oeffentliche Adresse.** Die Route prueft Sitzung und
 * `dokument.lesen` im aktiven Mandanten, VERMERKT den Abruf in der
 * `dokument_zugriff`-Spur des Dokuments — ein Abruf ohne Spur waere fuer
 * die Datenschutzauskunft unsichtbar — und leitet dann auf eine signierte
 * Adresse weiter, die nach `SIGNATUR_SEKUNDEN` verfaellt. Ohne verbundenen
 * Speicher gibt es keine Adresse, und die Route sagt das (503), statt eine
 * leere zu erfinden.
 *
 * Bis PR 12 versprach das Dokumentblatt diesen Abruf und bot ihn nicht
 * (Copilot-Befund).
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
  if (!istUuid(id)) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const speicher = new SupabaseSpeicher();
  try {
    const ort = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'dokument.lesen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [zeile] = await kontext.abfrage<OrtRoh>(
          `select d.bucket, d.objekt_schluessel, d.geloescht_am::text as geloescht_am
             from dokument d
            where d.id = $1::uuid and d.mandant_id = $2::uuid`,
          [id, kontext.aktiverMandantId]);
        if (zeile === undefined || zeile.geloescht_am !== null) throw new NichtGefundenFehler();
        if (!speicher.verbunden) throw new NichtVerbundenFehler('Supabase Storage');
        /*
         * Die Spur — vor der Adresse, in derselben Transaktion: kein Abruf
         * ohne Vermerk. Faellt die Signatur danach, rollt der Vermerk mit
         * zurueck; ein vermerkter Abruf ohne Datei waere die falsche Luege.
         */
        await kontext.schreibe(
          `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
           values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
          [kontext.aktiverMandantId, id]);
        return zeile;
      }))) as OrtRoh;

    const url = await speicher.signierteUrl(
      ort.bucket as Bucket, ort.objekt_schluessel, SIGNATUR_SEKUNDEN);
    return NextResponse.redirect(url, 303);
  } catch (fehler: unknown) {
    if (fehler instanceof NichtVerbundenFehler) {
      return NextResponse.json(
        { fehler: 'speicher_nicht_verbunden',
          meldung: 'Der Dateispeicher ist nicht verbunden — es gibt keine Adresse, die '
            + 'ausgegeben werden könnte (Einstellungen › Integrationen).' },
        { status: 503 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }
}
