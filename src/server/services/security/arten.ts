/**
 * Die Posten- und Schluesselarten: Voreinstellung und Pflege (O-148, D-783).
 *
 * Beide Kataloge (`postenart` 0069, `schluesselart` 0079) wurden leer
 * ausgeliefert, und es gab keinen Dienst, der eine Zeile anlegt — die Posten-
 * und Schluesselmaske sagten „keine Arten hinterlegt". Seit D-783 gibt es die
 * Voreinstellung eines Berliner Sicherheitsdienstes, die ein leerer Katalog mit
 * einem Knopf uebernimmt: unbestaetigt (`ist_platzhalter`, §1.16), bis die
 * Gesellschaft bestaetigt oder archiviert — und eine eigene Art ergaenzt, die
 * als ihre Entscheidung gilt und keinen Platzhaltervermerk traegt. Die
 * Uebersetzungen gelten dem Mitarbeiterportal (EMP-12); das Deutsche ist die
 * Bezeichnung.
 *
 * **Idempotent und wettlauffest.** Ein Schluessel, der schon steht — auch
 * archiviert —, wird nicht noch einmal angelegt; und zwei Knopfdruecke zur
 * selben Zeit legen keine Zeile doppelt an: der Einsatz traegt `ON CONFLICT`
 * auf dem lebenden Schluessel (`*_schluessel_uk`, partiell), gezaehlt und
 * protokolliert wird nur, was diese Transaktion wirklich eingefuegt hat.
 *
 * **Lesen UND Schreiben.** Der Dienst liest den Katalog, bevor er schreibt,
 * und `RETURNING` prueft die Lesepolitik der Zeile (0069/0079 `t_mandant`:
 * `USING` = `security.lesen` bzw. `schluessel.lesen`). Die Routen verlangen
 * deshalb beide Rechte des Moduls — wer den Katalog pflegt, darf ihn sehen.
 *
 * **`$n::text::jsonb`, nicht `$n::jsonb`.** Ein `JSON.stringify(...)` in
 * einem blossen `::jsonb`-Parameter legt eine JSON-ZEICHENKETTE in die Spalte
 * (postgres.js serialisiert den schon serialisierten Text noch einmal); die
 * Pruefbedingung `bezeichnung_i18n - array[...]` faellt dann mit „cannot
 * delete from scalar" — genau daran brach der Seed in der CI von PR #33. Die
 * Protokollzeilen bekommen das OBJEKT, wie `radar/plattform.ts`; dieselbe
 * Regel steht in `dienstanweisung.ts` und `bau/gewerk.ts`.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type ArtTabelle = 'postenart' | 'schluesselart';
export type ArtSprache = 'en' | 'ar' | 'tr';
export const ART_SPRACHEN: readonly ArtSprache[] = ['en', 'ar', 'tr'];

export interface ArtVoreinstellung {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly uebersetzungen: Readonly<Record<ArtSprache, string>>;
  readonly sortierung: number;
}

// TODO(client, O-148): Voreinstellung — diese Posten- und Schluesselarten; die Gesellschaft bestaetigt, ergaenzt oder archiviert.
export const POSTENART_VOREINSTELLUNG: readonly ArtVoreinstellung[] = [
  { schluessel: 'objektschutz', bezeichnung: 'Objektschutz', sortierung: 10,
    uebersetzungen: { en: 'Static guarding', ar: 'حماية المواقع', tr: 'Tesis koruma' } },
  { schluessel: 'empfang', bezeichnung: 'Empfang und Pforte', sortierung: 20,
    uebersetzungen: { en: 'Reception and gate', ar: 'الاستقبال والبوابة', tr: 'Resepsiyon ve kapı' } },
  { schluessel: 'revier', bezeichnung: 'Revier- und Streifendienst', sortierung: 30,
    uebersetzungen: { en: 'Mobile patrol', ar: 'الدوريات', tr: 'Devriye hizmeti' } },
  { schluessel: 'veranstaltung', bezeichnung: 'Veranstaltungsschutz', sortierung: 40,
    uebersetzungen: { en: 'Event security', ar: 'تأمين الفعاليات', tr: 'Etkinlik güvenliği' } },
  { schluessel: 'baustelle', bezeichnung: 'Baustellenbewachung', sortierung: 50,
    uebersetzungen: { en: 'Construction site guarding', ar: 'حراسة مواقع البناء', tr: 'Şantiye bekçiliği' } },
  { schluessel: 'intervention', bezeichnung: 'Alarmverfolgung und Intervention', sortierung: 60,
    uebersetzungen: { en: 'Alarm response', ar: 'الاستجابة للإنذارات', tr: 'Alarm müdahale' } },
];

export const SCHLUESSELART_VOREINSTELLUNG: readonly ArtVoreinstellung[] = [
  { schluessel: 'mechanisch', bezeichnung: 'Mechanischer Schlüssel', sortierung: 10,
    uebersetzungen: { en: 'Mechanical key', ar: 'مفتاح ميكانيكي', tr: 'Mekanik anahtar' } },
  { schluessel: 'general', bezeichnung: 'Generalschlüssel', sortierung: 20,
    uebersetzungen: { en: 'Master key', ar: 'المفتاح الرئيسي', tr: 'Ana anahtar' } },
  { schluessel: 'gruppe', bezeichnung: 'Gruppenschlüssel', sortierung: 30,
    uebersetzungen: { en: 'Group key', ar: 'مفتاح المجموعة', tr: 'Grup anahtarı' } },
  { schluessel: 'transponder', bezeichnung: 'Transponder', sortierung: 40,
    uebersetzungen: { en: 'Transponder', ar: 'مفتاح إلكتروني (ترانسبوندر)', tr: 'Transponder' } },
  { schluessel: 'chipkarte', bezeichnung: 'Chipkarte', sortierung: 50,
    uebersetzungen: { en: 'Chip card', ar: 'بطاقة إلكترونية', tr: 'Çipli kart' } },
];

/** Eine Zeile des lebenden Katalogs, wie die Seiten sie zeigen und die Pflege sie braucht. */
export interface ArtZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly uebersetzungen: Readonly<Partial<Record<ArtSprache, string>>>;
  readonly istPlatzhalter: boolean;
  readonly sortierung: number;
}

