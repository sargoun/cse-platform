import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  AnfrageFehler, ordneZu, type ZuordnungArt,
} from '@/server/services/datenschutz/anfrage';

/**
 * `POST /api/datenschutz/zuordnen` — die Identität einer Betroffenenanfrage
 * einem Datensatz zuordnen (LEG-09, Art. 12 Abs. 6).
 *
 * **Warum das ein eigener Weg ist und nicht Teil von `/bearbeiten`.** Die
 * Zuordnung ist das Gegenteil einer Entscheidung: sie ist änderbar, sie ist
 * eine Feststellung, und sie darf einen Vorgang nicht abschliessen. Wer sie an
 * denselben Knopf hängt, an dem „Beantwortet" sitzt, bekommt irgendwann einen
 * Vorgang, der abgeschlossen ist, weil jemand den falschen Menschen gesucht
 * hat.
 *
 * **Das Recht ist `datenschutz.auskunft_erstellen`** — dasselbe wie das der
 * Route `/portal/[mandant]/datenschutz/[id]`, auf der das Formular steht.
 * Die Prüfung, dass der Datensatz zu DIESER Gesellschaft gehört, macht der
 * Dienst (und für `ansprechpartner` zusätzlich der zusammengesetzte
 * Fremdschlüssel aus 0220).
 */
export const dynamic = 'force-dynamic';

const ARTEN = ['person', 'ansprechpartner', 'bewerbung', 'keine'] as const;

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

  /**
   * **Art und Kennung kommen als EIN Wert** (`person:uuid`).
   *
   * Der erste Entwurf übertrug sie getrennt: ein Auswahlknopf je Treffer für
   * die Kennung, drei Sendeknöpfe für die Art. Damit liess sich eine Person
   * auswählen und als Ansprechpartner zuordnen — zwei Felder, die
   * zusammengehören und sich unabhängig setzen lassen, und der Dienst prüfte
   * anschliessend eine Kombination, die die Oberfläche nie gezeigt hat. Ein
   * Wert, ein Treffer, eine Bedeutung.
   */
  const wahl = String(daten.get('wahl') ?? '');
  const [artRoh, ziel] = wahl === ''
    ? [String(daten.get('art') ?? ''), '']
    : [wahl.slice(0, wahl.indexOf(':')), wahl.slice(wahl.indexOf(':') + 1)];

  if (!(ARTEN as readonly string[]).includes(artRoh)) {
    return NextResponse.json({ fehler: 'unbekannte_art' }, { status: 400 });
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
        await ordneZu(kontext, id, artRoh as ZuordnungArt,
                      ziel === '' ? null : ziel);
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
