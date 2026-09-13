import type { ReactNode } from 'react';

/**
 * DESIGN §5 Tables and §8 Responsive.
 *
 * Two rules here are not styling preferences:
 *
 *  - Numbers are right-aligned with `font-variant-numeric: tabular-nums`, so a
 *    column of amounts lines up on the decimal. Proportional figures make a
 *    wrong total genuinely hard to see.
 *  - **Below 768px the table becomes stacked cards.** "Never a horizontal
 *    scrollbar on a data table on a phone" — a worker checking their hours on
 *    site should not have to pan sideways to find the column that matters.
 *
 * The two renderings are the SAME markup emitted twice, with one hidden by a
 * media query rather than by JavaScript: a layout that depends on hydration
 * flickers, and a table that flickers on a phone in daylight is unusable.
 */
export interface Spalte<Z> {
  readonly schluessel: string;
  readonly kopf: string;
  /** Right-aligned with tabular figures. Money and quantities set this. */
  readonly numerisch?: boolean;
  readonly zelle: (zeile: Z) => ReactNode;
}

export interface DataTableProps<Z> {
  readonly spalten: readonly Spalte<Z>[];
  readonly zeilen: readonly Z[];
  readonly schluessel: (zeile: Z) => string;
  readonly beschriftung: string;
}

export function DataTable<Z>({
  spalten,
  zeilen,
  schluessel,
  beschriftung,
}: DataTableProps<Z>) {
  return (
    <>
      {/*
        * ≥ md: the table — in its OWN scroll container.
        *
        * A wide table (eight columns of invoices, a project list) is wider
        * than a 572px `main` on a tablet with the sidebar open. Without this
        * wrapper the table widened `main` and the whole page scrolled
        * sideways, header row included — measured on 35 portal pages at
        * 820px. The rule of §8 is about PHONES ("never a horizontal
        * scrollbar on a data table on a phone"), and below `md` this table
        * is not rendered at all; from `md` up the table itself scrolls,
        * the page never does (D-420).
        */}
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse" data-cse="tabelle">
        <caption className="sr-only">{beschriftung}</caption>
        <thead>
          <tr className="border-b border-line">
            {spalten.map((s) => (
              <th
                key={s.schluessel}
                scope="col"
                className={[
                  // `px-s2` wie in der Zelle: ohne es stand die rechtsbündige
                  // Zahlenüberschrift direkt an der nächsten Überschrift —
                  // „NETTO AUFTRAG" las sich wie EINE Spalte.
                  'px-s2 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle',
                  s.numerisch === true ? 'cse-zahl' : 'text-left',
                ].join(' ')}
              >
                {s.kopf}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr
              key={schluessel(z)}
              className="h-14 border-b border-line transition-colors duration-fast hover:bg-surface-2"
            >
              {spalten.map((s) => (
                <td
                  key={s.schluessel}
                  className={['px-s2 text-sm', s.numerisch === true ? 'cse-zahl' : ''].join(' ')}
                >
                  {s.zelle(z)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* < md: stacked cards. No horizontal scroll, ever. */}
      <ul className="flex list-none flex-col gap-s3 p-0 md:hidden" data-cse="stapel">
        {zeilen.map((z) => (
          <li key={schluessel(z)} className="rounded-lg border border-line bg-surface p-s4">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">
              {spalten.map((s) => (
                <div key={s.schluessel} className="contents">
                  <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                    {s.kopf}
                  </dt>
                  <dd
                    className={['m-0 text-sm', s.numerisch === true ? 'cse-zahl' : ''].join(' ')}
                  >
                    {s.zelle(z)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
