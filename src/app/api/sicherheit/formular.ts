import { DA_SPRACHEN, type DaSprache } from '@/server/services/security/dienstanweisung';

/**
 * Die gemeinsamen Formularleser der Sicherheitsrouten — an EINER Stelle.
 *
 * Zwei Adressen legen Fassungen an (`…/dienstanweisungen` und
 * `…/[id]/version`), und beide müssen dieselben Felder gleich verstehen. Zwei
 * Kopien derselben Schleife gehen beim ersten zusätzlichen Feld auseinander —
 * und dann trägt die eine Fassung eine Übersetzung, die die andere verschluckt.
 *
 * Sie steht hier und nicht in `server/services/`: `FormData` ist eine Sache
 * der HTTP-Schicht, und ein Dienst, der ein Formular kennt, ist ein Dienst,
 * den man nur über HTTP testen kann.
 */

/** Ein getrimmtes Feld, oder `null` — leer und fehlend sind hier dasselbe. */
export function feldText(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

/**
 * Die Übersetzungen aus dem Formular (EMP-12).
 *
 * Ein Feld je Sprache, benannt `inhalt_de` … `inhalt_tr`. Was leer bleibt,
 * kommt gar nicht erst in die Spalte — ein Eintrag `{"tr":""}` sähe aus wie
 * eine türkische Fassung und wäre auf dem Telefon eine leere Seite unter einer
 * Überschrift, die Bestätigung verlangt.
 */
export function uebersetzungen(
  daten: FormData,
): Partial<Record<DaSprache, string>> | null {
  const werte: Partial<Record<DaSprache, string>> = {};
  for (const s of DA_SPRACHEN) {
    const t = feldText(daten, `inhalt_${s}`);
    if (t !== null) werte[s] = t;
  }
  return Object.keys(werte).length === 0 ? null : werte;
}
