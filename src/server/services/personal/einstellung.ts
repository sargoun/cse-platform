import 'server-only';
import { randomUUID } from 'node:crypto';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { istGueltigerKalendertag } from '../../../lib/datum/kalendertag.js';
import { istPersonalnummerKollision, PersonalnummerVergeben } from './personalnummer.js';

/* EINE Klasse für dieselbe Kollision, hier nur durchgereicht (D-771 Nachtrag). */
export { PersonalnummerVergeben };

/**
 * Einstellen — **erst der Mensch, dann die Beschaeftigung** (D-09, EMP-14,
 * 01-KERN §6.13/§6.14, 04-SEITENKARTE §5.12, Invariante 9).
 *
 * **Warum das zwei Schritte sind und nicht ein Formular.** Eine Maske, die
 * Vorname, Nachname und Personalnummer nebeneinander aufnimmt, legt bei jeder
 * Einstellung eine neue `person`-Zeile an — auch fuer den Menschen, der seit
 * drei Jahren bei der Schwestergesellschaft arbeitet. Das erzeugt genau die
 * Dubletten, gegen die `app.person_zusammenfuehren` (0194) gebaut ist, und
 * die Rechnung kommt spaeter: die ArbZG-Belastung aggregiert nach
 * Invariante 9 je MENSCH ueber alle Gesellschaften, und bei zwei Zeilen
 * aggregiert sie zweimal die Haelfte. Die Grenze, wegen der die Aggregation
 * existiert, wird dann nie erreicht.
 *
 * Deshalb: **suchen ist Pflicht, anlegen ist der Ausnahmefall.**
 * `sucheKandidaten` (dublette.ts) findet, wer in DIESER Gesellschaft schon
 * gefuehrt wird — dieselbe Suche wie auf der Zusammenfuehrungsseite, damit
 * zwei Bildschirme nicht zwei Antworten auf dieselbe Frage geben.
 * `dublettenProbe` fragt zusaetzlich ueber die Gesellschaftsgrenze, und sie
 * bekommt eine ZAHL zurueck und keinen Namen (0365, O-860).
 *
 * TODO(client, O-137): Voreinstellung — zwei gleichzeitige Beschaeftigungen
 * desselben Menschen bei derselben Gesellschaft (Hauptvertrag plus Minijob)
 * sind zulaessig: `anstellung` kennt keine Eindeutigkeit ueber (mandant,
 * person), die ArbZG-Last zaehlt je Mensch (Invariante 9). D-788.
 * TODO(client, O-141): Voreinstellung — der Anker bleibt: `app.person_sichtbar`
 * sieht einen Menschen, solange eine nicht geloeschte Beschaeftigung in der
 * Gesellschaft steht, auch eine beendete (Personalakte); die Sicht faellt erst
 * mit dem Loeschen der Beschaeftigung. D-788.
 * TODO(client, O-615): Voreinstellung — eine Wiedereinstellung stellt einen von
 * Hand entzogenen Portalzugang NICHT wieder her (`kern.bm_aus_anstellung`,
 * 0191); die Wiedererteilung bleibt eine Handlung der Leitung. D-788.
 * TODO(client, O-87): Voreinstellung — mit `status = beendet` endet der
 * Portalzugang sofort (K-14, 0191); die Stundennachweise uebergibt die
 * Verwaltung (Lohnexport, Monatsblatt), ein Nachlaufzugang fehlt (V-329). D-790.
 *
 * **Was dieser Dienst NICHT tut.** Er setzt keinen Stundensatz und keine
 * Wochenstunden: beides ist der Spiegel der datierten `anstellung_kondition`
 * mit genau einem Schreiber (§6.14, 0192) und laeuft ueber `…/entgelt` mit
 * `personal.entgelt_schreiben`. Er legt keinen Portalzugang an — der haengt
 * an `personen/[id]/zugang` mit eigenem Recht (EMP-01). Und er vergibt keine
 * Personalnummer: welche Systematik eine Gesellschaft fuehrt, steht in keinem
 * Dokument, und eine erfundene waere in der ersten Lohnabrechnung im Weg
 * (K-17).
 */

