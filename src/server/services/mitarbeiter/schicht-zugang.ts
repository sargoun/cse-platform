/**
 * Die PER->M1-Bruecke einer Schicht (K-02, K-18, AUT-06).
 *
 * **Warum es diese Datei gibt.** Jeder Schreibweg des Mitarbeiterportals faehrt
 * denselben Weg: die Zuordnung im PERSONEN-Scope aufloesen — dort traegt
 * `einsatz_zuordnung.t_person` die Abgrenzung, und eine fremde Kennung liefert
 * null Zeilen —, den Mandanten DARAUS ableiten und dann `withTenant` mit
 * `portal: 'mitarbeiter'` betreten. Das Muster steht in
 * `api/zeit/einwand/route.ts` und `api/mein/antraege/route.ts`; was fehlte, war
 * die eine Abfrage, die vier Routen sonst je einzeln abschreiben.
 *
 * **Der Mandant kommt NIE aus der Anfrage** (K-02, Invariante 3). Ein
 * `mandant`-Feld im Formular waere genau die Stelle, an der jemand eine fremde
 * Gesellschaft einsetzt — und die Zeile saehe danach aus wie jede andere.
 *
 * **Null Zeilen sind 404 und nicht 403** (AUT-06): dass es die Schicht in einer
 * anderen Gesellschaft gibt, ist selbst eine Auskunft.
 *
 * **Eine entfernte Einteilung traegt nichts mehr.** Sie bleibt lesbar — die
 * Detailseite zeigt sie, Invariante 8 loescht nichts —, aber an ihr wird nicht
 * mehr dokumentiert: `entfernt_am is null` steht deshalb hier UND in der
 * Policy `einsatz_zuordnung.t_selbst_m1` (0300).
 */
import type { LeseKontext } from '../../kontext/index.js';

/** Was eine Schicht an Bezuegen traegt — und nichts darueber hinaus (EMP-13). */
export interface SchichtBezug {
  readonly zuordnungId: string;
  readonly anstellungId: string;
  readonly einsatzId: string;
  readonly objektId: string | null;
  readonly projektId: string | null;
  readonly mandantId: string;
  /** Der Berliner Kalendertag des Schichtbeginns (K-11), `JJJJ-MM-TT`. */
  readonly vonDatum: string;
  /** Der Berliner Kalendertag des Schichtendes — bei Nachtschichten der Folgetag. */
  readonly bisDatum: string;
  readonly laeuftJetzt: boolean;
  readonly beendet: boolean;
}

export class KeineEigeneSchicht extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403 — der Unterschied waere die Auskunft, dass es sie gibt.
    super(`Die Schicht ${id} gibt es fuer diese Anmeldung nicht.`);
    this.name = 'KeineEigeneSchicht';
  }
}

interface RohBezug {
  readonly zuordnung_id: string;
  readonly anstellung_id: string;
  readonly einsatz_id: string;
  readonly objekt_id: string | null;
  readonly projekt_id: string | null;
  readonly mandant_id: string;
  readonly von_datum: string;
  readonly bis_datum: string;
  readonly laeuft_jetzt: boolean;
  readonly beendet: boolean;
}

/**
 * Die eigene Schicht — im PERSONEN-Scope gelesen, oder `null`.
 *
 * Die Kalendertage kommen FERTIG aus der Datenbank (`at time zone
 * 'Europe/Berlin'`, Invariante 2). Der Node-Prozess rechnet keine Zone um:
 * seine Zonendatenbank ist nicht die des Servers, und `TZ` der Laufzeit soll
 * den Leistungszeitraum einer Nachtschicht nicht auf den Vortag schieben.
 */
export async function findeSchichtBezug(
  kontext: LeseKontext, zuordnungId: string,
): Promise<SchichtBezug | null> {
  const [z] = await kontext.abfrage<RohBezug>(
    `select z.id                as zuordnung_id,
            z.anstellung_id,
            z.einsatz_id,
            e.objekt_id,
            e.projekt_id,
            z.mandant_id,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'YYYY-MM-DD')
              as von_datum,
            to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'YYYY-MM-DD')
              as bis_datum,
            (now() >= z.beginn_zeitpunkt and now() < z.ende_zeitpunkt) as laeuft_jetzt,
            (now() >= z.ende_zeitpunkt)                                as beendet
       from einsatz_zuordnung z
       join einsatz e on e.mandant_id = z.mandant_id and e.id = z.einsatz_id
      where z.id = $1::uuid and z.entfernt_am is null`,
    [zuordnungId],
  );
  if (z === undefined) return null;
  return {
    zuordnungId: z.zuordnung_id,
    anstellungId: z.anstellung_id,
    einsatzId: z.einsatz_id,
    objektId: z.objekt_id,
    projektId: z.projekt_id,
    mandantId: z.mandant_id,
    vonDatum: z.von_datum,
    bisDatum: z.bis_datum,
    laeuftJetzt: z.laeuft_jetzt,
    beendet: z.beendet,
  };
}

/** Dieselbe Frage, aber werfend — der Weg der Route. */
export async function schichtBezugOderFehler(
  kontext: LeseKontext, zuordnungId: string,
): Promise<SchichtBezug> {
  const bezug = await findeSchichtBezug(kontext, zuordnungId);
  if (bezug === null) throw new KeineEigeneSchicht(zuordnungId);
  return bezug;
}
