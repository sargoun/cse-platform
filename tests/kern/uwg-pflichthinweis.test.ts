import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mitPflichthinweis, neuerToken, tokenPfad,
} from '../../src/server/services/datenschutz/werbewiderspruch.js';

/**
 * **Der Pflichthinweis des § 7 Abs. 3 Nr. 4 UWG** (V-092, V-115, CRM-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `gibTokenAus` war gebaut, geprüft und hatte im ganzen Baum **keinen
 * Aufrufer**. Der Widerspruchsweg stand vollständig — die öffentliche Seite,
 * die Einlösung, die Drossel, das Protokoll —, und der Schlüssel dazu entstand
 * nirgends. Solange kein Versender verbunden ist (O-36), fällt das nicht auf;
 * in der Sekunde, in der einer verbunden wird, ginge eine Werbemail ohne den
 * gesetzlich vorgeschriebenen Hinweis hinaus. Das ist keine fehlende
 * Bequemlichkeit, sondern eine Abmahnung.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum hier und nicht am Versandweg geprüft wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `sendeNachAussen` wirft, bevor es schreibt, solange kein Versender verbunden
 * ist — der Rumpf danach ist heute nicht erreichbar. Geprüft werden deshalb
 * die BAUSTEINE (der Satz, der Link, der Token) und die VERDRAHTUNG im
 * Quelltext: dass der eine Weg nach draussen sie benutzt, und in welcher
 * Reihenfolge.
 */

const URSPRUNG = process.env['CSE_KANONISCHE_BASIS'];

afterEach(() => {
  if (URSPRUNG === undefined) delete process.env['CSE_KANONISCHE_BASIS'];
  else process.env['CSE_KANONISCHE_BASIS'] = URSPRUNG;
});

describe('§1 der Satz trägt, was das Gesetz verlangt', () => {
  it('nennt das jederzeitige Widerspruchsrecht UND die Kostengrenze', () => {
    process.env['CSE_KANONISCHE_BASIS'] = 'https://cse-gruppe.example';
    const text = mitPflichthinweis('Guten Tag, unser neues Angebot …', 'abc123');
    /*
     * Beide Bestandteile stehen wörtlich im Absatz: „jederzeit widersprechen"
     * und „ohne dass hierfür andere als die Übermittlungskosten nach den
     * Basistarifen entstehen". Einer allein genügt nicht.
     */
    expect(text).toContain('jederzeit');
    expect(text).toContain('widersprechen');
    expect(text).toContain('Basistarifen');
    expect(text).toContain('§ 7 Abs. 3 Nr. 4 UWG');
  });

  it('lässt den ursprünglichen Text unangetastet und hängt an', () => {
    process.env['CSE_KANONISCHE_BASIS'] = 'https://cse-gruppe.example';
    const text = mitPflichthinweis('Guten Tag, unser neues Angebot …', 'abc123');
    expect(text.startsWith('Guten Tag, unser neues Angebot …')).toBe(true);
  });

  it('trägt eine ABSOLUTE Adresse — eine relative wäre in einer E-Mail kein Link', () => {
    process.env['CSE_KANONISCHE_BASIS'] = 'https://cse-gruppe.example';
    const text = mitPflichthinweis('Werbung', 'abc123');
    expect(text).toContain(`https://cse-gruppe.example${tokenPfad('abc123')}`);
  });

  it('und wirft OHNE kanonische Basis, statt eine Zeichenkette zu verschicken', () => {
    /*
     * `/werbewiderspruch/…` in einer E-Mail ist kein Link, sondern Text. Eine
     * Werbemail mit einem unklickbaren Hinweis erfüllt den Absatz nicht — sie
     * darf dann nicht hinausgehen, und genau das erzwingt der Wurf.
     */
    delete process.env['CSE_KANONISCHE_BASIS'];
    expect(() => mitPflichthinweis('Werbung', 'abc123')).toThrow();
  });

  it('kodiert den Token im Pfad', () => {
    expect(tokenPfad('a/b c')).toBe('/werbewiderspruch/a%2Fb%20c');
  });
});

describe('§2 der Token', () => {
  it('ist jedes Mal ein anderer, und gespeichert wird nur sein Hash (K-08)', () => {
    const a = neuerToken();
    const b = neuerToken();
    expect(a.klartext).not.toBe(b.klartext);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(a.hash).not.toBe(a.klartext);
  });
});

describe('§3 der eine Weg nach draussen benutzt ihn', () => {
  /*
   * **Nur der Rumpf von `sendeNachAussen`**, nicht die ganze Datei: sie
   * enthält weitere `insert into nachricht` (der interne Faden), und ein
   * `indexOf` über alles fände den falschen und wäre grün oder rot aus dem
   * falschen Grund.
   */
  const DATEI = readFileSync('src/server/services/kern/nachricht.ts', 'utf8');
  const QUELLE = DATEI.slice(DATEI.indexOf('export async function sendeNachAussen'));

  it('hängt den Hinweis an, wenn der Zweck `werbung` ist', () => {
    expect(QUELLE).toContain("eingabe.zweck === 'werbung'");
    expect(QUELLE).toContain('mitPflichthinweis(');
    expect(QUELLE).toContain('vermerkeToken(');
  });

  it('prüft den Versender ZUERST — sonst würde ein Token für nichts verbrannt', () => {
    /*
     * Ein ausgegebener und nie zugestellter Widerspruchslink wäre ein
     * Schlüssel, den niemand hat und der trotzdem gilt.
     */
    const wand = QUELLE.indexOf('VersandNichtVerbundenFehler(eingabe.kanal');
    const token = QUELLE.indexOf('neuerToken()');
    expect(wand).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(-1);
    expect(wand).toBeLessThan(token);
  });

  it('schreibt die Nachricht VOR dem Vermerk — der Fremdschlüssel verlangt es', () => {
    /*
     * `werbewiderspruch_token.nachricht_id` zeigt auf `nachricht`. Der Vermerk
     * kann die Nachricht also erst nennen, wenn es sie gibt — und der Klartext
     * muss trotzdem vorher entstehen, weil er in den TEXT gehört. Eine
     * ausgehende Nachricht wird nicht nachträglich umgeschrieben.
     */
    const einfuegen = QUELLE.indexOf('insert into nachricht');
    const vermerk = QUELLE.indexOf('vermerkeToken(');
    const klartext = QUELLE.indexOf('mitPflichthinweis(');
    expect(klartext).toBeLessThan(einfuegen);
    expect(einfuegen).toBeLessThan(vermerk);
  });

  it('bindet den Widerspruch an den MENSCHEN, nicht an die Firma', () => {
    /*
     * `kunde_id` ausdrücklich leer: einen Klick auf die ganze Firma
     * auszudehnen schaltete Kolleginnen stumm, die nie widersprochen haben.
     * Die Spalte steht bereit (§2.4); sie zu setzen ist eine Zeile, sobald es
     * jemand entscheidet.
     */
    const vermerk = QUELLE.indexOf('vermerkeToken(');
    expect(QUELLE.slice(vermerk, vermerk + 500)).toContain('kundeId: null');
  });
});
