/**
 * Die Reklamation (OPS-11, CRM-06, REP-05, SPEC §22).
 *
 * Sie hat zwei Verweise, die sie von einer Notiz unterscheiden, und beide sind
 * Abnahmekriterium dieses PRs:
 *
 *  - **auf den Leistungsnachweis, den sie bestreitet.** „Der Kunde hat am
 *    30.06. unterschrieben und beschwert sich am 02.07. über denselben
 *    Zeitraum" ist ohne diesen Verweis ein Vorgang, den niemand verknüpft —
 *    und genau die Verknüpfung entscheidet, ob eine Rechnung berechtigt ist
 *    (FIN-18).
 *  - **auf den `einsatz`, der nacharbeitet.** Die Schicht, nicht die Person:
 *    wer nacharbeitet, kann wechseln; dass an diesem Tag auf diesem Objekt
 *    nachgearbeitet wurde, bleibt.
 *
 * **Keine Frist wird hier gerechnet.** `faellig_am` schreibt der SLA-Dienst,
 * und den gibt es noch nicht, weil die Frist je Priorität unbekannt ist.
 * // TODO(client, O-14): Welche Reaktions- und Behebungsfrist gilt je
 * Priorität — Vertrags-SLA je Auftrag oder je Gesellschaft?
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type ReklamationQuelle =
  'kunde' | 'eigenkontrolle' | 'qualitaetspruefung' | 'mitarbeiter';
export type ReklamationPrioritaet = 'niedrig' | 'mittel' | 'hoch';
export type ReklamationStatus =
  'offen' | 'in_arbeit' | 'behoben' | 'abgelehnt' | 'geschlossen';

export class ReklamationNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Reklamation ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'ReklamationNichtGefunden';
  }
}

export class MassnahmeFehlt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 422;
  constructor() {
    super('„Behoben" ohne Abstellmaßnahme ist nicht behoben, sondern vergessen.');
    this.name = 'MassnahmeFehlt';
  }
}

export class NachweisPasstNicht extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 422;
  constructor() {
    super(
      'Der angegebene Leistungsnachweis gehört zu einem anderen Objekt als die '
      + 'Reklamation. Eine Beanstandung bestreitet den Nachweis ihres eigenen Objekts.',
    );
    this.name = 'NachweisPasstNicht';
  }
}

/**
 * Ein Bezug, der in einem anderen Objekt haengt.
 *
 * Eigene Klasse statt `NachweisPasstNicht` fuer alles: die Meldung nennt die
 * SPALTE, und das ist der Unterschied zwischen „irgendetwas passt nicht" und
 * einem Hinweis, mit dem jemand die Eingabe korrigieren kann.
 */
/**
 * Ein mitgegebener Bezug, den es nicht gibt.
 *
 * Nicht `ReklamationNichtGefunden`: dessen Meldung sagt „Reklamation … gibt es
 * nicht", und das ist bei einem unbekannten Revier schlicht falsch. Wer eine
 * Eingabe korrigieren soll, braucht die Tabelle, die gemeint ist.
 *
 * 404 und nicht 403 — AUT-06: eine Zeile einer fremden Gesellschaft ist unter
 * der RLS unsichtbar, und unsichtbar heisst „gibt es nicht".
 */
export class BezugNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(readonly tabelle: string, id: string) {
    super(`Den Bezug \`${tabelle}\` (${id}) gibt es in dieser Gesellschaft nicht.`);
    this.name = 'BezugNichtGefunden';
  }
}

export class BezugPasstNicht extends Error {
  readonly code = 'ungueltiger_zustand';
  /**
   * 422 wie `NachweisPasstNicht` — es ist derselbe Fehler, nur in einer
   * anderen Spalte. Zwei Statuscodes fuer eine Fehlerklasse zwingen jeden
   * Aufrufer, beide zu kennen.
   */
  readonly status = 422;
  constructor(readonly spalte: string) {
    super(`Der Bezug \`${spalte}\` gehoert zu einem anderen Objekt.`);
    this.name = 'BezugPasstNicht';
  }
}

/**
 * Das Nummernformat der Beanstandung.
 *
 * KEIN Nummernkreis: `nummernkreis_typ` (0006) führt `reklamation` nicht, und
 * den geschlossenen Aufzählungstyp dafür zu erweitern hieße, eine
 * Lückenlosigkeit zu behaupten, die §8.2 nicht verlangt — verlangt ist
 * Eindeutigkeit, und die sichert `reklamation_nummer_uk`.
 *
 * Das Jahr kommt aus der DATENBANK, als Berliner Kalenderjahr: eine
 * Beschwerde, die am 31.12. um 23:30 Berliner Zeit eingeht, gehört in das
 * ablaufende Jahr, und `new Date().getFullYear()` im Node-Prozess läse auf
 * Vercel UTC (K-11, Invariante 2).
 */
