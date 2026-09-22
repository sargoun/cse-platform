import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Eine Veranstaltung anlegen, ändern und archivieren (V-004, SEC-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der dritte Einsatz-Ursprung war tot.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `einsatz_quelle` kennt `turnus`, `posten`, `veranstaltung`, `sonderleistung`,
 * `projekt` und `manuell`. Eine `veranstaltung` entstand ausschliesslich im
 * Seed — damit war das ganze Veranstaltungsgeschäft der Sicherheit
 * (`/veranstaltungen`, `/[id]`, `/[id]/besetzung`, die Eventschicht, die
 * Nachweislage je eingeteilter Person) für ein neues Event unerreichbar.
 *
 * **Diese Datei liegt NEBEN `veranstaltung.ts` und nicht darin.** Jene ist im
 * Dienstregister als `schreibend: false` geführt und liest das Einzelblatt;
 * eine Schreibfunktion darin machte die Registerzeile still falsch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier NICHT entschieden wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * // TODO(client, O-703): Woher entsteht ein Veranstaltungsauftrag — aus einer Auftragsleistung, aus dem Vertrieb oder handerfasst von der Wachleitung, und wer darf ihn anlegen?
 *
 * Solange das offen ist, baut diese Funktion den Weg, der am wenigsten
 * erfindet: **handerfasst, mit optionaler Verbindung zu einer
 * Auftragsleistung.** Die Spalte `auftrag_leistung_id` ist `null`-fähig und
 * bleibt es; wer die Position kennt, wählt sie, wer nicht, lässt sie leer.
 * Ein Pflichtfeld daraus zu machen hiesse zu entscheiden, dass ein Event
 * ohne kaufmännische Position nicht bewacht werden darf — eine Regel, die in
 * keinem Dokument steht und die kurzfristige Aufträge verhindern würde,
 * also genau den Fall, für den SEC-08 gebaut ist.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Ort ist ein Objekt ODER ein Text — nie keines von beiden.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `veranstaltung_ort_genannt` verlangt genau das. Der Grund steht im Gewerbe
 * selbst: ein Straßenfest, ein Messestand, ein Firmenjubiläum in einem
 * gemieteten Saal — keiner dieser Orte ist ein `objekt` dieser Gesellschaft,
 * und jedes davon braucht trotzdem eine Wache, die weiss, wohin sie fährt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Beginn und Ende sind Berliner Wanduhrzeiten, gespeichert als Instant.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Invariante 2: die Spalten sind `timestamptz`, der Mensch tippt aber die
 * Uhrzeit, die auf seiner Wand steht. Die Umrechnung macht Postgres mit
 * `at time zone 'Europe/Berlin'` — dieselbe Bauart wie
 * `services/crm/wiedervorlage.ts`. Sie hier in JavaScript zu rechnen wäre
 * eine zweite Fassung derselben Regel, und die zweite erführe nie, wenn
 * Deutschland die Sommerzeit abschafft.
 */

export class VeranstaltungFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'VeranstaltungFehler';
  }
}

export interface NeueVeranstaltung {
  readonly kundeId: string;
  readonly bezeichnung: string;
  /** Berliner Wanduhrzeit als `YYYY-MM-DDTHH:MM` — nie eine UTC-Zeichenkette. */
  readonly beginn: string;
  readonly ende: string;
  readonly objektId?: string | undefined;
  readonly ortText?: string | undefined;
  readonly anlass?: string | undefined;
  readonly erwarteteBesucher?: string | undefined;
  readonly sollBesetzung?: string | undefined;
  readonly leitungAnstellungId?: string | undefined;
  readonly auftragLeistungId?: string | undefined;
  readonly dienstanweisungId?: string | undefined;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

/**
 * `YYYY-MM-DDTHH:MM` — genau das, was `<input type="datetime-local">` sendet.
 *
 * Geprüft wird die FORM, nicht die Gültigkeit des Kalendertags: den 31.
 * Februar weist Postgres beim Wandeln ab, und zwar mit einer Meldung, die
 * dasselbe sagt. Was hier abgefangen wird, ist die leere oder verstümmelte
 * Eingabe — sie käme sonst als `invalid input syntax for type timestamp` an.
 */
function pruefeZeitpunkt(wert: string, feld: string): string {
  const t = wert.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/u.test(t)) {
    throw new VeranstaltungFehler(
      `${feld} ist eine Berliner Datums- und Uhrzeitangabe (z. B. 2026-12-31T20:00).`,
      'zeitpunkt_ungueltig');
  }
  return t;
}

