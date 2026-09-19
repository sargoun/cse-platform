/**
 * **Art. 16 DSGVO — die Berichtigung, festgehalten je Feld** (LEG-09, Phase 7).
 *
 * Art. 16 ist zwei Rechte in einem Satz: die Berichtigung unrichtiger Daten
 * und — Satz 2 — die *Vervollständigung* unvollständiger. Und Art. 19 hängt
 * daran: wer die unrichtigen Daten bekommen hat, muss die Berichtigung
 * erfahren. Das ist die Pflicht, an der eine Freitextnotiz scheitert.
 *
 * **Dieser Dienst ändert fremde Tabellen NICHT.** Er hält fest, WAS berichtigt
 * wurde, von welchem Wert auf welchen und von wem. Die Änderung selbst
 * geschieht im zuständigen Editor — in der Personalakte, im CRM-Kontakt, in
 * der Bewerbung —, weil dort die Schreibrechte, die Prüfungen und die
 * Fachlogik sitzen. Ein zweiter Schreibweg „von der Datenschutzseite aus" wäre
 * ein Weg um jede dieser Prüfungen herum, und er würde beim ersten Umbau
 * falsch.
 *
 * **Warum es überhaupt eine eigene Tabelle gibt.** `betroffenenanfrage`
 * trägt genau eine Textspalte `entscheidung`. Aus „wir haben das korrigiert"
 * lässt sich nicht ableiten, welches Feld von welchem Wert auf welchen ging
 * und wem es vorher mitgeteilt wurde. Die Zusage der Seitenkarte — ein
 * Entscheidungsnachweis je Feld — wäre ohne `berichtigung_feld` (0221) Prosa.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { ZuordnungArt } from './anfrage.js';

export class BerichtigungFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'BerichtigungFehler';
  }
}

export type BerichtigungErgebnis = 'offen' | 'berichtigt' | 'abgelehnt' | 'ergaenzt';

export const ERGEBNIS_TEXT: Readonly<Record<BerichtigungErgebnis, string>> = {
  offen: 'aufgenommen, noch nicht entschieden',
  berichtigt: 'berichtigt',
  abgelehnt: 'abgelehnt — der gespeicherte Wert ist richtig',
  ergaenzt: 'ergänzt (Art. 16 Satz 2)',
};

/**
 * Welche Felder überhaupt in Frage kommen — aus dem SCHEMA, nicht aus einer
 * Meinung.
 *
 * **Sie ist eine Vorschlagsliste und keine Beschränkung.** Die Spalte in
 * `berichtigung_feld` ist Text, und das ist Absicht: ein Nachweis muss den
 * Namen überleben, den das Schema ihm zur Zeit der Entscheidung gab. Diese
 * Liste erspart der Oberfläche ein leeres Textfeld — sie entscheidet nicht,
 * was berichtigt werden darf.
 */
export const FELDER: Readonly<Record<Exclude<ZuordnungArt, 'keine'>,
  readonly { readonly tabelle: string; readonly feld: string;
    readonly bezeichnung: string }[]>> = {
  person: [
    { tabelle: 'person', feld: 'vorname', bezeichnung: 'Vorname' },
    { tabelle: 'person', feld: 'nachname', bezeichnung: 'Nachname' },
    { tabelle: 'person', feld: 'geburtsdatum', bezeichnung: 'Geburtsdatum' },
    { tabelle: 'person', feld: 'telefon', bezeichnung: 'Telefonnummer' },
    { tabelle: 'person', feld: 'sprache', bezeichnung: 'Sprache' },
    { tabelle: 'anstellung', feld: 'personalnummer', bezeichnung: 'Personalnummer' },
    { tabelle: 'anstellung', feld: 'eintritt', bezeichnung: 'Eintrittsdatum' },
    { tabelle: 'anstellung', feld: 'austritt', bezeichnung: 'Austrittsdatum' },
    { tabelle: 'anstellung', feld: 'wochenstunden', bezeichnung: 'Wochenstunden' },
    { tabelle: 'mitarbeiter_zugang', feld: 'telefon_e164',
      bezeichnung: 'Telefonnummer des Zugangs' },
  ],
  ansprechpartner: [
    { tabelle: 'ansprechpartner', feld: 'anrede', bezeichnung: 'Anrede' },
    { tabelle: 'ansprechpartner', feld: 'vorname', bezeichnung: 'Vorname' },
    { tabelle: 'ansprechpartner', feld: 'nachname', bezeichnung: 'Nachname' },
    { tabelle: 'ansprechpartner', feld: 'position', bezeichnung: 'Position' },
    { tabelle: 'ansprechpartner', feld: 'email', bezeichnung: 'E-Mail-Adresse' },
    { tabelle: 'ansprechpartner', feld: 'telefon', bezeichnung: 'Telefonnummer' },
  ],
  bewerbung: [
    { tabelle: 'bewerbung', feld: 'name', bezeichnung: 'Name' },
    { tabelle: 'bewerbung', feld: 'email', bezeichnung: 'E-Mail-Adresse' },
    { tabelle: 'bewerbung', feld: 'telefon', bezeichnung: 'Telefonnummer' },
  ],
};

