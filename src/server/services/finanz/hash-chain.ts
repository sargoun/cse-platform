/**
 * Die Hash-Kette (FIN-06, LEG-01) — `05-FINANZEN.md` §5.4.
 *
 *   nutzlast_sha256 = SHA256( canonical_bytes )
 *   hash            = SHA256( canonical_bytes || 0x1E || vorheriger_bytes )
 *
 * `vorheriger_bytes` sind die **32 rohen Bytes** des Vorgänger-Hashes, für den
 * allerersten Satz einer Gesellschaft 32 Nullbytes. Beides ist Teil des
 * Digests und steht deshalb hier als Konstante, nicht als Konvention:
 *
 * - Ohne den `0x1E`-Trenner sind Nutzlast und Vorgänger nicht eindeutig
 *   voneinander abgegrenzt — zwei verschiedene Paare können dieselben
 *   verketteten Bytes ergeben.
 * - Ein NULL-Genesis statt 32 Nullbytes ergibt für denselben Satz einen
 *   **anderen** Digest. Genau das prüft der Golden-Vector-Test, damit die zwei
 *   Implementierungen (diese hier und `fin.rechnung_kette_schreiben` in SQL)
 *   nicht stillschweigend auseinanderlaufen.
 *
 * Diese Datei ist die **Prüfer**-Implementierung. Der Schreiber läuft in SQL,
 * und die Doppelung ist Absicht (§5.7): der nächtliche Lauf ist eine
 * unabhängige Neuberechnung statt einer Tautologie.
 *
 * Was hier NICHT steht: der Kanonisierer. Den gibt es genau einmal
 * (`buildKanonischePayload`, RFC 8785) und er kommt mit dem Rechnungsmodell.
 * Zwei Kanonisierer hiessen: eine Kette, die verifiziert, weil beide Seiten
 * denselben Fehler machen.
 */
import { createHash } from 'node:crypto';

/** `algorithmus` benennt Digest UND Kanonisierung — §5.2. */
export const ALGORITHMUS = 'sha256-jcs-v1' as const;

/** ASCII RECORD SEPARATOR. Teil des Digests, nicht Formatierung. */
export const TRENNER = 0x1e;

/** 32 Nullbytes als Hex — der Vorgänger des allerersten Satzes. */
export const GENESIS = '0'.repeat(64);

const HEX64 = /^[0-9a-f]{64}$/u;

export class KettenFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'KettenFehler';
  }
}

/** Ein Satz, wie ihn eine kettenführende Tabelle speichert. */
export interface KettenSatz {
  /** `kette_position`, 1-basiert und lückenlos innerhalb eines Kreises. */
  readonly position: number;
  /** Die kanonischen Bytes, die gehasht wurden. Massgeblich. */
  readonly nutzlastBytes: Uint8Array;
  /** Hex-64. Nie NULL — der Genesis ist 64 Nullen, kein fehlender Wert. */
  readonly vorherigerHash: string;
  /** Hex-64. */
  readonly hash: string;
  /** Hex-64. SHA-256 der Nutzlast allein, ohne die Kette zu laufen. */
  readonly nutzlastSha256: string;
}

/** Ein Satz, bevor er verkettet ist. */
export interface KettenEingabe {
  readonly position: number;
  readonly nutzlastBytes: Uint8Array;
}

export type Bruchgrund =
  /** Der gespeicherte Hash passt nicht zu Nutzlast + Vorgänger. */
  | 'hash_falsch'
  /** `nutzlast_sha256` passt nicht zu den Bytes — die Nutzlast wurde geändert. */
  | 'nutzlast_veraendert'
  /** `vorheriger_hash` ist nicht der Hash des Vorgängers — ein Glied fehlt. */
  | 'verkettung_gebrochen'
  /** `kette_position` springt oder wiederholt sich. */
  | 'position_luecke'
  /** Kein Hex-64. */
  | 'format_ungueltig';

export interface Bruch {
  readonly position: number;
  readonly grund: Bruchgrund;
  readonly erwartet: string;
  readonly gefunden: string;
}

export type KettenPruefung =
  | { readonly ok: true; readonly geprueft: number }
  /** `ersterBruch` — der Bericht nennt das ERSTE kaputte Glied. Alles danach
   *  ist Folge, und eine Liste aus Folgen verdeckt die Ursache. */
  | { readonly ok: false; readonly geprueft: number; readonly ersterBruch: Bruch };

function hexPruefen(wert: string, feld: string): void {
  if (!HEX64.test(wert)) {
    throw new KettenFehler(`${feld} ist kein Hex-64: ${JSON.stringify(wert)}`);
  }
}

