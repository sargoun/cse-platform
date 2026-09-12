import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { devFlaechenAn } from '@/lib/dev-flaechen';

/**
 * Der Streifen, der `/dev/**` als das kennzeichnet, was es ist.
 *
 * **Warum das gebraucht wird.** Die Entwicklungsflächen sehen aus wie das
 * Produkt: dieselben Farben, dieselbe Schrift, dieselben Kacheln. Sie sind es
 * nicht. `/dev/dashboard` rendert ein blankes `main` ohne Portalhülle — es
 * läuft ohne Sitzung, und ohne Sitzung gibt es keine Mitgliedschaft, keine
 * Rechte und damit auch keine Navigation, die sich aus ihnen ergäbe. Das ist
 * richtig so und trotzdem eine Falle: wer auf dieser Seite steht, sieht eine
 * Übersicht ohne einen einzigen Weg woandershin und schliesst daraus, die
 * Anwendung habe keine Navigation. Genau dieser Schluss wurde gezogen, zweimal.
 *
 * Der Streifen sagt deshalb beides in einem Satz — wo man ist, und wo das
 * Gemeinte liegt. Er steht in einem Layout und nicht in den fünf Seiten: eine
 * sechste Entwicklungsfläche bekommt ihn dann, ohne dass jemand daran denkt.
 *
 * **Die Wache steht hier zusätzlich, nicht stattdessen.** Jede `/dev`-Seite
 * prüft `devFlaechenAn()` weiterhin selbst. Ein Layout ist kein Torposten:
 * `notFound()` hier schützt die Seiten, die es heute gibt, aber eine Route,
 * die morgen ohne eigene Prüfung dazukommt, wäre nur so lange geschützt, wie
 * niemand das Layout umbaut. Zwei Prüfungen sind hier billiger als die eine
 * Gelegenheit, die zweite zu vergessen.
 */
export const dynamic = 'force-dynamic';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devFlaechenAn()) notFound();

  return (
    <>
      <div
        data-cse="dev-streifen"
        className="flex flex-wrap items-center gap-x-s4 gap-y-s2 border-b border-dashed
                   border-line bg-surface-2 px-s5 py-s3 text-sm text-text-muted"
      >
        <span className="font-mono text-xs uppercase tracking-widest text-text">
          Entwicklungsfläche
        </span>
        <span>
          Kein Teil der Anwendung — hier gibt es keine Sitzung und deshalb keine
          Portalnavigation.
        </span>
        {/*
          * `min-h-11` an jedem der drei: DESIGN §8 verlangt 44px fuer alles
          * Bedienbare, und die Zeilenhoehe von `text-sm` sind 22. Der Streifen
          * ist die einzige Navigation, die `/dev/**` hat — ein Ausgang, den man
          * auf dem Telefon zweimal verfehlt, ist der Zustand, den er beheben
          * sollte.
          */}
        <span className="ms-auto flex flex-wrap items-center gap-x-s4 gap-y-s2">
          <a href="/dev/anmelden"
             className="flex min-h-11 items-center text-text underline underline-offset-4">
            Anmelden
          </a>
          <a href="/portal/reinigung"
             className="flex min-h-11 items-center text-text underline underline-offset-4">
            Zum Portal
          </a>
          <a href="/"
             className="flex min-h-11 items-center text-text underline underline-offset-4">
            Zur Website
          </a>
        </span>
      </div>
      {children}
    </>
  );
}
