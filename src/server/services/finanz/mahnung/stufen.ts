import 'server-only';
import type { SchreibKontext } from '../../../kontext/index.js';
import { cent, type Cent } from '../geld.js';
import { MASKE_WERT_HOECHSTENS } from '../../../../lib/formular/maske.js';
import type { ZinsMethode } from './zins.js';

/**
 * Die Mahnstufen als Einstellung — der Ort, an dem O-19 beantwortet wird
 * (FIN-15, `04-SEITENKARTE` §5.24).
 *
 * **Hier wird nichts gerechnet und nichts vorgeschlagen.** Der Dienst legt
 * die Werte ab, die ein Mensch eingegeben hat, und löst die vorherige Fassung
 * über `gueltig_bis` ab — gelöscht wird nichts (Invariante 8). Was gestern
 * gefordert wurde, muss morgen noch herleitbar sein: eine versendete Mahnung
 * beruft sich auf die Stufe, wie sie GALT.
 *
 * **Die Ablösung ist tagesgenau und überlappungsfrei.** Die alte Fassung
 * endet am Tag vor der neuen; `mahnstufe_kein_ueberlapp` weist alles andere
 * ab. Ohne diese Schranke gälten an einem Tag zwei Gebühren für dieselbe
 * Stufe, und welche gefordert wird, entschiede die Sortierung.
 */

export type Zinsberechnung = 'keine' | 'gesetzlich_b2b' | 'gesetzlich_b2c' | 'vertraglich';
export type Folgeaktion = 'keine' | 'lieferstopp' | 'inkasso' | 'mahnbescheid';

export class StufenFehler extends Error {
  constructor(
    readonly grund: 'nicht_gefunden' | 'ungueltig' | 'ueberlappt',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'StufenFehler';
  }
}

export interface StufenZeile {
  readonly id: string;
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly tageNachFaelligkeit: number;
  readonly gebuehrCent: Cent;
  readonly zinsberechnung: Zinsberechnung;
  readonly zinsAufschlagBp: number | null;
  readonly zinsMethode: ZinsMethode | null;
  readonly folgeaktion: Folgeaktion;
  /**
   * Der Mahntext dieser Stufe — `null`, solange keiner hinterlegt ist.
   *
   * Er wird hier mitgelesen, weil `/einstellungen/vorlagen` alle Vorlagen an
   * EINER Stelle zeigt und eine Stufenliste ohne ihren Text dort genau das
   * verfehlt, was die Seite verspricht. Gepflegt wird er nur unter
   * `/einstellungen/mahnwesen`, mit jeder bestätigten Fassung — und seit
   * V-214 stimmt das auch: vorher schrieb ihn kein Weg, und der Mahnungsdienst
   * las ihn nicht.
   */
  readonly textbaustein: string | null;
  readonly istPlatzhalter: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
}

interface Roh {
  id: string; stufe: number; bezeichnung: string; tage_nach_faelligkeit: number;
  gebuehr_cent: string; zinsberechnung: string; zins_aufschlag_bp: number | null;
  zins_methode: string | null; folgeaktion: string; textbaustein: string | null;
  ist_platzhalter: boolean;
  gueltig_ab: string; gueltig_bis: string | null;
}

function zuZeile(r: Roh): StufenZeile {
  return {
    id: r.id, stufe: r.stufe, bezeichnung: r.bezeichnung,
    tageNachFaelligkeit: r.tage_nach_faelligkeit,
    gebuehrCent: cent(BigInt(r.gebuehr_cent)),
    zinsberechnung: r.zinsberechnung as Zinsberechnung,
    zinsAufschlagBp: r.zins_aufschlag_bp,
    zinsMethode: r.zins_methode as ZinsMethode | null,
    folgeaktion: r.folgeaktion as Folgeaktion,
    textbaustein: r.textbaustein,
    istPlatzhalter: r.ist_platzhalter,
    gueltigAb: r.gueltig_ab, gueltigBis: r.gueltig_bis,
  };
}

