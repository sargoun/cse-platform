/**
 * Die Qualitätsprüfung und ihre Bewertung (OPS-11, SPEC §22).
 *
 * **Hier wird nichts bestanden.** SPEC nennt kein Prüfverfahren und keine
 * Bestehensschwelle; `pruefverfahren.bestehensschwelle_prozent` steht deshalb
 * auf NULL, `qualitaetspruefung.bestanden` bleibt NULL, und keine Oberfläche
 * zeigt eine Bestanden-Pille. Eine plausible Zahl — 90 %, 95 % — wäre eine
 * erfundene Geschäftsregel mit vertraglicher Wirkung (K-17).
 *
 * // TODO(client, O-29): Was löst eine Qualitätsprüfung aus, welche Skala
 * gilt, und was folgt auf eine nicht bestandene Prüfung?
 *
 * Was stattdessen steht, ist eine SCHNITTSTELLE: `QualitaetsBewertung` nimmt
 * Punkte, Skala und Schwelle und gibt `bestanden`, `nicht_bestanden` oder
 * `unbestimmt` zurück. Die heutige Umsetzung (`schwellenBewertung`) antwortet
 * `unbestimmt`, solange die Schwelle fehlt. Kommt die Antwort des Kunden, wird
 * eine Katalogzeile gepflegt — keine Migration, kein neuer Code.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';

export type Bewertung = 'bestanden' | 'nicht_bestanden' | 'unbestimmt';

export interface BewertungsEingabe {
  /** Erreichte Punkte als `numeric`-Text, oder `null`. */
  readonly punkte: string | null;
  readonly maxPunkte: string | null;
  /** Aus dem Katalog. NULL heißt UNBEANTWORTET, nicht „0 %". */
  readonly schwelleProzent: string | null;
}

/** Die austauschbare Stelle. Eine Schnittstelle, damit das Offene tauschbar ist. */
export interface QualitaetsBewertung {
  bewerte(eingabe: BewertungsEingabe): Bewertung;
}

/**
 * Ganzzahlig, in Hundertsteln — kein Gleitkomma.
 *
 * Der Erfüllungsgrad ist kein Geld, aber er entscheidet über eine
 * Vertragsstrafe. `84.995` als Double gegen `85` zu halten ist genau die Art
 * Vergleich, die je nach Rundung anders ausgeht.
 */
function hundertstel(text: string): bigint {
  const [ganz = '0', bruch = ''] = text.trim().split('.');
  const vorzeichen = ganz.startsWith('-') ? -1n : 1n;
  const ziffern = `${bruch}00`.slice(0, 2);
  return vorzeichen * (BigInt(ganz.replace('-', '')) * 100n + BigInt(ziffern));
}

export const schwellenBewertung: QualitaetsBewertung = {
  bewerte(eingabe) {
    if (eingabe.schwelleProzent === null) return 'unbestimmt';
    if (eingabe.punkte === null || eingabe.maxPunkte === null) return 'unbestimmt';
    const max = hundertstel(eingabe.maxPunkte);
    if (max <= 0n) return 'unbestimmt';
    /**
     * Erfüllungsgrad in Hundertstelprozent, damit die Schwelle in derselben
     * Einheit verglichen wird: `85` kommt als `8500` an, und `84,995 %` ergibt
     * `8499` — also NICHT bestanden. Genau dieser Fall geht mit Gleitkomma je
     * nach Rundung anders aus.
     */
    const grad = (hundertstel(eingabe.punkte) * 10_000n) / max;
    return grad >= hundertstel(eingabe.schwelleProzent) ? 'bestanden' : 'nicht_bestanden';
  },
};

export class PruefungNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Qualitätsprüfung ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'PruefungNichtGefunden';
  }
}

/**
 * Ein Befund zeigt auf einen Raum, der nicht zu dieser Prüfung gehört.
 *
 * **Der Befund, der diesen Fehler gebracht hat.** Der Fremdschlüssel auf den
 * Revierraum ist ZUSAMMENGESETZT — `(mandant_id, revier_id, revier_raum_id)`
 * gegen `revier_raum(mandant_id, revier_id, id)` — und er läuft als MATCH
 * SIMPLE. Bleibt `revier_id` NULL, wird er **gar nicht geprüft**: eine
 * `revier_raum_id` aus einem fremden Revier wird stillschweigend angenommen
 * und steht danach auf dem Prüfprotokoll. Genau das passierte, wenn eine
 * Prüfung ohne Revier erfasst wurde, ihre Befunde aber Revierräume nannten.
 */
export class RaumPasstNicht extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 422;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'RaumPasstNicht';
  }
}

export class PruefungEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PruefungEingabeFehlt';
  }
}

export interface PruefverfahrenZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly maxPunkte: string | null;
  readonly schwelleProzent: string | null;
  readonly istPlatzhalter: boolean;
}

interface PvDbZeile {
  readonly id: string;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly max_punkte: string | null;
  readonly bestehensschwelle_prozent: string | null;
  readonly ist_platzhalter: boolean;
}

