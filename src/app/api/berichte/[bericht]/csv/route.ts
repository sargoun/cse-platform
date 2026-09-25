import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { jahrAus } from '@/server/services/bericht/zeitraum';
import { alsCsv, dateiname } from '@/server/services/bericht/ausgabe';
import {
  BERICHT_DATEINAME, berichtTabelle, istBericht, koernungAus,
} from '@/server/services/bericht/export';

/**
 * `GET /api/berichte/[bericht]/csv` — ein Bericht als Datei (REP-07).
 *
 * **Ein eigenes Recht: `bericht.exportieren`.** Wer eine Zahl ansehen darf,
 * darf sie nicht schon aus dem Haus tragen. Eine CSV-Datei verlässt das
 * Portal und damit jede Zugriffskontrolle darin — sie liegt danach in einem
 * Downloads-Ordner, in einem Mailanhang, in einem geteilten Laufwerk. Das
 * Recht ist an `admin` gebunden und an `leitung` bindbar (Katalog).
 *
 * **GET, weil nichts entsteht.** Der Bericht liest; ein POST wäre die
 * Behauptung, hier werde etwas geändert. Der Schnappschuss
 * (`SCHNAPPSCHUSS`) sorgt dafür, dass alle Spalten denselben Stand sehen.
 *
 * **Der Mandant kommt aus der SITZUNG, nicht aus der Abfrage** (Invariante 3).
 * `?mandant=` steht nur in der Adresse, damit der Browser eine sprechende
 * Datei bekommt; verglichen wird gegen den aktiven Bereich, und wer einen
 * fremden einträgt, bekommt 404 wie bei jeder fremden Zeile (AUT-06).
 */
export const dynamic = 'force-dynamic';

/*
 * Die Spalten stehen in `services/bericht/export.ts` (`berichtTabelle`) — dieselbe
 * Quelle wie das Druckblatt `/portal/[mandant]/berichte/druck/[bericht]`
 * (REP-07, V-227, D-721). Eine Datei und ein Blatt, die für denselben
 * Bericht verschiedene Spalten zeigten, prüfte niemand gegeneinander.
 */

export async function GET(
  anfrage: NextRequest, { params }: { params: Promise<{ bericht: string }> },
): Promise<NextResponse> {
  const { bericht } = await params;
  if (!istBericht(bericht)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });
  // Invariante 10: ohne genau einen aktiven Bereich gibt es diesen Bericht nicht.
  if (sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const suche = anfrage.nextUrl.searchParams;

  try {
    const { csv, name } = await (db().begin(SCHNAPPSCHUSS,
      async (tx: postgres.TransactionSql) =>
        /*
         * **Die Rechtefrage steht INNERHALB von `withTenant`** — und das ist
         * keine Stilfrage. `app.hat_recht` fragt `app.aktueller_benutzer()`,
         * und den setzt erst die Bindung. Auf einer ungebundenen Transaktion
         * antwortet jedes Recht `false`: die Route gab 404 „nicht gefunden",
         * obwohl die Seite daneben den Knopf zeigte, weil SIE gebunden
         * geprüft hatte. Ein Fehlschlag, der wie ein fehlender Bericht
         * aussieht und eine fehlende Bindung ist.
         */
        withTenant(tx, sitzung, async (kontext) => {
          await authorize(
            sitzung,
            { recht: 'bericht.exportieren', mandantId: sitzung.aktiverMandantId },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
          const [uhr] = await kontext.abfrage<{ heute: string; name: string; slug: string }>(
            `select app.berlin_heute()::text as heute,
                    (select m.name from mandant m where m.id = app.aktiver_mandant()) as name,
                    (select m.slug from mandant m where m.id = app.aktiver_mandant()) as slug`);
          /*
           * `?mandant=` formt nur den Dateinamen — gelesen wird der Bereich
           * aus der SITZUNG (Invariante 3). Stimmt der Hinweis in der Adresse
           * nicht mit ihr überein, ist die Adresse aus einer anderen Sitzung
           * kopiert; dann kommt 404 wie bei jeder fremden Zeile (AUT-06),
           * statt einer Datei mit dem falschen Namen im Downloads-Ordner.
           */
          const gewuenscht = suche.get('mandant');
          if (gewuenscht !== null && gewuenscht !== uhr!.slug) {
            throw new NichtGefundenFehler(`Fremder Bereich ${gewuenscht}`);
          }
          const jahr = jahrAus(suche.get('jahr'), uhr!.heute);
          const { zeilen, spalten, zeitraum } = await berichtTabelle(
            bericht, kontext, jahr, koernungAus(suche.get('koernung')),
          );
          return {
            csv: alsCsv(spalten, zeilen as readonly never[]),
            name: dateiname(BERICHT_DATEINAME[bericht], uhr!.name ?? 'Bereich', zeitraum),
          };
        }))) as { csv: string; name: string };

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        // Eine Auswertung ist kein Dokument, das ein Zwischenspeicher halten
        // soll: sie ist morgen anders, und sie enthält Zahlen.
        'cache-control': 'no-store',
      },
    });
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