/**
 * Wo die Berichtigung wirklich geschieht.
 *
 * Die Seite verlinkt dorthin, statt einen zweiten Schreibweg zu bauen. Wo es
 * heute keinen Editor gibt, steht `null` — und die Oberfläche sagt das, statt
 * auf eine Adresse zu zeigen, die mit 404 antwortet (AUT-06).
 */
export function editorPfad(
  mandantSlug: string, art: ZuordnungArt, id: string | null,
): string | null {
  if (id === null) return null;
  switch (art) {
    /*
     * `/personal/personen/<id>` und nicht `/personal/<id>`: die zweite Adresse
     * gibt es nicht. Unter `/personal` liegen abwesenheiten, anstellungen,
     * antraege, nachweise, personen, stundenkonten und zusammenfuehren — kein
     * `[id]`, und das Routen-Manifest fuehrt sie auch nicht. Der Verweis fiel
     * also auf 404, und zwar aus genau der Funktion, deren Aufgabe es ist, das
     * NICHT zu tun (AUT-06).
     */
    case 'person': return `/portal/${mandantSlug}/personal/personen/${id}`;
    case 'bewerbung': return `/portal/${mandantSlug}/recruiting/bewerbungen/${id}`;
    /*
     * Ein Ansprechpartner wird auf der Seite seines KUNDEN bearbeitet — dort
     * sitzt das Formular (`/api/crm/kunde`). Welcher Kunde es ist, weiss der
     * Aufrufer aus `ladeZuordnung`, nicht diese Funktion.
     */
    case 'ansprechpartner': return null;
    case 'keine': return null;
  }
}

export interface FeldZeile {
  readonly id: string;
  readonly tabelle: string;
  readonly feld: string;
  readonly wertGespeichert: string | null;
  readonly wertBehauptet: string | null;
  readonly quelle: string | null;
  readonly ergebnis: BerichtigungErgebnis;
  readonly begruendung: string | null;
  readonly berichtigtAm: Date | null;
  readonly berichtigtVon: string | null;
  readonly art19Empfaenger: string | null;
  readonly art19UnterrichtetAm: Date | null;
  readonly erfasstAm: Date;
}

export async function liste(
  kontext: LeseKontext, anfrageId: string,
): Promise<readonly FeldZeile[]> {
  return kontext.abfrage<FeldZeile>(
    `select f.id, f.tabelle, f.feld,
            f.wert_gespeichert as "wertGespeichert",
            f.wert_behauptet as "wertBehauptet", f.quelle,
            f.ergebnis::text as ergebnis, f.begruendung,
            f.berichtigt_am as "berichtigtAm", b.name as "berichtigtVon",
            f.art19_empfaenger as "art19Empfaenger",
            f.art19_unterrichtet_am as "art19UnterrichtetAm",
            f.erfasst_am as "erfasstAm"
       from berichtigung_feld f
       left join benutzer b on b.id = f.berichtigt_von
      where f.mandant_id = app.aktiver_mandant() and f.anfrage_id = $1::uuid
      order by f.tabelle, f.feld`, [anfrageId]);
}

