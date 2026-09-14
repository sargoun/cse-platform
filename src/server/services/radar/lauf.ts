import 'server-only';
import {
  REGEL_VERSION, bewerte,
  type BewertungsBekanntmachung, type BewertungsProfil, type KeywordWirkung, type Wirkung,
} from './bewertung.js';
import type { SchreibAbfrage } from './import.js';

/**
 * Der Bewertungslauf: jedes aktive Profil gegen jede Bekanntmachung im
 * Fenster (RAD-05).
 *
 * **Warum das ein Job ist und keine Seite.** Die Bewertung ist ein Kreuzprodukt
 * — vier Gesellschaften, mehrere Profile, ein paar hundert Bekanntmachungen.
 * Sie beim Seitenaufruf zu rechnen, hiesse: der erste Blick am Morgen dauert
 * Sekunden, und das Ergebnis wäre trotzdem nicht wiederholbar (die Frist läuft
 * ja weiter). Also einmal nachts, geschrieben, mit Hash.
 *
 * **Ein Duplikat wird nicht zweimal bewertet.** Eine Bekanntmachung, die als
 * Duplikat einer anderen bestätigt ist, fällt hier heraus — sonst stünde
 * dieselbe Vergabe zweimal in der Liste, zweimal in der Benachrichtigung und
 * zweimal im Bericht. Bestätigt heisst: ein Mensch hat es bestätigt (O-192).
 */

export interface LaufFenster {
  /** Nur Bekanntmachungen, die seit diesem Zeitpunkt gesehen wurden. */
  readonly seit: Date;
  /** Der Zeitpunkt, gegen den Fristen gerechnet werden — kommt herein, wird nie gelesen. */
  readonly jetzt: Date;
}

export interface LaufErgebnis {
  readonly profile: number;
  readonly bekanntmachungen: number;
  readonly bewertungen: number;
  readonly neueZeilen: number;
  readonly ausgeschlossen: number;
}

interface ProfilZeile {
  id: string;
  mandant_id: string;
  name: string;
  version: number;
  nuts_praefixe: string[] | null;
  positiv_keywords: string[] | null;
  negativ_keywords: string[] | null;
  negativ_wirkung: KeywordWirkung;
  wert_min_cent: string | null;
  wert_max_cent: string | null;
  waehrung: string;
  frist_min_tage: number | null;
  oberhalb_schwellenwert: boolean | null;
  skala_max: number;
  gewichtung: Record<string, number> | null;
}

interface CpvZeile {
  radar_profil_id: string;
  cpv_code: string;
  praefix_laenge: number;
  gewichtung: number;
  wirkung: Wirkung;
}

interface BekanntZeile {
  id: string;
  titel: string;
  beschreibung: string | null;
  cpv_haupt: string | null;
  cpv_weitere: string[] | null;
  nuts_codes: string[] | null;
  wert_geschaetzt_cent: string | null;
  waehrung: string | null;
  frist_angebot: Date | null;
  oberhalb_schwellenwert: boolean | null;
}

function alsBigint(roh: string | null): bigint | null {
  return roh === null ? null : BigInt(roh);
}

