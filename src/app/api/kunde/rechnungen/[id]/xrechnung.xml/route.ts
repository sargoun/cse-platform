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
  KeinSnapshotFehler, dateiname, ublZurRechnung,
} from '@/server/services/finanz/xrechnung/dienst';
import { SnapshotZuAltFehler } from '@/server/services/finanz/xrechnung/aus-snapshot';
import { XRechnungUnvollstaendigFehler } from '@/server/services/finanz/xrechnung/index';

/**
 * `GET /api/kunde/rechnungen/[id]/xrechnung.xml` — der eigene Beleg als
 * XRechnung (FIN-11, FIN-12, DOC-03, K-12, 0256).
 *
 * **Die Schwester der ZUGFeRD-Route, gleiche Bindung, gleiches Tor, anderes
 * Format.** Beide lesen DENSELBEN Snapshot (K-12): sie koennen deshalb gar
 * nicht auseinanderlaufen, auch wenn sich die Stammdaten laengst geaendert
 * haben. Die ausfuehrliche Begruendung — warum eine eigene Kundenroute statt
 * einer Aufweichung der internen, und warum `authorize` den Bereich der
 * RECHNUNG braucht — steht in `../zugferd.pdf/route.ts`; sie zweimal zu
 * schreiben hiesse, sie zweimal pflegen zu muessen.
 *
 * **Ein unvollstaendiges Dokument entsteht nicht** — auch nicht mit einem
 * Hinweis daneben. BR-DE-15 verlangt BT-10; fehlt eine Pflichtangabe, ist die
 * Antwort 422 mit der Liste, und die Kundenseite sagt daneben, dass der Beleg
 * auf dem bisherigen Weg kommt. Eine halbe XRechnung wuerde beim Empfaenger
 * abgewiesen, und zwar Wochen spaeter.
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
              aktiverMandantId: null,
              ansicht: 'kunde',
              aal: sitzung.aal,
              portal: 'kunde',
              sitzungId: sitzung.sitzungId,
            },
            { recht: 'finanzen.herunterladen', mandantId },
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
    if (fehler instanceof KeinKundenzugangFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
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
