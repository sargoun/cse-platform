/**
 * PR 41, Abnahme 5 — die Zusage, die kein Datenbanktest beweisen kann.
 *
 * `tests/isolation/security-posten.test.ts` zeigt, dass die Eventbesetzung
 * durch beide Tore laeuft. Was es NICHT zeigen kann, ist die Abwesenheit
 * eines zweiten Weges: ein Umgehungsweg, den niemand aufruft, faellt in keinem
 * Verhaltenstest auf — er wartet auf den naechsten Aufrufer.
 *
 * Diese Datei prueft deshalb den QUELLTEXT, und sie tut es ohne Datenbank:
 * die Aussage ist eine ueber das Repository, und sie muss auf einem Rechner
 * ohne Postgres in derselben Sekunde fallen, in der jemand den zweiten Weg
 * schreibt.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function quellen(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  const gehe = (pfad: string): void => {
    for (const eintrag of readdirSync(pfad)) {
      const voll = join(pfad, eintrag);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (/\.tsx?$/u.test(eintrag)) treffer.push(voll);
    }
  };
  gehe(verzeichnis);
  return treffer;
}

/** Blockkommentare und Zeilenkommentare raus — eine Erwaehnung ist kein Pfad. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1'))
    .join('\n');
}

describe('(5) es gibt genau EINEN Schreibweg auf `einsatz_zuordnung`', () => {
  const dateien = [
    ...quellen(join(WURZEL, 'src/server/services')),
    ...quellen(join(WURZEL, 'src/app')),
    ...quellen(join(WURZEL, 'src/server/jobs')),
  ];

  it('es gibt ueberhaupt Quellen zu pruefen', () => {
    // Ohne diese Zusage bestuende die Pruefung ueber einer leeren Menge — und
    // ein falsch zusammengesetzter Pfad meldete „alles sauber", ohne eine
    // einzige Datei gelesen zu haben.
    expect(dateien.length).toBeGreaterThan(50);
  });

  it('nur `dienstplan/einteilung.ts` fuegt in `einsatz_zuordnung` ein', () => {
    const schreiber = dateien.filter((d) =>
      /insert\s+into\s+einsatz_zuordnung/iu.test(ohneKommentare(readFileSync(d, 'utf8'))));
    /**
     * **Das ist die Abnahme.** § 34a GewO knuepft an den EINSATZ eines
     * Menschen an, nicht an das Planungsartefakt, ueber das er gebucht wurde
     * (`03-GEWERKE.md` §9.1). Ein zweiter INSERT — „fuer Events", „fuer den
     * Import", „nur fuer den Springer" — umginge das Tor und den
     * Arbeitszeitbefund, und zwar lautlos: die Zeile entstuende, der Beweis
     * fehlte, und der Ausloeser meldete erst beim naechsten Lauf, dass die
     * Pruefung nie stattgefunden hat.
     */
    expect(schreiber.map((d) => relative(WURZEL, d)))
      .toEqual(['src/server/services/dienstplan/einteilung.ts']);
  });

  it('die Eventbesetzung ruft genau diesen Dienst auf', () => {
    const quelle = readFileSync(
      join(WURZEL, 'src/server/services/security/eventbesetzung.ts'), 'utf8');
    expect(quelle).toMatch(/from '\.\.\/dienstplan\/einteilung\.js'/u);
    expect(ohneKommentare(quelle)).toMatch(/\bbesetzeEinsatz\s*\(/u);
  });

  it('und der Sicherheitsdienst schreibt selbst keine Zuordnung', () => {
    for (const datei of quellen(join(WURZEL, 'src/server/services/security'))) {
      const inhalt = ohneKommentare(readFileSync(datei, 'utf8'));
      expect(inhalt, relative(WURZEL, datei)).not.toMatch(/insert\s+into\s+einsatz_zuordnung/iu);
      // Auch nicht ueber den Umweg eines UPDATE, das eine abgesagte Zuordnung
      // wiederbelebt — das waere dieselbe Umgehung in der anderen Richtung.
      expect(inhalt, relative(WURZEL, datei)).not.toMatch(/update\s+einsatz_zuordnung/iu);
    }
  });

  it('die Sicherheitsrouten stehen im Manifest, jede mit Recht', () => {
    /**
     * Die Liste ist die Zusage, nicht ihre Laenge: jede Adresse unter
     * `api/sicherheit/` steht hier namentlich, und eine neue faellt auf,
     * bevor jemand sie benutzt. PR 42 hat vier gebracht — die versionierte
     * Dienstanweisung und die Schluesselverwaltung —, und keine davon
     * schreibt eine `einsatz_zuordnung`.
     */
    const sicherheit = ROUTEN.filter((r) => r.pfad.startsWith('api/sicherheit/'));
    expect(sicherheit.map((r) => r.pfad).sort()).toEqual([
      'api/sicherheit/dienstanweisungen',
      'api/sicherheit/dienstanweisungen/[id]/version',
      'api/sicherheit/event-besetzung',
      'api/sicherheit/posten',
      'api/sicherheit/schluessel',
      'api/sicherheit/schluessel/[id]/quittung',
      'api/sicherheit/wachbuch',
    ]);
    // Keine davon ist offen: jede schreibt.
    expect(sicherheit.filter((r) => r.recht === null)).toEqual([]);
    /**
     * Und die Eventbesetzung traegt DASSELBE Recht wie `besetzen` — nicht ein
     * eigenes. Zwei Rechte fuer eine Tuer heissen: wer die Tuer enger macht,
     * zieht das zweite nicht mit.
     */
    expect(ROUTEN.find((r) => r.pfad === 'api/sicherheit/event-besetzung')?.recht)
      .toBe(ROUTEN.find((r) => r.pfad === 'api/einsaetze/[id]/besetzen')?.recht);
  });
});

describe('(4) die Serverzeit steht in keinem Schreibpfad des Wachbuchs', () => {
  it('der Dienst schickt `erfasst_am` nicht einmal mit', () => {
    /**
     * Die Datenbank ueberschreibt den Wert ohnehin (0070). Dass der Dienst ihn
     * gar nicht erst sendet, ist die zweite Haelfte derselben Zusage: ein Feld,
     * das im INSERT steht, wandert frueher oder spaeter in ein Formular — und
     * dann steht in der Oberflaeche eine Zeitangabe, die nichts bedeutet.
     */
    const inhalt = ohneKommentare(readFileSync(
      join(WURZEL, 'src/server/services/security/wachbuch.ts'), 'utf8'));
    const insert = /insert into wachbuch_eintrag[\s\S]*?returning id/iu.exec(inhalt)?.[0] ?? '';
    expect(insert.length).toBeGreaterThan(100);
    expect(insert).not.toMatch(/\berfasst_am\b/u);
    expect(insert).not.toMatch(/\blaufnummer\b/u);
    expect(insert).not.toMatch(/\bjahr\b/u);
    expect(insert).not.toMatch(/\bhash\b/u);
    // Die Geraetezeit dagegen SCHON: sie ist die Tatsache, die TIM-08 verlangt.
    expect(insert).toMatch(/\bgeraete_zeit\b/u);
  });
});
