import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { ladeZuordnung } from '@/server/services/datenschutz/anfrage';
import {
  WiderspruchFehler, setzeVerarbeitungswiderspruch,
} from '@/server/services/datenschutz/werbewiderspruch';

/**
 * `POST /api/datenschutz/widerspruch` — der Widerspruch nach Art. 21 DSGVO,
 * im Vorgang entschieden (LEG-08, LEG-09).
 *
 * **Das ist der einzige Schreibweg des Hauses auf `widerspruch_am`.** Gezählt
 * vor diesem PR: kein einziges `.ts` unter `src/server/services/` oder
 * `src/app/api/` nannte die Spalte — die Seitenkarte wies die Entscheidung
 * `M/datenschutz/[id]` zu (§2.4), und es gab sie nicht.
 *
 * **Er ist unwiderruflich, und die Datenbank sagt das.**
 * `kern.erzwinge_widerspruch()` (0020) zwingt `rechtsgrundlage = 'keine'`,
 * nullt Quelle, Erfassungszeitpunkt und Einwilligungskanäle und wirft bei
 * jedem Versuch, den Widerspruch zurückzunehmen. Deshalb gibt es hier keinen
 * Gegenweg — nicht, weil er vergessen wurde.
 *
 * **Der Betroffene kommt aus der ZUORDNUNG des Vorgangs, nicht aus dem
 * Formular.** Eine Kennung im Formularfeld wäre ein Weg, den Widerspruch eines
 * fremden Kontakts zu setzen — und die Wirkung wäre nicht rücknehmbar.
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
  const anfrageId = String(daten.get('anfrage') ?? '');
  const bemerkung = String(daten.get('bemerkung') ?? '');
  const auchFirma = String(daten.get('auchFirma') ?? '') === 'ja';

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

        const zuordnung = await ladeZuordnung(kontext, null, anfrageId);
        if (zuordnung.art !== 'ansprechpartner' || zuordnung.id === null) {
          throw new WiderspruchFehler(
            'Ein Widerspruch nach Art. 21 wirkt auf einen Kundenkontakt. Ordnen '
            + 'Sie den Vorgang zuerst einem Ansprechpartner zu.',
            'keine_zuordnung', 409);
        }

        /*
         * Die Firma kommt aus der Zeile des Kontakts, nicht aus dem Formular:
         * welcher Kunde dahinter steht, weiss die Datenbank. Der Haken sagt
         * nur, OB er mitgenommen wird — §2.4 nennt beide Ebenen.
         */
        const [k] = await kontext.abfrage<{ kunde_id: string | null }>(
          `select kunde_id from ansprechpartner
            where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
          [zuordnung.id]);

        await setzeVerarbeitungswiderspruch(kontext, {
          ansprechpartnerId: zuordnung.id,
          kundeId: auchFirma ? k?.kunde_id ?? null : null,
          bemerkung,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof WiderspruchFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: fehler.status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
