import 'server-only';
import { formatiereGeld } from '../finanz/geld.js';
import type { Cent } from '../finanz/geld.js';

/**
 * Ein Bericht als Datei (REP-07).
 *
 * **CSV nach RFC 4180, UTF-8 mit BOM.** Das BOM ist kein Schmuck: ohne es
 * liest Excel unter Windows die Datei als Windows-1252, und aus „Gebäude"
 * wird „GebÃ¤ude". Der DATEV-Export geht bewusst den anderen Weg
 * (Windows-1252, weil die Gegenstelle es so verlangt) — hier liest ein
 * Mensch, und der arbeitet mit Umlauten.
 *
 * **Semikolon, nicht Komma.** Deutsche Zahlen tragen ein Dezimalkomma; ein
 * Komma als Trenner daneben ist die klassische Art, eine Tabelle zu
 * zerlegen, die richtig war.
 *
 * **Geld steht formatiert drin und daneben in Cent.** Die formatierte Spalte
 * liest ein Mensch, die Cent-Spalte rechnet eine Maschine weiter — und
 * niemand muss aus „1.234,56 €" wieder eine Zahl machen und dabei raten,
 * welches Zeichen der Tausenderpunkt war (R-12, Invariante 1).
 */

export interface Spalte<Z> {
  readonly kopf: string;
  readonly wert: (zeile: Z) => string | number | null;
  /** Geldspalten bekommen zusätzlich eine Cent-Spalte. */
  readonly cent?: (zeile: Z) => Cent | null;
}

const BOM = '﻿';

/**
 * Zeichen, mit denen eine Tabellenkalkulation eine FORMEL beginnt.
 *
 * `@` ist das älteste (Lotus, und Excel kennt es bis heute), `=` das
 * offensichtliche; `+` und `-` beginnen ebenfalls einen Ausdruck. Tabulator
 * und Wagenrücklauf stehen dabei, weil manche Leser sie vor der Prüfung
 * abschneiden und dann doch auf eines der vier treffen.
 */
const FORMELSTART = /^[=+\-@\t\r]/u;

/**
 * Ein Feld nach RFC 4180 — und `\r\n` als Zeilenende, wie die Norm sagt.
 *
 * **Und ein Textfeld, das wie eine Formel beginnt, bekommt ein `'` davor.**
 * RFC 4180 kennt keine Formeln; Excel und LibreOffice schon. Ein Projektname
 * `=HYPERLINK(...)`, eine UTM-Kampagne `+cmd`, ein Kundenname `@…` — alles
 * Werte, die jemand von aussen in die Datenbank schreiben kann — werden beim
 * Öffnen der Datei ausgeführt, nicht gezeigt. Das Hochkomma ist die von
 * beiden Programmen verstandene Marke für „das ist Text"; es steht in der
 * Zelle nicht mit drin.
 *
 * **Zahlen bleiben Zahlen.** Die Cent-Spalte und die Kopfzeile gehen `roh`
 * durch: beide entstehen in dieser Datei, und ein `'-1999` in der Cent-Spalte
 * rechnete in keiner Tabelle mehr. Eine formatierte Zahl wie `-19,99 €` oder
 * `-12,50 %` bekommt das Hochkomma dagegen schon — sie ist ohnehin Text, und
 * in der Zelle sieht man davon nichts. Wer mit den Beträgen rechnen will,
 * nimmt die Cent-Spalte; genau dafuer steht sie da.
 */