/** EMP-12 nennt genau diese vier (0002, `person.sprache`). */
export const SPRACHEN = ['de', 'en', 'ar', 'tr'] as const;
export type Sprache = (typeof SPRACHEN)[number];

/*
 * **Jeder Kalendertag dieser Datei wird mit `istGueltigerKalendertag`
 * geprüft** — einen Tag, den es gibt, nicht nur die Form `JJJJ-MM-TT`. Das
 * Muster allein liess den 31. Februar durch, und die Datenbank antwortete am
 * `::date` mit 22008: eine 500 statt eines Satzes (D-771 Nachtrag).
 */

/**
 * Warum `pruefeEingabe` oder `stelleEin` eine Einstellung abweisen — der
 * GRUND, der als `?fehler=` auf die Einstellungsseite zurückreist (D-771,
 * D-769, V-273).
 *
 * **Der Satz daneben bleibt, er reist nur nicht mehr.** Er ist deutsch, und
 * `person_zusammengefuehrt` trägt — wie `DubletteImHaus` unten — einen Namen
 * aus der Datenbank; eine Schnittstelle bekommt ihn weiter als `meldung`
 * (D-599), die Seite schlägt den Grund in ihrer Tabelle nach
 * (`lib/i18n/verwaltung/personal-rueckweg.ts`).
 */
export const EINSTELLUNG_GRUENDE = [
  'personalnummer_fehlt', 'personalnummer_zu_lang', 'eintritt_ungueltig', 'kein_mensch_gewaehlt',
  'name_fehlt', 'name_zu_lang', 'sprache_ungueltig', 'telefon_zu_lang', 'person_zusammengefuehrt',
] as const;
export type EinstellungGrund = (typeof EINSTELLUNG_GRUENDE)[number];

export class EinstellungFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(readonly grund: EinstellungGrund, nachricht: string) {
    super(nachricht);
    this.name = 'EinstellungFehler';
  }
}

export class DubletteImHaus extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  /** Der Grund für `?fehler=` (D-771) — der Satz unten nennt den Namen, die Seite keinen. */
  readonly grund = 'dublette_im_haus';
  constructor(name: string) {
    super(
      `„${name}" wird in dieser Gesellschaft bereits als Mensch geführt. Eine zweite `
      + 'Personenzeile für denselben Menschen ist keine zweite Beschäftigung, sondern '
      + 'eine Dublette (D-09) — sie zerlegt später die Arbeitszeitgrenzen, die je '
      + 'Mensch gelten (Invariante 9). Suchen Sie den Namen und wählen Sie die '
      + 'vorhandene Zeile; nur wenn es wirklich zwei Menschen sind, legen Sie eine '
      + 'zweite an — dann mit dem Vornamen, der sie unterscheidet.',
    );
    this.name = 'DubletteImHaus';
  }
}

export class PersonNichtSichtbar extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  /** Der Grund für `?fehler=` (D-771). */
  readonly grund = 'person_nicht_sichtbar';
  constructor() {
    super(
      'Dieser Mensch ist von dieser Gesellschaft aus nicht sichtbar. `person` trägt '
      + 'keinen Mandanten (D-09) — sichtbar ist ein Mensch hier, weil er hier '
      + 'beschäftigt ist.',
    );
    this.name = 'PersonNichtSichtbar';
  }
}

// ---------------------------------------------------------------------------
// Die Eingabe und ihre Pruefung — rein, ohne Datenbank
// ---------------------------------------------------------------------------

/** Der Mensch: eine vorhandene Zeile ODER eine neue. Nie beides. */
export type MenschEingabe =
  | { readonly art: 'bestehend'; readonly personId: string }
  | {
    readonly art: 'neu';
    readonly vorname: string;
    readonly nachname: string;
    readonly telefon: string | null;
    readonly sprache: string;
  };

export interface EinstellungEingabe {
  readonly mensch: MenschEingabe;
  readonly personalnummer: string;
  /** `JJJJ-MM-TT` — ein Kalendertag, kein Zeitpunkt (Invariante 2). */
  readonly eintritt: string;
}

