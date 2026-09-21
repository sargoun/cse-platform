import type { Route } from 'next';
import Link from 'next/link';
import { rueckwegLabel } from '@/lib/i18n/rueckweg';

/**
 * Der Weg zurueck — auf jeder Seite unterhalb einer Portalwurzel, an
 * derselben Stelle (DESIGN §5 „The way back", D-613).
 *
 * **Warum das hier steht und nicht neben den Seiten eines Portals.** Diese
 * Komponente gab es schon: in `portal/kunde/bausteine.tsx`, sauber gebaut,
 * mit `aria-label`, Pfeil an fester Stelle und Tokens aus dem Thema. Sie war
 * nur unbenutzbar ausserhalb ihres Portals, weil ihr `ziel` auf NEUN feste
 * Kundenpfade typisiert war. Gemessen stand sie deshalb auf 2 von 309
 * Verwaltungsseiten, 2 von 27 Arbeiterseiten und 0 von 26 Gruppenseiten —
 * ein Typ, der die Absicht des Bausteins einsperrt.
 *
 * **`ziel` ist ein Pfad und kein Vereinigungstyp**, und das ist die ganze
 * Aenderung. Die Enge hat nichts geschuetzt: falsch ist nicht ein Pfad
 * ausserhalb einer Liste, sondern ein Ziel, das nicht die Liste ist, aus der
 * die Seite kommt — und das kann kein Typ wissen.
 *
 * **Nie `history.back()`.** Zwei Menschen erreichen dieselbe Detailseite auf
 * verschiedenen Wegen; das Einzige, was sie teilen, ist der Ort, an dem der
 * Datensatz wohnt. Ein Rueckweg, der vom Anreiseweg abhaengt, schickt
 * denselben Knopf an zwei Ziele. Dazu das Praktische: nach einem
 * Formular-POST fragt die Verlaufstaste neu, nach einer Weiterleitung landet
 * sie zwei Seiten zu hoch, und in einem auf den Startbildschirm gelegten
 * Fenster gibt es sie gar nicht.
 */
export interface ZurueckProps {
  /**
   * Die Liste, aus der die Seite kommt — nicht die vorige Seite.
   *
   * **`Route` und nicht `string`, und das ist kein Feinschliff.** Die
   * Plattform faehrt `typedRoutes: true` (`next.config.ts:7`): `Link` nimmt
   * kein beliebiges `string`, sondern nur einen Pfad, den Next als Route
   * kennt. Ein `string` hier laesst `tsc --noEmit` anstandslos durch und
   * bricht erst in `pnpm build` — genau die Luecke, vor der das
   * Uebergabeblatt warnt.
   *
   * Die Vorfassung in `kunde/bausteine.tsx` loeste dasselbe Problem mit einer
   * Aufzaehlung ihrer neun Pfade. Das war kein Versehen, sondern dieselbe
   * Anforderung mit den Mitteln einer Datei, die nur neun Ziele kennt;
   * `Route` ist dieselbe Zusage, ohne die Liste.
   */
  readonly ziel: Route;
  /** Was dort steht, aus Sicht des Ziels: „Alle Anstellungen", nicht „Zurueck". */
  readonly text: string;
  /**
   * Die Portalsprache fuer das `aria-label` — freiwillig, faellt auf Deutsch.
   *
   * Dasselbe Muster wie `<StatusPill>`: das Arbeiterportal laeuft in vier
   * Sprachen (EMP-12), und ein deutsches Label ist fuer den, der die Seite
   * vorlesen laesst, dasselbe wie gar keines.
   */
  readonly sprache?: string | null;
}

export function Zurueck({ ziel, text, sprache }: ZurueckProps) {
  return (
    <nav aria-label={rueckwegLabel(sprache)} className="mb-s4">
      {/*
        * `inline-flex` mit `min-h-11` statt eines blossen Textlinks: DESIGN §9
        * verlangt 44px, und ein `sm`-Text allein misst 20. Der Unterschied
        * faellt an einem Schreibtisch niemandem auf und entscheidet auf einem
        * Telefon darueber, ob der Daumen trifft.
        */}
      <Link
        href={ziel}
        className="inline-flex min-h-11 items-center gap-s1 text-sm text-text-muted
                   underline hover:text-text focus-visible:text-text"
      >
        <span aria-hidden="true">←</span>
        {text}
      </Link>
    </nav>
  );
}
