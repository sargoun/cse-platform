import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withTenant } from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { authorize } from '@/server/auth/authorize';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import {
  KeinSnapshotFehler, dateiname, ublZurRechnung,
} from '@/server/services/finanz/xrechnung/dienst';
import { SnapshotZuAltFehler } from '@/server/services/finanz/xrechnung/aus-snapshot';
import { XRechnungUnvollstaendigFehler } from '@/server/services/finanz/xrechnung/index';

/**
 * `GET /api/finanzen/rechnungen/[id]/xrechnung.xml` — die XRechnung als Datei
 * (FIN-11, 05-API-KARTE.md §D).
 *
 * **Aus dem Snapshot, nie aus den Stammdaten** (K-12) — das besorgt
 * `ublZurRechnung`, und diese Datei besorgt gar nichts ausser Berechtigung
 * und Uebersetzung in HTTP.
 *
 * **404 und nicht 403 fuer eine fremde Rechnung** (AUT-06, SEC-A3): die
 * Abfrage laeuft im Mandantenkontext, eine fremde Zeile liefert nichts, und
 * „nicht da" ist byte-gleich mit „nicht erlaubt". Ein 403 bestaetigte die
 * Existenz einer Rechnungsnummer bei einem anderen Bereich.
 *
 * **Ein unvollstaendiges Dokument entsteht nicht** — auch nicht mit einem
 * Hinweis daneben. Die Antwort ist 422 mit der Liste der fehlenden Felder;
 * wer sie beheben will, geht auf die Portalseite, wo dieselbe Liste mit
 * Verweisen steht.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  try {
    const ergebnis = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        /*
         * `authorize` und keine eigene Rechtefrage: es ist die EINE Tuer
         * (AUT-04), und sie entscheidet mehr als „hat er das Recht" — den
         * zweiten Faktor, die Ansicht, den fremden Mandanten. Eine Route mit
         * eigener Pruefung hat all das einzeln richtig zu machen, und die
         * erste, die es vergisst, faellt niemandem auf.
         *
         * `schreibend` fehlt, weil die Route liest — sie erzeugt Text aus
         * einem Snapshot und aendert nichts.
         *
         * **Und heute kommt hier NUR das interne Portal durch**, auch wenn
         * der Katalog `finanzen.herunterladen` ebenso dem Kunden gibt
         * (03-AUTH §2524). Der Grund liegt eine Ebene tiefer:
         * `rechnung_snapshot` traegt seit 0077 eine RESTRIKTIVE Policy
         * `p_intern_ceiling` mit `app.portal() = 'intern'`. Eine
         * Kundensitzung kaeme also durch `authorize` und faende danach null
         * Zeilen — Antwort 404. Das ist kein Fehler dieser Route und wird
         * hier auch nicht heimlich umgangen: das Kundenportal (PR 57)
         * braucht eine eigene, eng gefasste Policy auf den Snapshot seiner
         * EIGENEN festgeschriebenen Belege, und die gehoert in denselben PR
         * wie die Seite, die sie benutzt.
         */
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
          { recht: 'finanzen.herunterladen' },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return ublZurRechnung(kontext, id);
      })) as Promise<{ xml: string; nummer: string } | null>);

    if (ergebnis === null) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }

    return new NextResponse(ergebnis.xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'content-disposition': `attachment; filename="${dateiname(ergebnis.nummer)}"`,
        // Ein unveraenderlicher Beleg — aber privat. `no-store` haelt ihn aus
        // jedem gemeinsamen Zwischenspeicher heraus.
        'cache-control': 'no-store',
      },
    });
  } catch (fehler) {
    /*
     * `authorize` wirft `NichtGefundenFehler`, wenn das Recht fehlt oder der
     * Mandant ein fremder ist — byte-gleich mit „gibt es nicht" (AUT-06,
     * SEC-A3). Diese Zeile haelt das so: ein eigener Statuscode hier
     * bestaetigte die Existenz einer Rechnungsnummer bei einem anderen
     * Bereich.
     */
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof XRechnungUnvollstaendigFehler) {
      return NextResponse.json(
        { fehler: 'unvollstaendig', fehlend: fehler.fehlend }, { status: 422 },
      );
    }
    if (fehler instanceof SnapshotZuAltFehler) {
      return NextResponse.json(
        { fehler: 'snapshot_zu_alt', meldung: fehler.message }, { status: 422 },
      );
    }
    if (fehler instanceof KeinSnapshotFehler) {
      return NextResponse.json(
        { fehler: 'kein_snapshot', meldung: fehler.message }, { status: 409 },
      );
    }
    throw fehler;
  }
}
