/**
 * Der Auftragsabschluss (OPS-05) und die Pruefliste davor (FIN-18).
 *
 * **Der Abschluss ist kein Statusfeld, das man umlegt — er ARMIERT etwas.**
 * `pruefeZeiterfassung` in `services/finanz/positionsquelle.ts` liest
 * `status = 'abgeschlossen' or abgeschlossen_am is not null` und macht daraus
 * die FIN-18-Warnung, die nach D-366/D-367 die Rechnungsfestschreibung
 * anhaelt, bis jemand sie mit einer protokollierten Begruendung uebergeht.
 * Wer hier klickt, stellt also eine Sperre im Rechnungsweg scharf. Das
 * gehoert auf die Seite, und deshalb steht es hier im Dienst und nicht nur im
 * Bildschirmtext.
 *
 * **Die Zahlen kommen aus einer DEFINER-Funktion, nicht aus direkten
 * Zaehlungen.** `fin.auftrag_abschluss_befunde` (0299) — die Begruendung
 * steht dort ausfuehrlich: `zeiteintrag` verlangt `zeit.lesen`, und eine
 * Rolle ohne dieses Recht bekaeme null Zeilen und damit einen FALSCHEN
 * FREISPRUCH statt eines falschen Alarms (AUT-05).
 *
 * **Und kein Betrag entsteht hier.** Der Sicherheitseinbehalt wird
 * gespeichert, nicht gerechnet: ob er als Satz oder als Betrag gilt, wann er
 * freigegeben wird und ob eine Buergschaft ihn ersetzt, ist O-20.
 */
import { cent, parseGeld, type Cent } from '../finanz/geld.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class AbschlussFehler extends Error {
  constructor(nachricht: string, readonly grund:
    | 'nicht_gefunden' | 'schon_abgeschlossen' | 'storniert'
    | 'gewaehrleistung_ohne_abnahme' | 'einbehalt_doppelt' | 'zahl_unlesbar'
    | 'kein_recht') {
    super(nachricht);
    this.name = 'AbschlussFehler';
  }
}

// ---------------------------------------------------------------------------
// Die Pruefliste
// ---------------------------------------------------------------------------

/**
 * Ein Befund der Pruefliste.
 *
 * `sperrt` ist heute bei JEDEM `false`, und das ist eine Entscheidung, keine
 * Nachlaessigkeit: welche Befunde den Abschluss verbindlich verhindern, ist
 * O-730. Eine erfundene Sperre waere schlimmer als keine — sie hielte Arbeit
 * auf, die niemand aufhalten wollte, und der Weg daran vorbei waere ein
 * Klick, den sich danach jeder angewoehnt.
 */
export interface Befund {
  readonly schluessel: string;
  readonly titel: string;
  /** Was die Zahl bedeutet — ein Satz, nicht ein Wort. */
  readonly erklaerung: string;
  readonly anzahl: number;
  /** `true`, sobald O-730 beantwortet ist. Heute nie. */
  readonly sperrt: boolean;
  /** Wohin man geht, um den Befund zu erledigen — relativ zum Portal. */
  readonly ziel: string | null;
  /** Das Recht, das dieses Ziel verlangt; ohne es zeigt die Seite keinen Verweis. */
  readonly zielRecht: string | null;
}

export interface Pruefliste {
  readonly befunde: readonly Befund[];
  /** Erfasste Minuten am Auftrag — die Groesse, an der FIN-18 haengt. */
  readonly erfassteMinuten: number;
  /** Wahr, wenn keine Minute erfasst ist: dann wird FIN-18 mit dem Abschluss scharf. */
  readonly fin18Trifft: boolean;
  readonly offeneBefunde: number;
}

interface BefundeZeile {
  readonly zeit_ohne_freigabe: string;
  readonly zeit_ohne_abrechnung: string;
  readonly erfasste_minuten: string;
  readonly nachweise_ohne_rechnung: string;
  readonly rechnungen_entwurf: string;
  readonly aufmasse_offen: string;
  readonly nachtraege_offen: string;
  readonly leistungen_laufend: string;
  readonly ohne_abrechnungsart: string;
}