export async function listePruefverfahren(
  kontext: LeseKontext,
): Promise<readonly PruefverfahrenZeile[]> {
  const zeilen = await kontext.abfrage<PvDbZeile>(
    `select id, schluessel, bezeichnung,
            max_punkte::text as max_punkte,
            bestehensschwelle_prozent::text as bestehensschwelle_prozent,
            ist_platzhalter
       from pruefverfahren
      where archiviert_am is null
      order by ist_platzhalter, bezeichnung`,
  );
  return zeilen.map((z) => ({
    id: z.id,
    schluessel: z.schluessel,
    bezeichnung: z.bezeichnung,
    maxPunkte: z.max_punkte,
    schwelleProzent: z.bestehensschwelle_prozent,
    istPlatzhalter: z.ist_platzhalter,
  }));
}

export const PRUEFUNG_NUMMER_PRAEFIX = 'QP' as const;

async function naechsteNummer(kontext: SchreibKontext): Promise<string> {
  const [z] = await kontext.schreibe<{ jahr: string; hoechste: string | null }>(
    `select to_char(now() at time zone 'Europe/Berlin', 'YYYY') as jahr,
            max(substring(nummer from '[0-9]+$')) as hoechste
       from qualitaetspruefung
      where mandant_id = app.aktiver_mandant()
        and nummer like $1 || '-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY') || '-%'`,
    [PRUEFUNG_NUMMER_PRAEFIX],
  );
  const laufend = Number(z?.hoechste ?? '0') + 1;
  return `${PRUEFUNG_NUMMER_PRAEFIX}-${z!.jahr}-${String(laufend).padStart(4, '0')}`;
}

export interface PruefungEingabe {
  readonly objektId: string;
  readonly revierId?: string | null;
  readonly kundeId?: string | null;
  readonly pruefverfahrenId: string;
  readonly prueferAnstellungId?: string | null;
  readonly prueferExternName?: string | null;
  readonly mitKunde?: boolean;
  readonly geraeteZeit?: Date | null;
  readonly bemerkung?: string | null;
  readonly positionen: readonly {
    readonly kriterium: string;
    readonly ergebnis: 'io' | 'nio' | 'nicht_pruefbar';
    readonly punkte?: string | null;
    readonly revierRaumId?: string | null;
    readonly raumId?: string | null;
    readonly mangelBeschreibung?: string | null;
    readonly fristAm?: string | null;
  }[];
}

/**
 * Prüfung samt Befunden anlegen — und die Bewertung durch den Dienst legen.
 *
 * Die Punktesumme rechnet TypeScript (Invariante 6), nicht die Datenbank:
 * `erfuellungsgrad_prozent` ist generiert, weil ein Verhältnis deterministisch
 * ist; die Summe selbst ist eine Rechnung und gehört in eine getestete
 * Funktion.
 */
