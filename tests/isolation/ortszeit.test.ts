/**
 * Die Aufloesung Wanduhr → Instant in der Datenbank (§7.2, K-11).
 *
 * Sie steht hier und nicht bei den Einheitstests, weil ihr Vertrag die
 * Zonendatenbank des SERVERS ist. Ein Test, der dieselbe Rechnung in Node
 * nachbaut, prueft nur, dass zwei Implementierungen uebereinstimmen — und
 * genau das soll es nicht geben (§7.2: der Node-Prozess rechnet keine Zone um).
 *
 * Die Daten sind die aus K-11, woertlich. Der Kontrollfall „22:00 AM
 * Umstellungstag = 480" gehoert dazu: ohne ihn besteht eine Fassung, die den
 * Tag um eins verschiebt, alle anderen Faelle.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

interface Aufloesung { zeitpunkt: Date; anomalie: string }

async function loese(datum: string, zeit: string, zone = 'Europe/Berlin'): Promise<Aufloesung> {
  const [z] = await sql.unsafe<Aufloesung[]>(
    `select zeitpunkt, anomalie from app.loese_ortszeit($1::date, $2::time, $3)`,
    [datum, zeit, zone],
  );
  return z!;
}

/** Der Abstand zweier Instants in Minuten — dieselbe Rechnung wie PR 1. */
async function minuten(
  vonDatum: string, vonZeit: string, bisDatum: string, bisZeit: string,
): Promise<number> {
  const a = await loese(vonDatum, vonZeit);
  const b = await loese(bisDatum, bisZeit);
  return Math.round((b.zeitpunkt.getTime() - a.zeitpunkt.getTime()) / 60_000);
}

afterAll(async () => { await schliessen(); });

describe('die drei Naechte (K-11)', () => {
  it('eine gewoehnliche Nacht 22:00 → 06:00 dauert 480 Minuten', async () => {
    expect(await minuten('2026-03-20', '22:00', '2026-03-21', '06:00')).toBe(480);
  });

  it('die Nacht der Vorstellung 28.03. 22:00 → 29.03. 06:00 dauert 420', async () => {
    expect(await minuten('2026-03-28', '22:00', '2026-03-29', '06:00')).toBe(420);
  });

  it('die Nacht der Rueckstellung 24.10. 22:00 → 25.10. 06:00 dauert 540', async () => {
    expect(await minuten('2026-10-24', '22:00', '2026-10-25', '06:00')).toBe(540);
  });

  it('KONTROLLE: eine Schicht, die AM Umstellungstag um 22:00 beginnt, dauert 480', async () => {
    // Die Umstellung ist morgens vorbei. Wer den Plantag um eins verschiebt,
    // faellt genau hier durch und sonst nirgends.
    expect(await minuten('2026-03-29', '22:00', '2026-03-30', '06:00')).toBe(480);
    expect(await minuten('2026-10-25', '22:00', '2026-10-26', '06:00')).toBe(480);
  });

  it('und keiner der vier Faelle ist eine Anomalie', async () => {
    for (const [d, z] of [
      ['2026-03-20', '22:00'], ['2026-03-28', '22:00'], ['2026-03-29', '06:00'],
      ['2026-10-24', '22:00'], ['2026-10-25', '06:00'], ['2026-03-29', '22:00'],
    ] as const) {
      expect((await loese(d, z)).anomalie, `${d} ${z}`).toBe('keine');
    }
  });
});

describe('die beiden pathologischen Ortszeiten (§7.2)', () => {
  it('02:30 am 29.03.2026 gibt es nicht — und benutzt wird der Umstellungsinstant', async () => {
    const a = await loese('2026-03-29', '02:30');
    expect(a.anomalie).toBe('dst_luecke');
    // 01:00 UTC ist der Moment, in dem 02:00 MEZ zu 03:00 MESZ wird. NICHT
    // 01:30 UTC — das waere, was Postgres von sich aus liefert, und damit
    // eine halbe Stunde nach der Umstellung.
    expect(a.zeitpunkt.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('auch 02:00 selbst gibt es nicht', async () => {
    expect((await loese('2026-03-29', '02:00')).anomalie).toBe('dst_luecke');
  });

  it('02:30 am 25.10.2026 gibt es zweimal — genommen wird der fruehere', async () => {
    const a = await loese('2026-10-25', '02:30');
    expect(a.anomalie).toBe('dst_doppelt');
    // 00:30 UTC ist 02:30 MESZ, 01:30 UTC waere 02:30 MEZ.
    expect(a.zeitpunkt.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('03:00 am 25.10.2026 gibt es wieder nur einmal', async () => {
    expect((await loese('2026-10-25', '03:00')).anomalie).toBe('keine');
  });
});

describe('die Umstellung wird gesucht, nicht aus einer Regel abgeleitet', () => {
  it('findet sie an beiden Umstellungstagen 2026 auf die Sekunde', async () => {
    const [a] = await sql.unsafe<{ m: Date | null; o: Date | null; k: Date | null }[]>(
      `select app.zonenumstellung('2026-03-29','Europe/Berlin') as m,
              app.zonenumstellung('2026-10-25','Europe/Berlin') as o,
              app.zonenumstellung('2026-06-15','Europe/Berlin') as k`);
    expect(a!.m?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(a!.o?.toISOString()).toBe('2026-10-25T01:00:00.000Z');
    expect(a!.k).toBeNull();
  });

  it('trifft auch eine Zone mit halbstuendigem Sprung (Lord Howe)', async () => {
    // Kein Objekt der Gruppe liegt dort. Der Fall steht hier, weil er eine
    // fest verdrahtete Stunde entlarvt: die Suche darf die Sprungweite nicht
    // kennen, sondern muss sie aus der Zonendatenbank lesen.
    const a = await loese('2026-10-04', '02:15', 'Australia/Lord_Howe');
    expect(a.anomalie).toBe('dst_luecke');
  });

  it('eine Zone ohne Umstellung hat keine — und keine Anomalie', async () => {
    expect((await loese('2026-03-29', '02:30', 'UTC')).anomalie).toBe('keine');
    expect((await loese('2026-10-25', '02:30', 'Asia/Tokyo')).anomalie).toBe('keine');
  });

  it('ohne Zone wirft die Funktion, statt Berlin anzunehmen', async () => {
    await expect(
      sql.unsafe(`select * from app.loese_ortszeit('2026-01-01'::date, '08:00'::time, '')`),
    ).rejects.toThrow(/Zeitzone/u);
  });
});