export type ArtGrund =
  | 'bezeichnung_fehlt' | 'bezeichnung_zu_lang' | 'uebersetzung_zu_lang'
  | 'doppelt' | 'nicht_gefunden';

/**
 * Ein abgewiesener Pflegeschritt — `status` und `code` fuer `alsAntwort`
 * (ein Programm bekommt JSON), `grund` fuer den Rueckweg des Formulars (die
 * Seite macht einen Satz daraus).
 */
export class ArtFehler extends Error {
  readonly code: string;
  readonly status: number;
  constructor(readonly grund: ArtGrund, meldung: string) {
    super(meldung);
    this.name = 'ArtFehler';
    this.code = grund === 'nicht_gefunden' || grund === 'doppelt' ? grund : 'ungueltige_eingabe';
    this.status = grund === 'nicht_gefunden' ? 404 : grund === 'doppelt' ? 409 : 422;
  }
}

const BEZEICHNUNG_MAX = 120;

/**
 * Der Schluessel aus der Bezeichnung: klein, ASCII, Unterstrich —
 * „Mechanischer Schlüssel" → `mechanischer_schluessel`. Die Datenbank fuehrt
 * den Schluessel als stabilen Bezug; ein Mensch tippt die Bezeichnung und
 * nicht den Schluessel — ein Eingabefeld fuer Quelltext waere genau das, was
 * die Wache auf keinem Bildschirm sehen soll (V-232).
 */
export function artSchluessel(bezeichnung: string): string {
  return bezeichnung
    .trim()
    .toLowerCase()
    .replace(/ä/gu, 'ae').replace(/ö/gu, 'oe').replace(/ü/gu, 'ue').replace(/ß/gu, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 40)
    .replace(/_+$/u, '');
}

