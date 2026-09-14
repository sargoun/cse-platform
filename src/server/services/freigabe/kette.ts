/**
 * Die Freigabekette — elf Bestandteile, ein Trennbyte (APR-07, K-13,
 * `06-AGENTEN-FREIGABEN.md` §14.2).
 *
 *   hash = SHA256( nutzlast_hash ⟨1F⟩ artefakt_hash ⟨1F⟩ diff_hash ⟨1F⟩
 *                  felder_hash ⟨1F⟩ ansicht_modell_hash ⟨1F⟩
 *                  policy_ergebnis_hash ⟨1F⟩ art ⟨1F⟩ entschieden_von ⟨1F⟩
 *                  entschieden_am ⟨1F⟩ kette_nr ⟨1F⟩ vorher_hash )
 *
 * **Warum elf und nicht sechs.** Eine frühere Fassung hashte nur Nutzlast,
 * Art, Entscheider, Zeitpunkt, Kettennummer und Vorgänger. Das bewies nichts
 * über den Diff, die Feldnachweise, das Ansichtsmodell und das Ergebnis des
 * Tores — also nichts darüber, WAS auf dem Schirm stand, als der Mensch
 * „Freigeben" drückte. Genau das ist der Satz, den APR-07 belegen soll, und
 * APR-02 und APR-03 sind die Teile davon, die man sonst unbemerkt austauschen
 * könnte: der Beleg bliebe „intakt", und der Mensch hätte etwas anderes
 * gesehen.
 *
 * **Warum die Kanonisierung hier ausgeschrieben steht.** Die Kette wird in
 * SQL geschrieben (`trg_freigabe_snapshot_hashes`) und hier nachgerechnet.
 * Zwei Implementierungen, die sich über ein fehlendes Trennzeichen oder über
 * `null` gegen `''` uneinig sind, melden JEDE NACHT einen Bruch an jedem
 * Glied — und wer das einmal erlebt hat, schaltet den Wächter ab. Deshalb:
 *
 *  - jeder Bestandteil ist ein KLEINGESCHRIEBENER Hex-Digest oder die LEERE
 *    Zeichenkette. Nie das Wort `null`, nie ein fehlender Abschnitt;
 *  - genau EIN Byte `0x1F` zwischen zwei Bestandteilen;
 *  - `entschieden_am` ist die RFC-3339-Darstellung in UTC mit Millisekunden,
 *    `kette_nr` sind seine Dezimalziffern.
 *
 * `algorithmus = 'sha256-jcs-v1'` beschreibt dieselbe Kanonisierung wie die
 * Rechnungskette, und `kanonischerText` aus `finanz/kanonisch.ts` ist genau
 * die eine Implementierung davon (§14.2, 05-FINANZEN §5.4).
 */
import { createHash } from 'node:crypto';
import { kanonisiere, type KanonischerWert } from '../finanz/kanonisch.js';

/** ASCII UNIT SEPARATOR. Teil des Digests, nicht Formatierung. */
export const TRENNER = 0x1f;

export const ALGORITHMUS = 'sha256-jcs-v1' as const;

const HEX64 = /^[0-9a-f]{64}$/u;

export class FreigabeKettenFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'FreigabeKettenFehler'; }
}

/** Die fünf Entscheidungsarten (`freigabe_art`). */
export type FreigabeArt =
  | 'genehmigt' | 'abgelehnt' | 'korrektur' | 'widerruf' | 'automatisch_nach_frist';

export const FREIGABE_ARTEN: readonly FreigabeArt[] = [
  'genehmigt', 'abgelehnt', 'korrektur', 'widerruf', 'automatisch_nach_frist',
];

/** Der Digest eines JSON-Bestandteils über seine kanonische Form (RFC 8785). */
export function jcsDigest(wert: KanonischerWert): string {
  return createHash('sha256').update(kanonisiere(wert)).digest('hex');
}

function pruefeHex(name: string, wert: string): string {
  if (wert === '') return '';
  if (!HEX64.test(wert)) {
    throw new FreigabeKettenFehler(
      `${name} ist weder ein kleingeschriebener SHA-256-Hex-Digest noch leer: `
      + `${JSON.stringify(wert)}`,
    );
  }
  return wert;
}

export interface KettenGlied {
  readonly nutzlastHash: string;
  /** Leer, wenn die Entscheidung kein gerendertes Artefakt hatte. */
  readonly artefaktHash: string;
  readonly diffHash: string;
  readonly felderHash: string;
  readonly ansichtModellHash: string;
  readonly policyErgebnisHash: string;
  readonly art: FreigabeArt;
  /** Leer nur bei `automatisch_nach_frist` — sonst die Benutzerkennung. */
  readonly entschiedenVon: string;
  readonly entschiedenAm: Date;
  readonly ketteNr: bigint;
  /** Leer beim allerersten Glied einer Gesellschaft. */
  readonly vorherHash: string;
}

