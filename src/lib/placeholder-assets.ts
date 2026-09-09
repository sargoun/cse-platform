/**
 * The placeholder register (D-10, CLAUDE.md "no fake integrations").
 *
 * Every asset here is a stand-in that must be replaced before launch. It is a
 * list rather than a habit because a placeholder nobody tracks is a
 * placeholder that ships: the AI-generated crew photo on a site selling
 * physical trust fails the moment anyone looks closely.
 *
 * `pnpm guards` does not fail on these — they are legitimate during
 * development. The production build does, via `assertKeinePlatzhalter()`.
 */
export interface Platzhalter {
  readonly pfad: string;
  readonly grund: string;
  /** The open question that releases it, where there is one. */
  readonly frage: string | null;
}

export const PLATZHALTER: readonly Platzhalter[] = [
  {
    pfad: 'public/brand/reinigung.svg',
    grund: 'Markenlogo CSE Dienstleistung — Platzhalter',
    frage: 'O-12',
  },
  { pfad: 'public/brand/security.svg', grund: 'Markenlogo SSE Security — Platzhalter', frage: 'O-12' },
  { pfad: 'public/brand/bau.svg', grund: 'Markenlogo REALTIME Service — Platzhalter', frage: 'O-12' },
  {
    pfad: 'public/brand/operations.svg',
    grund: 'Markenlogo CSE Operations — Platzhalter',
    frage: 'O-12',
  },
  {
    pfad: 'src/lib/design/theme.ts#red',
    grund: 'CSE-Rot aus DESIGN §1 (#E30613); der exakte Wert wird aus der Logodatei abgetastet',
    frage: 'O-12',
  },
  {
    pfad: 'public/platzhalter/bild.svg',
    grund:
      'Alle Website-Bilder. DESIGN §4.1 verlangt echte Aufnahmen der eigenen Crews und '
      + 'Objekte; §4.2 verbietet KI-erzeugte Menschen als Belegschaft. Bis der Mandant '
      + 'sein Material liefert, steht hier ein sichtbar leeres Bild — kein Stockfoto, '
      + 'das nach Belegschaft aussieht.',
    frage: 'O-13',
  },
  {
    pfad: 'public/fonts/',
    grund: 'Inter und Caveat sind noch nicht selbst gehostet; bis dahin greift der System-Stack',
    frage: null,
  },
];

/**
 * Called by the production build. A placeholder in production is a launch
 * blocker, and DESIGN §4 says so about the photography in particular.
 */
export function assertKeinePlatzhalter(umgebung: string): void {
  if (umgebung !== 'production') return;
  if (PLATZHALTER.length > 0) {
    throw new Error(
      `Produktionsbuild mit ${PLATZHALTER.length} Platzhaltern:\n` +
        PLATZHALTER.map((p) => `  ${p.pfad} — ${p.grund}${p.frage === null ? '' : ` (${p.frage})`}`).join(
          '\n',
        ),
    );
  }
}

/**
 * Das eine Platzhalterbild, das jede oeffentliche Seite verwendet.
 *
 * Es traegt seinen Zustand SICHTBAR — die Seite zeigt daneben eine Marke, statt
 * ihn zu verschweigen. Ein unauffaelliger Platzhalter ist einer, der in
 * Produktion landet.
 */
export const PLATZHALTER_BILD = {
  pfad: '/platzhalter/bild.svg',
  alt: 'Platzhalterbild — hier stehen später eigene Aufnahmen der Gruppe.',
  platzhalter: true,
} as const;
