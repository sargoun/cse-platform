/**
 * Das Dashboard fuellt die Kacheln (DSH-01, DSH-03).
 *
 * **Der Bereichsfilter ist EIN Argument.** Alle Kacheln bekommen dieselbe
 * `mandant_ids`-Liste; ein Wechsel des Bereichs aendert damit jede Zahl, jeden
 * Link und jede Liste in einem Schritt. Waere der Filter je Kachel gebaut,
 * zeigte nach dem Wechsel die eine den neuen Bereich und die andere noch den
 * alten — und das faellt niemandem auf, weil beide Zahlen plausibel aussehen.
 *
 * **Die Liste kommt aus DERSELBEN Bedingung wie die Zahl.** Deshalb steht das
 * Praedikat einmal in der Kachel und nicht zweimal hier.
 */
import { kacheln, sichtbareKacheln, type Kachel, type KachelKontext }
  from '../../registry/kennzahlen.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface KachelWert {
  readonly kachel: Kachel;
  readonly wert: number;
  readonly ziel: string;
}

export class DashboardFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'DashboardFehler'; }
}

/** Der Wert EINER Kachel. */
export async function kachelWert(
  db: Abfrage, kachel: Kachel, kontext: KachelKontext,
): Promise<number> {
  const zeilen = await db.abfrage<{ wert: number | string }>(
    kachel.zaehlung, [kontext.mandantIds],
  );
  const roh = zeilen[0]?.wert;
  if (roh === undefined) {
    // Eine Zaehlung, die nichts liefert, ist ein Fehler in der Kachel — nicht
    // eine Null. `0` waere hier eine Behauptung ueber die Daten.
    throw new DashboardFehler(
      `Kachel ${kachel.schluessel}: \`zaehlung\` lieferte keine Zeile. `
      + 'Eine fehlende Zeile ist kein Nullwert.',
    );
  }
  return typeof roh === 'number' ? roh : Number(roh);
}

/** Alle Kacheln, die dieser Benutzer sehen darf, mit ihren Werten. */
export async function dashboard(
  db: Abfrage,
  kontext: KachelKontext,
  hatRecht: (recht: string) => boolean,
): Promise<readonly KachelWert[]> {
  const sichtbar = sichtbareKacheln(hatRecht);
  const werte: KachelWert[] = [];
  for (const kachel of sichtbar) {
    werte.push({
      kachel,
      wert: await kachelWert(db, kachel, kontext),
      ziel: kachel.ziel(kontext),
    });
  }
  return werte;
}

/** Die Zeilen HINTER einer Kachel — dieselbe Bedingung, ohne `count`. */
export async function kachelZeilen(
  db: Abfrage, kachel: Kachel, kontext: KachelKontext,
): Promise<readonly Record<string, unknown>[]> {
  return db.abfrage<Record<string, unknown>>(kachel.zeilen, [kontext.mandantIds]);
}

/**
 * Die Module, aus denen ueberhaupt Kacheln kommen.
 *
 * Der Test nutzt das, um zu belegen, dass fuer ein NICHT gemergtes Modul keine
 * Kachel existiert — `0` darf nie "noch nicht gebaut" heissen.
 */
export function belegteModule(): readonly string[] {
  return [...new Set(kacheln().map((k) => k.modul))].sort();
}