export async function erfassePruefung(
  kontext: SchreibKontext,
  eingabe: PruefungEingabe,
  bewertung: QualitaetsBewertung = schwellenBewertung,
): Promise<{ readonly id: string; readonly nummer: string; readonly bewertung: Bewertung }> {
  const [verfahren] = await kontext.schreibe<{
    max_punkte: string | null; bestehensschwelle_prozent: string | null;
  }>(
    `select max_punkte::text as max_punkte,
            bestehensschwelle_prozent::text as bestehensschwelle_prozent
       from pruefverfahren where id = $1::uuid`,
    [eingabe.pruefverfahrenId],
  );
  if (verfahren === undefined) throw new PruefungNichtGefunden(eingabe.pruefverfahrenId);

  await pruefeAnker(kontext, eingabe);

  /**
   * **Ohne Skala keine Kopfsumme — und die Sperre ist DIESE Funktion.**
   *
   * `qp_punkte_brauchen_skala` lautet `CHECK (punkte IS NULL OR max_punkte IS
   * NOT NULL)` und prüft die EIGENE Spalte `qualitaetspruefung.max_punkte`;
   * `pruefverfahren.max_punkte` kommt darin nicht vor. Wer `max_punkte`
   * mitschickt, darf also jede Punktzahl schreiben. Das als „die Datenbank
   * weist es zurück" zu beschreiben, lädt dazu ein, diesen Dienst zu umgehen
   * — genau das, was Invariante 6 verhindern soll. Die Zusage steht hier: die
   * Skala wird aus dem VERFAHREN kopiert, und ohne Skala bleibt die Summe
   * NULL.
   *
   * Eine 6 ohne die Angabe „von wie vielen" ist keine Bewertung, sondern eine
   * Zahl. Solange das Platzhalterverfahren keine Skala trägt (O-29), bleibt
   * der Kopf leer — die EINZELNEN Befunde behalten ihre Punkte, damit nichts
   * verloren geht, sobald der Kunde die Skala nennt.
   */
  const punkte = eingabe.positionen
    .map((p) => p.punkte)
    .filter((p): p is string => p !== null && p !== undefined);
  const summe = punkte.length === 0 || verfahren.max_punkte === null
    ? null
    : summiereText(punkte);

  const urteil = bewertung.bewerte({
    punkte: summe,
    maxPunkte: verfahren.max_punkte,
    schwelleProzent: verfahren.bestehensschwelle_prozent,
  });

  const nummer = await naechsteNummer(kontext);
  const [kopf] = await kontext.schreibe<{ id: string }>(
    `insert into qualitaetspruefung
       (mandant_id, nummer, objekt_id, revier_id, kunde_id, pruefverfahren_id,
        geraete_zeit, pruefer_anstellung_id, pruefer_extern_name, mit_kunde,
        punkte, max_punkte, bestanden, bemerkung, erstellt_von)
     values (app.aktiver_mandant(), $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
             $6::timestamptz, $7::uuid, $8, $9,
             $10::numeric, $11::numeric, $12::boolean, $13, app.aktueller_benutzer())
     returning id`,
    [
      nummer, eingabe.objektId, eingabe.revierId ?? null, eingabe.kundeId ?? null,
      eingabe.pruefverfahrenId, eingabe.geraeteZeit?.toISOString() ?? null,
      eingabe.prueferAnstellungId ?? null, eingabe.prueferExternName ?? null,
      eingabe.mitKunde ?? false,
      summe, verfahren.max_punkte,
      // NULL, solange O-29 offen ist — nicht `false`.
      urteil === 'unbestimmt' ? null : urteil === 'bestanden',
      eingabe.bemerkung ?? null,
    ],
  );

  for (const [index, p] of eingabe.positionen.entries()) {
    await kontext.schreibe(
      /*
       * `revier_id` wird MITGESCHRIEBEN, obwohl der Ausloeser
       * `qpp_kopf_denormalisieren` es gleich darauf aus dem Kopf setzt. Das
       * ist kein Zierat: die Spalte steht hier, weil der zusammengesetzte
       * Fremdschluessel (mandant_id, revier_id, revier_raum_id) ohne sie
       * ungeprueft bleibt (MATCH SIMPLE), und weil ein Leser dieser Anweisung
       * sonst annimmt, der Revierraum stehe fuer sich. Geprueft wird die
       * Zugehoerigkeit ohnehin vorher in `pruefeAnker` — mit einem Satz statt
       * einer Fremdschluesselverletzung.
       */
      `insert into qualitaetspruefung_position
         (mandant_id, qualitaetspruefung_id, revier_id, raum_id, revier_raum_id,
          reihenfolge, kriterium, ergebnis, punkte, mangel_beschreibung, frist_am,
          erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5, $6, $7::pruefergebnis, $8::numeric, $9, $10::date,
               app.aktueller_benutzer())`,
      [
        kopf!.id, eingabe.revierId ?? null, p.raumId ?? null, p.revierRaumId ?? null,
        index, p.kriterium, p.ergebnis, p.punkte ?? null,
        p.mangelBeschreibung ?? null, p.fristAm ?? null,
      ],
    );
  }

  return { id: kopf!.id, nummer, bewertung: urteil };
}

/**
 * Passen die Befunde zum Bezug der Prüfung?
 *
 * Drei Zusagen, jede mit einem Satz statt einer Fremdschlüsselverletzung:
 *
 *  1. **Ein Revierraum verlangt ein Revier am Kopf.** Ohne `revier_id` ist der
 *     zusammengesetzte Fremdschlüssel MATCH SIMPLE und wird nicht geprüft —
 *     eine `revier_raum_id` aus einem fremden Revier stünde danach auf dem
 *     Prüfprotokoll.
 *  2. **Der Revierraum gehört zu DIESEM Revier.** Auch mit gesetztem
 *     `revier_id` wäre die Fremdschlüsselverletzung die schlechtere Meldung:
 *     sie nennt einen Zwangsnamen, keinen Grund.
 *  3. **Der Raum gehört zu DIESEM Objekt.** `qpp_raum_fk` prüft nur
 *     `(mandant_id, raum_id)` — ein Raum aus einem anderen Objekt derselben
 *     Gesellschaft geht durch, und der Befund stünde am falschen Haus.
 *  4. **Das Revier gehört zu DIESEM Objekt.** Derselbe Defekt eine Ebene
 *     höher: `qp_revier_fk` lautet
 *     `FOREIGN KEY (mandant_id, revier_id) REFERENCES revier(mandant_id, id)`
 *     und kennt das Objekt nicht. Ohne diese Prüfung wird ein Protokoll mit
 *     Objekt A und Revier B still gespeichert und danach als „Objekt A /
 *     Revier B" angezeigt — eine Zeile, die es so nie gab.
 *
 * Eine Abfrage für alle Befunde, nicht eine je Zeile: eine Prüfung mit dreissig
 * Positionen sind sonst einunddreissig Abfragen.
 */
