/**
 * Die Nachweislage EINES MENSCHEN, wie eine Planerin sie sieht (SEC-02,
 * SEC-03, EMP-08, K-05, D-09).
 *
 * **Warum das ein eigener Dienst ist und keine Abfrage in der Seite.**
 * D-09 §6 verlangt zweierlei zugleich, und die beiden ziehen gegeneinander:
 * eine Planerin in der Reinigung MUSS den §34a-Nachweis eines auch bei der
 * Security beschaeftigten Menschen sehen — sonst plant sie gegen nichts —, und
 * sie darf dabei KEINE Entgeltdaten der anderen Gesellschaft sehen. Wer beides
 * in einer Seite zusammenbaut, joint frueher oder spaeter `anstellung` dazu,
 * „nur fuer die Personalnummer", und traegt den Stundensatz mit hinaus.
 *
 * Dieser Dienst beruehrt `anstellung` deshalb **gar nicht**. Er liest den
 * Personenkopf: `nachweis`, `qualifikation`, `bewacher_eintrag`. Es gibt in
 * seinem Ergebnis kein Feld, das ein Entgelt tragen koennte — nicht weil
 * jemand daran denkt, sondern weil die Feldliste unten festgeschrieben ist und
 * ein Test sie Feld fuer Feld prueft.
 *
 * Die zweite Verteidigungslinie steht ohnehin schon: `stundensatz_intern` und
 * `tarifgruppe` sind fuer `cse_app` gar nicht erst gegrantet (K-05,
 * Spaltenprivilegien statt maskierender Sichten). Diese Datei ist die erste.
 */
import { decktStichtag, type NachweisStatus } from './gueltigkeit.js';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Ein Nachweis, wie ihn die Nachweisliste zeigt. */
export interface NachweisZeile {
  readonly nachweisId: string;
  readonly qualifikationId: string;
  readonly qualifikationSchluessel: string;
  readonly bezeichnung: string;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  readonly status: NachweisStatus;
  /** Sperrt ein abgelaufener Nachweis die Zuweisung hart (SEC-04)? */
  readonly blockiertEinsatz: boolean;
  /** Deckt er den geprueften Tag — zum STICHTAG, nicht zu `now()`. */
  readonly gueltigAmStichtag: boolean;
}

/**
 * Die Registerlage (SEC-03).
 *
 * `verbindung` steht hier, damit die Oberflaeche es sagen MUSS: es gibt keine
 * Schnittstelle zum Bewacherregister, der Status ist handerfasst. Ohne dieses
 * Feld zeigte ein Bildschirm „registriert" und liesse offen, ob das jemand
 * abgefragt oder jemand abgetippt hat (CLAUDE.md, „No fake integrations").
 */
export interface Bewacherlage {
  readonly vorhanden: boolean;
  readonly bewacherId: string | null;
  readonly status: string | null;
  readonly gueltigBis: string | null;
  readonly gueltigAmStichtag: boolean;
  readonly quelle: 'manuell';
  readonly verbindung: 'nicht_verbunden';
}

export interface Nachweislage {
  readonly personId: string;
  readonly stichtag: string;
  readonly nachweise: readonly NachweisZeile[];
  readonly bewacher: Bewacherlage;
}

/**
 * Die FESTGESCHRIEBENEN Feldlisten.
 *
 * Sie stehen hier, damit der Test aus PR 31 Abnahmekriterium (4) die Gestalt
 * des Ergebnisses Feld fuer Feld pruefen kann statt stichprobenartig nach
 * `stundensatz` zu suchen. Eine Stichprobe faende ein Feld namens `satz`, ein
 * Feld namens `kondition` oder ein durchgereichtes `anstellung`-Objekt nicht.
 */
export const NACHWEISLAGE_FELDER = [
  'personId', 'stichtag', 'nachweise', 'bewacher',
] as const;

