import 'server-only';
import {
  entfalte, loeseOrtszeitAuf, type AnkerLokal, type Zeitanomalie,
} from '../../../lib/datum/rrule.js';
import { tagePlus } from '../../../lib/datum/kalendertag.js';
import { MAX_DAUER_MINUTEN } from '../dienstplan/vorkommnisse.js';

/**
 * Was ein Turnus in den naechsten Wochen ERGIBT — als Vorschau, mit allem,
 * was `planeVorkommnisse` wegwirft (CLN-02, CLN-03, TIM-02, K-11).
 *
 * **Warum diese Datei neben `planeVorkommnisse` steht und es nicht ersetzt.**
 * Der Generator braucht genau das, was in eine `einsatz`-Zeile gehoert:
 * Plandatum, Wanduhrzeiten, Besetzung, Herkunft. Den Instant laesst er
 * absichtlich weg — „Postgres setzt ihn" (§7.2), und eine zweite
 * Zonendatenbank in Node waere eine zweite Wahrheit ueber dieselbe Nacht.
 * Sein Rueckgabetyp `GeplanterEinsatz` traegt deshalb **keinen Zeitpunkt und
 * keine DST-Kennzeichnung**, und die Uebersprungenen liegen in einer zweiten
 * Liste.
 *
 * Eine VORSCHAU braucht das Gegenteil. Sie beantwortet drei Fragen, die der
 * Generator nicht stellt:
 *
 *  1. **Was faellt aus, und warum?** Ausfall und Termin stehen in EINER
 *     Liste, in zeitlicher Reihenfolge. Zwei Listen nebeneinander lassen die
 *     Frage „ist am 3. Oktober etwas?" unbeantwortet.
 *  2. **Wie lang ist die Schicht WIRKLICH?** Die Dauer ist die Differenz
 *     zweier Instants (Invariante 2), nie eine Wanduhr-Subtraktion. In den
 *     beiden Umstellungsnaechten ergibt eine 480-Minuten-Schicht 420 bzw.
 *     540 Minuten — und genau das muss sichtbar sein, BEVOR jemand die Serie
 *     speichert.
 *  3. **Gibt es die geplante Uhrzeit an diesem Tag ueberhaupt?** `dst_luecke`
 *     heisst: die Kolonne rueckt eine Stunde spaeter an, als im Formular
 *     steht. `dst_doppelt` heisst: es gibt zwei Instants, und welcher gilt,
 *     ist eine Verguetungsfrage (O-163) und keine technische.
 *
 * **Das Ende ist ein EIGENER Wanduhr-Anker**, nicht „Beginn plus Dauer" auf
 * dem Zeitstrahl — dieselbe Regel, die `upsertText` im Generator mit zwei
 * Aufrufen von `app.loese_ortszeit` umsetzt. Andernfalls waere die Schicht in
 * der Umstellungsnacht eine Stunde zu lang, und zwar unauffaellig.
 *
 * Diese Datei rechnet und liest nichts: keine Datenbank, kein `now()`. Die
 * Feiertage kommen als Karte herein (aus `ladeFeiertage`), das Fenster als
 * Kalendertage.
 */

export type VorschauArt = 'regel' | 'zusatz' | 'verschiebung';
export type VorschauAusfall = 'feiertag' | 'ausnahme_ausfall' | 'ausserhalb_gueltigkeit';

export interface VorschauTraeger {
  /** Leer oder `null` gibt es hier nicht — ein Turnus hat eine Regel. */
  readonly rrule: string;
  readonly dtstartLokal: AnkerLokal;
  readonly dauerMinuten: number;
  readonly feiertagsregel: 'ausfall' | 'unveraendert';
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
}

export interface VorschauAusnahme {
  readonly id: string;
  /** Der betroffene BERLINER Kalendertag. */
  readonly datum: string;
  readonly art: 'ausfall' | 'zusatz' | 'verschiebung';
  /** `JJJJ-MM-TTTHH:MM`, Ortszeit. */
  readonly ersatzBeginnLokal: string | null;
  readonly dauerMinuten: number | null;
  readonly grund: string;
}

