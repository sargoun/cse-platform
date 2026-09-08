/**
 * Time — invariant 2 and K-11.
 *
 * Instants are stored UTC. A **duration** is the difference of two UTC
 * instants, so it is DST-correct for free: the spring-forward night really is
 * 420 minutes of work and the fall-back night really is 540, and no wall-clock
 * subtraction can produce those numbers.
 *
 * A **day, month or billing period**, on the other hand, is a *Berlin*
 * boundary converted to an instant — never UTC midnight. Splitting a night
 * shift at UTC midnight misattributes 60 minutes in winter and 120 in summer,
 * and that error propagates into the §17 MiLoG record, the monthly hours
 * account and the invoice period split.
 *
 * Berlin boundaries are derived from `Intl` with `timeZone: 'Europe/Berlin'`,
 * which carries the IANA rules. No offset is hard-coded anywhere in this file.
 */

export const BERLIN = 'Europe/Berlin' as const;

export class ZeitFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZeitFehler';
  }
}

const TEILE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface BerlinWanduhr {
  readonly jahr: number;
  readonly monat: number;
  readonly tag: number;
  readonly stunde: number;
  readonly minute: number;
  readonly sekunde: number;
}

/** The Berlin wall-clock reading of a UTC instant. */
export function berlinTeile(instant: Date): BerlinWanduhr {
  const teile = new Map<string, number>(
    TEILE.formatToParts(instant)
      .filter((t) => t.type !== 'literal')
      .map((t) => [String(t.type), Number(t.value)] as const),
  );
  const hole = (k: string): number => {
    const v = teile.get(k);
    if (v === undefined) throw new ZeitFehler(`Intl lieferte kein ${k}`);
    return v;
  };
  const stunde = hole('hour');
  return {
    jahr: hole('year'),
    monat: hole('month'),
    tag: hole('day'),
    // en-CA renders midnight as 24 in some ICU builds; normalise it.
    stunde: stunde === 24 ? 0 : stunde,
    minute: hole('minute'),
    sekunde: hole('second'),
  };
}

/** `2026-03-29` — the Berlin calendar day an instant falls on. */
export function berlinKalendertag(instant: Date): string {
  const t = berlinTeile(instant);
  return `${String(t.jahr).padStart(4, '0')}-${String(t.monat).padStart(2, '0')}-${String(t.tag).padStart(2, '0')}`;
}

const ANZEIGE = new Intl.DateTimeFormat('de-DE', {
  timeZone: BERLIN,
  dateStyle: 'short',
  timeStyle: 'short',
});

/** Display form. UI shows Berlin; storage stays UTC (invariant 2). */
export function berlinAnzeige(instant: Date): string {
  return ANZEIGE.format(instant);
}

/** Minutes offset of Berlin from UTC at a given instant (+60 CET, +120 CEST). */
function berlinVersatzMinuten(instant: Date): number {
  const t = berlinTeile(instant);
  const alsUtc = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde);
  return Math.round((alsUtc - instant.getTime()) / 60_000);
}

/**
 * The instant of a Berlin wall-clock time.
 *
 * Resolved by guessing the offset and correcting once, which converges for
 * every real case including both transition nights. A wall-clock time that
 * does not exist (02:30 on the spring-forward day) resolves forward, and one
 * that occurs twice (02:30 on the fall-back day) resolves to the first
 * occurrence — stated here because leaving it to chance is how a nightly
 * generator produces a shift an hour off, twice a year.
 */
export function berlinInstant(
  jahr: number,
  monat: number,
  tag: number,
  stunde = 0,
  minute = 0,
): Date {
  const naiv = Date.UTC(jahr, monat - 1, tag, stunde, minute);
  const ersterVersuch = new Date(naiv - 60 * 60_000);
  const versatz = berlinVersatzMinuten(ersterVersuch);
  const kandidat = new Date(naiv - versatz * 60_000);
  const versatz2 = berlinVersatzMinuten(kandidat);
  return versatz2 === versatz ? kandidat : new Date(naiv - versatz2 * 60_000);
}

