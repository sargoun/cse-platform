import 'server-only';

/**
 * Der Kontenrahmen — als DATEN, nicht als Code (ACC-01, `05-FINANZEN.md` §9.3).
 *
 * **Was hier bewusst NICHT steht: eine einzige Kontonummer.** SKR03 und SKR04
 * sind Kontenrahmen der DATEV, und welcher je Gesellschaft gilt, welche
 * Sachkontenlänge der Steuerberater eingerichtet hat und welches Erlöskonto
 * zu welcher Leistung gehört, ist **O-05** — offen. Eine Tabelle mit
 * „8400 Erlöse 19 %" wäre genau die Sorte plausibler Erfindung, die
 * CLAUDE.md verbietet: sie sähe richtig aus, sie liefe durch, und sie fiele
 * erst beim Steuerberater auf, auf Belegen, die nach §14 UStG nicht mehr
 * geändert werden dürfen.
 *
 * Die Zuordnung steht deshalb in `konto_mapping` — einer Tabelle, die ein
 * Mensch füllt und bestätigt. Dieses Modul hält nur, was OHNE den
 * Steuerberater feststeht: welche Rahmen es gibt, und welche Gestalt eine
 * Kontonummer in einem eingerichteten Rahmen hat.
 *
 * TODO(client, O-05): Welcher Kontenrahmen gilt je Gesellschaft (SKR03 oder
 * SKR04), und mit welcher Sachkontenlänge ist die Mandantennummer beim
 * Steuerberater eingerichtet?
 *
 * **Warum das reicht, damit ein Wechsel SKR03↔SKR04 keine Codeänderung
 * ist.** Nichts in diesem Verzeichnis verzweigt nach Rahmen: `konto_mapping`
 * trägt ihn als Spalte, `app.konto_aufloesen` filtert auf den in
 * `datev_konfiguration` eingetragenen. Ein Wechsel ist ein anderer Satz
 * Zuordnungszeilen — dieselbe Rechnung, dieselben Dienste, dasselbe Ergebnis
 * in anderen Konten.
 */

/** Die beiden Rahmen, die DATEV für diese Branche vorsieht. */
export const KONTENRAHMEN = ['skr03', 'skr04'] as const;
export type Kontenrahmen = (typeof KONTENRAHMEN)[number];

export function istKontenrahmen(wert: string): wert is Kontenrahmen {
  return (KONTENRAHMEN as readonly string[]).includes(wert);
}

/** Was auf einem Bildschirm steht — die Gliederung, nicht die Nummer. */
export const RAHMEN_NAME: Readonly<Record<Kontenrahmen, string>> = {
  skr03: 'SKR03 (Prozessgliederung)',
  skr04: 'SKR04 (Abschlussgliederung)',
};

/**
 * Die Sachkontenlänge einer Gesellschaft — **aus der Konfiguration, nie
 * geraten**.
 *
 * DATEV richtet Mandanten mit vier- bis achtstelligen Sachkonten ein; welche
 * Länge hier gilt, weiss nur der Steuerberater. `null` heisst: O-05 ist offen,
 * und dann prüft `pruefeKontonummer` nur die Gestalt, nicht die Länge.
 */
export interface RahmenEinstellung {
  readonly kontenrahmen: Kontenrahmen | null;
  readonly sachkontenlaenge: number | null;
}

export interface KontoBefund {
  readonly gueltig: boolean;
  readonly grund: string | null;
}

/**
 * Prüft die GESTALT einer Kontonummer, soweit sie ohne O-05 feststeht.
 *
 * Zwei Zusagen, und beide sind nachprüfbar ohne den Steuerberater:
 *
 *   1. Ein Sachkonto besteht aus Ziffern. Ein Konto mit Punkt, Leerzeichen
 *      oder Buchstaben ist in jedem Kontenrahmen falsch, und es fällt im
 *      EXTF-Schreiber auf, wenn niemand mehr hinsieht.
 *   2. Steht eine Sachkontenlänge in der Konfiguration, muss die Nummer sie
 *      einhalten. **Personenkonten sind ausgenommen** — sie tragen in DATEV
 *      eine Stelle mehr als die Sachkonten, und diese Regel gehört zum
 *      eingerichteten Mandanten, nicht zu unserer Vorstellung davon.
 *      TODO(client, O-05): Bestätigt der Steuerberater, dass Debitoren und
 *      Kreditoren eine Stelle länger sind als die Sachkonten?
 */
export function pruefeKontonummer(
  konto: string,
  einstellung: RahmenEinstellung,
  art: 'sachkonto' | 'personenkonto' = 'sachkonto',
): KontoBefund {
  if (!/^[0-9]+$/u.test(konto)) {
    return { gueltig: false, grund: 'Ein Konto besteht nur aus Ziffern.' };
  }
  const laenge = einstellung.sachkontenlaenge;
  if (laenge === null) {
    return { gueltig: true, grund: null };
  }
  const erwartet = art === 'personenkonto' ? laenge + 1 : laenge;
  if (konto.length !== erwartet) {
    return {
      gueltig: false,
      grund: `${art === 'personenkonto' ? 'Ein Personenkonto' : 'Ein Sachkonto'} hat hier `
        + `${String(erwartet)} Stellen, diese Nummer hat ${String(konto.length)}.`,
    };
  }
  return { gueltig: true, grund: null };
}

/**
 * Die Geschäftsvorfälle, für die eine Ausgangsrechnung eine Zuordnung
 * braucht — die Liste, aus der die Arbeitsliste „Kontenzuordnung fehlt"
 * entsteht.
 *
 * Sie ist Plattformwissen und keine Annahme über den Mandanten: eine
 * Ausgangsrechnung bucht gegen den Debitor, je Steuergruppe auf ein Erlöskonto
 * und (bei Steuer ungleich null) auf ein Umsatzsteuerkonto. WELCHE Konten das
 * sind, steht in `konto_mapping`.
 */
export const RECHNUNG_BRAUCHT: readonly string[] = [
  'debitor_kunde', 'erloes_leistung', 'steuer_gruppe',
];
