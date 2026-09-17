import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { RedaktionFehler, setzeReferenzStatus } from '@/server/services/inhalt/redaktion';

/**
 * `POST /api/website/referenzen` — ein Projekt auf die Website stellen oder
 * zurückziehen (§5.21, PRO-05).
 *
 * **Die Kundenfreigabe wird DREIMAL geprüft, und das ist kein Übereifer.**
 * Der Dienst fragt sie ab und sagt, was fehlt; die Policy `t_referenz_pflege`
 * verlangt `referenz.kundenfreigabe_erfassen`; und `referenz_freigabe_belegt`
 * lässt eine Freigabe ohne Datum gar nicht erst in die Tabelle. Ein Kundenname
 * auf einer Website ohne dessen Zustimmung ist nichts, was man durch Löschen
 * ungeschehen macht — er steht dann im Cache einer Suchmaschine, und der
 * Kunde ruft an.
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
  const veroeffentlicht = String(daten.get('veroeffentlicht') ?? '') === '1';

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
          { recht: 'referenz.veroeffentlichen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeReferenzStatus(kontext, id, veroeffentlicht);
      }));
  } catch (fehler) {
    if (fehler instanceof RedaktionFehler) {
      return NextResponse.json({ fehler: fehler.grund }, { status: 400 });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
