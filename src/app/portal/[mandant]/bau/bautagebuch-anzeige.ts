import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Wie ein Bautag angezeigt wird — an EINER Stelle, nicht in drei Seiten.
 *
 * **Die Pille kommt aus dem geschlossenen Vokabular von DESIGN §5, das Wort
 * daneben aus der Sache.** DESIGN kennt „Gegengezeichnet" heute nicht;
 * solange die Zeile dort fehlt, wird hier KEINE Pille erfunden (CLAUDE.md:
 * Gestaltungswerte nur aus DESIGN.md). Die Pille traegt deshalb das
 * naechstliegende Wort des Vokabulars, und der Text daneben die genaue
 * Bezeichnung — §9 verlangt ohnehin, dass die Bedeutung im WORT steht und
 * nicht in der Farbe.
 *
 * Die Unterscheidung ist nicht kosmetisch: „abgeschlossen" heisst, der
 * AUFTRAGNEHMER hat den Tag geschlossen; „gegengezeichnet" heisst, die
 * Bauleitung des AUFTRAGGEBERS hat ihn anerkannt. Im Werklohnprozess ist das
 * ein anderes Beweisgewicht, und beides in einem Wort zu fuehren waere
 * dieselbe Falschbeurkundung, die `bautagebuch_status` vermeidet (0082).
 */
export const BAUTAG_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  abgeschlossen: 'Abgeschlossen',
  gegengezeichnet: 'Bereit',
};

export const BAUTAG_STATUS_TEXT: Readonly<Record<string, string>> = {
  entwurf: 'Entwurf',
  abgeschlossen: 'Abgeschlossen',
  gegengezeichnet: 'Gegengezeichnet (Auftraggeber)',
};

/**
 * Was ueber dem Wetterfeld steht.
 *
 * `keine` bekommt den WOERTLICHEN Satz aus BAU-08 und keine Null: „0 °C" und
 * „keine Angabe" sind zwei verschiedene Aussagen, und die erste ist im
 * Bauprozess eine Falschangabe.
 */
export const WETTER_QUELLE_TEXT: Readonly<Record<string, string>> = {
  dwd: 'DWD Open Data',
  manuell: 'manuell erfasst',
  keine: 'keine Quelle',
};
