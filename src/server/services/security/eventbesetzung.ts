/**
 * Die kurzfristige Eventbesetzung (SEC-08, SEC-04, TIM-05).
 *
 * **Der Punkt dieses Dienstes ist, was er NICHT tut.** Er schreibt keine
 * `einsatz_zuordnung`. Kurzfristig heisst „schnell", nicht „ohne Prüfung", und
 * eine zweite Einteilungsroutine „für Events" wäre genau der Umgehungsweg, den
 * SEC-04 und LEG-04 verbieten: §34a GewO knüpft an den EINSATZ eines Menschen
 * in einer Bewachungstätigkeit an, nicht an die Existenz eines `posten` in
 * dieser Datenbank (`03-GEWERKE.md` §9.1, review B5).
 *
 * Er tut deshalb genau zwei Dinge:
 *
 *  1. Er legt die SCHICHT der Veranstaltung an — eine `einsatz`-Zeile im
 *     Fenster der Veranstaltung, idempotent über `quell_schluessel`.
 *  2. Er reicht jede Zuweisung an `besetzeEinsatz` weiter — denselben Weg, den
 *     der Dienstplan geht, mit dem §34a-Tor (PR 31) und der
 *     Arbeitszeitprüfung (PR 32) davor.
 *
 * Was dabei herauskommt, ist eine Liste: was entstanden ist, und was an
 * welchem Tor hängengeblieben ist. Ein „alles oder nichts" wäre hier falsch —
 * dass eine von acht Wachen keinen gültigen Nachweis hat, darf die anderen
 * sieben nicht verhindern.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import {
  besetzeEinsatz, ArbzgWarnungOffen, BereitsEingeteilt,
} from '../dienstplan/einteilung.js';
import { QualifikationFehlt } from '../nachweis/tor.js';

export class VeranstaltungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Die Veranstaltung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'VeranstaltungNichtGefunden';
  }
}

/**
 * Der Ort ist Freitext, und daraus lässt sich keine Schicht bauen.
 *
 * `veranstaltung.objekt_id` ist nullbar (§6.5: ein Veranstaltungsort existiert
 * oft, bevor es eine Objektakte gibt), `einsatz.objekt_id` dagegen NOT NULL
 * (0028) — die Kundendecke, der Check-in und die Medien hängen daran. Ein
 * Objekt hier zu ERFINDEN wäre eine Stammdatenzeile, die niemand angelegt hat;
 * die Meldung sagt stattdessen, was zu tun ist.
 */
export class VeranstaltungOhneObjekt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 422;
  constructor() {
    super(
      'Für eine Veranstaltung ohne hinterlegtes Objekt lässt sich keine Schicht '
      + 'anlegen: eine Schicht hängt immer an einem Objekt. Bitte den '
      + 'Veranstaltungsort als Objekt anlegen und der Veranstaltung zuordnen.',
    );
    this.name = 'VeranstaltungOhneObjekt';
  }
}

interface VeranstaltungZeile {
  readonly id: string;
  readonly objekt_id: string | null;
  readonly kunde_id: string;
  readonly auftrag_leistung_id: string | null;
  readonly soll_besetzung: number;
  readonly archiviert: boolean;
}

async function ladeVeranstaltung(
  kontext: SchreibKontext, id: string,
): Promise<VeranstaltungZeile> {
  const [v] = await kontext.abfrage<VeranstaltungZeile>(
    `select id, objekt_id, kunde_id, auftrag_leistung_id, soll_besetzung,
            (archiviert_am is not null) as archiviert
       from veranstaltung where id = $1::uuid`,
    [id],
  );
  if (v === undefined) throw new VeranstaltungNichtGefunden(id);
  return v;
}

/**
 * Legt die Schicht der Veranstaltung an — oder gibt die vorhandene zurück.
 *
 * **EINE Schicht, nicht `soll_besetzung` Schichten.** Mehrere Wachen auf einer
 * Position sind mehrere `einsatz_zuordnung`-Zeilen auf EINER Schicht; genau
 * dafür hängt die Zuordnung am `einsatz` und nicht umgekehrt (0028 §5.4,
 * TIM-04). Acht Schichten für acht Wachen wären acht Spalten im Dienstplan für
 * einen Auftrag.
 *
 * **Idempotent über `quell_schluessel`.** Der Knopf „Schichten anlegen" wird
 * auf einem Telefon in einem Hausflur gedrückt, und ein zweiter Druck auf
 * einer langsamen Verbindung ist kein Sonderfall. `veranstaltung:<id>` ist
 * derselbe Schlüssel bei jedem Aufruf, und der partielle eindeutige Index
 * lässt den zweiten INSERT ins Leere laufen statt eine zweite Schicht anlegen.
 */
