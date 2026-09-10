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
    pfad: 'public/platzhalter/*.svg',
    grund:
      'Alle Website-Bilder. DESIGN §4.1 verlangt echte Aufnahmen der eigenen Crews und '
      + 'Objekte; §4.2 verbietet KI-erzeugte Menschen als Belegschaft. Bis der Mandant '
      + 'sein Material liefert, stehen hier gezeichnete Szenen je Motiv: sie zeigen, '
      + 'wie die Seite aussehen wird, ohne zu behaupten, ein Objekt der Gruppe oder '
      + 'seine Belegschaft zu sein. Jede traegt ihre Marke sichtbar.',
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
  pfad: '/platzhalter/hero.svg',
  alt: 'Platzhalterbild — hier stehen später eigene Aufnahmen der Gruppe.',
  platzhalter: true,
} as const;

/**
 * Ein Platzhalter JE MOTIV statt eines grauen Rechtecks fuer alles.
 *
 * Der erste Entwurf hatte ein einziges Bild: sichtbar leer, ehrlich — und
 * unbrauchbar, um dem Mandanten zu zeigen, wie die Seite aussehen wird. Wer
 * eine Reinigungsseite bewertet, bewertet sie mit einem Bild darauf.
 *
 * Es sind ILLUSTRATIONEN, keine Fotos, und das ist die Grenze, die DESIGN §4.2
 * zieht: kein erfundenes Gesicht, das als Belegschaft gelesen werden koennte.
 * Eine gezeichnete Nachtszene behauptet nicht, ein Objekt der Gruppe zu sein;
 * ein Stockfoto von Menschen in Warnwesten tut genau das. Jede traegt unten
 * links ihre Marke und die offene Frage, unter der sie steht (O-13).
 */
export const PLATZHALTER_MOTIVE = {
  gruppe: '/platzhalter/hero.svg',
  reinigung: '/platzhalter/reinigung.svg',
  security: '/platzhalter/security.svg',
  bau: '/platzhalter/bau.svg',
  operations: '/platzhalter/operations.svg',
  objekt: '/platzhalter/objekt.svg',
  projekt: '/platzhalter/projekt.svg',
  team: '/platzhalter/team.svg',
} as const;

export type PlatzhalterMotiv = keyof typeof PLATZHALTER_MOTIVE;

const ALT_TEXT: Readonly<Record<PlatzhalterMotiv, string>> = {
  gruppe: 'Platzhalter-Illustration: nächtliche Gebäudezeile der vier Gesellschaften.',
  reinigung: 'Platzhalter-Illustration: Flur in der Unterhaltsreinigung.',
  security: 'Platzhalter-Illustration: Objektschutz bei Nacht.',
  bau: 'Platzhalter-Illustration: Rohbau mit Turmdrehkran und Gerüst.',
  operations: 'Platzhalter-Illustration: Betriebsübersicht am Bildschirm.',
  objekt: 'Platzhalter-Illustration: Objekt bei Nacht.',
  projekt: 'Platzhalter-Illustration: Bauprojekt.',
  team: 'Platzhalter-Illustration: Team, bewusst abstrakt ohne erfundene Gesichter.',
};

/** Das Platzhalterbild zu einem Motiv — mit sichtbarer Kennzeichnung. */
export function platzhalterBild(motiv: PlatzhalterMotiv): {
  readonly pfad: string; readonly alt: string; readonly platzhalter: true;
} {
  return { pfad: PLATZHALTER_MOTIVE[motiv], alt: ALT_TEXT[motiv], platzhalter: true };
}

/** Der Bereichsschlüssel als Motiv — unbekanntes faellt auf die Gruppe zurueck. */
export function motivFuerBereich(bereich: string | null | undefined): PlatzhalterMotiv {
  return bereich !== null && bereich !== undefined && bereich in PLATZHALTER_MOTIVE
    ? (bereich as PlatzhalterMotiv)
    : 'gruppe';
}