/**
 * Die beiden Schranken, die dieselbe Sache sagen — und beide werden gebraucht.
 *
 * `mahnstufe_stufe_uk` trifft zuerst, wenn der Tag EXAKT derselbe ist
 * (`23505`); `mahnstufe_kein_ueberlapp` fängt jede andere Überschneidung
 * (`23P01`). Nur eine von beiden zu übersetzen liesse den anderen Fall als
 * Datenbankfehler bis auf den Bildschirm durch — und genau dieser Fall, zwei
 * Fassungen am selben Tag, ist der häufigste Tippfehler.
 */
function istUeberlapp(fehler: unknown): boolean {
  const f = fehler as { code?: unknown; constraint_name?: unknown };
  return (f.code === '23P01' && f.constraint_name === 'mahnstufe_kein_ueberlapp')
    || (f.code === '23505' && f.constraint_name === 'mahnstufe_stufe_uk');
}

export async function mahnstufen(
  kontext: SchreibKontext,
): Promise<readonly StufenZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent::text,
            zinsberechnung::text as zinsberechnung, zins_aufschlag_bp,
            zins_methode::text as zins_methode, folgeaktion::text as folgeaktion,
            textbaustein, ist_platzhalter, gueltig_ab::text as gueltig_ab,
            gueltig_bis::text as gueltig_bis
       from mahnstufe
      order by stufe, gueltig_ab desc`);
  return roh.map(zuZeile);
}

export interface StufeEingabe {
  readonly stufe: number;
  readonly bezeichnung: string;
  readonly tageNachFaelligkeit: number;
  readonly gebuehrCent: Cent;
  readonly zinsberechnung: Zinsberechnung;
  /** Nur bei `vertraglich` — sonst rechnet der Dienst die gesetzlichen Sätze. */
  readonly zinsAufschlagBp?: number;
  readonly zinsMethode?: ZinsMethode;
  readonly folgeaktion?: Folgeaktion;
  readonly gueltigAb: string;
  /**
   * Der Mahntext dieser Fassung (V-214).
   *
   *  - eine Zeichenkette: dieser Text, getrimmt;
   *  - `null`: ausdrücklich OHNE Mahntext;
   *  - weggelassen: der Text der laufenden Fassung wird übernommen (D-705).
   *
   * Übernommen und nicht geleert, weil eine neue Fassung meist eine neue
   * Gebühr oder Frist ist: wer die Gebühr ändert, soll nicht nebenbei den
   * Brieftext verlieren, den er gar nicht angefasst hat.
   */
  readonly textbaustein?: string | null;
}

/**
 * Die Höchstlänge eines Mahntexts — ein Absatz eines Briefs, rund 150 Wörter.
 *
 * Dieselbe Grenze wie ein Wert, der bei einer Abweisung mit der Maske
 * zurückreist (`MASKE_WERT_HOECHSTENS`, D-599): ein längerer Text käme dann
 * gekürzt zurück, und wer ihn erneut abschickt, verlöre still sein Ende.
 */
export const MAHNTEXT_HOECHSTENS = MASKE_WERT_HOECHSTENS;

/**
 * Eine bestätigte Fassung — und die Ablösung der vorherigen in einem Zug.
 *
 * Die Reihenfolge ist die Zusage: erst wird die laufende Fassung zum Vortag
 * geschlossen, dann entsteht die neue. Andersherum stiessen beide für einen
 * Augenblick zusammen, und `mahnstufe_kein_ueberlapp` wiese die neue ab —
 * mit einer Meldung über einen Zustand, den niemand gewollt hat.
 */
export async function bestaetigeStufe(
  kontext: SchreibKontext, e: StufeEingabe,
): Promise<string> {
  if (e.bezeichnung.trim() === '') {
    throw new StufenFehler('ungueltig', 'Eine Stufe braucht eine Bezeichnung.');
  }
  if (e.zinsberechnung === 'vertraglich' && e.zinsAufschlagBp === undefined) {
    throw new StufenFehler(
      'ungueltig',
      'Ein vertraglicher Zins braucht den vereinbarten Satz in Basispunkten — '
      + 'geraten wird er nicht.');
  }
  const methode: ZinsMethode | null = e.zinsberechnung === 'keine'
    ? null
    : e.zinsMethode ?? 'act_365';
  const neuerText = e.textbaustein === undefined || e.textbaustein === null
    ? e.textbaustein
    : e.textbaustein.replace(/\r\n?/gu, '\n').trim();
  if (typeof neuerText === 'string' && neuerText.length > MAHNTEXT_HOECHSTENS) {
    throw new StufenFehler(
      'ungueltig',
      `Ein Mahntext hat höchstens ${String(MAHNTEXT_HOECHSTENS)} Zeichen — dieser hat `
      + `${String(neuerText.length)}.`);
  }

  /**
   * **Rückwärts gibt es keine Fassung.**
   *
   * Die laufende Fassung endet am Tag vor der neuen — das setzt voraus, dass
   * die neue SPÄTER beginnt. Täte sie es nicht, liesse die Ablösung die alte
   * offen, und `mahnstufe_kein_ueberlapp` wiese den Einschub ab: der Mensch
   * am Bildschirm bekäme einen Datenbankfehler über eine Schranke, von der er
   * nichts weiss, statt des einen Satzes, der ihm sagt, welches Datum geht.
   *
   * Und es ist nicht nur eine Meldung: eine Fassung rückwirkend einzuschieben
   * hiesse, die Grundlage von Mahnungen zu ändern, die unter der alten
   * hinausgegangen sind.
   */
  const [laufend] = await kontext.abfrage<{ gueltig_ab: string; textbaustein: string | null }>(
    `select gueltig_ab::text as gueltig_ab, textbaustein
       from mahnstufe
      where stufe = $1 and gueltig_bis is null
      order by gueltig_ab desc limit 1`, [e.stufe]);
  if (laufend !== undefined && e.gueltigAb <= laufend.gueltig_ab) {
    const fruehestens = new Date(`${laufend.gueltig_ab}T00:00:00Z`);
    fruehestens.setUTCDate(fruehestens.getUTCDate() + 1);
    throw new StufenFehler(
      'ueberlappt',
      `Für Stufe ${String(e.stufe)} gilt seit dem ${laufend.gueltig_ab} eine Fassung. `
      + `Eine neue beginnt frühestens am ${fruehestens.toISOString().slice(0, 10)} — `
      + 'rückwirkend ändert sie die Grundlage bereits versendeter Mahnungen.');
  }

  await kontext.schreibe(
    `update mahnstufe
        set gueltig_bis = ($2::date - 1), geaendert_am = now(),
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where stufe = $1 and gueltig_bis is null and gueltig_ab < $2::date`,
    [e.stufe, e.gueltigAb]);
  /*
   * Eine Fassung, die AM SELBEN TAG beginnt wie die laufende, ersetzt sie
   * nicht — sie wäre eine zweite Wahrheit über denselben Tag. Sie wird von
   * `mahnstufe_kein_ueberlapp` abgewiesen, und der Dienst übersetzt das.
   */
  /* Weggelassen heisst übernommen; ein leerer Text heisst keiner (V-214). */
  const text = neuerText === undefined ? (laufend?.textbaustein ?? null)
    : neuerText === null || neuerText === '' ? null : neuerText;
  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into mahnstufe
       (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent,
        zinsberechnung, zins_aufschlag_bp, zins_methode, folgeaktion, textbaustein,
        ist_platzhalter, gueltig_ab, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3, $4::bigint,
             $5::mahn_zinsberechnung, $6, $7::zins_methode, $8::mahn_folgeaktion, $10,
             false, $9::date, 'mensch', app.aktueller_benutzer())
     returning id`,
    [e.stufe, e.bezeichnung.trim(), e.tageNachFaelligkeit, e.gebuehrCent.toString(),
     e.zinsberechnung, e.zinsAufschlagBp ?? null, methode, e.folgeaktion ?? 'keine',
     e.gueltigAb, text]).catch((fehler: unknown) => {
      /* Die Schranke ist die Wahrheit; die Prüfung oben ist nur die freundliche
         Vorstufe. Fällt trotzdem 23P01, wird daraus derselbe Satz und kein 500. */
      if (istUeberlapp(fehler)) {
        throw new StufenFehler(
          'ueberlappt',
          `Für Stufe ${String(e.stufe)} gilt am ${e.gueltigAb} bereits eine Fassung. `
          + 'Zwei Fassungen derselben Stufe an einem Tag gibt es nicht.');
      }
      throw fehler;
    });
  const neu = zeilen[0];
  if (neu === undefined) {
    throw new StufenFehler('ungueltig', 'Die Stufe wurde nicht angelegt.');
  }
  return neu.id;
}
