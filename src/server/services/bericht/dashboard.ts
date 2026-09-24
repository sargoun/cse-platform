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
 *
 * **Eine Kachel erscheint nur, wenn sich ihr Ziel öffnet** (V-151, D-645,
 * DSH-04, AUT-06). Gefiltert wurde nur nach dem Recht der Kachel. Die
 * Kachel „Bauprojekte in Arbeit" (`bau.lesen`) erschien damit bei Leitung und
 * Administration in JEDER Gesellschaft — `bau.lesen` halten beide global —,
 * und in der Reinigung führte sie auf `/bau/projekte`, das die Pforte dort
 * mit 404 beantwortet, weil die Gesellschaft Bau nicht gebucht hat. Eine Zahl,
 * die auf einen 404 führt, ist eine tote Zahl, und eine Bau-Kennzahl in einer
 * Gesellschaft ohne Bau ist eine Auskunft über etwas, das es dort nicht gibt.
 * Deshalb fragt `kachelErreichbar` dasselbe wie die Pforte: die Rechte des
 * Ziels UND die Modulbuchung — über dieselbe Funktion (`routeGesperrt`).
 */
import { kacheln, sichtbareKacheln, type Kachel, type KachelKontext }
  from '../../registry/kennzahlen.js';
import { modulAktiv, type Modulbuchung } from '../../registry/modul.js';
import { findeRoute, leserechte, routeGesperrt } from '../../registry/routen.js';

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

/**
 * Darf diese Kachel hier erscheinen — und öffnet sich ihr Ziel?
 *
 * Vier Fragen, jede eine Antwort, die die Pforte (`app/portal/zugang.ts`)
 * sonst NACH dem Klick mit 404 gäbe:
 *
 *  1. Hält die Sitzung das Recht der Kachel und ihre `zusatzRechte`?
 *  2. Hat die Gesellschaft das Modul der Kachel und ihrer Rechte gebucht
 *     (`modulAktiv`, D-377)? Die Datenbank fragt das nicht: `app.hat_recht`
 *     schneidet nur mit `benutzer_mandant.module`, nicht mit `mandant.module`.
 *  3. Ist die Zielroute im Manifest, und ist sie in dieser Gesellschaft nicht
 *     gesperrt (`routeGesperrt` — dieselbe Funktion wie die Pforte)?
 *  4. Hält die Sitzung ALLE Leserechte der Zielroute? Mehrere sind eine
 *     UND-Verknüpfung; „Offene Konflikte" (`dienstplan.arbzg_lesen`) führt
 *     auf eine Seite, die zusätzlich `dienstplan.lesen` verlangt.
 *
 * Eine Route ohne Rechtebewachung (Sitzung, Selbstzugriff) sperrt nichts.
 */
export function kachelErreichbar(
  kachel: Kachel,
  kontext: KachelKontext,
  hatRecht: (recht: string) => boolean,
  buchung: Modulbuchung,
): boolean {
  const eigene = [kachel.recht, ...(kachel.zusatzRechte ?? [])];
  if (!eigene.every(hatRecht)) return false;
  if (![kachel.modul, ...eigene].every((r) => modulAktiv(buchung, r))) return false;
  const route = findeRoute(kachel.ziel(kontext));
  if (route === undefined || routeGesperrt(route, buchung)) return false;
  return leserechte(route).every(hatRecht);
}

/**
 * Jedes Recht, nach dem `kachelErreichbar` fragen wird — die der Kacheln UND
 * die ihrer Ziele. Für EINE Rundreise statt einer je Kachel.
 */
export function kachelRechte(kontext: KachelKontext): readonly string[] {
  const rechte = new Set<string>();
  for (const k of kacheln()) {
    rechte.add(k.recht);
    for (const r of k.zusatzRechte ?? []) rechte.add(r);
    const route = findeRoute(k.ziel(kontext));
    if (route !== undefined) for (const r of leserechte(route)) rechte.add(r);
  }
  return [...rechte].sort();
}

/**
 * Alle Kacheln, die dieser Benutzer sehen darf und deren Ziel sich öffnet,
 * mit ihren Werten.
 *
 * **Die Buchung ist Pflicht, kein Zusatz** (V-151). Wer keine Gesellschaft
 * bewertet — die Entwicklungsübersicht, deren Ziele `/dev/kennzahl/…` sind —,
 * sagt das mit `{ module: [], gepflegt: false }` ausdrücklich.
 */
export async function dashboard(
  db: Abfrage,
  kontext: KachelKontext,
  hatRecht: (recht: string) => boolean,
  buchung: Modulbuchung,
): Promise<readonly KachelWert[]> {
  const sichtbar = sichtbareKacheln(hatRecht)
    .filter((k) => kachelErreichbar(k, kontext, hatRecht, buchung));
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

/**
 * Die Übersicht EINES Bereichs, wie `/portal/[mandant]` sie zeigt (DSH-03).
 *
 * Buchung und Rechte kommen aus derselben gebundenen Transaktion wie die
 * Zahlen: `app.hat_recht` antwortet nur dort, und eine Buchung aus einer
 * anderen Rundreise könnte eine andere sein als die, gegen die gezählt wird.
 * Die Rechte werden EINMAL geholt, nicht je Kachel — `dashboard()` filtert
 * synchron und soll nicht wissen, dass die Antwort aus der Datenbank kommt.
 */
export async function bereichsDashboard(
  db: Abfrage,
  kontext: KachelKontext & { readonly mandantId: string },
): Promise<readonly KachelWert[]> {
  const [m] = await db.abfrage<{ module: readonly string[] | null; module_gepflegt: boolean }>(
    `select module, module_gepflegt from mandant where id = $1::uuid`, [kontext.mandantId]);
  const buchung: Modulbuchung = {
    module: m?.module ?? [], gepflegt: m?.module_gepflegt === true,
  };
  const antworten = await db.abfrage<{ recht: string; ok: boolean }>(
    `select r as recht, app.hat_recht(r, $2::uuid) as ok
       from unnest($1::text[]) as r`,
    [kachelRechte(kontext), kontext.mandantId],
  );
  const gehalten = new Set(antworten.filter((a) => a.ok).map((a) => a.recht));
  return dashboard(db, kontext, (recht) => gehalten.has(recht), buchung);
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
