import 'server-only';
import { createHash } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Speicher } from '../../storage/adapter.js';
import { erkenneMime } from '../../storage/mime.js';
import { entferneMetadaten } from '../../storage/exif.js';
import { istSvg, pruefeSvg, SvgFehler } from '../../storage/svg.js';

/**
 * **Logo, Avatar und Titelbild einer Gesellschaft** (V-100, TEN-07, PUB-09,
 * PUB-14, PRO-01, LEG-07, DESIGN §1/§4/§6, D-622).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `mandant_identitaet` trägt seit 0200 fünf Bildspalten — drei Logovarianten,
 * Avatar, Titelbild —, und keine davon liess sich setzen: kein Behälter, kein
 * Annahmeweg, kein Spaltenrecht. Der Bildschirm sagte es ehrlich („Hochgeladen
 * wird hier nichts — noch nicht"), aber eine Gesellschaft ohne eigenes Logo
 * ist auf ihrer eigenen Website eine Gesellschaft mit einem Platzhalter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Entscheidungen, und je ein Grund** (D-622).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. **Ein PRIVATER Behälter `marke`** — kein öffentlicher, auch nicht für
 *     Material, das ohnehin auf der Website steht. Der Stack sagt „private
 *     buckets, signed URLs only", und `adapter.ts` sagt, warum eine zweite
 *     Liste mit einem öffentlichen Behälter die Stelle ist, an der irgendwann
 *     etwas hineinfällt, das nicht öffentlich ist. Ausgeliefert wird über
 *     `/api/marke/…`, und die Route gibt ein Bild nur heraus, wenn die
 *     Identität veröffentlicht ist — oder der Anfragende in DIESER
 *     Gesellschaft angemeldet ist (Vorschau).
 *  2. **Logos als SVG, PNG oder JPEG; Avatar und Titelbild als PNG oder
 *     JPEG.** 01-KERN §6.2 nennt SVG für die Logos, und so liegen Logos
 *     meistens vor. Ein SVG ist aber ein Dokument mit Skriptfähigkeit:
 *     `storage/svg.ts` weist ab, was ein Bild nicht braucht, und die
 *     Auslieferung setzt eine CSP mit `sandbox`. PNG und JPEG sind die
 *     Rasterformate, für die `exif.ts` ein Bereinigungsverfahren hat — ein
 *     Titelbild mit den GPS-Daten des Aufnahmeorts ist genau die stille
 *     Preisgabe, die TIM-10 für Schichtfotos verhindert.
 *  3. **Der Schlüssel ist der Inhalt** (`<mandant>/<art>/<sha256>.<endung>`).
 *     Ein neues Logo überschreibt kein altes Objekt; ein altes Dokument, das
 *     auf ein altes Logo zeigt, zeigt weiter auf DAS Logo. Nichts wird
 *     gelöscht — „entfernen" nimmt die Zuordnung weg, nicht die Datei.
 *  4. **Der Alternativtext ist Teil des Hochladens**, nicht ein Feld
 *     daneben. `mi_alt_text` (0200) weist ein veröffentlichtes Bild ohne ihn
 *     ab; hier wird er vorher verlangt, mit einem Satz statt einer
 *     Constraintverletzung (PUB-09, LEG-07, BFSG).
 *  5. **`platzhalter_medien` bleibt, wie es ist.** Es ist eine Tatsache über
 *     die FOTOGRAFIE der vier Bereiche (O-13), nicht über ein einzelnes Bild —
 *     ein hochgeladenes Logo macht die übrigen Motivtafeln nicht echt.
 */

export type MarkenbildArt = 'logo_hell' | 'logo_dunkel' | 'logo_druck' | 'avatar' | 'cover';

export const MARKENBILD_ARTEN: readonly MarkenbildArt[] =
  ['logo_hell', 'logo_dunkel', 'logo_druck', 'avatar', 'cover'];

/** Anzeige in der Verwaltung — die Wörter, die der Bildschirm ohnehin führt. */
export const MARKENBILD_TITEL: Readonly<Record<MarkenbildArt, string>> = {
  logo_hell: 'Logo (hell)',
  logo_dunkel: 'Logo (dunkel)',
  logo_druck: 'Logo (Druck)',
  avatar: 'Avatar',
  cover: 'Titelbild',
};

/** Spalte des Pfads und des Alternativtexts — die drei Logos teilen EINEN Text (0200). */
const SPALTE: Readonly<Record<MarkenbildArt, { readonly pfad: string; readonly alt: string }>> = {
  logo_hell: { pfad: 'logo_hell_pfad', alt: 'logo_alt' },
  logo_dunkel: { pfad: 'logo_dunkel_pfad', alt: 'logo_alt' },
  logo_druck: { pfad: 'logo_druck_pfad', alt: 'logo_alt' },
  avatar: { pfad: 'avatar_pfad', alt: 'avatar_alt' },
  cover: { pfad: 'cover_pfad', alt: 'cover_alt' },
};

