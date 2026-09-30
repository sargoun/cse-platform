import type { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { keksSicher } from '@/server/auth/sitzung';

/**
 * **Die Rückmeldung der Pflegeseiten reist als kurzlebiger Keks, nicht in der
 * Adresse** (V-277, D-775).
 *
 * Elf Pflegeseiten (Stammdaten, Einstellungen, Mahnungen) zeigten, was ihre
 * Route als `?hinweis=<Satz>` schickte — und damit auch jeden Text aus einem
 * präparierten Link (D-769). Ihre Sätze tragen Werte (Bezeichnung, Datum,
 * Anzahl, Mahnnummer) und Bedingungen; sie in Schlüssel zu zerlegen hätte
 * genau die Auskunft gekostet, derentwegen es sie gibt. Der Satz geht deshalb
 * in einen Keks, den nur diese Anwendung setzen kann:
 *
 *  - `path` ist die Zielseite, und der Wert nennt sie noch einmal: `path`
 *    schliesst Unterseiten ein (die Mahnungsliste deckt jedes Mahnungsblatt),
 *    die Seite zeigt den Satz deshalb nur, wenn der Keks IHR gilt. Liegen
 *    zwei Kekse dieses Namens vor (Liste und Blatt), schickt der Browser
 *    beide; Nexts `cookies()` behielte nur den letzten, also den der Liste.
 *    Die Seite liest darum den rohen `Cookie`-Kopf (`hinweisAusKopf`).
 *  - `maxAge` 15 Sekunden: er gilt für die Rückkehr nach dem Absenden (der
 *    Browser folgt der Umleitung sofort), nicht für später. Wer die Seite in
 *    diesen Sekunden neu lädt oder wieder aufruft, sieht ihn noch einmal — das
 *    ist der Preis dafür, dass eine Seite beim Lesen nichts schreibt.
 *  - `httpOnly`, `sameSite: 'lax'`, `secure` wie jeder Keks (`keksSicher`).
 *
 * Ein fremder Link kann keinen Keks dieser Anwendung setzen, und die Routen
 * nehmen nur Anfragen desselben Ursprungs an (`istGleicherUrsprung`).
 */
export const HINWEIS_KEKS = 'cse_hinweis';
export const HINWEIS_KEKS_SEKUNDEN = 15;

/**
 * Browser nehmen einen Keks bis 4096 Byte (Name, Wert und Merkmale). Next
 * verschlüsselt den Wert mit `encodeURIComponent` — gemessen wird darum der
 * verschlüsselte Satz, und er bleibt deutlich unter der Grenze.
 */
export const HINWEIS_HOECHSTENS_BYTES = 3000;

/**
 * Kürzt den Satz, bis er in den Keks passt — zeichenweise, damit kein halbes
 * Ersatzpaar entsteht (`encodeURIComponent` würfe daran).
 */
export function gekuerzterHinweis(text: string): string {
  let laenge = 0;
  let ergebnis = '';
  for (const zeichen of text) {
    laenge += encodeURIComponent(zeichen).length;
    if (laenge > HINWEIS_HOECHSTENS_BYTES) return `${ergebnis}…`;
    ergebnis += zeichen;
  }
  return ergebnis;
}

/** Trennt die Zielseite vom Satz im Wert des Kekses; ein Pfad enthält ihn nie. */
const TRENNER = '\n';

/** Hängt die Rückmeldung als Keks an die Umleitung — für genau die Zielseite. */
export function mitHinweis(antwort: NextResponse, ziel: URL, hinweis: string | undefined): NextResponse {
  if (hinweis === undefined || hinweis.trim() === '') return antwort;
  const wert = `${ziel.pathname}${TRENNER}${gekuerzterHinweis(hinweis.trim())}`;
  antwort.cookies.set(HINWEIS_KEKS, wert, {
    httpOnly: true,
    sameSite: 'lax',
    path: ziel.pathname,
    maxAge: HINWEIS_KEKS_SEKUNDEN,
    secure: keksSicher(),
  });
  return antwort;
}

/**
 * Die Rückmeldung aus dem Wert des Kekses — oder `null`, wenn es keine gibt
 * oder der Keks einer anderen Seite gilt.
 */
export function hinweisAusKeks(wert: string | undefined, pfad: string): string | null {
  if (wert === undefined) return null;
  const trenner = wert.indexOf(TRENNER);
  if (trenner < 0 || wert.slice(0, trenner) !== pfad) return null;
  const text = gekuerzterHinweis(wert.slice(trenner + TRENNER.length)).trim();
  return text === '' ? null : text;
}

/**
 * Die Rückmeldung für `pfad` aus dem rohen `Cookie`-Kopf — aus JEDEM Keks
 * dieses Namens, nicht nur dem letzten.
 */
export function hinweisAusKopf(kopf: string | null, pfad: string): string | null {
  if (kopf === null) return null;
  for (const paar of kopf.split(/; */u)) {
    const gleich = paar.indexOf('=');
    if (gleich < 0 || paar.slice(0, gleich).trim() !== HINWEIS_KEKS) continue;
    let wert: string;
    try {
      wert = decodeURIComponent(paar.slice(gleich + 1));
    } catch {
      continue;
    }
    const hinweis = hinweisAusKeks(wert, pfad);
    if (hinweis !== null) return hinweis;
  }
  return null;
}

/** Liest die Rückmeldung der Seite `pfad` — oder `null`, wenn es keine gibt. */
export async function gelesenerHinweis(pfad: string): Promise<string | null> {
  return hinweisAusKopf((await headers()).get('cookie'), pfad);
}
