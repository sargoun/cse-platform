import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import {
  AuftragsangabenFehler, pruefeAuftragsangaben, pruefeAuftragsbezug,
} from './angaben.js';

/**
 * **Ein Auftrag lässt sich nach der Anlage pflegen** (V-173, OPS-05, OPS-10).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das einzige `update auftrag` betraf Zustand, Abschluss und Kundenfreigabe.
 * Leitung, Laufzeit, Bezeichnung, Wert, Personalbedarf, Wochenstunden und
 * Ausstattung standen nach der Anlage fest — kein Tippfehler liess sich
 * korrigieren, und ein Auftrag aus dem Assistenten hatte für immer keinen
 * Wert, einer aus dem Angebot für immer keinen Personalbedarf.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier NICHT geändert wird, und warum.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  - **Nummer, Kunde, Art, Start, Objekt.** Die Nummer steht auf Rechnungen,
 *    der Kunde ist der Vertragspartner, Start und Objekt tragen Einsätze,
 *    Leistungsnachweise und Abrechnungszeiträume. Ein anderer Vertrags-
 *    partner oder Ort ist ein anderer Auftrag — nicht dieselbe Zeile mit
 *    geänderter Überschrift.
 *  - **Der Wert eines Auftrags AUS EINEM ANGEBOT.** Er ist `angebot.netto_cent`
 *    und wird nicht neu gerechnet (`wandleInAuftrag`); ihn hier zu
 *    überschreiben, wäre eine zweite Wahrheit über denselben Betrag. Eine
 *    Änderung des Vertragswerts ist ein Nachtrag. Ein von Hand angelegter
 *    Auftrag hat keine andere Quelle — dort ist diese Seite die Stelle.
 *  - **Ein abgeschlossener oder stornierter Auftrag.** Beide sind Endzustände
 *    (O-734, 0389); wer dort etwas ändern müsste, korrigiert über einen
 *    Nachtrag oder einen neuen Auftrag.
 *
 * **Jede Änderung steht mit Vorher und Nachher im Protokoll** — wie der
 * Zustandswechsel (`status.ts`).
 */

export type PflegeGrund =
  | 'nicht_gefunden' | 'gesperrt' | 'wert_aus_angebot' | 'bezeichnung_fehlt';

export class AuftragPflegeFehler extends Error {
  constructor(nachricht: string, readonly grund: PflegeGrund, readonly status = 409) {
    super(nachricht);
    this.name = 'AuftragPflegeFehler';
  }
}

export interface AuftragAenderung {
  readonly auftragId: string;
  readonly bezeichnung: string;
  readonly beschreibung?: string | null;
  readonly verantwortlichBenutzerId: string;
  /** `JJJJ-MM-TT` oder leer für unbefristet. */
  readonly laufzeitBis?: string | null;
  /** Deutsch geschrieben, z. B. „12.500,00"; leer räumt den Wert ab. */
  readonly auftragswertNetto?: string | null;
  readonly personalbedarfAnzahl?: string | null;
  readonly wochenstundenSoll?: string | null;
  readonly ausstattungHinweis?: string | null;
}

interface AuftragAlt {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly status: string;
  readonly angebot_id: string | null;
  readonly start_datum: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly verantwortlich_benutzer_id: string;
  readonly laufzeit_bis: string | null;
  readonly wert: string | null;
  readonly personalbedarf_anzahl: number | null;
  readonly wochenstunden_soll: string | null;
  readonly ausstattung_hinweis: string | null;
}

/** Die Zustände, in denen ein Auftrag nicht mehr gepflegt wird. */
export const PFLEGE_GESPERRT: readonly string[] = ['abgeschlossen', 'storniert'];

