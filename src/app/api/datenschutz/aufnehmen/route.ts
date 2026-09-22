import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  AnfrageFehler, nimmAnfrageAuf, type AnfrageArt, type Eingangsweg,
} from '@/server/services/datenschutz/anfrage';

/**
 * `POST /api/datenschutz/aufnehmen` — eine Anfrage protokollieren, die NICHT
 * durch das öffentliche Formular kam (V-031, Art. 12 Abs. 1 DSGVO).
 *
 * **Drei Routen, drei verschiedene Prinzipale — mit Absicht.**
 * `/api/datenschutz/anfrage` nimmt anonym entgegen und darf nichts lesen.
 * `/api/datenschutz/bearbeiten` entscheidet und verlangt einen benannten
 * Menschen. Diese hier steht dazwischen: sie legt an wie die erste und
 * verlangt einen Menschen wie die zweite — denn was sie festhält, ist die
 * Aussage eines Menschen darüber, wann ein Brief ankam.
 *
 * Das Recht ist `datenschutz.auskunft_erstellen` — dasselbe wie beim
 * Entscheiden. Wer den Vorgang führen darf, nimmt den Brief auf, der ihn
 * auslöst; ein eigenes Recht bräuchten genau dieselben Menschen zusätzlich
 * (K-19).
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
  const feld = (name: string): string => String(daten.get(name) ?? '');

  let id: string;
  try {
    id = await (db().begin(async (tx: postgres.TransactionSql) =>
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
        const angelegt = await nimmAnfrageAuf(kontext, {
          art: feld('art') as AnfrageArt,
          name: feld('name'),
          email: feld('email'),
          nachricht: feld('nachricht'),
          rolleAngabe: feld('rolle'),
          eingangsweg: feld('eingangsweg') as Eingangsweg,
          eingegangenAm: feld('eingegangen'),
        });
        return angelegt.id;
      })) as Promise<string>);
  } catch (fehler) {
    if (fehler instanceof AnfrageFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  /*
   * **Der Weg führt auf den VORGANG, nicht zurück auf die Liste.** Wer gerade
   * einen Anruf protokolliert hat, ist noch nicht fertig: die Zuordnung zu
   * einer Person und die Identitätsfrage stehen auf dem Blatt, das jetzt
   * aufgeht. Eine Rückkehr in den Posteingang hiesse, den frisch angelegten
   * Vorgang dort erst wiederzufinden.
   */
  const ziel = feld('zurueck').replace('__ID__', id);
  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
