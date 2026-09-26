import { createHash } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Speicher } from '../../storage/adapter.js';
import { erkenneMime } from '../../storage/mime.js';
import { entferneMetadaten } from '../../storage/exif.js';
import { MARKE_BUCKET, MARKENBILD_MAX_BYTES } from '../mandant/markenbild.js';

/**
 * **Ein Bild für einen Beitrag** (SOC-02, V-225, D-719).
 *
 * **Der Befund.** SOC-02 nennt Bilder als Inhalt, und 0163 hängt sie als
 * `beitrag.medien_id` an jeden Beitrag — keine Zeile Code schrieb oder las
 * diese Spalte, und für `medien` gab es gar keinen Annahmeweg. Das Formular
 * hatte kein Dateifeld, die öffentliche Beitragsseite zeigte nur Text.
 *
 * **Die Entscheidungen, jede mit ihrem Grund.**
 *
 *  1. **Privater Behälter, signierte Adresse** (DOC-03, Stack: „private
 *     buckets, signed URLs only"). Das Bild liegt im Behälter `marke` — dem,
 *     der schon Material für die Website trägt und schon über eine eigene
 *     Tür ausgeliefert wird (V-100). Ein öffentlicher Behälter „nur für
 *     Beitragsbilder" wäre genau die zweite Liste, vor der `adapter.ts`
 *     warnt. Ausgeliefert wird über `/api/beitragsbild/<id>`: die Route prüft, dass
 *     das Bild an einem VERÖFFENTLICHTEN Beitrag hängt (oder die Sitzung zu
 *     dieser Gesellschaft gehört und `social.lesen` hält — Vorschau) und
 *     leitet auf eine signierte Adresse mit 15 Minuten Laufzeit.
 *  2. **Dieselbe Prüfung wie bei Logo und Titelbild** (`markenbild.ts`): Typ
 *     aus dem INHALT (PNG oder JPEG), Metadaten entfernt — ein Foto mit den
 *     GPS-Daten des Aufnahmeorts ist genau die stille Preisgabe, die TIM-10
 *     für Schichtfotos verhindert —, dieselbe technische Grössengrenze.
 *  3. **Der Schlüssel ist der Inhalt** (`<mandant>/beitrag/<sha256>.<endung>`):
 *     nichts wird überschrieben; ein neues Bild ist eine neue Zeile.
 *  4. **Der Alternativtext ist Pflicht** (`medien.alt_text`, 0014; PUB-09,
 *     BFSG) und wird VOR dem Hochladen verlangt, mit einem Satz statt einer
 *     Constraintverletzung.
 */

export class MedienFehler extends Error {
  constructor(
    readonly grund: 'nicht_verbunden' | 'leer' | 'zu_gross' | 'typ' | 'alt_text_fehlt'
      | 'kein_recht',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'MedienFehler';
  }
}

/** PNG und JPEG — die Rasterformate, für die `exif.ts` ein Verfahren hat. */
export const BEITRAGSBILD_TYPEN: readonly string[] = ['image/png', 'image/jpeg'];

/** Der Speicherschlüssel — aus dem Inhalt, nicht aus dem Dateinamen. */
export function beitragsbildSchluessel(mandantId: string, bytes: Uint8Array, mime: string): string {
  const summe = createHash('sha256').update(bytes).digest('hex');
  return `${mandantId}/beitrag/${summe}.${mime === 'image/png' ? 'png' : 'jpg'}`;
}

/** Die Adresse der Auslieferung — ohne Zone und ohne Schlüssel. */
export function medienAdresse(medienId: string): string {
  return `/api/beitragsbild/${medienId}`;
}

export interface BeitragsbildEingabe {
  readonly daten: Uint8Array;
  readonly alt: string;
}

/**
 * Ein Bild annehmen: prüfen, bereinigen, als `medien`-Zeile anlegen, ablegen.
 *
 * **Die Zeile VOR der Ablage, in derselben Transaktion** — wie beim
 * Markenbild: scheitert die Ablage, rollt die Zeile zurück; scheitert das
 * Festschreiben danach, bleibt ein Objekt ohne Verweis, das niemand
 * ausliefert, weil sein Name sein Inhalt ist und keine Zeile auf ihn zeigt.
 */
