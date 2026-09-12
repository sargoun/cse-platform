import 'server-only';
import type { SchreibKontext } from '../../../kontext/index.js';
import { cent, type Cent } from '../geld.js';
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
  readonly istPlatzhalter: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
}

interface Roh {
  id: string; stufe: number; bezeichnung: string; tage_nach_faelligkeit: number;
  gebuehr_cent: string; zinsberechnung: string; zins_aufschlag_bp: number | null;
  zins_methode: string | null; folgeaktion: string; ist_platzhalter: boolean;
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
    istPlatzhalter: r.ist_platzhalter,
    gueltigAb: r.gueltig_ab, gueltigBis: r.gueltig_bis,
  };
}

export async function mahnstufen(
  kontext: SchreibKontext,
): Promise<readonly StufenZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent::text,
            zinsberechnung::text as zinsberechnung, zins_aufschlag_bp,
            zins_methode::text as zins_methode, folgeaktion::text as folgeaktion,
            ist_platzhalter, gueltig_ab::text as gueltig_ab,
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
}

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
  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into mahnstufe
       (mandant_id, stufe, bezeichnung, tage_nach_faelligkeit, gebuehr_cent,
        zinsberechnung, zins_aufschlag_bp, zins_methode, folgeaktion,
        ist_platzhalter, gueltig_ab, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2, $3, $4::bigint,
             $5::mahn_zinsberechnung, $6, $7::zins_methode, $8::mahn_folgeaktion,
             false, $9::date, 'mensch', app.aktueller_benutzer())
     returning id`,
    [e.stufe, e.bezeichnung.trim(), e.tageNachFaelligkeit, e.gebuehrCent.toString(),
     e.zinsberechnung, e.zinsAufschlagBp ?? null, methode, e.folgeaktion ?? 'keine',
     e.gueltigAb]);
  const neu = zeilen[0];
  if (neu === undefined) {
    throw new StufenFehler('ungueltig', 'Die Stufe wurde nicht angelegt.');
  }
  return neu.id;
}