export const REKLAMATION_NUMMER_PRAEFIX = 'RK' as const;

async function naechsteNummer(kontext: SchreibKontext): Promise<string> {
  const [z] = await kontext.schreibe<{ jahr: string; hoechste: string | null }>(
    `select to_char(now() at time zone 'Europe/Berlin', 'YYYY') as jahr,
            max(substring(nummer from '[0-9]+$')) as hoechste
       from reklamation
      where mandant_id = app.aktiver_mandant()
        and nummer like $1 || '-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY') || '-%'`,
    [REKLAMATION_NUMMER_PRAEFIX],
  );
  const laufend = Number(z?.hoechste ?? '0') + 1;
  return `${REKLAMATION_NUMMER_PRAEFIX}-${z!.jahr}-${String(laufend).padStart(4, '0')}`;
}

export interface ReklamationEingabe {
  readonly objektId: string;
  readonly kundeId?: string | null;
  readonly revierId?: string | null;
  readonly auftragLeistungId?: string | null;
  /** Der Nachweis, den die Beanstandung bestreitet (Abnahmekriterium 4). */
  readonly leistungsnachweisId?: string | null;
  readonly quelle: ReklamationQuelle;
  readonly prioritaet?: ReklamationPrioritaet;
  readonly beschreibung: string;
  readonly gemeldetVonName?: string | null;
  readonly wiederholungVonId?: string | null;
}

/**
 * Anlegen — mit der Prüfung, dass der bestrittene Nachweis zum selben Objekt
 * gehört.
 *
 * Ohne sie ließe sich eine Beschwerde über Gebäude A an den Nachweis von
 * Gebäude B hängen: beide Zeilen für sich stimmig, RLS zufrieden, und die
 * Rechnungsfreigabe blockierte den falschen Vorgang.
 */