/** The instant at which a Berlin month begins. */
export function berlinMonatsBeginn(jahr: number, monat: number): Date {
  return berlinInstant(jahr, monat, 1, 0, 0);
}

/**
 * Duration in whole minutes between two UTC instants.
 *
 * This is the difference of instants and nothing else — which is exactly why
 * it is right across a DST transition (K-11).
 */
export function dauerMinuten(vonUtc: Date, bisUtc: Date): number {
  const ms = bisUtc.getTime() - vonUtc.getTime();
  if (Number.isNaN(ms)) throw new ZeitFehler('Ungültiges Datum');
  if (ms < 0) {
    throw new ZeitFehler(
      `Ende liegt vor Beginn: ${vonUtc.toISOString()} → ${bisUtc.toISOString()}`,
    );
  }
  if (ms % 60_000 !== 0) {
    throw new ZeitFehler('Zeiten sind auf die Minute genau zu erfassen');
  }
  return ms / 60_000;
}

export interface MonatsAnteil {
  readonly jahr: number;
  readonly monat: number;
  readonly minuten: number;
}

/**
 * Split an interval across **Berlin** month boundaries (K-11).
 *
 * `splitteNachMonat('2026-01-31T21:00Z', '2026-02-01T05:00Z')`
 *   → `[{2026,1,120}, {2026,2,360}]`
 *
 * 21:00Z is 22:00 Berlin in CET and the Berlin month boundary is 23:00Z, so a
 * UTC-midnight split would report 180/300 — the failure this function exists
 * to prevent. The parts sum to `dauerMinuten` exactly.
 */
export function splitteNachMonat(vonUtc: Date, bisUtc: Date): readonly MonatsAnteil[] {
  const gesamt = dauerMinuten(vonUtc, bisUtc);
  if (gesamt === 0) return [];

  const anteile: MonatsAnteil[] = [];
  let cursor = vonUtc;

  while (cursor.getTime() < bisUtc.getTime()) {
    const t = berlinTeile(cursor);
    const naechsterMonat = t.monat === 12 ? { j: t.jahr + 1, m: 1 } : { j: t.jahr, m: t.monat + 1 };
    const grenze = berlinMonatsBeginn(naechsterMonat.j, naechsterMonat.m);
    const ende = grenze.getTime() < bisUtc.getTime() ? grenze : bisUtc;
    anteile.push({ jahr: t.jahr, monat: t.monat, minuten: dauerMinuten(cursor, ende) });
    cursor = ende;
  }

  const summe = anteile.reduce((s, a) => s + a.minuten, 0);
  if (summe !== gesamt) {
    throw new ZeitFehler(`Monatssplit verliert Minuten: ${summe} statt ${gesamt}`);
  }
  return anteile;
}

/**
 * Distribute a recorded break total across the parts of a split, largest
 * remainder, so the parts sum to the recorded total **exactly** (§18 case 5).
 * A break is never invented and never rounded away.
 */
export function verteilePausenMinuten(
  anteile: readonly MonatsAnteil[],
  pauseMinutenGesamt: number,
): readonly number[] {
  if (anteile.length === 0) return [];
  if (!Number.isInteger(pauseMinutenGesamt) || pauseMinutenGesamt < 0) {
    throw new ZeitFehler(`Pausenminuten sind eine nicht-negative Ganzzahl: ${pauseMinutenGesamt}`);
  }
  const gesamtMinuten = anteile.reduce((s, a) => s + a.minuten, 0);
  if (gesamtMinuten === 0) return anteile.map(() => 0);

  const roh = anteile.map((a) => (pauseMinutenGesamt * a.minuten) / gesamtMinuten);
  const abgerundet = roh.map((r) => Math.floor(r));
  let rest = pauseMinutenGesamt - abgerundet.reduce((s, v) => s + v, 0);

  const nachRest = roh
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);

  const ergebnis = [...abgerundet];
  for (const { i } of nachRest) {
    if (rest <= 0) break;
    ergebnis[i] = (ergebnis[i] ?? 0) + 1;
    rest -= 1;
  }
  return ergebnis;
}