export function csvFeld(wert: string | number | null, roh = false): string {
  if (wert === null) return '';
  if (typeof wert === 'number') return String(wert);
  const text = roh || !FORMELSTART.test(wert) ? wert : `'${wert}`;
  return /[";\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function alsCsv<Z>(spalten: readonly Spalte<Z>[], zeilen: readonly Z[]): string {
  const koepfe: string[] = [];
  for (const s of spalten) {
    /* Die Kopfzeile steht in dieser Datei, nicht in der Datenbank. */
    koepfe.push(csvFeld(s.kopf, true));
    if (s.cent !== undefined) koepfe.push(csvFeld(`${s.kopf} (Cent)`, true));
  }

  const ausgabe = [koepfe.join(';')];
  for (const z of zeilen) {
    const felder: string[] = [];
    for (const s of spalten) {
      felder.push(csvFeld(s.wert(z)));
      if (s.cent !== undefined) {
        const c = s.cent(z);
        /*
         * Die Cent-Spalte ist eine ganze Zahl aus dieser Datei, kein Text aus
         * der Datenbank -- sie geht `roh` durch, damit ein negativer Betrag
         * nicht als `'-1999` in der Tabelle landet und dort nicht mehr rechnet.
         */
        felder.push(c === null ? '' : csvFeld(String(c), true));
      }
    }
    ausgabe.push(felder.join(';'));
  }
  return BOM + ausgabe.join('\r\n') + '\r\n';
}

/** Ein Dateiname ohne Überraschungen — ASCII, keine Pfadtrenner, datiert. */
export function dateiname(bericht: string, bereich: string, zeitraum: string): string {
  const sauber = (t: string): string =>
    t.normalize('NFKD').replace(/[^\w-]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return `${sauber(bericht)}_${sauber(bereich)}_${sauber(zeitraum)}.csv`;
}

/** Geld für die Anzeige — dieselbe Funktion wie auf dem Bildschirm. */
export function geldText(c: Cent | null): string {
  return c === null ? '' : formatiereGeld(c);
}

/**
 * Basispunkte als Prozent mit zwei Stellen — `2500` wird „25,00 %".
 *
 * **Das Vorzeichen steht getrennt, nicht im ganzzahligen Teil.** Zwischen
 * −1 und −99 Basispunkten ist `Math.trunc(bp / 100)` die negative Null,
 * und `String(-0)` ist `"0"` — aus −0,50 % wurde 0,50 %, aus einer Marge
 * von einem halben Prozent UNTER null eine von einem halben Prozent darueber.
 * Genau die Spanne, in der das Vorzeichen die Aussage traegt und der Betrag
 * sie nicht verraet. Dieselbe Trennung wie in `stunden()` darunter.
 */
export function prozent(bp: number | null): string {
  if (bp === null) return '';
  const negativ = bp < 0;
  const abs = Math.abs(bp);
  const ganz = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${negativ ? '-' : ''}${String(ganz)},${String(rest).padStart(2, '0')} %`;
}

/**
 * Minuten als Stunden mit zwei Stellen — nie als Fliesskomma gerechnet.
 *
 * Das Minus ist der ASCII-Bindestrich und nicht das typografische U+2212:
 * `formatiereGeld` bekommt seines von `Intl` und das ist ASCII. In einer
 * Berichtszeile stehen Geld, Stunden und Prozent nebeneinander, und zwei
 * verschiedene Minuszeichen in einer Zeile liest ein Mensch als Unterschied,
 * wo keiner ist. Wer nach dem Zeichen filtert, findet sonst die halbe Spalte.
 */
export function stunden(minuten: number | null): string {
  if (minuten === null) return '';
  const negativ = minuten < 0;
  const abs = Math.abs(minuten);
  const std = Math.trunc(abs / 60);
  const min = abs % 60;
  return `${negativ ? '-' : ''}${String(std)}:${String(min).padStart(2, '0')} h`;
}

/**
 * Ein Kalendertag als TT.MM.JJJJ — `2026-03-01` wird „01.03.2026" (V-227).
 *
 * Die Berichte führen Tage als `YYYY-MM-DD` (Berliner Kalendertag, keine
 * Uhrzeit, keine Zone); gezeigt wird die Form, die überall im Portal steht.
 * Kein `Date`: ein Tag ohne Uhrzeit durch `new Date` zu schicken, verschiebt
 * ihn je nach Zone des Servers um einen Tag. Was keine solche Zeichenkette
 * ist, bleibt, wie es ist — erfunden wird kein Tag.
 */
export function datumText(tag: string | null): string | null {
  if (tag === null) return null;
  const t = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(tag);
  return t === null ? tag : `${t[3]!}.${t[2]!}.${t[1]!}`;
}
