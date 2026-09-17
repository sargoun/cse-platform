import { leseRegel, RegelFehler } from '@/lib/datum/rrule';

/**
 * Die Helfer des Serienblatts — hier und nicht in der `page.tsx`.
 *
 * Eine `page.tsx` exportiert nur, was Next.js kennt; jeder weitere Export
 * bricht `pnpm build`, und `tsc --noEmit` sieht es nicht (Wache
 * `page-fremder-export`).
 */

const TAGE: Readonly<Record<string, string>> = {
  MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So',
};

/**
 * Die RRULE in einem Satz — gelesen vom **selben Parser**, den der Generator
 * benutzt (dieselbe Funktion wie in der Serienliste).
 *
 * Eine zweite, nur fuer die Anzeige geschriebene Auslegung waere die
 * gefaehrlichste Variante: sie zeigte „montags", waehrend der Generator
 * dienstags plant, und beides saehe richtig aus. Was der Parser nicht lesen
 * kann, wird als Rohtext gezeigt und nicht geraten.
 */
export function lesbareRegel(rrule: string): string {
  try {
    const r = leseRegel(rrule);
    const jede = r.interval === 1 ? 'jede' : `jede ${String(r.interval)}.`;
    if (r.freq === 'WEEKLY') {
      const tage = r.byday?.map((d) => TAGE[d] ?? d).join(', ');
      return tage === undefined ? `${jede} Woche` : `${jede} Woche · ${tage}`;
    }
    if (r.freq === 'DAILY') {
      return r.interval === 1 ? 'täglich' : `jeden ${String(r.interval)}. Tag`;
    }
    const tage = r.bymonthday?.map((d) => `${String(d)}.`).join(', ');
    return tage === undefined
      ? `${jede} Monat`
      : `${jede === 'jede' ? 'jeden' : jede} Monat · ${tage}`;
  } catch (fehler) {
    if (fehler instanceof RegelFehler) return rrule;
    throw fehler;
  }
}

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
