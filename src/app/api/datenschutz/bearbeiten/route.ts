import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  AnfrageFehler, entscheide, verlaengere,
} from '@/server/services/datenschutz/anfrage';

/**
 * `POST /api/datenschutz/bearbeiten` — eine Betroffenenanfrage entscheiden
 * oder ihre Frist verlängern (LEG-09, Art. 12 Abs. 3).
 *
 * **Anders als der öffentliche Eingang daneben verlangt diese Route alles:**
 * gleichen Ursprung, angemeldete Sitzung, gebundenen Mandanten und
 * `datenschutz.auskunft_erstellen`. Der Unterschied ist kein Widerspruch — der
 * eine Weg nimmt entgegen, dieser hier entscheidet. Entgegennehmen darf jeder,
 * entscheiden nur ein benannter Mensch.
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
  const text = String(daten.get('entscheidung') ?? '');

  if (!['beantwortet', 'abgelehnt', 'verlaengern'].includes(handlung)) {
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
          { recht: 'datenschutz.auskunft_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (handlung === 'verlaengern') {
          /*
           * Der Grund der VERLAENGERUNG ist derselbe Text wie der der
           * Entscheidung — beide sagen „warum". Art. 12 Abs. 3 verlangt, dass
           * die betroffene Person ihn erfaehrt; die Spalte haelt ihn fest,
           * damit im Streitfall nachweisbar ist, was ihr mitgeteilt wurde.
           */
          await verlaengere(kontext, id, text);
          return;
        }
        await entscheide(kontext, id, handlung as 'beantwortet' | 'abgelehnt', text);
      }));
  } catch (fehler) {
    if (fehler instanceof AnfrageFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
