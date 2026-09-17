/**
 * Die Vorlagen der Behinderungsanzeige — die Platzhalterpruefung
 * (BAU-06, § 6 VOB/B).
 *
 * **Die Liste der erlaubten Platzhalter darf nicht von `Vorlagenwerte`
 * abweichen.** `setzeVorlage` ersetzt genau die Felder dieser Schnittstelle
 * und weist jeden anderen Platzhalter AB (`platzhalter_unbekannt`). Stand in
 * der Oberflaeche ein Platzhalter, den der Dienst nicht kennt, waere die
 * Vorlage speicherbar und nicht versendbar — und der Fehler faellt dann in
 * dem Augenblick auf, in dem eine anspruchswahrende Erklaerung hinausgehen
 * soll.
 *
 * Eine Schnittstelle ist zur Laufzeit nicht aufzaehlbar, also wird die QUELLE
 * gelesen. Das ist bewusst unelegant: der Test soll rot werden, wenn jemand
 * `Vorlagenwerte` erweitert und die Liste vergisst.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ERLAUBTE_PLATZHALTER, VorlagenFehler, platzhalterIn,
} from '../../src/server/services/einstellung/vorlagen.js';
import { setzeVorlage, type Vorlagenwerte }
  from '../../src/server/services/bau/behinderung.js';

const WERTE: Vorlagenwerte = {
  projekt: 'Objekt Kurfürstendamm',
  ursache: 'fehlende Freigabe des Baugrunds',
  grund: 'Risikobereich des Auftraggebers',
  beginn: '17.09.2026',
  auswirkung: 'Verzug von acht Werktagen',
  absender: 'REALTIME Service GmbH',
};

describe('ERLAUBTE_PLATZHALTER', () => {
  it('nennt genau die Felder von Vorlagenwerte', async () => {
    const quelle = await readFile(
      new URL('../../src/server/services/bau/behinderung.ts', import.meta.url), 'utf8');
    const rumpf = /export interface Vorlagenwerte \{([\s\S]*?)\n\}/u.exec(quelle)?.[1];
    expect(rumpf, 'Vorlagenwerte gefunden').toBeDefined();
    const felder = [...(rumpf ?? '').matchAll(/^\s*readonly ([a-z_]+):/gmu)]
      .map((m) => m[1] ?? '');
    expect(felder.length).toBeGreaterThan(0);
    expect([...felder].sort()).toEqual([...ERLAUBTE_PLATZHALTER].sort());
  });

  it('und genau die Schluessel des Beispielsatzes', () => {
    expect(Object.keys(WERTE).sort()).toEqual([...ERLAUBTE_PLATZHALTER].sort());
  });

  it('jeder erlaubte Platzhalter wird von setzeVorlage wirklich ersetzt', () => {
    for (const p of ERLAUBTE_PLATZHALTER) {
      const text = setzeVorlage(`X {${p}} Y`, WERTE);
      expect(text, p).not.toContain('{');
      expect(text, p).toContain(
        String((WERTE as unknown as Record<string, string>)[p]));
    }
  });

  it('ein unbekannter Platzhalter wird von setzeVorlage abgewiesen', () => {
    /*
     * Die naheliegende Fassung — stehen lassen oder leeren — hat zwei
     * Ausfaelle, und beide gehen an den Auftraggeber hinaus: eine offene
     * geschweifte Klammer im Schreiben, oder eine fehlende Angabe, die
     * § 6 Abs. 1 VOB/B ausdruecklich verlangt.
     */
    expect(() => setzeVorlage('X {bauleiter} Y', WERTE)).toThrow();
  });
});

describe('platzhalterIn', () => {
  it('findet jeden Platzhalter, auch den unbekannten', () => {
    expect([...platzhalterIn('{projekt} und {bauleiter}')].sort())
      .toEqual(['bauleiter', 'projekt']);
  });

  it('nennt jeden nur einmal', () => {
    expect([...platzhalterIn('{projekt} {projekt}')]).toEqual(['projekt']);
  });

  it('findet nichts, wo nichts ist', () => {
    expect([...platzhalterIn('Sehr geehrte Damen und Herren,')]).toEqual([]);
  });
});

describe('VorlagenFehler', () => {
  it('traegt einen Grund, den der Aufrufer unterscheiden kann', () => {
    const f = new VorlagenFehler('ungueltig', 'Probe');
    expect(f.grund).toBe('ungueltig');
    expect(f.name).toBe('VorlagenFehler');
  });
});