async function pruefeAnker(
  kontext: SchreibKontext, eingabe: PruefungEingabe,
): Promise<void> {
  const revierRaeume = [...new Set(eingabe.positionen
    .map((p) => p.revierRaumId)
    .filter((x): x is string => x !== null && x !== undefined))];
  const raeume = [...new Set(eingabe.positionen
    .map((p) => p.raumId)
    .filter((x): x is string => x !== null && x !== undefined))];

  if (revierRaeume.length > 0
    && (eingabe.revierId === null || eingabe.revierId === undefined)) {
    throw new RaumPasstNicht(
      'Ein Befund nennt einen Revierraum, die Prüfung aber kein Revier. Ohne Revier '
      + 'am Kopf prüft die Datenbank die Zugehörigkeit des Raums nicht (MATCH SIMPLE) '
      + '— der Befund könnte aus einem fremden Revier stammen und stünde trotzdem auf '
      + 'dem Protokoll.');
  }

  if (eingabe.revierId !== null && eingabe.revierId !== undefined) {
    const [befund] = await kontext.abfrage<{ treffer: string }>(
      `select count(*)::text as treffer
         from revier r
        where r.id = $1::uuid and r.objekt_id = $2::uuid`,
      [eingabe.revierId, eingabe.objektId],
    );
    if (Number(befund?.treffer ?? '0') !== 1) {
      throw new RaumPasstNicht(
        'Das gewählte Revier gehört nicht zu dem Objekt dieser Prüfung. '
        + '`qp_revier_fk` prüft nur die Gesellschaft, nicht das Haus — das '
        + 'Protokoll stünde sonst unter einem Objekt, in dem dieses Revier '
        + 'gar nicht liegt.');
    }
  }

  if (revierRaeume.length > 0 && eingabe.revierId !== null
    && eingabe.revierId !== undefined) {
    const [befund] = await kontext.abfrage<{ treffer: string }>(
      `select count(*)::text as treffer
         from revier_raum rr
        where rr.revier_id = $1::uuid and rr.id = any($2::uuid[])`,
      [eingabe.revierId, revierRaeume],
    );
    if (Number(befund?.treffer ?? '0') !== revierRaeume.length) {
      throw new RaumPasstNicht(
        'Mindestens ein Befund nennt einen Revierraum, der nicht zu dem Revier '
        + 'dieser Prüfung gehört.');
    }
  }

  if (raeume.length > 0) {
    const [befund] = await kontext.abfrage<{ treffer: string }>(
      `select count(*)::text as treffer
         from raum r
        where r.objekt_id = $1::uuid and r.id = any($2::uuid[])`,
      [eingabe.objektId, raeume],
    );
    if (Number(befund?.treffer ?? '0') !== raeume.length) {
      throw new RaumPasstNicht(
        'Mindestens ein Befund nennt einen Raum, der nicht zu dem Objekt dieser '
        + 'Prüfung gehört. `qpp_raum_fk` prüft nur die Gesellschaft, nicht das Haus.');
    }
  }
}

/* ===========================================================================
 * Der LESEPFAD auf `qualitaetspruefung` — vorher gab es keinen
 * ======================================================================== */

export const PRUEFERGEBNISSE = ['io', 'nio', 'nicht_pruefbar'] as const;
export type Pruefergebnis = (typeof PRUEFERGEBNISSE)[number];

export const ERGEBNIS_TEXT: Readonly<Record<Pruefergebnis, string>> = {
  io: 'in Ordnung',
  nio: 'nicht in Ordnung',
  nicht_pruefbar: 'nicht prüfbar',
};

export interface PruefungZeile {
  readonly id: string;
  readonly nummer: string;
  /** Berliner Ortszeit, fertig aus der Datenbank (Invariante 2). */
  readonly gepruefLokal: string;
  readonly geprueftAmTag: string;
  readonly objektId: string | null;
  /** `null` heisst: kein Objekt ODER `objekt.lesen` fehlt. */
  readonly objekt: string | null;
  readonly revierId: string | null;
  readonly revier: string | null;
  readonly projektId: string | null;
  readonly kundeId: string | null;
  /** `null` heisst: `crm.lesen` fehlt. */
  readonly kunde: string | null;
  readonly verfahren: string;
  readonly verfahrenIstPlatzhalter: boolean;
  /** `null` heisst: das Verfahren trägt keine Skala (O-29). */
  readonly verfahrenMaxPunkte: string | null;
  readonly prueferAnstellungId: string | null;
  readonly prueferName: string | null;
  readonly prueferExternName: string | null;
  readonly mitKunde: boolean;
  readonly nachgetragen: boolean;
  /**
   * Was das GERÄT behauptet — getrennt von der Serverzeit (Invariante 5).
   *
   * `null` heisst: keine Gerätezeit mitgeschickt. Die beiden in ein Feld zu
   * falten wäre genau der Griff, den Invariante 5 verbietet.
   */
  readonly geraeteZeitLokal: string | null;
  /** Gerätezeit minus Serverzeit in Sekunden; `null` ohne Gerätezeit. */
  readonly zeitabweichungSek: number | null;
  readonly bemerkung: string | null;
  readonly dokumentId: string | null;
  /** `numeric`-Text oder `null` — nie ein `number` (K-16). */
  readonly punkte: string | null;
  readonly maxPunkte: string | null;
  readonly erfuellungsgradProzent: string | null;
  /** Bleibt NULL, solange O-29 offen ist — NICHT `false`. */
  readonly bestanden: boolean | null;
  readonly befunde: number;
  readonly befundeNio: number;
  readonly fristenUeberfaellig: number;
  readonly archiviert: boolean;
}