export interface VorschauTermin {
  /** Der Berliner Kalendertag, dem die Schicht gehoert. */
  readonly planDatum: string;
  /** Die geplante Wanduhrzeit `HH:MM`. */
  readonly beginnLokal: string;
  /** Das nominale Ende `HH:MM` — eine Uhrzeit, kein Zeitstempel. */
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
  /** Der aufgeloeste Instant des Beginns, UTC. `null` nur bei Ausfall. */
  readonly beginnZeitpunkt: Date | null;
  readonly endeZeitpunkt: Date | null;
  /** Die GEPLANTE Dauer auf der Wanduhr. */
  readonly dauerNominal: number;
  /**
   * Die WIRKLICHE Dauer — Differenz der beiden Instants, in Minuten.
   *
   * 480 im Regelfall, 420 in der Vorstellnacht, 540 in der Rueckstellnacht.
   * Weicht sie von `dauerNominal` ab, ist das der Befund, um den es geht.
   */
  readonly dauerInstant: number | null;
  readonly anomalie: Zeitanomalie;
  /** Der Name des Feiertags, wenn der Tag einer ist — sonst `null`. */
  readonly feiertag: string | null;
  /** `null` heisst: der Termin findet statt. */
  readonly ausfall: VorschauAusfall | null;
  readonly art: VorschauArt;
  /** Der Grund der Ausnahme, die diesen Termin betrifft. */
  readonly grund: string | null;
}

export class VorschauFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'VorschauFehler';
  }
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const ORTSZEIT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/u;

function zweistellig(zahl: number): string {
  return String(zahl).padStart(2, '0');
}

function pruefeDauer(dauer: number, feld: string): number {
  if (!Number.isInteger(dauer) || dauer <= 0) {
    throw new VorschauFehler(`${feld} muss eine positive ganze Zahl sein: ${String(dauer)}`);
  }
  if (dauer > MAX_DAUER_MINUTEN) {
    throw new VorschauFehler(
      `${feld} ${String(dauer)} ueberschreitet einen Tag — eine Schicht ist kuerzer als ein Tag.`);
  }
  return dauer;
}

/**
 * Ein Termin aus Datum, Ortszeit und Dauer — Wanduhr UND beide Instants.
 *
 * Die drei Zeilen in der Mitte sind der Kern: das Ende bekommt seine eigene
 * Auflaesung auf seinem eigenen Kalendertag. `beginnZeitpunkt + dauer*60000`
 * waere kuerzer und in zwei Naechten im Jahr falsch.
 */
function baueTermin(
  datum: string, stunde: number, minute: number, dauer: number,
): Pick<VorschauTermin,
  'beginnLokal' | 'endeLokal' | 'endetAmFolgetag' | 'beginnZeitpunkt'
  | 'endeZeitpunkt' | 'dauerNominal' | 'dauerInstant' | 'anomalie'> {
  const start = stunde * 60 + minute;
  const roh = start + dauer;
  const versatz = Math.floor(roh / 1440);
  const rest = roh % 1440;
  const endeStunde = Math.floor(rest / 60);
  const endeMinute = rest % 60;

  const anfang = loeseOrtszeitAuf(datum, stunde, minute);
  const endeDatum = versatz === 0 ? datum : tagePlus(datum, versatz);
  const ende = loeseOrtszeitAuf(endeDatum, endeStunde, endeMinute);

  return {
    beginnLokal: `${zweistellig(stunde)}:${zweistellig(minute)}`,
    endeLokal: `${zweistellig(endeStunde)}:${zweistellig(endeMinute)}`,
    endetAmFolgetag: versatz > 0,
    beginnZeitpunkt: anfang.zeitpunkt,
    endeZeitpunkt: ende.zeitpunkt,
    dauerNominal: dauer,
    dauerInstant: Math.round(
      (ende.zeitpunkt.getTime() - anfang.zeitpunkt.getTime()) / 60_000),
    // Die Anomalie kommt vom ANFANG. Nur der ist der Anker, den die Regel
    // nennt; ein Ende in der Luecke ist eine Folge, kein eigener Befund.
    anomalie: anfang.anomalie,
  };
}

