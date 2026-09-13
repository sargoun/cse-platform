/**
 * PR 62 — die Freigabekette bezeugt, was auf dem Schirm stand (APR-07, K-13).
 *
 * Die eine Zusage dieser Datei: **jeder der elf Bestandteile aendert den
 * Hash.** Ein Bestandteil, dessen Aenderung den Digest nicht bewegt, ist ein
 * Bestandteil, den jemand unbemerkt austauschen kann — und die Kette
 * bezeugte weiter „intakt".
 */
import { describe, expect, it } from 'vitest';
import {
  ALGORITHMUS, FREIGABE_ARTEN, FreigabeKettenFehler, gliedBytes, gliedHash,
  jcsDigest, pruefeKette, TRENNER,
  type GespeichertesGlied, type KettenGlied,
} from '../../src/server/services/freigabe/kette.js';

const H = (n: number): string => String(n).padStart(64, 'a');

function glied(teil: Partial<KettenGlied> = {}): KettenGlied {
  return {
    nutzlastHash: H(1),
    artefaktHash: H(2),
    diffHash: H(3),
    felderHash: H(4),
    ansichtModellHash: H(5),
    policyErgebnisHash: H(6),
    art: 'genehmigt',
    entschiedenVon: 'b0000000-0000-4000-8000-000000000001',
    entschiedenAm: new Date('2026-09-13T12:00:00.000Z'),
    ketteNr: 1n,
    vorherHash: '',
    ...teil,
  };
}

describe('(1) elf Bestandteile, und jeder zaehlt', () => {
  const grund = gliedHash(glied());

  const varianten: readonly [string, Partial<KettenGlied>][] = [
    ['nutzlast_hash', { nutzlastHash: H(9) }],
    ['artefakt_hash', { artefaktHash: H(9) }],
    ['diff_hash', { diffHash: H(9) }],
    ['felder_hash', { felderHash: H(9) }],
    ['ansicht_modell_hash', { ansichtModellHash: H(9) }],
    ['policy_ergebnis_hash', { policyErgebnisHash: H(9) }],
    ['art', { art: 'abgelehnt' }],
    ['entschieden_von', { entschiedenVon: 'b0000000-0000-4000-8000-000000000002' }],
    ['entschieden_am', { entschiedenAm: new Date('2026-09-13T12:00:00.001Z') }],
    ['kette_nr', { ketteNr: 2n, vorherHash: H(7) }],
    ['vorher_hash', { ketteNr: 2n, vorherHash: H(8) }],
  ];

  for (const [name, aenderung] of varianten) {
    it(`eine Aenderung an ${name} aendert den Hash`, () => {
      expect(gliedHash(glied(aenderung))).not.toBe(grund);
    });
  }

  it('derselbe Eingang ergibt denselben Hash', () => {
    expect(gliedHash(glied())).toBe(grund);
  });
});

describe('(2) die Kanonisierung ist ausgeschrieben, weil SQL sie nachbauen muss', () => {
  it('genau zehn Trennbytes zwischen elf Bestandteilen', () => {
    const bytes = gliedBytes(glied());
    expect([...bytes].filter((b) => b === TRENNER)).toHaveLength(10);
  });

  it('ein fehlender Bestandteil ist die LEERE Zeichenkette, nie das Wort null', () => {
    const text = gliedBytes(glied({ artefaktHash: '' })).toString('utf8');
    expect(text).not.toMatch(/null/u);
    // Zwei Trenner unmittelbar hintereinander: der leere Abschnitt.
    expect(text).toContain(`${String.fromCharCode(TRENNER)}${String.fromCharCode(TRENNER)}`);
  });

  it('entschieden_am steht als RFC 3339 UTC mit Millisekunden', () => {
    expect(gliedBytes(glied()).toString('utf8')).toContain('2026-09-13T12:00:00.000Z');
  });

  it('kette_nr steht als Dezimalziffern', () => {
    expect(gliedBytes(glied({ ketteNr: 42n, vorherHash: H(7) })).toString('utf8'))
      .toContain(`${String.fromCharCode(TRENNER)}42${String.fromCharCode(TRENNER)}`);
  });

  it('der Algorithmus heisst wie der der Rechnungskette', () => {
    expect(ALGORITHMUS).toBe('sha256-jcs-v1');
  });
});

