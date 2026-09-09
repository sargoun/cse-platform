/**
 * `/dev/**` are development surfaces: the kitchensink enumerates every
 * component, token and placeholder the platform is built from. Publishing it
 * would hand an unauthenticated visitor a map of the building blocks, so it is
 * gated rather than merely hidden from robots — `robots.txt` asks crawlers not
 * to index the page, it does not stop anyone typing the URL.
 *
 * The decision is made once, at build time:
 *
 * - `pnpm dev` — on, so the design system stays reviewable while working
 * - a production build — off, unless `CSE_DEV_FLAECHEN=1` is set deliberately
 *
 * The Playwright suite sets the flag, because it must axe-test the real
 * production build rather than a development render with its overlays.
 */
export interface Umgebung {
  readonly NODE_ENV?: string | undefined;
  readonly CSE_DEV_FLAECHEN?: string | undefined;
}

export function devFlaechenAn(umgebung: Umgebung = process.env): boolean {
  if (umgebung.CSE_DEV_FLAECHEN === '1') return true;
  return umgebung.NODE_ENV !== 'production';
}