function leerZuNull(wert: string | null | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

export async function aendereAuftrag(
  kontext: SchreibKontext, eingabe: AuftragAenderung,
): Promise<readonly string[]> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new AuftragPflegeFehler('Ein Auftrag braucht eine Bezeichnung.',
      'bezeichnung_fehlt', 400);
  }
  const angaben = pruefeAuftragsangaben({
    personalbedarf: eingabe.personalbedarfAnzahl ?? null,
    wochenstunden: eingabe.wochenstundenSoll ?? null,
    wert: eingabe.auftragswertNetto ?? null,
  });
  if (!angaben.ok) throw new AuftragsangabenFehler(angaben.grund, angaben.felder);

  /**
   * **Erst sperren, dann vergleichen** — und die Sperre ist zugleich die
   * Rechteprüfung: `for update` wendet das `using` der UPDATE-Policy an. Eine
   * Sitzung mit `auftrag.lesen`, aber ohne `auftrag.schreiben`, bekommt null
   * Zeilen, die Gruppenansicht ebenso (Invariante 10).
   */
  const [alt] = await kontext.schreibe<AuftragAlt>(
    `select id, auftragsnummer, status::text as status, angebot_id::text as angebot_id,
            to_char(start_datum, 'YYYY-MM-DD') as start_datum,
            bezeichnung, beschreibung, verantwortlich_benutzer_id::text,
            to_char(laufzeit_bis, 'YYYY-MM-DD') as laufzeit_bis,
            auftragswert_netto_cent::text as wert, personalbedarf_anzahl,
            wochenstunden_soll::text as wochenstunden_soll, ausstattung_hinweis
       from auftrag
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null
      for update`,
    [eingabe.auftragId]);
  if (alt === undefined) {
    throw new AuftragPflegeFehler(
      'Diesen Auftrag gibt es nicht — oder diese Sitzung darf ihn nicht ändern.',
      'nicht_gefunden', 404);
  }
  if (PFLEGE_GESPERRT.includes(alt.status)) {
    throw new AuftragPflegeFehler(
      alt.status === 'abgeschlossen'
        ? 'Ein abgeschlossener Auftrag wird nicht mehr geändert (O-734).'
        : 'Ein stornierter Auftrag wird nicht mehr geändert.',
      'gesperrt');
  }

  /*
   * Die bisherige Leitung reist mit (V-177): hat sie die Gesellschaft
   * verlassen, bleibt jede andere Änderung möglich — geprüft wird die
   * Mitgliedschaft nur bei einem WECHSEL, wie im Auslöser (0025).
   */
  const bezug = await pruefeAuftragsbezug(kontext, {
    verantwortlichBenutzerId: eingabe.verantwortlichBenutzerId,
    startDatum: alt.start_datum,
    laufzeitBis: leerZuNull(eingabe.laufzeitBis),
    bisherigeLeitung: alt.verantwortlich_benutzer_id,
  });
  if (bezug !== null) throw new AuftragsangabenFehler(bezug);

  const wertNeu = angaben.werte.wertCent === null ? null : String(angaben.werte.wertCent);
  if (alt.angebot_id !== null && wertNeu !== alt.wert) {
    throw new AuftragPflegeFehler(
      'Der Wert dieses Auftrags kommt aus dem Angebot und wird hier nicht geändert — '
      + 'eine Änderung des Vertragswerts ist ein Nachtrag.',
      'wert_aus_angebot');
  }

  const neu = {
    bezeichnung,
    beschreibung: leerZuNull(eingabe.beschreibung),
    /* Kleingeschrieben wie `uuid::text` — sonst wäre dieselbe Leitung ein Unterschied. */
    verantwortlich_benutzer_id: eingabe.verantwortlichBenutzerId.trim().toLowerCase(),
    laufzeit_bis: leerZuNull(eingabe.laufzeitBis),
    wert: wertNeu,
    personalbedarf_anzahl: angaben.werte.personalbedarf,
    wochenstunden_soll: angaben.werte.wochenstunden,
    ausstattung_hinweis: leerZuNull(eingabe.ausstattungHinweis),
  };
  const vorher = {
    bezeichnung: alt.bezeichnung,
    beschreibung: alt.beschreibung,
    verantwortlich_benutzer_id: alt.verantwortlich_benutzer_id,
    laufzeit_bis: alt.laufzeit_bis,
    wert: alt.wert,
    personalbedarf_anzahl: alt.personalbedarf_anzahl,
    /* `numeric` kommt mit drei Stellen; der Vergleich braucht dieselbe Form. */
    wochenstunden_soll: alt.wochenstunden_soll,
    ausstattung_hinweis: alt.ausstattung_hinweis,
  };
  const geaendert = (Object.keys(neu) as (keyof typeof neu)[])
    .filter((k) => neu[k] !== vorher[k]);
  /*
   * Nichts geändert ist kein Fehler — wer „Speichern" drückt, ohne etwas zu
   * ändern, hat nichts falsch gemacht. Geschrieben und protokolliert wird
   * dann aber auch nichts: ein Protokolleintrag ohne Unterschied wäre Rauschen.
   */
  if (geaendert.length === 0) return [];

  await kontext.schreibe(
    `update auftrag
        set bezeichnung = $2, beschreibung = $3, verantwortlich_benutzer_id = $4::uuid,
            laufzeit_bis = $5::date, auftragswert_netto_cent = $6::bigint,
            personalbedarf_anzahl = $7, wochenstunden_soll = $8::numeric,
            ausstattung_hinweis = $9, geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [alt.id, neu.bezeichnung, neu.beschreibung, neu.verantwortlich_benutzer_id,
     neu.laufzeit_bis, neu.wert, neu.personalbedarf_anzahl, neu.wochenstunden_soll,
     neu.ausstattung_hinweis]);

  const nur = (quelle: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(geaendert.map((k) => [k, quelle[k]]));
  await kontext.schreibe(
    `select app.protokolliere('auftrag.geaendert', 'auftrag', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [alt.id, { nummer: alt.auftragsnummer, ...nur(vorher) },
     { nummer: alt.auftragsnummer, ...nur(neu) }]);
  return geaendert;
}
