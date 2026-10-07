import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { SCHLUESSEL_KONTAKT, SCHLUESSEL_RICHTLINIE, istKontaktWert } from './sicherheit-txt.js';

/**
 * **Den Sicherheitskontakt der Plattform pflegen** (V-392, O-35, D-809).
 *
 * `/.well-known/security.txt` antwortet 404, bis `sicherheit.kontakt` einen
 * gueltigen `Contact`-Wert traegt (`sicherheit-txt.ts`). Bis hierher setzte
 * ihn nur SQL; `app.sicherheitskontakt_setzen` (0503) prueft Sitzung, zweiten
 * Faktor, `system.einstellung_verwalten` und eine Super-Administration, und
 * protokolliert vorher und nachher.
 *
 * Eine Plattformangabe, keine Gesellschaftsangabe: es gibt EINE Datei fuer
 * die ganze Plattform. Postfach, wer es liest, und die Antwortfrist sind
 * Betreiberdaten (O-35, D-803) — hier wird nur eingetragen, was der Betreiber
 * benennt; ohne Eintrag bleibt die Datei ein 404, mit Absicht.
 */

export type SicherheitskontaktGrund =
  | 'nicht_erlaubt' | 'nur_super_admin' | 'kontakt_ungueltig' | 'richtlinie_ungueltig'
  | 'richtlinie_ohne_kontakt';

export class SicherheitskontaktFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: SicherheitskontaktGrund,
    readonly status: number,
  ) {
    super(nachricht);
    this.name = 'SicherheitskontaktFehler';
  }
}

export interface SicherheitskontaktEingabe {
  /** Leer = kein Postfach; die Datei antwortet wieder 404. */
  readonly kontakt: string;
  readonly richtlinie: string;
}

/**
 * Prueft vorab mit denselben Regeln wie die Datei (`istKontaktWert`) — die
 * Datenbank prueft noch einmal (0503).
 */
export function pruefeSicherheitskontakt(e: SicherheitskontaktEingabe): SicherheitskontaktEingabe {
  const kontakt = e.kontakt.trim();
  const richtlinie = e.richtlinie.trim();
  if (kontakt !== '' && !istKontaktWert(kontakt)) {
    throw new SicherheitskontaktFehler(
      'Der Kontakt ist eine mailto:-, https:- oder tel:-Adresse (RFC 9116).',
      'kontakt_ungueltig', 422);
  }
  if (richtlinie !== '' && !/^https:\/\/\S+$/u.test(richtlinie)) {
    throw new SicherheitskontaktFehler(
      'Die Richtlinie ist eine https:-Adresse (RFC 9116).', 'richtlinie_ungueltig', 422);
  }
  if (kontakt === '' && richtlinie !== '') {
    throw new SicherheitskontaktFehler(
      'Eine Richtlinie ohne Kontakt steht in keiner Datei.', 'richtlinie_ohne_kontakt', 422);
  }
  return { kontakt, richtlinie };
}

function uebersetze(fehler: unknown): never {
  const f = fehler as { code?: string; detail?: string };
  if (f.code === '42501' && f.detail === 'nur_super_admin') {
    throw new SicherheitskontaktFehler(
      'Den Sicherheitskontakt der Plattform trägt die Super-Administration ein.',
      'nur_super_admin', 403);
  }
  if (f.code === '42501') {
    throw new SicherheitskontaktFehler('Nicht gefunden.', 'nicht_erlaubt', 404);
  }
  if (f.code === '22023' && (f.detail === 'kontakt_ungueltig'
    || f.detail === 'richtlinie_ungueltig' || f.detail === 'richtlinie_ohne_kontakt')) {
    throw new SicherheitskontaktFehler(
      'Ungültige Angabe.', f.detail as SicherheitskontaktGrund, 422);
  }
  throw fehler;
}

/** Setzt beide Werte; `geaendert: false`, wenn schon so eingetragen. */
export async function setzeSicherheitskontakt(
  kontext: SchreibKontext, eingabe: SicherheitskontaktEingabe,
): Promise<{ readonly geaendert: boolean }> {
  const e = pruefeSicherheitskontakt(eingabe);
  try {
    const [z] = await kontext.schreibe<{ geaendert: boolean }>(
      `select app.sicherheitskontakt_setzen($1, $2) as geaendert`, [e.kontakt, e.richtlinie]);
    return { geaendert: z?.geaendert === true };
  } catch (fehler) {
    return uebersetze(fehler);
  }
}

export interface Sicherheitskontakt {
  /** Der gueltige `Contact`-Wert — `null`, solange keiner eingetragen ist. */
  readonly kontakt: string | null;
  readonly richtlinie: string | null;
}

/** Was die Datei heute sagen wuerde. */
export async function leseSicherheitskontakt(kontext: LeseKontext): Promise<Sicherheitskontakt> {
  const zeilen = await kontext.abfrage<{ schluessel: string; wert: unknown }>(
    `select schluessel, wert from plattform_einstellung where schluessel = any($1::text[])`,
    [[SCHLUESSEL_KONTAKT, SCHLUESSEL_RICHTLINIE]]);
  const wert = (s: string): unknown => zeilen.find((z) => z.schluessel === s)?.wert ?? null;
  const kontakt = wert(SCHLUESSEL_KONTAKT);
  const richtlinie = wert(SCHLUESSEL_RICHTLINIE);
  return {
    kontakt: istKontaktWert(kontakt) ? kontakt.trim() : null,
    richtlinie: typeof richtlinie === 'string' && richtlinie.trim() !== '' ? richtlinie.trim() : null,
  };
}
