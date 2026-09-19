import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { ALTSYSTEM_TEXT, migrationPort, type Altsystem }
  from '../../integrationen/migration.js';

/**
 * Die Uebernahmelaeufe aus den Altsystemen — lesend (ROADMAP Phase 10,
 * O-128).
 *
 * **Gebaut ist die FORM, nicht der Parser.** `migration_lauf` und
 * `migration_zeile` (0202) tragen Datei, Pruefsumme, Zustand, Zaehler und
 * Fehlerbericht; der Port (`server/integrationen/migration.ts`) ist die
 * Schnittstelle, hinter der einmal ein Parser steht. Bis O-128 beantwortet
 * ist, gibt es keinen Lauf — und die Seite sagt das aus einer echten
 * Tabelle, nicht aus einem festen Text: der Tag, an dem der erste Lauf
 * entsteht, aendert den Bildschirm ohne Codeaenderung.
 */

export interface LaufZeile {
  readonly id: string;
  readonly quelle: Altsystem;
  readonly quelleName: string;
  readonly dateiName: string;
  readonly dateiSha256: string;
  readonly dateiGroesseBytes: string;
  readonly status: 'entwurf' | 'geprueft' | 'uebernommen' | 'verworfen';
  readonly zeilenGesamt: number;
  readonly zeilenGueltig: number;
  readonly zeilenFehlerhaft: number;
  readonly bemerkung: string | null;
  readonly geprueftAm: string | null;
  readonly uebernommenAm: string | null;
  readonly verworfenAm: string | null;
  readonly erstelltAm: string;
}

interface Roh {
  readonly id: string;
  readonly quelle: string;
  readonly datei_name: string;
  readonly datei_sha256: string;
  readonly datei_groesse_bytes: string;
  readonly status: string;
  readonly zeilen_gesamt: number;
  readonly zeilen_gueltig: number;
  readonly zeilen_fehlerhaft: number;
  readonly bemerkung: string | null;
  readonly geprueft_am: string | null;
  readonly uebernommen_am: string | null;
  readonly verworfen_am: string | null;
  readonly erstellt_am: string;
}

/** Berliner Anzeige, UTC gespeichert (Invariante 2) — in DER Abfrage. */
const ZEIT = (spalte: string): string =>
  `to_char(${spalte} at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')`;

export async function ladeLaeufe(
  kontext: LeseKontext,
): Promise<readonly LaufZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select l.id, l.quelle, l.datei_name, l.datei_sha256,
            l.datei_groesse_bytes::text as datei_groesse_bytes,
            l.status, l.zeilen_gesamt, l.zeilen_gueltig, l.zeilen_fehlerhaft,
            l.bemerkung,
            ${ZEIT('l.geprueft_am')} as geprueft_am,
            ${ZEIT('l.uebernommen_am')} as uebernommen_am,
            ${ZEIT('l.verworfen_am')} as verworfen_am,
            ${ZEIT('l.erstellt_am')} as erstellt_am
       from migration_lauf l
      order by l.erstellt_am desc`);
  const namen = new Map(ALTSYSTEM_TEXT.map((a) => [a.schluessel as string, a.name]));
  return roh.map((r) => ({
    id: r.id,
    quelle: r.quelle as Altsystem,
    quelleName: namen.get(r.quelle) ?? r.quelle,
    dateiName: r.datei_name,
    dateiSha256: r.datei_sha256,
    dateiGroesseBytes: r.datei_groesse_bytes,
    status: r.status as LaufZeile['status'],
    zeilenGesamt: r.zeilen_gesamt,
    zeilenGueltig: r.zeilen_gueltig,
    zeilenFehlerhaft: r.zeilen_fehlerhaft,
    bemerkung: r.bemerkung,
    geprueftAm: r.geprueft_am,
    uebernommenAm: r.uebernommen_am,
    verworfenAm: r.verworfen_am,
    erstelltAm: r.erstellt_am,
  }));
}

export interface AltsystemStand {
  readonly schluessel: Altsystem;
  readonly name: string;
  readonly umfang: string;
  readonly regel: string;
  readonly offen: string;
  readonly verbunden: boolean;
  readonly laeufe: number;
}

/**
 * Der Zustand je Altsystem — aus dem PORT, nicht aus einer zweiten Liste.
 *
 * `verbunden` kommt von `migrationPort(...)`, also von derselben Stelle, die
 * eine Datei annehmen wuerde. Eine handgepflegte Liste daneben verpasste den
 * Tag, an dem ein Parser dazukommt — und zeigte dann „nicht verbunden" fuer
 * eine funktionierende Uebernahme oder, schlimmer, umgekehrt.
 */
export function altsystemStand(
  laeufe: readonly LaufZeile[],
): readonly AltsystemStand[] {
  return ALTSYSTEM_TEXT.map((a) => ({
    schluessel: a.schluessel,
    name: a.name,
    umfang: a.umfang,
    regel: a.regel,
    offen: a.offen,
    verbunden: migrationPort(a.schluessel).verbunden,
    laeufe: laeufe.filter((l) => l.quelle === a.schluessel).length,
  }));
}
