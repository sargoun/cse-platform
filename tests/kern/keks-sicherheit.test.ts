import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anmeldeKeksOptionen } from '../../src/app/auth/mitarbeiter/anmeldung.js';
import { ohneKommentare } from './hilfen/quelltext.js';
import {
  ALT_SITZUNG_COOKIE, keksSicher, sitzungsKeksName, sitzungsKeksOptionen,
} from '../../src/server/auth/sitzung.js';

/**
 * Die Keks-Sicherheit — **eine Entscheidung, zwei Kekse, und der Bau darf sie
 * nicht einbetonieren.**
 *
 * **Der Befund, der diese Datei nötig machte.** Ein Nutzer konnte sich am
 * Telefon nicht anmelden: Nummer eintippen, Code bekommen, Code eintippen —
 * und zurück auf der Nummernseite, ohne ein Wort. Die Ursache war eine
 * Schreibweise, nicht eine Bedingung. `anmeldeKeksOptionen` schrieb
 *
 *     secure: process.env.NODE_ENV === 'production'
 *
 * und Webpacks DefinePlugin ersetzt `process.env.X` als LITERAL beim Bau durch
 * sein Ergebnis. Im gebauten Bündel stand `secure:!0` — `true`, einbetoniert.
 * Über `http://192.168.0.193` verwirft jeder Browser einen solchen Keks
 * (RFC 6265bis §5.5), also kam der zweite Schritt keksfrei an.
 *
 * Der Sitzungskeks daneben las über einen PARAMETER (`umgebung.NODE_ENV`) und
 * blieb deshalb zur Laufzeit fragbar. Drei Zeichen Unterschied, und nur eine
 * der beiden Fabriken war reparierbar.
 */
const WURZEL = resolve(import.meta.dirname, '../..');

const ECHT = { NODE_ENV: 'production' } as const;
const VORFUEHRUNG = { NODE_ENV: 'production', CSE_DEV_FLAECHEN: '1' } as const;

describe('Keks-Sicherheit', () => {
  it('im Echtbetrieb: `Secure` und der `__Host-`-Name', () => {
    expect(keksSicher(ECHT)).toBe(true);
    expect(sitzungsKeksOptionen(ECHT).secure).toBe(true);
    expect(anmeldeKeksOptionen(ECHT).secure).toBe(true);
    expect(sitzungsKeksName(ECHT)).toBe('__Host-cse_sitzung');
  });

  it('auf der Vorführfläche: ohne `Secure` — sonst kommt das Telefon nicht rein', () => {
    /*
     * `CSE_DEV_FLAECHEN=1` ist die Flagge, mit der `docs/LOKAL-STARTEN.md`
     * jeden die Demo starten lässt — und das Telefon erreicht den Rechner
     * dann über `http://192.168…`. Ein `Secure`-Keks kommt dort nicht an.
     */
    expect(keksSicher(VORFUEHRUNG)).toBe(false);
    expect(sitzungsKeksOptionen(VORFUEHRUNG).secure).toBe(false);
    expect(anmeldeKeksOptionen(VORFUEHRUNG).secure).toBe(false);
  });

  it('und dann heisst der Sitzungskeks NICHT `__Host-`', () => {
    /*
     * Der Präfix ist kein Name, sondern eine Bedingung: ein `__Host-`-Keks
     * OHNE `Secure` wird verworfen. Name und Flagge müssen deshalb aus
     * derselben Antwort kommen — zwei getrennte Entscheidungen wären zwei
     * Gelegenheiten, sie auseinanderlaufen zu lassen.
     */
    expect(sitzungsKeksName(VORFUEHRUNG)).toBe(ALT_SITZUNG_COOKIE);
  });

  it('beide Kekse antworten IMMER gleich — nie der eine sicher, der andere nicht', () => {
    for (const umgebung of [ECHT, VORFUEHRUNG, {}, { NODE_ENV: 'development' }]) {
      expect(anmeldeKeksOptionen(umgebung).secure, JSON.stringify(umgebung))
        .toBe(sitzungsKeksOptionen(umgebung).secure);
    }
  });

  /**
   * **Die Prüfung, die den Fehler wirklich gefunden hätte.**
   *
   * Alle Prüfungen darüber wären auch VOR der Behebung grün gewesen: sie
   * rufen die Funktion im Test auf, und dort ersetzt niemand `process.env`.
   * Der Fehler entstand erst beim BAUEN. Diese Prüfung liest deshalb den
   * Quelltext und verbietet die Schreibweise, die sich einbetonieren lässt.
   */
  it('keine Keksfabrik liest `process.env` als LITERAL — das betoniert der Bau ein', () => {
    const dateien = [
      'src/server/auth/sitzung.ts',
      'src/app/auth/mitarbeiter/anmeldung.ts',
    ];
    for (const datei of dateien) {
      /*
       * **Kommentare fallen weg, bevor gesucht wird.** Sonst schlägt genau
       * der Text an, der ERKLÄRT, warum man `process.env.X` hier nicht
       * schreiben darf — und der steht in beiden Dateien.
       */
      const quelle = ohneKommentare(readFileSync(resolve(WURZEL, datei), 'utf8'));
      /*
       * Erlaubt ist `= process.env` als VORGABE eines Parameters: der Zugriff
       * auf das Feld geschieht dann über die Variable, und die ersetzt
       * DefinePlugin nicht. Verboten ist `process.env.IRGENDWAS` mitten im
       * Ausdruck.
       */
      const ohneVorgaben = quelle.replace(/=\s*process\.env\b/gu, '= UMGEBUNG');
      const treffer = [...ohneVorgaben.matchAll(/process\.env\.[A-Z_]+/gu)].map((m) => m[0]);
      expect(treffer, `${datei}: als Parameter hereinreichen, nicht direkt lesen`)
        .toEqual([]);
    }
  });
});