interface PruefungRoh {
  id: string;
  nummer: string;
  geprueft_lokal: string;
  geprueft_tag: string;
  objekt_id: string | null;
  objekt: string | null;
  revier_id: string | null;
  revier: string | null;
  projekt_id: string | null;
  kunde_id: string | null;
  kunde: string | null;
  verfahren: string;
  verfahren_platzhalter: boolean;
  verfahren_max_punkte: string | null;
  pruefer_anstellung_id: string | null;
  pruefer_name: string | null;
  pruefer_extern_name: string | null;
  mit_kunde: boolean;
  nachgetragen: boolean;
  geraete_zeit_lokal: string | null;
  zeitabweichung_sek: number | null;
  bemerkung: string | null;
  dokument_id: string | null;
  punkte: string | null;
  max_punkte: string | null;
  erfuellungsgrad: string | null;
  bestanden: boolean | null;
  befunde: string;
  befunde_nio: string;
  fristen_ueberfaellig: string;
  archiviert: boolean;
}

/**
 * Der Kopf-Join.
 *
 * `objekt` (`objekt.lesen`), `kunde` (`crm.lesen`) und `revier`
 * (`reinigung.lesen`) liegen hinter anderen Rechten als
 * `qualitaetspruefung` (`qualitaet.lesen`) — Qualität ist ein
 * Querschnittsmodul und nicht an ein Gewerk gebunden. Deshalb LEFT JOIN: ein
 * Innenverbund liesse die Prüfungen VERSCHWINDEN, weil ein Name fehlt.
 *
 * `pruefverfahren` liegt hinter `qualitaet.lesen`, also demselben Recht — der
 * Verbund darf innen sein, und `pruefverfahren_id` ist ohnehin NOT NULL.
 */
const PRUEFUNG_QUELLE = `
  from qualitaetspruefung q
  join pruefverfahren pv on pv.mandant_id = q.mandant_id and pv.id = q.pruefverfahren_id
  left join objekt o on o.mandant_id = q.mandant_id and o.id = q.objekt_id
  left join revier r on r.mandant_id = q.mandant_id and r.id = q.revier_id
  left join kunde  k on k.mandant_id = q.mandant_id and k.id = q.kunde_id
  left join anstellung pa on pa.mandant_id = q.mandant_id and pa.id = q.pruefer_anstellung_id
  left join person pp on pp.id = pa.person_id`;

const PRUEFUNG_SPALTEN = `
  q.id, q.nummer,
  to_char(q.geprueft_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as geprueft_lokal,
  to_char(q.geprueft_am at time zone 'Europe/Berlin', 'YYYY-MM-DD')         as geprueft_tag,
  q.objekt_id, o.bezeichnung as objekt,
  q.revier_id, r.bezeichnung as revier,
  q.projekt_id,
  q.kunde_id, k.name as kunde,
  pv.bezeichnung            as verfahren,
  pv.ist_platzhalter        as verfahren_platzhalter,
  pv.max_punkte::text       as verfahren_max_punkte,
  q.pruefer_anstellung_id,
  (pp.vorname || ' ' || pp.nachname) as pruefer_name,
  q.pruefer_extern_name,
  q.mit_kunde, q.nachgetragen,
  to_char(q.geraete_zeit at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                     as geraete_zeit_lokal,
  q.zeitabweichung_sek,
  q.bemerkung, q.dokument_id,
  q.punkte::text                     as punkte,
  q.max_punkte::text                 as max_punkte,
  q.erfuellungsgrad_prozent::text    as erfuellungsgrad,
  q.bestanden,
  (select count(*) from qualitaetspruefung_position p
    where p.qualitaetspruefung_id = q.id)::text                      as befunde,
  (select count(*) from qualitaetspruefung_position p
    where p.qualitaetspruefung_id = q.id and p.ergebnis = 'nio')::text as befunde_nio,
  (select count(*) from qualitaetspruefung_position p
    where p.qualitaetspruefung_id = q.id and p.ergebnis = 'nio'
      and p.frist_am is not null and p.frist_am < app.berlin_heute())::text
                                                                     as fristen_ueberfaellig,
  (q.archiviert_am is not null) as archiviert`;

