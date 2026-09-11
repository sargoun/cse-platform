import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Wie ein Aufmass-Zustand angezeigt wird — an EINER Stelle, nicht in vier
 * Seiten.
 *
 * **Die Pille kommt aus dem geschlossenen Vokabular von DESIGN §5, das Wort
 * daneben aus dem Gesetz.** DESIGN kennt „Gegengezeichnet" und „Einseitig
 * festgestellt" heute nicht; `02-datenmodell/03-GEWERKE.md` §3.5 hat beide
 * Zeilen bei DESIGN beantragt, und solange sie dort fehlen, wird hier KEINE
 * Pille erfunden (CLAUDE.md: Gestaltungswerte nur aus DESIGN.md). Stattdessen
 * traegt die Pille das naechstliegende Wort des Vokabulars und der Text
 * daneben die genaue Bezeichnung — §9 verlangt ohnehin, dass die Bedeutung im
 * Wort steht und nicht in der Farbe.
 *
 * Die Unterscheidung ist nicht kosmetisch: „gegengezeichnet" heisst, der
 * AUFTRAGGEBER hat unterschrieben; „einseitig festgestellt" heisst, er hat es
 * nicht, und das Blatt traegt anderes Beweisgewicht (§14 Abs. 2 VOB/B,
 * 03-GEWERKE §7.6 B10). Sie in einer Pille zusammenzufassen waere genau die
 * Falschbeurkundung, die das Datenmodell vermeidet.
 */
export const AUFMASS_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'Wartet',
  gegengezeichnet: 'Bereit',
  einseitig_festgestellt: 'Wartet',
  abgelehnt: 'Abgelehnt',
  storniert: 'Archiviert',
};

export const AUFMASS_STATUS_TEXT: Readonly<Record<string, string>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'Vorgelegt',
  gegengezeichnet: 'Gegengezeichnet',
  einseitig_festgestellt: 'Einseitig festgestellt (§ 14 Abs. 2 VOB/B)',
  abgelehnt: 'Abgelehnt',
  storniert: 'Storniert',
};

export const ERHEBUNGSART_TEXT: Readonly<Record<string, string>> = {
  gemeinsam: 'gemeinsames Aufmaß',
  einseitig: 'einseitige Feststellung',
};
