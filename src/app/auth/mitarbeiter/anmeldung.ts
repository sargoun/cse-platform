import 'server-only';
import { isIP } from 'node:net';
import { CODE_GUELTIG_MINUTEN } from '@/server/auth/mitarbeiter-anmeldung';
import { keksSicher } from '@/server/auth/sitzung';
import type { Umgebung } from '@/lib/dev-flaechen';

/**
 * Was zwischen den beiden Anmeldeschritten liegt — an einer Stelle.
 *
 * Zwei Seiten teilen sich drei Dinge: die Namen der Kekse, ihre Lebensdauer
 * und die Frage, woher eine Anfrage kommt. Stuenden sie doppelt, wuerde genau
 * eine der beiden Kopien irgendwann geaendert.
 */

/** Die eingetippte Nummer, kurzlebig, `httpOnly`. */
export const ANMELDUNG_TELEFON_COOKIE = 'cse_anmeldung_telefon';

/**
 * Der Klartextcode — NUR auf der Entwicklungsflaeche, siehe `SmsDienst.zeigtCode`.
 *
 * Er steht in einem eigenen Keks und nicht im selben wie die Nummer, damit
 * „es gibt ihn" und „es gibt ihn nicht" zwei verschiedene Zustaende sind und
 * nicht ein Feld, das mal leer ist.
 */
export const ANMELDUNG_DEV_COOKIE = 'cse_anmeldung_devcode';

/**
 * Beide Kekse leben genau so lange wie der Code selbst.
 *
 * Laenger waere eine Nummer, die ohne Grund im Browser liegen bleibt; kuerzer
 * hiesse, dass jemand mit einem gueltigen Code auf eine Seite kommt, die nicht
 * mehr weiss, zu welcher Nummer er gehoert.
 */
/**
 * **Hier stand `secure: process.env.NODE_ENV === 'production'` — und das war
 * der Fehler, der die Anmeldung am Telefon unmoeglich machte.**
 *
 * Nicht wegen der Bedingung, sondern wegen der SCHREIBWEISE. `process.env.X`
 * als Literal im Quelltext ist fuer Webpacks DefinePlugin kein Zugriff,
 * sondern eine Konstante: beim Bau wird der ganze Ausdruck durch sein
 * Ergebnis ersetzt. Im gebauten Buendel stand woertlich
 *
 *     httpOnly:!0,sameSite:"lax",path:"/auth/mitarbeiter",…,secure:!0
 *
 * — `secure: true`, einkompiliert, durch keine Umgebungsvariable mehr
 * erreichbar. Zum Vergleich derselbe Bau, derselbe Keksspeicher, der
 * Sitzungskeks:
 *
 *     secure:"production"===a.NODE_ENV
 *
 * Dort steht die Frage noch, weil `sitzungsKeksOptionen` ueber einen
 * PARAMETER liest und DefinePlugin einen Feldzugriff auf eine Variable nicht
 * ersetzen kann. Zwei Keksfabriken, ein Unterschied von drei Zeichen, und nur
 * eine davon liess sich reparieren.
 *
 * **Was daraus wurde.** Ueber `http://192.168.0.193` verwirft der Browser
 * einen `Secure`-Keks vollstaendig (RFC 6265bis §5.5). Beide Anmeldekekse
 * waren also weg, bevor der Mensch den Code eintippen konnte. Dass die
 * Codeseite trotzdem erschien UND den Entwicklungscode zeigte, ist kein
 * Widerspruch: Next.js rendert das Ziel einer `redirect()` aus einer Server
 * Action in DERSELBEN Antwort und reicht dabei die eben gesetzten Kekse
 * serverintern weiter (`action-handler.js`, `getForwardedHeaders`). `Secure`
 * ist eine Browserregel und greift auf diesem Weg nicht. Erst der naechste
 * Schritt war ein eigener Request — und der kam keksfrei an.
 *
 * Die Entscheidung steht jetzt an EINER Stelle (`keksSicher`), damit
 * Anmeldekeks und Sitzungskeks nicht wieder verschieden antworten.
 */
export function anmeldeKeksOptionen(umgebung: Umgebung = process.env): {
  httpOnly: true; sameSite: 'lax'; path: string; maxAge: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/auth/mitarbeiter',
    maxAge: CODE_GUELTIG_MINUTEN * 60,
    secure: keksSicher(umgebung),
  };
}

/**
 * Woher die Anfrage kommt — fuer die Spalte `ip` am Einmalcode.
 *
 * **Nur der ERSTE Eintrag aus `x-forwarded-for`, und auch der nur, wenn er
 * eine Adresse IST.** Der Kopf ist vom Aufrufer frei setzbar; wer ihn mit
 * einer Liste fuellt, fuellt sonst eine `inet`-Spalte mit Text, den niemand
 * mehr auswerten kann. Bei allem, was nicht passt: `null` — eine fehlende
 * Herkunft ist ehrlicher als eine erfundene.
 *
 * **`isIP` aus `node:net` und nicht ein eigener Ausdruck.** Die Vorfassung
 * pruefte IPv6 mit `/^[0-9a-fA-F:]{2,45}$/` — das trifft `:::` und `::::::`
 * und ein Dutzend weiterer Zeichenketten, die keine Adresse sind. Sie kamen
 * als „IP" zurueck und liefen in den `inet`-Parameter, wo Postgres sie
 * abweist: aus einem manipulierten Kopf wird so ein FEHLER der Anmeldung
 * statt einer fehlenden Herkunft. Genau das soll diese Funktion verhindern.
 */
export async function herkunft(kopf: Headers): Promise<{ ip: string | null }> {
  const roh = (kopf.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  return Promise.resolve({ ip: isIP(roh) === 0 ? null : roh });
}
