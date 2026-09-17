/**
 * Was eine Serie im Fenster ergibt — die Rechnung, ohne Datenbank.
 *
 * Der Generator (`src/server/jobs/einsaetzeGenerieren.ts`) besteht aus zwei
 * Haelften, und die Trennung ist Absicht: hier steht, WELCHE Schichten eine
 * Serie im Fenster verlangt, dort steht, wie daraus Zeilen werden. Die
 * schwierigen Faelle — Zeitumstellung, Ausnahmen, Feiertage, der
 * Idempotenzschluessel — sind alle hier und damit ohne Datenbank pruefbar.
 *
 * ## Wanduhr, nicht Instant
 *
 * Diese Datei rechnet **ausschliesslich in Ortszeit**. Sie liefert
 * `plan_datum`, `beginn_lokal`, `ende_lokal` und `endet_am_folgetag`; den
 * Instant setzt Postgres (`04-PLANUNG-ZEIT.md` §7.2: „one IANA tz database —
 * the server's — is authoritative and the Node process never converts a zone
 * itself"). Zwei Zonendatenbanken, die um ein Jahr auseinanderliegen, waeren
 * sonst zwei Wahrheiten ueber dieselbe Nacht.
 *
 * ## Die Dauer ist NOMINAL
 *
 * `turnus.dauer_minuten` ist eine Aussage ueber die Wanduhr, nicht ueber die
 * verstrichene Zeit. 22:00 plus 480 Minuten ist 06:00 — in jeder der drei
 * Naechte. Erst der Instantabstand unterscheidet sie: 480 in einer normalen
 * Nacht, 420 in der Vorstellungsnacht, 540 in der Rueckstellungsnacht (K-11).
 *
 * Genau anders herum waere es falsch: 480 Minuten VERSTRICHENE Zeit auf
 * 22:00 addiert endet in der Vorstellungsnacht um 07:00 Ortszeit. Die Kolonne
 * stuende dann eine Stunde laenger im Objekt als vertraglich geschuldet, und
 * die Rechnung waere um eine Stunde falsch — jedes Jahr, in einer Nacht, in
 * der niemand hinsieht.
 */
import { entfalte, type Vorkommnis } from '@/lib/datum/rrule';

/** Die Feiertagsregel des Traegers (`03-GEWERKE.md` §5.3). */
export type Feiertagsregel = 'ausfall' | 'unveraendert';

/** Die dokumentierte Abweichung an einem Tag (`03-GEWERKE.md` §5.4). */
export type AusnahmeArt = 'ausfall' | 'zusatz' | 'verschiebung';

/** Woher eine Schicht kommt — sie steht so im Idempotenzschluessel (§8.3). */
export type Herkunft = 'serie' | 'ausnahme';

/**
 * Ein Bedarfstraeger, wie ihn `app.planungsbedarf` liefert.
 *
 * `rrule` ist `null` fuer eine Veranstaltung (SEC-08): ein einzelnes Fenster
 * ist keine Wiederholung, geht aber durch denselben Generator, damit die
 * Zeitumstellung nicht zweimal implementiert wird (`04-PLANUNG-ZEIT.md` §8.1).
 */
export interface Bedarfstraeger {
  readonly planungsserieId: string;
  readonly quelle: 'turnus' | 'posten' | 'veranstaltung';
  readonly rrule: string | null;
  /** `dtstart_lokal` — Wanduhr, ohne Zone (`03-GEWERKE.md` §10.1). */
  readonly dtstartLokal: { readonly datum: string; readonly stunde: number; readonly minute: number };
  readonly zeitzone: string;
  readonly dauerMinuten: number;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  readonly feiertagsregel: Feiertagsregel;
  /** Inklusiv. Vor diesem Tag gibt es die Serie nicht. */
  readonly gueltigAb: string;
  /** Inklusiv, `null` = unbefristet. */
  readonly gueltigBis: string | null;
}

