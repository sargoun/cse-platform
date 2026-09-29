import 'server-only';
import type { Abfrage } from './kennzahlen.js';
import {
  attribution, auftragsReihe, mitarbeiterReihe, pipeline, projektReihe, umsatzReihe,
  type AttributionsZeile, type AuftragsZeile, type MitarbeiterZeile, type PipelineStufe,
  type ProjektZeile, type UmsatzZeile,
} from './kennzahlen.js';
import { abschnitte, ganzesJahr, type Granularitaet } from './zeitraum.js';
import { datumText, geldText, prozent, stunden, type Spalte } from './ausgabe.js';
import { eigenerEintrag } from '../../../lib/nachschlagen.js';
import { zahlText } from '../../../lib/zahl.js';
import { DRUCK_HOCH_BIS_SPALTEN } from '../../../lib/design/theme.js';

/**
 * Ein Bericht als TABELLE — die eine Quelle für die CSV-Datei und das
 * Druckblatt (REP-07, V-227, D-721).
 *
 * **Warum das nicht mehr in der CSV-Route steht.** Die Spalten standen dort,
 * und ein zweiter Ausgang hätte sie ein zweites Mal geschrieben: eine Datei
 * und ein Blatt, die für denselben Bericht verschiedene Spalten zeigen, prüft
 * niemand gegeneinander, sondern rechnet neu. Jetzt fragen beide diese
 * Funktion — dieselben Zeilen, dieselben Spalten, dieselbe Reihenfolge wie
 * auf dem Bildschirm.
 *
 * **Ein Bericht, der hier nicht steht, hat keinen Ausgang.** `istBericht`
 * prüft die Adresse gegen genau diese Liste, und alles andere ist 404.
 */

export type BerichtName =
  'umsatz' | 'auftraege' | 'attribution' | 'mitarbeiter' | 'projekte' | 'pipeline';

/** Der Name im Dateinamen — ASCII, weil er in einem Downloads-Ordner steht. */
export const BERICHT_DATEINAME: Readonly<Record<BerichtName, string>> = {
  umsatz: 'Umsatz', auftraege: 'Auftraege', attribution: 'Herkunft',
  mitarbeiter: 'Stunden', projekte: 'Projekte', pipeline: 'Vergabepipeline',
};

export function istBericht(wert: string): wert is BerichtName {
  return Object.hasOwn(BERICHT_DATEINAME, wert);
}

export function koernungAus(roh: string | null | undefined): Granularitaet {
  return roh === 'quartal' || roh === 'jahr' ? roh : 'monat';
}

/**
 * Der Stand eines Projekts als Wort — für Bildschirm, Datei und Blatt
 * dieselben (V-227). In der Datei stand vorher der rohe Wert (`in_arbeit`).
 */
export const PROJEKT_STATUS_TEXT: Readonly<Record<string, string>> = {
  geplant: 'Geplant', in_arbeit: 'In Arbeit', abgenommen: 'Abgenommen',
  abgeschlossen: 'Abgeschlossen', archiviert: 'Archiviert',
};

export interface BerichtTabelle {
  readonly zeilen: readonly unknown[];
  readonly spalten: readonly Spalte<never>[];
  /** Wie der Zeitraum im Dateinamen und im Kopf des Blatts heisst. */
  readonly zeitraum: string;
}

/**
 * Die Spalten je Bericht — dieselbe Reihenfolge wie auf dem Bildschirm.
 *
 * **Eine andere Reihenfolge wäre ein zweiter Bericht.** Wer die Datei neben
 * die Seite legt und die Spalten nicht wiedererkennt, prüft nicht nach,
 * sondern rechnet neu.
 *
 * **Ein Tag steht als TT.MM.JJJJ** (`datumText`) — in der Datei wie auf dem
 * Blatt, dieselbe Form wie überall im Portal.
 */
