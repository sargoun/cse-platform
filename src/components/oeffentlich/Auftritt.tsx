'use client';

import { useEffect } from 'react';

/**
 * Der Auftritt beim ersten Sichtkontakt (DESIGN §7, D-776).
 *
 * Ein Abschnitt unter der Falz traegt `data-auftritt`. Beim Start wird er
 * verborgen (`.cse-verborgen`, nur die Deckkraft) und bekommt `.cse-auftritt`,
 * sobald er in den Sichtbereich rollt — genau einmal, dann hoert der
 * Beobachter auf, ihn anzusehen.
 *
 * Drei Dinge sind hier Absicht und nicht Zufall:
 *
 *  1. **Was beim Start schon im Bild steht, bleibt unangetastet.** Der Server
 *     hat es sichtbar gerendert, und ein Abschnitt, der sichtbar war und dann
 *     noch einmal einblendet, blinkt. Verborgen wird nur, was unter der Falz
 *     liegt — dort sieht den Wechsel niemand.
 *  2. **Ohne Skript wird nichts verborgen.** Die Klasse, die verbirgt, setzt
 *     allein dieser Baustein. Faellt er aus, steht die Seite so da, wie sie
 *     ankam.
 *  3. **Nur die Deckkraft.** Der Abschnitt bleibt fuer Tastatur und
 *     Screenreader da; ein Fokus darin rollt ihn in den Sichtbereich, und der
 *     Beobachter zeigt ihn.
 */

/** Liegt ein Element beim Start unter der Falz? Nur dann wird es verborgen. */
export function unterDerFalz(oberkante: number, fensterHoehe: number): boolean {
  return oberkante >= fensterHoehe;
}

/** Zehn Prozent im Bild, bevor der Auftritt beginnt — sonst laeuft er am Rand ab. */
const RAND = '0px 0px -10% 0px';

export function Auftritt(): null {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const unten = [...document.querySelectorAll<HTMLElement>('[data-auftritt]')]
      .filter((e) => unterDerFalz(e.getBoundingClientRect().top, window.innerHeight));
    if (unten.length === 0) return undefined;

    const zeige = (e: Element): void => {
      e.classList.remove('cse-verborgen');
      e.classList.add('cse-auftritt');
    };
    const beobachter = new IntersectionObserver((eintraege) => {
      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;
        zeige(eintrag.target);
        beobachter.unobserve(eintrag.target);
      }
    }, { rootMargin: RAND });

    for (const e of unten) {
      e.classList.add('cse-verborgen');
      beobachter.observe(e);
    }
    return () => {
      beobachter.disconnect();
      for (const e of unten) e.classList.remove('cse-verborgen');
    };
  }, []);
  return null;
}
