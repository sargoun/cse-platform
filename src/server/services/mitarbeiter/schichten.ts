/**
 * Die eigenen Schichten — ueber alle Beschaeftigungen (EMP-02, EMP-14, TIM-01).
 *
 * **Eine Anmeldung, zwei Gesellschaften, eine Liste.** Das ist der Kern von
 * EMP-14 und der Grund, warum diese Abfrage im Personen-Scope laeuft und nicht
 * in der Gruppenansicht (K-18): die Gruppenpolicy verlangt
 * `gruppe.dienstplan.lesen`, ein Leitungsrecht, das keine Reinigungskraft
 * haelt — die Liste waere leer, ohne Fehler, ohne Meldung.
 *
 * **Jede Zeile traegt ihre Gesellschaft, und zwar als NAME.** DESIGN §9: die
 * Identitaetsfarbe identifiziert, der Name traegt die Bedeutung. Wer nur den
 * Farbstreifen zeigt, hat einer farbenblinden Kraft nicht gesagt, bei welcher
 * GmbH sie morgen um 06:00 steht — und die beiden haben verschiedene
 * Vorgesetzte, verschiedene Objekte und verschiedene Stundenkonten (D-09).
 *
 * **Jede Uhrzeit kommt fertig aus der Datenbank**, in Berliner Ortszeit
 * gerechnet (`at time zone`, Invariante 2). Der Node-Prozess rechnet keine
 * Zone um: seine Zonendatenbank ist nicht die des Servers, und `TZ` der
 * Laufzeit soll eine Nachtschicht nicht um eine Stunde verschieben.
 *
 * **Die Dauer ist der Abstand zweier Instants** und deshalb ueber die
 * Zeitumstellung hinweg richtig (K-11): die Nacht der Vorwaertsstellung hat
 * wirklich 420 Minuten, die der Rueckstellung 540. Eine Subtraktion von
 * Wanduhrzeiten kann diese Zahlen nicht erzeugen.
 */
import type { LeseKontext } from '../../kontext/index.js';

/** Eine Schicht, wie das Mitarbeiterportal sie zeigt. */
export interface EigeneSchicht {
  readonly zuordnungId: string;
  readonly einsatzId: string;
  readonly anstellungId: string;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly objekt: string | null;
  readonly objektId: string | null;
  /**
   * Die Baustelle dieser Schicht — oder `null`, wenn es keine ist.
   *
   * Sie steht hier, weil das Bautagebuch ohne sie nicht adressierbar ist
   * (BAU-07): `/portal/mein/schichten/[zuordnungId]/bautagebuch` braucht das
   * Projekt, und es aus der Anfrage zu nehmen waere genau die Stelle, an der
   * jemand ein fremdes einsetzt (K-02). Kein Kunde, kein Auftrag, kein Preis
   * kommt damit mit — `einsatz.projekt_id` ist eine Zuordnung, keine
   * kaufmaennische Angabe (EMP-13, K-05).
   */
  readonly projektId: string | null;
  /** Der Berliner Plantag, `JJJJ-MM-TT`. */
  readonly planDatum: string;
  /** `TT.MM.JJJJ HH:MM` in Berliner Ortszeit — fertig aus der Datenbank. */
  readonly beginnLokal: string;
  readonly endeLokal: string;
  /** Wahr, wenn die Schicht ueber Mitternacht laeuft. */
  readonly endetAmFolgetag: boolean;
  readonly pauseGeplantMinuten: number;
  /** Differenz zweier UTC-Instants, in ganzen Minuten (K-11). */
  readonly dauerMinuten: number;
  readonly funktion: string | null;
  readonly status: string;
  readonly einsatzStatus: string;
  /** `keine` · `dst_vor` · `dst_rueck` — die Nacht, die nicht 8 Stunden hat. */
  readonly zeitanomalie: string;
  readonly laeuftJetzt: boolean;
  /**
   * Ist die Schicht VORBEI? (`now() >= ende_zeitpunkt`)
   *
   * Sie steht hier, weil mit dieser Minute die Erfassung schliesst und die
   * Seite das SAGEN muss. `app.ist_eingesetzt_auf_objekt` und
   * `app.ist_eingesetzt_auf_projekt` verlangen `e.ende_zeitpunkt >= now()`
   * (0004); danach greift keine der M1-Policies aus 0300/0303/0304 mehr. Ohne
   * dieses Feld boten Wachbuch, Fotos, Leistungsnachweis und Bautagebuch
   * weiter ein Formular an, das die Datenbank dann abweist — beim
   * Leistungsnachweis mit einem nackten `422 kein_objekt`.
   *
   * Wie lange nach Schichtende noch erfasst werden darf, ist offen (O-740);
   * bis zur Antwort ist die Grenze das Schichtende, und die Seite nennt sie.
   */
  readonly beendet: boolean;
  /**
   * Wurde die Einteilung AUS DEM PLAN GENOMMEN? (`entfernt_am is not null`)
   *
   * `findeEigeneSchicht` filtert bewusst NICHT auf `entfernt_am is null` — die
   * Detailseite soll die entfernte Einteilung weiter zeigen (0300). Tragen
   * soll sie aber nichts mehr: `einsatz_zuordnung.t_selbst_m1` verlangt
   * `entfernt_am is null`, also endet jeder Schreibweg mit `404
   * nicht_gefunden`. Eine Seite, die zum Ausfuellen einlaedt und den Menschen
   * dann wie einen Fremden behandelt, ist schlechter als eine, die den Grund
   * schreibt.
   */
  readonly entfernt: boolean;
}