function pruefeGanzzahl(
  wert: string | undefined, feld: string, kleinstes: number, groesstes: number,
): string | null {
  const t = leer(wert);
  if (t === null) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < kleinstes || n > groesstes) {
    throw new VeranstaltungFehler(
      `${feld} ist eine ganze Zahl von ${String(kleinstes)} bis ${String(groesstes)}.`,
      'zahl_ungueltig');
  }
  return String(n);
}

function pruefeOrt(objektId: string | null, ortText: string | null): void {
  if (objektId === null && ortText === null) {
    throw new VeranstaltungFehler(
      'Eine Veranstaltung braucht einen Ort: entweder ein Objekt dieser '
      + 'Gesellschaft oder eine Anschrift als Text. Ohne beides weiss die Wache '
      + 'nicht, wohin sie fährt.',
      'ort_fehlt');
  }
}

export async function legeVeranstaltungAn(
  kontext: SchreibKontext, eingabe: NeueVeranstaltung,
): Promise<{ readonly id: string }> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new VeranstaltungFehler(
      'Eine Veranstaltung braucht eine Bezeichnung.', 'bezeichnung_fehlt');
  }
  if (eingabe.kundeId.trim() === '') {
    throw new VeranstaltungFehler(
      'Eine Veranstaltung wird für einen Kunden bewacht — bitte den Kunden wählen.',
      'kunde_fehlt');
  }
  const objektId = leer(eingabe.objektId);
  const ortText = leer(eingabe.ortText);
  pruefeOrt(objektId, ortText);

  const beginn = pruefeZeitpunkt(eingabe.beginn, 'Der Beginn');
  const ende = pruefeZeitpunkt(eingabe.ende, 'Das Ende');
  /*
   * Die Reihenfolge wird HIER geprueft und nicht nur von
   * `veranstaltung_fenster`: die Zwangsbedingung faengt denselben Fall, sagt
   * aber „violates check constraint veranstaltung_fenster". Und sie prueft
   * INSTANTS — in der Nacht der Rueckstellung ist 02:30 vor 02:15 moeglich,
   * deshalb bleibt die Zwangsbedingung die zweite Linie und diese Pruefung
   * nur die freundliche erste.
   */
  if (ende <= beginn) {
    throw new VeranstaltungFehler(
      'Das Ende liegt vor dem Beginn oder auf ihm. Eine Veranstaltung über '
      + 'Mitternacht endet am Folgetag — dann gehört der nächste Tag ins Feld.',
      'fenster_ungueltig');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into veranstaltung
       (mandant_id, kunde_id, objekt_id, veranstaltungsort_text, bezeichnung, anlass,
        beginn, ende, erwartete_besucher, soll_besetzung,
        leitung_anstellung_id, auftrag_leistung_id, dienstanweisung_id,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, $4, $5,
             ($6::timestamp at time zone 'Europe/Berlin'),
             ($7::timestamp at time zone 'Europe/Berlin'),
             $8::int, coalesce($9::smallint, 1),
             $10::uuid, $11::uuid, $12::uuid,
             case when app.aktueller_benutzer() is null then 'system'
                  else 'mensch' end::akteur_art,
             app.aktueller_benutzer())
     returning id`,
    [eingabe.kundeId, objektId, ortText, bezeichnung, leer(eingabe.anlass),
      beginn, ende,
      pruefeGanzzahl(eingabe.erwarteteBesucher, 'Die erwartete Besucherzahl', 0, 10_000_000),
      pruefeGanzzahl(eingabe.sollBesetzung, 'Die Sollbesetzung', 1, 999),
      leer(eingabe.leitungAnstellungId), leer(eingabe.auftragLeistungId),
      leer(eingabe.dienstanweisungId)],
  );
  const z = zeilen[0];
  if (z === undefined) {
    throw new VeranstaltungFehler(
      'Die Veranstaltung wurde nicht angelegt — halten Sie security.schreiben in '
      + 'dieser Gesellschaft?', 'nicht_angelegt', 403);
  }
  return z;
}

export async function aendereVeranstaltung(
  kontext: SchreibKontext,
  eingabe: NeueVeranstaltung & { readonly id: string },
): Promise<void> {
  const bezeichnung = eingabe.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new VeranstaltungFehler(
      'Eine Veranstaltung braucht eine Bezeichnung.', 'bezeichnung_fehlt');
  }
  const objektId = leer(eingabe.objektId);
  const ortText = leer(eingabe.ortText);
  pruefeOrt(objektId, ortText);
  const beginn = pruefeZeitpunkt(eingabe.beginn, 'Der Beginn');
  const ende = pruefeZeitpunkt(eingabe.ende, 'Das Ende');
  if (ende <= beginn) {
    throw new VeranstaltungFehler(
      'Das Ende liegt vor dem Beginn oder auf ihm.', 'fenster_ungueltig');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update veranstaltung
        set bezeichnung = $2, anlass = $3,
            objekt_id = $4::uuid, veranstaltungsort_text = $5,
            beginn = ($6::timestamp at time zone 'Europe/Berlin'),
            ende = ($7::timestamp at time zone 'Europe/Berlin'),
            erwartete_besucher = $8::int,
            soll_besetzung = coalesce($9::smallint, soll_besetzung),
            leitung_anstellung_id = $10::uuid,
            auftrag_leistung_id = $11::uuid,
            dienstanweisung_id = $12::uuid,
            geaendert_von = app.aktueller_benutzer(),
            geaendert_von_art = case when app.aktueller_benutzer() is null
                                     then 'system' else 'mensch' end::akteur_art
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [eingabe.id, bezeichnung, leer(eingabe.anlass), objektId, ortText, beginn, ende,
      pruefeGanzzahl(eingabe.erwarteteBesucher, 'Die erwartete Besucherzahl', 0, 10_000_000),
      pruefeGanzzahl(eingabe.sollBesetzung, 'Die Sollbesetzung', 1, 999),
      leer(eingabe.leitungAnstellungId), leer(eingabe.auftragLeistungId),
      leer(eingabe.dienstanweisungId)],
  );
  if (zeilen[0] === undefined) {
    throw new VeranstaltungFehler(
      'Diese Veranstaltung gibt es in dieser Gesellschaft nicht, oder sie ist archiviert.',
      'veranstaltung_unbekannt', 404);
  }
}

/**
 * Eine Veranstaltung archivieren.
 *
 * **Eine Eventschicht in der Zukunft hält das auf.** Wer die Veranstaltung aus
 * der Liste nimmt, während für morgen Abend vier Leute eingeteilt sind, zieht
 * vier Menschen den Dienst unter den Füßen weg, ohne dass es jemand sieht.
 * Dieselbe Regel wie beim Objekt (V-001).
 *
 * Gelöscht wird nichts (Invariante 8): an einer Veranstaltung hängen
 * Einsätze, Zeiteinträge und Wachbucheinträge.
 */
export async function archiviereVeranstaltung(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const [offen] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from einsatz
      where veranstaltung_id = $1::uuid
        and status <> 'storniert'
        and ende_zeitpunkt >= now()`,
    [id],
  );
  if (offen !== undefined && offen.anzahl !== '0') {
    throw new VeranstaltungFehler(
      `Für diese Veranstaltung stehen noch ${offen.anzahl} Schicht(en) in der `
      + 'Zukunft. Erst die Einteilung auflösen, dann archivieren — sonst fährt '
      + 'jemand zu einem Termin, den es nicht mehr gibt.',
      'einsaetze_offen', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update veranstaltung
        set archiviert_am = now(), archiviert_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer(),
            geaendert_von_art = case when app.aktueller_benutzer() is null
                                     then 'system' else 'mensch' end::akteur_art
      where id = $1::uuid and archiviert_am is null
     returning id`,
    [id],
  );
  if (zeilen[0] === undefined) {
    throw new VeranstaltungFehler(
      'Diese Veranstaltung gibt es nicht mehr, oder sie ist bereits archiviert.',
      'veranstaltung_unbekannt', 404);
  }
}
