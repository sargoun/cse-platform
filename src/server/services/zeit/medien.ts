/**
 * Medienerfassung auf der Schicht (TIM-10, DOC-03, DOC-06, SEC-A6, LEG-10).
 *
 * Die Reihenfolge ist die ganze Sicherheit, und sie ist bewusst so:
 *
 *   1. Groesse  — bevor irgendetwas gelesen wird, das zu gross ist.
 *   2. Typ      — aus MAGIC BYTES, nie aus Name oder Content-Type.
 *   3. Metadaten entfernen — auf den Bytes, die gespeichert werden.
 *   4. Speichern.
 *   5. Zeile schreiben — als LETZTES, und nur wenn 4 geklappt hat.
 *
 * Wer 3 nach 4 stellt, hat das Foto mit GPS bereits im Bucket; wer 5 vor 4
 * stellt, hat eine Zeile, hinter der keine Datei liegt. Beides faellt erst auf,
 * wenn jemand das Bild braucht — also im Streitfall.
 *
 * **Der Dienst rechnet nichts und entscheidet keine Geschaeftsregel.** Er
 * prueft, bereinigt, legt ab und gibt zurueck, was in der Zeile stehen muss.
 *
 * **Die ZEILE schreibt er auf ZWEI Wegen, und sie sind nicht derselbe.** Fuer
 * den Check-in mit der Marke schreibt sie `app.offline_ereignis_annehmen`,
 * weil dort Mandant, Beschaeftigung und Mensch aus der Marke aufgeloest werden
 * — nie aus der Anfrage (K-08). Fuer die ANGEMELDETE Kraft schreibt sie
 * `legeSchichtMediumAb` unten, und dort gilt die umgekehrte Reihenfolge:
 * ZEILE, dann Bucket, beides in EINER Transaktion (`verzoegerterSpeicher`).
 * Die Begruendung steht bei der Funktion — kurz: die Sitzung hat eine
 * Transaktion, die Marke nicht.
 */
import { createHash, randomUUID } from 'node:crypto';
import { entferneMetadaten } from '../../storage/exif.js';
import { erkenneMime, MimeFehler } from '../../storage/mime.js';
import { SIGNATUR_SEKUNDEN, type Bucket, type Speicher } from '../../storage/adapter.js';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/** Der eine private Bucket fuer Schichtmedien (07-INTEGRATIONEN §6.4). */
export const MEDIEN_BUCKET: Bucket = 'einsatz-medien';

/**
 * 100 MiB — **dieselbe Zahl wie `me_groesse` in `0041`**, und sie steht an
 * beiden Stellen mit Absicht.
 *
 * Der Dienst weist vorher ab, damit ein zu grosses Video gar nicht erst durch
 * die Leitung geht; die Datenbankbedingung ist die zweite Linie fuer den Fall,
 * dass jemand am Dienst vorbei schreibt. Eine TECHNISCHE Obergrenze, keine
 * Geschaeftsregel: sie schuetzt Bucket und Leitung, nicht eine Abrechnung.
 */
export const MEDIEN_MAX_BYTES = 104_857_600;

/**
 * Was auf einer Schicht aufgenommen werden darf — die geschlossene Liste aus
 * `04-PLANUNG-ZEIT.md` §5.8, zeichengleich mit der `me_mime`-Bedingung.
 *
 * Sie ist ENGER als `ERLAUBTE_MIME` aus dem Dokumentenpfad, und das ist der
 * Punkt: ein PDF oder eine Tabelle ist kein Zustandsbeweis einer Schicht, und
 * eine Liste, die beides zulaesst, macht aus dem Medienbucket eine zweite
 * Dokumentenablage ohne deren Aufbewahrungsregeln.
 */
export const MEDIEN_MIME: readonly string[] = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime',
];

export type MedienArt = 'foto' | 'video';

