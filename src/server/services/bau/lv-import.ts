/**
 * Der LV-Import mit Vorschau (BAU-01, REQ-04, Muster OPS-04).
 *
 * **Die Vorschau ist nicht Hoeflichkeit, sie ist die Zusage:** nichts
 * beruehrt ein Leistungsverzeichnis, bevor ein Mensch gesehen hat, was
 * passieren wird. Ein Import, der direkt schreibt, macht aus einer
 * verrutschten Spalte tausend falsche Einheitspreise — und die fallen erst in
 * der Schlussrechnung auf, wo sie plausibel aussehen.
 *
 * Drei Dinge unterscheiden diesen Import von dem des Raumbuchs:
 *
 *  1. **Uebernommen wird in eine NEUE FASSUNG**, nie in die bestehende
 *     hinein. `leistungsverzeichnis.fassung` ist genau dafuer da: die alte
 *     Fassung ist der Beleg dessen, was urspruenglich vereinbart oder
 *     eingereicht wurde — das Dokument, um das ein Streit nach § 2 Abs. 6
 *     VOB/B geht (03-GEWERKE §7.4, Review B11). Deshalb UEBERSCHREIBT die
 *     Uebernahme keine Position, sondern schreibt den ganzen Stand neu.
 *  2. **Die Aktionspille beschreibt die AENDERUNG, nicht das Schicksal der
 *     Zeile.** In eine neue Fassung gehen ALLE gueltigen Zeilen — auch die
 *     unveraenderten, sonst waere die neue Fassung unvollstaendig.
 *     `aktualisieren` heisst: diese OZ gibt es in der aktuellen Fassung mit
 *     anderen Werten. `ignorieren` ist die einzige Aktion, die eine Zeile
 *     wirklich weglaesst — und zwar nur die fehlerhafte.
 *  3. **Der Einheitspreis liegt auch im Zwischenspeicher hinter
 *     `bau.preis_lesen`** (K-05, §1.9). Waere er in der Vorschau frei lesbar,
 *     waere der Import der Umweg um den Spaltenentzug auf `lv_position`. Er
 *     wandert deshalb nur durch `app.lv_import_preis_lesen` in die neue
 *     Fassung — und wer ihn nicht lesen darf, uebertraegt ihn nicht.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { lvQuelle, LvQuelleFehler, type LvFormat } from './lv-quelle.js';
import { ozSortierSchluessel, vergleicheOz, type LvArt, type LvPositionsart } from './lv.js';

export type LvImportStatus =
  | 'hochgeladen' | 'geprueft' | 'uebernommen' | 'verworfen' | 'fehler';

export type LvImportAktion = 'anlegen' | 'aktualisieren' | 'unveraendert' | 'ignorieren';

export const AKTION_TEXT: Readonly<Record<LvImportAktion, string>> = {
  anlegen: 'neu in dieser Fassung',
  aktualisieren: 'geänderte Werte',
  unveraendert: 'unverändert übernommen',
  ignorieren: 'wird nicht übernommen',
};

export class LvImportFehler extends Error {
  readonly status: number;
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'ungueltige_eingabe' | 'schon_uebernommen' | 'keine_gueltige_zeile'
      | 'zu_viele_zeilen',
    nachricht: string,
    status = 409,
  ) {
    super(nachricht);
    this.name = 'LvImportFehler';
    this.status = status;
  }
}

/**
 * Wie viele Zeilen ein Import hoechstens aufnimmt.
 *
 * Fuenftausend ist eine TECHNISCHE Grenze und keine fachliche: ein LV mit
 * mehr Zeilen kommt vor, aber eine Datei, die versehentlich zweihunderttausend
 * Zeilen enthaelt (weil eine Tabelle bis zum Blattende geht), soll eine
 * Auskunft bekommen und nicht die Verbindung belegen. Die Zahl steht hier
 * genannt, damit sie beim ersten echten Grossprojekt geaendert und nicht
 * gesucht werden muss.
 */
export const MAX_IMPORT_ZEILEN = 5000;

/* ---------------------------------------------------------------------------
 * 1. Anlegen — lesen, vergleichen, ins Staging
 * ------------------------------------------------------------------------ */

interface BestandZeile {
  readonly id: string;
  readonly oz: string;
  readonly art: string;
  readonly kurztext: string;
  readonly einheit: string | null;
  readonly menge_vertrag: string | null;
  /** NULL, wenn der Aufrufer `bau.preis_lesen` nicht haelt — siehe unten. */
  readonly einheitspreis_cent: string | null;
}

