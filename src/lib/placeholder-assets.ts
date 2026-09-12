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
      + 'des Mandanten da ist, stehen hier zwei Sorten Platzhalter (§4.1a, D-376): auf '
      + 'den grossen Flaechen — Kopfbild, Markenkarte, Gesellschaftsseite — eine '
      + 'MOTIVTAFEL, erkennbar eine Zeichnung (flache Flaechen, keine Fototiefe, '
      + 'Figuren nur als Silhouette ohne Gesicht), erzeugt von scripts/motivtafeln.py; '
      + 'auf den kleinen — Objekt- und Projektkachel — die reservierte FLAECHE, weil '
      + 'eine Zeichnung auf 180 px ein Fleck ist. Beide tragen dieselbe sichtbare '
      + 'Kennzeichnung. Ein Foto laesst sich damit nicht ersetzen: dafuer braucht es '
      + 'eigenes Material oder einen lizenzierten Satz.',
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
 * Ein Platzhalter JE MOTIV — in zwei Sorten, nach GROESSE getrennt (D-376).
 *
 * **Gross: eine Motivtafel.** Kopfbild, Markenkarte und Gesellschaftsseite
 * tragen eine Zeichnung, die das Gewerk zeigt — Geruest und Kran fuer den
 * Hochbau, ein Flur mit Wagen fuer die Reinigung, das Werkstor bei Nacht fuer
 * die Security. Sie ist erkennbar eine Zeichnung und gibt sich fuer nichts
 * anderes aus: flache Flaechen, keine Fototiefe, keine Textur, Figuren nur als
 * Silhouette und nie mit Gesicht (§4.2). Genau das ist der Unterschied zum
 * ersten Versuch, der den Fotolook suchte und als Clipart endete — eine
 * Zeichnung, die ein Foto sein will, ist beides schlecht.
 *
 * **Klein: eine reservierte Flaeche.** Objekt- und Projektkacheln bleiben
 * leer. Eine Zeichnung auf 180 px ist ein Fleck.
 *
 * Beide tragen dieselbe sichtbare Kennzeichnung: Akzentlinie der Gesellschaft,
 * Marke, die Zeile „Hier steht spaeter …" und rechts `PLATZHALTER · O-13`.
 *
 * **Die ehrliche Haelfte der Antwort bleibt:** ein Foto laesst sich nicht
 * erfinden. Entweder kommt das Material des Mandanten (§4.1) oder ein
 * lizenzierter Satz wird gekauft. Ein Stockfoto vom Gebaeude eines Fremden auf
 * der Projektseite dieser Gruppe waere §4.3 gebrochen, nur besser
 * ausgeleuchtet. Liegt eine Datei unter `public/bilder/`, gewinnt sie ohnehin
 * — `bildFuerMotiv()` fragt zuerst dort.
 *
 * Erzeugt von `scripts/motivtafeln.py`; die SVG nicht von Hand aendern.
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
  gruppe: 'Motivtafel — hier steht später eine Aufnahme der Gruppe.',
  reinigung: 'Motivtafel — hier steht später eine Aufnahme aus der Unterhaltsreinigung.',
  security: 'Motivtafel — hier steht später eine Aufnahme aus dem Objektschutz.',
  bau: 'Motivtafel — hier steht später eine Aufnahme von der Baustelle.',
  operations: 'Motivtafel — hier steht später eine Aufnahme aus dem Betrieb.',
  objekt: 'Platzhalter — hier steht später eine Aufnahme des Objekts.',
  projekt: 'Platzhalter — hier steht später eine Aufnahme des Projekts.',
  team: 'Motivtafel — hier steht später eine Aufnahme des Teams.',
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
