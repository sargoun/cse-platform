import type { SchreibKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';

/**
 * Eine Arbeitszeit NACHERFASSEN — ohne dass ein Gerät vorher etwas behauptet
 * hat (V-066, V-067, TIM-09, TIM-11, EMP-07).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: zwei Stellen verlangten es, keine konnte es.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `uebernimmAnspruch` (offline.ts) macht aus einem **`offline_ereignis`** einen
 * Zeiteintrag — aus der Behauptung eines Telefons, das ohne Netz war. Das ist
 * der einzige Weg, auf dem in dieser Plattform ein Zeiteintrag nachträglich
 * entstand. Zwei Stellen verlangen aber genau das Gegenteil:
 *
 *  1. Die Wächtermeldung `dienstplan.schicht_ohne_zeiteintrag` sagt wörtlich
 *     „Entweder nacherfassen … oder die Zuordnung richtigstellen" — bei einer
 *     Schicht, zu der es gar kein Gerätereignis gibt, weil niemand gestempelt
 *     hat.
 *  2. Ein anerkannter Einwand der Art `eintrag_fehlt` (§6.27) sagt: der
 *     Eintrag fehlt ganz. Die Planung erkennt ihn an — und hatte danach
 *     keinen Weg, den fehlenden Eintrag anzulegen (V-067). Eine anerkannte
 *     Meldung ohne Folge ist schlimmer als eine abgelehnte: sie sieht aus wie
 *     erledigt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier entsteht, ist eine BEHAUPTUNG der Verwaltung** (Invariante 5).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kein Stempel, keine Serveruhr — ein Mensch trägt ein, was ein anderer
 * gearbeitet hat. Die Zeile sagt das über vier Spalten, und das Schema
 * erzwingt es:
 *
 *   `erfassungsart_* = 'nacherfassung'` · `quelle_* = 'planer_entscheidung'`
 *   `nacherfasst = true`                · `behauptet_* = <dieselben Zeiten>`
 *
 * `z_quelle_beginn_belegt` verlangt `nacherfasst`, sobald die Quelle
 * `planer_entscheidung` ist; `z_anspruch_je_ereignis` verlangt dann eine
 * Behauptung. Eine nacherfasste Zeit ist damit jederzeit von einer
 * gestempelten unterscheidbar — und genau das ist ihr Wert im Lohnstreit.
 *
 * **Zwei Rechte, und beide sind schon da.** `zeit.nacherfassung_pruefen` ist
 * die ENTSCHEIDUNG (TIM-09, dasselbe Recht wie die Seite, auf der dieser Weg
 * steht); `zeit.schreiben` ist der SCHREIBZUGRIFF, den die Policy `t_mandant`
 * ohnehin verlangt. Ein drittes zu erfinden hiesse, eine Rolle zu erfinden.
 *
 * **Wer für sich selbst nacherfasst, wird abgewiesen** (EMP-07). Dieselbe
 * Regel wie bei der Korrektur (`zk_nicht_selbst`) und bei der
 * Einwandentscheidung: was die betroffene Person selbst schreibt, ist ihre
 * Behauptung und keine Aufzeichnung mehr. Hier steht sie als Prüfung im
 * Dienst, weil es für einen NEUEN Eintrag keinen Auslöser gibt, der sie
 * hielte — es gibt ja noch keine Korrekturzeile.
 */

export class NacherfassungFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'NacherfassungFehler';
  }
}

/** Dieselbe Mindestlänge wie bei der Einwandentscheidung und beim Abschluss. */
export const BEGRUENDUNG_MINDESTLAENGE = 10;

export interface NachzuerfassendeZeit {
  readonly anstellungId: string;
  /** UTC-Instants — die Umrechnung aus der Berliner Wanduhrzeit liegt davor. */
  readonly beginn: Date;
  readonly ende: Date | null;
  readonly pauseMinuten?: number | undefined;
  readonly objektId?: string | undefined;
  readonly einsatzZuordnungId?: string | undefined;
  readonly begruendung: string;
  /** Der anerkannte Einwand, auf den das hier antwortet (V-067). */
  readonly zeitEinwandId?: string | undefined;
  readonly benutzerId: string;
}