export async function erzeugeVeranstaltungsschicht(
  kontext: SchreibKontext, veranstaltungId: string,
): Promise<{ readonly einsatzId: string; readonly neu: boolean }> {
  const v = await ladeVeranstaltung(kontext, veranstaltungId);
  if (v.archiviert) {
    throw new VeranstaltungNichtGefunden(veranstaltungId);
  }
  if (v.objekt_id === null) throw new VeranstaltungOhneObjekt();

  /**
   * Ortszeit und Kalendertag werden HIER in der Datenbank abgeleitet, nicht in
   * Node: eine zweite Zonendatenbank ist eine zweite Wahrheit über dieselbe
   * Nacht (`04-PLANUNG-ZEIT.md` §7.2).
   *
   * `min_besetzung` bleibt auf dem Spaltenvorgabewert 1 und wird NICHT aus
   * `soll_besetzung` abgeleitet. Ob ein Veranstaltungsdienst seine Sollstärke
   * zugleich als Mindeststärke schuldet, sagt kein Dokument — und die
   * Antwort entscheidet, ob der Dringlichkeitswächter jede unvollständig
   * besetzte Veranstaltung meldet oder keine.
   * // TODO(client, O-210): Gilt bei einem Veranstaltungsdienst die
   * vereinbarte Stärke zugleich als Mindestbesetzung, oder gibt es eine
   * niedrigere Grenze, unter der der Dienst als nicht erbracht gilt (SEC-08)?
   */
  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into einsatz
       (mandant_id, quelle, veranstaltung_id, objekt_id, kunde_id, auftrag_leistung_id,
        quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
        beginn_lokal, ende_lokal, endet_am_folgetag, soll_besetzung,
        erstellt_von_art, erstellt_von)
     select $1::uuid, 'veranstaltung', v.id, v.objekt_id, v.kunde_id, v.auftrag_leistung_id,
            'veranstaltung:' || v.id::text,
            (v.beginn at time zone 'Europe/Berlin')::date,
            v.beginn, v.ende, 'Europe/Berlin',
            (v.beginn at time zone 'Europe/Berlin')::time,
            (v.ende   at time zone 'Europe/Berlin')::time,
            (v.ende at time zone 'Europe/Berlin')::date
              > (v.beginn at time zone 'Europe/Berlin')::date,
            v.soll_besetzung, 'mensch', $3::uuid
       from veranstaltung v
      where v.id = $2::uuid
     on conflict (mandant_id, quell_schluessel) where storniert_am is null
     do nothing
     returning id`,
    [kontext.aktiverMandantId, veranstaltungId, kontext.benutzerId],
  );
  if (neu !== undefined) return { einsatzId: neu.id, neu: true };

  // Kein `returning` heisst: die Zeile stand schon. Sie zu holen ist der
  // zweite Schritt und nicht derselbe — `on conflict do nothing` gibt sie
  // nicht zurück.
  const [vorhanden] = await kontext.abfrage<{ id: string }>(
    `select id from einsatz
      where mandant_id = $1::uuid and quell_schluessel = $2 and storniert_am is null`,
    [kontext.aktiverMandantId, `veranstaltung:${veranstaltungId}`],
  );
  if (vorhanden === undefined) {
    throw new VeranstaltungNichtGefunden(veranstaltungId);
  }
  return { einsatzId: vorhanden.id, neu: false };
}

/** Was aus einer einzelnen Zuweisung geworden ist. */
export interface Besetzungsergebnis {
  readonly anstellungId: string;
  readonly zuordnungId: string | null;
  /**
   * `qualifikation` ist die SPERRE (SEC-04) — sie lässt sich nicht übergehen.
   * `arbzg` ist die WARNUNG (LEG-03): sie verlangt eine ausdrückliche
   * Bestätigung, und die schreibt den Verstoß samt Konflikt mit.
   */
  readonly befund: 'besetzt' | 'qualifikation' | 'arbzg' | 'doppelt' | 'fehler';
  readonly meldung: string | null;
}

export interface EventBesetzungEingabe {
  readonly veranstaltungId: string;
  readonly anstellungIds: readonly string[];
  /** Hat der Planer die Arbeitszeitbefunde gesehen (PR 33 Abnahme 4)? */
  readonly bestaetigt?: boolean;
}

export interface EventBesetzung {
  readonly einsatzId: string;
  readonly schichtNeu: boolean;
  readonly erzeugt: number;
  readonly ergebnisse: readonly Besetzungsergebnis[];
}

/**
 * Besetzt eine Veranstaltung — über `besetzeEinsatz`, Zuweisung für Zuweisung.
 *
 * **Jede einzelne läuft durch beide Tore** (Abnahme 5). Der Aufruf steht hier
 * einmal, und es gibt in dieser Datei kein `insert into einsatz_zuordnung`;
 * `tests/kern/security-kein-umgehungsweg.test.ts` prüft genau das über die
 * gesamte Dienstschicht, damit die Zusage nicht an der Disziplin hängt.
 *
 * Die Fehler werden EINGESAMMELT und nicht geworfen: der Planer soll nach
 * einem Durchgang wissen, wer eingeteilt ist und wer warum nicht — statt beim
 * ersten fehlenden Nachweis abzubrechen und die Liste von vorn zu beginnen.
 */
export async function besetzeVeranstaltung(
  kontext: SchreibKontext, eingabe: EventBesetzungEingabe,
): Promise<EventBesetzung> {
  const schicht = await erzeugeVeranstaltungsschicht(kontext, eingabe.veranstaltungId);

  const ergebnisse: Besetzungsergebnis[] = [];
  for (const anstellungId of eingabe.anstellungIds) {
    try {
      const befund = await besetzeEinsatz(kontext, {
        einsatzId: schicht.einsatzId,
        anstellungId,
        ...(eingabe.bestaetigt === undefined ? {} : { bestaetigt: eingabe.bestaetigt }),
      });
      ergebnisse.push({
        anstellungId, zuordnungId: befund.zuordnungId, befund: 'besetzt', meldung: null,
      });
    } catch (fehler) {
      if (fehler instanceof QualifikationFehlt) {
        ergebnisse.push({
          anstellungId, zuordnungId: null, befund: 'qualifikation',
          meldung: fehler.message,
        });
      } else if (fehler instanceof ArbzgWarnungOffen) {
        ergebnisse.push({
          anstellungId, zuordnungId: null, befund: 'arbzg', meldung: fehler.message,
        });
      } else if (fehler instanceof BereitsEingeteilt) {
        ergebnisse.push({
          anstellungId, zuordnungId: null, befund: 'doppelt', meldung: fehler.message,
        });
      } else {
        /**
         * Alles andere ist KEIN Befund über diese Person, sondern ein Fehler
         * des Vorgangs — ein fehlendes Recht, eine abgewiesene Prüfung. Er
         * fliegt weiter, damit die Route ihn als das beantwortet, was er ist,
         * statt ihn als „nicht qualifiziert" in eine Liste zu schreiben.
         */
        throw fehler;
      }
    }
  }

  return {
    einsatzId: schicht.einsatzId,
    schichtNeu: schicht.neu,
    erzeugt: ergebnisse.filter((e) => e.befund === 'besetzt').length,
    ergebnisse,
  };
}

/** Eine Veranstaltung, wie das Brett sie zeigt. */
export interface VeranstaltungZeileAnzeige {
  readonly id: string;
  readonly bezeichnung: string;
  readonly anlass: string | null;
  readonly kunde: string;
  readonly ort: string;
  readonly hatObjekt: boolean;
  readonly beginnLokal: string;
  readonly endeLokal: string;
  readonly sollBesetzung: number;
  readonly besetzt: number;
  readonly einsatzId: string | null;
}

interface RohVeranstaltung {
  readonly id: string;
  readonly bezeichnung: string;
  readonly anlass: string | null;
  readonly kunde: string;
  readonly ort: string;
  readonly hat_objekt: boolean;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly soll_besetzung: number;
  readonly besetzt: number;
  readonly einsatz_id: string | null;
}

/** Die anstehenden Veranstaltungen mit ihrem Besetzungsstand. */
export async function kommendeVeranstaltungen(
  kontext: SchreibKontext, abTag: string,
): Promise<readonly VeranstaltungZeileAnzeige[]> {
  const zeilen = await kontext.abfrage<RohVeranstaltung>(
    `select v.id, v.bezeichnung, v.anlass, k.name as kunde,
            coalesce(o.bezeichnung, v.veranstaltungsort_text) as ort,
            (v.objekt_id is not null) as hat_objekt,
            to_char(v.beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as beginn_lokal,
            to_char(v.ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as ende_lokal,
            v.soll_besetzung,
            coalesce(e.besetzt_anzahl, 0) as besetzt,
            e.id as einsatz_id
       from veranstaltung v
       join kunde k on k.id = v.kunde_id and k.mandant_id = v.mandant_id
       left join objekt o on o.id = v.objekt_id and o.mandant_id = v.mandant_id
       left join einsatz e on e.veranstaltung_id = v.id and e.mandant_id = v.mandant_id
                          and e.storniert_am is null
      where v.archiviert_am is null
        and v.ende >= ($1::date) at time zone 'Europe/Berlin'
      order by v.beginn`,
    [abTag],
  );
  return zeilen.map((z) => ({
    id: z.id,
    bezeichnung: z.bezeichnung,
    anlass: z.anlass,
    kunde: z.kunde,
    ort: z.ort,
    hatObjekt: z.hat_objekt,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    sollBesetzung: Number(z.soll_besetzung),
    besetzt: Number(z.besetzt),
    einsatzId: z.einsatz_id,
  }));
}