/**
 * Was die Uebernahme mit dieser Zeile ÄNDERN würde.
 *
 * **Der Preis wird nur verglichen, wenn er lesbar ist.** Wer
 * `bau.preis_lesen` nicht haelt, bekommt aus `app.lv_preis_lesen` NULL — und
 * dann ist ein Vergleich „alter Preis gegen neuer Preis" nicht moeglich. Die
 * Zeile heisst dann `unveraendert`, wenn Text, Einheit und Menge gleich sind,
 * und die Vorschau sagt ausdruecklich, dass Preisaenderungen dabei nicht
 * beurteilt werden konnten. Sie als `aktualisieren` zu zeigen waere die
 * Behauptung einer Aenderung, die niemand gesehen hat; sie stillschweigend
 * als gleich zu zeigen, waere die umgekehrte.
 */
function vergleiche(
  bestand: BestandZeile | undefined,
  neu: {
    readonly art: LvArt | null; readonly kurztext: string | null;
    readonly einheit: string | null; readonly menge: string | null;
    readonly einheitspreisCent: string | null;
  },
  preisLesbar: boolean,
): LvImportAktion {
  if (bestand === undefined) return 'anlegen';
  const gleich = bestand.art === neu.art
    && bestand.kurztext === neu.kurztext
    && (bestand.einheit ?? null) === neu.einheit
    && mengeGleich(bestand.menge_vertrag, neu.menge)
    && (!preisLesbar
        || (bestand.einheitspreis_cent ?? null) === neu.einheitspreisCent);
  return gleich ? 'unveraendert' : 'aktualisieren';
}

/**
 * `"25.000"` und `"25.0"` sind dieselbe Menge.
 *
 * Verglichen wird ueber `BigInt` der skalierten Form und nicht als Text:
 * Postgres liefert `numeric(12,3)` als `"25.000"`, der Leser erzeugt
 * dieselbe Form — aber eine spaetere Quelle koennte `"25"` schreiben, und
 * dann waere jede Zeile „geaendert", ohne dass sich etwas geaendert hat.
 */
function mengeGleich(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const skaliert = (text: string): bigint => {
    const [ganz = '0', bruch = ''] = text.split('.');
    return BigInt(ganz) * 1000n + BigInt(bruch.padEnd(3, '0').slice(0, 3));
  };
  try {
    return skaliert(a) === skaliert(b);
  } catch {
    return a === b;
  }
}

export interface LvImportEingabe {
  readonly projektId: string;
  readonly dateiname: string;
  readonly format: LvFormat;
  readonly bezeichnung: string;
  /** Der Rohtext der Datei — geparst wird SERVERSEITIG. */
  readonly inhalt: string;
}

/**
 * Legt den Import an: liest die Datei, vergleicht mit der aktuellen Fassung
 * und schreibt Kopf und Zeilen ins Staging. **Es wird nichts uebernommen.**
 */
