/**
 * `create or replace function` darf keine spätere Schicht verschlucken — und
 * die Altlastliste darf nur schrumpfen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Ausfall, den diese Datei festnagelt. Er ist wirklich passiert.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.angebot_versand_pruefen` entstand in `0024` mit der Prüfung auf offene
 * Kalkulationswerte. `0295` ERSETZTE sie und legte Invariante 7 hinein: ohne
 * benannten Menschen verlässt nichts das Haus. `0392` (V-130) brauchte zwei
 * weitere Prüfungen darin, ging von der 0024-Fassung aus — und löschte damit
 * die Preisfreigabe.
 *
 * Danach fiel ein Versand ohne Freigabe nur noch am CHECK
 * `angebot_freigabe_vor_versand` auf, mit „violates check constraint" statt
 * dem Satz über den fehlenden Arbeitsschritt. Und ein Versand aus
 * `status = 'in_pruefung'` wäre am CHECK ganz vorbeigelaufen, weil dessen
 * erster Zweig genau diesen Status erlaubt — `0295` sagt das an der Stelle
 * selbst, im Kommentar, den der Ersetzende nicht mehr gelesen hat.
 *
 * **Nichts hat es gemeldet:** die Migration lief durch, `tsc` war still, der
 * Linter auch. Gefunden hat es eine Isolationsprüfung, zwei Gates später.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum eine Liste und kein „ab jetzt sauber".**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Neunzehn Stellen im Baum ersetzen eine Funktion, ohne die frühere Migration
 * zu nennen. Sie alle sofort rot zu machen hiesse, die Wache am ersten Tag
 * neunzehnmal zu brechen — und eine Sperrklinke mit Fehlalarmen wird nach dem
 * dritten Mal abgeschaltet. Also: Liste, und sie darf nur schrumpfen.
 *
 * **Die Liste sagt NICHT, dass dort etwas fehlt** — sie sagt, dass es niemand
 * geprüft hat. Wer eine dieser Funktionen das nächste Mal anfasst, liest die
 * ältere Fassung, nennt ihre Nummer und streicht die Zeile.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUNKTION_ALTLAST } from '../../scripts/guards/funktion-altlast.js';

/** Die Obergrenze am Tag der Einführung. Sie darf sinken, nie steigen. */
const STAND = 19;

/** Funktionsname → Migrationsnummern, in Reihenfolge. Dieselbe Regel wie die Wache. */
function jeFunktion(): { treffer: ReadonlyMap<string, readonly string[]>;
                          inhalt: ReadonlyMap<string, string> } {
  const treffer = new Map<string, string[]>();
  const inhalt = new Map<string, string>();
  for (const name of readdirSync('drizzle').filter((d) => d.endsWith('.sql')).sort()) {
    const nummer = /^(\d{4})_/u.exec(name)?.[1];
    if (nummer === undefined) continue;
    const text = readFileSync(`drizzle/${name}`, 'utf8');
    inhalt.set(nummer, text);
    const muster = /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/giu;
    const gesehen = new Set<string>();
    for (const t of text.matchAll(muster)) {
      const fn = t[1]!.toLowerCase();
      if (gesehen.has(fn)) continue;
      gesehen.add(fn);
      treffer.set(fn, [...(treffer.get(fn) ?? []), nummer]);
    }
  }
  return { treffer, inhalt };
}

/** Die heute offenen Fälle — `<neueste Migration>:<Funktion>`. */
function offeneFaelle(): readonly string[] {
  const { treffer, inhalt } = jeFunktion();
  const raus: string[] = [];
  for (const [fn, nummern] of treffer) {
    if (nummern.length < 2) continue;
    const neueste = nummern[nummern.length - 1]!;
    const text = inhalt.get(neueste) ?? '';
    if (nummern.slice(0, -1).every((n) => text.includes(n))) continue;
    raus.push(`${neueste}:${fn}`);
  }
  return raus;
}

describe('die Altlastliste darf nur schrumpfen', () => {
  it('sie wächst nicht', () => {
    expect(FUNKTION_ALTLAST.size).toBeLessThanOrEqual(STAND);
  });

  it('jeder offene Fall steht entweder in der Liste — oder ist ein Fehler', () => {
    const nichtEntschuldigt = offeneFaelle().filter((f) => !FUNKTION_ALTLAST.has(f));
    expect(nichtEntschuldigt,
      'Eine Migration ersetzt eine Funktion, die eine ÄLTERE Migration schon '
      + 'definiert hat, und nennt deren Nummer nicht. `create or replace` ersetzt '
      + 'die Funktion GANZ — was dort dazukam, ist danach weg, ohne dass jemand '
      + 'etwas sagt. Die ältere Fassung lesen und ihre Nummer im Kommentar nennen')
      .toEqual([]);
  });

  it('kein Eintrag ist überflüssig geworden', () => {
    /*
     * Die Gegenrichtung: eine Zeile, die niemand mehr braucht, bleibt sonst
     * für immer stehen und entschuldigt beim nächsten Mal etwas, das gar
     * nicht gemeint war.
     */
    const offen = new Set(offeneFaelle());
    const ueberfluessig = [...FUNKTION_ALTLAST].filter((f) => !offen.has(f));
    expect(ueberfluessig, 'steht in der Liste, ist aber längst in Ordnung — streichen')
      .toEqual([]);
  });
});

describe('der Fall, der die Wache ausgelöst hat, bleibt geschlossen', () => {
  it('`0392` nennt `0024` UND `0295`', () => {
    const text = readFileSync(
      'drizzle/0392_angebotsentwurf_laesst_sich_berichtigen.sql', 'utf8');
    expect(text).toContain('0024');
    expect(text).toContain('0295');
  });

  it('und trägt die Preisfreigabe wieder — Invariante 7', () => {
    const text = readFileSync(
      'drizzle/0392_angebotsentwurf_laesst_sich_berichtigen.sql', 'utf8');
    expect(text).toContain('Ohne Preisfreigabe kein Versand');
  });
});
