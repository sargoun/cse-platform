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
import {
  genehmigeAbwesenheit, lehneAbwesenheitAb, storniereAbwesenheit,
} from '@/server/services/abwesenheit/index';

/**
 * `POST /api/abwesenheiten/[id]` — genehmigen, ablehnen, stornieren (EMP-10).
 *
 * **Drei Wege, ein Recht: `zeit.abwesenheit_genehmigen`.** Wer über eine
 * Abwesenheit entscheidet, entscheidet über Lohnfortzahlung und Urlaubskonto;
 * das ist eine Entscheidung und nicht drei.
 *
 * **Stornieren löscht nicht.** Die Zeile bleibt mit Zeitpunkt und Urheber,
 * das Urlaubskonto bekommt seine Tage zurück, und der Grund steht im
 * Auditlog — nicht in `bemerkung`, die der Planung als Gesundheitsdatum
 * entzogen ist (Art. 9 DSGVO).
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
  const was = daten.get('entscheidung');
  if (was !== 'genehmigt' && was !== 'abgelehnt' && was !== 'storniert') {
    return NextResponse.json({ fehler: 'unbekannte_entscheidung' }, { status: 400 });
  }
  const grund = typeof daten.get('grund') === 'string' ? (daten.get('grund') as string) : '';

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
          { recht: 'zeit.abwesenheit_genehmigen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (was === 'genehmigt') await genehmigeAbwesenheit(kontext, id);
        else if (was === 'abgelehnt') await lehneAbwesenheitAb(kontext, id, grund);
        else await storniereAbwesenheit(kontext, id, grund);
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
      return NextResponse.json(
        { fehler: code, meldung: (fehler as Error).message }, { status });
    }
    throw fehler;
  }

  const mandant = String(daten.get('mandant') ?? '');
  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/personal/abwesenheiten`, anfrage),
    303,
  );
}