export async function legeLvImportAn(
  kontext: SchreibKontext, eingabe: LvImportEingabe,
): Promise<{ readonly importId: string; readonly gueltig: number; readonly fehler: number }> {
  if (eingabe.bezeichnung.trim() === '') {
    throw new LvImportFehler(
      'ungueltige_eingabe',
      'Die Fassung braucht eine Bezeichnung — „LV Rohbau" und nicht „Import".',
      422,
    );
  }

  const [projekt] = await kontext.abfrage<{ id: string }>(
    `select p.id from projekt p where p.id = $1 and p.mandant_id = $2`,
    [eingabe.projektId, kontext.aktiverMandantId],
  );
  if (projekt === undefined) {
    // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
    throw new LvImportFehler('nicht_gefunden', 'Projekt nicht gefunden.', 404);
  }

  const gelesen = lvQuelle(eingabe.format).lese(eingabe.inhalt);
  if (gelesen.zeilen.length > MAX_IMPORT_ZEILEN) {
    throw new LvImportFehler(
      'zu_viele_zeilen',
      `Die Datei hat ${String(gelesen.zeilen.length)} Zeilen; verarbeitet werden `
      + `höchstens ${String(MAX_IMPORT_ZEILEN)}.`,
      413,
    );
  }

  const [preisRecht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('bau.preis_lesen', app.aktiver_mandant()) as darf`,
  );
  const preisLesbar = preisRecht?.darf === true;

  /**
   * Der Bestand, gegen den verglichen wird: die JUENGSTE lebende Fassung des
   * Hauptauftrags. Gibt es keine, ist alles `anlegen` — und das ist der
   * Normalfall beim ersten Import.
   */
  const bestand = await kontext.abfrage<BestandZeile>(
    `select l.id, l.oz, l.art::text as art, l.kurztext, l.einheit,
            l.menge_vertrag::text as menge_vertrag,
            app.lv_preis_lesen(l.id)::text as einheitspreis_cent
       from lv_position l
      where l.leistungsverzeichnis_id = (
              select lv.id from leistungsverzeichnis lv
               where lv.projekt_id = $1 and lv.art = 'hauptauftrag'
                 and lv.archiviert_am is null
               order by lv.fassung desc limit 1)
        and l.archiviert_am is null`,
    [eingabe.projektId],
  );
  const jeOz = new Map(bestand.map((b) => [b.oz, b]));

  const [kopf] = await kontext.schreibe<{ id: string }>(
    `insert into lv_import (mandant_id, projekt_id, dateiname, format, bezeichnung,
                            status, zeilen_gesamt, zeilen_gueltig, zeilen_fehler,
                            fehler_bericht, erstellt_von)
     values ($1, $2, $3, $4::lv_import_format, $5, 'geprueft', 0, 0, 0,
             $6::text::jsonb, app.aktueller_benutzer())
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.projektId, eingabe.dateiname, eingabe.format,
      eingabe.bezeichnung,
      JSON.stringify({ kopfzeile: [...gelesen.kopf], preisVerglichen: preisLesbar }),
    ],
  );
  if (kopf === undefined) {
    throw new LvImportFehler('nicht_gefunden', 'Der Import liess sich nicht anlegen.', 404);
  }

  let gueltig = 0;
  let fehlerhaft = 0;
  for (const zeile of gelesen.zeilen) {
    const istGueltig = zeile.fehler.length === 0 && zeile.oz !== null
      && zeile.kurztext !== null && zeile.art !== null;
    const vorhanden = zeile.oz === null ? undefined : jeOz.get(zeile.oz);
    const aktion: LvImportAktion = istGueltig
      ? vergleiche(vorhanden, zeile, preisLesbar)
      : 'ignorieren';
    if (istGueltig) gueltig += 1; else fehlerhaft += 1;

    await kontext.schreibe(
      `insert into lv_import_zeile (mandant_id, import_id, zeilennummer, rohdaten,
                                    oz, art, positionsart, kurztext, langtext, einheit,
                                    menge, einheitspreis_cent, konfidenz,
                                    ist_gueltig, fehler, aktion, lv_position_id)
       values ($1, $2, $3, $4::text::jsonb, $5, $6::lv_art, $7::lv_positionsart,
               $8, $9, $10, $11::numeric, $12::bigint, $13::numeric,
               $14, $15::text[], $16::lv_import_zeile_aktion, $17::uuid)`,
      [
        kontext.aktiverMandantId, kopf.id, zeile.zeilennummer,
        JSON.stringify(zeile.rohdaten),
        zeile.oz, zeile.art, zeile.positionsart, zeile.kurztext, zeile.langtext,
        zeile.einheit, zeile.menge, zeile.einheitspreisCent, zeile.konfidenz,
        istGueltig, zeile.fehler,
        aktion,
        // `aktualisieren` braucht sein Ziel (Bedingung `lviz_aktualisieren_mit_ziel`);
        // bei `anlegen` gibt es keines, und bei `unveraendert` ist es der Beleg,
        // WORAUF sich „unveraendert" bezieht.
        aktion === 'anlegen' ? null : vorhanden?.id ?? null,
      ],
    );
  }

  await kontext.schreibe(
    `update lv_import
        set zeilen_gesamt = $2, zeilen_gueltig = $3, zeilen_fehler = $4,
            geprueft_am = now(), geprueft_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1`,
    [kopf.id, gelesen.zeilen.length, gueltig, fehlerhaft],
  );

  return { importId: kopf.id, gueltig, fehler: fehlerhaft };
}

/* ---------------------------------------------------------------------------
 * 2. Vorschau lesen
 * ------------------------------------------------------------------------ */

