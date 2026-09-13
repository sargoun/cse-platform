import { KpiStat } from '@/components/ui/KpiStat';
import type { Ton } from '@/server/registry/kennzahlen';
import type { IconName } from '@/lib/design/icons';

/**
 * Das Kachelraster (DSH-01, DESIGN §5).
 *
 * Vier Spalten am Schreibtisch, zwei auf dem Tablet, eine am Telefon —
 * genau die Stufen aus DESIGN §8.
 *
 * **Jede Kachel ist ein Link, und zwar die ganze Kachel.** Nicht ein kleines
 * Pfeilsymbol in der Ecke: DSH-04 verlangt, dass die Zahl zu ihren Zeilen
 * fuehrt, und ein Ziel von 12×12 Pixeln erfuellt das auf einem Telefon nicht
 * (WCAG 2.5.8 verlangt 24×24 als Minimum).
 */
export interface KachelAnzeige {
  readonly schluessel: string;
  readonly label: string;
  readonly wert: number;
  readonly ton: Ton;
  readonly ziel: string;
  /**
   * `| undefined` ausgeschrieben, nicht nur `?`.
   *
   * `exactOptionalPropertyTypes` unterscheidet „Feld fehlt" von „Feld ist
   * undefined", und die Kachel reicht den Wert durch, ohne ihn zu pruefen.
   * Ohne das Wort haette der Aufrufer das Feld weglassen muessen — eine
   * Bedingung am Aufrufort, die niemand sieht.
   */
  readonly icon?: IconName | undefined;
}

export function KachelRaster({ kacheln }: { readonly kacheln: readonly KachelAnzeige[] }) {
  if (kacheln.length === 0) {
    return (
      <p data-cse="keine-kacheln" className="text-base text-text-muted">
        Für Ihre Rolle sind keine Kennzahlen freigegeben.
      </p>
    );
  }

  return (
    <div
      data-cse="kachel-raster"
      className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {kacheln.map((k) => (
        /**
         * Ein gewöhnliches `<a>` und kein `next/link`.
         *
         * `typedRoutes` prüft `Link href` gegen die bekannten Routen; das Ziel
         * einer Kachel entsteht aber zur Laufzeit aus dem Register. Ein Cast
         * hätte die Prüfung ausgeschaltet, statt sie zu erfüllen — und es ist
         * ohnehin ein Seitenwechsel, kein Übergang innerhalb einer Ansicht.
         */
        <a
          key={k.schluessel}
          href={k.ziel}
          data-cse="kachel"
          data-kachel={k.schluessel}
          /*
           * `block rounded-lg` allein sagte nicht, dass hier etwas anklickbar
           * ist. Die Kachel WAR ein Link und sah aus wie eine Anzeige — auf
           * dem Dashboard stehen zwölf davon, und wer keine davon für einen
           * Weg hält, hält die Seite fuer eine Sackgasse. DESIGN §5 nennt den
           * Hover-Zustand (`--surface-2`, 150 ms); der Fokusring kommt aus
           * `globals.css` und wird hier absichtlich nicht wiederholt.
           */
          /*
           * Der Hover sitzt an der KARTE, nicht am Verweis darum herum.
           *
           * Hier stand `hover:bg-surface-2` am `<a>` — und `KpiStat` traegt
           * selbst `bg-surface`, also lag die Hover-Farbe UNTER der Karte und
           * war nie zu sehen. DESIGN §5 (Cards): interaktive Karten heben den
           * Rand auf `--border-strong` und ruecken 2px nach oben; genau das
           * bekommt die Kachel ueber `interaktiv`.
           */
          className="group block rounded-lg"
        >
          <KpiStat label={k.label} wert={String(k.wert)} ton={k.ton} icon={k.icon} interaktiv />
        </a>
      ))}
    </div>
  );
}