function alsPruefung(z: PruefungRoh): PruefungZeile {
  return {
    id: z.id,
    nummer: z.nummer,
    gepruefLokal: z.geprueft_lokal,
    geprueftAmTag: z.geprueft_tag,
    objektId: z.objekt_id,
    objekt: z.objekt,
    revierId: z.revier_id,
    revier: z.revier,
    projektId: z.projekt_id,
    kundeId: z.kunde_id,
    kunde: z.kunde,
    verfahren: z.verfahren,
    verfahrenIstPlatzhalter: z.verfahren_platzhalter,
    verfahrenMaxPunkte: z.verfahren_max_punkte,
    prueferAnstellungId: z.pruefer_anstellung_id,
    prueferName: z.pruefer_name,
    prueferExternName: z.pruefer_extern_name,
    mitKunde: z.mit_kunde,
    nachgetragen: z.nachgetragen,
    geraeteZeitLokal: z.geraete_zeit_lokal,
    zeitabweichungSek: z.zeitabweichung_sek === null ? null : Number(z.zeitabweichung_sek),
    bemerkung: z.bemerkung,
    dokumentId: z.dokument_id,
    punkte: z.punkte,
    maxPunkte: z.max_punkte,
    erfuellungsgradProzent: z.erfuellungsgrad,
    bestanden: z.bestanden,
    befunde: Number(z.befunde),
    befundeNio: Number(z.befunde_nio),
    fristenUeberfaellig: Number(z.fristen_ueberfaellig),
    archiviert: z.archiviert,
  };
}

/**
 * Wie viele Zeilen die Liste hoechstens holt.
 *
 * Die Zahl steht hier und nicht als `200` in der Abfrage, weil die Seite sie
 * BRAUCHT: erreicht die Liste die Grenze, ist sie ein Ausschnitt, und das muss
 * dort stehen, wo jemand sie liest.
 */
export const PRUEFUNG_GRENZE = 200;

export interface PruefungFilter {
  readonly objektId?: string | null;
  readonly revierId?: string | null;
  /** Berliner Kalendertage, beide einschliessend. */
  readonly von?: string | null;
  readonly bis?: string | null;
  /** `true` = nur Prüfungen mit mindestens einem nio-Befund. */
  readonly nurMitMangel?: boolean;
  readonly grenze?: number;
}

export async function listePruefungen(
  kontext: LeseKontext, filter: PruefungFilter = {},
): Promise<readonly PruefungZeile[]> {
  const zeilen = await kontext.abfrage<PruefungRoh>(
    /*
     * Das Fenster wird ueber die INSTANTS verglichen und der Berliner
     * Kalendertag in der Anweisung aufgeloest. `(geprueft_am at time zone
     * 'Europe/Berlin')::date between $3 and $4` waere bequemer und liesse
     * jeden Index liegen; ausserdem ist der Doppelpunkt-Umweg
     * (`($3::date)::timestamp at time zone 'Europe/Berlin'`) der einzige, der
     * die richtige Ueberladung waehlt — die andere castet das Datum nach
     * timestamptz und verschiebt das Fenster um zwei Stunden.
     */
    `select ${PRUEFUNG_SPALTEN} ${PRUEFUNG_QUELLE}
      where ($1::uuid is null or q.objekt_id = $1::uuid)
        and ($2::uuid is null or q.revier_id = $2::uuid)
        and ($3::date is null
             or q.geprueft_am >= ($3::date)::timestamp at time zone 'Europe/Berlin')
        and ($4::date is null
             or q.geprueft_am <  (($4::date) + 1)::timestamp at time zone 'Europe/Berlin')
        and ($5::boolean is not true
             or exists (select 1 from qualitaetspruefung_position p
                         where p.qualitaetspruefung_id = q.id and p.ergebnis = 'nio'))
      order by q.geprueft_am desc, q.nummer desc
      limit $6::integer`,
    [
      filter.objektId ?? null, filter.revierId ?? null,
      filter.von ?? null, filter.bis ?? null,
      filter.nurMitMangel ?? false, filter.grenze ?? PRUEFUNG_GRENZE,
    ],
  );
  return zeilen.map(alsPruefung);
}

/**
 * Die Zahlen der Kacheln — UNGEFILTERT und UNBEGRENZT.
 *
 * `listePruefungen` liefert einen Ausschnitt: gefiltert (`?mangel=1`) und bei
 * `grenze` (Vorgabe 200) abgeschnitten. Kacheln daraus zu rechnen hiess, dass
 * „Prüfungen (alle)" bei aktivem Filter die Zahl der Prüfungen MIT Mangel
 * anzeigt und ab Zeile 201 jede Zahl zu klein ist — eine Beschriftung, die
 * genau das Gegenteil ihres Wortes zeigt.
 *
 * Eine Abfrage, nicht vier: vier `count`-Laeufe ueber dieselbe Tabelle sind
 * vier Tabellendurchlaeufe fuer eine Kachelzeile. `fristenUeberfaellig` ist
 * bewusst eine BEFUNDzahl (wie in der Liste), nicht eine Pruefungszahl — die
 * Kachel zaehlt Fristen, nicht Protokolle.
 */
