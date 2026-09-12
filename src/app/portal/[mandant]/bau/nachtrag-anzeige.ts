import type { PillZustand } from '@/components/ui/StatusPill';

/**
 * Wie ein Nachtrag und eine Behinderung angezeigt werden — an EINER Stelle,
 * nicht in sechs Seiten.
 *
 * **Die Pille kommt aus dem geschlossenen Vokabular von DESIGN §5, das Wort
 * daneben aus dem Gesetz** — dieselbe Bauart wie `aufmass-anzeige.ts` und aus
 * demselben Grund (D-186, D-206). DESIGN kennt „Angemeldet", „Eingereicht",
 * „Beauftragt" und „Angezeigt" nicht; eine Pille zu erfinden verbietet
 * CLAUDE.md ausdrücklich („Design values come from `docs/DESIGN.md` only").
 * Also trägt die Pille das nächstliegende Wort des Vokabulars und der Text
 * daneben die genaue Bezeichnung — §9 verlangt ohnehin, dass die Bedeutung im
 * Wort steht und nicht in der Farbe.
 *
 * Die Unterscheidung ist hier nicht kosmetisch. „Angemeldet" heisst: der
 * Anspruch ist nach § 2 Abs. 6 Nr. 1 VOB/B **angekündigt**. „Eingereicht"
 * heisst: die Kalkulation liegt beim Auftraggeber. Über das Erste entscheidet
 * der Anspruch, über das Zweite die Fälligkeit — und wer beides gleich
 * anzeigt, kann im Streit nicht mehr belegen, welches von beidem stattfand.
 */
export const NACHTRAG_PILLE: Readonly<Record<string, PillZustand>> = {
  angemeldet: 'Offen',
  kalkuliert: 'In Arbeit',
  eingereicht: 'Wartet',
  beauftragt: 'Aktiv',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
};

export const NACHTRAG_STATUS_TEXT: Readonly<Record<string, string>> = {
  angemeldet: 'Angemeldet (§ 2 Abs. 6 Nr. 1 VOB/B)',
  kalkuliert: 'Kalkuliert',
  eingereicht: 'Eingereicht',
  beauftragt: 'Beauftragt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};

export const ANORDNUNG_TEXT: Readonly<Record<string, string>> = {
  schriftlich: 'schriftlich',
  muendlich: 'mündlich',
  e_mail: 'per E-Mail',
  unbekannt: 'nicht festgehalten',
};

export const BEHINDERUNG_PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  freigegeben: 'Bereit',
  angezeigt: 'Aktiv',
  weggefallen: 'Abgeschlossen',
  abgeschlossen: 'Abgeschlossen',
};

export const BEHINDERUNG_STATUS_TEXT: Readonly<Record<string, string>> = {
  entwurf: 'Entwurf — nicht abgesendet',
  freigegeben: 'Freigegeben, noch nicht abgesendet',
  angezeigt: 'Angezeigt (§ 6 Abs. 1 VOB/B)',
  weggefallen: 'Weggefallen (§ 6 Abs. 3 VOB/B)',
  abgeschlossen: 'Abgeschlossen',
};

export const BEHINDERUNG_GRUND_KURZ: Readonly<Record<string, string>> = {
  risikobereich_ag: 'Risikobereich des Auftraggebers (§ 6 Abs. 2 Nr. 1 a)',
  streik_aussperrung: 'Streik oder Aussperrung (§ 6 Abs. 2 Nr. 1 b)',
  hoehere_gewalt: 'Höhere Gewalt (§ 6 Abs. 2 Nr. 1 c)',
};
