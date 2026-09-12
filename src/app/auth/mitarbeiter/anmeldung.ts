import 'server-only';
import { CODE_GUELTIG_MINUTEN } from '@/server/auth/mitarbeiter-anmeldung';

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
export function anmeldeKeksOptionen(): {
  httpOnly: true; sameSite: 'lax'; path: string; maxAge: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/auth/mitarbeiter',
    maxAge: CODE_GUELTIG_MINUTEN * 60,
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Woher die Anfrage kommt — fuer die Spalte `ip` am Einmalcode.
 *
 * **Nur der ERSTE Eintrag aus `x-forwarded-for`, und auch der nur, wenn er
 * wie eine Adresse aussieht.** Der Kopf ist vom Aufrufer frei setzbar; wer
 * ihn mit einer Liste fuellt, fuellt sonst eine `inet`-Spalte mit Text, den
 * niemand mehr auswerten kann. Bei allem, was nicht passt: `null` — eine
 * fehlende Herkunft ist ehrlicher als eine erfundene.
 */
export async function herkunft(kopf: Headers): Promise<{ ip: string | null }> {
  const roh = (kopf.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  const istIpv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$/u;
  const istIpv6 = /^[0-9a-fA-F:]{2,45}$/u;
  const ip = istIpv4.test(roh) || (roh.includes(':') && istIpv6.test(roh)) ? roh : null;
  return Promise.resolve({ ip });
}