export interface NeuesFeld {
  readonly tabelle: string;
  readonly feld: string;
  readonly wertGespeichert?: string | null;
  readonly wertBehauptet?: string | null;
  readonly quelle?: string | null;
}

/**
 * Ein strittiges Feld aufnehmen.
 *
 * **Der gespeicherte Wert wird MITGESCHRIEBEN und nicht später nachgelesen.**
 * Nach der Berichtigung ist er fort; ein Nachweis, der ihn erst im Moment der
 * Vorlage liest, zeigt dann den neuen Wert auf beiden Seiten und belegt
 * nichts. Was hier steht, ist der Stand zur Zeit der Aufnahme — und genau das
 * will Art. 19 belegen können.
 *
 * **Und deshalb ist die Aufnahme einmalig.** Solange das Feld `offen` ist,
 * darf sie berichtigt werden (ein Tippfehler im behaupteten Wert); sobald
 * entschieden ist, antwortet sie mit 409 statt den Beweis zu überschreiben.
 */
export async function nimmAuf(
  kontext: SchreibKontext, anfrageId: string, f: NeuesFeld,
): Promise<void> {
  if (f.tabelle.trim() === '' || f.feld.trim() === '') {
    throw new BerichtigungFehler(
      'Ohne Tabelle und Feld gibt es nichts zu berichtigen.', 'ohne_ort');
  }
  if ((f.wertBehauptet ?? '').trim() === '') {
    throw new BerichtigungFehler(
      'Was ist der richtige Wert? Eine Berichtigung ohne Ziel ist eine Beschwerde.',
      'ohne_ziel');
  }
  /*
   * **Ein bereits entschiedenes Feld wird NICHT überschrieben.**
   *
   * Der Upsert setzte `wert_gespeichert = excluded.wert_gespeichert` — also
   * genau den Beweis, für den diese Tabelle angelegt wurde. Wird dasselbe
   * `tabelle.feld` ein zweites Mal aufgenommen (und die Oberfläche lässt das
   * zu, per Auswahlliste oder von Hand), steht danach der NACHHERIGE Wert
   * darin, während `ergebnis`, `berichtigt_am` und `berichtigt_von`
   * unverändert auf „berichtigt" stehen bleiben: die Zeile belegt dann eine
   * Berichtigung von X auf X. Die Löschsperre (`append`) schützt gegen
   * DELETE, nicht gegen dieses UPDATE.
   *
   * Ein zweiter Streit um dasselbe Feld ist ein zweiter Vorgang — die
   * Zuordnung steckt im Unique (`mandant_id, anfrage_id, tabelle, feld`), eine
   * neue Anfrage bekommt also ihre eigene Zeile.
   */
  const [vorhanden] = await kontext.abfrage<{ ergebnis: string }>(
    `select ergebnis::text as ergebnis from berichtigung_feld
      where mandant_id = app.aktiver_mandant() and anfrage_id = $1::uuid
        and tabelle = $2 and feld = $3`,
    [anfrageId, f.tabelle.trim(), f.feld.trim()]);
  if (vorhanden !== undefined && vorhanden.ergebnis !== 'offen') {
    throw new BerichtigungFehler(
      `Zu „${f.tabelle.trim()}.${f.feld.trim()}" ist in diesem Vorgang bereits `
      + `entschieden (${vorhanden.ergebnis}). Diese Zeile ist der Nachweis der `
      + 'Entscheidung und wird nicht überschrieben — ein zweiter Streit um '
      + 'dasselbe Feld ist ein zweiter Vorgang.',
      'bereits_entschieden', 409);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into berichtigung_feld
       (mandant_id, anfrage_id, tabelle, feld, wert_gespeichert, wert_behauptet,
        quelle, erfasst_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4, $5, $6,
             app.aktueller_benutzer())
     on conflict (mandant_id, anfrage_id, tabelle, feld)
     -- Der ERSTE erfasste Stand bleibt stehen: coalesce statt excluded.
     -- Nachgereicht werden darf er (wenn er beim ersten Mal leer blieb),
     -- ersetzt nie.
     do update set
          wert_gespeichert = coalesce(berichtigung_feld.wert_gespeichert,
                                      excluded.wert_gespeichert),
          wert_behauptet = excluded.wert_behauptet,
          quelle = coalesce(excluded.quelle, berichtigung_feld.quelle),
          geaendert_am = now()
     where berichtigung_feld.ergebnis = 'offen'
     returning id`,
    [anfrageId, f.tabelle.trim(), f.feld.trim(),
      (f.wertGespeichert ?? '').trim() === '' ? null : (f.wertGespeichert ?? '').trim(),
      (f.wertBehauptet ?? '').trim(),
      (f.quelle ?? '').trim() === '' ? null : (f.quelle ?? '').trim()]);
  if (zeilen[0] === undefined) {
    throw new BerichtigungFehler(
      'Das Feld konnte nicht aufgenommen werden — fehlt '
      + '`datenschutz.berichtigung_bearbeiten`?', 'nicht_gespeichert', 403);
  }
}

/**
 * Ein Feld entscheiden.
 *
 * `berichtigt` und `ergaenzt` verlangen Zeitpunkt und benannten Menschen (der
 * CHECK in der Tabelle sagt das auch); `abgelehnt` verlangt eine Begründung.
 * Eine Ablehnung ohne Grund ist vor einer Aufsichtsbehörde keine — und sie ist
 * der Fall, in dem sich der Betroffene beschwert.
 */
export async function entscheide(
  kontext: SchreibKontext, feldId: string, ergebnis: BerichtigungErgebnis,
  begruendung: string,
): Promise<void> {
  if (ergebnis === 'abgelehnt' && begruendung.trim() === '') {
    throw new BerichtigungFehler(
      'Eine Ablehnung nach Art. 16 wird begründet — sie ist der Fall, in dem '
      + 'die betroffene Person sich bei der Aufsicht beschwert.', 'ohne_grund');
  }
  const vollzug = ergebnis === 'berichtigt' || ergebnis === 'ergaenzt';
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update berichtigung_feld
        set ergebnis = $2::berichtigung_ergebnis,
            begruendung = $3,
            berichtigt_am  = case when $4 then now() else null end,
            berichtigt_von = case when $4 then app.aktueller_benutzer() else null end
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
      returning id`,
    [feldId, ergebnis,
      begruendung.trim() === '' ? null : begruendung.trim(), vollzug]);
  if (zeilen[0] === undefined) {
    throw new BerichtigungFehler(
      'Dieses Feld gibt es nicht — oder es fehlt '
      + '`datenschutz.berichtigung_bearbeiten`.', 'nicht_gefunden', 404);
  }
}