export interface ArtEingabe {
  readonly bezeichnung: string;
  readonly uebersetzungen?: Readonly<Partial<Record<ArtSprache, string | null | undefined>>>;
}

export interface GepruefteArt {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly uebersetzungen: Readonly<Partial<Record<ArtSprache, string>>>;
}

/** Prueft die Eingabe einer eigenen Art; wirft `ArtFehler` mit dem Grund. */
export function pruefeArtEingabe(roh: ArtEingabe): GepruefteArt {
  const bezeichnung = roh.bezeichnung.trim();
  if (bezeichnung === '') {
    throw new ArtFehler('bezeichnung_fehlt', 'Eine Art braucht eine Bezeichnung.');
  }
  if (bezeichnung.length > BEZEICHNUNG_MAX) {
    throw new ArtFehler('bezeichnung_zu_lang',
      `Die Bezeichnung hat höchstens ${String(BEZEICHNUNG_MAX)} Zeichen.`);
  }
  const schluessel = artSchluessel(bezeichnung);
  if (schluessel === '') {
    throw new ArtFehler('bezeichnung_fehlt',
      'Die Bezeichnung braucht mindestens einen Buchstaben oder eine Ziffer.');
  }
  const uebersetzungen: Partial<Record<ArtSprache, string>> = {};
  for (const s of ART_SPRACHEN) {
    const t = (roh.uebersetzungen?.[s] ?? '').trim();
    if (t === '') continue;
    if (t.length > BEZEICHNUNG_MAX) {
      throw new ArtFehler('uebersetzung_zu_lang',
        `Eine Übersetzung hat höchstens ${String(BEZEICHNUNG_MAX)} Zeichen.`);
    }
    uebersetzungen[s] = t;
  }
  return { schluessel, bezeichnung, uebersetzungen };
}

/* ------------------------------------------------------------------ Lesen */

const SPALTEN = 'id, schluessel, bezeichnung, bezeichnung_i18n, ist_platzhalter, sortierung';

interface RohZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly bezeichnung_i18n: Readonly<Record<string, unknown>> | null;
  readonly ist_platzhalter: boolean;
  readonly sortierung: number;
}

function alsZeile(z: RohZeile): ArtZeile {
  const uebersetzungen: Partial<Record<ArtSprache, string>> = {};
  for (const s of ART_SPRACHEN) {
    const t = z.bezeichnung_i18n?.[s];
    if (typeof t === 'string' && t.trim() !== '') uebersetzungen[s] = t;
  }
  return {
    id: z.id, schluessel: z.schluessel, bezeichnung: z.bezeichnung, uebersetzungen,
    istPlatzhalter: z.ist_platzhalter, sortierung: z.sortierung,
  };
}

/** Der lebende Katalog einer Tabelle, in der Reihenfolge der Sortierung. */
export async function leseArten(
  kontext: LeseKontext, tabelle: ArtTabelle,
): Promise<readonly ArtZeile[]> {
  const zeilen = await kontext.abfrage<RohZeile>(
    `select ${SPALTEN} from ${tabelle}
      where mandant_id = app.aktiver_mandant() and archiviert_am is null
      order by sortierung, bezeichnung`);
  return zeilen.map(alsZeile);
}

/* -------------------------------------------------------------- Schreiben */

function protokollZeile(z: ArtZeile | GepruefteArt, istPlatzhalter: boolean): Record<string, unknown> {
  return {
    schluessel: z.schluessel, bezeichnung: z.bezeichnung,
    uebersetzungen: z.uebersetzungen, ist_platzhalter: istPlatzhalter,
  };
}

interface Einsatz extends GepruefteArt {
  readonly sortierung: number;
  readonly istPlatzhalter: boolean;
  /** Eine Zeile der Voreinstellung traegt O-148 im Protokoll; eine eigene nicht. */
  readonly voreinstellung: boolean;
}

