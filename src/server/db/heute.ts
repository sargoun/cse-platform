import 'server-only';
import { db } from './pool';

/**
 * Welcher Berliner Kalendertag ist jetzt? — gefragt wird die DATENBANK.
 *
 * Der naheliegende Ausdruck ist `new Date().toISOString().slice(0, 10)`, und
 * er ist zweimal falsch:
 *
 *  - Er liest die Uhr des **Node-Prozesses**. Invariante 5 sagt, dass der
 *    Server entscheidet, welche Zeit ist; eine Vercel-Funktion, deren Uhr um
 *    Minuten abweicht, verschiebt sonst die angezeigte Woche.
 *  - Er liest sie in **UTC**. Zwischen Mitternacht und 02:00 Berliner Zeit ist
 *    der UTC-Tag noch der gestrige — der Planer, der um 00:30 am Montag den
 *    Dienstplan öffnet, sähe die VORIGE Woche. Der Fehler tritt genau dann
 *    auf, wenn niemand hinsieht, und sieht dabei völlig plausibel aus.
 *
 * Eine Zeile, eine Rundreise, keine Tabelle: `now()` braucht keine Sitzung und
 * keine Bindung, also läuft die Frage ohne Transaktion.
 */
export async function berlinHeute(): Promise<string> {
  const zeilen = (await db().unsafe(
    `select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD') as tag`,
  )) as unknown as readonly { readonly tag: string }[];
  const tag = zeilen[0]?.tag;
  if (tag === undefined) {
    // Kein stiller Rückfall auf die Prozessuhr: eine Antwort, die vielleicht
    // stimmt, ist hier schlechter als eine Ausnahme, die jemand sieht.
    throw new Error('Die Datenbank hat kein Datum zurückgegeben.');
  }
  return tag;
}
