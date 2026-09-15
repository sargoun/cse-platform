import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { bindeAnfrage } from '@/server/kontext/index';
import { loeseTokenAuf } from '@/server/kalender/feed';
import { kalenderZeilen } from '@/server/services/kalender/eintraege';
import { alsIcal, type Termin } from '@/server/services/kalender/ical';

/**
 * `GET /api/kalender/[token]` — der lesende iCal-Feed (CAL-03).
 *
 * **Die einzige Route der Plattform ohne Sitzung, die Mandantendaten
 * herausgibt** — und deshalb die, bei der jede Zeile eine Begründung hat.
 *
 * **Der Token ersetzt die Anmeldung, nicht die Rechte.** Er sagt, WER liest;
 * was dieser Mensch sehen darf, entscheiden danach dieselben Policies wie im
 * Portal. Die Route bindet eine Sitzung für ihn — `scope: 'person'`, alle
 * seine Gesellschaften, lesend — und stellt dieselbe Abfrage wie die Seite.
 * Ein zweiter Lesepfad „für den Feed" wäre der erste, der bei einer
 * Policy-Änderung vergessen wird.
 *
 * **Nur die eigenen Einträge.** `nurBenutzerId` ist gesetzt, immer: der Feed
 * ist ein persönlicher Kalender, und ein Token, der den ganzen Dienstplan
 * herausgäbe, wäre eine andere Sache als der, um den jemand gebeten hat.
 *
 * **Ein falscher Token ist 404, kein 401.** Ein 401 lüde zum zweiten Versuch
 * ein; 404 sagt dasselbe wie für jede Adresse, die es nicht gibt. Und ein
 * widerrufener verhält sich wie ein nie vergebener.
 *
 * **Kein Zwischenspeicher.** `no-store`: die Datei enthält Termine, und sie
 * ist morgen anders.
 */
export const dynamic = 'force-dynamic';

/** Vier Wochen zurück, ein Jahr voraus — was ein Kalenderprogramm braucht. */
const RUECKBLICK_TAGE = 28;
const VORSCHAU_TAGE = 365;

export async function GET(
  _anfrage: NextRequest, { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const ergebnis = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => {
      const roh = async <T,>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
        (await tx.unsafe(s, (w ?? []) as never[])) as unknown as readonly T[];

      const benutzerId = await loeseTokenAuf({ abfrage: roh }, token);
      if (benutzerId === null) return null;

      /*
       * Welche Gesellschaften dieser Mensch traegt, sagt die Datenbank --
       * nicht der Token. Ein Konto, dem eine Mitgliedschaft entzogen wurde,
       * verliert sie damit auch im Feed, ohne dass jemand den Token drehen
       * muesste.
       */
      const mandanten = await roh<{ id: string; slug: string }>(
        `select m.id::text as id, m.slug
           from benutzer_mandant bm
           join mandant m on m.id = bm.mandant_id
          where bm.benutzer_id = $1::uuid and bm.entzogen_am is null
          order by m.sortierung, m.slug`, [benutzerId]);
      if (mandanten.length === 0) return { name: 'CSE', termine: [] as Termin[] };

      const [uhr] = await roh<{ von: string; bis: string; jetzt: string }>(
        `select (app.berlin_heute() - $1::int)::text as von,
                (app.berlin_heute() + $2::int)::text as bis,
                now()::text as jetzt`, [RUECKBLICK_TAGE, VORSCHAU_TAGE]);

      const termine: Termin[] = [];
      for (const m of mandanten) {
        /*
         * Je Gesellschaft eine gebundene Sitzung. Beide in EINE zu binden
         * hiesse, `app.aktiver_mandant()` gaebe es nicht -- und genau daran
         * haengen die Policies, die entscheiden, was sichtbar ist
         * (Invariante 3).
         */
        await bindeAnfrage(tx, {
          benutzerId, personId: null, aktiverMandantId: m.id, ansicht: 'mandant',
          aal: 'aal1', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000000',
        });
        const zeilen = await kalenderZeilen({ abfrage: roh }, {
          zeitraum: { von: uhr!.von, bis: uhr!.bis, bezeichnung: 'Feed' },
          nurBenutzerId: benutzerId,
        }, m.slug);
        for (const z of zeilen) {
          termine.push({
            /*
             * Die UID traegt die QUELLE mit: derselbe Zaehler koennte in zwei
             * Tabellen dieselbe UUID haben, und zwei VEVENTs mit gleicher UID
             * sind fuer ein Kalenderprogramm ein Termin, der sich selbst
             * ueberschreibt.
             */
            uid: `${z.quelle}-${z.id}@cse-gruppe.de`,
            titel: z.titel,
            beginn: new Date(z.beginn),
            ende: new Date(z.ende),
            ganztaegig: z.ganztaegig,
            beschreibung: z.beschreibung,
            ort: z.ort,
            abgesagt: z.abgesagt,
            geaendert: z.geaendert === null ? null : new Date(z.geaendert),
          });
        }
      }
      return { name: 'CSE Gruppe', termine, jetzt: new Date(uhr!.jetzt) };
    })) as { name: string; termine: Termin[]; jetzt?: Date } | null;

  if (ergebnis === null) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ics = alsIcal(
    { name: ergebnis.name, jetzt: ergebnis.jetzt ?? new Date() },
    ergebnis.termine,
  );
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="cse-kalender.ics"',
      'cache-control': 'no-store',
      // Der Feed ist kein Dokument fuer andere Herkuenfte (SEC-A7).
      'x-content-type-options': 'nosniff',
    },
  });
}