export interface GeprueftEingabe {
  readonly mensch:
  | { readonly art: 'bestehend'; readonly personId: string }
  | {
    readonly art: 'neu'; readonly vorname: string; readonly nachname: string;
    readonly telefon: string | null; readonly sprache: Sprache;
  };
  readonly personalnummer: string;
  readonly eintritt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Prueft die Eingabe und gibt sie GETRIMMT zurueck — eine reine Funktion.
 *
 * Sie steht hier und nicht in der Seite, weil ein Formular nicht die einzige
 * Tuer ist: die Route nimmt auch JSON entgegen, und eine Pruefung im
 * Bildschirm ist keine Pruefung (AUT-04). Und sie ist rein, damit
 * `tests/kern/einstellung.test.ts` jeden Grenzfall ohne Datenbank halten
 * kann.
 */
export function pruefeEingabe(eingabe: EinstellungEingabe): GeprueftEingabe {
  const nummer = eingabe.personalnummer.trim();
  if (nummer === '') {
    throw new EinstellungFehler('personalnummer_fehlt',
      'Die Personalnummer ist Pflicht — sie ist der Schlüssel, unter dem diese '
      + 'Gesellschaft die Beschäftigung führt (eindeutig je Gesellschaft, D-09).');
  }
  if (nummer.length > 40) {
    throw new EinstellungFehler('personalnummer_zu_lang',
      'Die Personalnummer ist länger als 40 Zeichen.');
  }
  if (!istGueltigerKalendertag(eingabe.eintritt)) {
    throw new EinstellungFehler('eintritt_ungueltig',
      'Der Eintritt erwartet einen Kalendertag als JJJJ-MM-TT.');
  }

  if (eingabe.mensch.art === 'bestehend') {
    const id = eingabe.mensch.personId.trim();
    if (!UUID.test(id)) {
      throw new EinstellungFehler('kein_mensch_gewaehlt',
        'Es ist kein Mensch gewählt. Suchen Sie zuerst — eine Beschäftigung ohne '
        + 'Menschen gibt es nicht (D-09).');
    }
    return { mensch: { art: 'bestehend', personId: id }, personalnummer: nummer,
      eintritt: eingabe.eintritt };
  }

  const vorname = eingabe.mensch.vorname.trim();
  const nachname = eingabe.mensch.nachname.trim();
  if (vorname === '' || nachname === '') {
    throw new EinstellungFehler('name_fehlt', 'Vorname und Nachname sind Pflicht.');
  }
  if (vorname.length > 80 || nachname.length > 80) {
    throw new EinstellungFehler('name_zu_lang', 'Vorname und Nachname fassen je 80 Zeichen.');
  }
  const sprache = eingabe.mensch.sprache.trim();
  if (!(SPRACHEN as readonly string[]).includes(sprache)) {
    throw new EinstellungFehler('sprache_ungueltig',
      `Die Sprache muss eine der vier aus EMP-12 sein: ${SPRACHEN.join(', ')}.`);
  }
  const telefon = (eingabe.mensch.telefon ?? '').trim();
  if (telefon.length > 40) {
    throw new EinstellungFehler('telefon_zu_lang', 'Die Telefonnummer fasst 40 Zeichen.');
  }
  return {
    mensch: {
      art: 'neu', vorname, nachname,
      telefon: telefon === '' ? null : telefon,
      sprache: sprache as Sprache,
    },
    personalnummer: nummer,
    eintritt: eingabe.eintritt,
  };
}

/**
 * Der Status, mit dem eine Beschaeftigung ENTSTEHT — aus dem Kalender, nicht
 * aus einem Auswahlfeld.
 *
 * Wer am Ersten des naechsten Monats anfaengt, ist heute nicht beschaeftigt;
 * wer heute anfaengt, ist es. Ein Auswahlfeld daneben waere die Einladung,
 * eine Beschaeftigung `aktiv` zu setzen, die es noch nicht ist — und jede
 * Auswertung „wer arbeitet hier" zaehlte sie mit. `geplant` bleibt nicht
 * liegen: `app.anstellung_status_nachziehen` (0368) setzt es `aktiv`, sobald
 * der erste Arbeitstag da ist.
 */
export function statusFuerEintritt(eintritt: string, heute: string): 'geplant' | 'aktiv' {
  return eintritt <= heute ? 'aktiv' : 'geplant';
}

// ---------------------------------------------------------------------------
// Die Dublettenprobe ueber die Gesellschaftsgrenze (0365, O-860)
// ---------------------------------------------------------------------------

export interface DublettenBefund {
  /** Gleichnamige Menschen, die in DIESER Gesellschaft beschaeftigt sind. */
  readonly hier: number;
  /**
   * Gleichnamige Menschen ausserhalb — **als Zahl und sonst nichts**.
   *
   * Kein Name, keine Kennung, keine Gesellschaft: ob die Einstellungsmaske
   * mehr sehen darf, ist offen (O-860). Die Zahl allein genuegt fuer die
   * einzige Handlung, die heute daraus folgt — nachfragen, statt anzulegen.
   */
  readonly fremd: number;
}

export async function dublettenProbe(
  kontext: LeseKontext, vorname: string, nachname: string,
): Promise<DublettenBefund> {
  if (nachname.trim() === '') return { hier: 0, fremd: 0 };
  const [z] = await kontext.abfrage<{ hier: number; fremd: number }>(
    `select hier, fremd from app.person_dublettenpruefung($1, $2)`,
    [vorname, nachname]);
  return { hier: Number(z?.hier ?? 0), fremd: Number(z?.fremd ?? 0) };
}

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

export interface EinstellungErgebnis {
  readonly anstellungId: string;
  readonly personId: string;
  /** Wurde der Mensch neu angelegt, oder war er schon da? */
  readonly personNeu: boolean;
  readonly status: 'geplant' | 'aktiv';
}

/**
 * Legt die Beschaeftigung an — und, wo noetig, den Menschen davor.
 *
 * **Die Reihenfolge ist die Zusage.** Erst wird gesucht (oder eine vorhandene
 * Zeile gewaehlt), dann entsteht die `anstellung`. Beides in EINER
 * Transaktion: eine `person` ohne Beschaeftigung ist von dieser Gesellschaft
 * aus unsichtbar (`t_person_lesen`) und damit eine Zeile, die niemand mehr
 * findet und niemand mehr aufraeumt.
 *
 * **Die Kennung wird hier erzeugt, nicht zurueckgelesen.** `insert … returning
 * id` auf `person` scheitert: RETURNING laeuft durch die SELECT-Policy, und
 * die verlangt eine Beschaeftigung, die es eine Anweisung spaeter erst gibt.
 * Ein `randomUUID()` davor ist kein Trick, sondern die einzige Reihenfolge,
 * die ohne Aufweichen der Policy auskommt.
 */
export async function stelleEin(
  kontext: SchreibKontext, roh: EinstellungEingabe,
): Promise<EinstellungErgebnis> {
  const eingabe = pruefeEingabe(roh);

  /* Die Kollision wird als SATZ beantwortet, nicht als 23505. Der Constraint
     `anstellung_personalnummer_uk` bleibt die Wahrheit — diese Abfrage ist die
     Höflichkeit, und zwei gleichzeitige Anlagen laufen weiter in ihn; dort
     wird die zweite zu derselben Klasse (`istPersonalnummerKollision`, D-771). */
  const [kollision] = await kontext.abfrage<{ id: string }>(
    `select id from anstellung
      where mandant_id = $1::uuid and personalnummer = $2`,
    [kontext.aktiverMandantId, eingabe.personalnummer]);
  if (kollision !== undefined) throw new PersonalnummerVergeben(eingabe.personalnummer);

  const [tag] = await kontext.abfrage<{ heute: string }>(
    /* Der Kalendertag kommt aus der DATENBANK (Invariante 5, Invariante 2) —
       `new Date()` läse die Uhr des Node-Prozesses, und die steht in UTC. */
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
  const heute = tag?.heute ?? eingabe.eintritt;
  const status = statusFuerEintritt(eingabe.eintritt, heute);

  let personId: string;
  let personNeu = false;

  if (eingabe.mensch.art === 'bestehend') {
    const [p] = await kontext.abfrage<{ id: string; name: string; merge: string | null }>(
      `select p.id, (p.vorname || ' ' || p.nachname) as name,
              p.zusammengefuehrt_in_person_id as merge
         from person p
        where p.id = $1::uuid and p.geloescht_am is null`,
      [eingabe.mensch.personId]);
    if (p === undefined) throw new PersonNichtSichtbar();
    if (p.merge !== null) {
      throw new EinstellungFehler('person_zusammengefuehrt',
        `„${p.name}" ist eine zusammengeführte Zeile und zeigt auf einen anderen `
        + 'Datensatz (§6.13). Stellen Sie den führenden Menschen ein — sonst hängt '
        + 'die Beschäftigung an einer Kennung, die kein Lesepfad mehr als den '
        + 'Menschen liest.');
    }
    personId = p.id;
  } else {
    /*
     * **Der Riegel gegen die Dublette im eigenen Haus.** Dieselbe
     * Vergleichsform wie `app.person_dublettenpruefung` (0365) — die Regel
     * steht EINMAL in der Datenbank und nicht ein zweites Mal hier, sonst
     * fänden Probe und Riegel verschiedene Namen.
     *
     * Was ausserhalb der Gesellschaft liegt, kann dieser Riegel NICHT
     * blockieren: die Zeile ist von hier aus unsichtbar, und ob diese
     * Gesellschaft über einen Menschen entscheiden darf, den sie nicht sieht,
     * ist offen (O-860). Die Maske zeigt deshalb die Zahl aus der Probe und
     * verlangt, dass ein Mensch sie zur Kenntnis nimmt.
     */
    const [doppelt] = await kontext.abfrage<{ id: string; name: string }>(
      `select p.id, (p.vorname || ' ' || p.nachname) as name
         from person p
        where p.geloescht_am is null
          and p.zusammengefuehrt_in_person_id is null
          and app.namensform(p.vorname)  = app.namensform($1)
          and app.namensform(p.nachname) = app.namensform($2)
          and exists (select 1 from anstellung a
                       where a.person_id = p.id and a.mandant_id = $3::uuid
                         and a.geloescht_am is null)
        limit 1`,
      [eingabe.mensch.vorname, eingabe.mensch.nachname, kontext.aktiverMandantId]);
    if (doppelt !== undefined) throw new DubletteImHaus(doppelt.name);

    personId = randomUUID();
    personNeu = true;
    await kontext.schreibe(
      `insert into person (id, vorname, nachname, telefon, sprache, erstellt_von)
       values ($1::uuid, $2, $3, $4, $5, $6::uuid)`,
      [personId, eingabe.mensch.vorname, eingabe.mensch.nachname,
        eingabe.mensch.telefon, eingabe.mensch.sprache, kontext.benutzerId]);
  }

  const anstellungId = randomUUID();
  try {
    await kontext.schreibe(
      /*
       * `arbeitszeitmodell` bleibt auf seinem Vorgabewert `unbekannt` (0002,
       * O-18) und `wochenstunden` leer: beide sind der Spiegel der datierten
       * Kondition und haben genau EINEN Schreiber (0192). Sie hier zu setzen
       * wäre eine zweite Schreibfläche über derselben Spalte.
       */
      `insert into anstellung
         (id, mandant_id, person_id, personalnummer, eintritt, status, erstellt_von)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5::date, $6, $7::uuid)`,
      [anstellungId, kontext.aktiverMandantId, personId, eingabe.personalnummer,
        eingabe.eintritt, status, kontext.benutzerId]);
  } catch (fehler) {
    /* Eine gleichzeitige Anlage mit derselben Nummer: der Constraint sah sie, die Vorabfrage nicht. */
    if (istPersonalnummerKollision(fehler)) throw new PersonalnummerVergeben(eingabe.personalnummer);
    throw fehler;
  }

  await kontext.schreibe(
    `select app.protokolliere('personal.eingestellt', 'anstellung', $1,
                              null, jsonb_build_object(
                                'person_id', $2::uuid,
                                'person_neu', $3::boolean,
                                'personalnummer', $4::text,
                                'eintritt', $5::date,
                                'status', $6::text))`,
    [anstellungId, personId, personNeu, eingabe.personalnummer, eingabe.eintritt, status]);

  return { anstellungId, personId, personNeu, status };
}
