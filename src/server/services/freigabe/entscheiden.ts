import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { kanonisiere, type KanonischerWert } from '../finanz/kanonisch.js';
import { anzahlAenderungen } from './diff.js';
import { fuerJsonb, alsKanonischerWert } from './diff-json.js';
import { ladeFreigabe, type FeldNachweis, type FreigabeAnsicht } from './laden.js';

/**
 * Die Entscheidung — der eine Aufruf von `app.freigabe_entscheiden` (APR-07,
 * K-13, D-469, D-472).
 *
 * **Die Anwendung liefert Bytes, die Datenbank die Kette** (D-467): fuer jede
 * jsonb-Spalte des Schnappschusses stehen hier ihre kanonischen Bytes
 * (`kanonisiere`, RFC 8785) daneben. Die Digests rechnet der Definer; einen
 * Hash nimmt er nicht entgegen.
 *
 * **Was in den Schnappschuss geht, ist, was auf dem Schirm stand.** Die
 * Nutzlast ist `vorschau_payload`, der Diff `freigabe.diff` — beide EXAKT wie
 * gespeichert, nicht neu erzeugt —, die Felder sind die Nachweiszeilen mit
 * ihrer Konfidenz als Zeichenkette der Datenbank, und `ansicht_modell`
 * beschreibt die Darstellung (Kopfzeile, Spalten, Einstufung), ueber die der
 * Mensch entschieden hat. `policy_ergebnis` sind die Tatsachen des Tores, die
 * die Zeile traegt: das verlangte Recht, die Einstufung, die Stapelsperre.
 *
 * **Zwei Riegel liegen HIER, nicht in der Datenbank:** eine Genehmigung bei
 * unsicheren Feldern (APR-03 — die Zahl fuehrt die Datenbank, die Sperre
 * der Dienst; der Knopf im Bildschirm ist nur ihre Anzeige) und eine
 * Ablehnung ohne Begruendung, die der Definer ebenfalls abweist — hier faellt
 * sie frueher und mit einem Grund, den ein Formular anzeigen kann.
 */

export type EntscheidungsArt = 'genehmigt' | 'abgelehnt';

export interface Entscheidung {
  readonly freigabeId: string;
  readonly art: EntscheidungsArt;
  readonly begruendung: string | null;
  /** Aus der Anfrage — `null`, wenn die Adresse nicht bestimmbar ist. */
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Der Stand des Codes, der entschieden hat — Commit-SHA oder `entwicklung`. */
  readonly codeVersion: string;
}

export interface Entschieden {
  readonly snapshotId: string;
  readonly ketteNr: bigint;
  readonly hash: string;
}

export type AbweisungsGrund =
  | 'nicht_gefunden' | 'bereits_entschieden' | 'unsichere_felder' | 'ohne_begruendung'
  | 'nicht_geoeffnet' | 'nutzlast_veraendert' | 'recht_fehlt' | 'abgewiesen';

/** Eine Abweisung, die ein Mensch lesen soll — kein Programmfehler (409, nie 500). */
export class FreigabeAbgewiesen extends Error {
  constructor(
    readonly grund: AbweisungsGrund,
    nachricht: string,
    readonly hinweis: string | null = null,
  ) {
    super(nachricht);
    this.name = 'FreigabeAbgewiesen';
  }
}

export const ANSICHT_VERSION = 'freigabe-ansicht.v1' as const;
export const TOR_VERSION = 'freigabe-tor.v1' as const;

/** Die Nachweiszeilen, wie sie der Schnappschuss traegt — Nullwerte ausgeschrieben. */
export function felderModell(felder: readonly FeldNachweis[]): KanonischerWert {
  return felder.map((f) => ({
    feldPfad: f.feldPfad,
    bezeichnung: f.bezeichnung,
    wertVorher: f.wertVorher,
    wertNachher: f.wertNachher,
    konfidenz: f.konfidenz,
    unsicher: f.unsicher,
    grund: f.grund,
    quelle: {
      dokumentId: f.quelle.dokumentId,
      seite: f.quelle.seite,
      tabelle: f.quelle.tabelle,
      zelle: f.quelle.zelle,
      zitat: f.quelle.zitat,
    },
    extraktionModell: f.extraktionModell,
  }));
}

/** Was der Bildschirm gezeigt hat: Kopfzeile, Einstufung, Spalten. */
export function ansichtModell(a: FreigabeAnsicht): KanonischerWert {
  return {
    version: ANSICHT_VERSION,
    titel: a.freigabe.titel,
    zusammenfassung: a.freigabe.zusammenfassung,
    vorgangTyp: a.freigabe.vorgangTyp,
    risiko: a.freigabe.risiko,
    risikoPunkte: a.freigabe.risikoPunkte,
    betragCent: a.freigabe.betragCent,
    frist: a.freigabe.frist === null ? null : a.freigabe.frist.toISOString(),
    unsichereFelder: a.freigabe.unsichereFelder,
    anzahlAenderungen: a.diff === null ? null : anzahlAenderungen(a.diff),
    spalten: {
      diff: ['bezeichnung', 'feld', 'alt', 'neu', 'deltaCent'],
      felder: ['bezeichnung', 'wertVorher', 'wertNachher', 'konfidenz', 'unsicher', 'quelle'],
    },
    vorschau: 'vollstaendig',
  };
}