export class MedienFehler extends Error {
  readonly status = 422 as const;
  constructor(nachricht: string, readonly grund:
    'zu_gross' | 'leer' | 'typ_unbekannt' | 'typ_nicht_erlaubt' | 'widerspruch' | 'bereinigung') {
    super(nachricht);
    this.name = 'MedienFehler';
  }
}

export interface MedienEingabe {
  /** Fuehrt den Objektschluessel an. Kommt aus der MARKE, nie aus der Anfrage. */
  readonly mandantId: string;
  /** Die id, unter der das Objekt liegt — vom Aufrufer gepraegt, eine UUID. */
  readonly medienId: string;
  readonly daten: Uint8Array;
  /** Was der Browser behauptet. Wird verglichen, nie geglaubt. */
  readonly behaupteterTyp?: string | null;
  /** Die Behauptung des Geraets ueber den Aufnahmezeitpunkt. Nie massgeblich. */
  readonly aufgenommenAmGeraet?: Date | null;
  readonly beschreibung?: string | null;
}

/** Genau die Felder, die `einsatz_medien` braucht — nichts darueber hinaus. */
export interface MedienAblage {
  readonly art: MedienArt;
  readonly bucket: Bucket;
  readonly pfad: string;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly sha256: string;
  readonly exifEntfernt: true;
  readonly aufgenommenAmGeraet: string | null;
  readonly beschreibung: string | null;
}

/**
 * Die Groessenpruefung steht getrennt, damit die Route sie VOR dem Einlesen
 * des Rumpfes aufrufen kann (`content-length`) und noch einmal danach.
 *
 * Nur der zweite Aufruf ist die Zusage: `content-length` kommt vom Absender.
 * Der erste erspart nur, 400 MB entgegenzunehmen, um sie dann wegzuwerfen.
 */
export function pruefeMedienGroesse(bytes: number): void {
  if (bytes <= 0) throw new MedienFehler('Leere Datei.', 'leer');
  if (bytes > MEDIEN_MAX_BYTES) {
    throw new MedienFehler(
      `Die Datei ist ${String(Math.round(bytes / 1_048_576))} MB gross. `
      + `Erlaubt sind ${String(MEDIEN_MAX_BYTES / 1_048_576)} MB.`,
      'zu_gross',
    );
  }
}

/** `video/*` heisst `video`, alles andere `foto` — TIM-10 kennt genau zwei. */
export function artFuer(mime: string): MedienArt {
  return mime.startsWith('video/') ? 'video' : 'foto';
}

/**
 * Prueft, bereinigt, legt ab — und gibt zurueck, was in die Zeile gehoert.
 *
 * Der Speicher wird UEBERGEBEN, nicht hier gebaut. Ist er nicht verbunden,
 * wirft `lege` einen `NichtVerbundenFehler`, die Route sagt „nicht verbunden",
 * und es entsteht KEINE Zeile — niemals ein vorgetaeuschter Erfolg
 * (CLAUDE.md: keine Schein-Integrationen).
 */