export async function erfasseZeitNach(
  kontext: SchreibKontext, eingabe: NachzuerfassendeZeit,
): Promise<{ readonly id: string }> {
  if (eingabe.begruendung.trim().length < BEGRUENDUNG_MINDESTLAENGE) {
    throw new NacherfassungFehler(
      'Eine nacherfasste Arbeitszeit braucht eine Begründung. Im Lohnstreit steht '
      + 'sonst da, dass jemand eine Zahl eingetragen hat.',
      'begruendung_zu_kurz');
  }
  if (eingabe.ende !== null && eingabe.ende.getTime() <= eingabe.beginn.getTime()) {
    throw new NacherfassungFehler(
      'Das Ende liegt vor dem Beginn oder auf ihm. Eine Nachtschicht endet am '
      + 'Folgetag — dann gehört der nächste Tag in das Feld.',
      'fenster_ungueltig');
  }
  if (eingabe.pauseMinuten !== undefined
    && (!Number.isInteger(eingabe.pauseMinuten) || eingabe.pauseMinuten < 0)) {
    throw new NacherfassungFehler(
      'Die Pause ist eine ganze Zahl von Minuten, mindestens null.', 'pause_ungueltig');
  }

  const rechte = await rechteImKontext(kontext, 'zeit.nacherfassung_pruefen');
  if (rechte['zeit.nacherfassung_pruefen'] !== true) {
    throw new NacherfassungFehler(
      'Eine Arbeitszeit nachträglich einzutragen ist eine Entscheidung über die '
      + 'Zeit eines anderen Menschen und verlangt das Recht '
      + 'zeit.nacherfassung_pruefen (TIM-09).',
      'kein_nacherfassungsrecht', 403);
  }

  /*
   * **Die Serveruhr sagt, was Zukunft ist** (Invariante 5, R-11) — nicht
   * `Date.now()` des Anwendungsprozesses. Dieselbe Uhr, die stempelt,
   * beurteilt auch die nachgetragene Zeit.
   */
  const [jetzt] = await kontext.abfrage<{ jetzt: Date }>(`select now() as jetzt`);
  const grenze = jetzt?.jetzt.getTime() ?? 0;
  if (grenze > 0 && eingabe.beginn.getTime() > grenze) {
    throw new NacherfassungFehler(
      'Der Beginn liegt in der Zukunft. Nacherfasst wird, was gearbeitet wurde.',
      'beginn_in_zukunft');
  }

  /*
   * **EMP-07: nicht fuer sich selbst.** Eine Aufzeichnung, die die betroffene
   * Person selbst geschrieben hat, ist ihre Behauptung — und im Streit nichts
   * wert. `zk_nicht_selbst` haelt das bei der KORREKTUR; fuer einen neuen
   * Eintrag gibt es keinen Ausloeser, der es hielte, weil es noch keine
   * Korrekturzeile gibt.
   */
  const [selbst] = await kontext.abfrage<{ eigener: boolean }>(
    `select exists (
              select 1 from anstellung a
               where a.id = $1::uuid
                 and a.person_id = (select b.person_id from benutzer b where b.id = $2::uuid)
            ) as eigener`,
    [eingabe.anstellungId, eingabe.benutzerId],
  );
  if (selbst?.eigener === true) {
    throw new NacherfassungFehler(
      'Das ist Ihre eigene Arbeitszeit. Niemand erfasst die eigene Aufzeichnung nach '
      + '(EMP-07): Sie melden eine Abweichung, eine andere Person entscheidet darüber.',
      'nicht_selbst', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id,
        einsatz_zuordnung_id, einsatz_id, objekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        behauptet_beginn, behauptet_ende, nacherfasst, notiz, status,
        erstellt_von_art, erstellt_von)
     select app.aktiver_mandant(), a.id, a.person_id,
            z.id,
            z.einsatz_id,
            coalesce($5::uuid, e.objekt_id),
            $2::timestamptz, $3::timestamptz, coalesce($6::int, 0),
            'nacherfassung',
            case when $3::timestamptz is null then null else 'nacherfassung' end::erfassungs_art,
            'planer_entscheidung',
            case when $3::timestamptz is null then null
                 else 'planer_entscheidung' end::zeitquelle,
            $2::timestamptz, $3::timestamptz, true, $7,
            case when $3::timestamptz is null then 'laufend'
                 else 'abgeschlossen' end::zeiteintrag_status,
            'mensch', $8::uuid
       from anstellung a
       left join einsatz_zuordnung z on z.id = $4::uuid and z.entfernt_am is null
       left join einsatz e on e.id = z.einsatz_id
      where a.id = $1::uuid
     returning id`,
    [eingabe.anstellungId, eingabe.beginn.toISOString(), eingabe.ende?.toISOString() ?? null,
      eingabe.einsatzZuordnungId ?? null, eingabe.objektId ?? null,
      eingabe.pauseMinuten ?? null, eingabe.begruendung.trim(), eingabe.benutzerId],
  );
  const neu = zeilen[0];
  if (neu === undefined) {
    throw new NacherfassungFehler(
      'Diese Beschäftigung gibt es in dieser Gesellschaft nicht, oder es fehlt '
      + 'zeit.schreiben.', 'nicht_angelegt', 404);
  }

  /*
   * **Der Einwand bekommt seine Antwort** (V-067). `zeit_einwand.
   * korrektur_bewegung_id` ist fuer Kontobewegungen; der Bezug auf den neuen
   * EINTRAG gehoert in die Entscheidungsbegruendung, wo ihn der Mensch liest.
   * Eine eigene Spalte dafuer zu erfinden waere eine zweite Fassung von
   * `zeiteintrag_korrektur.zeit_einwand_id` — und die gilt fuer Korrekturen
   * an einem BESTEHENDEN Eintrag, den es hier gerade nicht gab.
   */
  if (eingabe.zeitEinwandId !== undefined && eingabe.zeitEinwandId !== '') {
    await kontext.schreibe(
      `update zeit_einwand
          set entscheidung_begruendung =
                coalesce(entscheidung_begruendung || ' ', '')
                || 'Nacherfasst als Zeiteintrag ' || $2::text || '.'
        where id = $1::uuid and entschieden_am is not null`,
      [eingabe.zeitEinwandId, neu.id],
    );
  }

  return neu;
}
