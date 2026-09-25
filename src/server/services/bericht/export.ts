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
          { kopf: 'Erlöse', wert: (z) => geldText(z.erloeseCent), cent: (z) => z.erloeseCent },
          { kopf: 'Rechnungen', wert: (z) => z.rechnungen },
          { kopf: 'Aufwand', wert: (z) => geldText(z.aufwandCent), cent: (z) => z.aufwandCent },
          { kopf: 'Eingangsrechnungen', wert: (z) => z.eingangsrechnungen },
          { kopf: 'Ergebnis', wert: (z) => geldText(z.ergebnisCent), cent: (z) => z.ergebnisCent },
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
          { kopf: 'Anfragen', wert: (z) => z.leads },
          { kopf: 'Gewonnen', wert: (z) => z.leadsGewonnen },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp) },
          { kopf: 'Aufträge', wert: (z) => z.auftraege },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent },
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
          { kopf: 'Anfragen', wert: (z) => z.leads },
          { kopf: 'Aufträge', wert: (z) => z.auftraege },
          { kopf: 'Quote', wert: (z) => prozent(z.quoteBp) },
          { kopf: 'Auftragswert netto', wert: (z) => geldText(z.auftragswertCent),
            cent: (z) => z.auftragswertCent },
        ]),
      };
    case 'mitarbeiter':
      return {
        zeitraum: String(jahr),
        zeilen: await mitarbeiterReihe(kontext, jahresZeitraum),
        spalten: s<MitarbeiterZeile>([
          { kopf: 'Name', wert: (z) => z.name },
          { kopf: 'Personalnummer', wert: (z) => z.personalnummer },
          { kopf: 'Wochenstunden Soll', wert: (z) => z.wochenstundenSoll },
          { kopf: 'Ist', wert: (z) => stunden(z.istMinuten) },
          { kopf: 'Ist (Minuten)', wert: (z) => z.istMinuten },
          { kopf: 'Soll', wert: (z) => stunden(z.sollMinuten) },
          { kopf: 'Soll (Minuten)', wert: (z) => z.sollMinuten },
          { kopf: 'Auslastung', wert: (z) => prozent(z.auslastungBp) },
          { kopf: 'Ist minus Soll (Minuten)', wert: (z) => z.mehrarbeitMinuten },
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
          { kopf: 'Verzug (Tage)', wert: (z) => z.verzugTage },
          { kopf: 'Auftragssumme', wert: (z) => geldText(z.auftragssummeCent),
            cent: (z) => z.auftragssummeCent },
          { kopf: 'Berechnet', wert: (z) => geldText(z.berechnetCent),
            cent: (z) => z.berechnetCent },
          { kopf: 'Kosten (Näherung)', wert: (z) => geldText(z.kostenCent),
            cent: (z) => z.kostenCent },
          { kopf: 'Marge', wert: (z) => prozent(z.margeBp) },
        ]),
      };
    case 'pipeline':
      return {
        zeitraum: String(jahr),
        zeilen: await pipeline(kontext, jahresZeitraum),
        spalten: s<PipelineStufe>([
          { kopf: 'Stufe', wert: (z) => z.bezeichnung },
          { kopf: 'Im Trichter', wert: (z) => (z.imTrichter ? 'ja' : 'nein') },
          { kopf: 'Fälle', wert: (z) => z.anzahl },
          { kopf: 'Zuschlagswert', wert: (z) => geldText(z.zuschlagswertCent),
            cent: (z) => z.zuschlagswertCent },
        ]),
      };
  }
}

export interface BlattZelle {
  readonly text: string;
  /** Rechtsbündig mit Ziffern gleicher Breite (DESIGN §11). */
  readonly zahl: boolean;
}

/**
 * Eine Tabelle als Zellen für das Druckblatt — dieselben `wert`-Funktionen wie
 * die Datei. Zwei Unterschiede, beide der Form und keiner dem Inhalt:
 *
 *  - Die Cent-Zwillingsspalte der CSV bleibt dort: sie steht für eine
 *    Maschine da, die weiterrechnet, und auf Papier rechnet niemand weiter.
 *  - Eine ganze Zahl bekommt ihren Tausenderpunkt (`zahlText`); in der Datei
 *    bleibt sie roh, damit eine Tabellenkalkulation sie als Zahl liest.
 */
export function zellenFuerBlatt(tabelle: BerichtTabelle): {
  readonly koepfe: readonly BlattZelle[];
  readonly zeilen: readonly (readonly BlattZelle[])[];
} {
  const roh = tabelle.zeilen as readonly never[];
  const istZahl = (w: string | number | null): boolean => typeof w === 'number'
    || (typeof w === 'string' && /^-?[\d.,]+ (%|h)$/u.test(w));
  const zahlSpalte = tabelle.spalten.map((sp) =>
    sp.cent !== undefined || roh.some((z) => istZahl(sp.wert(z))));
  const koepfe = tabelle.spalten.map((sp, i) => ({ text: sp.kopf, zahl: zahlSpalte[i]! }));
  const zeilen = roh.map((z) =>
    tabelle.spalten.map((sp, i) => {
      const w = sp.wert(z);
      return {
        text: w === null ? '' : typeof w === 'number' ? zahlText(w) : w,
        zahl: zahlSpalte[i]!,
      };
    }));
  return { koepfe, zeilen };
}

/**
 * Die zwei Berichte, die in Abschnitten rechnen — nur bei ihnen trägt der Kopf
 * des Blatts eine Körnung. Die übrigen vier rechnen über das ganze Jahr, und
 * eine Körnung im Kopf behauptete eine Aufteilung, die die Tabelle nicht hat.
 */
export const MIT_KOERNUNG: ReadonlySet<BerichtName> = new Set(['umsatz', 'auftraege']);