/**
 * Die festgeschriebene Feldliste (K-05, EMP-13).
 *
 * Kein `kunde`, kein `auftrag`, kein Preis und kein Satz. Die Abnahme prueft
 * die Antwort Feld fuer Feld gegen diese Liste — eine Stichprobe nach dem Wort
 * „preis" faende ein Feld namens `kondition` nicht.
 */
export const SCHICHT_FELDER = [
  'zuordnungId', 'einsatzId', 'anstellungId', 'mandantSlug', 'mandantName',
  'objekt', 'objektId', 'projektId',
  'planDatum', 'beginnLokal', 'endeLokal', 'endetAmFolgetag',
  'pauseGeplantMinuten', 'dauerMinuten', 'funktion', 'status', 'einsatzStatus',
  'zeitanomalie', 'laeuftJetzt', 'beendet', 'entfernt',
] as const;

interface SchichtRoh {
  readonly zuordnung_id: string;
  readonly einsatz_id: string;
  readonly anstellung_id: string;
  readonly mandant_slug: string;
  readonly mandant_name: string;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly projekt_id: string | null;
  readonly plan_datum: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly endet_am_folgetag: boolean;
  readonly pause_geplant_minuten: number;
  readonly dauer_minuten: number;
  readonly funktion: string | null;
  readonly status: string;
  readonly einsatz_status: string;
  readonly zeitanomalie: string;
  readonly laeuft_jetzt: boolean;
  readonly beendet: boolean;
  readonly entfernt: boolean;
}

/**
 * Die Spalten stehen einmal da und werden von Liste, Einzelansicht und
 * „Heute" benutzt. Drei Fassungen derselben Auswahl gehen auseinander, sobald
 * eine davon eine Spalte dazubekommt — und die Einzelansicht zeigte dann etwas
 * anderes als die Zeile, aus der man sie geoeffnet hat.
 */
const SPALTEN = `
  z.id                                          as zuordnung_id,
  z.einsatz_id,
  z.anstellung_id,
  m.slug                                        as mandant_slug,
  m.name                                        as mandant_name,
  o.bezeichnung                                 as objekt,
  e.objekt_id,
  e.projekt_id,
  to_char(e.plan_datum, 'YYYY-MM-DD')           as plan_datum,
  to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                as beginn_lokal,
  to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                as ende_lokal,
  ((z.ende_zeitpunkt at time zone 'Europe/Berlin')::date
   > (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date)
                                                as endet_am_folgetag,
  e.pause_geplant_minuten,
  (extract(epoch from (z.ende_zeitpunkt - z.beginn_zeitpunkt)) / 60)::int
                                                as dauer_minuten,
  z.funktion,
  z.status::text                                as status,
  e.status::text                                as einsatz_status,
  e.zeitanomalie::text                          as zeitanomalie,
  (now() >= z.beginn_zeitpunkt and now() < z.ende_zeitpunkt)
                                                as laeuft_jetzt,
  -- now() kommt aus der DATENBANK (Invariante 5) — dieselbe Uhr, die
  -- app.ist_eingesetzt_auf_objekt benutzt. Aus dem Node-Prozess gerechnet
  -- koennten Seite und Policy um Sekunden auseinanderliegen, und dann
  -- verspraeche der Bildschirm ein Formular, das die Zeile schon abweist.
  (now() >= z.ende_zeitpunkt)                   as beendet,
  (z.entfernt_am is not null)                   as entfernt`;