/**
 * Die Bytes, über die gehasht wird. Ausgelagert, weil ein Test sie sehen
 * können muss: ein Digest, der nicht stimmt, sagt nicht, an welchem
 * Bestandteil es lag.
 */
export function gliedBytes(glied: KettenGlied): Buffer {
  if (glied.ketteNr < 1n) {
    throw new FreigabeKettenFehler(
      `Die Kettennummer beginnt bei 1, nicht bei ${glied.ketteNr.toString()}.`,
    );
  }
  if (Number.isNaN(glied.entschiedenAm.getTime())) {
    throw new FreigabeKettenFehler('entschieden_am ist kein gültiger Zeitpunkt.');
  }
  if (glied.art !== 'automatisch_nach_frist' && glied.entschiedenVon === '') {
    throw new FreigabeKettenFehler(
      `Die Art ${glied.art} verlangt einen Entscheider (Invariante 7).`,
    );
  }
  if (glied.ketteNr === 1n && glied.vorherHash !== '') {
    throw new FreigabeKettenFehler(
      'Das erste Glied hat keinen Vorgänger; vorher_hash muss leer sein.',
    );
  }
  if (glied.ketteNr > 1n && glied.vorherHash === '') {
    throw new FreigabeKettenFehler(
      `Glied ${glied.ketteNr.toString()} ohne Vorgänger — eine Kette mit einer Lücke `
      + 'bezeugt nichts.',
    );
  }

  const teile = [
    pruefeHex('nutzlast_hash', glied.nutzlastHash),
    pruefeHex('artefakt_hash', glied.artefaktHash),
    pruefeHex('diff_hash', glied.diffHash),
    pruefeHex('felder_hash', glied.felderHash),
    pruefeHex('ansicht_modell_hash', glied.ansichtModellHash),
    pruefeHex('policy_ergebnis_hash', glied.policyErgebnisHash),
    glied.art,
    glied.entschiedenVon,
    glied.entschiedenAm.toISOString(),
    glied.ketteNr.toString(10),
    pruefeHex('vorher_hash', glied.vorherHash),
  ];

  const trenner = Buffer.from([TRENNER]);
  const stuecke: Buffer[] = [];
  teile.forEach((t, i) => {
    if (i > 0) stuecke.push(trenner);
    stuecke.push(Buffer.from(t, 'utf8'));
  });
  return Buffer.concat(stuecke);
}

export function gliedHash(glied: KettenGlied): string {
  return createHash('sha256').update(gliedBytes(glied)).digest('hex');
}

export interface GespeichertesGlied extends KettenGlied {
  readonly hash: string;
}

export interface Kettenbefund {
  readonly intakt: boolean;
  /** Die Kettennummer des ersten Bruchs, oder `null`. */
  readonly bruchBei: bigint | null;
  readonly grund: string | null;
}

/**
 * Die unabhängige Nachrechnung — der nächtliche Wächter
 * (`jobs/watchdogs/freigabe-kette-verify.ts`).
 *
 * Geprüft wird dreierlei, und jedes hat einen eigenen Ausfall dahinter:
 * lückenlose Nummerierung (ein gelöschtes Glied), die Verkettung
 * (`vorher_hash` des Nachfolgers ist der `hash` des Vorgängers — ein
 * ausgetauschtes Glied) und der Digest selbst (ein bearbeiteter Inhalt).
 */
export function pruefeKette(glieder: readonly GespeichertesGlied[]): Kettenbefund {
  const sortiert = [...glieder].sort((a, b) => (a.ketteNr < b.ketteNr ? -1 : 1));
  let vorher = '';

  for (let i = 0; i < sortiert.length; i += 1) {
    const g = sortiert[i]!;
    const erwarteteNr = BigInt(i + 1);
    if (g.ketteNr !== erwarteteNr) {
      return {
        intakt: false,
        bruchBei: g.ketteNr,
        grund: `Lücke: erwartet ${erwarteteNr.toString()}, gefunden `
          + `${g.ketteNr.toString()}`,
      };
    }
    if (g.vorherHash !== vorher) {
      return {
        intakt: false,
        bruchBei: g.ketteNr,
        grund: 'vorher_hash zeigt nicht auf den Hash des Vorgängers',
      };
    }
    const erwartet = gliedHash(g);
    if (erwartet !== g.hash) {
      return {
        intakt: false,
        bruchBei: g.ketteNr,
        grund: `Digest stimmt nicht: gespeichert ${g.hash}, berechnet ${erwartet}`,
      };
    }
    vorher = g.hash;
  }

  return { intakt: true, bruchBei: null, grund: null };
}
