import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { KOPF_PFAD, KOPF_SPRACHE } from '@/lib/kopf';
import { SPRACH_KEKS } from '@/lib/i18n/geraetesprache';
import { htmlSprache, sprichtGeraetesprache } from '@/lib/i18n/html-sprache';
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
 *
 * **Die Flächen mit Gerätesprache** — Anmeldung der Beschäftigten und
 * Stempeluhr — sagen am `<html>` die Sprache des Geräts an, samt `dir`
 * (D-767); das Portal sagt die Sprache der Sitzung an seiner Hülle an, weil
 * nur die Pforte der Seite sie kennt (`html-sprache.ts`).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const kopf = await headers();
  const pfad = kopf.get(KOPF_PFAD);
  const { lang, dir } = htmlSprache({
    pfad,
    pfadSprache: kopf.get(KOPF_SPRACHE),
    /* Den Keks nur lesen, wo er zählt — jede andere Seite kommt ohne aus. */
    keks: pfad !== null && sprichtGeraetesprache(pfad)
      ? (await cookies()).get(SPRACH_KEKS)?.value : undefined,
    acceptLanguage: kopf.get('accept-language'),
  });
  return (
    <html lang={lang} {...(dir === undefined ? {} : { dir })}>
      <body>{children}</body>
    </html>
  );
}
