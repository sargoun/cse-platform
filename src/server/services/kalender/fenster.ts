/**
 * Welches Fenster der Kalender zeigt — Monat, Woche, Tag (CAL-01).
 *
 * **Alles als Berliner Kalendertag `YYYY-MM-DD`, nichts als `Date`.** Ein
 * `Date` ist ein Instant, und „welcher Monat" ist keine Frage an einen
 * Instant, sondern an eine Zone: der 1. September um 00:30 Berliner Zeit ist
 * in UTC noch der 31. August. Wer hier mit `Date` rechnete, zeigte im Sommer
 * zwischen Mitternacht und zwei Uhr den falschen Monat — und nur dann.
 *
 * Dieselbe Entscheidung wie in `bericht/zeitraum.ts`, aus demselben Grund;
 * dort geht es um Abschnitte eines Jahres, hier um Fenster um einen Tag.
 */

export type Ansicht = 'monat' | 'woche' | 'tag';

export interface Fenster {
  readonly ansicht: Ansicht;
  /** Der Tag, um den herum das Fenster liegt — `YYYY-MM-DD`. */
  readonly anker: string;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  /** Die Adresse des vorigen und des nächsten Fensters — als Anker. */
  readonly vorher: string;
  readonly nachher: string;
}

const MONATE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

const z2 = (n: number): string => String(n).padStart(2, '0');

/** Zerlegt `YYYY-MM-DD` — ohne `Date`, also ohne Zonenfrage. */
export function teile(tag: string): { jahr: number; monat: number; tagImMonat: number } {
  const [j, m, t] = tag.split('-').map(Number) as [number, number, number];
  return { jahr: j, monat: m, tagImMonat: t };
}

export function letzterTagDesMonats(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/**
 * Verschiebt einen Kalendertag um `tage` — über UTC-Mitternacht gerechnet.
 *
 * **Warum UTC hier richtig ist, obwohl alles andere Berlin ist:** gerechnet
 * wird auf einem DATUM ohne Uhrzeit, und ein Datum plus ein Tag ist in jeder
 * Zone derselbe Sprung. Über UTC gerechnet gibt es keine 23- und keine
 * 25-Stunden-Tage, also auch keinen Tag, der bei der Zeitumstellung
 * übersprungen oder verdoppelt wird.
 */
export function plusTage(tag: string, tage: number): string {
  const { jahr, monat, tagImMonat } = teile(tag);
  const d = new Date(Date.UTC(jahr, monat - 1, tagImMonat));
  d.setUTCDate(d.getUTCDate() + tage);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${z2(d.getUTCMonth() + 1)}-`
    + `${z2(d.getUTCDate())}`;
}

/** Montag = 1 … Sonntag = 7 (ISO 8601 — die Woche beginnt hier am Montag). */
export function wochentag(tag: string): number {
  const { jahr, monat, tagImMonat } = teile(tag);
  const wt = new Date(Date.UTC(jahr, monat - 1, tagImMonat)).getUTCDay();
  return wt === 0 ? 7 : wt;
}

/** Ein gültiger Kalendertag aus der Adresse — oder der übergebene Heute-Wert. */
export function ankerAus(roh: unknown, heute: string): string {
  if (typeof roh !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(roh)) return heute;
  const { jahr, monat, tagImMonat } = teile(roh);
  if (monat < 1 || monat > 12) return heute;
  if (tagImMonat < 1 || tagImMonat > letzterTagDesMonats(jahr, monat)) return heute;
  // Ein Kalender, der das Jahr 0 oder 9999 zeigt, ist ein Tippfehler.
  if (jahr < 2000 || jahr > 2100) return heute;
  return roh;
}

export function ansichtAus(roh: unknown): Ansicht {
  return roh === 'woche' || roh === 'tag' ? roh : 'monat';
}

export function fensterFuer(ansicht: Ansicht, anker: string): Fenster {
  const { jahr, monat, tagImMonat } = teile(anker);

  if (ansicht === 'tag') {
    return {
      ansicht, anker, von: anker, bis: anker,
      bezeichnung: `${String(tagImMonat)}. ${MONATE[monat - 1]!} ${String(jahr)}`,
      vorher: plusTage(anker, -1), nachher: plusTage(anker, 1),
    };
  }

  if (ansicht === 'woche') {
    const von = plusTage(anker, -(wochentag(anker) - 1));
    const bis = plusTage(von, 6);
    const a = teile(von);
    const b = teile(bis);
    /*
     * „29. September – 5. Oktober 2026" und nicht „29.9. – 5.10.2026": der
     * Monatsname steht nur dort, wo er sich aendert, und das Jahr nur einmal.
     * Eine Woche, die zwei Monate kreuzt, ist der haeufigste Fall, den eine
     * naive Beschriftung falsch macht.
     */
    const links = a.monat === b.monat
      ? `${String(a.tagImMonat)}.`
      : `${String(a.tagImMonat)}. ${MONATE[a.monat - 1]!}`;
    return {
      ansicht, anker, von, bis,
      bezeichnung: `${links} – ${String(b.tagImMonat)}. ${MONATE[b.monat - 1]!} `
        + `${String(b.jahr)}`,
      vorher: plusTage(von, -7), nachher: plusTage(von, 7),
    };
  }

  const von = `${String(jahr).padStart(4, '0')}-${z2(monat)}-01`;
  const bis = `${String(jahr).padStart(4, '0')}-${z2(monat)}-`
    + `${z2(letzterTagDesMonats(jahr, monat))}`;
  return {
    ansicht, anker, von, bis,
    bezeichnung: `${MONATE[monat - 1]!} ${String(jahr)}`,
    vorher: plusTage(von, -1), nachher: plusTage(bis, 1),
  };
}

/**
 * Die Zellen des Monatsgitters — immer volle Wochen, Montag bis Sonntag.
 *
 * Ein Monat, der an einem Mittwoch beginnt, braucht die zwei Tage davor,
 * sonst rutscht die erste Woche nach links und jede Spalte trägt einen
 * anderen Wochentag. Sie werden als `ausserhalb` markiert, damit die
 * Oberfläche sie anders hinterlegt (DESIGN §5).
 */
export function monatsGitter(anker: string): readonly {
  tag: string; ausserhalb: boolean;
}[] {
  const { jahr, monat } = teile(anker);
  const erster = `${String(jahr).padStart(4, '0')}-${z2(monat)}-01`;
  const start = plusTage(erster, -(wochentag(erster) - 1));

  const zellen: { tag: string; ausserhalb: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const tag = plusTage(start, i);
    zellen.push({ tag, ausserhalb: teile(tag).monat !== monat });
    /*
     * Sechs Wochen sind die Obergrenze, fuenf der Regelfall: sobald die
     * letzte begonnene Woche vollstaendig ist UND der Monat vorbei, hoert das
     * Gitter auf. Immer sechs Zeilen zu zeichnen hiesse, in den meisten
     * Monaten eine leere Zeile zu zeigen.
     */
    if (i % 7 === 6 && teile(plusTage(tag, 1)).monat !== monat) break;
  }
  return zellen;
}
