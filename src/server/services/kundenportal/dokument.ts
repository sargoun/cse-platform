import 'server-only';
import { SIGNATUR_SEKUNDEN } from '../../storage/adapter.js';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Die freigegebenen Dokumente eines Kunden (DOC-01, DOC-03, DOC-04,
 * 04-SEITENKARTE §8: „only where `sichtbar_fuer_kunde = true`").
 *
 * ===========================================================================
 * Diese Abfragen liefern HEUTE null Zeilen — und das ist kein Defekt
 * ===========================================================================
 *
 * `dokument` traegt im Kunden-Scope zwei RESTRIKTIVE Decken und KEINE
 * permissive Policy:
 *
 *   p_kunde_ceiling            (0009)  sichtbar_fuer_kunde and geloescht_am is null
 *   p_kunde_dokument_zuordnung (0297)  kunde_id is not null
 *                                      and kunde_id = any (app.aktuelle_kunden())
 *
 * Restriktive Policies schneiden weg; GEWAEHREN kann nur eine permissive.
 * `t_mandant` greift im Kunden-Scope nicht, weil `app.aktiver_mandant()` dort
 * nach K-20 NULL ist, und ein `t_kunde` gibt es auf dieser Tabelle nicht.
 * Nachgemessen gegen eine echte Kundensitzung mit einem freigegebenen,
 * zugeordneten Dokument: `select count(*) from dokument` antwortet **0**.
 *
 * **Warum diese Datei trotzdem vollstaendig ist.** Die Frage, OB Dokumente im
 * Portal ausgeliefert werden, ist eine Entscheidung ueber Anlagen und
 * Offenlegung — nicht ueber Policies (so steht es woertlich in
 * `kundenportal/nachricht.ts`, und dieselbe Frage haengt an `drizzle/0297`).
 * Sie ist als O-671 aufgeschrieben und unbeantwortet. Eine Migration, die
 * hier nebenher die permissive Policy setzte, waere genau das, was CLAUDE.md
 * verbietet: „Never silently pick a plausible value for a legal or financial
 * rule" — und der Fehler ginge in die teure Richtung, naemlich Offenlegung.
 *
 * Gebaut ist deshalb alles ausser der Entscheidung: Projektion, Filter,
 * Liste, Blatt, Leerzustand, Rechte. Fiele die Antwort auf O-671 positiv aus,
 * genuegt EINE Migration mit einer permissiven `t_kunde` — diese Abfragen
 * liefern dann Zeilen, ohne dass hier eine Zeile geaendert wird.
 *
 * // TODO(client, O-671): Bekommt `dokument` eine eng gefasste permissive
 * `t_kunde` auf `sichtbar_fuer_kunde` (die Decken dafuer stehen bereits), oder
 * bleiben Dokumente und Anlagen dem Mailweg vorbehalten? Bis zur Antwort
 * liefert diese Liste null Zeilen, und die Seite sagt das ausdruecklich —
 * sie sagt NICHT „es liegt nichts vor" (K-18).
 *
 * // TODO(client, O-843): Faellt O-671 positiv aus, braucht der Abruf einen
 * zweiten Schritt, der heute fehlt und der beim ersten Versuch auffiele:
 * `dokument_zugriff` ist die Abrufspur (DOC-03, SEC-A6, Art. 15 DSGVO), und
 * ihre INSERT-Policy `t_dokument_zugriff_anlegen` (0139) verlangt
 * `mandant_id = app.aktiver_mandant()` — im Kunden-Scope NULL (K-20).
 * Ausserdem ist der Kunden-Scope `app.ist_readonly()`. Ein Kundenabruf kann
 * die Spur also nicht schreiben, und ein Abruf ohne Spur ist fuer die
 * Datenschutzauskunft unsichtbar. Der Weg dafuer ist ein `security definer`
 * (wie `drizzle/0266` und `0325`), nicht eine gelockerte Policy — beides
 * gehoert in DIESELBE Migration wie die Antwort auf O-671, sonst liefert das
 * Portal Dateien aus, die niemand vermerkt hat.
 *
 * ===========================================================================
 * Was die Projektion NICHT herausgibt
 * ===========================================================================
 *
 *  · **`bucket` und `objekt_schluessel`** — der Ablageort. Wer ihn kennt,
 *    kennt das Namensschema des Speichers; ausgeliefert wird ohnehin nur ueber
 *    eine kurzlebige signierte Adresse (DOC-03, `SIGNATUR_SEKUNDEN` = 15 min),
 *    nie ueber einen Pfad. Es gibt keinen oeffentlichen Bucket.
 *  · **`loeschsperre`, `aufbewahrung_bis`** — die Aufbewahrungsregel ist eine
 *    Pflicht des Hauses (DOC-07, § 147 AO). Sie dem Kunden zu zeigen heisst,
 *    ihm eine Frist zu nennen, die ihn nicht bindet.
 *  · **`geloescht_am`, `geloescht_von`, `loeschgrund`** — die Decke schliesst
 *    geloeschte Zeilen ohnehin aus; die Spalten waeren nur ein Weg, sie doch
 *    zu sehen.
 *  · **`sichtbar_fuer_mitarbeiter`** — wer im Haus dasselbe Dokument sieht,
 *    geht den Kunden nichts an.
 *  · **`erstellt_von`, `geaendert_von`** — Namen aus dem Haus (§8).
 *  · **`exif_entfernt`, `mime_verifiziert`** — interne Pruefmerkmale des
 *    Uploads. Sie sind `true`, sonst waere die Zeile nicht entstanden (CHECK
 *    in 0009); eine Spalte, die immer dasselbe sagt, sagt nichts.
 *
 * `kategorie` steht ausdruecklich DRIN und wird auf dem Bildschirm gross
 * genannt: solange O-736 offen ist (welche Kategorien duerfen einem Kunden
 * ueberhaupt freigegeben werden), prueft die Datenbank nur das Recht. Die
 * sichtbare Kategorie ist die Stelle, an der eine falsche Freigabe auffaellt
 * — dem Kunden wie dem Haus.
 */

/**
 * Sind Dokumente im Kundenportal heute erreichbar?
 *
 * Dieselbe Bauart wie `ANHAENGE_SICHTBAR` in `kundenportal/nachricht.ts`, und
 * aus demselben Grund: die Seite soll nicht raten, warum sie leer ist. Der
 * Wert ist eine KONSTANTE und keine Abfrage — „null Zeilen" ist genau die
 * Auskunft, die man hier nicht als Antwort nehmen darf (K-18).
 *
 * Er wird `true`, wenn die Migration zu O-671 die permissive `t_kunde` setzt
 * UND der Abrufweg samt Spur steht (O-843).
 */
export const DOKUMENTE_ERREICHBAR: boolean = false;

/**
 * Die Geltungsdauer einer signierten Adresse in MINUTEN — fuer den Satz auf
 * dem Bildschirm.
 *
 * **Abgeleitet, nicht abgeschrieben.** Die Wahrheit ist
 * `SIGNATUR_SEKUNDEN` im Speicher-Adapter (DOC-03: eine Codekonstante, keine
 * Umgebungsvariable — eine Ablauffrist, die je Umgebung anders gesetzt werden
 * kann, steht in der Produktion irgendwann auf 24 h). Eine „15" in einer
 * Seite waere die zweite Fassung derselben Zahl, und sie bliebe stehen, wenn
 * die erste sich aendert.
 *
 * Die Umrechnung steht hier und nicht in der Seite: CLAUDE.md laesst in einer
 * Komponente keine Rechnung zu, und zwar auch keine harmlose — die Grenze
 * zwischen „harmlos" und „das war eine Geschaeftsregel" zieht sonst jeder
 * neu.
 */
export const SIGNATUR_MINUTEN: number = Math.round(SIGNATUR_SEKUNDEN / 60);

/** Die neun Kategorien aus DOC-01, in der Sprache des Kunden. */
export const KATEGORIE_LABEL: Readonly<Record<string, string>> = {
  kunde: 'Kundenunterlage',
  vertrag: 'Vertrag',
  angebot: 'Angebot',
  rechnung: 'Rechnung',
  beleg: 'Beleg',
  mitarbeiter: 'Personalunterlage',
  projekt: 'Projektunterlage',
  buchhaltung: 'Buchhaltung',
  unternehmen: 'Unternehmensunterlage',
};

export interface Kundendokument extends Gesellschaft {
  readonly id: string;
  readonly kategorie: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly mimeTyp: string;
  /** Ganzzahltext — `bigint` passt nicht verlustfrei in eine JavaScript-Zahl. */
  readonly groesseBytes: string;
  readonly objektBezeichnung: string | null;
  readonly abgelegtAmLokal: string;
  /** Die hoechste Versionsnummer, oder `null` wenn keine Version geschrieben wurde. */
  readonly version: number | null;
}

interface DokumentZeile extends GesellschaftRoh {
  readonly id: string;
  readonly kategorie: string;
  readonly titel: string;
  readonly beschreibung: string | null;
  readonly mime_typ: string;
  readonly groesse_bytes: string;
  readonly objekt_bezeichnung: string | null;
  readonly abgelegt_lokal: string;
  readonly version: number | null;
}

/**
 * **`left join objekt`, nicht `join`.** `dokument.objekt_id` ist nullbar (eine
 * Vertragsurkunde haengt am Kunden, nicht an einem Haus), und selbst wenn sie
 * steht, kann das Objekt im Kunden-Scope unsichtbar sein — `t_kunde` auf
 * `objekt` verlangt eine Kundenzuordnung, und ein Veranstaltungsort ohne
 * Kundenstamm hat keine. Mit `join` verschwaende das Dokument, nicht bloss
 * der Ortsname.
 *
 * Die Version kommt aus einer Unterabfrage und nicht aus einem Join: zu einem
 * Dokument gehoeren MEHRERE `dokument_version`-Zeilen, und ein Join gaebe das
 * Dokument einmal je Version. `max(version)` ist die aktuelle; der Verlauf
 * gehoert dem Haus (GoBD-Integritaet ueber `sha256`), nicht dem Kundenblatt.
 */
const SPALTEN = `
  d.id, d.kategorie::text as kategorie, d.titel, d.beschreibung,
  d.mime_typ, d.groesse_bytes::text as groesse_bytes,
  o.bezeichnung as objekt_bezeichnung,
  to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as abgelegt_lokal,
  (select max(dv.version) from dokument_version dv
    where dv.mandant_id = d.mandant_id and dv.dokument_id = d.id)::int as version,
  ${GESELLSCHAFT_SPALTEN}`;

const QUELLE = `
  from dokument d
  join mandant m on m.id = d.mandant_id
  left join objekt o on o.mandant_id = d.mandant_id and o.id = d.objekt_id`;

/**
 * Die freigegebenen Dokumente — das zuletzt abgelegte zuerst.
 *
 * **Kein `where d.sichtbar_fuer_kunde` und kein `where d.geloescht_am is
 * null`.** Beides steht in `p_kunde_ceiling` (0009), und eine dritte Fassung
 * derselben Bedingung hier waere eine, die beim naechsten Umbau abweicht.
 * Dieselbe Disziplin wie in `rechnung.ts`, wo `status =
 * 'festgeschrieben'` ebenfalls nur in der Policy steht.
 */
export async function listeKundendokumente(
  kontext: KundenAbfrage,
  filter: { readonly kategorie?: string | null; readonly mandantSlug?: string | null } = {},
): Promise<readonly Kundendokument[]> {
  const kategorie = filter.kategorie ?? null;
  const slug = filter.mandantSlug ?? null;
  const zeilen = await kontext.abfrage<DokumentZeile>(
    `select ${SPALTEN} ${QUELLE}
      where ($1::text is null or d.kategorie::text = $1::text)
        and ($2::text is null or m.slug = $2::text)
      order by d.erstellt_am desc, d.titel
      limit ${GRENZE}`,
    [kategorie, slug],
  );
  return zeilen.map(alsZeile);
}

/** Ein Dokument im Einzelnen — eine fremde Kennung liefert `null` (AUT-06). */
export async function findeKundendokument(
  kontext: KundenAbfrage, id: string,
): Promise<Kundendokument | null> {
  const [z] = await kontext.abfrage<DokumentZeile>(
    `select ${SPALTEN} ${QUELLE} where d.id = $1::uuid`,
    [id],
  );
  return z === undefined ? null : alsZeile(z);
}

/** Die Kategorien, in denen ueberhaupt etwas freigegeben ist — fuer den Filter. */
export async function dokumentKategorien(
  kontext: KundenAbfrage,
): Promise<readonly { readonly kategorie: string; readonly anzahl: number }[]> {
  const zeilen = await kontext.abfrage<{ kategorie: string; anzahl: number }>(
    `select d.kategorie::text as kategorie, count(*)::int as anzahl
       from dokument d
      group by d.kategorie
      order by d.kategorie`,
  );
  return zeilen.map((z) => ({ kategorie: z.kategorie, anzahl: Number(z.anzahl) }));
}

/* ---------------------------------------------------------------------------
 * Die Dateigroesse als Satz
 * ------------------------------------------------------------------------ */

const EINHEITEN = ['Byte', 'kB', 'MB', 'GB'] as const;

/**
 * `"1536000"` → `"1,5 MB"`. Eine reine Funktion, und deshalb geprueft.
 *
 * **Sie nimmt TEXT und rechnet in `BigInt`.** `groesse_bytes` ist `bigint`;
 * die Spalte durch `Number` zu drehen waere dieselbe Nachlaessigkeit, die bei
 * Cent-Betraegen Geld kostet (K-16) — hier kostet sie „0 Byte" fuer eine
 * Datei jenseits von 2^53. Der CHECK in 0009 begrenzt eine Datei zwar auf
 * 256 MB, aber eine Wache, die auf einer Bedingung an einer anderen Stelle
 * ruht, ist keine.
 *
 * **Dezimalpraefixe (1000), nicht binaere (1024).** Eine Datei, die der
 * Browser als „1,5 MB" herunterlaedt, soll hier nicht „1,4 MiB" heissen — der
 * Kunde vergleicht mit dem, was sein Rechner sagt.
 *
 * Eine Nachkommastelle ab kB, keine bei Byte: „1,0 Byte" ist Unsinn.
 */
export function dateigroesse(bytes: string): string {
  const roh = BigInt(bytes);
  if (roh < 0n) throw new RangeError(`Keine Dateigroesse: ${bytes}`);
  if (roh < 1000n) return `${String(roh)} Byte`;

  /* Die groesste Einheit, bei der noch eine Vorkommastelle uebrig bleibt. */
  let stufe = 0;
  let teiler = 1n;
  while (stufe < EINHEITEN.length - 1 && roh >= teiler * 1000n) {
    teiler *= 1000n;
    stufe += 1;
  }

  /*
   * Eine Nachkommastelle, kaufmaennisch gerundet — in `BigInt`, nie ueber
   * `Math.round` einer Gleitkommazahl. `hundertstel` sind die zwei Stellen
   * nach dem Komma als Ganzzahl (0…99), `+ 5n` rundet die zweite in die
   * erste.
   */
  let ganz = roh / teiler;
  const hundertstel = (roh * 100n) / teiler - ganz * 100n;
  let zehntel = (hundertstel + 5n) / 10n;
  if (zehntel >= 10n) { ganz += 1n; zehntel = 0n; }

  /*
   * Und der Uebertrag ueber die Einheitsgrenze: 999.950 Byte runden auf
   * „1000,0 kB", und das liest niemand als ein Megabyte. Eine Stufe hoeher,
   * solange es eine gibt.
   */
  if (ganz >= 1000n && stufe < EINHEITEN.length - 1) {
    ganz = 1n;
    zehntel = 0n;
    stufe += 1;
  }
  return `${String(ganz)},${String(zehntel)} ${EINHEITEN[stufe] ?? 'Byte'}`;
}

/** „PDF", „JPEG", „Word" — der Dateityp als Wort, nie als MIME-Zeile. */
export function dateityp(mime: string): string {
  const karte: Readonly<Record<string, string>> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPEG-Bild',
    'image/png': 'PNG-Bild',
    'image/webp': 'WebP-Bild',
    'text/csv': 'CSV-Tabelle',
    'text/plain': 'Textdatei',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word-Dokument',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel-Tabelle',
    'application/xml': 'XML-Datei',
    'text/xml': 'XML-Datei',
  };
  const treffer = karte[mime];
  if (treffer !== undefined) return treffer;
  /*
   * Der Rueckfall nennt die OBERgruppe und nicht die rohe MIME-Zeile: „Video"
   * sagt dem Kunden etwas, „video/quicktime; codecs=hvc1" nicht. Ein
   * unbekannter Typ heisst „Datei" — nie ein leeres Feld, das aussieht, als
   * fehlte etwas.
   */
  const gruppe = mime.split('/')[0] ?? '';
  if (gruppe === 'image') return 'Bild';
  if (gruppe === 'video') return 'Video';
  if (gruppe === 'audio') return 'Tonaufnahme';
  return 'Datei';
}

function alsZeile(z: DokumentZeile): Kundendokument {
  return {
    id: z.id,
    kategorie: z.kategorie,
    titel: z.titel,
    beschreibung: z.beschreibung,
    mimeTyp: z.mime_typ,
    groesseBytes: z.groesse_bytes,
    objektBezeichnung: z.objekt_bezeichnung,
    abgelegtAmLokal: z.abgelegt_lokal,
    version: z.version === null ? null : Number(z.version),
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
