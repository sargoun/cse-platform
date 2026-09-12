import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { wetterPort } from '@/server/versand/dwd';
import { hefteWetterAn, type WetterBefund } from '@/server/services/bau/wetter';
import { alsAntwort } from '../../antwort';

/**
 * `POST /api/bau/bautagebuch/[id]/wetter` — das Wetter des Tages anheften
 * (BAU-08, API-KARTE §C.15).
 *
 * **Diese Route scheitert NICHT, wenn der DWD schweigt.** Sie gibt den Befund
 * zurueck — `nicht_verbunden`, `nicht_erreichbar`, `keine_daten`,
 * `ohne_koordinaten`, `keine_station` — und der Bautag bleibt, wie er ist.
 * Das ist die Zusage aus BAU-08 als Verhalten: ein Fehlschlag hier haette den
 * Tag mitgerissen, und genau das darf nicht passieren. Der Statuscode bleibt
 * deshalb 200, auch wenn kein Wert ankam; WAS ankam, steht im Rumpf.
 *
 * **Es wird nichts erfunden.** Kein Vorgabewetter, keine Interpolation, keine
 * Zahl aus einer Nachbarstation ohne Entfernung. Der Adapter liegt in
 * `server/versand/dwd.ts` — dem einen Ausgang (Invariante 7) — und ohne
 * `DWD_OPENDATA_BASE` meldet er „nicht verbunden", statt so zu tun, als
 * lieferte er etwas.
 *
 * **Eine Ablehnung wird nicht wiederholt.** 403 und 407 kommen in dieser
 * Umgebung vom ausgehenden Proxy und bedeuten eine Richtlinienentscheidung;
 * ein zweiter Versuch ergaebe dieselbe Antwort und verdeckte die Ursache.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  kontextParams: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const { id } = await kontextParams.params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };

  let befund: WetterBefund;
  try {
    befund = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /**
         * Der Port wird HIER gewaehlt und dem Dienst uebergeben — dasselbe
         * Muster wie beim Medienspeicher. So laesst sich der Weg pruefen, ohne
         * dass ein Test etwas nach draussen schickt, und ohne dass ein
         * Testdoppel jemals aussieht wie die echte Quelle.
         */
        return hefteWetterAn(kontext, { bautagebuchId: id }, wetterPort());
      }))) as WetterBefund;
  } catch (fehler: unknown) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const mandant = feld('mandant');
  const projekt = feld('projekt');
  const datum = feld('datum');
  if (mandant !== '' && projekt !== '' && datum !== '') {
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      `/portal/${mandant}/bau/projekte/${projekt}/bautagebuch/${datum}`,
      anfrage,
    ), 303);
  }
  return NextResponse.json(befund);
}
