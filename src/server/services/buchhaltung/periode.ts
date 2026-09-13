import 'server-only';

/**
 * Die Buchungsperiode und ihr Anlegen (ACC-08, `05-FINANZEN.md` §9.1).
 *
 * **Warum es diese Datei überhaupt gibt.** `buchungssatz.periode_id` ist
 * `NOT NULL` mit zusammengesetztem Fremdschlüssel. Eine Buchung in einen
 * Monat, für den keine `periode`-Zeile existiert, scheitert also am fehlenden
 * Elternteil — **innerhalb der Festschreibungstransaktion, in der Produktion,
 * bei der ersten Buchung jedes neuen Monats.** Das ist so spät und so teuer,
 * wie ein Fehlschlag nur sein kann. `sicherePeriode` läuft deshalb VOR der
 * ersten Buchung eines Laufs, und der Monatslauf öffnet zusätzlich im Voraus.
 *
 * **Kein `create if not exists` von Hand.** Zwei gleichzeitige
 * Festschreibungen im selben neuen Monat sind kein seltener Fall, sondern der
 * Normalfall am Monatsersten: `insert … on conflict do nothing` plus
 * anschliessendes `select` ist die einzige Fassung, die beide überleben.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Das Wirtschaftsjahr beginnt nicht am Ersten — und dann wissen wir nicht,
 * wie die Perioden heissen sollen.
 *
 * Ein Wirtschaftsjahr, das am 1. April beginnt, hat weiter Kalendermonate;
 * eines, das am 15. beginnt, hätte Perioden vom 15. bis zum 14. Wie diese
 * Perioden dann zu nummerieren sind und was der Steuerberater in DATEV
 * eingerichtet hat, ist nicht abzuleiten. Also wird nicht abgeleitet.
 */
export class PeriodeUnklarFehler extends Error {
  constructor(public readonly tag: number) {
    super(
      `Das Wirtschaftsjahr beginnt am ${String(tag)}. eines Monats. Wie die `
      + 'Buchungsperioden dann zu schneiden und zu benennen sind, steht in der '
      + 'DATEV-Einrichtung des Steuerberaters (O-05) — die Plattform rät das nicht.',
    );
    this.name = 'PeriodeUnklarFehler';
  }
}

export interface Periode {
  readonly id: string;
  readonly jahr: number;
  readonly monat: number;
  readonly beginnAm: string;
  readonly endeAm: string;
  readonly status: 'offen' | 'vorlaeufig_geschlossen' | 'geschlossen';
}

interface PeriodeRoh {
  readonly id: string;
  readonly jahr: number;
  readonly monat: number;
  readonly beginn_am: string;
  readonly ende_am: string;
  readonly status: Periode['status'];
}

interface KonfigRoh {
  readonly wj_beginn_tag: number | null;
}

const zuPeriode = (r: PeriodeRoh): Periode => ({
  id: r.id,
  jahr: r.jahr,
  monat: r.monat,
  beginnAm: r.beginn_am,
  endeAm: r.ende_am,
  status: r.status,
});

/**
 * Sorgt dafür, dass es die Periode zu einem Buchungsdatum gibt — und gibt sie
 * zurück.
 *
 * Die Grenzen rechnet **Postgres** aus `date_trunc('month', …)`, nicht
 * JavaScript: `buchungsdatum` ist ein Kalendertag nach Berliner Zeit
 * (Invariante 2, K-11), und ein Umweg über `Date` in einem Prozess mit
 * `TZ=UTC` verschöbe den Monatswechsel um zwei Stunden — an genau zwei Tagen
 * im Jahr, und dann still.
 */
export async function sicherePeriode(
  db: Abfrage, mandantId: string, buchungsdatum: string,
): Promise<Periode> {
  const [konfig] = await db.abfrage<KonfigRoh>(
    'select wj_beginn_tag from datev_konfiguration where mandant_id = $1', [mandantId]);

  const tag = konfig?.wj_beginn_tag ?? null;
  if (tag !== null && tag !== 1) throw new PeriodeUnklarFehler(tag);

  /*
   * **Ueber `app.periode_sichern` und nicht mit einem eigenen INSERT** (D-418).
   * Der Monat entsteht INNERHALB der Festschreibung einer Rechnung; liefe der
   * INSERT als der Aufrufer, braeuchte jede Abrechnungskraft
   * `buchhaltung.schreiben`. Das Tor verlangt stattdessen das Recht zur
   * HANDLUNG (`finanzen.schreiben`) und tut genau diese eine Sache.
   */
  await db.abfrage('select app.periode_sichern($1, $2::date)', [mandantId, buchungsdatum]);

  const [zeile] = await db.abfrage<PeriodeRoh>(
    `select id, jahr, monat, beginn_am::text, ende_am::text, status::text as status
       from periode
      where mandant_id = $1
        and $2::date between beginn_am and ende_am`,
    [mandantId, buchungsdatum]);

  if (zeile === undefined) {
    // Kein Rennen, sondern ein Rechtefehler: die Policy hat den INSERT
    // verworfen. Das laut zu sagen ist besser als ein zweiter Versuch.
    throw new Error(
      `Die Periode zum ${buchungsdatum} liess sich weder anlegen noch lesen — `
      + 'fehlt buchhaltung.schreiben?',
    );
  }
  return zuPeriode(zeile);
}

/** Die zwölf nächsten Perioden öffnen (Monatslauf `periodenVorlauf`, §11). */
export async function periodenVorlauf(
  db: Abfrage, mandantId: string, abDatum: string, monate = 12,
): Promise<number> {
  let angelegt = 0;
  for (let i = 0; i < monate; i += 1) {
    const [zeile] = await db.abfrage<{ readonly tag: string }>(
      "select (date_trunc('month', $1::date) + make_interval(months => $2))::date::text as tag",
      [abDatum, i]);
    if (zeile === undefined) continue;
    const vorher = await db.abfrage<{ readonly id: string }>(
      'select id from periode where mandant_id = $1 and $2::date between beginn_am and ende_am',
      [mandantId, zeile.tag]);
    await sicherePeriode(db, mandantId, zeile.tag);
    if (vorher.length === 0) angelegt += 1;
  }
  return angelegt;
}