export const NACHWEIS_ZEILE_FELDER = [
  'nachweisId', 'qualifikationId', 'qualifikationSchluessel', 'bezeichnung',
  'gueltigAb', 'gueltigBis', 'status', 'blockiertEinsatz', 'gueltigAmStichtag',
] as const;

export const BEWACHERLAGE_FELDER = [
  'vorhanden', 'bewacherId', 'status', 'gueltigBis', 'gueltigAmStichtag',
  'quelle', 'verbindung',
] as const;

interface NachweisRoh {
  id: string;
  qualifikation_id: string;
  schluessel: string;
  bezeichnung: string;
  gueltig_ab: string;
  gueltig_bis: string | null;
  status: NachweisStatus;
  blockiert_einsatz: boolean;
  widerrufen_am: string | null;
}

interface BewacherRoh {
  bewacher_id: string;
  status: string;
  gueltig_bis: string | null;
}

/** `date`-Spalten kommen je nach Treiber als `Date` oder als Zeichenkette. */
const alsTag = (wert: unknown): string | null => {
  if (wert === null || wert === undefined) return null;
  if (wert instanceof Date) return wert.toISOString().slice(0, 10);
  return String(wert).slice(0, 10);
};

/**
 * Die Nachweislage zum genannten Stichtag.
 *
 * `stichtag` ist ein Pflichtargument und kein Vorgabewert „heute": derselbe
 * Aufruf beantwortet „darf ich naechsten Dienstag einteilen" und „war der
 * Einsatz vom 3. Maerz gedeckt", und ein Vorgabewert machte aus der zweiten
 * Frage stillschweigend die erste.
 */
export async function nachweislage(
  db: Abfrage, personId: string, stichtag: string,
): Promise<Nachweislage> {
  const nachweise = (await db.unsafe(
    `select n.id, n.qualifikation_id, q.schluessel, q.bezeichnung,
            n.gueltig_ab, n.gueltig_bis, n.status, q.blockiert_einsatz,
            n.widerrufen_am
       from nachweis n
       join qualifikation q on q.id = n.qualifikation_id
      where n.person_id = $1
        and n.widerrufen_am is null
      order by q.schluessel`,
    [personId],
  )) as readonly NachweisRoh[];

  const register = (await db.unsafe(
    `select b.bewacher_id, b.status::text as status, b.gueltig_bis
       from bewacher_eintrag b
      where b.person_id = $1 and b.erloschen_am is null`,
    [personId],
  )) as readonly BewacherRoh[];

  const eintrag = register[0];
  const registerGueltigBis = eintrag === undefined ? null : alsTag(eintrag.gueltig_bis);

  return {
    personId,
    stichtag,
    nachweise: nachweise.map((n) => {
      const gueltigAb = alsTag(n.gueltig_ab) ?? '';
      const gueltigBis = alsTag(n.gueltig_bis);
      return {
        nachweisId: n.id,
        qualifikationId: n.qualifikation_id,
        qualifikationSchluessel: n.schluessel,
        bezeichnung: n.bezeichnung,
        gueltigAb,
        gueltigBis,
        status: n.status,
        blockiertEinsatz: n.blockiert_einsatz,
        gueltigAmStichtag: decktStichtag(
          {
            qualifikationId: n.qualifikation_id,
            gueltigAb,
            gueltigBis,
            status: n.status,
            widerrufenAm: n.widerrufen_am,
          },
          stichtag,
        ),
      };
    }),
    bewacher: {
      vorhanden: eintrag !== undefined,
      bewacherId: eintrag?.bewacher_id ?? null,
      status: eintrag?.status ?? null,
      gueltigBis: registerGueltigBis,
      // Dieselbe Bedingung, die das Tor in SQL traegt: nur `registriert` gilt
      // als einsetzbar, und die Gueltigkeit wird gegen den STICHTAG geprueft.
      gueltigAmStichtag:
        eintrag !== undefined
        && eintrag.status === 'registriert'
        && (registerGueltigBis === null || registerGueltigBis >= stichtag),
      quelle: 'manuell',
      verbindung: 'nicht_verbunden',
    },
  };
}