export async function legeMediumAb(
  eingabe: MedienEingabe,
  speicher: Speicher,
): Promise<MedienAblage> {
  pruefeMedienGroesse(eingabe.daten.length);

  const erkannt = erkenneMime(eingabe.daten);
  if (erkannt === null) {
    throw new MedienFehler(
      'Der Dateityp liess sich anhand des Inhalts nicht bestimmen und wird abgelehnt.',
      'typ_unbekannt',
    );
  }
  if (!MEDIEN_MIME.includes(erkannt)) {
    throw new MedienFehler(
      `Dateityp ${erkannt} ist fuer Schichtaufnahmen nicht zugelassen.`,
      'typ_nicht_erlaubt',
    );
  }
  /**
   * Der behauptete Typ fliesst NICHT ins Ergebnis ein — er wird nur
   * verglichen, um einen Widerspruch benennen zu koennen. Eine Datei, die als
   * Foto deklariert ist und etwas anderes enthaelt, wird nicht „als das
   * erkannt, was sie wirklich ist" und dann gespeichert: sie wird abgelehnt.
   */
  const behauptet = eingabe.behaupteterTyp ?? '';
  if (behauptet !== '' && behauptet !== erkannt) {
    throw new MedienFehler(
      `Der Inhalt ist ${erkannt}, deklariert war ${behauptet}. Abgelehnt.`,
      'widerspruch',
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = entferneMetadaten(eingabe.daten, erkannt).bytes;
  } catch (fehler: unknown) {
    throw new MedienFehler(
      fehler instanceof Error ? fehler.message : 'Metadaten liessen sich nicht entfernen.',
      'bereinigung',
    );
  }

  /**
   * Der Pfad besteht NUR aus UUID-Segmenten (`me_pfad_uuid` in 0041). Weder
   * Objektname noch Datum noch Personalnummer: eine versehentlich
   * weitergegebene Adresse soll nichts ueber ihren Inhalt verraten, und ein
   * Bucket-Listing ist kein Verzeichnis der Belegschaft.
   */
  const pfad = `${eingabe.mandantId}/${eingabe.medienId}`;

  await speicher.lege(MEDIEN_BUCKET, pfad, bytes);

  return {
    art: artFuer(erkannt),
    bucket: MEDIEN_BUCKET,
    pfad,
    mimeTyp: erkannt,
    groesseBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    /**
     * Immer `true`, und die Datenbank laesst die Zeile ohnehin nicht anders
     * entstehen (`me_exif`). Der Wert sagt „durch die Bereinigung gegangen",
     * nicht „hatte welche" — ein JPEG ohne EXIF ist bereinigt.
     */
    exifEntfernt: true,
    aufgenommenAmGeraet: eingabe.aufgenommenAmGeraet?.toISOString() ?? null,
    beschreibung: eingabe.beschreibung ?? null,
  };
}

/** Der Fehler, den `pruefeUpload` aus dem Dokumentenpfad wirft, in unserer Form. */
export function ausMimeFehler(fehler: unknown): MedienFehler {
  if (fehler instanceof MimeFehler) {
    return new MedienFehler(fehler.message,
      fehler.grund === 'leer' ? 'leer'
        : fehler.grund === 'widerspruch' ? 'widerspruch'
          : fehler.grund === 'unbekannt' ? 'typ_unbekannt' : 'typ_nicht_erlaubt');
  }
  return new MedienFehler('Der Upload liess sich nicht pruefen.', 'typ_unbekannt');
}

/**
 * Der Lesepfad: eine signierte Adresse, sonst nichts (TIM-10, DOC-03, SEC-A6).
 *
 * **Die Zeile wird durch die Sitzung des Aufrufers gelesen, nicht als Definer.**
 * Damit prueft die Datenbank dieselbe Bedingung noch einmal, die auch die Liste
 * geprueft hat — Mandant, Modulrecht, Mitarbeiterdecke, Kundendecke. Eine
 * Storage-Policy allein taete das NICHT: sie kennt weder den aktiven Mandanten
 * noch das Modulrecht, und wer eine Objekt-id erraet, bekaeme die Datei.
 *
 * Null Zeilen ergeben 404 und nie 403: ein 403 bestaetigt, dass es die Zeile
 * gibt (AUT-06).
 */
export interface MedienZeile {
  readonly id: string;
  readonly bucket: Bucket;
  readonly pfad: string;
  readonly mimeTyp: string;
  readonly art: MedienArt;
  readonly storageGeloeschtAm: Date | null;
}

interface MedienDbZeile {
  id: string;
  bucket: string;
  pfad: string;
  mime_typ: string;
  art: string;
  storage_geloescht_am: Date | null;
}

/** Die Zeile, oder `null` — was RLS nicht durchlaesst, existiert fuer uns nicht. */
export async function findeMedium(
  kontext: LeseKontext, id: string,
): Promise<MedienZeile | null> {
  const zeilen = await kontext.abfrage<MedienDbZeile>(
    `select id, bucket, pfad, mime_typ, art, storage_geloescht_am
       from einsatz_medien
      where id = $1::uuid and archiviert_am is null`,
    [id],
  );
  const z = zeilen[0];
  if (z === undefined) return null;
  return {
    id: z.id,
    bucket: z.bucket as Bucket,
    pfad: z.pfad,
    mimeTyp: z.mime_typ,
    art: z.art === 'video' ? 'video' : 'foto',
    storageGeloeschtAm: z.storage_geloescht_am,
  };
}

/** Die Binaerdatei wurde nach LEG-09 entfernt; die Zeile blieb als Grabstein. */
export class MediumEntferntFehler extends Error {
  readonly status = 410 as const;
  readonly code = 'medium_entfernt' as const;
  constructor() {
    super('Diese Aufnahme wurde gelöscht. Der Nachweis, dass es sie gab, bleibt bestehen.');
    this.name = 'MediumEntferntFehler';
  }
}

export interface MedienAdresse {
  readonly url: string;
  /** Sekunden seit Epoch — was die Oberflaeche braucht, um rechtzeitig neu zu holen. */
  readonly gueltigBis: number;
  readonly mimeTyp: string;
}

export async function signierteMedienAdresse(
  kontext: LeseKontext,
  id: string,
  speicher: Speicher,
  /** Uebergeben, nicht aus der Uhr gelesen — damit der Ablauf pruefbar ist. */
  jetztSekunden: number,
): Promise<MedienAdresse | null> {
  const zeile = await findeMedium(kontext, id);
  if (zeile === null) return null;
  if (zeile.storageGeloeschtAm !== null) throw new MediumEntferntFehler();

  return {
    url: await speicher.signierteUrl(zeile.bucket, zeile.pfad, SIGNATUR_SEKUNDEN),
    gueltigBis: jetztSekunden + SIGNATUR_SEKUNDEN,
    mimeTyp: zeile.mimeTyp,
  };
}

/**
 * Schreibt die Zeile zu einem bereits abgelegten Objekt.
 *
 * `kunde_id` wird NICHT mitgeschickt: `kern.einsatz_medien_bezug_pruefen`
 * (0041) leitet sie als Definer aus dem Elternteil ab und verwirft, was der
 * Aufrufer schickt — sonst waere die Kundensichtbarkeit eine Eingabe.
 * `zeiteintrag_id` ist eine GENERATED-Spalte und darf gar nicht gesetzt werden.
 *
 * Gibt die Kennung zurueck, unter der das Objekt im Bucket liegt — sie ist
 * dieselbe, die der Aufrufer `legeMediumAb` gegeben hat, damit ein Scheitern
 * hier das Objekt wieder entfernen kann.
 */
export async function legeSchichtMediumAb(
  kontext: SchreibKontext,
  eingabe: {
    readonly einsatzId: string;
    readonly medienId?: string;
    readonly ablage: MedienAblage;
  },
): Promise<string> {
  const id = eingabe.medienId ?? randomUUID();
  await kontext.schreibe(
    `insert into einsatz_medien
       (id, mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad, mime_typ,
        groesse_bytes, sha256, exif_entfernt, aufgenommen_am_geraet, beschreibung,
        erstellt_von_art, erstellt_von, erstellt_von_person_id)
     values ($1::uuid, $2::uuid, 'einsatz', $3::uuid, $4::medien_art, $5, $6, $7,
             $8::bigint, $9, true, $10::timestamptz, $11,
             'mensch', app.aktueller_benutzer(), app.aktuelle_person())`,
    [
      id, kontext.aktiverMandantId, eingabe.einsatzId,
      eingabe.ablage.art, eingabe.ablage.bucket, eingabe.ablage.pfad,
      eingabe.ablage.mimeTyp, String(eingabe.ablage.groesseBytes), eingabe.ablage.sha256,
      eingabe.ablage.aufgenommenAmGeraet, eingabe.ablage.beschreibung,
    ],
  );
  return id;
}

/**
 * Ein Speicher, der die Bytes ZURUECKHAELT, bis die Zeile steht.
 *
 * **Warum die Reihenfolge hier anders ist als im Check-in-Weg.** `zeit/medien.ts`
 * legt erst ins Bucket und ueberlaesst die Zeile dem Aufrufer; scheitert die,
 * muss er das Objekt wieder entfernen (`api/check-in/[token]/medien`). Das ist
 * dort richtig, weil die Marke die Zeile in einer EIGENEN Transaktion schreibt
 * (`app.offline_ereignis_annehmen`, K-08) — zwei Transaktionen lassen sich nicht
 * gemeinsam zurueckrollen.
 *
 * Die angemeldete Sitzung hat eine. Also wird hier umgedreht:
 *
 *   Groesse → Typ → Metadaten entfernen → ZEILE → Bucket → commit.
 *
 * Scheitert das Bucket, rollt die Transaktion zurueck: keine Zeile, kein
 * Objekt, nichts aufzuraeumen. Ist der Speicher gar nicht verbunden, wirft er
 * beim Schreiben, und es entsteht ebenfalls KEINE Zeile — kein vorgetaeuschter
 * Erfolg (CLAUDE.md). Uebrig bleibt genau ein Fenster: das Objekt liegt, und
 * der Commit scheitert danach. Dafuer gibt es `job:medien_waisen`, und es ist
 * um Groessenordnungen schmaler als „Bucket zuerst".
 *
 * Der Umweg ist KEINE Schein-Integration: geschrieben wird durch denselben
 * echten Adapter, nur eine Anweisung spaeter.
 */
export interface VerzoegerterSpeicher extends Speicher {
  /** Schreibt, was zurueckgehalten wurde. Ohne Aufnahme ein No-op. */
  schreibeJetzt(): Promise<void>;
}

export function verzoegerterSpeicher(echt: Speicher): VerzoegerterSpeicher {
  let gemerkt: { bucket: Bucket; schluessel: string; daten: Uint8Array } | null = null;
  return {
    /* Die Verbundenheit ist die des echten Adapters — der Puffer taeuscht sie nicht vor. */
    verbunden: echt.verbunden,
    lege: async (bucket, schluessel, daten) => {
      gemerkt = { bucket, schluessel, daten };
    },
    /**
     * Gelesen wird immer vom ECHTEN Speicher.
     *
     * Die gepufferten Bytes zurueckzugeben waere die Behauptung, das Objekt
     * liege schon — und der Aufrufer bekaeme einen Erfolg, den es nicht gibt.
     */
    hole: async (bucket, schluessel) => echt.hole(bucket, schluessel),
    /**
     * Der Puffer LOESCHT NICHT — auch nicht durchgereicht.
     *
     * Er braucht es nicht: was er zurueckhaelt, ist noch nirgends. Und ein
     * Loeschweg, der hier durchreichte, waere ein zweiter am Archiv vorbei
     * (DOC-07, ACC-06): das Vergessen des Speichers geht ueber
     * `dokument/loeschung.ts`, nach dem weichen Loeschen der Zeile, das die
     * Datenbank fuer gesperrte und bebuchte Dokumente abweist.
     */
    entferne: async () => {
      throw new Error(
        'Der verzoegerte Speicher loescht nicht. Der einzige Loeschweg ist '
        + 'server/services/dokument/loeschung.ts (DOC-07).',
      );
    },
    signierteUrl: async (bucket, schluessel, sekunden) =>
      echt.signierteUrl(bucket, schluessel, sekunden),
    schreibeJetzt: async () => {
      if (gemerkt === null) return;
      await echt.lege(gemerkt.bucket, gemerkt.schluessel, gemerkt.daten);
    },
  };
}
