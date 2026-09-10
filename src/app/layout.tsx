import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { KOPF_SPRACHE } from '@/lib/kopf';
import { BCP47, istSprache, VORGABE_SPRACHE } from '@/lib/sprache';
import '../styles/globals.css';

export const metadata = { title: 'CSE Platform' };

/**
 * `<html lang>` folgt der Sprache der Anfrage (WCAG 3.1.1).
 *
 * Die Sprache kommt aus dem Kopf, den `middleware.ts` setzt — das Layout
 * selbst kennt den Pfad nicht. Fehlt der Kopf (etwa weil eine Route aus dem
 * Matcher faellt), bleibt es bei Deutsch: die Vorgabe, nicht ein Raten.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const roh = (await headers()).get(KOPF_SPRACHE) ?? '';
  const sprache = istSprache(roh) ? roh : VORGABE_SPRACHE;
  return (
    <html lang={BCP47[sprache]}>
      <body>{children}</body>
    </html>
  );
}
