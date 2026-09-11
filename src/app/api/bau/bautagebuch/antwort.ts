import { NextResponse } from 'next/server';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '@/server/auth/fehler';
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
  if (fehler instanceof NichtGefundenFehler) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (fehler instanceof NichtAngemeldetFehler) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (fehler instanceof ZweiterFaktorFehler) {
    return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
  }
  /**
   * `null` heisst: DIESER Fehler gehoert nicht hierher. Der Aufrufer wirft ihn
   * weiter, damit ein Programmfehler ein roter Lauf bleibt und nicht als
   * huebsche 400 im Formular landet.
   */
  return null;
}
