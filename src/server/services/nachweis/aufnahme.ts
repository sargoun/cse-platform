import 'server-only';

/**
 * **Einen Qualifikationsnachweis aufnehmen, bestätigen, widerrufen**
 * (V-010, SEC-02, SEC-03, EMP-08, DOC-01, § 34a GewO).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0030` baut das Register vollständig: Qualifikationen, Nachweise, drei
 * Warnstufen, das Quittungsbuch, die Dokumentpflicht als Auslöser, der
 * nächtliche Statuslauf `gueltig → abgelaufen`. Zwei Seiten lesen es, ein
 * Nachtlauf warnt, das Einsatztor sperrt.
 *
 * **Und aufnehmen konnte es niemand.** Die Sachkundeprüfung nach § 34a GewO,
 * das Führungszeugnis, der Erste-Hilfe-Kurs — ohne sie darf keine Wache auf
 * einen Posten, und eingetragen wurden sie bisher allein vom Seed. Das
 * Register konnte warnen und sperren; die Zeile, vor der es warnt, entstand
 * nirgends.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Nachweis hängt am MENSCHEN, nicht an der Beschäftigung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `nachweis.person_id` und keine Spalte je Anstellung (Invariante 9, D-09).
 * Eine Sachkunde gilt der Person; wer in zwei Gesellschaften beschäftigt ist,
 * hat sie einmal. `erfasst_von_mandant_id` trägt die VERANTWORTLICHKEIT für
 * die Erfassung — wer eingetragen hat, nicht wer sie sehen darf.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class NachweisFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'unvollstaendig' | 'nicht_gefunden' | 'abgewiesen'
      | 'dokument_fehlt' | 'schon_vorhanden' | 'grund_fehlt' | 'zeitraum',
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'NachweisFehler';
  }
}

export interface NachweisAufnehmen {
  readonly personId: string;
  readonly qualifikationId: string;
  readonly gueltigAb: string;
  /**
   * Leer erlaubt: dann rechnet die Aufnahme sie aus der
   * **Standardgültigkeit der Qualifikation** (`standard_gueltigkeit_monate`).
   *
   * **Das ist keine erfundene Frist**, sondern genau der Zweck jener Spalte —
   * und sie steht im Formular daneben, damit der Mensch sieht, was entsteht.
   * Läuft die Qualifikation nicht ab, bleibt das Feld NULL, und das heisst
   * „unbefristet" und nicht „vergessen".
   */
  readonly gueltigBis?: string | null;
  readonly nummer?: string | null;
  readonly ausstellendeStelle?: string | null;
  readonly ausgestelltAm?: string | null;
  readonly dokumentId?: string | null;
}

interface QualiRoh {
  readonly id: string;
  readonly bezeichnung: string;
  readonly laeuft_ab: boolean;
  readonly standard_gueltigkeit_monate: number | null;
  readonly erfordert_dokument: boolean;
}

/**
 * Das Ende der Gültigkeit, wenn niemand eines genannt hat.
 *
 * Getrennt und exportiert, damit die Rechnung ohne Datenbank prüfbar ist:
 * ein Datum, das eine Wache vom Posten nimmt, gehört unter eine Kernprüfung.
 *
 * **Kalendermonate, kein Tagezählen.** „Zwei Jahre ab dem 29. Februar" endet
 * am 28. Februar; `date + interval` in Postgres kann das, `Date` in
 * JavaScript mit `TZ=UTC` verschiebt den Tag. Gerechnet wird deshalb in SQL —
 * diese Funktion sagt nur, OB gerechnet wird.
 */
export function brauchtFrist(q: {
  readonly laeuft_ab: boolean;
  readonly standard_gueltigkeit_monate: number | null;
}, genannt: string | null | undefined): boolean {
  if (genannt !== null && genannt !== undefined && genannt !== '') return false;
  return q.laeuft_ab && q.standard_gueltigkeit_monate !== null;
}

