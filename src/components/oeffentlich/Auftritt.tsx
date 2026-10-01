'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Der Auftritt beim ersten Sichtkontakt (DESIGN §7, D-776).
 *
 * Ein Abschnitt unter der Falz traegt `data-auftritt`. Beim Start wird er um
 * `--s5` nach unten gesetzt (`.cse-wartet`) und kommt zur Ruhe
 * (`.cse-sichtkontakt`), sobald er in den Sichtbereich rollt — genau einmal,
 * dann hoert der Beobachter auf, ihn anzusehen.
 *
 * Drei Dinge sind hier Absicht und nicht Zufall:
 *
 *  1. **Was beim Start schon im Bild steht, bleibt unangetastet.** Der Server
 *     hat es an seinem Platz gerendert, und ein Abschnitt, der da war und dann
 *     noch einmal einrueckt, blinkt. Versetzt wird nur, was unter der Falz
 *     liegt — dort sieht den Wechsel niemand.
 *  2. **Ohne Skript bewegt sich nichts.** Die Klasse, die versetzt, setzt
 *     allein dieser Baustein. Faellt er aus, steht die Seite so da, wie sie
 *     ankam.
 *  3. **Nur die Form, nie die Deckkraft.** axe rollt Elemente fuer die
 *     Kontrastmessung in den Sichtbereich und misst, was es dann vorfindet;
 *     ein Text mitten im Fade fiel so auf `/en` durch AA — einmal ja, einmal
 *     nein. Ein Versatz aendert keine Farbe (`globals.css`, §7).
 *
 * **Je Pfad, nicht je Einhaengen.** Der Baustein steht in der oeffentlichen
 * Huelle, und die bleibt bei einem Wechsel ueber `<Link>` stehen, waehrend die
 * Seite darunter ausgetauscht wird. Liefe der Aufbau nur beim Einhaengen,
 * bekaeme die zweite Seite keinen Auftritt mehr — nichts waere verborgen,
 * aber auch nichts bewegt. Deshalb haengt der Effekt am Pfad.
 */

/** Liegt ein Element beim Start unter der Falz? Nur dann wird es verborgen. */
export function unterDerFalz(oberkante: number, fensterHoehe: number): boolean {
  return oberkante >= fensterHoehe;
}

/** Zehn Prozent im Bild, bevor der Auftritt beginnt — sonst laeuft er am Rand ab. */
const RAND = '0px 0px -10% 0px';

export function Auftritt(): null {
  const pfad = usePathname();
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const unten = [...document.querySelectorAll<HTMLElement>('[data-auftritt]')]
      .filter((e) => unterDerFalz(e.getBoundingClientRect().top, window.innerHeight));
    if (unten.length === 0) return undefined;

    const zeige = (e: Element): void => {
      e.classList.remove('cse-wartet');
      e.classList.add('cse-sichtkontakt');
    };
    const beobachter = new IntersectionObserver((eintraege) => {
      for (const eintrag of eintraege) {
        if (!eintrag.isIntersecting) continue;
        zeige(eintrag.target);
        beobachter.unobserve(eintrag.target);
      }
    }, { rootMargin: RAND });

    for (const e of unten) {
      e.classList.add('cse-wartet');
      beobachter.observe(e);
    }
    return () => {
      beobachter.disconnect();
      for (const e of unten) e.classList.remove('cse-wartet');
    };
  }, [pfad]);
  return null;
}
