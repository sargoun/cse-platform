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
  WiderspruchFehler, setzeVerarbeitungswiderspruch, stand,
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
         * **Die Firma kommt über den DEFINER, nicht über ein eigenes
         * `select`** — und das war ein stiller Datenverlust.
         *
         * Hier stand `select kunde_id from ansprechpartner …`. Diese Abfrage
         * läuft unter der Policy `t_mandant`, und die verlangt `crm.lesen`.
         * Diese Route autorisiert aber bewusst `datenschutz.auskunft_erstellen`
         * und NICHT `crm.schreiben` — genau für die Datenschutzbeauftragte ohne
         * CRM-Recht. Für sie kam keine Zeile, `k?.kunde_id ?? null` wurde
         * `null`, und der Haken „Auch auf Ebene der Firma festhalten" wurde
         * verworfen: ohne Fehler, ohne Hinweis, bei einer UNWIDERRUFLICHEN
         * Wirkung. Es gibt keinen zweiten Versuch.
         *
         * `app.widerspruch_stand` prüft `darf_widerspruch_lesen()` (also auch
         * `datenschutz.auskunft_erstellen`) und gibt die Firma seit 0222 mit
         * heraus. Die Seite liest ohnehin über denselben Weg — dieselbe
         * Quelle, dieselbe Antwort.
         */
        const [kontakt] = await stand(kontext, zuordnung.id, null);
        const kundeId = kontakt?.kundeId ?? null;

        /*
         * Und wenn die Firma trotz gesetztem Haken nicht auflösbar ist: 409,
         * nicht stillschweigend die Kontaktebene allein. „Ich habe die Firma
         * mitgenommen" ist eine Aussage, die entweder stimmt oder scheitert.
         */
        if (auchFirma && kundeId === null) {
          throw new WiderspruchFehler(
            'Zu diesem Kontakt ist keine Firma auflösbar — der Widerspruch auf '
            + 'Firmenebene wurde NICHT gesetzt. Entweder hängt der Kontakt an '
            + 'keinem Kunden, oder der Widerspruchsstand ist mit den erteilten '
            + 'Rechten nicht lesbar. Setzen Sie ihn ohne den Haken, oder holen '
            + 'Sie eine Sitzung mit `crm.rechtsgrundlage_lesen` hinzu.',
            'firma_nicht_aufloesbar', 409);
        }

        await setzeVerarbeitungswiderspruch(kontext, {
          ansprechpartnerId: zuordnung.id,
          kundeId: auchFirma ? kundeId : null,
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
