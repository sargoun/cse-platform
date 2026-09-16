import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * Die Vergabemappe: die Prüfliste, die vor der Frist abgehakt sein muss —
 * und nichts, was einreicht (RAD-07, D-07).
 *
 * **Warum eine Liste und kein Textfeld.** Eine deutsche Ausschreibung fordert
 * benannte Formblätter. Fehlt eines am Abgabetag, wird das Angebot nach § 57
 * VgV ausgeschlossen, ohne dass jemand den Preis liest. Eine Liste kann
 * zählen, was fehlt; ein Freitext kann es nicht — und dieses Zählen ist der
 * ganze Zweck.
 *
 * **Was hier NICHT steht, ist Absicht.** Keine Standardpositionen, keine
 * Vorlage „die üblichen zwölf Unterlagen". Welche Unterlagen eine Plattform
 * bei welcher Verfahrensart verlangt, weiss niemand hier — und eine geratene
 * Vorlage wäre eine Prüfliste, die vollständig aussieht und es nicht ist.
 * Die Positionen kommen aus den Vergabeunterlagen, von Hand oder später aus
 * einer Extraktion, die ein Mensch bestätigt.
 */

export class MappeFehler extends Error {
  readonly code: 'nicht_gefunden' | 'eingabe' | 'stand' | 'recht';
  readonly status: number;
  constructor(code: 'nicht_gefunden' | 'eingabe' | 'stand' | 'recht', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.status = code === 'nicht_gefunden' ? 404 : code === 'recht' ? 403 : 400;
    this.name = 'MappeFehler';
  }
}

/** Die Stände, die eine Person hier setzt. `eingereicht` gehört der Erfassung. */
export const SETZBARER_MAPPENSTAND = [
  'offen', 'in_arbeit', 'vollstaendig', 'freigegeben', 'verworfen',
] as const;
export type MappenStand = typeof SETZBARER_MAPPENSTAND[number];

export const POSITIONSSTAENDE = ['offen', 'vorhanden', 'geprueft', 'nicht_zutreffend'] as const;
export type Positionsstand = typeof POSITIONSSTAENDE[number];

/**
 * Legt die Mappe zum Vorgang an, wenn es noch keine gibt — sonst gibt sie die
 * vorhandene zurück.
 *
 * Der Übergang nach `in_bearbeitung` setzt sie voraus (Seitenkarte §5.18),
 * und die Datenbank besteht darauf (`app.vorgang_braucht_mappe`). Deshalb ist
 * das Anlegen idempotent: „In Bearbeitung nehmen" darf nicht daran scheitern,
 * dass jemand vorher schon einmal auf den Knopf gedrückt hat.
 */
export async function legeMappeAn(
  kontext: SchreibKontext, vorgangId: string,
): Promise<{ readonly mappeId: string; readonly neu: boolean }> {
  const [zeile] = await kontext.schreibe<{ id: string; neu: boolean }>(
    `insert into vergabemappe (mandant_id, ausschreibung_vorgang_id, erstellt_von_art, erstellt_von)
     values ($1::uuid, $2::uuid, 'mensch', $3::uuid)
     on conflict (mandant_id, ausschreibung_vorgang_id) where geloescht_am is null
       do update set geaendert_am = now(), geaendert_von = excluded.erstellt_von
     returning id, (xmax = 0) as neu`,
    [kontext.aktiverMandantId, vorgangId, kontext.benutzerId]);
  if (zeile === undefined) {
    throw new MappeFehler('nicht_gefunden',
      'Der Vorgang wurde nicht gefunden, oder die Sitzung darf hier nicht schreiben.');
  }
  return { mappeId: zeile.id, neu: zeile.neu };
}

export interface PositionsEingabe {
  readonly mappeId: string;
  readonly bezeichnung: string;
  readonly kategorie: string | null;
  readonly pflicht: boolean;
  readonly quelleDokumentId?: string | null;
  readonly quelleSeite?: number | null;
}

/**
 * Hängt eine Zeile ans Ende. Die Nummer rechnet die Datenbank, nicht der
 * Browser: zwei gleichzeitig geöffnete Formulare vergäben sonst zweimal
 * dieselbe — und der Eindeutigkeitsschlüssel liesse nur eines davon durch.
 */
