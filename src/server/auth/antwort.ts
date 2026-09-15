import { NextResponse } from 'next/server';
import {
  KontoGesperrtFehler, NichtAngemeldetFehler, NichtGefundenFehler,
  ZuVieleVersucheFehler, ZweiterFaktorFehler,
} from './fehler.js';

/**
 * Die HTTP-Antwort zu einem Autorisierungsfehler — an EINER Stelle.
 *
 * **Warum das eine eigene Datei bekommt.** `authorize` wirft; jede Route, die
 * es aufruft, muss den Wurf uebersetzen. Wer das vergisst, bekommt fuer ein
 * FEHLENDES RECHT eine **500** — und damit genau das Orakel, das AUT-06
 * verhindern soll: 500 heisst „hier ist etwas", 404 heisst nichts. Der Fall
 * faellt beim Bauen nicht auf, weil er nur eintritt, wenn jemand ohne das
 * Recht die Route aufruft; im gruenen Pfad wirft niemand.
 *
 * `null` heisst: DIESER Fehler gehoert nicht hierher. Der Aufrufer wirft ihn
 * weiter, damit ein Programmfehler ein roter Lauf bleibt und nicht als huebsche
 * 404 im Formular landet.
 */
export function autorisierungsAntwort(fehler: unknown): NextResponse | null {
  if (fehler instanceof NichtGefundenFehler) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  if (fehler instanceof NichtAngemeldetFehler) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (fehler instanceof ZweiterFaktorFehler) {
    return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
  }
  if (fehler instanceof KontoGesperrtFehler) {
    return NextResponse.json({ fehler: 'konto_gesperrt' }, { status: 403 });
  }
  if (fehler instanceof ZuVieleVersucheFehler) {
    return NextResponse.json({ fehler: 'zu_viele_versuche' }, { status: 429 });
  }
  return null;
}
