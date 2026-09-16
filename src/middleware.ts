import { NextResponse, type NextRequest } from 'next/server';
import { KOPF_CHECKIN_MARKE, KOPF_PFAD, KOPF_SPRACHE } from '@/lib/kopf';
import { zerlegePfad } from '@/lib/sprache';
import { MARKE_KEKS, MARKE_KEKS_PFAD } from '@/lib/checkin-marke';

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
  /*
   * **Die ausgegebene Check-in-Marke reist genau einen Bildschirm weit**
   * (TIM-09, D-579).
   *
   * Der Keks kommt als Übergabe aus `POST /api/checkin-marken`. Verbraucht
   * werden muss er, sobald die Seite ihn gezeigt hat — ein Klartext-Zugang,
   * der liegen bleibt, ist der Anfang jedes Zugangsproblems.
   *
   * **Beide naheliegenden Wege sind zu:**
   *
   *  - Die SEITE kann ihn nicht wegnehmen. Sie tat es (`keks.delete()` im
   *    Rendern) und warf dabei — Next 15 lässt Keksänderungen nur in einer
   *    Server-Action oder einem Routenhandler zu. Wer eine Marke ausgab, bekam
   *    die Fehlerhülle, und die Marke war WEG: sie kommt genau einmal im
   *    Klartext.
   *  - Löscht ihn die Middleware einfach, sieht die Seite ihn ebenfalls nicht
   *    mehr. Next führt die Keksschublade der Antwort auch nach unten durch,
   *    und `cookies()` gibt dann nichts zurück. Nachgemessen, nicht vermutet:
   *    genau das ist beim ersten Versuch passiert.
   *
   * Deshalb wird er hier EINMAL gelesen, als Kopf weitergereicht — dieselbe
   * Bauart wie `KOPF_SPRACHE` und `KOPF_PFAD` zwei Zeilen höher — und auf
   * derselben Antwort abgeräumt. Die Seite bekommt ihn, das nächste Laden
   * nicht.
   *
   * **Nur auf diesem einen Pfad.** Der Keks gilt für `/portal`; räumte ihn
   * jede Portalseite ab, nähme ihn eine beliebige andere Anfrage weg, bevor
   * der Bildschirm ihn zeigt, der ihn braucht.
   */
  const holtMarke = pfad.endsWith('/zeiten/checkin-links');
  const marke = holtMarke ? anfrage.cookies.get(MARKE_KEKS)?.value : undefined;
  if (marke !== undefined && marke !== '') koepfe.set(KOPF_CHECKIN_MARKE, marke);

  const antwort = NextResponse.next({ request: { headers: koepfe } });

  /*
   * `path` muss beim Löschen derselbe sein wie beim Setzen, sonst löscht der
   * Browser einen anderen Keks — nämlich keinen.
   */
  if (marke !== undefined && marke !== '') {
    antwort.cookies.set({
      name: MARKE_KEKS, value: '', path: MARKE_KEKS_PFAD, maxAge: 0,
    });
  }

  return antwort;
}

export const config = {
  // Alles ausser den statischen Auslieferungen von Next selbst. `/api` bleibt
  // bewusst drin: eine Formularantwort soll in der Sprache kommen, in der das
  // Formular stand.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