/** SHA-256 der Nutzlast allein. */
export function nutzlastHash(nutzlastBytes: Uint8Array): string {
  return createHash('sha256').update(nutzlastBytes).digest('hex');
}

/**
 * Der Kettenhash eines einzelnen Satzes.
 *
 * `vorherigerHash` kommt als Hex herein und geht als **rohe Bytes** in den
 * Digest — nicht als Hex-Text. Ein Digest über den Hex-String wäre ein anderer
 * und würde gegen die SQL-Seite verifizieren, die es richtig macht.
 */
export function berechneHash(nutzlastBytes: Uint8Array, vorherigerHash: string): string {
  hexPruefen(vorherigerHash, 'vorherigerHash');
  return createHash('sha256')
    .update(nutzlastBytes)
    .update(Uint8Array.of(TRENNER))
    .update(Buffer.from(vorherigerHash, 'hex'))
    .digest('hex');
}

/**
 * Verkettet Sätze zu einer Linie.
 *
 * `genesis` ist der letzte Hash des Vorgängerkreises, wenn dieser Kreis einen
 * fortsetzt (§5.4: die Kreise einer Gesellschaft sind EINE Linie, keine neue
 * Kette pro Jahr) — sonst 32 Nullbytes.
 */
export function hashChain(
  saetze: readonly KettenEingabe[],
  genesis: string = GENESIS,
): readonly KettenSatz[] {
  hexPruefen(genesis, 'genesis');
  const ergebnis: KettenSatz[] = [];
  let vorheriger = genesis;

  for (const [i, satz] of saetze.entries()) {
    const erwartetePosition = i + 1;
    if (satz.position !== erwartetePosition) {
      throw new KettenFehler(
        `kette_position ${satz.position} an Stelle ${erwartetePosition} — `
        + 'die Kette wird in Reihenfolge verkettet, nicht sortiert.',
      );
    }
    const hash = berechneHash(satz.nutzlastBytes, vorheriger);
    ergebnis.push({
      position: satz.position,
      nutzlastBytes: satz.nutzlastBytes,
      vorherigerHash: vorheriger,
      hash,
      nutzlastSha256: nutzlastHash(satz.nutzlastBytes),
    });
    vorheriger = hash;
  }
  return ergebnis;
}

/**
 * Läuft die Kette nach und **meldet, repariert nie** (§5.7).
 *
 * Der nächtliche Job ruft genau das auf. Eine Reparatur wäre eine Änderung an
 * unveränderlichen Sätzen — und ein Prüfer, der repariert, kann nicht mehr
 * bezeugen, dass nichts geändert wurde.
 */
export function verifyChain(
  saetze: readonly KettenSatz[],
  genesis: string = GENESIS,
): KettenPruefung {
  hexPruefen(genesis, 'genesis');
  let vorheriger = genesis;

  for (const [i, satz] of saetze.entries()) {
    const bruch = (grund: Bruchgrund, erwartet: string, gefunden: string): KettenPruefung => ({
      ok: false,
      geprueft: i,
      ersterBruch: { position: satz.position, grund, erwartet, gefunden },
    });

    if (!HEX64.test(satz.hash) || !HEX64.test(satz.vorherigerHash)
        || !HEX64.test(satz.nutzlastSha256)) {
      return bruch('format_ungueltig', 'hex-64', satz.hash);
    }
    if (satz.position !== i + 1) {
      return bruch('position_luecke', String(i + 1), String(satz.position));
    }
    // Zuerst die Nutzlast: sie sagt WAS geändert wurde, während ein falscher
    // Kettenhash nur sagt, dass irgendetwas nicht passt.
    const eigen = nutzlastHash(satz.nutzlastBytes);
    if (eigen !== satz.nutzlastSha256) {
      return bruch('nutzlast_veraendert', satz.nutzlastSha256, eigen);
    }
    if (satz.vorherigerHash !== vorheriger) {
      return bruch('verkettung_gebrochen', vorheriger, satz.vorherigerHash);
    }
    const erwartet = berechneHash(satz.nutzlastBytes, satz.vorherigerHash);
    if (erwartet !== satz.hash) {
      return bruch('hash_falsch', erwartet, satz.hash);
    }
    vorheriger = satz.hash;
  }

  return { ok: true, geprueft: saetze.length };
}

/** Der Kopf der Kette — `nummernkreis.letzter_hash` nach dem letzten Satz. */
export function kettenKopf(
  saetze: readonly KettenSatz[],
  genesis: string = GENESIS,
): string {
  return saetze.at(-1)?.hash ?? genesis;
}