export async function ladePruefliste(
  db: Abfrage, auftragId: string,
): Promise<Pruefliste> {
  const [z] = await db.abfrage<BefundeZeile>(
    `select * from fin.auftrag_abschluss_befunde($1::uuid)`, [auftragId]);
  if (z === undefined) {
    throw new AbschlussFehler('Auftrag nicht gefunden', 'nicht_gefunden');
  }
  const n = (wert: string): number => Number(wert);

  const befunde: readonly Befund[] = [
    {
      schluessel: 'zeit_ohne_freigabe',
      titel: 'Zeiteinträge ohne Freigabe',
      erklaerung: 'Erfasste Zeit an diesem Auftrag, die noch niemand freigegeben hat. '
        + 'Sie kann nicht abgerechnet werden und fehlt in jeder Nachkalkulation.',
      anzahl: n(z.zeit_ohne_freigabe), sperrt: false,
      ziel: 'zeiten', zielRecht: 'zeit.lesen',
    },
    {
      schluessel: 'zeit_ohne_abrechnung',
      titel: 'Freigegebene Zeit ohne Abrechnung',
      erklaerung: 'Freigegeben, aber in keiner Rechnung angekommen. Nach dem Abschluss '
        + 'sucht sie niemand mehr.',
      anzahl: n(z.zeit_ohne_abrechnung), sperrt: false,
      ziel: 'zeiten', zielRecht: 'zeit.lesen',
    },
    {
      schluessel: 'nachweise_ohne_rechnung',
      titel: 'Unterschriebene Leistungsnachweise ohne Rechnung',
      erklaerung: 'Der Kunde hat gegengezeichnet — abgerechnet wurde es nicht. Das ist '
        + 'die Zeile, die man im Nachhinein am schwersten durchsetzt.',
      anzahl: n(z.nachweise_ohne_rechnung), sperrt: false,
      ziel: 'reinigung/nachweise', zielRecht: 'leistungsnachweis.lesen',
    },
    {
      schluessel: 'rechnungen_entwurf',
      titel: 'Rechnungen im Entwurf',
      erklaerung: 'Entwürfe tragen keine Nummer (FIN-03) und sind für den Kunden nicht '
        + 'entstanden. Ein abgeschlossener Auftrag mit offenem Entwurf ist unfertige Arbeit.',
      anzahl: n(z.rechnungen_entwurf), sperrt: false,
      ziel: 'finanzen/rechnungen', zielRecht: 'finanzen.lesen',
    },
    {
      schluessel: 'aufmasse_offen',
      titel: 'Aufmaße ohne Gegenzeichnung',
      erklaerung: 'Weder gegengezeichnet noch einseitig festgestellt — die Menge ist '
        + 'zwischen den Parteien nicht geklärt (VOB/B).',
      anzahl: n(z.aufmasse_offen), sperrt: false,
      ziel: 'bau/aufmasse', zielRecht: 'aufmass.lesen',
    },
    {
      schluessel: 'nachtraege_offen',
      titel: 'Nachträge ohne Entscheidung',
      erklaerung: 'Angemeldet, kalkuliert oder eingereicht, aber nicht beauftragt und '
        + 'nicht abgelehnt. Nach dem Abschluss ist die Grundlage fort.',
      anzahl: n(z.nachtraege_offen), sperrt: false,
      ziel: 'bau/nachtraege', zielRecht: 'nachtrag.lesen',
    },
    {
      schluessel: 'ohne_abrechnungsart',
      titel: 'Leistungszeilen ohne Abrechnungskonfiguration',
      erklaerung: 'Ohne hinterlegte Abrechnungsart (FIN-02) entsteht aus dieser Zeile '
        + 'keine Rechnungsposition.',
      anzahl: n(z.ohne_abrechnungsart), sperrt: false,
      ziel: null, zielRecht: null,
    },
    {
      schluessel: 'leistungen_laufend',
      titel: 'Leistungszeilen ohne Gültigkeitsende',
      erklaerung: 'Diese Zeilen laufen weiter, obwohl der Auftrag endet. Sie sind kein '
        + 'Fehler — aber jemand sollte sie gesehen haben.',
      anzahl: n(z.leistungen_laufend), sperrt: false,
      ziel: null, zielRecht: null,
    },
  ];

  const erfassteMinuten = n(z.erfasste_minuten);
  return {
    befunde,
    erfassteMinuten,
    fin18Trifft: erfassteMinuten === 0,
    offeneBefunde: befunde.filter((b) => b.anzahl > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Der Abschluss
// ---------------------------------------------------------------------------

export interface AbschlussEingabe {
  /** Berliner Kalendertag `YYYY-MM-DD`, oder leer. */
  readonly abnahmeAm?: string | null;
  readonly gewaehrleistungBis?: string | null;
  /** Genau EINES von beiden — `auftrag_einbehalt_eindeutig`. */
  readonly einbehaltProzent?: string | null;
  readonly einbehaltBetrag?: string | null;
}

/** Deutsche Prozentangabe in Basispunkte: `"5"` → `500`, `"5,5"` → `550`. */
export function prozentInBasispunkte(roh: string): number {
  const text = roh.trim().replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(text)) {
    throw new AbschlussFehler(
      `„${roh}" ist kein lesbarer Prozentsatz`, 'zahl_unlesbar');
  }
  /**
   * Ueber Zeichenketten, nicht ueber `Number(text) * 100`.
   *
   * `5.6 * 100` ist in Fliesskomma `560.0000000000001`, und `Math.round`
   * raeumt das hier auf — aber nur, weil der Bereich klein ist. Die
   * Zerlegung ist exakt und traegt dieselbe Absicht wie Invariante 1: eine
   * Zahl, die einen Betrag bestimmt, entsteht nicht aus einem Fliesskommawert.
   */
  const [ganz = '0', bruch = ''] = text.split('.');
  const bp = Number(ganz) * 100 + Number(bruch.padEnd(2, '0') || '0');
  if (bp < 0 || bp > 10000) {
    throw new AbschlussFehler(
      'Der Einbehaltssatz liegt zwischen 0 und 100 Prozent', 'zahl_unlesbar');
  }
  return bp;
}

/**
 * Der Abschluss — mit den Abnahmeangaben, weil sie dazugehoeren.
 *
 * `abnahme_am`, `gewaehrleistung_bis` und der Sicherheitseinbehalt stehen in
 * derselben Maske, nicht auf einer eigenen Seite: die Abnahme IST der Anlass
 * des Abschlusses, und wer sie getrennt erfasst, erfasst sie nicht.
 *
 * Die Reihenfolge der Pruefungen folgt den CHECKs der Tabelle, damit ein
 * Mensch statt „violates check constraint
 * auftrag_gewaehrleistung_nach_abnahme" einen Satz liest.
 */
export async function schliesseAuftragAb(
  db: Abfrage, auftragId: string, eingabe: AbschlussEingabe,
): Promise<{ readonly auftragsnummer: string; readonly abgeschlossenAm: Date }> {
  const [vorher] = await db.abfrage<{
    auftragsnummer: string; status: string; abgeschlossen_am: Date | null;
    abnahme_am: string | null;
  }>(
    `select auftragsnummer, status::text as status, abgeschlossen_am,
            abnahme_am::text as abnahme_am
       from auftrag where id = $1 for update`, [auftragId]);
  if (vorher === undefined) {
    throw new AbschlussFehler('Auftrag nicht gefunden', 'nicht_gefunden');
  }
  if (vorher.status === 'abgeschlossen' || vorher.abgeschlossen_am !== null) {
    throw new AbschlussFehler(
      `Auftrag ${vorher.auftragsnummer} ist bereits abgeschlossen`, 'schon_abgeschlossen');
  }
  if (vorher.status === 'storniert') {
    throw new AbschlussFehler(
      'Ein stornierter Auftrag wird nicht abgeschlossen', 'storniert');
  }

  const abnahme = leer(eingabe.abnahmeAm);
  const gewaehrleistung = leer(eingabe.gewaehrleistungBis);
  /**
   * `auftrag_gewaehrleistung_nach_abnahme`: eine Gewaehrleistungsfrist ohne
   * Abnahmedatum hat keinen Beginn. Die vorhandene Abnahme zaehlt mit — die
   * Maske darf sie leer lassen, wenn sie schon in der Zeile steht.
   */
  if (gewaehrleistung !== null && abnahme === null && vorher.abnahme_am === null) {
    throw new AbschlussFehler(
      'Eine Gewährleistungsfrist braucht ein Abnahmedatum — von ihm läuft sie',
      'gewaehrleistung_ohne_abnahme');
  }

  const prozent = leer(eingabe.einbehaltProzent);
  const betrag = leer(eingabe.einbehaltBetrag);
  /** `auftrag_einbehalt_eindeutig`: `num_nonnulls(...) <= 1`. */
  if (prozent !== null && betrag !== null) {
    throw new AbschlussFehler(
      'Der Sicherheitseinbehalt ist ein Satz ODER ein Betrag, nicht beides — '
      + 'welcher von beiden gilt, ist offen (O-20)', 'einbehalt_doppelt');
  }
  const bp = prozent === null ? null : prozentInBasispunkte(prozent);
  const einbehaltCent: Cent | null = betrag === null ? null : geld(betrag);

  const [nachher] = await db.abfrage<{ auftragsnummer: string; abgeschlossen_am: Date }>(
    `update auftrag
        set status = 'abgeschlossen',
            /**
             * abgeschlossen_am wird NICHT hier gesetzt: der Ausloeser
             * auftrag_05_uebergang (0296) stempelt es aus der Serveruhr.
             * Es hier mitzuschreiben waere ein zweiter Zeitgeber fuer
             * dieselbe Tatsache (Invariante 5).
             */
            abnahme_am = coalesce($2::date, abnahme_am),
            gewaehrleistung_bis = coalesce($3::date, gewaehrleistung_bis),
            sicherheitseinbehalt_bp = coalesce($4, sicherheitseinbehalt_bp),
            sicherheitseinbehalt_cent = coalesce($5, sicherheitseinbehalt_cent)
      where id = $1
      returning auftragsnummer, abgeschlossen_am`,
    [auftragId, abnahme, gewaehrleistung, bp,
     einbehaltCent === null ? null : String(einbehaltCent)]);
  if (nachher === undefined) {
    throw new AbschlussFehler('Der Abschluss hat keine Zeile getroffen', 'nicht_gefunden');
  }
  return {
    auftragsnummer: nachher.auftragsnummer,
    abgeschlossenAm: nachher.abgeschlossen_am,
  };
}

function leer(wert: string | null | undefined): string | null {
  return wert === null || wert === undefined || wert.trim() === '' ? null : wert.trim();
}

function geld(roh: string): Cent {
  try {
    return parseGeld(roh);
  } catch {
    throw new AbschlussFehler(`„${roh}" ist kein lesbarer Betrag`, 'zahl_unlesbar');
  }
}

/** Der Einbehalt einer Zeile als `Cent` — fuer die Anzeige, nicht gerechnet. */
export function einbehaltAus(wert: string | null): Cent | null {
  return wert === null ? null : cent(BigInt(wert));
}