export async function erstelleReklamation(
  kontext: SchreibKontext, eingabe: ReklamationEingabe,
): Promise<{ readonly id: string; readonly nummer: string }> {
  /**
   * **Jede mitgegebene Kennung gehoert zu DIESEM Objekt** — nicht nur der
   * Nachweis.
   *
   * Geprueft wurde bisher allein `leistungsnachweis_id`. Die uebrigen vier
   * standen nur unter der RLS, und die sagt „derselbe Mandant", nicht
   * „dasselbe Gebaeude". Eine Beschwerde ueber Haus A liess sich damit an das
   * Revier von Haus B haengen, an die Auftragszeile von Haus C und an den
   * Kunden von Haus D — jede Zeile fuer sich stimmig, jeder Fremdschluessel
   * erfuellt, und die Nacharbeit, die Qualitaetsauswertung und spaeter die
   * Rechnungsfreigabe arbeiteten am falschen Vorgang.
   *
   * Die Begruendung stand schon im Kopfkommentar dieser Funktion; sie galt nur
   * fuer eine der fuenf Spalten.
   */
/**
 * Wo der Bezug wirklich haengt — und warum `null` kein Verstoss ist.
 *
 * `auftrag_leistung.objekt_id` ist nullbar, und zwar mit Absicht (0050): „ein
 * Rahmenvertrag ueber mehrere Liegenschaften traegt seine Standorte hier und
 * nicht im Kopf". Eine Zeile ohne Standort gilt also fuer ALLE Standorte des
 * Auftrags. Wer sie strikt gegen ein Objekt prueft, weist den Rahmenvertrag
 * ab — das waere eine erfundene Regel, und zwar eine, die geltende Vertraege
 * unbrauchbar macht.
 *
 * Die Regel lautet deshalb: abgewiesen wird, was ein ANDERES Objekt nennt.
 * Was gar keines nennt, widerspricht nicht. Ist die Zeile selbst ohne
 * Standort, entscheidet der Kopf des Auftrags; ist auch der ohne, deckt die
 * Zeile mehrere Liegenschaften und bleibt zulaessig — die Mandantengrenze
 * haelt sie ohnehin.
 */
  const passtZumObjekt = async (
    tabelle: string, kennung: string, abfrage: string, fehler: () => Error,
  ): Promise<void> => {
    const [z] = await kontext.schreibe<{ objekt_id: string | null }>(abfrage, [kennung]);
    if (z === undefined) throw new BezugNichtGefunden(tabelle, kennung);
    if (z.objekt_id != null && z.objekt_id !== eingabe.objektId) throw fehler();
  };

  if (eingabe.leistungsnachweisId != null) {
    await passtZumObjekt(
      'leistungsnachweis', eingabe.leistungsnachweisId,
      `select objekt_id from leistungsnachweis where id = $1::uuid`,
      () => new NachweisPasstNicht(),
    );
  }
  if (eingabe.revierId != null) {
    await passtZumObjekt(
      'revier', eingabe.revierId,
      `select objekt_id from revier where id = $1::uuid`,
      () => new BezugPasstNicht('revier'),
    );
  }
  if (eingabe.auftragLeistungId != null) {
    await passtZumObjekt(
      'auftrag_leistung', eingabe.auftragLeistungId,
      `select coalesce(al.objekt_id, a.objekt_id) as objekt_id
         from auftrag_leistung al join auftrag a on a.id = al.auftrag_id
        where al.id = $1::uuid`,
      () => new BezugPasstNicht('auftrag_leistung'),
    );
  }
  if (eingabe.wiederholungVonId != null) {
    await passtZumObjekt(
      'reklamation', eingabe.wiederholungVonId,
      `select objekt_id from reklamation where id = $1::uuid`,
      () => new BezugPasstNicht('wiederholung_von'),
    );
  }
  if (eingabe.kundeId != null) {
    /*
     * Der Kunde haengt nicht am Objekt, sondern das Objekt am Kunden — also
     * wird andersherum gefragt. Ein Objekt ohne Kunden gibt es (noch nicht
     * zugeordnet); dann ist jede Angabe hier falsch, denn sie behauptete eine
     * Zuordnung, die es nicht gibt.
     */
    const [o] = await kontext.schreibe<{ kunde_id: string | null }>(
      `select kunde_id from objekt where id = $1::uuid`,
      [eingabe.objektId],
    );
    if (o === undefined) throw new BezugNichtGefunden('objekt', eingabe.objektId);
    if (o.kunde_id !== eingabe.kundeId) throw new BezugPasstNicht('kunde');
  }

  const nummer = await naechsteNummer(kontext);
  const [z] = await kontext.schreibe<{ id: string }>(
    `insert into reklamation
       (mandant_id, nummer, objekt_id, revier_id, auftrag_leistung_id, kunde_id,
        leistungsnachweis_id, quelle, prioritaet, beschreibung, gemeldet_von_name,
        wiederholung_von_id, erstellt_von)
     values (app.aktiver_mandant(), $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::uuid, $7::reklamation_quelle, $8::reklamation_prioritaet, $9, $10,
             $11::uuid, app.aktueller_benutzer())
     returning id`,
    [
      nummer, eingabe.objektId, eingabe.revierId ?? null,
      eingabe.auftragLeistungId ?? null, eingabe.kundeId ?? null,
      eingabe.leistungsnachweisId ?? null, eingabe.quelle,
      eingabe.prioritaet ?? 'mittel', eingabe.beschreibung.trim(),
      eingabe.gemeldetVonName ?? null, eingabe.wiederholungVonId ?? null,
    ],
  );
  return { id: z!.id, nummer };
}

export interface AbstellungEingabe {
  readonly id: string;
  readonly status: ReklamationStatus;
  readonly ursache?: string | null;
  readonly massnahme?: string | null;
  /** Die Schicht, die nacharbeitet (Abnahmekriterium 4). */
  readonly nacharbeitEinsatzId?: string | null;
  readonly verantwortlichBenutzerId?: string | null;
}

/**
 * Fortschreiben: Ursache, Maßnahme, Nacharbeitsschicht, Status.
 *
 * `behoben_am` und `geschlossen_am` stempelt der Auslöser mit Serverzeit — was
 * hier geschickt wird, ist nur das Signal „jetzt". Ein Zeitpunkt aus der
 * Anfrage entschiede, wann eine Frist gerissen wurde.
 */
