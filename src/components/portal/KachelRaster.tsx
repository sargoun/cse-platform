import { KpiStat } from '@/components/ui/KpiStat';
import type { Ton } from '@/server/registry/kennzahlen';

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
          className="block rounded-lg"
        >
          <KpiStat label={k.label} wert={String(k.wert)} ton={k.ton} />
        </a>
      ))}
    </div>
  );
}
