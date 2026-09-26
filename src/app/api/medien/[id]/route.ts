import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { NichtVerbundenFehler } from '@/server/storage/adapter';
import { waehleSpeicher } from '@/server/storage/waehle';
import { MediumEntferntFehler, signierteMedienAdresse } from '@/server/services/zeit/medien';

/**
 * `GET /api/medien/[id]` — die eine Adresse, unter der eine Schichtaufnahme
 * erreichbar ist (TIM-10, DOC-03, SEC-A6).
 *
 * **Es gibt keinen öffentlichen Pfad.** Der Bucket ist privat, und diese Route
 * gibt eine SIGNIERTE Adresse mit 15 Minuten Gültigkeit zurück — nie die Datei
 * selbst, nie einen Bucket-Pfad, nie einen Ausweichweg, wenn das Signieren
 * scheitert. Ein frei lesbarer Bucket mit Aufnahmen von Arbeitsplätzen wäre ein
 * Datenschutzvorfall, kein Bequemlichkeitsgewinn.
 *
 * **Die Zeile wird durch die SITZUNG gelesen, nicht als Definer.** Damit prüft
 * die Datenbank dieselbe Bedingung noch einmal, die auch die Liste geprüft hat:
 * Mandant, Modulrecht, Mitarbeiterdecke, Kundendecke. Eine Storage-Policy
 * allein täte das nicht — sie kennt weder den aktiven Mandanten noch das
 * Modulrecht, und wer eine Objekt-id errät, bekäme die Datei (SEC-A6, DOC-04).
 *
 * Null Zeilen ergeben 404 und nie 403: ein 403 bestätigt, dass es die Zeile
 * gibt (AUT-06).
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const { id } = await kontextParam.params;

  try {
    const adresse = await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
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
          { recht: 'zeit.lesen', schreibend: false },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return signierteMedienAdresse(
          kontext, id, waehleSpeicher(), Math.floor(Date.now() / 1000),
        );
      })) as Awaited<ReturnType<typeof signierteMedienAdresse>>;

    if (adresse === null) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    return NextResponse.json({
      url: adresse.url,
      gueltig_bis: adresse.gueltigBis,
      mime_typ: adresse.mimeTyp,
    });
  } catch (fehler) {
    if (fehler instanceof MediumEntferntFehler) {
      return NextResponse.json({ fehler: fehler.code, meldung: fehler.message },
        { status: fehler.status });
    }
    if (fehler instanceof NichtVerbundenFehler) {
      // Nicht verbunden heisst nicht verbunden. Kein oeffentlicher Pfad als
      // Ausweichweg, keine erfundene Adresse (CLAUDE.md).
      return NextResponse.json(
        { fehler: fehler.code, meldung: 'Der Medienspeicher ist nicht verbunden.' },
        { status: fehler.status },
      );
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