export async function ergaenzePosition(
  kontext: SchreibKontext, e: PositionsEingabe,
): Promise<string> {
  const bezeichnung = e.bezeichnung.trim();
  if (bezeichnung.length < 3) {
    throw new MappeFehler('eingabe',
      'Eine Position braucht eine Bezeichnung — mindestens drei Zeichen.');
  }
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into vergabemappe_position
       (mandant_id, vergabemappe_id, position, bezeichnung, kategorie, pflicht,
        quelle_ausschreibung_dokument_id, quelle_seite, erstellt_von_art, erstellt_von)
     select $1::uuid, m.id,
            coalesce((select max(p.position) from vergabemappe_position p
                       where p.vergabemappe_id = m.id), 0) + 1,
            $3, $4, $5::boolean, $6::uuid, $7::integer, 'mensch', $8::uuid
       from vergabemappe m
      where m.id = $2::uuid and m.mandant_id = $1::uuid and m.geloescht_am is null
     returning id`,
    [kontext.aktiverMandantId, e.mappeId, bezeichnung, e.kategorie, e.pflicht,
      e.quelleDokumentId ?? null, e.quelleSeite ?? null, kontext.benutzerId]);
  if (zeile === undefined) {
    throw new MappeFehler('nicht_gefunden', 'Die Vergabemappe wurde nicht gefunden.');
  }
  return zeile.id;
}

export interface PositionsstandEingabe {
  readonly positionId: string;
  readonly stand: Positionsstand;
  readonly dokumentId?: string | null;
  readonly hinweis?: string | null;
}

/**
 * Setzt den Stand einer Zeile.
 *
 * Die drei Regeln stehen in der Datenbank, nicht hier — `vorhanden` und
 * `geprueft` brauchen eine Datei, `geprueft` einen Prüfer, `nicht_zutreffend`
 * eine Begründung. Dieser Dienst prüft sie trotzdem vor, damit die Seite
 * einen deutschen Satz zeigen kann statt einer Verletzung eines CHECKs.
 */
export async function setzePositionsstand(
  kontext: SchreibKontext, e: PositionsstandEingabe,
): Promise<void> {
  const hinweis = e.hinweis === null || e.hinweis === undefined || e.hinweis.trim() === ''
    ? null : e.hinweis.trim();
  if (e.stand === 'nicht_zutreffend' && (hinweis === null || hinweis.length < 5)) {
    throw new MappeFehler('eingabe',
      '„Gilt für uns nicht" braucht eine Begründung — sonst ist es eine Lücke mit Haken davor.');
  }
  const braucht = e.stand === 'vorhanden' || e.stand === 'geprueft';
  const dokument = e.dokumentId ?? null;

  const [zeile] = await kontext.schreibe<{ id: string; hat_dokument: boolean }>(
    `update vergabemappe_position p
        set status = $3::mappe_position_status,
            dokument_id = case when $3 = 'offen' then p.dokument_id
                               else coalesce($4::uuid, p.dokument_id) end,
            luecke_hinweis = $5,
            geprueft_von = case when $3 = 'geprueft' then $6::uuid else null end,
            geprueft_am  = case when $3 = 'geprueft' then now() else null end,
            geaendert_am = now(), geaendert_von = $6::uuid
      where p.id = $2::uuid and p.mandant_id = $1::uuid
        and ($3 <> 'vorhanden' and $3 <> 'geprueft'
             or coalesce($4::uuid, p.dokument_id) is not null)
     returning p.id, (p.dokument_id is not null) as hat_dokument`,
    [kontext.aktiverMandantId, e.positionId, e.stand, dokument, hinweis, kontext.benutzerId]);

  if (zeile === undefined) {
    if (braucht && dokument === null) {
      throw new MappeFehler('eingabe',
        'Ohne beigelegte Datei kann diese Position nicht auf „liegt vor" stehen.');
    }
    throw new MappeFehler('nicht_gefunden', 'Die Position wurde nicht gefunden.');
  }
}

/**
 * Entfernt eine Zeile. Kein weicher Löschstand: eine versehentlich angelegte
 * Prüflistenzeile ist kein Geschäftsvorfall, sondern ein Tippfehler.
 *
 * **Bis zur Einreichung, und keinen Schritt weiter.** Eine eingereichte Mappe
 * IST die Aussage darüber, was hinausgegangen ist; eine Zeile daraus zu
 * löschen hiesse, das Angebot nachträglich anders aussehen zu lassen, als es
 * war. Vorher ist die Liste ein Arbeitsblatt, nachher ein Beleg.
 *
 * **Die Bedingung steht im `delete`, nicht davor.** Ein `select` auf den Stand
 * und ein `delete` danach sind zwei Aussagen mit einem Fenster dazwischen, in
 * das die Einreichung genau hineinpasst — dann wäre die Zeile weg und die
 * Mappe eingereicht. So entscheidet PostgreSQL: null Zeilen heisst, dass es
 * sie nicht gibt ODER dass die Mappe zu ist, und beides führt hier zu
 * demselben Satz (AUT-06 — die Antwort verrät nicht, welcher der beiden Fälle
 * zutrifft).
 */
export async function entfernePosition(
  kontext: SchreibKontext, positionId: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `delete from vergabemappe_position p
      where p.id = $2::uuid and p.mandant_id = $1::uuid
        and exists (
          select 1 from vergabemappe m
           where m.id = p.vergabemappe_id and m.mandant_id = p.mandant_id
             and m.geloescht_am is null and m.status <> 'eingereicht')
      returning p.id`,
    [kontext.aktiverMandantId, positionId]);
  if (zeilen.length === 0) {
    throw new MappeFehler('nicht_gefunden',
      'Die Position wurde nicht gefunden, oder die Mappe ist bereits eingereicht.');
  }
}

export interface MappenstandEingabe {
  readonly mappeId: string;
  readonly stand: MappenStand;
  readonly luecken?: string | null;
}

/**
 * Setzt den Stand der Mappe.
 *
 * **`vollstaendig` und `freigegeben` sind an die Zähler gebunden.** Eine Mappe
 * für vollständig zu erklären, in der Pflichtzeilen offen sind, wäre genau die
 * Zusage, an der ein Angebot scheitert. Die Zähler rechnet der Trigger; hier
 * wird nur gelesen, was er geschrieben hat.
 *
 * **`freigegeben` trägt den Namen dessen, der freigibt** — und die Datenbank
 * prüft, dass es die angemeldete Person ist (`kern.unterschrift_ist_die_eigene`).
 */
export async function setzeMappenstand(
  kontext: SchreibKontext, e: MappenstandEingabe,
): Promise<void> {
  if (!(SETZBARER_MAPPENSTAND as readonly string[]).includes(e.stand)) {
    throw new MappeFehler('stand', `„${e.stand}" ist kein Stand, den diese Seite setzt.`);
  }
  const luecken = e.luecken === null || e.luecken === undefined || e.luecken.trim() === ''
    ? null : e.luecken.trim();

  const [vorher] = await kontext.abfrage<{ gesamt: number; erledigt: number; status: string }>(
    `select pflichtpositionen_gesamt as gesamt, pflichtpositionen_erledigt as erledigt,
            status::text as status
       from vergabemappe where id = $1::uuid and mandant_id = $2::uuid and geloescht_am is null`,
    [e.mappeId, kontext.aktiverMandantId]);
  if (vorher === undefined) {
    throw new MappeFehler('nicht_gefunden', 'Die Vergabemappe wurde nicht gefunden.');
  }
  if (vorher.status === 'eingereicht') {
    throw new MappeFehler('stand',
      'Diese Mappe ist eingereicht. Was abgegeben wurde, wird nicht mehr umsortiert.');
  }
  if ((e.stand === 'vollstaendig' || e.stand === 'freigegeben')
      && (vorher.gesamt === 0 || vorher.erledigt < vorher.gesamt)) {
    throw new MappeFehler('stand',
      vorher.gesamt === 0
        ? 'Eine Mappe ohne eine einzige Pflichtposition ist nicht vollständig, sondern leer.'
        : `Noch ${String(vorher.gesamt - vorher.erledigt)} von ${String(vorher.gesamt)} `
          + 'Pflichtpositionen sind nicht geprüft.');
  }

  await kontext.schreibe(
    `update vergabemappe
        set status = $3::vergabemappe_status,
            luecken_hinweis = coalesce($4, luecken_hinweis),
            freigegeben_von = case when $3 = 'freigegeben' then $5::uuid else null end,
            freigegeben_am  = case when $3 = 'freigegeben' then now() else null end,
            geaendert_am = now(), geaendert_von = $5::uuid
      where id = $1::uuid and mandant_id = $2::uuid and geloescht_am is null`,
    [e.mappeId, kontext.aktiverMandantId, e.stand, luecken, kontext.benutzerId]);

  await kontext.schreibe(
    `select app.protokolliere('vergabe.stand_gesetzt', 'vergabemappe', $1, $2::jsonb, $3::jsonb,
                              app.aktiver_mandant())`,
    /* Objekte, kein JSON-Text (D-467). */
    [e.mappeId, { status: vorher.status }, { status: e.stand }]);
}
