import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  AnfrageFehler, entscheide, fordereIdentitaetsnachweis, identitaetGeklaert,
  verlaengere,
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

  if (!['beantwortet', 'abgelehnt', 'verlaengern',
    /* V-088, Art. 12 Abs. 6 — die Rückfrage und ihr Ende. */
    'identitaet_anfordern', 'identitaet_geklaert'].includes(handlung)) {
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
        if (handlung === 'identitaet_anfordern') {
          /*
           * Der Grund kommt im selben Feld wie bei der Verlängerung und der
           * Entscheidung — alle drei sagen „warum", und alle drei stehen
           * später allein da, wenn eine Aufsicht fragt.
           */
          await fordereIdentitaetsnachweis(kontext, id, text);
          return;
        }
        if (handlung === 'identitaet_geklaert') {
          await identitaetGeklaert(kontext, id);
          return;
        }
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
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
