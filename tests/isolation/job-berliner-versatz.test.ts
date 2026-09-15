/**
 * Der Berliner Versatz, den `/api/jobs/[schluessel]` aus der Datenbank liest.
 *
 * **Der Befund.** Die Route bildete ihn als
 * `(now() at time zone 'Europe/Berlin') - now()` — links ein `timestamp`,
 * rechts ein `timestamptz`. Postgres castet den linken Wert dann über die
 * **Sitzungszeitzone** zurück. Solange die UTC ist, kommt 120 bzw. 60 heraus
 * und alles sieht richtig aus. Steht sie auf `Europe/Berlin` — eine ganz
 * gewöhnliche Einstellung —, ergibt derselbe Ausdruck **0**, und der
 * Tagesschlüssel eines Nachtlaufs trägt das UTC-Datum statt des Berliner.
 *
 * Das ist die teuerste Sorte Abweichung: sie ist in der Entwicklung unsichtbar,
 * sie wirft nichts, und sie äussert sich als ein Lauf, der unter einem Datum
 * protokolliert wird, das dem `tag` derselben Antwort widerspricht.
 *
 * Diese Datei misst deshalb in BEIDEN Sitzungszeitzonen — und zwar gegen den
 * Ausdruck, den die Route wirklich absetzt.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

/** Wortgleich der Ausdruck aus `src/app/api/jobs/[schluessel]/route.ts`. */
const VERSATZ = `(extract(epoch from (now() at time zone 'Europe/Berlin')
                                   - (now() at time zone 'UTC')) / 60)::int as versatz`;

/** Die alte Fassung — nur zum Vergleich, damit der Befund nachvollziehbar ist. */
const VERSATZ_ALT = `(extract(epoch from (now() at time zone 'Europe/Berlin')
                                       - now()) / 60)::int as versatz`;

async function miss(ausdruck: string, zeitzone: string, zeitpunkt: string): Promise<number> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local time zone '${zeitzone}'`);
    /*
     * `now()` ist in einer Transaktion der Transaktionsbeginn — deshalb wird
     * der Zeitpunkt hier gesetzt, statt auf die Jahreszeit zu warten.
     */
    const [z] = await tx.unsafe(
      `select ${ausdruck.replace(/now\(\)/gu, `timestamptz '${zeitpunkt}'`)}`,
    ) as unknown as readonly { versatz: number }[];
    return z!.versatz;
  }) as Promise<number>;
}

afterAll(async () => { await schliessen(); });

describe('Der Berliner Versatz hängt nicht an der Sitzungszeitzone', () => {
  it('Sommer ergibt 120 — in UTC und in Europe/Berlin', async () => {
    expect(await miss(VERSATZ, 'UTC', '2026-06-15 12:00Z'), 'UTC').toBe(120);
    expect(await miss(VERSATZ, 'Europe/Berlin', '2026-06-15 12:00Z'), 'Berlin').toBe(120);
  });

  it('Winter ergibt 60 — in UTC und in Europe/Berlin', async () => {
    expect(await miss(VERSATZ, 'UTC', '2026-01-15 12:00Z'), 'UTC').toBe(60);
    expect(await miss(VERSATZ, 'Europe/Berlin', '2026-01-15 12:00Z'), 'Berlin').toBe(60);
  });

  it('und die alte Fassung war genau dort falsch — der Befund, belegt', async () => {
    /*
     * Ohne diese Zeile bliebe „der Ausdruck ist jetzt robust" eine Behauptung.
     * Sie zeigt, dass der Unterschied real ist und nicht bloss kosmetisch: in
     * UTC stimmten BEIDE, und genau deshalb fiel es nie auf.
     */
    expect(await miss(VERSATZ_ALT, 'UTC', '2026-06-15 12:00Z')).toBe(120);
    expect(await miss(VERSATZ_ALT, 'Europe/Berlin', '2026-06-15 12:00Z')).toBe(0);
  });

  it('in der Nacht der Umstellung wechselt er mit der Uhr, nicht mit dem Kalender', async () => {
    // 25.10.2026, 00:30 UTC ist noch MESZ (+120); 01:30 UTC ist MEZ (+60).
    expect(await miss(VERSATZ, 'Europe/Berlin', '2026-10-25 00:30Z')).toBe(120);
    expect(await miss(VERSATZ, 'Europe/Berlin', '2026-10-25 01:30Z')).toBe(60);
  });
});
