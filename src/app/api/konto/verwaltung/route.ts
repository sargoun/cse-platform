import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  fuehreKontohandlungAus, KontoFehler, KONTO_AKTIONEN, type KontoAktion,
} from '@/server/services/konto/verwaltung';

/**
 * `POST /api/konto/verwaltung` — ein fremdes Konto entsperren, entziehen,
 * wiedergeben oder seine Anmeldungen widerrufen (V-022, V-074, V-075, V-076).
 *
 * **Zwei Rechte an einer Route, und das Tor nennt das grössere.** Drei der
 * vier Handlungen verlangen `system.benutzer_verwalten`; der Sitzungswiderruf
 * verlangt `system.sitzung_widerrufen`, das bis `leitung` bindbar ist. Das Tor
 * prüft deshalb je Handlung das RICHTIGE — ein festes Recht im Manifest wäre
 * entweder zu eng (eine `leitung` käme nicht an den Widerruf, für den sie
 * gebunden ist) oder zu weit (der Entzug hinge am kleineren Recht).
 *
 * **Die Datenbank prüft beides noch einmal.** Die vier Funktionen aus `0379`
 * fragen ihr Recht gegen den aktiven Mandanten, den zweiten Faktor und die
 * Mitgliedschaft des Ziels. Das Tor hier ist der erste Riegel, nicht der
 * einzige: es gibt die saubere 403 statt einer Datenbankausnahme.
 */
export const dynamic = 'force-dynamic';

/** Welches Recht welche Handlung verlangt — dieselbe Zuordnung wie in `0379`. */
const RECHT: Readonly<Record<KontoAktion, string>> = {
  entsperren: 'system.benutzer_verwalten',
  deaktivieren: 'system.benutzer_verwalten',
  reaktivieren: 'system.benutzer_verwalten',
  sitzungen_widerrufen: 'system.sitzung_widerrufen',
};

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const aktion = String(daten.get('aktion') ?? '') as KontoAktion;
  const benutzerId = String(daten.get('benutzer') ?? '');
  const grund = String(daten.get('grund') ?? '');

  if (!KONTO_AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }

  let ergebnis;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: RECHT[aktion], schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return fuehreKontohandlungAus(kontext, aktion, { benutzerId, grund });
      })) as Promise<{ geaendert: boolean; sitzungen: number | null }>);
  } catch (fehler) {
    if (fehler instanceof KontoFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  /*
   * **Der Stand kommt in der Adresse zurück, nicht in einem Plätzchen.** Das
   * Blatt zeigt danach „entsperrt" oder „war schon offen" — und beides ist
   * eine Auskunft über DIESEN Klick, die beim Neuladen verschwinden darf.
   */
  const ziel = new URL(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage));
  ziel.searchParams.set('konto', ergebnis.geaendert ? aktion : `${aktion}_unveraendert`);
  if (ergebnis.sitzungen !== null) {
    ziel.searchParams.set('anzahl', String(ergebnis.sitzungen));
  }
  return NextResponse.redirect(ziel, 303);
}
