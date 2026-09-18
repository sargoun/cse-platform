import type { PillZustand } from '@/components/ui/StatusPill';
import { BAUTAG_STATUS_TEXTE, WETTER_QUELLE_TEXTE } from '@/lib/i18n/texte';

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

/**
 * Die Woerter selbst stehen in `lib/i18n/texte.ts` und nicht hier.
 *
 * Der Grund ist ein gemessener: die Bautagebuchseite des MITARBEITERPORTALS
 * las diese beiden Karten von hier und schrieb damit „Gegengezeichnet
 * (Auftraggeber)" und „keine Quelle" auch auf einen Bildschirm, der gerade auf
 * Arabisch oder Tuerkisch steht (SPEC §10, EMP-12). Eine Anzeigehilfe des
 * internen Portals ist der falsche Ort fuer einen Text, den ein vierprachiger
 * Bildschirm braucht.
 *
 * Das interne Portal nimmt hier die `de`-Spalte und liest damit wortgleich wie
 * zuvor; das Mitarbeiterportal waehlt die Spalte seiner Sprache.
 */
export const BAUTAG_STATUS_TEXT: Readonly<Record<string, string>> =
  BAUTAG_STATUS_TEXTE.de;

export const WETTER_QUELLE_TEXT: Readonly<Record<string, string>> =
  WETTER_QUELLE_TEXTE.de;
