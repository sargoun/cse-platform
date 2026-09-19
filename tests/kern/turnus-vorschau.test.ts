/**
 * Die Vorschau eines Reinigungsturnus — die vier Pflichtfaelle aus CLAUDE.md,
 * ohne Datenbank.
 *
 * CLAUDE.md verlangt vier Tests, BEVOR eine Planungsoberflaeche gebaut wird:
 * die Schicht 22:00–06:00, die Nacht der Vorstellung, die Nacht der
 * Rueckstellung und zehn Schichten zum selben Instant auf einem Objekt. Die
 * ersten drei sind hier pruefbar, weil `turnusVorschau` die Instants selbst
 * aufloest — anders als `planeVorkommnisse`, das sie bewusst weglaesst
 * („Postgres setzt ihn"). Der vierte Fall ist zur Haelfte hier
 * (Determinismus: zehn Aufrufe, derselbe Instant) und zur Haelfte im
 * Isolationstest, wo zehn `einsatz`-Zeilen entstehen.
 *
 * **Die Zahlen sind der Punkt.** Eine 480-Minuten-Schicht dauert in der Nacht
 * der Vorstellung 420 und in der Nacht der Rueckstellung 540 Minuten, weil die
 * Dauer die Differenz zweier INSTANTS ist und nicht die Differenz zweier
 * Wanduhrzeiten (Invariante 2). Wer mit der Wanduhr rechnet, bekommt zweimal
 * 480 — und bezahlt in der einen Nacht eine Stunde zu viel und in der anderen
 * eine zu wenig.
 *
 * 2026: Vorstellung in der Nacht zum **29. Maerz**, Rueckstellung in der Nacht
 * zum **25. Oktober** (jeweils der letzte Sonntag des Monats).
 */
import { describe, expect, it } from 'vitest';
import {
  turnusVorschau, VorschauFehler,
  type VorschauAusnahme, type VorschauTermin, type VorschauTraeger,
} from '@/server/services/reinigung/turnusvorschau';

const KEINE_FEIERTAGE = new Map<string, string>();

function traeger(ueber: Partial<VorschauTraeger> = {}): VorschauTraeger {
  return {
    rrule: 'FREQ=DAILY',
    dtstartLokal: { datum: '2026-01-01', stunde: 22, minute: 0 },
    dauerMinuten: 480,
    feiertagsregel: 'ausfall',
    gueltigAb: '2026-01-01',
    gueltigBis: null,
    ...ueber,
  };
}

function nurTag(termine: readonly VorschauTermin[], tag: string): VorschauTermin {
  const treffer = termine.find((t) => t.planDatum === tag);
  if (treffer === undefined) throw new Error(`kein Termin am ${tag}`);
  return treffer;
}

describe('Pflichtfall 1 — die Schicht 22:00 bis 06:00', () => {
  it('endet am Folgetag, auf der Wanduhr und im Instant', () => {
    const termine = turnusVorschau(
      traeger(), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-01-05', bisDatum: '2026-01-05' },
    );
    expect(termine).toHaveLength(1);
    const t = termine[0]!;
    expect(t.beginnLokal).toBe('22:00');
    expect(t.endeLokal).toBe('06:00');
    expect(t.endetAmFolgetag).toBe(true);
    // Eine normale Winternacht: acht Stunden, nominal wie wirklich.
    expect(t.dauerNominal).toBe(480);
    expect(t.dauerInstant).toBe(480);
    expect(t.anomalie).toBe('keine');
    // CET = UTC+1: 22:00 Ortszeit ist 21:00 UTC.
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-01-05T21:00:00.000Z');
    expect(t.endeZeitpunkt?.toISOString()).toBe('2026-01-06T05:00:00.000Z');
  });

  it('das ENDE ist ein eigener Anker, nicht Beginn plus Dauer', () => {
    /*
     * Die Probe auf die Bauart: waere das Ende `beginnZeitpunkt + dauer`,
     * ergaeben die beiden Umstellungsnaechte unten zweimal 480. Hier steht der
     * Sommerfall zum Vergleich — CEST = UTC+2.
     */
    const termine = turnusVorschau(
      traeger(), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-07-06', bisDatum: '2026-07-06' },
    );
    const t = termine[0]!;
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-07-06T20:00:00.000Z');
    expect(t.endeZeitpunkt?.toISOString()).toBe('2026-07-07T04:00:00.000Z');
    expect(t.dauerInstant).toBe(480);
  });
});

