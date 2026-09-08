import type { Config } from 'tailwindcss';
import {
  ABSTAND,
  BEWEGUNG,
  BREAKPOINTS,
  FARBEN_BASIS,
  FARBEN_BEREICH,
  FARBEN_MARKE,
  FARBEN_SEMANTIK,
  SCHATTEN,
  TYPO,
} from './src/lib/design/theme.js';

/**
 * The Tailwind theme is DERIVED from `theme.ts`, never retyped.
 *
 * DESIGN §10 gives the shape of this file; the values come from the one place
 * that also feeds `globals.css` and the PDF renderer. Retyping them here is how
 * the three drift apart, and a drifted brand colour is only noticed on a
 * printed invoice.
 */
const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    screens: BREAKPOINTS,
    extend: {
      colors: {
        ink: FARBEN_BASIS.ink,
        surface: {
          DEFAULT: FARBEN_BASIS.surface,
          2: FARBEN_BASIS['surface-2'],
          3: FARBEN_BASIS['surface-3'],
        },
        line: { DEFAULT: FARBEN_BASIS.border, strong: FARBEN_BASIS['border-strong'] },
        text: {
          DEFAULT: FARBEN_BASIS.text,
          muted: FARBEN_BASIS['text-muted'],
          subtle: FARBEN_BASIS['text-subtle'],
        },
        brand: {
          DEFAULT: FARBEN_MARKE.red,
          hover: FARBEN_MARKE['red-hover'],
          press: FARBEN_MARKE['red-press'],
          soft: FARBEN_MARKE['red-soft'],
          ring: FARBEN_MARKE['red-ring'],
        },
        area: FARBEN_BEREICH,
        success: { DEFAULT: FARBEN_SEMANTIK.success, soft: FARBEN_SEMANTIK['success-soft'] },
        warning: { DEFAULT: FARBEN_SEMANTIK.warning, soft: FARBEN_SEMANTIK['warning-soft'] },
        danger: {
          DEFAULT: FARBEN_SEMANTIK.danger,
          soft: FARBEN_SEMANTIK['danger-soft'],
          strong: FARBEN_SEMANTIK['danger-strong'],
        },
        info: { DEFAULT: FARBEN_SEMANTIK.info, soft: FARBEN_SEMANTIK['info-soft'] },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        script: ['Caveat', 'cursive'],
      },
      fontSize: Object.fromEntries(
        Object.entries(TYPO).map(([k, v]) => [
          k,
          [v.size, { lineHeight: v.line, fontWeight: String(v.weight) }] as [
            string,
            { lineHeight: string; fontWeight: string },
          ],
        ]),
      ),
      spacing: ABSTAND,
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px', full: '9999px' },
      boxShadow: { pop: SCHATTEN['shadow-pop'] },
      transitionTimingFunction: { brand: BEWEGUNG.ease },
      transitionDuration: { fast: '150ms', base: '220ms', slow: '400ms' },
      maxWidth: { content: '1280px', prose: '72ch' },
    },
  },
  plugins: [],
};

export default config;
