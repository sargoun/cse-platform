import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { SITZUNG_COOKIE, beendeSitzung, sitzungsKeksOptionen } from '@/server/auth/sitzung';
import { istGleicherUrsprung } from '@/server/auth/ursprung';

/**
 * `POST /api/abmelden` — die Sitzung beenden.
 *
 * **POST und nicht GET**, aus demselben Grund, aus dem die Bereichswahl ein
 * Formular ist und kein Verweis: ein GET, das Zustand aendert, laesst sich von
 * einem fremden Bild-Tag, einem Vorauslader oder einem Suchroboter ausloesen.
 * Eine Abmeldung, die jemand anders fuer dich vornehmen kann, ist ein
 * Aergernis; dieselbe Bauart an einer gefaehrlicheren Stelle waere ein Loch.
 *
 * **Zuerst die Zeile, dann der Keks.** Umgekehrt bliebe die Sitzung offen,
 * waehrend der Browser sie vergisst — wer den Token noch hat, waere weiter
 * angemeldet, und niemand saehe es. Die Verbindung laeuft als Eigentuemer, wie
 * beim Ausstellen: der Aufrufer weist sich durch den BESITZ des Tokens aus,
 * nicht durch eine Mitgliedschaft, und genau diese eine Zeile darf er
 * schliessen.
 */
export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  /**
   * Dasselbe Ursprungstor wie vor jedem anderen schreibenden Handler.
   *
   * Es fehlte hier als einzigem Sitzungs-Handler. `sameSite: 'lax'` haelt
   * ein fremdes Formular zwar schon ab — aber eine Massnahme, die woanders
   * greift, ersetzt die hiesige nicht (`ursprung.ts`): wer eine Sitzung
   * beenden darf, ist die Anwendung selbst, nicht irgendeine Seite im Netz.
   */
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }

  const keks = await cookies();
  const token = keks.get(SITZUNG_COOKIE)?.value ?? '';

  if (token !== '') {
    await db().begin(async (tx: postgres.TransactionSql) => {
      await beendeSitzung(tx, token);
    });
  }

  const antwort = NextResponse.redirect(new URL('/', anfrage.nextUrl.origin), 303);
  // Dieselben Attribute wie beim Setzen, nur `maxAge: 0` — ein Keks wird nur
  // geloescht, wenn Pfad und Flags zum gesetzten passen.
  antwort.cookies.set(SITZUNG_COOKIE, '', { ...sitzungsKeksOptionen(), maxAge: 0 });
  return antwort;
}
