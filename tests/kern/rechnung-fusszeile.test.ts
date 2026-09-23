/**
 * Die Fusszeile der Gesellschaft erreicht die Rechnung — **kopiert, nie
 * verwiesen** (V-099, K-12, `cse.rechnung.v3`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `mandant_identitaet` trägt seit `0200` drei Fusszeilen — Brief, Rechnung,
 * Angebot. Sie waren pflegbar unter Einstellungen › Identität, und der
 * Spaltenname kam im ganzen Baum **nur in der Anzeige derselben
 * Einstellungsseite** vor. Wer dort etwas eintrug, sah es genau dort wieder
 * und nirgends sonst. Die Migration sagt es selbst an der Spalte: „bei der
 * Festschreibung in den kanonischen Payload zu KOPIEREN. Die Kopie ist noch
 * nicht gebaut."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum KOPIEREN und nicht verweisen — das ist der ganze Punkt (K-12).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Eine festgeschriebene Rechnung ist unveränderlich (Invariante 4). Läse das
 * PDF die Fusszeile aus der lebenden `mandant_identitaet`, änderte jede
 * spätere Pflege **rückwirkend jedes alte Dokument** — und der Hash über die
 * Nutzlast bliebe derselbe, weil er über die Nutzlast geht und nicht über die
 * Anzeige. Die Kette sähe heil aus und beschriebe ein anderes Blatt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Und warum v2 gültig bleibt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1 → v2 war ein echter Bruch: v1 trug die Anschrift als EINE Zeile, EN
 * 16931 verlangt sie in vier Feldern, und aus einer Zeile liessen sie sich
 * nur raten. Eine v1-Rechnung braucht Storno und Neuausstellung.
 *
 * v2 → v3 fügt ein Feld HINZU. Eine v2-Zeile hat es nicht, weil sie entstand,
 * bevor die Fusszeile überhaupt ein Dokument erreichte — das ist ihr Zustand,
 * kein Schaden. **Keine bestehende Kette wird entwertet.** Wer v2 einmal wie
 * v1 behandelt, erzwingt Stornos, die niemand braucht; §3 hält das fest.
 */
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION, SCHEMA_VERSION_V1, SCHEMA_VERSION_V2, buildKanonischePayload,
} from '../../src/server/services/finanz/kanonisch.js';
import { leseNutzlast, SnapshotFehler, SnapshotZuAltFehler }
  from '../../src/server/services/finanz/xrechnung/aus-snapshot.js';
import { beispielRechnung } from './hilfen/rechnung-beispiel.js';

const FUSS = 'CSE Dienstleistungen GmbH · Karl-Marx-Allee 31 · 10178 Berlin';

/** Die Nutzlast als BYTES — genau das, was gehasht und gespeichert wird. */
function bytes(fusszeile: string | null): string {
  const r = beispielRechnung();
  return new TextDecoder().decode(buildKanonischePayload({
    ...r, leistender: { ...r.leistender, fusszeile },
  }));
}

/** Dieselbe Nutzlast als lesbares Objekt. */
function nutzlast(fusszeile: string | null): Record<string, unknown> {
  return JSON.parse(bytes(fusszeile)) as Record<string, unknown>;
}

describe('§1 die Fusszeile steht IN der Nutzlast', () => {
  it('v3 trägt sie unter `leistender.fusszeile`', () => {
    const o = nutzlast(FUSS);
    expect(o['schema']).toBe(SCHEMA_VERSION);
    expect((o['leistender'] as Record<string, unknown>)['fusszeile']).toBe(FUSS);
  });

  it('eine Gesellschaft ohne gepflegte Fusszeile trägt `null` — AUSGESCHRIEBEN', () => {
    /*
     * §5.3: Nullwerte werden ausgeschrieben, nie weggelassen. Ein später
     * hinzukommendes Feld ändert damit sichtbar den Hash, statt unsichtbar
     * zu fehlen.
     */
    const leistender = nutzlast(null)['leistender'] as Record<string, unknown>;
    expect('fusszeile' in leistender).toBe(true);
    expect(leistender['fusszeile']).toBeNull();
  });

  it('die Gestalt ist v3 — und v2 ist die Fassung davor', () => {
    expect(SCHEMA_VERSION).toBe('cse.rechnung.v3');
    expect(SCHEMA_VERSION_V2).toBe('cse.rechnung.v2');
    expect(SCHEMA_VERSION_V1).toBe('cse.rechnung.v1');
  });
});

