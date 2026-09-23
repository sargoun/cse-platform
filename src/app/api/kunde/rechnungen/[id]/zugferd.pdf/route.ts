import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withKundeScope, KeinKundenzugangFehler } from '@/server/kontext/index';
import { rechtepruefer } from '@/server/auth/zugang';
import { authorize } from '@/server/auth/authorize';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { mandantZurRechnung } from '@/server/services/kundenportal/rechnung';
import {
  KeinSnapshotFehler, pdfDateiname, zugferdZurRechnung,
} from '@/server/services/finanz/xrechnung/dienst';
import { SnapshotZuAltFehler } from '@/server/services/finanz/xrechnung/aus-snapshot';
import { XRechnungUnvollstaendigFehler } from '@/server/services/finanz/xrechnung/index';
import { RechnungslogoFehler } from '@/server/services/finanz/zugferd/pdfa3';
import { NichtVerbundenFehler } from '@/server/storage/adapter';

/**
 * `GET /api/kunde/rechnungen/[id]/zugferd.pdf` — der eigene Beleg als ZUGFeRD
 * (FIN-11, FIN-12, DOC-03, K-12, 0256).
 *
 * ===========================================================================
 * Warum es eine EIGENE Route gibt und die interne nicht geoeffnet wird
 * ===========================================================================
 *
 * `api/finanzen/rechnungen/[id]/zugferd.pdf` bricht mit 401 ab, wenn
 * `sitzung.aktiverMandantId` null ist — und im Kunden-Scope ist sie das
 * IMMER (K-20). Diese Bedingung dort wegzunehmen hiesse, eine Route, die
 * `withTenant` benutzt, fuer eine Sitzung ohne Mandanten zu oeffnen; danach
 * entschiede allein RLS, und die erste Policy, die jemand lockert, gaebe
 * einen Beleg heraus. Zwei Routen mit zwei Bindungen sind hier die kleinere
 * Aenderung als eine Route mit zwei Bedeutungen.
 *
 * **Dasselbe DOKUMENT aus derselben Quelle.** `zugferdZurRechnung` ist die
 * eine Stelle, an der aus einer Rechnungskennung ein PDF wird; sie liest
 * `rechnung_snapshot` (K-12) und nichts anderes. Der Kunde bekommt also
 * byte-gleich das, was die interne Route liefert — was sich unterscheidet,
 * ist ausschliesslich, WER lesen darf.
 *
 * ===========================================================================
 * Das Tor: `authorize` mit dem Bereich der Rechnung
 * ===========================================================================
 *
 * `app.hat_recht(recht, null)` antwortet im Kunden-Scope auf ALLES `false`
 * (nachgemessen gegen eine echte Kundensitzung). `authorize` mit einem
 * fehlenden `mandantId` haette die Route deshalb fuer jeden Kunden mit 404
 * beantwortet — richtig aussehend, immer falsch. Der Bereich kommt daher aus
 * der angefragten Rechnung, gelesen unter derselben RLS wie die Seite:
 * `t_kunde` und `p_rechnung_decke` lassen nur die EIGENEN festgeschriebenen
 * Belege durch, eine fremde Kennung liefert also `null` und damit 404 (AUT-06,
 * SEC-A3) — byte-gleich mit „gibt es nicht", noch bevor ein Recht gefragt
 * wird.
 *
 * Die Reihenfolge ist Absicht: die Kennungsabfrage verraet nichts (sie kann
 * nur den eigenen Bereich liefern), und danach entscheidet dasselbe Tor wie
 * ueberall (AUT-04). Eine eigene Rechtefrage hier haette den zweiten Faktor,
 * die Ansicht und den fremden Bereich je einzeln richtig machen muessen.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  try {
    const ergebnis = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) =>
        withKundeScope(tx, sitzung, async (kontext) => {
          const mandantId = await mandantZurRechnung(kontext, id);
          if (mandantId === null) return null;

          await authorize(
            {
              benutzerId: sitzung.benutzerId,
              personId: sitzung.personId,
              /*
               * Der Akteur traegt die Kundensitzung, wie `withKundeScope` sie
               * gebunden hat — nicht die rohe Sitzung: Ansicht und Portal
               * sind hier Konstanten des Scopes, und ein Akteur, der etwas
               * anderes behauptet, als in der Datenbank gebunden ist, ist der
               * Anfang einer Luecke zwischen den zwei Verteidigungslinien.
               */
              aktiverMandantId: null,
              ansicht: 'kunde',
              aal: sitzung.aal,
              portal: 'kunde',
              sitzungId: sitzung.sitzungId,
            },
            { recht: 'finanzen.herunterladen', mandantId },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          return zugferdZurRechnung(kontext, id);
        })) as Promise<{ pdf: Uint8Array; nummer: string } | null>);

    if (ergebnis === null) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }

    return new NextResponse(Buffer.from(ergebnis.pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${pdfDateiname(ergebnis.nummer)}"`,
        // Ein unveraenderlicher Beleg — aber privat. `no-store` haelt ihn aus
        // jedem gemeinsamen Zwischenspeicher heraus.
        'cache-control': 'no-store',
      },
    });
  } catch (fehler) {
    /*
     * Ein angemeldetes Konto ohne Kundenbindung ist hier 404 und nicht 401:
     * die Anmeldung stimmt, es gibt nur nichts zu holen. Auf der Seite steht
     * dafuer ein Satz; eine Datei kann keinen Satz tragen.
     */
    if (fehler instanceof KeinKundenzugangFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof XRechnungUnvollstaendigFehler) {
      /*
       * 422 mit der Liste der fehlenden Felder — dieselbe Antwort wie intern.
       * Die Liste nennt Feldnamen des Belegs (BT-Nummern der EN 16931), keine
       * internen Zeilen; wer sie behebt, ist ohnehin das Haus und nicht der
       * Kunde, und die Kundenseite sagt daneben, dass der Beleg auf dem
       * bisherigen Weg kommt.
       */
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
    /*
     * Das festgeschriebene Logo ist gerade nicht zu haben (V-132). Der Kunde
     * bekommt den Zustand, nicht den Speicherschlüssel — der ist ein Detail
     * des Hauses; die interne Route nennt ihn.
     */
    if (fehler instanceof NichtVerbundenFehler || fehler instanceof RechnungslogoFehler) {
      return NextResponse.json({
        fehler: 'voruebergehend_nicht_erzeugbar',
        meldung: 'Das PDF dieser Rechnung lässt sich gerade nicht erzeugen. Die Rechnung '
          + 'selbst ist unverändert; bitte versuchen Sie es später noch einmal.',
      }, { status: 409 });
    }
    throw fehler;
  }
}
