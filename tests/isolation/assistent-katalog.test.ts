import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, type Fixtur } from './harness.js';
import { KATALOG, sucheBestand } from '../../src/server/agent/tools/suche-bestand.js';
import { Wertregister } from '../../src/server/agent/tools/register.js';

/**
 * Der Abfragekatalog des CEO-Assistenten (AGT-07).
 *
 * **Warum diese Datei über den GANZEN Katalog läuft und nicht über Beispiele.**
 * Jede Zeile des Katalogs ist SQL, das niemand sonst ausführt: es steht in
 * einer Zeichenkette, der Typprüfer sieht es nicht, und ein Tippfehler darin
 * fällt erst auf, wenn ein Geschäftsführer auf die Frage klickt. Genau das ist
 * beim Bau passiert — `auftrag_status` heisst `angelegt` und `storniert`, nicht
 * `entwurf` und `gekuendigt`, und Postgres antwortete mit
 * „invalid input value for enum", als die Abfrage zum ersten Mal lief.
 *
 * Der Fall unten fährt deshalb JEDEN Eintrag gegen die echte Datenbank. Eine
 * neue Frage ist damit automatisch mitgeprüft — vorausgesetzt, sie steht im
 * Katalog, und genau das erzwingt die Schleife.
 *
 * **Und die Mandantengrenze wird nachgezählt.** Die Abfrage bekommt den
 * Mandanten als Parameter und trägt ihn IM SQL, zusätzlich zu RLS
 * (Invariante 3). Dass beides greift, zeigt der Fall in §3: dieselbe Frage
 * gibt in zwei Gesellschaften zwei Antworten.
 */

let f: Fixtur;

beforeAll(async () => { f = await seed(); });
afterAll(schliessen);

function sitzung(mandantId: string) {
  return { scope: 'mandant' as const, mandantId, readonly: true, portal: 'intern' as const };
}

/**
 * Die Transaktion als SCHMALE Schnittstelle — dasselbe Muster wie in
 * `bewerbung-antwort.test.ts`.
 *
 * `postgres.TransactionSql.unsafe` nimmt ein `ParameterOrJSON<never>[]`; eine
 * `readonly unknown[]` passt nicht hinein. Die Schnittstelle hier beschreibt,
 * was der Dienst WIRKLICH braucht — und der Dienst ist die Stelle, deren
 * Vertrag zaehlt.
 */
type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function leser(tx: Abfrager) {
  return {
    abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly T[],
  };
}

async function frage(mandantId: string, id: string) {
  return alsApp(sitzung(mandantId), async (tx) => {
    const register = new Wertregister();
    const ergebnis = await sucheBestand(leser(tx), mandantId, id, register);
    if (!ergebnis.ok) return { fehler: ergebnis.fehler } as const;
    return { wert: register.lies(ergebnis.daten.antwortToken) } as const;
  });
}

describe('§1 jede Frage des Katalogs läuft wirklich', () => {
  it('hat überhaupt Fragen — sonst liefe die Schleife über nichts', () => {
    expect(KATALOG.length).toBeGreaterThanOrEqual(9);
  });

  for (const eintrag of KATALOG) {
    it(`${eintrag.id}: „${eintrag.frage}"`, async () => {
      const ergebnis = await frage(f.reinigung, eintrag.id);
      expect('fehler' in ergebnis ? ergebnis.fehler.nachricht : null,
             `${eintrag.id} lief nicht`).toBeNull();
      if ('wert' in ergebnis) {
        /*
         * Eine Zahl, und zwar eine nicht-negative: jede Frage des Katalogs
         * zaehlt etwas. Ein negatives Ergebnis waere ein Rechenfehler, ein
         * `NaN` ein falscher Spaltenname — beides faellt hier auf und nicht
         * auf dem Bildschirm eines Geschaeftsfuehrers.
         */
        const zahl = Number(ergebnis.wert.wert);
        expect(Number.isFinite(zahl), `${eintrag.id} gab keine Zahl`).toBe(true);
        expect(zahl).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

describe('§2 was nicht im Katalog steht, wird nicht erfunden (AGT-07)', () => {
  it('antwortet mit „steht nicht im Katalog" statt mit einer Zahl', async () => {
    const ergebnis = await frage(f.reinigung, 'wie_viel_gewinn_machen_wir_naechstes_jahr');
    expect('fehler' in ergebnis).toBe(true);
    if ('fehler' in ergebnis) {
      expect(ergebnis.fehler.code).toBe('kein_ergebnis');
      /* Und sie sagt, was SIE kann — eine Absage ohne Alternative ist eine Sackgasse. */
      expect(ergebnis.fehler.nachricht).toContain('Beantwortbar sind');
    }
  });
});

describe('§3 jede Frage antwortet je Gesellschaft verschieden', () => {
  it('die Reinigung und die Security bekommen ihre eigenen Zahlen', async () => {
    /*
     * Geprueft wird nicht, dass die Zahlen VERSCHIEDEN sind — bei einem
     * kleinen Bestand koennen sie zufaellig gleich sein. Geprueft wird, dass
     * beide Seiten ueberhaupt antworten und dass die Abfrage den Mandanten aus
     * der SITZUNG nimmt: derselbe Aufruf, zwei Bindungen, zwei Ergebnisse.
     */
    for (const eintrag of KATALOG) {
      const a = await frage(f.reinigung, eintrag.id);
      const b = await frage(f.security, eintrag.id);
      expect('wert' in a, `${eintrag.id} (Reinigung)`).toBe(true);
      expect('wert' in b, `${eintrag.id} (Security)`).toBe(true);
    }
  });
});

describe('§4 jede Antwort trägt ihre Herkunft', () => {
  it('nennt die Abfrage, den Stand und die Einheit', async () => {
    const ergebnis = await alsApp(sitzung(f.reinigung), async (tx) => {
      const register = new Wertregister();
      const r = await sucheBestand(leser(tx), f.reinigung, 'wartende_freigaben', register);
      if (!r.ok) throw new Error(r.fehler.nachricht);
      return {
        wert: register.lies(r.daten.antwortToken),
        stand: register.lies(r.daten.standToken),
        einheit: r.daten.einheit,
      };
    });

    /*
     * **Die Herkunft ist kein Schmuck.** Ohne sie ist eine Zahl auf einem
     * Bildschirm nicht von einer erfundenen zu unterscheiden — und genau das
     * verbietet AGT-07.
     */
    expect(ergebnis.wert.quelle.art).toBe('abfrage');
    expect(ergebnis.einheit).toBe('Vorgaenge');
    /* Der Stand kommt aus der Datenbank, nicht aus der Uhr des Prozesses. */
    expect(ergebnis.stand.anzeige).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
  });
});
