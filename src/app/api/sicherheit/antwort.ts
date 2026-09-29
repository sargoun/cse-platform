import { NextResponse, type NextRequest } from 'next/server';
import { anmeldungsAntwort, nichtGefundenAntwort } from '@/server/auth/antwort';
import { NichtGefundenFehler } from '@/server/auth/fehler';

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
export function alsAntwort(fehler: unknown, anfrage: NextRequest): NextResponse | null {
  if (fehler instanceof NichtGefundenFehler) return nichtGefundenAntwort();
  /*
   * Keine Sitzung, kein zweiter Faktor: für ein Browserformular eine Seite
   * (Anmeldung, Faktor-Schritt), für ein Programm JSON wie bisher (D-766).
   * VOR der allgemeinen Weiche unten — beide Klassen tragen `status` und
   * `code` und wären dort ein „fachlicher Fehler".
   */
  const anmeldung = anmeldungsAntwort(fehler, anfrage);
  if (anmeldung !== null) return anmeldung;
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
