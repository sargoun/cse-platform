/**
 * Wer den ECHTEN Seed faehrt, braucht eine EIGENE Datenbank.
 *
 * **Warum diese Wache existiert.** Fuenf Isolationsdateien starten
 * `src/server/db/seed/index.ts` als Unterprozess. Solange
 * `scripts/test-db.sh up` bedingungslos `drop database` machte, bekam jede
 * davon einen frischen Stand. Das wurde abgeschafft — zu Recht: jeder
 * Neuaufbau riss der laufenden Suite die Datenbank unter den Fuessen weg.
 * Seither laufen sie auf dem Stand, den die vorherige Datei hinterlassen hat,
 * und der Seed bricht an `benutzer_person_key` ab, sobald die Harness-Fixtur
 * denselben Menschen schon angelegt und ihm einen Zugang gegeben hat (EMP-14
 * laesst genau einen zu).
 *
 * **Und das Suchen von Hand hat genau das geliefert, was Suchen von Hand
 * liefert: drei von fuenf.** `seed`, `oeffentlich` und `lead` fielen auf,
 * weil sie in dem Lauf zufaellig an der richtigen Stelle standen;
 * `kennzahlen` und `rollen` erst eine Runde spaeter, und auch nur, weil die
 * Reihenfolge sich wieder verschoben hatte. Vitest ordnet nach Dateigroesse
 * — schon eine neue Testdatei verschiebt das Ergebnis, und der naechste
 * Fehlschlag sieht aus wie ein kaputter Seed.
 *
 * Diese Wache zaehlt nicht auf Augen: wer den Seed startet, muss
 * `eigeneDatenbank(...)` benutzen. Sie faellt bei dem, der die Datei
 * schreibt.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ISO = resolve(import.meta.dirname, '../isolation');

describe('wer den echten Seed faehrt, hat eine eigene Datenbank', () => {
  const dateien = readdirSync(ISO).filter((d) => d.endsWith('.test.ts'));

  it('findet ueberhaupt Dateien — sonst prueft der Rest nichts', () => {
    expect(dateien.length).toBeGreaterThan(30);
  });

  it('keine Isolationsdatei startet den Seed auf der gemeinsamen Datenbank', () => {
    const suender = dateien.filter((datei) => {
      const inhalt = readFileSync(join(ISO, datei), 'utf8');
      const faehrtSeed = inhalt.includes('src/server/db/seed/index.ts');
      return faehrtSeed && !inhalt.includes('eigeneDatenbank(');
    });

    expect(
      suender,
      'Diese Dateien starten den echten Seed, ohne sich eine eigene Datenbank zu '
      + 'holen. Sie laufen damit auf dem Stand der jeweils vorherigen Datei, und ob '
      + 'sie rot oder gruen sind, entscheidet die Reihenfolge. `eigeneDatenbank(...)` '
      + 'aus `tests/isolation/eigene-datenbank.ts` loest das.',
    ).toEqual([]);
  });

  /**
   * **Die Gegenprobe zaehlt BEIDE Schreibweisen** — und der erste Entwurf tat
   * das nicht.
   *
   * Er suchte nur den woertlichen Pfad `src/server/db/seed/index.ts`. Nach der
   * Reparatur steht der aber genau einmal im Baum, naemlich im Helfer: die
   * fuenf Dateien rufen `baueAuf()`. Die Gegenprobe fiel damit auf 1 und
   * meldete sich — richtig, denn eine Wache, deren Gegenprobe nichts mehr
   * findet, misst am Ende auch nichts.
   */
  it('und die Gegenprobe: es gibt ueberhaupt Dateien, die den Seed fahren', () => {
    const faehrtSeed = dateien.filter((datei) => {
      const inhalt = readFileSync(join(ISO, datei), 'utf8');
      return inhalt.includes('src/server/db/seed/index.ts') || inhalt.includes('baueAuf(');
    });
    // Fuenf sind es heute: seed, oeffentlich, lead, kennzahlen, rollen.
    expect(faehrtSeed.length).toBeGreaterThanOrEqual(5);
  });
});
