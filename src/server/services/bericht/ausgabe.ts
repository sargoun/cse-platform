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

/** Ein Feld nach RFC 4180 — und `\r\n` als Zeilenende, wie die Norm sagt. */
export function csvFeld(wert: string | number | null): string {
  if (wert === null) return '';
  const text = typeof wert === 'number' ? String(wert) : wert;
  return /[";\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function alsCsv<Z>(spalten: readonly Spalte<Z>[], zeilen: readonly Z[]): string {
  const koepfe: string[] = [];
  for (const s of spalten) {
    koepfe.push(csvFeld(s.kopf));
    if (s.cent !== undefined) koepfe.push(csvFeld(`${s.kopf} (Cent)`));
  }

  const ausgabe = [koepfe.join(';')];
  for (const z of zeilen) {
    const felder: string[] = [];
    for (const s of spalten) {
      felder.push(csvFeld(s.wert(z)));
      if (s.cent !== undefined) {
        const c = s.cent(z);
        felder.push(csvFeld(c === null ? null : String(c)));
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

/** Basispunkte als Prozent mit zwei Stellen — `2500` wird „25,00 %". */
export function prozent(bp: number | null): string {
  if (bp === null) return '';
  const ganz = Math.trunc(bp / 100);
  const rest = Math.abs(bp % 100);
  return `${String(ganz)},${String(rest).padStart(2, '0')} %`;
}

/** Minuten als Stunden mit zwei Stellen — nie als Fliesskomma gerechnet. */
export function stunden(minuten: number | null): string {
  if (minuten === null) return '';
  const negativ = minuten < 0;
  const abs = Math.abs(minuten);
  const std = Math.trunc(abs / 60);
  const min = abs % 60;
  return `${negativ ? '−' : ''}${String(std)}:${String(min).padStart(2, '0')} h`;
}