export interface LvImportKopf {
  readonly id: string;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly dateiname: string;
  readonly format: LvFormat;
  readonly bezeichnung: string;
  readonly status: LvImportStatus;
  readonly zeilen_gesamt: number;
  readonly zeilen_gueltig: number;
  readonly zeilen_fehler: number;
  readonly angelegt_lokal: string;
  readonly uebernommen_lokal: string | null;
  readonly leistungsverzeichnis_id: string | null;
  readonly lv_fassung: number | null;
  readonly preis_verglichen: boolean;
}

export async function findeLvImport(
  kontext: LeseKontext, id: string,
): Promise<LvImportKopf | null> {
  const [zeile] = await kontext.abfrage<LvImportKopf>(
    `select i.id, i.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
            i.dateiname, i.format::text as format, i.bezeichnung,
            i.status::text as status,
            i.zeilen_gesamt, i.zeilen_gueltig, i.zeilen_fehler,
            to_char(i.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as angelegt_lokal,
            to_char(i.uebernommen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as uebernommen_lokal,
            i.leistungsverzeichnis_id, lv.fassung as lv_fassung,
            coalesce((i.fehler_bericht->>'preisVerglichen')::boolean, false)
              as preis_verglichen
       from lv_import i
       join projekt p on p.id = i.projekt_id and p.mandant_id = i.mandant_id
       left join leistungsverzeichnis lv on lv.id = i.leistungsverzeichnis_id
                                        and lv.mandant_id = i.mandant_id
      where i.id = $1`,
    [id],
  );
  return zeile ?? null;
}

export async function listeLvImporte(
  kontext: LeseKontext, projektId: string,
): Promise<readonly LvImportKopf[]> {
  return kontext.abfrage<LvImportKopf>(
    `select i.id, i.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
            i.dateiname, i.format::text as format, i.bezeichnung,
            i.status::text as status,
            i.zeilen_gesamt, i.zeilen_gueltig, i.zeilen_fehler,
            to_char(i.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as angelegt_lokal,
            to_char(i.uebernommen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as uebernommen_lokal,
            i.leistungsverzeichnis_id, lv.fassung as lv_fassung,
            coalesce((i.fehler_bericht->>'preisVerglichen')::boolean, false)
              as preis_verglichen
       from lv_import i
       join projekt p on p.id = i.projekt_id and p.mandant_id = i.mandant_id
       left join leistungsverzeichnis lv on lv.id = i.leistungsverzeichnis_id
                                        and lv.mandant_id = i.mandant_id
      where i.projekt_id = $1
      order by i.erstellt_am desc`,
    [projektId],
  );
}

export interface LvImportZeileAnzeige {
  readonly id: string;
  readonly zeilennummer: number;
  readonly oz: string | null;
  readonly art: LvArt | null;
  readonly positionsart: LvPositionsart;
  readonly kurztext: string | null;
  readonly langtext: string | null;
  readonly einheit: string | null;
  readonly menge: string | null;
  /** Cent als Text — NULL ohne `bau.preis_lesen` (K-05). */
  readonly einheitspreis_cent: string | null;
  readonly konfidenz: string | null;
  readonly ist_gueltig: boolean;
  readonly fehler: readonly string[];
  readonly aktion: LvImportAktion;
  readonly lv_position_id: string | null;
}

/**
 * Die Zeilen der Vorschau — **der Preis ueber `app.lv_import_preis_lesen`**.
 *
 * Nicht aus der Spalte: sie ist fuer `cse_app` nicht lesbar (0212, K-05), und
 * ein `select z.einheitspreis_cent` scheiterte hier mit einem Rechtefehler.
 * Wer `bau.preis_lesen` nicht haelt, sieht Mengen und keine Betraege — und
 * die Seite sagt das.
 */
export async function ladeLvImportZeilen(
  kontext: LeseKontext, importId: string,
): Promise<readonly LvImportZeileAnzeige[]> {
  return kontext.abfrage<LvImportZeileAnzeige>(
    `select z.id, z.zeilennummer, z.oz, z.art::text as art,
            z.positionsart::text as positionsart, z.kurztext, z.langtext, z.einheit,
            z.menge::text as menge,
            app.lv_import_preis_lesen(z.id)::text as einheitspreis_cent,
            z.konfidenz::text as konfidenz, z.ist_gueltig, z.fehler,
            z.aktion::text as aktion, z.lv_position_id
       from lv_import_zeile z
      where z.import_id = $1
      order by z.zeilennummer`,
    [importId],
  );
}

/* ---------------------------------------------------------------------------
 * 3. Uebernehmen — in eine NEUE Fassung
 * ------------------------------------------------------------------------ */