export async function schreibeAbstellung(
  kontext: SchreibKontext, eingabe: AbstellungEingabe,
): Promise<void> {
  if (eingabe.status === 'behoben'
      && (eingabe.massnahme === null || eingabe.massnahme === undefined
          || eingabe.massnahme.trim() === '')) {
    throw new MassnahmeFehlt();
  }

  const geaendert = await kontext.schreibe<{ id: string }>(
    `update reklamation
        set status = $2::reklamation_status,
            ursache = coalesce($3, ursache),
            massnahme = coalesce($4, massnahme),
            nacharbeit_einsatz_id = coalesce($5::uuid, nacharbeit_einsatz_id),
            verantwortlich_benutzer_id = coalesce($6::uuid, verantwortlich_benutzer_id),
            behoben_am = case when $2 = 'behoben' then now() else behoben_am end,
            geschlossen_am = case when $2 = 'geschlossen' then now() else geschlossen_am end
      where id = $1::uuid
      returning id`,
    [
      eingabe.id, eingabe.status, eingabe.ursache ?? null, eingabe.massnahme ?? null,
      eingabe.nacharbeitEinsatzId ?? null, eingabe.verantwortlichBenutzerId ?? null,
    ],
  );
  if (geaendert.length === 0) throw new ReklamationNichtGefunden(eingabe.id);
}

export interface ReklamationZeile {
  readonly id: string;
  readonly nummer: string;
  readonly objekt: string | null;
  readonly kunde: string | null;
  readonly quelle: string;
  readonly prioritaet: string;
  readonly status: string;
  readonly eingangAmLokal: string;
  readonly faelligAmLokal: string | null;
  readonly beschreibung: string;
  readonly massnahme: string | null;
  readonly leistungsnachweisId: string | null;
  readonly leistungsnachweisNummer: string | null;
  readonly nacharbeitEinsatzId: string | null;
  readonly nacharbeitDatum: string | null;
}

interface ReklamationDbZeile {
  readonly id: string;
  readonly nummer: string;
  readonly objekt: string | null;
  readonly kunde: string | null;
  readonly quelle: string;
  readonly prioritaet: string;
  readonly status: string;
  readonly eingang_lokal: string;
  readonly faellig_lokal: string | null;
  readonly beschreibung: string;
  readonly massnahme: string | null;
  readonly leistungsnachweis_id: string | null;
  readonly ln_nummer: string | null;
  readonly nacharbeit_einsatz_id: string | null;
  readonly nacharbeit_datum: string | null;
}

const REKLAMATION_SPALTEN = `
  r.id, r.nummer, o.bezeichnung as objekt, k.name as kunde,
  r.quelle::text as quelle, r.prioritaet::text as prioritaet, r.status::text as status,
  to_char(r.eingang_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as eingang_lokal,
  to_char(r.faellig_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as faellig_lokal,
  r.beschreibung, r.massnahme,
  r.leistungsnachweis_id, l.nummer as ln_nummer,
  r.nacharbeit_einsatz_id,
  to_char(e.plan_datum, 'DD.MM.YYYY') as nacharbeit_datum
  from reklamation r
  left join objekt o on o.id = r.objekt_id and o.mandant_id = r.mandant_id
  left join kunde k on k.id = r.kunde_id and k.mandant_id = r.mandant_id
  left join leistungsnachweis l on l.id = r.leistungsnachweis_id
                               and l.mandant_id = r.mandant_id
  left join einsatz e on e.id = r.nacharbeit_einsatz_id and e.mandant_id = r.mandant_id`;

function alsZeile(z: ReklamationDbZeile): ReklamationZeile {
  return {
    id: z.id,
    nummer: z.nummer,
    objekt: z.objekt,
    kunde: z.kunde,
    quelle: z.quelle,
    prioritaet: z.prioritaet,
    status: z.status,
    eingangAmLokal: z.eingang_lokal,
    faelligAmLokal: z.faellig_lokal,
    beschreibung: z.beschreibung,
    massnahme: z.massnahme,
    leistungsnachweisId: z.leistungsnachweis_id,
    leistungsnachweisNummer: z.ln_nummer,
    nacharbeitEinsatzId: z.nacharbeit_einsatz_id,
    nacharbeitDatum: z.nacharbeit_datum,
  };
}

export async function listeReklamationen(
  kontext: LeseKontext, filter: { readonly status?: string | null } = {},
): Promise<readonly ReklamationZeile[]> {
  const zeilen = await kontext.abfrage<ReklamationDbZeile>(
    `select ${REKLAMATION_SPALTEN}
      where r.archiviert_am is null
        and ($1::text is null or r.status::text = $1)
      order by r.eingang_am desc
      limit 200`,
    [filter.status ?? null],
  );
  return zeilen.map(alsZeile);
}

export async function findeReklamation(
  kontext: LeseKontext, id: string,
): Promise<ReklamationZeile | null> {
  const [z] = await kontext.abfrage<ReklamationDbZeile>(
    `select ${REKLAMATION_SPALTEN} where r.id = $1::uuid`, [id],
  );
  return z === undefined ? null : alsZeile(z);
}