describe('§2 eine geänderte Fusszeile ergibt eine ANDERE Nutzlast', () => {
  it('die Bytes unterscheiden sich — und damit der Hash', () => {
    /*
     * Das ist die Zusicherung, auf der K-12 beruht: der Snapshot beschreibt
     * DAS Blatt, das hinausging. Wäre die Fusszeile ein Verweis, blieben die
     * Bytes gleich, während sich das Dokument änderte — die Kette sähe heil
     * aus und beschriebe ein anderes Blatt.
     */
    expect(new Set([bytes('Fassung A'), bytes('Fassung B'), bytes(null)]).size).toBe(3);
  });
});

describe('§3 der Leser nimmt v2 UND v3 — und v1 weiterhin nicht', () => {
  it('eine v3-Nutzlast liest die Fusszeile', () => {
    expect(leseNutzlast(bytes(FUSS)).leistender.fusszeile).toBe(FUSS);
  });

  it('eine v2-Nutzlast liest sich VOLLSTÄNDIG, mit `fusszeile: null`', () => {
    /*
     * Der teuerste Fehler dieser Änderung wäre, v2 wie v1 zu behandeln: dann
     * wären alle bis heute festgeschriebenen Rechnungen nicht mehr
     * maschinenlesbar zustellbar, und der Weg hiesse Storno und
     * Neuausstellung — für ein Feld, das gar nicht fehlt, sondern damals
     * nicht existierte.
     */
    const o = nutzlast(FUSS);
    o['schema'] = SCHEMA_VERSION_V2;
    delete (o['leistender'] as Record<string, unknown>)['fusszeile'];
    const gelesen = leseNutzlast(JSON.stringify(o));
    expect(gelesen.leistender.fusszeile).toBeNull();
    /* Und alles andere ist unberührt da. */
    expect(gelesen.leistender.name).toBe('CSE Dienstleistungen GmbH');
    expect(gelesen.positionen.length).toBeGreaterThan(0);
  });

  it('v1 bleibt ein Fehler — dort fehlen Strasse, Ort, PLZ und Land einzeln', () => {
    const o = nutzlast(null);
    o['schema'] = SCHEMA_VERSION_V1;
    expect(() => leseNutzlast(JSON.stringify(o))).toThrow(SnapshotZuAltFehler);
  });

  it('eine unbekannte Gestalt ebenso, und die Meldung nennt alle drei', () => {
    const o = nutzlast(null);
    o['schema'] = 'cse.rechnung.v9';
    const fehler = (() => {
      try { leseNutzlast(JSON.stringify(o)); return null; } catch (x) { return x; }
    })();
    expect(fehler).toBeInstanceOf(SnapshotFehler);
    expect((fehler as Error).message).toContain('v1');
    expect((fehler as Error).message).toContain('v2');
    expect((fehler as Error).message).toContain('v3');
  });

  it('ein FEHLENDES Pflichtfeld bleibt ein Schaden — die Toleranz gilt nur v3-Feldern', () => {
    /*
     * Die Gegenprobe zur Zeile darüber. `neuerFeldwert` ist bewusst eine
     * eigene Funktion und kein `?? null` in `feld()`: wäre die Toleranz
     * allgemein, läse sich eine beschädigte Zeile als eine mit Nullwerten.
     */
    const o = nutzlast(FUSS);
    delete (o['leistender'] as Record<string, unknown>)['ustid'];
    expect(() => leseNutzlast(JSON.stringify(o))).toThrow(/ustid fehlt/u);
  });
});