/**
 * Fuegt eine Zeile ein, wenn ihr Schluessel nicht schon LEBT — `ON CONFLICT`
 * auf dem partiellen Index, damit zwei gleichzeitige Transaktionen sich nicht
 * mit einem Verstoss gegen den Index abweisen. Gibt die neue id zurueck, oder
 * `null`, wenn eine andere Transaktion schneller war. Protokolliert nur, was
 * wirklich eingefuegt wurde.
 */
async function fuegeArtEin(
  kontext: SchreibKontext, tabelle: ArtTabelle, e: Einsatz,
): Promise<string | null> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into ${tabelle}
       (mandant_id, schluessel, bezeichnung, bezeichnung_i18n, sortierung, ist_platzhalter,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3::text::jsonb, $4::smallint, $5::boolean,
             'mensch', $6::uuid)
     on conflict (mandant_id, schluessel) where archiviert_am is null do nothing
     returning id`,
    [e.schluessel, e.bezeichnung, JSON.stringify(e.uebersetzungen), e.sortierung,
      e.istPlatzhalter, kontext.benutzerId]);
  const id = zeilen[0]?.id;
  if (id === undefined) return null;
  await kontext.schreibe(
    `select app.protokolliere($1, $2, $3, null, $4::jsonb, app.aktiver_mandant())`,
    [`security.${tabelle}_angelegt`, tabelle, id,
      { ...protokollZeile(e, e.istPlatzhalter), voreinstellung: e.voreinstellung ? 'O-148' : null }]);
  return id;
}

async function uebernimmArten(
  kontext: SchreibKontext, tabelle: ArtTabelle,
  arten: readonly ArtVoreinstellung[],
): Promise<number> {
  /*
   * Auch eine ARCHIVIERTE zaehlt als „steht schon": eine Art, die die
   * Gesellschaft bewusst abgelegt hat, kommt nicht als Voreinstellung zurueck.
   * Der Index allein wuesste das nicht — er ist partiell auf die lebenden.
   */
  const da = await kontext.abfrage<{ schluessel: string }>(
    `select schluessel from ${tabelle} where mandant_id = app.aktiver_mandant()`);
  const vorhanden = new Set(da.map((z) => z.schluessel));
  let angelegt = 0;
  for (const a of arten) {
    if (vorhanden.has(a.schluessel)) continue;
    const id = await fuegeArtEin(kontext, tabelle, {
      ...a, istPlatzhalter: true, voreinstellung: true,
    });
    if (id !== null) angelegt += 1;
  }
  return angelegt;
}

/** Legt die Postenarten der Voreinstellung an, die noch fehlen; gibt ihre Zahl zurueck. */
export function uebernimmPostenartVoreinstellung(kontext: SchreibKontext): Promise<number> {
  return uebernimmArten(kontext, 'postenart', POSTENART_VOREINSTELLUNG);
}

/** Legt die Schluesselarten der Voreinstellung an, die noch fehlen; gibt ihre Zahl zurueck. */
export function uebernimmSchluesselartVoreinstellung(kontext: SchreibKontext): Promise<number> {
  return uebernimmArten(kontext, 'schluesselart', SCHLUESSELART_VOREINSTELLUNG);
}

/* ----------------------------------------------------------------- Pflege */

async function sperreArt(
  kontext: SchreibKontext, tabelle: ArtTabelle, id: string,
): Promise<ArtZeile> {
  const [z] = await kontext.schreibe<RohZeile>(
    `select ${SPALTEN} from ${tabelle}
      where id = $1::uuid and mandant_id = app.aktiver_mandant() and archiviert_am is null
      for update`, [id]);
  if (z === undefined) {
    throw new ArtFehler('nicht_gefunden', 'Diese Art gibt es in diesem Katalog nicht (mehr).');
  }
  return alsZeile(z);
}

/**
 * Bestaetigt eine Zeile der Voreinstellung: ab jetzt eine Entscheidung der
 * Gesellschaft (§1.16), ohne Platzhaltervermerk. Noch einmal bestaetigen ist
 * kein Fehler — es aendert nichts.
 */
export async function bestaetigeArt(
  kontext: SchreibKontext, tabelle: ArtTabelle, id: string,
): Promise<ArtZeile> {
  const vorher = await sperreArt(kontext, tabelle, id);
  const [z] = await kontext.schreibe<RohZeile>(
    `update ${tabelle} set ist_platzhalter = false, geaendert_am = now()
      where id = $1::uuid returning ${SPALTEN}`, [id]);
  if (z === undefined) {
    throw new ArtFehler('nicht_gefunden', 'Diese Art gibt es in diesem Katalog nicht (mehr).');
  }
  const nachher = alsZeile(z);
  await kontext.schreibe(
    `select app.protokolliere($1, $2, $3, $4::jsonb, $5::jsonb, app.aktiver_mandant())`,
    [`security.${tabelle}_bestaetigt`, tabelle, id,
      protokollZeile(vorher, vorher.istPlatzhalter), protokollZeile(nachher, false)]);
  return nachher;
}

/**
 * Archiviert eine Art — geloescht wird sie nicht: Posten und Schluessel, die
 * auf sie zeigen, bleiben lesbar; neu gewaehlt wird sie nicht mehr, und die
 * Voreinstellung bringt sie nicht zurueck. Den Zeitpunkt stempelt der Server
 * (Invariante 5, Ausloeser `trg_*_archivierung`).
 */
export async function archiviereArt(
  kontext: SchreibKontext, tabelle: ArtTabelle, id: string,
): Promise<ArtZeile> {
  const vorher = await sperreArt(kontext, tabelle, id);
  const [z] = await kontext.schreibe<RohZeile>(
    `update ${tabelle}
        set archiviert_am = now(), archiviert_von = $2::uuid, geaendert_am = now()
      where id = $1::uuid and archiviert_am is null returning ${SPALTEN}`,
    [id, kontext.benutzerId]);
  if (z === undefined) {
    throw new ArtFehler('nicht_gefunden', 'Diese Art gibt es in diesem Katalog nicht (mehr).');
  }
  await kontext.schreibe(
    `select app.protokolliere($1, $2, $3, $4::jsonb, $5::jsonb, app.aktiver_mandant())`,
    [`security.${tabelle}_archiviert`, tabelle, id,
      protokollZeile(vorher, vorher.istPlatzhalter),
      { ...protokollZeile(vorher, vorher.istPlatzhalter), archiviert: true }]);
  return vorher;
}

/**
 * Eine eigene Art der Gesellschaft — bestaetigt, weil sie ihre Entscheidung
 * ist (kein Platzhaltervermerk). Der Schluessel entsteht aus der Bezeichnung;
 * lebt er schon, ist das `doppelt`. Eine ARCHIVIERTE Art mit demselben
 * Schluessel steht nicht im Weg (partieller Index, 0069): wird „Empfang" neu
 * zugeschnitten, heisst die neue Zeile legitim wieder `empfang`.
 */
export async function legeArtAn(
  kontext: SchreibKontext, tabelle: ArtTabelle, roh: ArtEingabe,
): Promise<ArtZeile> {
  const art = pruefeArtEingabe(roh);
  const [max] = await kontext.abfrage<{ sortierung: number | null }>(
    `select max(sortierung)::int as sortierung from ${tabelle}
      where mandant_id = app.aktiver_mandant() and archiviert_am is null`);
  const sortierung = Math.min((max?.sortierung ?? 0) + 10, 32_000);
  const id = await fuegeArtEin(kontext, tabelle, {
    ...art, sortierung, istPlatzhalter: false, voreinstellung: false,
  });
  if (id === null) {
    throw new ArtFehler('doppelt',
      `Eine Art mit dem Schlüssel „${art.schluessel}" führt dieser Katalog schon.`);
  }
  return { id, ...art, istPlatzhalter: false, sortierung };
}