describe('Pflichtfall 2 — die Nacht der Vorstellung (29. Maerz 2026)', () => {
  it('die 480-Minuten-Schicht dauert 420 Minuten', () => {
    const termine = turnusVorschau(
      traeger(), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-03-28', bisDatum: '2026-03-28' },
    );
    const t = termine[0]!;
    expect(t.beginnLokal).toBe('22:00');
    expect(t.endeLokal).toBe('06:00');
    expect(t.dauerNominal).toBe(480);
    // 22:00 CET (21:00 UTC) bis 06:00 CEST (04:00 UTC) = sieben Stunden.
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-03-28T21:00:00.000Z');
    expect(t.endeZeitpunkt?.toISOString()).toBe('2026-03-29T04:00:00.000Z');
    expect(t.dauerInstant).toBe(420);
  });

  it('eine Uhrzeit in der Luecke wird als `dst_luecke` gemeldet, nicht verschoben', () => {
    const termine = turnusVorschau(
      traeger({ dtstartLokal: { datum: '2026-01-01', stunde: 2, minute: 30 } }),
      [], KEINE_FEIERTAGE, { vonDatum: '2026-03-29', bisDatum: '2026-03-29' },
    );
    const t = termine[0]!;
    // Das Plandatum bleibt der Tag, den die Regel genannt hat, und die
    // geplante Wanduhrzeit bleibt 02:30 — der Instant liest sich als 03:30.
    expect(t.planDatum).toBe('2026-03-29');
    expect(t.beginnLokal).toBe('02:30');
    expect(t.anomalie).toBe('dst_luecke');
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('Pflichtfall 3 — die Nacht der Rueckstellung (25. Oktober 2026)', () => {
  it('die 480-Minuten-Schicht dauert 540 Minuten', () => {
    const termine = turnusVorschau(
      traeger(), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-10-24', bisDatum: '2026-10-24' },
    );
    const t = termine[0]!;
    expect(t.dauerNominal).toBe(480);
    // 22:00 CEST (20:00 UTC) bis 06:00 CET (05:00 UTC) = neun Stunden.
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-10-24T20:00:00.000Z');
    expect(t.endeZeitpunkt?.toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(t.dauerInstant).toBe(540);
  });

  it('eine doppelt vorhandene Uhrzeit wird als `dst_doppelt` gemeldet', () => {
    const termine = turnusVorschau(
      traeger({ dtstartLokal: { datum: '2026-01-01', stunde: 2, minute: 30 } }),
      [], KEINE_FEIERTAGE, { vonDatum: '2026-10-25', bisDatum: '2026-10-25' },
    );
    const t = termine[0]!;
    expect(t.anomalie).toBe('dst_doppelt');
    /*
     * Die Vorgabe ist der FRUEHERE Instant (noch CEST) — die Regel, die
     * 04-PLANUNG-ZEIT.md §7.2 als Platzhalter festhaelt (O-163). Welcher der
     * beiden gilt, ist eine Verguetungsfrage und keine technische; der Test
     * haelt die heutige Vorgabe fest, damit eine Aenderung auffaellt.
     */
    expect(t.beginnZeitpunkt?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('Pflichtfall 4, Haelfte 1 von 2 — die Aufloesung ist deterministisch', () => {
  it('zehn Vorschauen derselben Regel ergeben denselben Instant', () => {
    /*
     * **Dieser Test ist NICHT der ganze Pflichtfall.** Er prueft die Haelfte,
     * die ohne Datenbank pruefbar ist: die Aufloesung ist deterministisch,
     * also traegt jede der zehn Serien auf demselben Objekt denselben
     * Zeitpunkt. Wer hier aufhoert, hat zehn Aufrufe einer reinen Funktion
     * gemessen und keine zehn Schichten.
     *
     * Die andere Haelfte — zehn `einsatz`-Zeilen auf EINEM Objekt zum selben
     * Instant, gegen echtes Postgres, mit Eindeutigkeitsindex und Besetzung —
     * steht in `tests/isolation/dienstplan-generator.test.ts`, Abschnitt
     * „(5) zehn Serien zur selben Sekunde an einem Objekt (TIM-04)". Die
     * strukturelle Zusage dazu (keine Ausschlussbedingung, kein eindeutiger
     * Index ueber Objekt und Beginn) haelt
     * `tests/kern/dienstplan-schema.test.ts`, Abschnitt „TIM-04".
     */
    const instants = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const termine = turnusVorschau(
        traeger({ dtstartLokal: { datum: '2026-01-01', stunde: 6, minute: 0 } }),
        [], KEINE_FEIERTAGE, { vonDatum: '2026-05-04', bisDatum: '2026-05-04' },
      );
      instants.add(termine[0]!.beginnZeitpunkt!.toISOString());
    }
    expect(instants.size).toBe(1);
    expect([...instants][0]).toBe('2026-05-04T04:00:00.000Z');
  });
});

describe('was ausfaellt, steht MIT in der Liste', () => {
  it('ein Feiertag faellt aus und nennt seinen Namen', () => {
    const feiertage = new Map([['2026-05-01', 'Tag der Arbeit']]);
    const termine = turnusVorschau(
      traeger({ dtstartLokal: { datum: '2026-01-01', stunde: 6, minute: 0 } }),
      [], feiertage, { vonDatum: '2026-04-30', bisDatum: '2026-05-02' },
    );
    expect(termine).toHaveLength(3);
    const feiertag = nurTag(termine, '2026-05-01');
    expect(feiertag.ausfall).toBe('feiertag');
    expect(feiertag.feiertag).toBe('Tag der Arbeit');
    // Ein Ausfall traegt KEINEN Instant: es gibt keinen Zeitpunkt, an dem
    // gearbeitet wird.
    expect(feiertag.beginnZeitpunkt).toBeNull();
    expect(feiertag.dauerInstant).toBeNull();
    // Die Nachbartage finden statt.
    expect(nurTag(termine, '2026-04-30').ausfall).toBeNull();
    expect(nurTag(termine, '2026-05-02').ausfall).toBeNull();
  });

  it('bei `unveraendert` findet der Feiertag statt und wird trotzdem benannt', () => {
    const feiertage = new Map([['2026-05-01', 'Tag der Arbeit']]);
    const termine = turnusVorschau(
      traeger({ feiertagsregel: 'unveraendert' }),
      [], feiertage, { vonDatum: '2026-05-01', bisDatum: '2026-05-01' },
    );
    expect(termine[0]!.ausfall).toBeNull();
    expect(termine[0]!.feiertag).toBe('Tag der Arbeit');
  });

  it('eine Ausnahme „ausfall" nennt ihren Grund', () => {
    const ausnahmen: readonly VorschauAusnahme[] = [{
      id: 'a1', datum: '2026-02-03', art: 'ausfall',
      ersatzBeginnLokal: null, dauerMinuten: null, grund: 'Objekt geschlossen',
    }];
    const termine = turnusVorschau(
      traeger(), ausnahmen, KEINE_FEIERTAGE,
      { vonDatum: '2026-02-03', bisDatum: '2026-02-03' },
    );
    expect(termine[0]!.ausfall).toBe('ausnahme_ausfall');
    expect(termine[0]!.grund).toBe('Objekt geschlossen');
  });

  it('ein Zusatztermin steht ausserhalb der Regel — auch am Feiertag', () => {
    const feiertage = new Map([['2026-10-03', 'Tag der Deutschen Einheit']]);
    const ausnahmen: readonly VorschauAusnahme[] = [{
      id: 'a2', datum: '2026-10-03', art: 'zusatz',
      ersatzBeginnLokal: '2026-10-03T09:00', dauerMinuten: 120,
      grund: 'Sonderreinigung nach Veranstaltung',
    }];
    const termine = turnusVorschau(
      /* Eine Regel, die den 3. Oktober NICHT nennt: nur Montage, und der
         3.10.2026 ist ein Samstag. */
      traeger({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      ausnahmen, feiertage, { vonDatum: '2026-10-03', bisDatum: '2026-10-03' },
    );
    expect(termine).toHaveLength(1);
    const t = termine[0]!;
    expect(t.art).toBe('zusatz');
    expect(t.ausfall).toBeNull();
    expect(t.beginnLokal).toBe('09:00');
    expect(t.dauerNominal).toBe(120);
    expect(t.feiertag).toBe('Tag der Deutschen Einheit');
  });

  it('eine Verschiebung nimmt Datum, Uhrzeit und Dauer der Ausnahme', () => {
    const ausnahmen: readonly VorschauAusnahme[] = [{
      id: 'a3', datum: '2026-02-03', art: 'verschiebung',
      ersatzBeginnLokal: '2026-02-04T05:00', dauerMinuten: 300,
      grund: 'Zugang erst am Folgetag',
    }];
    const termine = turnusVorschau(
      traeger({ rrule: 'FREQ=WEEKLY;BYDAY=TU' }), ausnahmen, KEINE_FEIERTAGE,
      { vonDatum: '2026-02-03', bisDatum: '2026-02-03' },
    );
    const t = termine[0]!;
    expect(t.art).toBe('verschiebung');
    expect(t.planDatum).toBe('2026-02-04');
    expect(t.beginnLokal).toBe('05:00');
    expect(t.dauerNominal).toBe(300);
    expect(t.dauerInstant).toBe(300);
  });

  it('ausserhalb der Geltung steht der Termin als solcher, nicht als Luecke', () => {
    const termine = turnusVorschau(
      traeger({ gueltigAb: '2026-01-01', gueltigBis: '2026-02-02' }),
      [], KEINE_FEIERTAGE, { vonDatum: '2026-02-01', bisDatum: '2026-02-04' },
    );
    expect(termine).toHaveLength(4);
    expect(nurTag(termine, '2026-02-02').ausfall).toBeNull();
    expect(nurTag(termine, '2026-02-03').ausfall).toBe('ausserhalb_gueltigkeit');
    expect(nurTag(termine, '2026-02-03').beginnZeitpunkt).toBeNull();
  });
});

describe('was die Vorschau ABWEIST', () => {
  it('eine Dauer ueber einen Tag ist ein Tippfehler', () => {
    expect(() => turnusVorschau(
      traeger({ dauerMinuten: 1440 }), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-01-05', bisDatum: '2026-01-05' },
    )).toThrow(VorschauFehler);
  });

  it('eine leere Regel hat keine Vorschau', () => {
    expect(() => turnusVorschau(
      traeger({ rrule: '   ' }), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-01-05', bisDatum: '2026-01-05' },
    )).toThrow(/keine Vorschau/u);
  });

  it('ein Datum, das der Kalender nicht kennt, faellt auf', () => {
    expect(() => turnusVorschau(
      traeger(), [], KEINE_FEIERTAGE,
      { vonDatum: '2026-02-30', bisDatum: '2026-03-01' },
    )).toThrow();
  });
});
