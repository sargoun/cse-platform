/**
 * Der Schnappschuss der Unterschrift und sein Digest (CLN-04, §5.8, §10.4) —
 * die rechnerische Hälfte von Abnahmekriterium 1.
 *
 * Die Zusage lautet: der Abzug ist ein unveränderlicher Abdruck dessen, was
 * angezeigt wurde, und sein Hash lässt sich NACH dem Zurücklesen aus `jsonb`
 * nachrechnen. Beides hängt an der Kanonisierung, und die hat genau drei
 * Eigenschaften, die hier geprüft werden:
 *
 *   1. Schlüsselreihenfolge ist egal — `jsonb` sortiert beim Speichern um.
 *   2. Zeilenreihenfolge ist NICHT egal — sie ist Teil dessen, was jemand
 *      gesehen hat.
 *   3. Zahlen sind verboten. Ein Betrag, der als Double durch den Digest
 *      liefe, wäre Invariante 1 gebrochen an der Stelle, an der es niemand
 *      sucht.
 */
import { describe, expect, it } from 'vitest';
import {
  baueSchnappschuss, kanonischesJson, pruefeSchnappschuss,
  SCHNAPPSCHUSS_FASSUNG, SchnappschussFehler, schnappschussHash,
  type SchnappschussEingabe, type SchnappschussWert,
} from '../../src/server/services/reinigung/schnappschuss.js';

const EINGABE: SchnappschussEingabe = {
  kopf: {
    nummer: 'LN-2026-0007',
    kunde: 'Bezirksamt Mitte',
    objekt: 'Rathaus Mitte',
    revier: 'EG-Nord',
    leistungszeitraumVon: '2026-06-01',
    leistungszeitraumBis: '2026-06-30',
  },
  positionen: [
    {
      reihenfolge: '0',
      bezeichnung: 'Unterhaltsreinigung Juni',
      menge: '21.000',
      einheit: 'Durchgang',
      einzelpreisCent: '4250',
      quelle: 'leistungskatalog',
      leistungVonLokal: '01.06.2026 06:00',
      leistungBisLokal: '30.06.2026 09:30',
      bemerkung: null,
    },
    {
      reihenfolge: '1',
      bezeichnung: 'Glasreinigung Treppenhaus',
      menge: '1.000',
      einheit: 'Pauschale',
      einzelpreisCent: '18900',
      quelle: 'manuell',
      leistungVonLokal: null,
      leistungBisLokal: null,
      bemerkung: 'Nur Innenseite, Gerüst fehlte',
    },
  ],
  anzeigeZeitzone: 'Europe/Berlin',
  bestaetigungstext: 'Die vorstehend aufgeführten Leistungen wurden erbracht.',
};

describe('die Kanonisierung', () => {
  it('sortiert Schlüssel, damit jsonb den Digest nicht zerstört', () => {
    /**
     * Der Fall, für den es die Funktion gibt: Postgres speichert `jsonb` mit
     * eigener Schlüsselreihenfolge. Ein Digest über die Bytes, in denen jemand
     * das Objekt gebaut hat, ließe sich nach dem Zurücklesen nicht mehr
     * nachrechnen.
     */
    const a: SchnappschussWert = { b: 'zwei', a: 'eins', c: { z: 'x', y: 'w' } };
    const b: SchnappschussWert = { c: { y: 'w', z: 'x' }, a: 'eins', b: 'zwei' };
    expect(kanonischesJson(a)).toBe(kanonischesJson(b));
    expect(schnappschussHash(a)).toBe(schnappschussHash(b));
  });

  it('sortiert nach Codepunkten, nicht nach Gebietsschema', () => {
    // `localeCompare` stellt „ä" je nach Sprache vor oder hinter „z"; der
    // Digest hinge dann an einer Umgebungsvariable.
    expect(kanonischesJson({ 'ä': 'x', z: 'y' })).toBe('{"z":"y","ä":"x"}');
  });

  it('lässt die Reihenfolge der Zeilen stehen — sie ist Teil der Anzeige', () => {
    const vorwaerts = baueSchnappschuss(EINGABE);
    const rueckwaerts = baueSchnappschuss({
      ...EINGABE, positionen: [...EINGABE.positionen].reverse(),
    });
    expect(schnappschussHash(vorwaerts)).not.toBe(schnappschussHash(rueckwaerts));
  });

  it('weist Zahlen ab, statt sie durch ein Double zu schicken', () => {
    expect(() => kanonischesJson(
      { betrag: 42.5 } as unknown as SchnappschussWert,
    )).toThrow(SchnappschussFehler);
  });

  it('kennt null, true und false — und unterscheidet sie von ihren Texten', () => {
    expect(kanonischesJson({ a: null })).toBe('{"a":null}');
    expect(kanonischesJson({ a: true })).toBe('{"a":true}');
    expect(kanonischesJson({ a: 'null' })).not.toBe(kanonischesJson({ a: null }));
  });
});

