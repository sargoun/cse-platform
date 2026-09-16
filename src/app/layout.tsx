import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { headers } from 'next/headers';
import { KOPF_SPRACHE } from '@/lib/kopf';
import { BCP47, istSprache, VORGABE_SPRACHE } from '@/lib/sprache';
import '../styles/globals.css';

export const metadata = { title: 'CSE Platform' };

/**
 * `viewport-fit=cover` — die eine Zeile, ohne die DESIGN §8 „Safe area"
 * schweigend wirkungslos ist.
 *
 * iOS meldet `env(safe-area-inset-*)` als `0px`, solange die Ansicht nicht
 * ueber die ganze Flaeche geht. Jede Polsterung gegen diese Variablen rechnet
 * dann mit null, und das Ergebnis sieht aus wie ein vergessener Abstand statt
 * wie eine fehlende Zeile hier. Gemeldet wurde es vom echten Telefon: die
 * Tab-Leiste klebte am Bildschirmrand, ihre Beschriftungen einen Millimeter
 * ueber dem Home-Indikator.
 *
 * `cover` legt den Inhalt zugleich UNTER Notch und Indikator — deshalb kommt
 * es nur zusammen mit den vier Regeln aus `globals.css`, nie allein.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

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