/** Die Tatsachen des Tores, die die Zeile traegt (§4.3, K-19). */
export function torErgebnis(a: FreigabeAnsicht): KanonischerWert {
  return {
    version: TOR_VERSION,
    erforderlichesRecht: a.freigabe.erforderlichesRecht,
    risiko: a.freigabe.risiko,
    stapelFaehig: a.freigabe.stapelFaehig,
    stapelSperreGrund: a.freigabe.stapelSperreGrund,
    richtlinieId: a.freigabe.richtlinieId,
    routineFaehig: a.routineFaehig,
  };
}

interface DefinerZeile {
  readonly snapshot_id: string;
  readonly kette_nr: string;
  readonly hash: string;
}

interface DatenbankFehler {
  readonly code?: string;
  readonly message?: string;
  readonly hint?: string;
}

/**
 * Die Abweisungen des Definers, die ein Mensch lesen soll. Alles andere
 * bleibt ein Programmfehler und bleibt laut.
 */
function uebersetze(fehler: unknown): unknown {
  const f = fehler as DatenbankFehler;
  const text = f.message ?? '';
  const hinweis = f.hint ?? null;
  if (/nie geoeffnet/u.test(text)) {
    return new FreigabeAbgewiesen('nicht_geoeffnet', text, hinweis);
  }
  if (/nicht die vorgelegte/u.test(text)) {
    return new FreigabeAbgewiesen('nutzlast_veraendert', text, hinweis);
  }
  if (/bereits entschieden/u.test(text)) {
    return new FreigabeAbgewiesen('bereits_entschieden', text, hinweis);
  }
  if (/ohne Begruendung/u.test(text)) {
    return new FreigabeAbgewiesen('ohne_begruendung', text, hinweis);
  }
  if (f.code === 'P0002') return new FreigabeAbgewiesen('nicht_gefunden', text, hinweis);
  if (f.code === '42501') return new FreigabeAbgewiesen('recht_fehlt', text, hinweis);
  if (f.code === '23001' || f.code === 'P0001' || f.code === '23514' || f.code === '23505') {
    return new FreigabeAbgewiesen('abgewiesen', text, hinweis);
  }
  return fehler;
}

export async function entscheideFreigabe(
  kontext: SchreibKontext, e: Entscheidung,
): Promise<Entschieden> {
  const begruendung = e.begruendung === null || e.begruendung.trim() === ''
    ? null : e.begruendung.trim();
  if (e.art === 'abgelehnt' && begruendung === null) {
    throw new FreigabeAbgewiesen('ohne_begruendung',
      'Eine Ablehnung ohne Begruendung ist keine Auskunft.');
  }

  const a = await ladeFreigabe(kontext, e.freigabeId);
  if (a === null) {
    throw new FreigabeAbgewiesen('nicht_gefunden',
      `Freigabe ${e.freigabeId} existiert nicht oder ist nicht sichtbar.`);
  }
  if (a.freigabe.status !== 'offen') {
    throw new FreigabeAbgewiesen('bereits_entschieden',
      `Freigabe ${e.freigabeId} ist bereits entschieden (${a.freigabe.status}).`);
  }
  if (e.art === 'genehmigt' && a.freigabe.unsichereFelder > 0) {
    throw new FreigabeAbgewiesen('unsichere_felder',
      `${String(a.freigabe.unsichereFelder)} Feld(er) sind unsicher — eine Freigabe `
      + 'darueber hinweg ist keine Pruefung (APR-03).',
      'Eine Korrektur ist eine NEUE Freigabe (§4.5); diese laesst sich nur ablehnen.');
  }

  const nutzlast = alsKanonischerWert(a.vorschau);
  const diff = alsKanonischerWert(a.diffRoh ?? []);
  const felder = felderModell(a.felder);
  const ansicht = ansichtModell(a);
  const tor = torErgebnis(a);
  const bytes = (w: KanonischerWert): Buffer => Buffer.from(kanonisiere(w));

  let zeile: DefinerZeile | undefined;
  try {
    [zeile] = await kontext.schreibe<DefinerZeile>(
      `select * from app.freigabe_entscheiden(
         $1::uuid, $2::freigabe_art,
         $3::jsonb, $4::bytea, $5::jsonb, $6::bytea, $7::jsonb, $8::bytea,
         $9::jsonb, $10::bytea, $11::jsonb, $12::bytea,
         null, $13, $14::inet, $15, $16)`,
      [e.freigabeId, e.art,
        fuerJsonb(nutzlast), bytes(nutzlast),
        fuerJsonb(diff), bytes(diff),
        fuerJsonb(felder), bytes(felder),
        fuerJsonb(ansicht), bytes(ansicht),
        fuerJsonb(tor), bytes(tor),
        begruendung, e.ip, e.userAgent, e.codeVersion]);
  } catch (fehler: unknown) {
    throw uebersetze(fehler);
  }
  if (zeile === undefined) {
    throw new FreigabeAbgewiesen('abgewiesen', 'Der Definer hat keinen Schnappschuss zurueckgegeben.');
  }
  return { snapshotId: zeile.snapshot_id, ketteNr: BigInt(zeile.kette_nr), hash: zeile.hash };
}
