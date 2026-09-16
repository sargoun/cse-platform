import { NextResponse } from 'next/server';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { BautagebuchFehler } from '@/server/services/bau/bautagebuch';

/**
 * Die Fehleruebersetzung der beiden Bautagebuchrouten — an EINER Stelle.
 *
 * Zwei Handler mit derselben `try`-Kaskade sind zwei Stellen, an denen ein
 * Fall fehlen kann; und der Fall, der zuerst fehlt, ist immer derselbe: ein
 * fehlendes Recht, das als 500 endet statt als 404. AUT-06 verlangt, dass
 * „darf ich nicht" und „gibt es nicht" von aussen gleich aussehen — ein 403
 * bestaetigt die Existenz dessen, was es verweigert.
 */
export function alsAntwort(fehler: unknown): NextResponse | null {
  if (fehler instanceof BautagebuchFehler) {
    return NextResponse.json(
      { fehler: fehler.code, meldung: fehler.message }, { status: fehler.status },
    );
  }
  /*
   * Die Autorisierungswuerfe stehen in `server/auth/antwort.ts` — dieselbe
   * Uebersetzung, die jede andere schreibende Route braucht. Zwei Abschriften
   * davon weichen irgendwann in einem Statuscode voneinander ab, und ein
   * abweichender Statuscode ist ein Orakel (AUT-06).
   */
  const autorisierung = autorisierungsAntwort(fehler);
  if (autorisierung !== null) return autorisierung;
  /**
   * `null` heisst: DIESER Fehler gehoert nicht hierher. Der Aufrufer wirft ihn
   * weiter, damit ein Programmfehler ein roter Lauf bleibt und nicht als
   * huebsche 400 im Formular landet.
   */
  return null;
}