export async function bewerteLauf(
  db: SchreibAbfrage, fenster: LaufFenster,
): Promise<LaufErgebnis> {
  const profile = (await db.unsafe(
    `select p.id, p.mandant_id, p.name, p.version, p.nuts_praefixe, p.positiv_keywords,
            p.negativ_keywords, p.negativ_wirkung, p.wert_min_cent::text, p.wert_max_cent::text,
            p.waehrung, p.frist_min_tage, p.oberhalb_schwellenwert, p.skala_max, p.gewichtung
       from radar_profil p
      where p.ist_aktiv and p.geloescht_am is null
      order by p.mandant_id, p.name`)) as ProfilZeile[];
  if (profile.length === 0) {
    return { profile: 0, bekanntmachungen: 0, bewertungen: 0, neueZeilen: 0, ausgeschlossen: 0 };
  }

  const cpv = (await db.unsafe(
    `select radar_profil_id, cpv_code, praefix_laenge, gewichtung, wirkung
       from radar_profil_cpv order by radar_profil_id, cpv_code`)) as CpvZeile[];

  /**
   * Ein Duplikat zählt nur, wenn ein Mensch es bestätigt hat (O-192): der
   * Abgleich zwischen nationaler Quelle und TED ist eine Vermutung, bis
   * jemand sie prüft — und eine unbestätigte Vermutung darf keine echte
   * Bekanntmachung aus der Liste nehmen.
   */
  const bekannt = (await db.unsafe(
    `select a.id, a.titel, a.beschreibung, a.cpv_haupt, a.cpv_weitere,
            coalesce(array_agg(n.nuts_code) filter (where n.nuts_code is not null), '{}') as nuts_codes,
            a.wert_geschaetzt_cent::text, a.waehrung, a.frist_angebot, a.oberhalb_schwellenwert
       from ausschreibung a
       left join ausschreibung_nuts n on n.ausschreibung_id = a.id
      where a.quell_status = 'aktiv'
        and a.zuletzt_gesehen_am >= $1::timestamptz
        and (a.ist_duplikat_von is null or a.duplikat_bestaetigt_von is null)
      group by a.id
      order by a.id`, [fenster.seit])) as BekanntZeile[];

  let bewertungen = 0;
  let neueZeilen = 0;
  let ausgeschlossen = 0;

  for (const p of profile) {
    const profil: BewertungsProfil = {
      id: p.id, version: p.version, name: p.name,
      cpv: cpv.filter((c) => c.radar_profil_id === p.id).map((c) => ({
        cpvCode: c.cpv_code, praefixLaenge: c.praefix_laenge,
        gewichtung: c.gewichtung, wirkung: c.wirkung,
      })),
      nutsPraefixe: p.nuts_praefixe ?? [],
      positivKeywords: p.positiv_keywords ?? [],
      negativKeywords: p.negativ_keywords ?? [],
      negativWirkung: p.negativ_wirkung,
      wertMinCent: alsBigint(p.wert_min_cent),
      wertMaxCent: alsBigint(p.wert_max_cent),
      waehrung: p.waehrung,
      fristMinTage: p.frist_min_tage,
      oberhalbSchwellenwert: p.oberhalb_schwellenwert,
      skalaMax: p.skala_max,
      gewichtung: p.gewichtung ?? {},
    };

    for (const b of bekannt) {
      const eingabe: BewertungsBekanntmachung = {
        id: b.id, titel: b.titel, beschreibung: b.beschreibung,
        cpvHaupt: b.cpv_haupt, cpvWeitere: b.cpv_weitere ?? [],
        nutsCodes: b.nuts_codes ?? [],
        wertCent: alsBigint(b.wert_geschaetzt_cent),
        waehrung: b.waehrung,
        fristAngebot: b.frist_angebot,
        oberhalbSchwellenwert: b.oberhalb_schwellenwert,
      };
      /*
       * `performance.now()` und nicht `Date.now()`: gemessen wird eine DAUER,
       * und dafuer ist eine monotone Uhr das richtige Werkzeug — die Wanduhr
       * kann waehrend des Laufs springen (NTP, Sommerzeit) und ergaebe dann
       * negative Millisekunden. Der Zeitpunkt der Bewertung kommt weiterhin
       * ausschliesslich aus `fenster.jetzt` (Invariante 5).
       */
      const start = performance.now();
      const e = bewerte(eingabe, profil, fenster.jetzt);
      bewertungen += 1;
      if (e.ausgeschlossen) ausgeschlossen += 1;

      /*
       * `on conflict do nothing` ist hier die ganze Idempotenz: unveraenderte
       * Eingaben schreiben nichts, ein nachgeschaerftes Profil schreibt eine
       * neue Zeile, und die alte bleibt fuer die Nachvollziehbarkeit stehen.
       */
      const zeilen = (await db.unsafe(
        `insert into bewertung
           (mandant_id, ausschreibung_id, radar_profil_id, regel_version, profil_version,
            punkte, skala_max, ausgeschlossen, ausschluss_grund, wert_kriterium,
            aufschluesselung, begruendung, eingaben_hash, dauer_ms)
         values ($1::uuid, $2::uuid, $3::uuid, $4, $5::integer, $6::integer, $7::integer,
                 $8::boolean, $9, $10::wert_kriterium_status, $11::jsonb, $12, $13, $14::integer)
         on conflict (ausschreibung_id, radar_profil_id, regel_version, eingaben_hash) do nothing
         returning id`,
        [p.mandant_id, b.id, p.id, REGEL_VERSION, e.profilVersion, e.punkte, e.skalaMax,
          e.ausgeschlossen, e.ausschlussGrund, e.wertKriterium,
          /*
           * **Das Objekt, nicht sein JSON-Text** (D-467). `JSON.stringify` an
           * einem `::jsonb`-Parameter kodiert postgres.js ein ZWEITES Mal:
           * gespeichert stand dann eine JSON-Zeichenkette statt eines Feldes,
           * `jsonb_typeof` sagte „string", und die Detailseite fiel über
           * `aufschluesselung.map is not a function`. Der Browsertest hat es
           * gefunden; der Isolationstest hält es fest.
           */
          e.aufschluesselung, e.begruendung, e.eingabenHash,
          Math.round(performance.now() - start)])) as { id: string }[];
      neueZeilen += zeilen.length;
    }
  }

  return {
    profile: profile.length, bekanntmachungen: bekannt.length,
    bewertungen, neueZeilen, ausgeschlossen,
  };
}

/**
 * Die aktuelle Bewertung je Bekanntmachung und Profil — das, was die Liste
 * zeigt.
 *
 * Weil `bewertung` anhängend ist, liegen zu einer Bekanntmachung mehrere
 * Zeilen vor (eine je Profilfassung). Gefragt ist die jüngste; alles andere
 * ist Archiv.
 */
export const AKTUELLE_BEWERTUNG_SQL = `
  select distinct on (b.ausschreibung_id, b.radar_profil_id)
         b.*
    from bewertung b
   order by b.ausschreibung_id, b.radar_profil_id, b.berechnet_am desc`;
