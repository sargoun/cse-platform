/**
 * **Das Register der Verarbeitungstätigkeiten sagt nur, was stimmt.**
 *
 * Art. 30 DSGVO verlangt ein Verzeichnis, das eine Aufsicht liest. Zwei
 * Fehlerarten wären dabei teuer, und beide sind still:
 *
 *  - **Eine Zeile zeigt ins Leere** — ein Empfänger, den das Register der
 *    Auftragsverarbeiter nicht kennt; eine Dokumentklasse, die es nicht gibt;
 *    eine offene Frage mit einer Nummer, die in `DECISIONS.md` fehlt. Das
 *    Verzeichnis sähe vollständig aus und wäre es nicht.
 *  - **Eine Zeile behauptet eine Rechtsgrundlage.** Die trifft die
 *    Geschäftsführung, nicht diese Software (`CLAUDE.md`: never invent a
 *    business rule). Ein Verzeichnis mit ausgedachten Grundlagen ist
 *    schlimmer als keines: es sieht geprüft aus.
 *
 * Deshalb prüft dieser Fall die Form des Registers und die Ziele seiner
 * Verweise — nicht den Inhalt der Sätze, denn den liest ein Mensch im PR.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  VERARBEITUNGEN, BETROFFENE_LABEL, verarbeitung,
} from '../../src/server/registry/verarbeitungen.js';
import { AUFTRAGSVERARBEITER } from '../../src/server/registry/auftragsverarbeiter.js';
import { QUERSCHNITT, GEWERK_FUER_MODUL } from '../../src/server/registry/modul.js';
import { KATEGORIEN } from '../../src/server/services/dokument/kategorie.js';

const ENTSCHEIDUNGEN = readFileSync(
  fileURLToPath(new URL('../../docs/DECISIONS.md', import.meta.url)), 'utf8');

const SCHLUESSEL = new Set(AUFTRAGSVERARBEITER.map((a) => a.schluessel));
const MODULE = new Set([...QUERSCHNITT, ...Object.keys(GEWERK_FUER_MODUL), 'datenschutz']);

describe('das Register der Verarbeitungstätigkeiten (Art. 30, LEG-09)', () => {
  it('es gibt Tätigkeiten zu prüfen', () => {
    expect(VERARBEITUNGEN.length).toBeGreaterThan(5);
  });

  it('jede Nummer kommt genau einmal vor und hat die Form V-nn', () => {
    const nummern = VERARBEITUNGEN.map((v) => v.nummer);
    expect(new Set(nummern).size, 'zwei Tätigkeiten mit derselben Nummer').toBe(nummern.length);
    expect(nummern.filter((n) => !/^V-\d{2}$/u.test(n))).toEqual([]);
  });

  it('jede Tätigkeit hängt an einem Modul, das es gibt', () => {
    expect(VERARBEITUNGEN.filter((v) => !MODULE.has(v.modul)).map((v) => v.nummer)).toEqual([]);
  });

  it('jeder Empfänger steht im Register der Auftragsverarbeiter', () => {
    const fremd = VERARBEITUNGEN.flatMap(
      (v) => v.empfaenger.filter((e) => !SCHLUESSEL.has(e)).map((e) => `${v.nummer}: ${e}`));
    expect(fremd, 'ein Empfänger, den das AV-Register nicht kennt').toEqual([]);
  });

  it('jede Tätigkeit nennt Betroffene und Datenarten — leer wäre keine Auskunft', () => {
    for (const v of VERARBEITUNGEN) {
      expect(v.betroffene.length, `${v.nummer}: keine Betroffenen`).toBeGreaterThan(0);
      expect(v.daten.length, `${v.nummer}: keine Datenarten`).toBeGreaterThan(0);
      expect(v.zweck.length, `${v.nummer}: kein Zweck`).toBeGreaterThan(20);
    }
  });

  it('jede genannte Betroffenengruppe hat eine Beschriftung', () => {
    const ohne = VERARBEITUNGEN.flatMap(
      (v) => v.betroffene.filter((b) => BETROFFENE_LABEL[b] === undefined));
    expect(ohne).toEqual([]);
  });

  it('eine Frist aus einer Dokumentklasse nennt eine Klasse, die es gibt', () => {
    const klassen = new Set<string>(KATEGORIEN);
    const fremd = VERARBEITUNGEN
      .filter((v) => v.fristQuelle.art === 'dokumentklasse')
      .filter((v) => !klassen.has(
        (v.fristQuelle as { readonly kategorie: string }).kategorie))
      .map((v) => v.nummer);
    expect(fremd, 'eine Dokumentklasse ausserhalb von DOC-01').toEqual([]);
  });

  /**
   * **Eine offene Frage ohne Eintrag ist keine offene Frage, sondern eine
   * Lücke.** Wer `O-514` liest, muss in `DECISIONS.md` finden, was gefragt
   * ist — sonst steht im Verzeichnis eine Nummer, die niemand auflösen kann.
   */
  it('jede offene Frist verweist auf eine Nummer, die DECISIONS.md kennt', () => {
    const fehlend = VERARBEITUNGEN
      .filter((v) => v.fristQuelle.art === 'offen')
      .map((v) => (v.fristQuelle as { readonly frage: string }).frage)
      .filter((f) => !ENTSCHEIDUNGEN.includes(`| ${f} |`));
    expect([...new Set(fehlend)], 'offene Nummer ohne Eintrag in DECISIONS.md').toEqual([]);
  });

  /**
   * **Die Rechtsgrundlage steht NICHT im Register** — und dieser Fall hält
   * das fest, damit sie auch später niemand „der Vollständigkeit halber"
   * einträgt. Art. 6 Abs. 1 ist eine Entscheidung mit Vertrag und
   * Betriebsvereinbarung dahinter; diese Software kennt beides nicht.
   */
  it('das Register kennt kein FELD für eine Rechtsgrundlage', () => {
    const quelle = readFileSync(fileURLToPath(new URL(
      '../../src/server/registry/verarbeitungen.ts', import.meta.url)), 'utf8');
    const ohneKommentare = quelle
      .replace(/\/\*[\s\S]*?\*\//gu, ' ')
      .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
    /*
     * Gesucht wird ein FELD, nicht das Wort. `V-06` nennt „Rechtsgrundlage
     * der Ansprache" als DATENART — das CRM speichert sie wirklich (CRM-08,
     * § 7 UWG), und das zu verschweigen wäre falsch. Verboten ist die andere
     * Richtung: eine Eigenschaft der Tätigkeit selbst, die sagt, worauf die
     * Gesellschaft ihre Verarbeitung stützt.
     */
    expect(ohneKommentare, 'ein Feld `rechtsgrundlage` im Register — das entscheidet die Gesellschaft')
      .not.toMatch(/^\s*(readonly\s+)?rechtsgrundlage\w*\s*[?:]/imu);
    expect(ohneKommentare, 'ein Verweis auf Art. 6 als Angabe der Tätigkeit')
      .not.toMatch(/(readonly\s+)?art6|artikel6/iu);
  });

  it('`verarbeitung()` findet über die Nummer und sagt sonst nichts', () => {
    expect(verarbeitung('V-01')?.modul).toBe('personal');
    expect(verarbeitung('V-99')).toBeUndefined();
  });
});