export interface Ausnahme {
  readonly id: string;
  /** Der betroffene **Berliner** Kalendertag des Vorkommnisses (K-11). */
  readonly datum: string;
  readonly art: AusnahmeArt;
  /** Nur bei `verschiebung` verlangt; bei `zusatz` zulaessig. `JJJJ-MM-TTTHH:MM`. */
  readonly ersatzBeginnLokal: string | null;
  /** Weicht die Dauer ab? Sonst erbt das Vorkommnis die des Turnus. */
  readonly dauerMinuten: number | null;
  /**
   * Die Nacht laeuft, aber mit weniger Wachen (`posten_ausnahme.ersatz_besetzung`,
   * 0069 §6.4) — die vierte Ausnahmeart aus 04-PLANUNG-ZEIT.md §8.2.
   *
   * `null` oder fehlend heisst: die Sollbesetzung des Traegers gilt
   * unveraendert — **nicht** „null Wachen". Eine Reinigungsrunde kennt diese
   * Art nicht; `turnus_ausnahme` traegt die Spalte gar nicht.
   */
  readonly ersatzBesetzung?: number | null;
}

/** Das Fenster in Berliner Kalendertagen, beide Grenzen inklusiv. */
export interface Fenster {
  readonly vonDatum: string;
  readonly bisDatum: string;
}

/** Eine geplante Schicht — Ortszeitfelder, kein Instant (siehe Kopf). */
export interface GeplanterEinsatz {
  readonly quellSchluessel: string;
  readonly planDatum: string;
  /** `HH:MM`. */
  readonly beginnLokal: string;
  /** `HH:MM`. Nominal aus `beginnLokal + dauerMinuten` auf der Wanduhr. */
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
  readonly sollBesetzung: number;
  readonly minBesetzung: number;
  readonly herkunft: Herkunft;
  /** Gesetzt, wenn die Schicht auf einen Feiertag faellt und trotzdem stattfindet. */
  readonly feiertagDatum: string | null;
}

/** Was der Lauf NICHT angelegt hat — und warum (§8.4: nichts wird verschluckt). */
export interface Uebersprungen {
  readonly datum: string;
  readonly quellSchluessel: string;
  readonly grund: 'feiertag' | 'ausnahme_ausfall' | 'ausserhalb_gueltigkeit';
  /** Bei `feiertag` der Name, damit die Meldung lesbar ist. */
  readonly hinweis: string | null;
}

export interface Planungsergebnis {
  readonly einsaetze: readonly GeplanterEinsatz[];
  readonly uebersprungen: readonly Uebersprungen[];
}

export class PlanungsFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PlanungsFehler';
  }
}

/** Eine Schicht laenger als ein Tag ist keine Schicht, sondern ein Tippfehler. */
const MAX_DAUER_MINUTEN = 24 * 60 - 1;

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const ORTSZEIT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/u;

function pruefeDatum(wert: string, feld: string): string {
  if (!DATUM.test(wert)) throw new PlanungsFehler(`${feld} ist kein Kalendertag: ${wert}`);
  return wert;
}