export interface PruefungZahlen {
  readonly alle: number;
  readonly imMonat: number;
  readonly mitMangel: number;
  readonly fristenUeberfaellig: number;
  readonly ohneSkala: number;
}

export async function zaehlePruefungen(
  kontext: LeseKontext, monat: { readonly von: string; readonly bis: string },
): Promise<PruefungZahlen> {
  const [z] = await kontext.abfrage<{
    alle: string; im_monat: string; mit_mangel: string;
    fristen_ueberfaellig: string; ohne_skala: string;
  }>(
    `select
        count(*)::text as alle,
        count(*) filter (
          where q.geprueft_am >= ($1::date)::timestamp at time zone 'Europe/Berlin'
            and q.geprueft_am <  (($2::date) + 1)::timestamp at time zone 'Europe/Berlin'
        )::text as im_monat,
        count(*) filter (
          where exists (select 1 from qualitaetspruefung_position p
                         where p.qualitaetspruefung_id = q.id and p.ergebnis = 'nio')
        )::text as mit_mangel,
        coalesce(sum((select count(*) from qualitaetspruefung_position p
                       where p.qualitaetspruefung_id = q.id and p.ergebnis = 'nio'
                         and p.frist_am is not null
                         and p.frist_am < app.berlin_heute())), 0)::text
          as fristen_ueberfaellig,
        count(*) filter (where pv.max_punkte is null)::text as ohne_skala
       from qualitaetspruefung q
       join pruefverfahren pv on pv.mandant_id = q.mandant_id
                             and pv.id = q.pruefverfahren_id`,
    [monat.von, monat.bis],
  );
  return {
    alle: Number(z?.alle ?? '0'),
    imMonat: Number(z?.im_monat ?? '0'),
    mitMangel: Number(z?.mit_mangel ?? '0'),
    fristenUeberfaellig: Number(z?.fristen_ueberfaellig ?? '0'),
    ohneSkala: Number(z?.ohne_skala ?? '0'),
  };
}

export async function findePruefung(
  kontext: LeseKontext, id: string,
): Promise<PruefungZeile | null> {
  const [z] = await kontext.abfrage<PruefungRoh>(
    `select ${PRUEFUNG_SPALTEN} ${PRUEFUNG_QUELLE} where q.id = $1::uuid`, [id],
  );
  return z === undefined ? null : alsPruefung(z);
}

export interface BefundZeile {
  readonly id: string;
  readonly reihenfolge: number;
  readonly kriterium: string;
  readonly ergebnis: Pruefergebnis;
  /** `numeric`-Text oder `null`. */
  readonly punkte: string | null;
  readonly raumId: string | null;
  readonly raum: string | null;
  readonly revierRaumId: string | null;
  readonly mangelBeschreibung: string | null;
  readonly fristAm: string | null;
  /** `true`, wenn die Frist vor dem Berliner Heute liegt. */
  readonly fristUeberfaellig: boolean;
  readonly medienId: string | null;
}

export async function ladeBefunde(
  kontext: LeseKontext, pruefungId: string,
): Promise<readonly BefundZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; reihenfolge: number; kriterium: string; ergebnis: string;
    punkte: string | null; raum_id: string | null; raum: string | null;
    revier_raum_id: string | null; mangel_beschreibung: string | null;
    frist_am: string | null; ueberfaellig: boolean; medien_id: string | null;
  }>(
    /*
     * `raum` als LEFT JOIN: die Tabelle liegt hinter `objekt.lesen`, die
     * Position hinter `qualitaet.lesen`. Ein Innenverbund liesse den Befund
     * verschwinden, weil der Raumname fehlt — und ein fehlender Mangel ist
     * schlimmer als ein fehlender Raumname.
     */
    `select p.id, p.reihenfolge::int as reihenfolge, p.kriterium,
            p.ergebnis::text as ergebnis, p.punkte::text as punkte,
            p.raum_id,
            case when rm.id is null then null
                 else coalesce(rm.raumnummer, '') ||
                      case when rm.bezeichnung is null then ''
                           else ' · ' || rm.bezeichnung end end as raum,
            p.revier_raum_id, p.mangel_beschreibung,
            to_char(p.frist_am, 'YYYY-MM-DD') as frist_am,
            coalesce(p.frist_am < app.berlin_heute(), false) as ueberfaellig,
            p.medien_id
       from qualitaetspruefung_position p
       left join raum rm on rm.mandant_id = p.mandant_id and rm.id = p.raum_id
      where p.qualitaetspruefung_id = $1::uuid
      order by p.reihenfolge
      limit 500`,
    [pruefungId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    reihenfolge: Number(z.reihenfolge),
    kriterium: z.kriterium,
    ergebnis: PRUEFERGEBNISSE.find((e) => e === z.ergebnis) ?? 'nicht_pruefbar',
    punkte: z.punkte,
    raumId: z.raum_id,
    raum: z.raum,
    revierRaumId: z.revier_raum_id,
    mangelBeschreibung: z.mangel_beschreibung,
    fristAm: z.frist_am,
    fristUeberfaellig: z.ueberfaellig,
    medienId: z.medien_id,
  }));
}