const QUELLE = `
  from einsatz_zuordnung z
  join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
  join mandant m on m.id = z.mandant_id
  left join objekt o on o.mandant_id = e.mandant_id and o.id = e.objekt_id`;

/**
 * Eine entfernte Zuordnung ist keine Schicht mehr — aber sie wird nicht
 * geloescht (Invariante 8). Sie steht deshalb nicht in dieser Liste und ist
 * trotzdem noch da.
 */
const LEBEND = 'z.entfernt_am is null';

function abbilden(z: SchichtRoh): EigeneSchicht {
  return {
    zuordnungId: z.zuordnung_id,
    einsatzId: z.einsatz_id,
    anstellungId: z.anstellung_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
    objekt: z.objekt,
    objektId: z.objekt_id,
    projektId: z.projekt_id,
    planDatum: z.plan_datum,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    endetAmFolgetag: z.endet_am_folgetag,
    pauseGeplantMinuten: Number(z.pause_geplant_minuten),
    dauerMinuten: Number(z.dauer_minuten),
    funktion: z.funktion,
    status: z.status,
    einsatzStatus: z.einsatz_status,
    zeitanomalie: z.zeitanomalie,
    laeuftJetzt: z.laeuft_jetzt,
    beendet: z.beendet,
    entfernt: z.entfernt,
  };
}

export interface SchichtFenster {
  /** Berliner Kalendertag, einschliesslich. */
  readonly von: string;
  /** Berliner Kalendertag, einschliesslich. */
  readonly bis: string;
}

/**
 * Die Schichten eines Fensters — beide Gesellschaften, chronologisch.
 *
 * Gefiltert wird auf ÜBERSCHNEIDUNG und nicht auf den Plantag: sonst fehlte
 * die Nachtschicht vom Sonntag auf den Montag im Fenster des Montags, und
 * niemand vermisste sie.
 */
export async function listeEigeneSchichten(
  kontext: LeseKontext, fenster: SchichtFenster,
): Promise<readonly EigeneSchicht[]> {
  const roh = await kontext.abfrage<SchichtRoh>(
    `select ${SPALTEN} ${QUELLE}
      where ${LEBEND}
        and z.beginn_zeitpunkt < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'
        and z.ende_zeitpunkt   > ($1::date::timestamp) at time zone 'Europe/Berlin'
      order by z.beginn_zeitpunkt asc, m.sortierung asc, z.id asc`,
    [fenster.von, fenster.bis],
  );
  return roh.map(abbilden);
}

/** Eine einzelne Schicht — oder `null`, wenn sie diesem Menschen nicht gehoert. */
export async function findeEigeneSchicht(
  kontext: LeseKontext, zuordnungId: string,
): Promise<EigeneSchicht | null> {
  const [z] = await kontext.abfrage<SchichtRoh>(
    `select ${SPALTEN} ${QUELLE} where z.id = $1::uuid`,
    [zuordnungId],
  );
  // Kein 403: eine fremde Zuordnung ist fuer diese Anmeldung nicht vorhanden
  // (AUT-06). Der Unterschied waere die Auskunft, dass es sie gibt.
  return z === undefined ? null : abbilden(z);
}

/**
 * Die laufende Schicht — oder, wenn keine laeuft, die naechste (EMP-02).
 *
 * **`now()` kommt aus der DATENBANK**, nicht aus dem Node-Prozess und erst
 * recht nicht aus dem Geraet (Invariante 5). Eine Uhr, die falsch geht, soll
 * nicht entscheiden, welche Schicht als „jetzt" gilt.
 *
 * Die Sortierung setzt die laufende vor die kommende und danach die
 * frueheste — wer um 05:55 im Treppenhaus auf das Telefon sieht, will genau
 * eine Antwort und nicht eine Liste.
 */
export async function laufendeOderNaechsteSchicht(
  kontext: LeseKontext,
): Promise<EigeneSchicht | null> {
  const [z] = await kontext.abfrage<SchichtRoh>(
    `select ${SPALTEN} ${QUELLE}
      where ${LEBEND}
        and z.ende_zeitpunkt > now()
        and z.status <> 'abgesagt'
      order by (now() >= z.beginn_zeitpunkt) desc, z.beginn_zeitpunkt asc, z.id asc
      limit 1`,
  );
  return z === undefined ? null : abbilden(z);
}
