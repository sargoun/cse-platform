import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  BerichtigungFehler, entscheide, nimmAuf, unterrichte,
  type BerichtigungErgebnis,
} from '@/server/services/datenschutz/berichtigung';

/**
 * `POST /api/datenschutz/berichtigung` — ein strittiges Feld aufnehmen,
 * entscheiden oder die Art.-19-Unterrichtung festhalten (LEG-09, Art. 16, 19).
 *
 * **Das Recht ist `datenschutz.berichtigung_bearbeiten`** — das der Route
 * `/portal/[mandant]/datenschutz/[id]/berichtigung`, und ausdrücklich NICHT
 * `datenschutz.auskunft_erstellen`. Die drei Datenschutzrechte im Katalog sind
 * drei Zuständigkeiten; sie hier zu einem zu verschmelzen nähme dem Katalog
 * die Unterscheidung, die er absichtlich trifft.
 *
 * **Dieser Weg ändert die fremde Tabelle nicht.** Er hält fest, was berichtigt
 * wurde. Die Änderung geschieht im zuständigen Editor — dort sitzen die
 * Schreibrechte und die fachlichen Prüfungen.
 */
export const dynamic = 'force-dynamic';

const HANDLUNGEN = ['aufnehmen', 'entscheiden', 'unterrichten'] as const;
const ERGEBNISSE = ['offen', 'berichtigt', 'abgelehnt', 'ergaenzt'] as const;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const handlung = String(daten.get('handlung') ?? '');
  if (!(HANDLUNGEN as readonly string[]).includes(handlung)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  const ergebnis = String(daten.get('ergebnis') ?? '');
  if (handlung === 'entscheiden'
      && !(ERGEBNISSE as readonly string[]).includes(ergebnis)) {
    return NextResponse.json({ fehler: 'unbekanntes_ergebnis' }, { status: 400 });
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
          { recht: 'datenschutz.berichtigung_bearbeiten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (handlung === 'aufnehmen') {
          /*
           * Die Auswahlliste liefert `tabelle.feld` in EINEM Wert; die beiden
           * Felder von Hand sind der Weg fuer ein Feld, das die Liste nicht
           * kennt. Die Liste gewinnt, wenn sie gefuellt ist — sonst haette ein
           * Formular mit beidem zwei Wahrheiten und keine Regel dazu.
           */
          const wahl = String(daten.get('feldwahl') ?? '');
          const punkt = wahl.lastIndexOf('.');
          await nimmAuf(kontext, String(daten.get('anfrage') ?? ''), {
            tabelle: punkt > 0
              ? wahl.slice(0, punkt) : String(daten.get('tabelle') ?? ''),
            feld: punkt > 0
              ? wahl.slice(punkt + 1) : String(daten.get('feld') ?? ''),
            wertGespeichert: String(daten.get('wertGespeichert') ?? ''),
            wertBehauptet: String(daten.get('wertBehauptet') ?? ''),
            quelle: String(daten.get('quelle') ?? ''),
          });
          return;
        }
        if (handlung === 'entscheiden') {
          await entscheide(kontext, String(daten.get('feldId') ?? ''),
                           ergebnis as BerichtigungErgebnis,
                           String(daten.get('begruendung') ?? ''));
          return;
        }
        await unterrichte(kontext, String(daten.get('feldId') ?? ''),
                          String(daten.get('empfaenger') ?? ''));
      }));
  } catch (fehler) {
    if (fehler instanceof BerichtigungFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