export async function berichtTabelle(
  bericht: BerichtName, kontext: Abfrage, jahr: number, koernung: Granularitaet,
): Promise<BerichtTabelle> {
  const jahresZeitraum = ganzesJahr(jahr);
  const stuecke = abschnitte(jahr, koernung);
  const s = <Z,>(spalten: readonly Spalte<Z>[]): readonly Spalte<never>[] =>
    spalten as unknown as readonly Spalte<never>[];

  switch (bericht) {
    case 'umsatz':
      return {
        zeitraum: String(jahr),
        zeilen: await umsatzReihe(kontext, stuecke),
        spalten: s<UmsatzZeile>([
          { kopf: 'Zeitraum', wert: (z) => z.zeitraum.bezeichnung },
          { kopf: 'Von', wert: (z) => datumText(z.zeitraum.von) },
          { kopf: 'Bis', wert: (z) => datumText(z.zeitraum.bis) },
          { kopf: 'Erlöse', wert: (z) => geldText(z.erloeseCent), cent: (z) => z.erloeseCent,
            zahl: true },
          { kopf: 'Rechnungen', wert: (z) => z.rechnungen, zahl: true },
          { kopf: 'Aufwand', wert: (z) => geldText(z.aufwandCent), cent: (z) => z.aufwandCent,
            zahl: true },
          { kopf: 'Eingangsrechnungen', wert: (z) => z.eingangsrechnungen, zahl: true },
          { kopf: 'Ergebnis', wert: (z) => geldText(z.ergebnisCent), cent: (z) => z.ergebnisCent,
            zahl: true },
        ]),
      };
    case 'auftraege':
      return {
        zeitraum: String(jahr),
        zeilen: await auftragsReihe(kontext, stuecke),
        spalten: s<AuftragsZeile>([
          { kopf: 'Zeitraum', wert: (z) => z.zeitraum.bezeichnung },
          { kopf: 'Von', wert: (z) => datumText(z.zeitraum.von) },
          { kopf: 'Bis', wert: (z) => datumText(z.zeitraum.bis) },
          { kopf: 'Anfragen', wert: (z) => z.leads, zahl: true },
          { kopf: 'Gewonnen', wert: (z) => z.leadsGewonnen, zahl: true },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp), zahl: true },
          { kopf: 'Aufträge', wert: (z) => z.auftraege, zahl: true },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent, zahl: true },
        ]),
      };
    case 'attribution':
      return {
        zeitraum: String(jahr),
        zeilen: await attribution(kontext, jahresZeitraum),
        spalten: s<AttributionsZeile>([
          { kopf: 'Kanal', wert: (z) => z.kanal },
          { kopf: 'Medium', wert: (z) => z.medium },
          { kopf: 'Kampagne', wert: (z) => z.kampagne },
          { kopf: 'Anfragen', wert: (z) => z.leads, zahl: true },
          { kopf: 'Aufträge', wert: (z) => z.auftraege, zahl: true },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp), zahl: true },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent, zahl: true },
        ]),
      };
    case 'mitarbeiter':
      return {
        zeitraum: String(jahr),
        zeilen: await mitarbeiterReihe(kontext, jahresZeitraum),
        spalten: s<MitarbeiterZeile>([
          { kopf: 'Name', wert: (z) => z.name },
          { kopf: 'Personalnummer', wert: (z) => z.personalnummer },
          /* `anstellung.wochenstunden numeric(5,2)` — zwei Stellen, nie gerundet. */
          { kopf: 'Wochenstunden Soll', wert: (z) => z.wochenstundenSoll, zahl: true,
            nachkomma: 2 },
          { kopf: 'Ist', wert: (z) => stunden(z.istMinuten), zahl: true },
          { kopf: 'Ist (Minuten)', wert: (z) => z.istMinuten, zahl: true },
          { kopf: 'Soll', wert: (z) => stunden(z.sollMinuten), zahl: true },
          { kopf: 'Soll (Minuten)', wert: (z) => z.sollMinuten, zahl: true },
          { kopf: 'Auslastung', wert: (z) => prozent(z.auslastungBp), zahl: true },
          { kopf: 'Ist minus Soll (Minuten)', wert: (z) => z.mehrarbeitMinuten, zahl: true },
        ]),
      };
    case 'projekte':
      return {
        zeitraum: String(jahr),
        zeilen: await projektReihe(kontext, jahresZeitraum),
        spalten: s<ProjektZeile>([
          { kopf: 'Nummer', wert: (z) => z.nummer },
          { kopf: 'Projekt', wert: (z) => z.bezeichnung },
          { kopf: 'Status',
            wert: (z) => eigenerEintrag(PROJEKT_STATUS_TEXT, z.status) ?? z.status },
          { kopf: 'Soll-Ende', wert: (z) => datumText(z.sollEnde) },
          { kopf: 'Ist-Ende', wert: (z) => datumText(z.istEnde) },
          { kopf: 'Verzug (Tage)', wert: (z) => z.verzugTage, zahl: true },
          { kopf: 'Auftragssumme', wert: (z) => geldText(z.auftragssummeCent),
            cent: (z) => z.auftragssummeCent, zahl: true },
          { kopf: 'Berechnet', wert: (z) => geldText(z.berechnetCent),
            cent: (z) => z.berechnetCent, zahl: true },
          { kopf: 'Kosten (Näherung)', wert: (z) => geldText(z.kostenCent),
            cent: (z) => z.kostenCent, zahl: true },
          { kopf: 'Marge', wert: (z) => prozent(z.margeBp), zahl: true },
        ]),
      };
    case 'pipeline':
      return {
        zeitraum: String(jahr),
        zeilen: await pipeline(kontext, jahresZeitraum),
        spalten: s<PipelineStufe>([
          { kopf: 'Stufe', wert: (z) => z.bezeichnung },
          { kopf: 'Im Trichter', wert: (z) => (z.imTrichter ? 'ja' : 'nein') },
          { kopf: 'Fälle', wert: (z) => z.anzahl, zahl: true },
          { kopf: 'Zuschlagswert', wert: (z) => geldText(z.zuschlagswertCent),
            cent: (z) => z.zuschlagswertCent, zahl: true },
        ]),
      };
  }
}