export async function legeBeitragsbildAn(
  kontext: SchreibKontext, speicher: Speicher, e: BeitragsbildEingabe,
): Promise<string> {
  if (!speicher.verbunden) {
    throw new MedienFehler('nicht_verbunden',
      'Der Dateispeicher ist nicht verbunden (Einstellungen › Integrationen). Es wurde nichts '
      + 'gespeichert.');
  }
  // TODO(client, O-939): Welchen Nachweis (Nutzungsrecht, Einwilligung erkennbarer Personen)
  // verlangt die Plattform, bevor ein Bild an einem Beitrag hinausgeht? Heute: keinen.
  const alt = e.alt.trim();
  if (alt.length < 3) {
    throw new MedienFehler('alt_text_fehlt',
      'Ein Bild braucht einen Alternativtext — er ist das Bild für alle, die es nicht sehen '
      + '(PUB-09, BFSG).');
  }
  if (e.daten.length === 0) throw new MedienFehler('leer', 'Die Datei ist leer.');
  if (e.daten.length > MARKENBILD_MAX_BYTES) {
    throw new MedienFehler('zu_gross',
      `Die Datei ist größer als ${String(MARKENBILD_MAX_BYTES / 1024 / 1024)} MB.`);
  }
  const mime = erkenneMime(e.daten);
  if (mime === null || !BEITRAGSBILD_TYPEN.includes(mime)) {
    throw new MedienFehler('typ', 'Ein Beitragsbild als PNG oder JPEG — erkannt am Inhalt, '
      + 'nicht am Dateinamen.');
  }
  const bereinigt = entferneMetadaten(e.daten, mime).bytes;
  const schluessel = beitragsbildSchluessel(kontext.aktiverMandantId, bereinigt, mime);

  /*
   * Die Kennung entsteht in der Datenbank; die Adresse (`pfad`) setzt der
   * Auslöser aus 0473 nicht — sie steht deshalb hier, aus der Kennung, in
   * derselben Anweisung. `returning`: ohne `social.schreiben` weist die Policy
   * ab, und dann gibt es nichts abzulegen.
   */
  const [z] = await kontext.schreibe<{ id: string }>(
    `with neu as (select gen_random_uuid() as id)
     insert into medien (id, mandant_id, pfad, alt_text, ist_platzhalter, quelle,
                         bucket, objekt_schluessel)
     select neu.id, app.aktiver_mandant(), '/api/beitragsbild/' || neu.id::text, $1, false,
            'Hochgeladen im Social Media Center', $2, $3
       from neu
     returning id`,
    [alt, MARKE_BUCKET, schluessel]);
  if (z === undefined) {
    throw new MedienFehler('kein_recht', 'Bilder für Beiträge legt ab, wer Beiträge schreiben '
      + 'darf. Es wurde nichts gespeichert.');
  }
  await speicher.lege(MARKE_BUCKET, schluessel, bereinigt);
  return z.id;
}

export interface MedienOrt {
  readonly bucket: string;
  readonly schluessel: string;
}

/**
 * Wo ein Beitragsbild liegt — nur, wenn es ausgeliefert werden DARF.
 *
 * Öffentlich: das Bild hängt an einem veröffentlichten, nicht
 * zurückgezogenen Beitrag. Sonst nur in einer Sitzung derselben Gesellschaft
 * (Vorschau am Entwurf). `null` heisst 404 — nie 403 (AUT-06).
 */
export async function oeffentlichesBeitragsbild(
  kontext: LeseKontext, medienId: string,
): Promise<MedienOrt | null> {
  const [z] = await kontext.abfrage<{ bucket: string; schluessel: string }>(
    `select m.bucket, m.objekt_schluessel as schluessel
       from medien m
      where m.id = $1::uuid and m.objekt_schluessel is not null
        and exists (select 1 from beitrag b
                     where b.medien_id = m.id and b.mandant_id = m.mandant_id
                       and b.status = 'veroeffentlicht' and b.zurueckgezogen_am is null)`,
    [medienId]);
  return z ?? null;
}

/**
 * Die Vorschau am Entwurf — nur in einer Sitzung DIESER Gesellschaft, und nur
 * für wen Beiträge lesen darf (`social.lesen`): die Zeile in `medien` ist
 * lesbar, der Inhalt eines unveröffentlichten Bildes ist es nicht.
 */
export async function eigenesBeitragsbild(
  kontext: LeseKontext, medienId: string,
): Promise<MedienOrt | null> {
  const [z] = await kontext.abfrage<{ bucket: string; schluessel: string }>(
    `select m.bucket, m.objekt_schluessel as schluessel
       from medien m
      where m.id = $1::uuid and m.objekt_schluessel is not null
        and m.mandant_id = app.aktiver_mandant()
        and app.hat_recht('social.lesen', app.aktiver_mandant())`,
    [medienId]);
  return z ?? null;
}