describe('(3) was gar nicht erst entstehen darf', () => {
  it('ein Grossbuchstabe im Digest ist ein Fehler, keine stille Normalisierung', () => {
    expect(() => gliedHash(glied({ diffHash: H(3).toUpperCase() }))).toThrow(FreigabeKettenFehler);
  });

  it('ein zu kurzer Digest wird abgewiesen', () => {
    expect(() => gliedHash(glied({ felderHash: 'abc' }))).toThrow(FreigabeKettenFehler);
  });

  it('eine Genehmigung ohne Entscheider ist ein Bruch von Invariante 7', () => {
    expect(() => gliedHash(glied({ entschiedenVon: '' }))).toThrow(/Invariante 7/u);
  });

  it('NUR `automatisch_nach_frist` darf ohne Entscheider stehen', () => {
    expect(() => gliedHash(glied({
      art: 'automatisch_nach_frist', entschiedenVon: '',
    }))).not.toThrow();
    for (const art of FREIGABE_ARTEN.filter((a) => a !== 'automatisch_nach_frist')) {
      expect(() => gliedHash(glied({ art, entschiedenVon: '' }))).toThrow(FreigabeKettenFehler);
    }
  });

  it('das erste Glied hat keinen Vorgaenger', () => {
    expect(() => gliedHash(glied({ ketteNr: 1n, vorherHash: H(7) }))).toThrow(/kein.*Vorgänger/iu);
  });

  it('jedes weitere Glied hat einen', () => {
    expect(() => gliedHash(glied({ ketteNr: 2n, vorherHash: '' }))).toThrow(/Lücke|Vorgänger/u);
  });

  it('die Kettennummer beginnt bei 1', () => {
    expect(() => gliedHash(glied({ ketteNr: 0n }))).toThrow(FreigabeKettenFehler);
  });
});

describe('(4) der naechtliche Waechter rechnet unabhaengig nach', () => {
  function kette(laenge: number): GespeichertesGlied[] {
    const glieder: GespeichertesGlied[] = [];
    let vorher = '';
    for (let i = 1; i <= laenge; i += 1) {
      const g = glied({ ketteNr: BigInt(i), vorherHash: vorher, nutzlastHash: H(i) });
      const hash = gliedHash(g);
      glieder.push({ ...g, hash });
      vorher = hash;
    }
    return glieder;
  }

  it('eine unversehrte Kette ist intakt', () => {
    expect(pruefeKette(kette(5))).toEqual({ intakt: true, bruchBei: null, grund: null });
  });

  it('eine leere Kette ist intakt — es gibt nichts zu brechen', () => {
    expect(pruefeKette([]).intakt).toBe(true);
  });

  it('ein bearbeitetes Glied faellt auf, und die Nummer steht dabei', () => {
    const glieder = kette(5);
    glieder[2] = { ...glieder[2]!, diffHash: H(9) };
    const befund = pruefeKette(glieder);
    expect(befund.intakt).toBe(false);
    expect(befund.bruchBei).toBe(3n);
    expect(befund.grund).toMatch(/Digest/u);
  });

  it('ein geloeschtes Glied faellt als Luecke auf', () => {
    const glieder = kette(5).filter((g) => g.ketteNr !== 3n);
    const befund = pruefeKette(glieder);
    expect(befund.intakt).toBe(false);
    expect(befund.grund).toMatch(/Lücke/u);
  });

  it('ein umgehaengtes Glied faellt an der Verkettung auf', () => {
    const glieder = kette(5);
    glieder[3] = { ...glieder[3]!, vorherHash: H(1) };
    const befund = pruefeKette(glieder);
    expect(befund.intakt).toBe(false);
    expect(befund.bruchBei).toBe(4n);
    expect(befund.grund).toMatch(/vorher_hash/u);
  });

  it('die Reihenfolge der Eingabe spielt keine Rolle', () => {
    const glieder = kette(5);
    expect(pruefeKette([...glieder].reverse()).intakt).toBe(true);
  });
});

describe('(5) der JCS-Digest ist derselbe wie der der Rechnungskette', () => {
  it('die Schluesselreihenfolge aendert ihn nicht', () => {
    expect(jcsDigest({ a: 1, b: 2 })).toBe(jcsDigest({ b: 2, a: 1 }));
  });

  it('ein anderer Wert aendert ihn', () => {
    expect(jcsDigest({ a: 1 })).not.toBe(jcsDigest({ a: 2 }));
  });

  it('er ist ein kleingeschriebener Hex-64-Digest', () => {
    expect(jcsDigest([])).toMatch(/^[0-9a-f]{64}$/u);
  });
});
