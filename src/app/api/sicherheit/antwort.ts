import { NextResponse } from 'next/server';
import {
  NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler,
} from '@/server/auth/fehler';

/**
 * Die Fehlerübersetzung der drei Sicherheitsrouten — an EINER Stelle.
 *
 * Drei Handler mit derselben `try`-Kaskade sind drei Stellen, an denen ein
 * Fall fehlen kann; und der Fall, der zuerst fehlt, ist immer derselbe: ein
 * fehlendes Recht, das als 500 endet statt als 404. AUT-06 verlangt, dass
 * „darf ich nicht" und „gibt es nicht" von aussen gleich aussehen — ein 403
 * bestätigt die Existenz dessen, was es verweigert.
 *
 * Die Dienstfehler dieser Domäne tragen `code` und `status` selbst (dasselbe
 * Muster wie `EinsatzNichtGefunden` in `dienstplan/einteilung.ts`); sie
 * brauchen hier keine Zeile, sondern nur diesen einen Zweig.
 */
export function alsAntwort(fehler: unknown): NextResponse | null {
  if (fehler instanceof NichtGefundenFehler) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (fehler instanceof NichtAngemeldetFehler) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (fehler instanceof ZweiterFaktorFehler) {
    return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
  }
  const status = (fehler as { status?: number }).status;
  const code = (fehler as { code?: string }).code;
  const meldung = (fehler as { message?: string }).message;
  if (typeof status === 'number' && typeof code === 'string') {
    return NextResponse.json({ fehler: code, meldung: meldung ?? null }, { status });
  }
  /**
   * `null` heisst: DIESER Fehler gehört nicht hierher. Der Aufrufer wirft ihn
   * weiter, damit ein Programmfehler ein roter Lauf bleibt und nicht als
   * hübsche 400 im Formular landet.
   */
  return null;
}