interface UebernahmeZeile {
  readonly id: string;
  readonly oz: string;
  readonly art: LvArt;
  readonly positionsart: LvPositionsart;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly einheit: string | null;
  readonly menge: string | null;
  readonly konfidenz: string | null;
}

/**
 * Der Elternteil einer OZ — die LAENGSTE echte Praefix-OZ im Stapel.
 *
 * `1.2.30` haengt an `1.2`, wenn es `1.2` gibt, sonst an `1`, sonst an der
 * Wurzel. Verglichen wird auf SEGMENTGRENZEN und nicht als Zeichenkette:
 * `1.2` ist kein Elternteil von `1.20`, und ein Praefixvergleich auf Text
 * haengte jede Position `1.20…` unter den Titel `1.2` — ein Baum, der
 * plausibel aussieht und falsch ist.
 */
export function elternOz(oz: string, vorhanden: readonly string[]): string | null {
  const segmente = oz.split('.').filter((s) => s !== '');
  for (let laenge = segmente.length - 1; laenge >= 1; laenge -= 1) {
    const kandidat = segmente.slice(0, laenge).join('.');
    if (vorhanden.includes(kandidat)) return kandidat;
  }
  return null;
}

/**
 * Uebernimmt den Import in eine NEUE Fassung des Leistungsverzeichnisses.
 *
 * **Die Reihenfolge ist zwingend:** die Zeilen werden in OZ-Ordnung
 * geschrieben, weil `eltern_id` auf eine Zeile zeigt, die es dann schon geben
 * muss. `ozSortierSchluessel` stellt dabei `1.2.10` HINTER `1.2.9` — eine
 * Textsortierung kehrte das um, und der Baum haengte an der falschen Stelle.
 *
 * **`pfad`, `ebene` und `sortier_pfad` setzt der Ausloeser** (`lvp_pfad_setzen`,
 * 0071) und nicht diese Funktion: zwei Fassungen derselben Berechnung wuerden
 * beim ersten Sonderfall auseinanderlaufen, und dann waeren es zwei
 * verschiedene Leistungsverzeichnisse.
 */
