import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';

/**
 * Die Stempeluhr im Arbeiterportal — die zweite Tuer zur selben Uhr
 * (D-618, O-93, TIM-07, EMP-01, K-08, `drizzle/0373`).
 *
 * **Der Befund, den das schliesst.** `src/app/check-in/[token]/` ist
 * vollstaendig gebaut und war vom Portal aus unerreichbar: eine Suche nach
 * `check-in` unter `src/app/portal/mein/` lieferte null Treffer. Wer sich
 * anmeldete, fand keinen Knopf „Arbeit beginnen" — der Bildschirm zeigte
 * `0:00 h` und keinen Weg, daran etwas zu aendern.
 *
 * **Die Sitzung ersetzt die ZUSTELLUNG der Marke, nicht die Marke.**
 * `app.checkin_aus_der_sitzung` stellt sie serverseitig aus und loest sie im
 * selben Vorgang ein; `app.checkin_verbrauchen` bleibt der einzige Schreiber
 * von `zeiteintrag` (K-08). Dieser Dienst ruft nur und rechnet nichts.
 *
 * **Dieser Dienst LIEST nur — der Stempel selbst steht in
 * `services/zeit/checkin.ts`.** Die Dienste des Arbeiterportals schreiben
 * nicht: seine drei Schreibwege (Einwand, Antrag, Abwesenheitsmeldung) liegen
 * alle im Fachdienst ihrer Domaene, und `tests/kern/mitarbeiter.test.ts`
 * besteht darauf — „ein vierter, im Portaldienst angelegter waere genau der,
 * der an ihnen vorbeifuehrt". Hier steht deshalb nur, was die Oberflaeche
 * WISSEN muss, um den richtigen Knopf zu zeigen.
 *
 * **Und er liefert KEINE Dauer.** Die Dauer entsteht beim Ausstempeln in der
 * Datenbank, aus der Differenz zweier UTC-Instants (Invariante 2). Was hier
 * herausgeht, ist der BEGINN und die Serverzeit dazu — damit die Oberflaeche
 * einen Zaehler zeigen kann, dessen Nullpunkt vom Server kommt und nicht von
 * der Uhr des Telefons (Invariante 5).
 */

/** Ein laufender Eintrag — oder `null`, wenn gerade nicht gestempelt ist. */
export interface OffenerEintrag {
  readonly zeiteintragId: string;
  readonly zuordnungId: string | null;
  readonly objekt: string | null;
  readonly mandantName: string;
  /**
   * Der Beginn als ISO-8601 mit Zonenangabe — der NULLPUNKT des Zaehlers.
   *
   * Er kommt aus `zeiteintrag.beginn_zeitpunkt`, also aus der Serveruhr
   * (Invariante 5). Die Oberflaeche zaehlt von hier aus hoch; das Ergebnis
   * ist ANZEIGE und nie die abgerechnete Dauer.
   */
  readonly beginnIso: string;
  /** `HH:MM` in Berliner Ortszeit — fuer den, der die Uhrzeit lesen will. */
  readonly beginnLokal: string;
  /**
   * Die Serverzeit im selben Augenblick.
   *
   * **Ohne sie luege der Zaehler auf jedem Telefon mit falscher Uhr.** Die
   * Oberflaeche bildet einmal die Differenz zur eigenen Uhr und rechnet
   * danach lokal weiter — der Nullpunkt bleibt damit der des Servers, auch
   * wenn das Geraet zehn Minuten vorgeht.
   */
  readonly serverIso: string;
}

interface OffenRoh {
  readonly zeiteintrag_id: string;
  readonly zuordnung_id: string | null;
  readonly objekt: string | null;
  readonly mandant_name: string;
  readonly beginn_iso: string;
  readonly beginn_lokal: string;
  readonly server_iso: string;
}

/**
 * Der eine offene Eintrag dieser Person — `z_offen_uk` laesst nur einen zu.
 *
 * Gelesen wird ueber die Policies des Arbeiterportals: die Person sieht ihre
 * eigenen Zeilen (K-04), und mehr braucht diese Frage nicht.
 */
export async function findeOffenenEintrag(
  kontext: LeseKontext,
): Promise<OffenerEintrag | null> {
  const [z] = await kontext.abfrage<OffenRoh>(
    `select z.id                                        as zeiteintrag_id,
            z.einsatz_zuordnung_id                      as zuordnung_id,
            o.bezeichnung                               as objekt,
            m.name                                      as mandant_name,
            to_char(z.beginn_zeitpunkt, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as beginn_iso,
            to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI') as beginn_lokal,
            to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as server_iso
       from zeiteintrag z
       join mandant m on m.id = z.mandant_id
       left join einsatz e on e.id = z.einsatz_id
       left join objekt  o on o.id = e.objekt_id
      where z.status = 'laufend'
        and z.storniert_am is null
        and z.ersetzt_am is null
      order by z.beginn_zeitpunkt desc
      limit 1`);
  if (z === undefined) return null;
  return {
    zeiteintragId: z.zeiteintrag_id,
    zuordnungId: z.zuordnung_id,
    objekt: z.objekt,
    mandantName: z.mandant_name,
    beginnIso: z.beginn_iso,
    beginnLokal: z.beginn_lokal,
    serverIso: z.server_iso,
  };
}

export class KeineEigeneSchichtFehler extends Error {
  constructor() {
    super('Zu dieser Einteilung gibt es keine eigene Schicht.');
    this.name = 'KeineEigeneSchichtFehler';
  }
}

/**
 * Die Gesellschaft einer eigenen Einteilung — SERVERSEITIG abgeleitet.
 *
 * **Nie aus der Anfrage** (K-02). Ein Mensch mit zwei Beschaeftigungen
 * stempelt bei EINER Gesellschaft (D-09); welche das ist, sagt die
 * Einteilung, und sie aus dem Formular zu nehmen waere genau die Stelle, an
 * der jemand eine fremde einsetzt.
 *
 * Gelesen wird im Personen-Scope: die Policies des Arbeiterportals geben nur
 * die eigenen Einteilungen frei, also antwortet eine fremde Kennung hier
 * schon mit „nicht gefunden" — vor jedem Schreibweg.
 */
export async function mandantDerZuordnung(
  kontext: LeseKontext, zuordnungId: string,
): Promise<string> {
  const [z] = await kontext.abfrage<{ mandant_id: string }>(
    `select mandant_id from einsatz_zuordnung where id = $1::uuid`, [zuordnungId]);
  if (z === undefined) throw new KeineEigeneSchichtFehler();
  return z.mandant_id;
}
