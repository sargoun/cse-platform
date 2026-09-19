import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { BarriereFehler, erledige } from '@/server/services/datenschutz/barriere';

/**
 * `POST /api/barrierefreiheit/erledigen` — eine gemeldete Barriere abschliessen
 * (LEG-07, BFSG).
 *
 * Das Recht ist `referenz.schreiben`: behoben wird eine Barriere von denen, die
 * den Auftritt pflegen. Der Meldeweg daneben verlangt gar kein Recht — das ist
 * kein Widerspruch, sondern die Richtung: melden darf jeder, erledigen nur, wer
 * die Seite ändern kann.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const id = String(daten.get('id') ?? '');
  const handlung = String(daten.get('handlung') ?? '');
  if (!['behoben', 'kein_mangel'].includes(handlung)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }

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
          { recht: 'referenz.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await erledige(kontext, id, handlung as 'behoben' | 'kein_mangel',
                       String(daten.get('antwort') ?? ''));
      }));
  } catch (fehler) {
    if (fehler instanceof BarriereFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
