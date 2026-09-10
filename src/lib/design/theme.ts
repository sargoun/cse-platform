/**
 * The design tokens of `docs/DESIGN.md` §1–§3 and §7, in one place.
 *
 * DESIGN.md is authoritative and this file mirrors it — it does not decide
 * anything. It exists because the same values are needed by three consumers
 * that cannot share a stylesheet: the app (CSS variables), Tailwind (theme
 * extension), and the PDF and e-mail renderers, which run without a browser.
 *
 * `tests/design/tokens.test.ts` compares this file against `globals.css` and
 * against the resolved Tailwind theme, and fails when a value exists in one
 * and not the others. That is the mechanism DESIGN §10 asks for: "define these
 * as CSS variables in globals.css as well, so non-Tailwind surfaces share the
 * same values" — stated as a test rather than as a hope.
 */

/** §1 Foundation — dark-first. */
export const FARBEN_BASIS = {
  ink: '#08080A',
  surface: '#101013',
  'surface-2': '#17171B',
  'surface-3': '#1F1F24',
  border: '#26262C',
  'border-strong': '#34343C',
  text: '#FAFAFA',
  'text-muted': '#A1A1AA',
  'text-subtle': '#8B8B95',
  white: '#FFFFFF',
} as const;

/** §1 Brand. Red is scarce: primary action, active nav, one accent word. */
export const FARBEN_MARKE = {
  red: '#E30613',
  'red-hover': '#C10510',
  'red-press': '#A00409',
  'red-soft': 'rgba(227, 6, 19, 0.12)',
  'red-ring': 'rgba(227, 6, 19, 0.40)',
} as const;

/**
 * §1 Business-area identity. Used ONLY for identification — the switcher ring,
 * the tenant strip, the area badge, chart series. Never for buttons.
 *
 * With one red across four entities a user working in three of them cannot
 * tell which one they are in, and that is how an invoice lands in the wrong
 * GmbH (D-10).
 */
export const FARBEN_BEREICH = {
  reinigung: '#E30613',
  security: '#2F6BFF',
  bau: '#F59E0B',
  operations: '#8B5CF6',
} as const;

/**
 * §11 Print. Ein EIGENER Satz, und das ist der Punkt.
 *
 * Der Bildschirm ist dunkel zuerst, das Blatt ist es nicht. `--surface` auf
 * Papier druckte ein schwarzes Rechteck, `--text` druckte fast-weiss auf
 * weiss. Diese fuenf tragen die Regel aus DESIGN §11, und ausserhalb eines
 * gedruckten Dokuments benutzt sie niemand.
 */
export const FARBEN_DRUCK = {
  'druck-papier': '#FFFFFF',
  'druck-text': '#111111',
  'druck-text-leise': '#444444',
  'druck-linie': '#DDDDDD',
  'druck-linie-leicht': '#EEEEEE',
} as const;

/** §1 Semantic. Pills use the `-soft` background with solid text, never fills. */
export const FARBEN_SEMANTIK = {
  success: '#22C55E',
  'success-soft': 'rgba(34,197,94,0.12)',
  warning: '#F59E0B',
  'warning-soft': 'rgba(245,158,11,0.12)',
  danger: '#EF4444',
  'danger-soft': 'rgba(239,68,68,0.12)',
  info: '#3B82F6',
  'info-soft': 'rgba(59,130,246,0.12)',
  /**
   * The solid danger SURFACE. `--danger` is tuned to be read as text and is
   * therefore light; white on it is 3.76:1 and fails AA. One token cannot do
   * both jobs (DESIGN §1).
   */
  'danger-strong': '#DC2626',
} as const;

/** §2 Type scale — size / line-height / weight. */
export const TYPO = {
  display: { size: '56px', line: '60px', weight: 700 },
  h1: { size: '40px', line: '46px', weight: 700 },
  h2: { size: '30px', line: '38px', weight: 600 },
  h3: { size: '22px', line: '30px', weight: 600 },
  lg: { size: '18px', line: '28px', weight: 400 },
  base: { size: '16px', line: '26px', weight: 400 },
  sm: { size: '14px', line: '22px', weight: 400 },
  xs: { size: '13px', line: '18px', weight: 500 },
  micro: { size: '11px', line: '14px', weight: 600, tracking: '0.08em' },
} as const;

/** §2 Mobile overrides. Body text never goes below 16px — iOS zooms otherwise. */
export const TYPO_MOBIL = {
  display: { size: '36px', line: '40px' },
  h1: { size: '30px', line: '36px' },
  h2: { size: '24px', line: '30px' },
} as const;

/** §3 Spacing, 4px base. */
export const ABSTAND = {
  s1: '4px',
  s2: '8px',
  s3: '12px',
  s4: '16px',
  s5: '24px',
  s6: '32px',
  s7: '48px',
  s8: '64px',
  s9: '96px',
  s10: '128px',
} as const;

/** §3 Radius. */
export const RADIUS = {
  'r-sm': '6px',
  'r-md': '10px',
  'r-lg': '14px',
  'r-xl': '20px',
  'r-full': '9999px',
} as const;

/**
 * §3 Elevation. On dark, depth comes from borders and surface steps — shadow
 * only on genuinely floating layers.
 */
/**
 * Der Pflicht-Overlay aus DESIGN §4.4 — auf jedem Bild, das Text trägt.
 *
 * Als Token und nicht als Wert an der Aufrufstelle: ausgeschrieben driftet er,
 * eine Karte bei 0.55, die nächste bei 0.5, und die Lesbarkeit der Überschrift
 * hängt dann davon ab, welche Komponente jemand kopiert hat.
 */
export const BILD: Readonly<Record<string, string>> = {
  'bild-overlay':
    'linear-gradient(180deg, rgba(8,8,10,0.15) 0%, rgba(8,8,10,0.55) 55%, rgba(8,8,10,0.92) 100%)',
};

/** Kurzform für den Aufruf im Code. */
export const BILD_OVERLAY = BILD['bild-overlay']!;

export const SCHATTEN = {
  'shadow-pop': '0 12px 32px rgba(0,0,0,0.55)',
} as const;

/** §7 Motion. */
export const BEWEGUNG = {
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  fast: '150ms',
  base: '220ms',
  slow: '400ms',
} as const;

/** §8 Breakpoints. */
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const SCHRIFT = {
  'font-sans': "'Inter', system-ui, sans-serif",
  'font-script': "'Caveat', cursive",
} as const;

/** Every §1–§3 and §7 token as one flat map, for the comparison test. */
export const ALLE_TOKENS: Readonly<Record<string, string>> = {
  ...FARBEN_BASIS,
  ...FARBEN_MARKE,
  ...Object.fromEntries(Object.entries(FARBEN_BEREICH).map(([k, v]) => [`area-${k}`, v])),
  ...FARBEN_SEMANTIK,
  ...ABSTAND,
  ...RADIUS,
  ...SCHATTEN,
  ...BILD,
  ...BEWEGUNG,
  ...SCHRIFT,
};

export type BereichSchluessel = keyof typeof FARBEN_BEREICH;
export type SemantikTon = 'success' | 'warning' | 'danger' | 'info' | 'muted';
