/**
 * PR 5 acceptance (4) und (7) — die Kette und ihr Golden Vector.
 *
 * Der Punkt dieser Datei ist nicht "die Kette funktioniert". Es ist, dass
 * **diese** Kette funktioniert: mit dem `0x1E`-Trenner und gegen 32 Nullbytes.
 * Beide Entscheidungen sind unsichtbar, solange nur eine Implementierung
 * existiert — und die zweite läuft in SQL.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALGORITHMUS,
  berechneHash,
  GENESIS,
  hashChain,
  KettenFehler,
  kettenKopf,
  nutzlastHash,
  TRENNER,
  verifyChain,
  type Bruch,
  type KettenSatz,
} from '../../src/server/services/finanz/hash-chain.js';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Drei Sätze, wie sie ein Kreis speichert. */
const NUTZLASTEN = [
  '{"nummer":"RE-2026-00001","zahlbetrag_cent":119000}',
  '{"nummer":"RE-2026-00002","zahlbetrag_cent":47600}',
  '{"nummer":"RE-2026-00003","zahlbetrag_cent":250000}',
].map(bytes);

const KETTE = hashChain(NUTZLASTEN.map((n, i) => ({ position: i + 1, nutzlastBytes: n })));

describe('(7) Golden Vector — Trenner und Genesis sind Teil des Digests', () => {
  it('der allererste Satz hasht gegen 32 Nullbytes', () => {
    expect(GENESIS).toBe('0'.repeat(64));
    expect(KETTE[0]!.vorherigerHash).toBe(GENESIS);
  });

  /**
   * Der fixe Wert. Er steht hier ausgeschrieben, damit eine stille Änderung an
   * `berechneHash` diesen Test bricht statt eine neue, in sich schlüssige und
   * mit der SQL-Seite unvereinbare Kette zu erzeugen.
   */
  it('und ergibt genau diesen Digest', () => {
    const erwartet = createHash('sha256')
      .update(NUTZLASTEN[0]!)
      .update(Uint8Array.of(0x1e))
      .update(Buffer.alloc(32))
      .digest('hex');
    expect(KETTE[0]!.hash).toBe(erwartet);
    expect(KETTE[0]!.hash).toBe(
      '23b3ef1e71e1ba381ae9bc61586ccf8b968df071ac1816badad6e357f8a5abd3',
    );
  });

  it('OHNE den Trenner ergibt derselbe Satz einen ANDEREN Digest', () => {
    const ohneTrenner = createHash('sha256')
      .update(NUTZLASTEN[0]!)
      .update(Buffer.alloc(32))
      .digest('hex');
    expect(ohneTrenner).not.toBe(KETTE[0]!.hash);
  });

  it('gegen einen NULL-Vorgänger statt 32 Nullbytes ebenfalls', () => {
    // "kein Vorgänger" als leere Bytes statt als 32 Nullbytes.
    const ohneGenesis = createHash('sha256')
      .update(NUTZLASTEN[0]!)
      .update(Uint8Array.of(TRENNER))
      .digest('hex');
    expect(ohneGenesis).not.toBe(KETTE[0]!.hash);
  });

  it('der Vorgänger geht als ROHE Bytes ein, nicht als Hex-Text', () => {
    const alsHexText = createHash('sha256')
      .update(NUTZLASTEN[1]!)
      .update(Uint8Array.of(TRENNER))
      .update(bytes(KETTE[0]!.hash))
      .digest('hex');
    expect(alsHexText).not.toBe(KETTE[1]!.hash);
  });

  it('nutzlast_sha256 ist der Digest der Nutzlast ALLEIN', () => {
    expect(KETTE[0]!.nutzlastSha256).toBe(
      createHash('sha256').update(NUTZLASTEN[0]!).digest('hex'),
    );
    // Und damit ein anderer als der Kettenhash.
    expect(KETTE[0]!.nutzlastSha256).not.toBe(KETTE[0]!.hash);
  });

  it('der Algorithmus benennt Digest UND Kanonisierung', () => {
    expect(ALGORITHMUS).toBe('sha256-jcs-v1');
  });
});

describe('die Kette ist eine Linie, auch über die Jahresgrenze (§5.4)', () => {
  it('jeder Satz zeigt auf den Hash seines Vorgängers', () => {
    expect(KETTE[1]!.vorherigerHash).toBe(KETTE[0]!.hash);
    expect(KETTE[2]!.vorherigerHash).toBe(KETTE[1]!.hash);
    expect(kettenKopf(KETTE)).toBe(KETTE[2]!.hash);
  });

  it('ein Folgekreis setzt mit genesis_hash fort — kein neuer Nullstart pro Jahr', () => {
    const kopf2026 = kettenKopf(KETTE);
    const kette2027 = hashChain([{ position: 1, nutzlastBytes: bytes('{"nummer":"RE-2027-00001"}') }], kopf2026);

    expect(kette2027[0]!.vorherigerHash).toBe(kopf2026);
    expect(verifyChain(kette2027, kopf2026)).toEqual({ ok: true, geprueft: 1 });

    // Und der Beweis, dass das etwas ändert: gegen den Nullgenesis geprüft
    // bricht derselbe Satz. Genau dieser Fall — jedes Jahr eine frische Kette —
    // war der Entwurfsfehler, den §5.4 korrigiert.
    const alsNeustart = verifyChain(kette2027);
    expect(alsNeustart.ok).toBe(false);
  });

  it('kettenKopf eines leeren Kreises ist sein Genesis, nicht undefined', () => {
    expect(kettenKopf([])).toBe(GENESIS);
    expect(kettenKopf([], KETTE[0]!.hash)).toBe(KETTE[0]!.hash);
  });
});