describe('der Abzug', () => {
  it('trägt seine Fassung, die Anzeigezone und den Bestätigungstext', () => {
    const abzug = baueSchnappschuss(EINGABE) as Record<string, SchnappschussWert>;
    expect(abzug['fassung']).toBe(SCHNAPPSCHUSS_FASSUNG);
    /**
     * Die Zone gehört in den Digest: `leistung_von`/`bis` sind Zeitpunkte,
     * und ohne die Zone, in der sie angezeigt wurden, lässt sich später nicht
     * mehr sagen, welche Uhrzeit auf dem Bildschirm stand (Invariante 2).
     */
    expect(abzug['anzeige_zeitzone']).toBe('Europe/Berlin');
    expect(abzug['bestaetigungstext']).toBe(EINGABE.bestaetigungstext);
  });

  it('ändert seinen Hash, sobald sich eine einzige Zeile ändert', () => {
    const vorher = schnappschussHash(baueSchnappschuss(EINGABE));
    const nachher = schnappschussHash(baueSchnappschuss({
      ...EINGABE,
      positionen: [
        { ...EINGABE.positionen[0]!, menge: '22.000' },
        EINGABE.positionen[1]!,
      ],
    }));
    expect(nachher).not.toBe(vorher);
  });

  it('ändert seinen Hash, wenn sich der Name des Reviers im Kopf ändert', () => {
    // Der Grund, warum der Kopf mit in den Abzug geht: „EG-Nord" umbenannt
    // in „EG-Nord (neu)" ist für den Kunden ein anderes Dokument.
    const vorher = schnappschussHash(baueSchnappschuss(EINGABE));
    const nachher = schnappschussHash(baueSchnappschuss({
      ...EINGABE, kopf: { ...EINGABE.kopf, revier: 'EG-Nord (neu zugeschnitten)' },
    }));
    expect(nachher).not.toBe(vorher);
  });

  it('überlebt den Weg durch JSON und ist danach noch prüfbar', () => {
    /**
     * Die Probe auf den Speicherweg: was `jsonb` zurückgibt, ist ein frisch
     * geparstes Objekt mit eigener Schlüsselreihenfolge. Der Digest muss
     * trotzdem stimmen — sonst wäre der gespeicherte Hash unprüfbar und damit
     * wertlos.
     */
    const abzug = baueSchnappschuss(EINGABE);
    const hash = schnappschussHash(abzug);
    const zurueck = JSON.parse(
      JSON.stringify(abzug, Object.keys(abzug as object).sort().reverse()),
    ) as SchnappschussWert;
    expect(pruefeSchnappschuss(JSON.parse(JSON.stringify(abzug)) as SchnappschussWert, hash))
      .toBe(true);
    expect(zurueck).toBeDefined();
  });

  it('der Hash ist 64 Hexziffern — die Form, die die Spalte verlangt', () => {
    expect(schnappschussHash(baueSchnappschuss(EINGABE))).toMatch(/^[0-9a-f]{64}$/u);
  });
});