export async function nimmNachweisAuf(
  db: Abfrage, e: NachweisAufnehmen,
): Promise<string> {
  if (e.gueltigAb.trim() === '') {
    throw new NachweisFehler(
      'Ohne Beginn der Gültigkeit entsteht kein Nachweis.', 'unvollstaendig');
  }

  const [q] = await db.abfrage<QualiRoh>(
    `select id, bezeichnung, laeuft_ab, standard_gueltigkeit_monate, erfordert_dokument
       from qualifikation
      where id = $1::uuid and archiviert_am is null`,
    [e.qualifikationId]);
  if (q === undefined) {
    throw new NachweisFehler(
      'Diese Qualifikation gibt es nicht oder sie ist archiviert.', 'unvollstaendig');
  }

  /*
   * **Die Dokumentpflicht wird hier noch einmal gefragt** (DOC-01). Der
   * Auslöser `a_nachweis_dokumentpflicht` hält sie ohnehin — er meldet aber
   * „DOC-01: … verlangt ein hinterlegtes Dokument". Wer am Formular steht,
   * braucht einen Satz mit dem NAMEN der Qualifikation darin und keinen
   * Auslösertext.
   */
  if (q.erfordert_dokument && (e.dokumentId ?? null) === null) {
    throw new NachweisFehler(
      `„${q.bezeichnung}" wird nur mit hinterlegtem Dokument gültig (DOC-01). `
      + 'Laden Sie die Urkunde als Dokument hoch und wählen Sie sie hier aus.',
      'dokument_fehlt');
  }

  const rechneFrist = brauchtFrist(q, e.gueltigBis);

  try {
    const [zeile] = await db.abfrage<{ id: string }>(
      `insert into nachweis
         (person_id, qualifikation_id, nummer, ausstellende_stelle, ausgestellt_am,
          gueltig_ab, gueltig_bis, dokument_id, erfasst_von_mandant_id, erstellt_von)
       values ($1::uuid, $2::uuid, $3, $4, $5::date,
               $6::date,
               case when $9 then ($6::date + make_interval(months => $8::int))
                    else $7::date end,
               $10::uuid, app.aktiver_mandant(), app.aktueller_benutzer())
       returning id`,
      [e.personId, e.qualifikationId, e.nummer ?? null, e.ausstellendeStelle ?? null,
        e.ausgestelltAm ?? null, e.gueltigAb, e.gueltigBis ?? null,
        q.standard_gueltigkeit_monate ?? 0, rechneFrist, e.dokumentId ?? null]);
    if (zeile === undefined) {
      throw new NachweisFehler(
        'Der Nachweis wurde nicht aufgenommen — fehlt `personal.nachweis_verwalten` '
        + 'in dieser Gesellschaft, oder gehört der Mensch nicht zu ihr?', 'abgewiesen');
    }
    return zeile.id;
  } catch (fehler: unknown) {
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    if (text.includes('nachweis_aktiv_uk')) {
      throw new NachweisFehler(
        'Für diesen Menschen, diese Qualifikation und dieses Startdatum gibt es '
        + 'schon einen Nachweis. Widerrufen Sie den alten, statt einen zweiten '
        + 'danebenzustellen.', 'schon_vorhanden', 409);
    }
    if (text.includes('nachweis_zeitraum')) {
      throw new NachweisFehler(
        'Das Ende der Gültigkeit liegt vor ihrem Beginn.', 'zeitraum');
    }
    if (text.includes('DOC-01')) {
      throw new NachweisFehler(
        `„${q.bezeichnung}" wird nur mit hinterlegtem Dokument gültig (DOC-01).`,
        'dokument_fehlt');
    }
    throw fehler;
  }
}

/**
 * Bestätigen — ein Mensch hat die Urkunde gesehen.
 *
 * **`geprueft_von` setzt die Datenbank aus der Sitzung**, nicht das Formular:
 * ein Name, den jemand über sich selbst einträgt, ist keine Bestätigung
 * (dieselbe Regel wie beim Modellregister, V-120).
 *
 * Bedingt geschrieben (K-09): ein zweites Mal trifft null Zeilen, und das ist
 * eine Antwort — „war schon" — und kein zweiter Vorgang.
 */
export async function bestaetigeNachweis(db: Abfrage, id: string): Promise<void> {
  const zeilen = await db.abfrage<{ id: string }>(
    `update nachweis
        set geprueft_von = app.aktueller_benutzer(), geprueft_am = now(),
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and geprueft_am is null and widerrufen_am is null
      returning id`, [id]);
  if (zeilen.length === 0) {
    throw new NachweisFehler(
      'Dieser Nachweis ist nicht erreichbar, schon bestätigt oder widerrufen.',
      'nicht_gefunden', 409);
  }
}

/**
 * Widerrufen — mit Grund, nie durch Löschen (Invariante 8).
 *
 * Der CHECK `nachweis_widerruf_begruendet` hält es ohnehin; hier steht es
 * trotzdem, weil „btrim(coalesce(widerruf_grund,'')) <> ''" kein Satz ist,
 * den man einem Menschen zeigt.
 */
export async function widerrufeNachweis(
  db: Abfrage, id: string, grund: string,
): Promise<void> {
  if (grund.trim().length < 3) {
    throw new NachweisFehler(
      'Ein Widerruf ohne Grund ist keine Auskunft — mindestens drei Zeichen. '
      + 'Er steht später in der Akte und beantwortet die Frage, warum diese '
      + 'Wache nicht mehr eingeteilt werden darf.', 'grund_fehlt');
  }
  const zeilen = await db.abfrage<{ id: string }>(
    `update nachweis
        set widerrufen_am = now(), widerruf_grund = $2,
            status = 'widerrufen'::nachweis_status,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and widerrufen_am is null
      returning id`, [id, grund.trim()]);
  if (zeilen.length === 0) {
    throw new NachweisFehler(
      'Dieser Nachweis ist nicht erreichbar oder schon widerrufen.',
      'nicht_gefunden', 409);
  }
}