/**
 * Die Obergrenze von `Intl.NumberFormat` für Nachkommastellen: eine Spalte
 * ohne `nachkomma` wird nicht gerundet, sie zeigt die Stellen, die die Datei
 * zeigt (`String(n)`).
 */
const OHNE_RUNDEN = 20;

export interface BlattZelle {
  readonly text: string;
  /** Rechtsbündig mit Ziffern gleicher Breite (DESIGN §11). */
  readonly zahl: boolean;
}

/**
 * Eine Tabelle als Zellen für das Druckblatt — dieselben `wert`-Funktionen wie
 * die Datei, also dieselben Werte mit derselben Genauigkeit. Zwei
 * Unterschiede, beide der Schreibweise und keiner dem Inhalt:
 *
 *  - Die Cent-Zwillingsspalte der CSV bleibt dort: sie steht für eine
 *    Maschine da, die weiterrechnet, und auf Papier rechnet niemand weiter.
 *  - Eine rohe Zahl steht in deutscher Schreibweise — Tausenderpunkt,
 *    Dezimalkomma —, mit genau den Stellen, die sie hat, höchstens so vielen
 *    wie ihre Quelle (`Spalte.nachkomma`): 37,5 Wochenstunden bleiben 37,5
 *    und werden nicht 38 (V-269). In der Datei bleibt sie roh, damit eine
 *    Tabellenkalkulation sie als Zahl liest.
 *
 * **Rechtsbündig ist, was die Spalte als Zahl ausweist** (`Spalte.zahl`,
 * dazu jede Geldspalte und jede rohe Zahl) — nicht, was ein Muster im Text
 * vermutet. Das Muster auf „… h" verfehlte „163:20 h" (V-269).
 */
export function zellenFuerBlatt(tabelle: BerichtTabelle): {
  readonly koepfe: readonly BlattZelle[];
  readonly zeilen: readonly (readonly BlattZelle[])[];
} {
  const roh = tabelle.zeilen as readonly never[];
  const zahlSpalte = tabelle.spalten.map((sp) => sp.zahl === true || sp.cent !== undefined
    || roh.some((z) => typeof sp.wert(z) === 'number'));
  const koepfe = tabelle.spalten.map((sp, i) => ({ text: sp.kopf, zahl: zahlSpalte[i]! }));
  const zeilen = roh.map((z) =>
    tabelle.spalten.map((sp, i) => {
      const w = sp.wert(z);
      return {
        text: w === null ? ''
          : typeof w === 'number' ? zahlText(w, 'de', sp.nachkomma ?? OHNE_RUNDEN, 0)
            : w,
        zahl: zahlSpalte[i]!,
      };
    }));
  return { koepfe, zeilen };
}

/**
 * **Hoch- oder Querformat — aus der Tabelle, nicht aus dem Browser** (DESIGN
 * §11, V-269).
 *
 * Vier der sechs Tabellen waren breiter als die 170 mm eines Hochformats:
 * am Bildschirm ragten sie über das weisse Blatt, im Druck verkleinerte der
 * Browser die ganze Seite (aus 10 pt wurden bei „Projekte" etwa 6,7 pt) oder
 * schnitt ab. Mehr als `DRUCK_HOCH_BIS_SPALTEN` Spalten drucken quer. Die
 * Cent-Zwillinge der Datei zählen nicht mit — sie stehen nicht auf dem Blatt.
 */
export function blattFormat(tabelle: BerichtTabelle): 'hoch' | 'quer' {
  return tabelle.spalten.length > DRUCK_HOCH_BIS_SPALTEN ? 'quer' : 'hoch';
}

/**
 * Die zwei Berichte, die in Abschnitten rechnen — nur bei ihnen trägt der Kopf
 * des Blatts eine Körnung. Die übrigen vier rechnen über das ganze Jahr, und
 * eine Körnung im Kopf behauptete eine Aufteilung, die die Tabelle nicht hat.
 */
export const MIT_KOERNUNG: ReadonlySet<BerichtName> = new Set(['umsatz', 'auftraege']);
