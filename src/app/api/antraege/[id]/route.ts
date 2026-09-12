import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { entscheideAntrag } from '@/server/services/abwesenheit/antrag';

/**
 * `POST /api/antraege/[id]` — über einen Antrag entscheiden (EMP-10, NOT-01).
 *
 * **POST, obwohl die API-Karte PATCH führt.** Ein HTML-Formular kennt GET und
 * POST und sonst nichts; eine PATCH-only-Route wäre ohne JavaScript nicht
 * bedienbar, und der Genehmigungseingang gehört zu den Bildschirmen, die auf
 * einem alten Diensttelefon in einem Treppenhaus funktionieren müssen. Die
 * Semantik bleibt dieselbe: ein Antrag, eine Entscheidung.
 *
 * **Die Entscheidung schreibt der DIENST**, samt Abwesenheit und gerechneten
 * Tagen. Diese Datei autorisiert, ruft und übersetzt Fehler in Antworten.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const roh = daten.get('entscheidung');
  if (roh !== 'genehmigt' && roh !== 'abgelehnt') {
    return NextResponse.json({ fehler: 'unbekannte_entscheidung' }, { status: 400 });
  }
  const kommentar = typeof daten.get('kommentar') === 'string'
    ? (daten.get('kommentar') as string) : '';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'zeit.antrag_entscheiden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await entscheideAntrag(kontext, {
          antragId: id, entscheidung: roh, kommentar,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      // Die fachlichen Fehler tragen ihre Meldung: „kein Urlaubsanspruch
      // hinterlegt (O-18)" ist eine Auskunft und kein Serverfehler.
      return NextResponse.json(
        { fehler: code, meldung: (fehler as Error).message }, { status });
    }
    throw fehler;
  }

  const mandant = String(daten.get('mandant') ?? '');
  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/personal/antraege`, anfrage),
    303,
  );
}
