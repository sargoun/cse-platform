/**
 * Die Helfer des Serienblatts — hier und nicht in der `page.tsx`.
 *
 * Eine `page.tsx` exportiert nur, was Next.js kennt; jeder weitere Export
 * bricht `pnpm build`, und `tsc --noEmit` sieht es nicht (Wache
 * `page-fremder-export`).
 *
 * **`lesbareRegel` steht hier NICHT.** Sie stand hier, zeichengleich mit
 * `src/lib/datum/regeltext.ts`, aus dem die Serienliste sie importiert — also
 * genau die zweite Auslegung derselben RRULE, vor der dieser Kommentar warnt.
 * Zwei Fassungen derselben Aussage sind eine zu viel: sobald eine davon
 * `INTERVAL` vergisst, zeigt die Liste „jede zweite Woche" und das Blatt
 * „jede Woche", und beides sieht richtig aus. Das Blatt importiert sie
 * jetzt aus `@/lib/datum/regeltext`.
 */

export const AUSNAHME_TEXT: Readonly<Record<string, string>> = {
  ausfall: 'Ausfall',
  verschiebung: 'Verschiebung',
  zusatz: 'Zusatztermin',
};

export const ANOMALIE_TEXT: Readonly<Record<string, string>> = {
  dst_luecke: 'Zeitumstellung vorwärts — diese Stunde gibt es nicht',
  dst_doppelt: 'Zeitumstellung zurück — diese Stunde gibt es zweimal',
};

export const QUELLE_TEXT: Readonly<Record<string, string>> = {
  turnus: 'Turnus (Reinigung)',
  posten: 'Posten (Sicherheit)',
  veranstaltung: 'Veranstaltung',
};

export function Feld({ label, wert, zahl = false, gross = false }: {
  readonly label: string; readonly wert: string;
  readonly zahl?: boolean; readonly gross?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd
        className={`m-0 mt-s1 text-text ${gross ? 'text-h3' : 'text-sm'} `
          + `${zahl ? 'tabular-nums' : ''}`}
      >
        {wert}
      </dd>
    </div>
  );
}