function zweistellig(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Der Idempotenzschluessel (§8.3).
 *
 * Er nennt die **urspruengliche** Identitaet des Vorkommnisses: Serie,
 * urspruenglicher Plantag, urspruengliche Anfangszeit. Deshalb erzeugt eine
 * Verschiebung keine zweite Schicht — sie aendert Datum und Instants derselben
 * Zeile, und der dritte Lauf findet sie unter demselben Schluessel wieder.
 *
 * Und deshalb steht das Objekt NICHT darin: zwei Serien, die zur selben
 * Sekunde am selben Objekt eine Schicht verlangen, ergeben zwei Schluessel und
 * zwei sichtbare Zeilen (TIM-04). Ein Schluessel aus `(objekt_id, beginn)`
 * haette sie zu einer verschmolzen — still, und genau in dem Fall, den die
 * Abnahme prueft.
 */
export function serienSchluessel(
  planungsserieId: string, urspruenglichesDatum: string, urspruenglicheZeit: string,
): string {
  return `serie:${planungsserieId}:${urspruenglichesDatum.replace(/-/gu, '')}:${urspruenglicheZeit.replace(':', '')}`;
}

/** Der Schluessel eines Zusatztermins — er gehoert der Ausnahme, nicht der Regel. */
export function ausnahmeSchluessel(ausnahmeId: string): string {
  return `ausnahme:${ausnahmeId}`;
}

interface NominalesEnde {
  readonly endeLokal: string;
  readonly endetAmFolgetag: boolean;
}

/**
 * Das Ende auf der Wanduhr — `beginn + dauer`, ohne Zonenrechnung.
 *
 * Der Uebertrag ueber Mitternacht wird als `endet_am_folgetag` gemeldet und
 * nicht in `ende_lokal` eingerechnet: `ende_lokal` ist eine Uhrzeit, kein
 * Zeitstempel, und `06:00` am Folgetag ist genau das, was auf dem Dienstplan
 * steht.
 */
export function nominalesEnde(
  beginnStunde: number, beginnMinute: number, dauerMinuten: number,
): NominalesEnde {
  if (!Number.isInteger(dauerMinuten) || dauerMinuten <= 0) {
    throw new PlanungsFehler(`dauer_minuten muss eine positive ganze Zahl sein: ${dauerMinuten}`);
  }
  if (dauerMinuten > MAX_DAUER_MINUTEN) {
    throw new PlanungsFehler(
      `dauer_minuten ${dauerMinuten} ueberschreitet einen Tag. Eine Schicht ueber 24 Stunden ist ` +
        'keine Schicht (ArbZG §3 laesst hoechstens 10 Stunden zu) — vermutlich steht die Dauer in ' +
        'Sekunden oder das Ende in einer eigenen Spalte.',
    );
  }
  const start = beginnStunde * 60 + beginnMinute;
  const roh = start + dauerMinuten;
  const versatz = Math.floor(roh / 1440);
  const rest = roh % 1440;
  return {
    endeLokal: `${zweistellig(Math.floor(rest / 60))}:${zweistellig(rest % 60)}`,
    endetAmFolgetag: versatz > 0,
  };
}

/**
 * Die Besetzung einer Schicht, wenn eine Ausnahme sie in reduzierter Staerke
 * ansetzt (§6.4, §8.2 vierte Art).
 *
 * `ersatz_besetzung` ersetzt die SOLLBESETZUNG — so steht es in 0069. Was
 * damit aus der MINDESTBESETZUNG wird, steht dort nicht, und es ist keine
 * Kleinigkeit: eine Nacht mit einer Wache statt zwei liegt unter dem
 * Minimum eines Postens, der zwei verlangt, und ob das zulaessig ist,
 * entscheidet der Vertrag (SEC-01) und nicht diese Funktion.
 *
 * Solange die Frage offen ist, wird das Minimum **mitgesenkt** und nie
 * ueberschritten: `min(min, ersatz)`. Damit entsteht keine Schicht, die per
 * Konstruktion unterbesetzt ist (`min > soll` waere genau das), und die
 * reduzierte Nacht erscheint in `offene-schichten` nicht als Notfall, den
 * niemand beheben kann. Die Gegenrichtung — Minimum stehen lassen und die
 * Nacht dauerhaft rot melden — waere die andere denkbare Antwort, und sie
 * gehoert dem Kunden.
 *
 * // TODO(client, O-714): Darf eine Ausnahme mit reduzierter Staerke unter die Mindestbesetzung des Postens gehen, oder ist die Mindestbesetzung eine harte Untergrenze, die eine Ausnahme nicht senken kann?
 */
export function besetzungMitAusnahme(
  traeger: Pick<Bedarfstraeger, 'sollBesetzung' | 'minBesetzung'>,
  ersatzBesetzung: number | null | undefined,
): { readonly sollBesetzung: number; readonly minBesetzung: number } {
  if (ersatzBesetzung === null || ersatzBesetzung === undefined) {
    return { sollBesetzung: traeger.sollBesetzung, minBesetzung: traeger.minBesetzung };
  }
  if (!Number.isInteger(ersatzBesetzung) || ersatzBesetzung < 1) {
    throw new PlanungsFehler(
      `ersatz_besetzung ${String(ersatzBesetzung)} ist keine Staerke — die Pruefbedingung `
      + 'der Tabelle laesst nur ganze Zahlen ab 1 zu, die Zeile stammt also nicht aus '
      + 'dieser Anwendung.',
    );
  }
  return {
    sollBesetzung: ersatzBesetzung,
    minBesetzung: Math.min(traeger.minBesetzung, ersatzBesetzung),
  };
}

function ausOrtszeit(wert: string, feld: string): { datum: string; stunde: number; minute: number } {
  const treffer = ORTSZEIT.exec(wert);
  if (treffer === null) {
    throw new PlanungsFehler(`${feld} ist keine Ortszeit \`JJJJ-MM-TTTHH:MM\`: ${wert}`);
  }
  return {
    datum: treffer[1] as string,
    stunde: Number(treffer[2]),
    minute: Number(treffer[3]),
  };
}

/**
 * Welche Schichten die Serie im Fenster verlangt.
 *
 * `feiertage` ist eine Menge von Kalendertagen mit Namen — der Aufrufer hat sie
 * bereits fuer das **aufgeloeste Bundesland** der Serie geladen (§8.5). Diese
 * Funktion entscheidet nicht, welches Land gilt; sie wuesste es auch nicht.
 *
 * Die Reihenfolge ist festgelegt und nicht beliebig:
 * Entfaltung → Gueltigkeit → Ausnahmen → Feiertage. Eine Ausnahme, die einen
 * Feiertag ueberschreibt, muss vorher greifen — sonst faellt der eigens
 * angesetzte Zusatztermin am 3. Oktober weg, den jemand ausdruecklich
 * eingetragen hat.
 */
export function planeVorkommnisse(
  traeger: Bedarfstraeger,
  ausnahmen: readonly Ausnahme[],
  feiertage: ReadonlyMap<string, string>,
  fenster: Fenster,
): Planungsergebnis {
  pruefeDatum(fenster.vonDatum, 'fenster.vonDatum');
  pruefeDatum(fenster.bisDatum, 'fenster.bisDatum');
  pruefeDatum(traeger.gueltigAb, 'traeger.gueltigAb');
  if (traeger.gueltigBis !== null) pruefeDatum(traeger.gueltigBis, 'traeger.gueltigBis');

  // Die Gueltigkeit schneidet das Fenster, sie filtert nicht hinterher: eine
  // Serie, die im Mai endet, soll im Juni keine Kandidaten mehr erzeugen, die
  // erst danach verworfen werden — sonst zaehlt COUNT sie mit.
  const von = traeger.gueltigAb > fenster.vonDatum ? traeger.gueltigAb : fenster.vonDatum;
  const bis =
    traeger.gueltigBis !== null && traeger.gueltigBis < fenster.bisDatum
      ? traeger.gueltigBis
      : fenster.bisDatum;

  const einsaetze: GeplanterEinsatz[] = [];
  const uebersprungen: Uebersprungen[] = [];
  if (bis < von) return { einsaetze, uebersprungen };

  const vorkommnisse: readonly Vorkommnis[] =
    traeger.rrule === null || traeger.rrule === ''
      ? einzelnesFenster(traeger, von, bis)
      : entfalte(traeger.rrule, traeger.dtstartLokal, { vonDatum: von, bisDatum: bis });

  // Ausnahmen nach Tag, damit die Schleife unten nicht je Vorkommnis sucht.
  const nachTag = new Map<string, Ausnahme[]>();
  for (const a of ausnahmen) {
    pruefeDatum(a.datum, `ausnahme(${a.id}).datum`);
    const liste = nachTag.get(a.datum);
    if (liste === undefined) nachTag.set(a.datum, [a]);
    else liste.push(a);
  }

  for (const v of vorkommnisse) {
    const schluessel = serienSchluessel(traeger.planungsserieId, v.planDatum, v.beginnLokal);
    const tagesAusnahmen = nachTag.get(v.planDatum) ?? [];
    const ausfall = tagesAusnahmen.find((a) => a.art === 'ausfall');
    if (ausfall !== undefined) {
      uebersprungen.push({
        datum: v.planDatum, quellSchluessel: schluessel,
        grund: 'ausnahme_ausfall', hinweis: null,
      });
      continue;
    }

    const verschiebung = tagesAusnahmen.find((a) => a.art === 'verschiebung');
    let datum = v.planDatum;
    let stunde = Number(v.beginnLokal.slice(0, 2));
    let minute = Number(v.beginnLokal.slice(3, 5));
    let dauer = traeger.dauerMinuten;
    if (verschiebung !== undefined) {
      if (verschiebung.ersatzBeginnLokal === null) {
        throw new PlanungsFehler(
          `Verschiebung ${verschiebung.id} ohne ersatz_beginn_lokal — die Pruefbedingung der ` +
            'Tabelle laesst das nicht zu, die Zeile stammt also nicht aus dieser Anwendung.',
        );
      }
      const ziel = ausOrtszeit(verschiebung.ersatzBeginnLokal, `ausnahme(${verschiebung.id})`);
      datum = ziel.datum;
      stunde = ziel.stunde;
      minute = ziel.minute;
      if (verschiebung.dauerMinuten !== null) dauer = verschiebung.dauerMinuten;
    }

    const feiertag = feiertage.get(datum);
    if (feiertag !== undefined && traeger.feiertagsregel === 'ausfall') {
      uebersprungen.push({
        datum, quellSchluessel: schluessel, grund: 'feiertag', hinweis: feiertag,
      });
      continue;
    }

    const ende = nominalesEnde(stunde, minute, dauer);
    /*
     * Die reduzierte Staerke haengt an der VERSCHIEBUNG dieses Tages — die
     * einzige Ausnahmeart, die ein regulaeres Vorkommnis noch erreicht
     * (`ausfall` ist oben weg, `zusatz` macht seinen eigenen Termin). Bei
     * einem Posten laesst `posten_ausnahme_uk (posten_id, datum)` ohnehin nur
     * eine Zeile je Tag zu.
     */
    const staerke = besetzungMitAusnahme(traeger, verschiebung?.ersatzBesetzung);
    einsaetze.push({
      quellSchluessel: schluessel,
      planDatum: datum,
      beginnLokal: `${zweistellig(stunde)}:${zweistellig(minute)}`,
      endeLokal: ende.endeLokal,
      endetAmFolgetag: ende.endetAmFolgetag,
      sollBesetzung: staerke.sollBesetzung,
      minBesetzung: staerke.minBesetzung,
      herkunft: 'serie',
      feiertagDatum: feiertag !== undefined ? datum : null,
    });
  }

  // Zusatztermine stehen ausserhalb der Regel — auch ausserhalb der
  // Feiertagsregel: wer den 3. Oktober eigens eintraegt, meint ihn.
  for (const a of ausnahmen) {
    if (a.art !== 'zusatz') continue;
    if (a.datum < von || a.datum > bis) continue;
    const start =
      a.ersatzBeginnLokal !== null
        ? ausOrtszeit(a.ersatzBeginnLokal, `ausnahme(${a.id})`)
        : { datum: a.datum, stunde: traeger.dtstartLokal.stunde, minute: traeger.dtstartLokal.minute };
    const ende = nominalesEnde(start.stunde, start.minute, a.dauerMinuten ?? traeger.dauerMinuten);
    const staerke = besetzungMitAusnahme(traeger, a.ersatzBesetzung);
    einsaetze.push({
      quellSchluessel: ausnahmeSchluessel(a.id),
      planDatum: start.datum,
      beginnLokal: `${zweistellig(start.stunde)}:${zweistellig(start.minute)}`,
      endeLokal: ende.endeLokal,
      endetAmFolgetag: ende.endetAmFolgetag,
      sollBesetzung: staerke.sollBesetzung,
      minBesetzung: staerke.minBesetzung,
      herkunft: 'ausnahme',
      feiertagDatum: feiertage.get(start.datum) ?? null,
    });
  }

  einsaetze.sort((a, b) =>
    a.planDatum === b.planDatum
      ? a.beginnLokal.localeCompare(b.beginnLokal)
      : a.planDatum.localeCompare(b.planDatum));
  return { einsaetze, uebersprungen };
}

/**
 * Eine Veranstaltung (SEC-08) ist ein einzelnes Fenster, keine Wiederholung.
 *
 * Sie laeuft trotzdem durch dieselbe Funktion — §8.1 verlangt das
 * ausdruecklich, weil ein zweiter Weg zum Instant ein zweiter Ort waere, an
 * dem die Zeitumstellung falsch sein kann.
 */
function einzelnesFenster(
  traeger: Bedarfstraeger, von: string, bis: string,
): readonly Vorkommnis[] {
  const datum = traeger.dtstartLokal.datum;
  if (datum < von || datum > bis) return [];
  return [{
    planDatum: datum,
    beginnLokal: `${zweistellig(traeger.dtstartLokal.stunde)}:${zweistellig(traeger.dtstartLokal.minute)}`,
    // Der Instant interessiert hier nicht — Postgres setzt ihn (siehe Kopf).
    beginnZeitpunkt: new Date(0),
    anomalie: 'keine',
  }];
}