function ausOrtszeit(wert: string, feld: string): { datum: string; stunde: number; minute: number } {
  const treffer = ORTSZEIT.exec(wert);
  if (treffer === null) {
    throw new VorschauFehler(`${feld} ist keine Ortszeit JJJJ-MM-TTTHH:MM: ${wert}`);
  }
  return { datum: treffer[1] as string, stunde: Number(treffer[2]), minute: Number(treffer[3]) };
}

/**
 * Die Vorschau eines Turnus im Fenster — Termine UND Ausfaelle, chronologisch.
 *
 * Die Reihenfolge ist dieselbe wie im Generator und nicht beliebig:
 * Entfaltung → Gueltigkeit → Ausnahmen → Feiertage. Eine Ausnahme, die einen
 * Feiertag ueberschreibt, muss vorher greifen — sonst faellt der eigens
 * angesetzte Zusatztermin am 3. Oktober weg, den jemand ausdruecklich
 * eingetragen hat.
 *
 * Der Unterschied zum Generator ist allein, dass hier nichts VERSCHWINDET:
 * ein Termin, den die Gueltigkeit oder ein Feiertag abschneidet, steht mit
 * `ausfall` in derselben Liste.
 */
export function turnusVorschau(
  traeger: VorschauTraeger,
  ausnahmen: readonly VorschauAusnahme[],
  feiertage: ReadonlyMap<string, string>,
  fenster: { readonly vonDatum: string; readonly bisDatum: string },
): readonly VorschauTermin[] {
  for (const [wert, feld] of [
    [fenster.vonDatum, 'fenster.vonDatum'], [fenster.bisDatum, 'fenster.bisDatum'],
    [traeger.gueltigAb, 'traeger.gueltigAb'],
  ] as const) {
    if (!DATUM.test(wert)) throw new VorschauFehler(`${feld} ist kein Kalendertag: ${wert}`);
  }
  if (traeger.gueltigBis !== null && !DATUM.test(traeger.gueltigBis)) {
    throw new VorschauFehler(`traeger.gueltigBis ist kein Kalendertag: ${traeger.gueltigBis}`);
  }
  const dauer = pruefeDauer(traeger.dauerMinuten, 'traeger.dauerMinuten');
  if (traeger.rrule.trim() === '') {
    throw new VorschauFehler('Ein Turnus ohne Regel hat keine Vorschau.');
  }

  /*
   * Das Fenster wird NICHT an der Gueltigkeit beschnitten, anders als im
   * Generator. Genau die abgeschnittenen Tage sind die Auskunft, die jemand
   * auf dem Blatt sucht: „ab dem 1. Juli ist hier nichts mehr" ist etwas
   * anderes als eine Liste, die einfach aufhoert. COUNT bleibt davon
   * unberuehrt, weil `entfalte` immer ab dem Anker zaehlt.
   */
  const vorkommnisse = entfalte(
    traeger.rrule, traeger.dtstartLokal,
    { vonDatum: fenster.vonDatum, bisDatum: fenster.bisDatum },
  );

  const nachTag = new Map<string, VorschauAusnahme[]>();
  for (const a of ausnahmen) {
    if (!DATUM.test(a.datum)) {
      throw new VorschauFehler(`ausnahme(${a.id}).datum ist kein Kalendertag: ${a.datum}`);
    }
    const liste = nachTag.get(a.datum);
    if (liste === undefined) nachTag.set(a.datum, [a]);
    else liste.push(a);
  }

  const termine: VorschauTermin[] = [];

  for (const v of vorkommnisse) {
    const tagesAusnahmen = nachTag.get(v.planDatum) ?? [];
    const ausfall = tagesAusnahmen.find((a) => a.art === 'ausfall');
    if (ausfall !== undefined) {
      termine.push({
        planDatum: v.planDatum,
        beginnLokal: v.beginnLokal,
        endeLokal: baueTermin(
          v.planDatum, Number(v.beginnLokal.slice(0, 2)),
          Number(v.beginnLokal.slice(3, 5)), dauer).endeLokal,
        endetAmFolgetag: false,
        beginnZeitpunkt: null, endeZeitpunkt: null,
        dauerNominal: dauer, dauerInstant: null, anomalie: 'keine',
        feiertag: feiertage.get(v.planDatum) ?? null,
        ausfall: 'ausnahme_ausfall', art: 'regel', grund: ausfall.grund,
      });
      continue;
    }

    const verschiebung = tagesAusnahmen.find((a) => a.art === 'verschiebung');
    let datum = v.planDatum;
    let stunde = Number(v.beginnLokal.slice(0, 2));
    let minute = Number(v.beginnLokal.slice(3, 5));
    let tagesDauer = dauer;
    if (verschiebung !== undefined) {
      if (verschiebung.ersatzBeginnLokal === null) {
        throw new VorschauFehler(
          `Verschiebung ${verschiebung.id} ohne ersatz_beginn_lokal — die Pruefbedingung der `
          + 'Tabelle laesst das nicht zu, die Zeile stammt also nicht aus dieser Anwendung.');
      }
      const ziel = ausOrtszeit(verschiebung.ersatzBeginnLokal, `ausnahme(${verschiebung.id})`);
      datum = ziel.datum;
      stunde = ziel.stunde;
      minute = ziel.minute;
      if (verschiebung.dauerMinuten !== null) {
        tagesDauer = pruefeDauer(verschiebung.dauerMinuten, `ausnahme(${verschiebung.id}).dauer`);
      }
    }

    const ausserhalb = datum < traeger.gueltigAb
      || (traeger.gueltigBis !== null && datum > traeger.gueltigBis);
    const feiertag = feiertage.get(datum) ?? null;
    const feiertagsAusfall = feiertag !== null && traeger.feiertagsregel === 'ausfall';
    const kern = baueTermin(datum, stunde, minute, tagesDauer);

    termine.push({
      ...kern,
      planDatum: datum,
      ...(ausserhalb || feiertagsAusfall
        ? { beginnZeitpunkt: null, endeZeitpunkt: null, dauerInstant: null }
        : {}),
      feiertag,
      ausfall: ausserhalb ? 'ausserhalb_gueltigkeit' : feiertagsAusfall ? 'feiertag' : null,
      art: verschiebung === undefined ? 'regel' : 'verschiebung',
      grund: verschiebung?.grund ?? null,
    });
  }

  /*
   * Zusatztermine stehen ausserhalb der Regel — auch ausserhalb der
   * Feiertagsregel: wer den 3. Oktober eigens eintraegt, meint ihn. Die
   * Gueltigkeit gilt trotzdem, denn ein Zusatztermin nach dem Ende des
   * Vertrags ist keine Leistung, die jemand schuldet.
   */
  for (const a of ausnahmen) {
    if (a.art !== 'zusatz') continue;
    if (a.datum < fenster.vonDatum || a.datum > fenster.bisDatum) continue;
    const start = a.ersatzBeginnLokal !== null
      ? ausOrtszeit(a.ersatzBeginnLokal, `ausnahme(${a.id})`)
      : { datum: a.datum, stunde: traeger.dtstartLokal.stunde, minute: traeger.dtstartLokal.minute };
    const tagesDauer = a.dauerMinuten === null
      ? dauer : pruefeDauer(a.dauerMinuten, `ausnahme(${a.id}).dauer`);
    const ausserhalb = start.datum < traeger.gueltigAb
      || (traeger.gueltigBis !== null && start.datum > traeger.gueltigBis);
    const kern = baueTermin(start.datum, start.stunde, start.minute, tagesDauer);
    termine.push({
      ...kern,
      planDatum: start.datum,
      ...(ausserhalb ? { beginnZeitpunkt: null, endeZeitpunkt: null, dauerInstant: null } : {}),
      feiertag: feiertage.get(start.datum) ?? null,
      ausfall: ausserhalb ? 'ausserhalb_gueltigkeit' : null,
      art: 'zusatz',
      grund: a.grund,
    });
  }

  return [...termine].sort((a, b) => (a.planDatum === b.planDatum
    ? a.beginnLokal.localeCompare(b.beginnLokal)
    : a.planDatum.localeCompare(b.planDatum)));
}
