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
  LoeschFehler, entscheide, type Entscheidungszeile,
} from '@/server/services/datenschutz/loeschentscheidung';

/**
 * `POST /api/datenschutz/loeschung` — eine Löschentscheidung je Tabelle
 * festhalten (LEG-09, Art. 17 gegen LEG-01/LEG-02).
 *
 * **Diese Route löscht nichts, und das ist keine Einschränkung, sondern die
 * Zusage der Seitenkarte** (§5.25): `datenschutz.loeschung_pruefen` *does not
 * delete*; es entsteht ein Entscheidungsnachweis je Feld und Tabelle. Der
 * Vollzug wäre Anonymisierung plus Tombstone — und den gibt es heute nicht
 * (siehe `services/datenschutz/loeschentscheidung.ts`, `VOLLZUG`). Solange
 * das so ist, ist die Entscheidung eine VORMERKUNG, und die Seite nennt sie
 * so.
 *
 * **Das Recht ist `datenschutz.loeschung_pruefen`** — das der Route, nicht das
 * der Auskunft.
 */
export const dynamic = 'force-dynamic';

const ERGEBNISSE = ['geschuldet', 'ueberlagert', 'offen', 'anonymisierung'] as const;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const ergebnis = String(daten.get('ergebnis') ?? '');
  if (!(ERGEBNISSE as readonly string[]).includes(ergebnis)) {
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
          { recht: 'datenschutz.loeschung_pruefen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await entscheide(kontext, String(daten.get('anfrage') ?? ''), {
          tabelle: String(daten.get('tabelle') ?? ''),
          feld: String(daten.get('feld') ?? ''),
          ergebnis: ergebnis as Entscheidungszeile['ergebnis'],
          rechtsgrundlage: String(daten.get('rechtsgrundlage') ?? ''),
          sperreFaelltAm: String(daten.get('sperreFaelltAm') ?? ''),
          offeneFrage: String(daten.get('offeneFrage') ?? ''),
          bemerkung: String(daten.get('bemerkung') ?? ''),
          zeilen: Number.parseInt(String(daten.get('zeilen') ?? '0'), 10) || 0,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof LoeschFehler) {
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