describe('(4) ein einziges verändertes Byte bricht die Kette — und wird benannt', () => {
  function ersterBruch(kette: readonly KettenSatz[]): Bruch {
    const p = verifyChain(kette);
    if (p.ok) throw new Error('erwartet: gebrochen');
    return p.ersterBruch;
  }

  it('eine intakte Kette verifiziert', () => {
    expect(verifyChain(KETTE)).toEqual({ ok: true, geprueft: 3 });
  });

  it('ein Byte in der Nutzlast: der Satz wird als verändert benannt', () => {
    // 119000 → 119001 Cent. Ein Zeichen.
    const manipuliert = KETTE.map((s, i) =>
      i === 1 ? { ...s, nutzlastBytes: bytes('{"nummer":"RE-2026-00002","zahlbetrag_cent":47601}') } : s,
    );
    const b = ersterBruch(manipuliert);
    expect(b.position).toBe(2);
    expect(b.grund).toBe('nutzlast_veraendert');
  });

  it('ein herausgeschnittener Satz: die Verkettung wird als gebrochen benannt', () => {
    const ohneZwei = [KETTE[0]!, { ...KETTE[2]!, position: 2 }];
    const b = ersterBruch(ohneZwei);
    expect(b.position).toBe(2);
    expect(b.grund).toBe('verkettung_gebrochen');
    expect(b.erwartet).toBe(KETTE[0]!.hash);
  });

  it('ein neu gehashter Satz mit passender Nutzlast: der Kettenhash verrät ihn', () => {
    // Der raffinierte Fall: wer die Nutzlast ändert UND nutzlast_sha256
    // nachzieht, kommt an der ersten Prüfung vorbei — nicht aber am Hash, der
    // den Vorgänger mit einschliesst.
    const neueNutzlast = bytes('{"nummer":"RE-2026-00002","zahlbetrag_cent":1}');
    const manipuliert = KETTE.map((s, i) =>
      i === 1
        ? { ...s, nutzlastBytes: neueNutzlast, nutzlastSha256: nutzlastHash(neueNutzlast) }
        : s,
    );
    const b = ersterBruch(manipuliert);
    expect(b.position).toBe(2);
    expect(b.grund).toBe('hash_falsch');
  });

  it('der Bericht nennt das ERSTE kaputte Glied, nicht alle Folgen', () => {
    const kaputt = KETTE.map((s, i) => (i >= 1 ? { ...s, nutzlastBytes: bytes('x') } : s));
    const p = verifyChain(kaputt);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.ersterBruch.position).toBe(2);
    // `geprueft` sagt, wie weit die Kette getragen hat, bevor sie riss.
    expect(p.geprueft).toBe(1);
  });

  it('(5) nach einer Wiederherstellung verifiziert dieselbe Kette unverändert', () => {
    // Ein Restore ist ein Byte-für-Byte-Rückspielen. Die Prüfung darf von
    // nichts ausserhalb der Sätze abhängen — keine Uhr, keine Datenbank, keine
    // Reihenfolge der Speicherung.
    const wiederhergestellt: KettenSatz[] = JSON.parse(
      JSON.stringify(KETTE, (_k, v: unknown) =>
        v instanceof Uint8Array ? { __bytes: Buffer.from(v).toString('base64') } : v,
      ),
      (_k, v: unknown) => {
        const o = v as { __bytes?: string };
        return o !== null && typeof o === 'object' && typeof o.__bytes === 'string'
          ? new Uint8Array(Buffer.from(o.__bytes, 'base64'))
          : v;
      },
    ) as KettenSatz[];
    expect(verifyChain(wiederhergestellt)).toEqual({ ok: true, geprueft: 3 });
  });
});

describe('die Kette weigert sich, unklare Eingaben zu verketten', () => {
  it('ein Hash, der kein Hex-64 ist, wird abgelehnt statt gehasht', () => {
    expect(() => berechneHash(bytes('x'), 'kurz')).toThrow(KettenFehler);
    expect(() => berechneHash(bytes('x'), 'G'.repeat(64))).toThrow(KettenFehler);
    expect(() => hashChain([{ position: 1, nutzlastBytes: bytes('x') }], 'nix')).toThrow(KettenFehler);
  });

  it('eine Position ausser der Reihe wird abgelehnt, nicht sortiert', () => {
    // Sortieren hiesse raten, welche Reihenfolge gemeint war — und die
    // Reihenfolge IST der Inhalt der Kette.
    expect(() =>
      hashChain([
        { position: 2, nutzlastBytes: bytes('a') },
        { position: 1, nutzlastBytes: bytes('b') },
      ]),
    ).toThrow(/kette_position/u);
  });

  it('eine leere Kette ist gültig und ihr Kopf ist der Genesis', () => {
    expect(verifyChain([])).toEqual({ ok: true, geprueft: 0 });
  });
});