/**
 * Art. 19 DSGVO: die Empfänger unterrichten.
 *
 * **Wer die Empfänger sind, weiss die Plattform nicht.** Lohnbüro,
 * Auftraggeber, Behörde — nichts davon steht als Empfängerliste im System.
 * Also benennt sie ein Mensch, und hier steht, dass und wann er unterrichtet
 * hat. Eine Liste zu erfinden wäre die teuerste Art von Vollständigkeit.
 *
 * // TODO(client, O-646): Welche Empfänger nach Art. 19 DSGVO gibt es je Datenklasse, und auf welchem Weg werden sie unterrichtet?
 */
export async function unterrichte(
  kontext: SchreibKontext, feldId: string, empfaenger: string,
): Promise<void> {
  if (empfaenger.trim() === '') {
    throw new BerichtigungFehler(
      'Wen haben Sie unterrichtet? Art. 19 verlangt den Empfänger, nicht die '
      + 'Absicht.', 'ohne_empfaenger');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update berichtigung_feld
        set art19_empfaenger = $2, art19_unterrichtet_am = now()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and ergebnis in ('berichtigt', 'ergaenzt')
      returning id`, [feldId, empfaenger.trim()]);
  if (zeilen[0] === undefined) {
    throw new BerichtigungFehler(
      'Unterrichtet wird über eine Berichtigung, die stattgefunden hat — '
      + 'entscheiden Sie das Feld zuerst.', 'nicht_berichtigt', 409);
  }
}
