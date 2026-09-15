import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type postgres from 'postgres';
import { db } from '../db/pool.js';
import { ALT_SITZUNG_COOKIE, SITZUNG_COOKIE, beendeSitzung, sitzungsKeksOptionen } from './sitzung.js';
import { istGleicherUrsprung } from './ursprung.js';

/**
 * Das Abmelden — einmal geschrieben, von zwei Adressen benutzt.
 *
 * `/auth/abmelden` ist der Weg aus der Spezifikation (§3, „route handler, POST
 * only"); `/api/abmelden` ist der aeltere, auf den bereits Formulare zeigen.
 * Beide muessen dasselbe tun, und zwar ohne dass jemand die zweite Kopie
 * pflegen muss — ein Abmelden, das an einer der beiden Adressen die Zeile
 * offen laesst, faellt niemandem auf.
 *
 * Der Unterschied ist einzig das Ziel danach: aus dem Portal zurueck zur
 * Anmeldung, von der Website zur Website.
 */
export async function meldeAb(anfrage: NextRequest, ziel: string): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }

  const keks = await cookies();
  const token = keks.get(SITZUNG_COOKIE)?.value ?? '';

  // Zuerst die Zeile, dann der Keks: umgekehrt bliebe die Sitzung offen,
  // waehrend der Browser sie vergisst.
  if (token !== '') {
    await db().begin(async (tx: postgres.TransactionSql) => {
      await beendeSitzung(tx, token);
    });
  }

  const antwort = NextResponse.redirect(new URL(ziel, anfrage.nextUrl.origin), 303);
  // Dieselben Attribute wie beim Setzen, nur `maxAge: 0` — ein Keks wird nur
  // geloescht, wenn Pfad und Flags zum gesetzten passen.
  antwort.cookies.set(SITZUNG_COOKIE, '', { ...sitzungsKeksOptionen(), maxAge: 0 });
  if (SITZUNG_COOKIE !== ALT_SITZUNG_COOKIE) {
    antwort.cookies.set(ALT_SITZUNG_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  }
  return antwort;
}
