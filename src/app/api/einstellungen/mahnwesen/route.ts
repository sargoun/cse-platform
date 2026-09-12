import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import {
  StufenFehler, bestaetigeStufe, type Folgeaktion, type Zinsberechnung,
} from '@/server/services/finanz/mahnung/stufen';

/**
 * `POST /api/einstellungen/mahnwesen` — eine Mahnstufe bestätigen (FIN-15,
 * O-19).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten. Die Ablösung
 * der vorherigen Fassung entscheidet nicht er, sondern `bestaetigeStufe` —
 * und die Überlappung weist die Datenbank ab.
 *
 * `mahnung.schreiben` und nicht `mahnung.freigeben`: hier wird die REGEL
 * gesetzt, nicht ein Brief freigegeben. Wer Stufen pflegt, lässt damit noch
 * nichts hinausgehen.
 */
export const dynamic = 'force-dynamic';

const ZINSARTEN: ReadonlySet<string> = new Set(
  ['keine', 'gesetzlich_b2b', 'gesetzlich_b2c', 'vertraglich']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(`/portal/${slug}/einstellungen/mahnwesen`, anfrage.nextUrl.origin);
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const stufe = Number.parseInt(text('stufe') ?? '', 10);
  const tage = Number.parseInt(text('tage') ?? '', 10);
  const bezeichnung = text('bezeichnung');
  const gebuehr = text('gebuehr');
  const zinsart = text('zinsberechnung') ?? 'keine';
  const gueltigAb = text('gueltigAb');
  const aufschlag = text('aufschlag');

  if (bezeichnung === null || gebuehr === null || gueltigAb === null
      || !Number.isInteger(stufe) || stufe < 1
      || !Number.isInteger(tage) || tage < 0
      || !ZINSARTEN.has(zinsart)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    const gebuehrCent = parseGeld(gebuehr);
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'mahnung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await bestaetigeStufe(kontext, {
          stufe, bezeichnung, tageNachFaelligkeit: tage, gebuehrCent,
          zinsberechnung: zinsart as Zinsberechnung,
          ...(aufschlag === null
            ? {}
            : { zinsAufschlagBp: Number.parseInt(aufschlag, 10) }),
          folgeaktion: (text('folgeaktion') ?? 'keine') as Folgeaktion,
          gueltigAb,
        });
        return zurueck(anfrage,
          `Stufe ${String(stufe)} ist ab ${gueltigAb} bestätigt. Der Mahnlauf `
          + 'schlägt sie ab jetzt vor — versendet wird weiterhin nichts ohne Freigabe.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof GeldFehler) {
      return NextResponse.json(
        { fehler: 'betrag_unlesbar', meldung: fehler.message }, { status: 422 });
    }
    if (fehler instanceof StufenFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message },
        { status: fehler.grund === 'nicht_gefunden' ? 404 : 422 });
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
