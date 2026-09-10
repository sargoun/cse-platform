import { NextResponse, type NextRequest } from 'next/server';
import { KOPF_PFAD, KOPF_SPRACHE } from '@/lib/kopf';
import { zerlegePfad } from '@/lib/sprache';

/**
 * Traegt die Sprache der Anfrage in einen Kopf, damit das Wurzel-Layout sie
 * kennt.
 *
 * **Warum ueberhaupt.** `<html lang>` steht im Wurzel-Layout, und das weiss in
 * Next.js nichts vom Pfad — es bekommt nur `children`. Ohne diesen Umweg
 * traegt eine englische Seite `lang="de-DE"`, und ein Screenreader liest
 * englischen Text mit deutscher Aussprache vor. Das ist kein Schoenheitsfehler,
 * sondern WCAG 3.1.1, und BFSG gilt fuer dieses Angebot.
 *
 * Der Kopf wird auf die ANFRAGE gesetzt, nicht auf die Antwort: er ist eine
 * Information fuer den Server und gehoert nicht in die Auslieferung.
 */
export function middleware(anfrage: NextRequest): NextResponse {
  const { sprache, pfad } = zerlegePfad(anfrage.nextUrl.pathname);
  const koepfe = new Headers(anfrage.headers);
  koepfe.set(KOPF_SPRACHE, sprache);
  // Der Pfad OHNE Praefix. Die Huelle braucht ihn fuer die Sprachwahl, und ein
  // Layout kennt in Next.js weder Pfad noch Suchparameter — es bekommt nur
  // `children`. Ohne diesen Kopf zeigte jeder Sprachwechsel auf die Startseite.
  koepfe.set(KOPF_PFAD, pfad);
  return NextResponse.next({ request: { headers: koepfe } });
}

export const config = {
  // Alles ausser den statischen Auslieferungen von Next selbst. `/api` bleibt
  // bewusst drin: eine Formularantwort soll in der Sprache kommen, in der das
  // Formular stand.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