export async function uebernimmLvImport(
  kontext: SchreibKontext, importId: string,
): Promise<{
  readonly leistungsverzeichnisId: string;
  readonly fassung: number;
  readonly angelegt: number;
  /** Ob die Einheitspreise mitgewandert sind — siehe unten, K-05. */
  readonly preiseUebernommen: boolean;
}> {
  const [kopf] = await kontext.abfrage<{
    id: string; projekt_id: string; bezeichnung: string; status: LvImportStatus;
  }>(
    `select i.id, i.projekt_id, i.bezeichnung, i.status::text as status
       from lv_import i where i.id = $1 and i.mandant_id = $2`,
    [importId, kontext.aktiverMandantId],
  );
  if (kopf === undefined) {
    throw new LvImportFehler('nicht_gefunden', 'Diesen Import gibt es nicht.', 404);
  }
  if (kopf.status === 'uebernommen') {
    throw new LvImportFehler(
      'schon_uebernommen',
      'Dieser Import ist übernommen. Ein zweiter Lauf derselben Datei würde eine '
      + 'weitere Fassung anlegen, die sich von der vorigen nicht unterscheidet.',
    );
  }

  const zeilen = await kontext.abfrage<UebernahmeZeile>(
    `select z.id, z.oz, z.art::text as art, z.positionsart::text as positionsart,
            z.kurztext, z.langtext, z.einheit, z.menge::text as menge,
            z.konfidenz::text as konfidenz
       from lv_import_zeile z
      where z.import_id = $1 and z.ist_gueltig and z.aktion <> 'ignorieren'
      order by z.zeilennummer`,
    [importId],
  );
  if (zeilen.length === 0) {
    throw new LvImportFehler(
      'keine_gueltige_zeile',
      'Der Import enthält keine übernehmbare Zeile. Eine leere Fassung anzulegen wäre '
      + 'eine Fassung, die nichts belegt.',
      422,
    );
  }

  const [fassungZeile] = await kontext.abfrage<{ naechste: number }>(
    `select coalesce(max(lv.fassung), 0) + 1 as naechste
       from leistungsverzeichnis lv
      where lv.projekt_id = $1 and lv.art = 'hauptauftrag' and lv.nachtrag_id is null`,
    [kopf.projekt_id],
  );
  const fassung = fassungZeile?.naechste ?? 1;

  const [lv] = await kontext.schreibe<{ id: string }>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung, fassung,
                                       importiert_am, erstellt_von)
     values ($1, $2, 'hauptauftrag', $3, $4, now(), app.aktueller_benutzer())
     returning id`,
    [kontext.aktiverMandantId, kopf.projekt_id, kopf.bezeichnung, fassung],
  );
  if (lv === undefined) {
    throw new LvImportFehler('nicht_gefunden', 'Die Fassung liess sich nicht anlegen.', 404);
  }

  const [preisRecht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('bau.preis_lesen', app.aktiver_mandant()) as darf`,
  );
  const preiseUebernommen = preisRecht?.darf === true;

  const sortiert = [...zeilen].sort((a, b) => vergleicheOz(a.oz, b.oz));
  const idJeOz = new Map<string, string>();
  const ozStapel: string[] = [];

  for (const z of sortiert) {
    const eltern = elternOz(z.oz, ozStapel);
    /**
     * **Der Einheitspreis wandert durch den LESER, nicht durch den Node-Prozess.**
     *
     * `app.lv_import_preis_lesen(z.id)` steht IM `insert`: die Spalte
     * `lv_import_zeile.einheitspreis_cent` ist fuer `cse_app` nicht lesbar
     * (K-05, 0212), also kann der Dienst den Wert nicht selbst holen und
     * weiterreichen. Der Definer-Leser prueft `bau.preis_lesen`,
     * protokolliert den Zugriff und gibt sonst NULL — womit genau das
     * Richtige passiert: **wer den Preis nicht lesen darf, uebertraegt ihn
     * nicht.** Eine Fassung ohne Preise ist vollstaendig in Mengen und
     * Texten, und die Oberflaeche sagt, dass die Preise fehlen; einen Preis
     * zu schreiben, den niemand gesehen hat, waere eine Kalkulation aus
     * zweiter Hand.
     *
     * Dass `lv_position.einheitspreis_cent` schreibbar und unlesbar ist, ist
     * ausdrueckliche Absicht des Hauses (§11, 0089) — der Weg dorthin bleibt
     * trotzdem der eine gepruefte.
     * // TODO(client, O-631): Uebernimmt der LV-Import die Einheitspreise des
     * Auftraggebers als Vertragspreise, oder werden sie nach der Uebernahme
     * kalkuliert und eingetragen?
     */
    const [neu] = await kontext.schreibe<{ id: string }>(
      `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id,
                                oz, art, positionsart, kurztext, langtext, einheit,
                                menge_vertrag, einheitspreis_cent, konfidenz, erstellt_von)
       values ($1, $2, $3, $4::uuid, $5, $6::lv_art, $7::lv_positionsart, $8, $9, $10,
               $11::numeric, app.lv_import_preis_lesen($12::uuid), $13::numeric,
               app.aktueller_benutzer())
       returning id`,
      [
        kontext.aktiverMandantId, lv.id, kopf.projekt_id,
        eltern === null ? null : idJeOz.get(eltern) ?? null,
        z.oz, z.art, z.positionsart, z.kurztext, z.langtext, z.einheit,
        z.menge, z.id, z.konfidenz,
      ],
    );
    if (neu === undefined) continue;
    idJeOz.set(z.oz, neu.id);
    ozStapel.push(z.oz);
  }

  await kontext.schreibe(
    `update lv_import
        set status = 'uebernommen', leistungsverzeichnis_id = $2,
            uebernommen_am = now(), uebernommen_von = app.aktueller_benutzer(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1`,
    [importId, lv.id],
  );

  return { leistungsverzeichnisId: lv.id, fassung, angelegt: idJeOz.size, preiseUebernommen };
}

/** Verwirft einen Import, ohne etwas zu uebernehmen. */
export async function verwerfeLvImport(
  kontext: SchreibKontext, importId: string,
): Promise<boolean> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update lv_import
        set status = 'verworfen', verworfen_am = now(),
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and mandant_id = $2 and status in ('hochgeladen','geprueft')
      returning id`,
    [importId, kontext.aktiverMandantId],
  );
  return zeilen.length > 0;
}

/** Nur fuer Pruefzwecke: dieselbe Ordnung, die die Uebernahme benutzt. */
export function ozOrdnung(ozs: readonly string[]): readonly string[] {
  return [...ozs].sort((a, b) => ozSortierSchluessel(a) < ozSortierSchluessel(b) ? -1 : 1);
}

export { LvQuelleFehler };