/** Was je Art angenommen wird — erkannt am Inhalt, nie am Namen. */
export function erlaubteTypen(art: MarkenbildArt): readonly string[] {
  return art.startsWith('logo_')
    ? ['image/svg+xml', 'image/png', 'image/jpeg']
    : ['image/png', 'image/jpeg'];
}

/** Die Endung eines Schlüssels — aus dem erkannten Typ. */
function endung(mime: string): 'svg' | 'png' | 'jpg' {
  return mime === 'image/svg+xml' ? 'svg' : mime === 'image/png' ? 'png' : 'jpg';
}

/** Der Typ eines abgelegten Bildes — aus der Endung seines Schlüssels, die der Dienst setzt. */
export function typAusSchluessel(schluessel: string): string {
  if (schluessel.endsWith('.svg')) return 'image/svg+xml';
  if (schluessel.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

/**
 * 8 MB — eine TECHNISCHE Grenze, keine Geschäftsregel: ein Titelbild in
 * Druckqualität liegt darunter, und alles darüber ist ein Rohbild, das
 * `next/image` ohnehin herunterrechnen müsste.
 */
export const MARKENBILD_MAX_BYTES = 8 * 1024 * 1024;

export const MARKE_BUCKET = 'marke' as const;

export class MarkenbildFehler extends Error {
  constructor(
    readonly grund: 'nicht_verbunden' | 'unbekannt' | 'leer' | 'zu_gross' | 'typ'
      | 'alt_text_fehlt' | 'nicht_hinterlegt' | 'kein_recht',
    nachricht: string,
    readonly status = 400,
  ) {
    super(nachricht);
    this.name = 'MarkenbildFehler';
  }
}

export function istMarkenbildArt(wert: string): wert is MarkenbildArt {
  return (MARKENBILD_ARTEN as readonly string[]).includes(wert);
}

/** Der Speicherschlüssel — aus dem Inhalt, nicht aus dem Dateinamen. */
export function markenbildSchluessel(
  mandantId: string, art: MarkenbildArt, bytes: Uint8Array, mime: string,
): string {
  const summe = createHash('sha256').update(bytes).digest('hex');
  return `${mandantId}/${art}/${summe}.${endung(mime)}`;
}

/**
 * Die Adresse, unter der das Bild ausgeliefert wird.
 *
 * Die Version ist ein Teil des Pfads und nicht ein Suchparameter: ein
 * geändertes Logo hat eine andere Adresse, also darf die alte unbegrenzt im
 * Zwischenspeicher liegen — und `next/image` behandelt sie als lokales Bild.
 */
export function markenbildAdresse(mandantId: string, art: MarkenbildArt, pfad: string): string {
  const version = /\/([0-9a-f]{16})[0-9a-f]*\.(?:svg|png|jpg)$/u.exec(pfad)?.[1] ?? 'v';
  return `/api/marke/${mandantId}/${art}/${version}`;
}

export interface MarkenbildEingabe {
  readonly art: MarkenbildArt;
  readonly daten: Uint8Array;
  readonly alt: string | null;
}

/**
 * Ein Bild setzen: prüfen, bereinigen, zuordnen, ablegen.
 *
 * **Die Zuordnung VOR der Ablage, in derselben Transaktion.** Scheitert die
 * Ablage, rollt die Zeile zurück, und keine Identität zeigt auf ein Objekt,
 * das es nicht gibt. Scheitert umgekehrt das Festschreiben nach der Ablage,
 * bleibt ein Objekt ohne Verweis — unschädlich, weil sein Name sein Inhalt
 * ist und nichts überschrieben wurde.
 */
export async function setzeMarkenbild(
  kontext: SchreibKontext, speicher: Speicher, e: MarkenbildEingabe,
): Promise<string> {
  if (!istMarkenbildArt(e.art)) {
    throw new MarkenbildFehler('unbekannt', 'Diese Bildart gibt es nicht.');
  }
  /* Nicht verbunden: NICHTS wird geschrieben — auch keine halbe Zuordnung. */
  if (!speicher.verbunden) {
    throw new MarkenbildFehler('nicht_verbunden',
      'Der Dateispeicher ist nicht verbunden (Einstellungen › Integrationen). Es wurde '
      + 'nichts gespeichert.', 503);
  }
  if (e.daten.length === 0) throw new MarkenbildFehler('leer', 'Die Datei ist leer.');
  if (e.daten.length > MARKENBILD_MAX_BYTES) {
    throw new MarkenbildFehler('zu_gross',
      `Die Datei ist größer als ${String(MARKENBILD_MAX_BYTES / 1024 / 1024)} MB.`, 413);
  }
  const mime = istSvg(e.daten) ? 'image/svg+xml' : erkenneMime(e.daten);
  if (mime === null || !erlaubteTypen(e.art).includes(mime)) {
    throw new MarkenbildFehler('typ', e.art.startsWith('logo_')
      ? 'Ein Logo als SVG, PNG oder JPEG — erkannt am Inhalt, nicht am Dateinamen.'
      : 'Avatar und Titelbild als PNG oder JPEG — erkannt am Inhalt, nicht am Dateinamen.');
  }
  if (mime === 'image/svg+xml') {
    try {
      pruefeSvg(e.daten);
    } catch (fehler: unknown) {
      if (fehler instanceof SvgFehler) throw new MarkenbildFehler('typ', fehler.message);
      throw fehler;
    }
  }

  const spalte = SPALTE[e.art];
  const [vorher] = await kontext.abfrage<{ alt: string | null }>(
    `select ${spalte.alt} as alt from mandant_identitaet where mandant_id = $1::uuid`,
    [kontext.aktiverMandantId]);
  if (vorher === undefined) {
    throw new MarkenbildFehler('nicht_hinterlegt',
      'Für diesen Bereich ist keine Identitätszeile hinterlegt (0200/0336).', 404);
  }
  const alt = (e.alt ?? '').trim() !== '' ? (e.alt ?? '').trim() : (vorher.alt ?? '').trim();
  if (alt === '') {
    throw new MarkenbildFehler('alt_text_fehlt',
      'Ein Bild braucht einen Alternativtext — er ist das Bild für alle, die es nicht '
      + 'sehen (PUB-09, LEG-07, BFSG).');
  }

  /* Ein SVG trägt keine Kameradaten; die Prüfung oben hat es bereits gelesen. */
  const bereinigt = mime === 'image/svg+xml' ? e.daten : entferneMetadaten(e.daten, mime).bytes;
  const schluessel = markenbildSchluessel(kontext.aktiverMandantId, e.art, bereinigt, mime);

  /*
   * `returning` und nicht nur `update`: lesen darf jede Rolle des Bereichs,
   * schreiben nur `system.identitaet_verwalten` (t_mi_schreiben). Ohne das
   * Recht trifft das UPDATE still null Zeilen — und ohne diese Prüfung ginge
   * es danach weiter, mit Protokollzeile und abgelegter Datei für eine
   * Änderung, die nicht stattfand (Invariante 3: RLS ist die zweite Linie).
   */
  const [geschrieben] = await kontext.schreibe<{ mandant_id: string }>(
    `update mandant_identitaet
        set ${spalte.pfad} = $2, ${spalte.alt} = $3, geaendert_von = $4::uuid
      where mandant_id = $1::uuid
      returning mandant_id`,
    [kontext.aktiverMandantId, schluessel, alt, kontext.benutzerId]);
  if (geschrieben === undefined) {
    throw new MarkenbildFehler('kein_recht',
      'Bilder der Identität pflegt, wer „Identität verwalten" hält. Es wurde nichts '
      + 'gespeichert.', 403);
  }
  await kontext.schreibe(
    `select app.protokolliere('mandant.markenbild_gesetzt', 'mandant_identitaet',
                              $1, null, $2::jsonb, app.aktiver_mandant())`,
    [kontext.aktiverMandantId, {
      art: e.art, schluessel, mime, bytes: bereinigt.length,
    }]);

  await speicher.lege(MARKE_BUCKET, schluessel, bereinigt);
  return schluessel;
}

/**
 * Die Zuordnung wegnehmen — die Datei bleibt, wo sie ist.
 *
 * Der Alternativtext bleibt ebenfalls stehen: er ist Text, er gehört zur
 * Gesellschaft und nicht zur Datei, und das nächste Bild braucht ihn wieder.
 */
export async function entferneMarkenbild(
  kontext: SchreibKontext, art: MarkenbildArt,
): Promise<void> {
  if (!istMarkenbildArt(art)) {
    throw new MarkenbildFehler('unbekannt', 'Diese Bildart gibt es nicht.');
  }
  const spalte = SPALTE[art];
  const [zeile] = await kontext.abfrage<{ pfad: string | null }>(
    `select ${spalte.pfad} as pfad from mandant_identitaet where mandant_id = $1::uuid`,
    [kontext.aktiverMandantId]);
  if (zeile === undefined) {
    throw new MarkenbildFehler('nicht_hinterlegt',
      'Für diesen Bereich ist keine Identitätszeile hinterlegt (0200/0336).', 404);
  }
  if (zeile.pfad === null) return;
  const [geschrieben] = await kontext.schreibe<{ mandant_id: string }>(
    `update mandant_identitaet set ${spalte.pfad} = null, geaendert_von = $2::uuid
      where mandant_id = $1::uuid
      returning mandant_id`,
    [kontext.aktiverMandantId, kontext.benutzerId]);
  if (geschrieben === undefined) {
    throw new MarkenbildFehler('kein_recht',
      'Bilder der Identität pflegt, wer „Identität verwalten" hält. Es wurde nichts '
      + 'geändert.', 403);
  }
  await kontext.schreibe(
    `select app.protokolliere('mandant.markenbild_entfernt', 'mandant_identitaet',
                              $1, $2::jsonb, null, app.aktiver_mandant())`,
    [kontext.aktiverMandantId, { art, schluessel: zeile.pfad }]);
}

export interface Markenbild {
  readonly pfad: string;
  readonly alt: string;
}

/**
 * Ein Bild für die ÖFFENTLICHE Auslieferung — nur aus einer veröffentlichten
 * Identität, und nur über die Projektions-View (0200 §3). Der Renderer der
 * Website ist ein angemeldeter Dienstprinzipal und sähe über `t_mi_lesen`
 * auch unveröffentlichte Zeilen; die Bedingung steht deshalb HIER, nicht nur
 * in einer Policy.
 */
export async function oeffentlichesMarkenbild(
  kontext: LeseKontext, mandantId: string, art: MarkenbildArt,
): Promise<Markenbild | null> {
  const spalte = SPALTE[art];
  const [z] = await kontext.abfrage<{ pfad: string | null; alt: string | null }>(
    `select ${spalte.pfad} as pfad, ${spalte.alt} as alt
       from mandant_identitaet_oeffentlich
      where mandant_id = $1::uuid and oeffentlich_sichtbar`,
    [mandantId]);
  if (z?.pfad === null || z?.pfad === undefined) return null;
  return { pfad: z.pfad, alt: z.alt ?? '' };
}

/** Ein Bild der AKTIVEN Gesellschaft — für die Vorschau in der Verwaltung. */
export async function eigenesMarkenbild(
  kontext: LeseKontext, mandantId: string, art: MarkenbildArt,
): Promise<Markenbild | null> {
  const spalte = SPALTE[art];
  const [z] = await kontext.abfrage<{ pfad: string | null; alt: string | null }>(
    `select ${spalte.pfad} as pfad, ${spalte.alt} as alt
       from mandant_identitaet
      where mandant_id = $1::uuid and mandant_id = app.aktiver_mandant()`,
    [mandantId]);
  if (z?.pfad === null || z?.pfad === undefined) return null;
  return { pfad: z.pfad, alt: z.alt ?? '' };
}

/** Ein Bild, wie die Website es bekommt: die Adresse der Auslieferung und der Alternativtext. */
export interface Bildverweis {
  readonly adresse: string;
  readonly alt: string;
}

/** Die veröffentlichten Bilder einer Gesellschaft — für die Website. */
export interface OeffentlicheMarke {
  readonly logoHell: Bildverweis | null;
  readonly logoDunkel: Bildverweis | null;
  readonly avatar: Bildverweis | null;
  readonly cover: Bildverweis | null;
}

export const OHNE_MARKE: OeffentlicheMarke = {
  logoHell: null, logoDunkel: null, avatar: null, cover: null,
};

/**
 * Aus den Spalten der Projektions-View die Verweise der Website machen.
 *
 * Eine reine Funktion und kein Teil der Abfrage: `bereicheLesen` liest die
 * Spalten in DERSELBEN Abfrage wie Firma und Anschrift, und diese Datei sagt
 * nur, wie daraus eine Adresse wird.
 */
export function oeffentlicheMarkeAus(mandantId: string, z: {
  readonly logo_hell_pfad: string | null; readonly logo_dunkel_pfad: string | null;
  readonly logo_alt: string | null;
  readonly avatar_pfad: string | null; readonly avatar_alt: string | null;
  readonly cover_pfad: string | null; readonly cover_alt: string | null;
}): OeffentlicheMarke {
  const bild = (pfad: string | null, alt: string | null, art: MarkenbildArt): Bildverweis | null =>
    pfad === null ? null : { adresse: markenbildAdresse(mandantId, art, pfad), alt: alt ?? '' };
  return {
    logoHell: bild(z.logo_hell_pfad, z.logo_alt, 'logo_hell'),
    logoDunkel: bild(z.logo_dunkel_pfad, z.logo_alt, 'logo_dunkel'),
    avatar: bild(z.avatar_pfad, z.avatar_alt, 'avatar'),
    cover: bild(z.cover_pfad, z.cover_alt, 'cover'),
  };
}
