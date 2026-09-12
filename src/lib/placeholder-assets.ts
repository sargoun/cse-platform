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
      + 'Objekte; §4.2 verbietet KI-erzeugte Menschen als Belegschaft. Bis das Material '
      + 'des Mandanten da ist, steht hier je Motiv eine reservierte FLAECHE — '
      + 'Farbverlauf, Akzentlinie der Gesellschaft, Perspektivraster und eine Zeile, '
      + 'die das fehlende Motiv nennt. Vorher waren es gezeichnete Szenen; die lasen '
      + 'sich als Clipart und liessen die Gruppe aussehen, als haette sie keine Fotos '
      + 'von sich. Ein Foto laesst sich nicht erfinden: entweder eigenes Material oder '
      + 'ein lizenzierter Satz.',
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
 * Ein Platzhalter JE MOTIV — und seit dieser Runde eine FLAECHE, keine Szene.
 *
 * **Warum die gezeichneten Szenen weg sind.** Es waren Illustrationen: eine
 * Reinigungskraft mit Wagen, ein Wachmann an der Schranke. Sie sollten zeigen,
 * wie die Seite aussehen wird — und lasen sich als Clipart. Auf einer Seite,
 * die koerperliche Arbeit verkauft, sagt Clipart das Gegenteil dessen, was
 * DESIGN §4.3 verlangt: sie laesst eine Firma aussehen, die keine Fotos von
 * sich hat. Der Mandant hat genau das zurueckgemeldet.
 *
 * Was jetzt dort steht, behauptet NICHTS: der Flaechenverlauf aus §1, eine
 * duenne Akzentlinie in der Farbe der Gesellschaft, ein flaches
 * Perspektivraster fuer Tiefe, der `--bild-overlay`-Verlauf und EINE Zeile,
 * die das Motiv nennt, das hier hingehoert. Keine Menschen (§4.2), kein
 * Objekt, keine Szene.
 *
 * **Und die ehrliche Haelfte der Antwort:** ein Foto laesst sich nicht
 * erfinden. Entweder kommt das Material des Mandanten (§4.1) oder ein
 * lizenzierter Satz wird gekauft. Ein Stockfoto vom Gebaeude eines Fremden auf
 * der Projektseite dieser Gruppe waere §4.3 gebrochen, nur besser
 * ausgeleuchtet. O-13.
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

/*
 * Der Alternativtext beschreibt, was WIRKLICH da ist — eine reservierte
 * Flaeche —, und nennt daneben das Motiv, das hierher gehoert. Ein `alt`, das
 * eine Szene beschreibt, die niemand sieht, ist fuer einen Screenreader eine
 * Falschauskunft: er liest sie vor, als waere sie da.
 */
const ALT_TEXT: Readonly<Record<PlatzhalterMotiv, string>> = {
  gruppe: 'Platzhalter — hier steht später eine Aufnahme der Gruppe.',
  reinigung: 'Platzhalter — hier steht später eine Aufnahme aus der Unterhaltsreinigung.',
  security: 'Platzhalter — hier steht später eine Aufnahme aus dem Objektschutz.',
  bau: 'Platzhalter — hier steht später eine Aufnahme von der Baustelle.',
  operations: 'Platzhalter — hier steht später eine Aufnahme aus dem Betrieb.',
  objekt: 'Platzhalter — hier steht später eine Aufnahme des Objekts.',
  projekt: 'Platzhalter — hier steht später eine Aufnahme des Projekts.',
  team: 'Platzhalter — hier steht später eine Aufnahme des Teams.',
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
