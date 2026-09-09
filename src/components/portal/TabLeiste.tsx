import { tabZiel, type TabZiel } from '@/server/registry/tableiste';

/**
 * Die Tab-Leiste unter 768 px (DESIGN §5/§8, SEITENKARTE §11.2).
 *
 * **Tap-Ziele mindestens 44×44 px.** Nicht als Richtwert: WCAG 2.5.5 nennt die
 * Zahl, und diese Leiste ist das, was jemand mit Handschuhen im Treppenhaus
 * trifft oder nicht trifft.
 *
 * `aria-current="page"` und nicht nur eine Farbe — §9 verbietet Farbe als
 * einziges Signal, und ein Screenreader liest keine Farbe.
 */
export interface TabLeisteProps {
  readonly ziele: readonly TabZiel[];
  /** Der Schlüssel des aktiven Ziels. */
  readonly aktiv?: string;
  /** Die Portalwurzel, z. B. `/portal/reinigung` oder `/portal/mein`. */
  readonly wurzel: string;
  readonly label: string;
}

export function TabLeiste({ ziele, aktiv, wurzel, label }: TabLeisteProps) {
  return (
    <nav
      aria-label={label}
      data-cse="tableiste"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface md:hidden"
    >
      {ziele.map((z) => {
        const ziel = tabZiel(wurzel, z);
        return (
          <a
            key={z.schluessel}
            href={ziel}
            data-cse="tab"
            data-tab={z.schluessel}
            aria-current={z.schluessel === aktiv ? 'page' : undefined}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-s1
                        px-s2 py-s2 text-micro ${
                          z.schluessel === aktiv ? 'text-text' : 'text-text-muted'}`}
          >
            <span aria-hidden="true" className="text-base">{z.symbol}</span>
            {z.label}
          </a>
        );
      })}
    </nav>
  );
}