/* ===========================================================================
 * Die Auswahllisten des Erfassungsformulars
 * ======================================================================== */

export interface PruefungAuswahl {
  readonly objekte: readonly { readonly id: string; readonly bezeichnung: string;
    readonly kundeId: string | null; readonly kunde: string | null }[];
  readonly reviere: readonly { readonly id: string; readonly bezeichnung: string;
    readonly objektId: string }[];
  readonly revierRaeume: readonly { readonly id: string; readonly revierId: string;
    readonly bezeichnung: string }[];
  readonly verfahren: readonly PruefverfahrenZeile[];
  readonly eigeneAnstellung: { readonly id: string; readonly name: string } | null;
  readonly geprueft: Readonly<Record<string, boolean>>;
}

/**
 * Was das Erfassungsformular zur Auswahl braucht.
 *
 * **Der Prüfer ist die EIGENE Anstellung oder ein externer Name** — nie eine
 * Auswahlliste über alle Beschäftigten. Wer prüft, steht in der Sitzung; eine
 * Liste zum Aussuchen wäre ein Prüfprotokoll, das jemand einem Kollegen
 * unterschiebt (dieselbe Regel wie beim Wachbuch, §10.5).
 *
 * `qp_ein_anker` verlangt mindestens ein Objekt oder ein Projekt. Das Formular
 * erzwingt das Objekt; ohne Objekte in der Auswahl lässt sich keine Prüfung
 * erfassen, und die Seite sagt es, statt ein Formular zu zeigen, das beim
 * Absenden scheitert.
 */
export async function ladePruefungAuswahl(
  kontext: LeseKontext,
): Promise<PruefungAuswahl> {
  const geprueft = await rechteImKontext(
    kontext, 'objekt.lesen', 'crm.lesen', 'reinigung.lesen',
  );
  const objekte = geprueft['objekt.lesen'] === true
    ? await kontext.abfrage<{
      id: string; bezeichnung: string; kundeId: string | null; kunde: string | null;
    }>(
      `select o.id, o.bezeichnung, o.kunde_id as "kundeId", k.name as kunde
         from objekt o
         left join kunde k on k.mandant_id = o.mandant_id and k.id = o.kunde_id
        where o.archiviert_am is null
        order by o.bezeichnung limit 300`,
    )
    : [];
  /*
   * Revier und Revierraum liegen hinter `reinigung.lesen`. Qualitaet ist ein
   * QUERSCHNITTSmodul: eine Prueferin der Sicherheit haelt das Recht nicht,
   * und dann ist die Revierauswahl leer — nicht, weil es keine Reviere gibt.
   */
  const reviere = geprueft['reinigung.lesen'] === true
    ? await kontext.abfrage<{ id: string; bezeichnung: string; objektId: string }>(
      `select r.id, r.bezeichnung, r.objekt_id as "objektId"
         from revier r where r.archiviert_am is null
        order by r.bezeichnung limit 300`,
    )
    : [];
  const revierRaeume = geprueft['reinigung.lesen'] === true
    ? await kontext.abfrage<{ id: string; revierId: string; bezeichnung: string }>(
      `select rr.id, rr.revier_id as "revierId",
              coalesce(rm.raumnummer, '?') ||
                case when rm.bezeichnung is null then ''
                     else ' · ' || rm.bezeichnung end as bezeichnung
         from revier_raum rr
         left join raum rm on rm.mandant_id = rr.mandant_id and rm.id = rr.raum_id
        order by rr.revier_id, rr.reihenfolge limit 2000`,
    )
    : [];
  const verfahren = await listePruefverfahren(kontext);
  const [eigene] = await kontext.abfrage<{ id: string; name: string }>(
    `select a.id, (p.vorname || ' ' || p.nachname) as name
       from anstellung a
       join person p on p.id = a.person_id
      where a.mandant_id = app.aktiver_mandant()
        and a.person_id = app.aktuelle_person()
        and a.geloescht_am is null and a.status <> 'beendet'
      limit 1`,
  );
  return {
    objekte,
    reviere,
    revierRaeume,
    verfahren,
    eigeneAnstellung: eigene ?? null,
    geprueft,
  };
}

/** Dezimaltexte addieren, ohne Gleitkomma — zwei Nachkommastellen. */
export function summiereText(werte: readonly string[]): string {
  const summe = werte.reduce((s, w) => s + hundertstel(w), 0n);
  const negativ = summe < 0n;
  const abs = negativ ? -summe : summe;
  return `${negativ ? '-' : ''}${String(abs / 100n)}.${String(abs % 100n).padStart(2, '0')}`;
}
