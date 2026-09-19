/**
 * Abwesenheiten — melden, entscheiden, stornieren (EMP-10, EMP-05, TIM-05,
 * LEG-09).
 *
 * **Was dieser Dienst NICHT tut: den Grund ausliefern.** `abwesenheit` gibt
 * `cse_app` die Spalten `abwesenheitsart_id`, `au_*`, `dokument_id`,
 * `bemerkung` und `ablehnungsgrund` gar nicht erst zu lesen (0073). Wer sie
 * braucht, ruft `leseGrund` — und schreibt damit eine Auditzeile, weil ein
 * Zugriff auf ein Gesundheitsdatum nachweisbar sein muss (Art. 9 DSGVO). Der
 * Dienstplan kommt ohne aus: er fragt „ist diese Person an diesem Tag
 * verfuegbar", und das beantwortet der Status.
 *
 * **Die Tage rechnet `tage.ts`, nicht die Datenbank und nicht die Oberflaeche**
 * (Invariante 6, K-10). Sie gehen als `numeric(12,3)` in die Zeile und von
 * dort per Ausloeser auf das Urlaubskonto.
 *
 * **Eine Art mit ungeklaertem `bezahlt` wird verweigert** (O-139). Der Dienst
 * koennte sie durchlassen und die Lohnwirkung offen lassen — dann entstuende
 * eine Abwesenheit, deren Bezahlung niemand entschieden hat, und sie faellt
 * erst in der Lohnabrechnung auf.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { mengeNachPostgres, type MilliMenge } from '../finanz/menge.js';
import { rechneTage, type Wochentag } from './tage.js';

export type AbwesenheitStatus =
  'beantragt' | 'genehmigt' | 'abgelehnt' | 'storniert' | 'erfasst';

export interface AbwesenheitZeile {
  readonly id: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personName: string;
  readonly von: string;
  readonly bis: string;
  readonly vonHalbtags: boolean;
  readonly bisHalbtags: boolean;
  /** `numeric(12,3)` als Tausendstel — `null`, solange nichts gerechnet wurde. */
  readonly tageAngerechnet: string | null;
  readonly status: AbwesenheitStatus;
  readonly antragId: string | null;
  readonly gemeldetAm: Date;
  readonly genehmigtAm: Date | null;
  /**
   * Der Zeitpunkt der Stornierung — `null`, solange nichts storniert ist.
   *
   * Die Spalte gab es, die Abfrage holte sie nicht: das Detailblatt zeigte
   * damit einen Status `storniert` ohne den Zeitpunkt, an dem er entstand.
   * Bei einer Zeile, die ausdruecklich nicht geloescht wird (Invariante 8),
   * ist genau dieser Zeitpunkt die Auskunft.
   */
  readonly storniertAm: Date | null;
}

/** Der Grund — nur ueber die Definer-Funktion, nur mit eigenem Recht. */
export interface AbwesenheitsGrund {
  readonly abwesenheitsartId: string;
  readonly abwesenheitsart: string;
  readonly istGesundheitsbezogen: boolean;
  readonly auBescheinigungVorliegt: boolean;
  readonly auBis: string | null;
  readonly dokumentId: string | null;
  readonly bemerkung: string | null;
  readonly ablehnungsgrund: string | null;
}

export class ArtUngeklaertFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(bezeichnung: string) {
    super(
      `Für die Abwesenheitsart „${bezeichnung}" ist nicht hinterlegt, ob sie `
      + 'bezahlt ist (O-139). Ohne diese Angabe entsteht keine Abwesenheit — '
      + 'die Lohnwirkung wäre offen und fiele erst in der Abrechnung auf.',
    );
    this.name = 'ArtUngeklaertFehler';
  }
}

export class AbwesenheitNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Abwesenheit ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AbwesenheitNichtGefunden';
  }
}

export class GrundFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(was: string) {
    super(`${was} ohne Begründung ist kein Vorgang, sondern ein Klick.`);
    this.name = 'GrundFehlt';
  }
}

const ZEILE = `
  select a.id, a.mandant_id, a.anstellung_id,
         (p.vorname || ' ' || p.nachname)                as person_name,
         to_char(a.von, 'YYYY-MM-DD')                    as von,
         to_char(a.bis, 'YYYY-MM-DD')                    as bis,
         a.von_halbtags, a.bis_halbtags,
         a.tage_angerechnet::text                        as tage_angerechnet,
         a.status::text                                  as status,
         a.antrag_id, a.gemeldet_am, a.genehmigt_am, a.storniert_am
    from abwesenheit a
    join anstellung an on an.mandant_id = a.mandant_id and an.id = a.anstellung_id
    join person p on p.id = an.person_id`;

interface RohZeile {
  readonly id: string; readonly mandant_id: string; readonly anstellung_id: string;
  readonly person_name: string; readonly von: string; readonly bis: string;
  readonly von_halbtags: boolean; readonly bis_halbtags: boolean;
  readonly tage_angerechnet: string | null; readonly status: AbwesenheitStatus;
  readonly antrag_id: string | null; readonly gemeldet_am: Date;
  readonly genehmigt_am: Date | null; readonly storniert_am: Date | null;
}

function zeile(z: RohZeile): AbwesenheitZeile {
  return {
    id: z.id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    personName: z.person_name,
    von: z.von,
    bis: z.bis,
    vonHalbtags: z.von_halbtags,
    bisHalbtags: z.bis_halbtags,
    tageAngerechnet: z.tage_angerechnet,
    status: z.status,
    antragId: z.antrag_id,
    gemeldetAm: z.gemeldet_am,
    genehmigtAm: z.genehmigt_am,
    storniertAm: z.storniert_am,
  };
}

export interface AbwesenheitFilter {
  readonly anstellungId?: string;
  readonly von?: string;
  readonly bis?: string;
  readonly status?: readonly AbwesenheitStatus[];
}

export async function listeAbwesenheiten(
  kontext: LeseKontext, filter: AbwesenheitFilter = {},
): Promise<readonly AbwesenheitZeile[]> {
  const werte: unknown[] = [];
  const teile: string[] = [];
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    teile.push(`a.anstellung_id = $${String(werte.length)}::uuid`);
  }
  if (filter.von !== undefined && filter.bis !== undefined) {
    werte.push(filter.von, filter.bis);
    // Ueberschneidung, nicht Enthaltensein: ein Urlaub, der vor dem Fenster
    // beginnt und hineinragt, ist im Fenster relevant.
    teile.push(`daterange(a.von, a.bis, '[]')
                && daterange($${String(werte.length - 1)}::date, $${String(werte.length)}::date, '[]')`);
  }
  if (filter.status !== undefined && filter.status.length > 0) {
    werte.push(filter.status);
    teile.push(`a.status = any($${String(werte.length)}::abwesenheit_status[])`);
  }
  const roh = await kontext.abfrage<RohZeile>(
    `${ZEILE} ${teile.length === 0 ? '' : `where ${teile.join(' and ')}`}
      order by a.von desc, a.id`,
    werte,
  );
  return roh.map(zeile);
}

export async function findeAbwesenheit(
  kontext: LeseKontext, id: string,
): Promise<AbwesenheitZeile | null> {
  const [z] = await kontext.abfrage<RohZeile>(`${ZEILE} where a.id = $1::uuid`, [id]);
  return z === undefined ? null : zeile(z);
}

interface ArtZeile { readonly id: string; readonly bezeichnung: string; readonly bezahlt: boolean | null }

async function pruefeArt(kontext: LeseKontext, artId: string): Promise<ArtZeile> {
  const [art] = await kontext.abfrage<ArtZeile>(
    `select id, bezeichnung, bezahlt from abwesenheitsart
      where id = $1::uuid and archiviert_am is null`,
    [artId],
  );
  if (art === undefined) throw new AbwesenheitNichtGefunden(artId);
  if (art.bezahlt === null) throw new ArtUngeklaertFehler(art.bezeichnung);
  return art;
}

export interface MeldeEingabe {
  readonly anstellungId: string;
  readonly abwesenheitsartId: string;
  readonly von: string;
  readonly bis: string;
  readonly vonHalbtags?: boolean;
  readonly bisHalbtags?: boolean;
  readonly bemerkung?: string | null;
  readonly auBescheinigungVorliegt?: boolean;
  readonly auBis?: string | null;
  readonly arbeitstage?: readonly Wochentag[];
  /**
   * `erfasst` fuer eine Krankmeldung — sie wird zur Kenntnis genommen, nicht
   * genehmigt. `beantragt` fuer alles, worueber noch jemand entscheidet.
   */
  readonly status?: 'erfasst' | 'beantragt';
}

/**
 * Nimmt eine Abwesenheit auf — der Weg der Planung (die Krankmeldung am
 * Telefon um 05:40).
 *
 * Die Tage werden auch fuer eine Krankmeldung gerechnet: sie zaehlen zwar
 * nicht auf das Urlaubskonto, aber die Sollzeitgutschrift im Stundenkonto
 * haengt an derselben Zahl (EMP-04).
 */
export async function meldeAbwesenheit(
  kontext: SchreibKontext, eingabe: MeldeEingabe,
): Promise<AbwesenheitZeile> {
  await pruefeArt(kontext, eingabe.abwesenheitsartId);
  const tage: MilliMenge = rechneTage({
    von: eingabe.von,
    bis: eingabe.bis,
    vonHalbtags: eingabe.vonHalbtags ?? false,
    bisHalbtags: eingabe.bisHalbtags ?? false,
    ...(eingabe.arbeitstage === undefined ? {} : { arbeitstage: eingabe.arbeitstage }),
  });

  const [neu] = await kontext.schreibe<{ id: string }>(
    `insert into abwesenheit
       (mandant_id, anstellung_id, abwesenheitsart_id, von, bis,
        von_halbtags, bis_halbtags, tage_angerechnet, status,
        au_bescheinigung_vorliegt, au_bis, bemerkung, erstellt_von)
     values ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::date,
             $6, $7, $8::numeric, $9::abwesenheit_status,
             $10, $11::date, $12, $13::uuid)
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, eingabe.abwesenheitsartId,
      eingabe.von, eingabe.bis,
      eingabe.vonHalbtags ?? false, eingabe.bisHalbtags ?? false,
      mengeNachPostgres(tage), eingabe.status ?? 'erfasst',
      eingabe.auBescheinigungVorliegt ?? false, eingabe.auBis ?? null,
      eingabe.bemerkung ?? null, kontext.benutzerId,
    ],
  );
  const gelesen = await findeAbwesenheit(kontext, neu!.id);
  if (gelesen === null) throw new AbwesenheitNichtGefunden(neu!.id);
  return gelesen;
}

/**
 * Genehmigt eine beantragte Abwesenheit.
 *
 * Die Tage stehen schon in der Zeile; sie werden hier NICHT neu gerechnet.
 * Zwei Rechnungen zu demselben Zeitraum, eine beim Beantragen und eine beim
 * Genehmigen, gehen genau dann auseinander, wenn zwischen beiden ein Feiertag
 * nachgetragen wurde — und der Unterschied faellt niemandem auf.
 */
export async function genehmigeAbwesenheit(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update abwesenheit
        set status = 'genehmigt', genehmigt_von = $2::uuid, geaendert_am = now(),
            geaendert_von = $2::uuid
      where id = $1::uuid and status = 'beantragt'
      returning id`,
    [id, kontext.benutzerId],
  );
  if (zeilen.length === 0) throw new AbwesenheitNichtGefunden(id);
}

export async function lehneAbwesenheitAb(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim() === '') throw new GrundFehlt('Eine Ablehnung');
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update abwesenheit
        set status = 'abgelehnt', ablehnungsgrund = $3, geaendert_am = now(),
            geaendert_von = $2::uuid
      where id = $1::uuid and status = 'beantragt'
      returning id`,
    [id, kontext.benutzerId, grund.trim()],
  );
  if (zeilen.length === 0) throw new AbwesenheitNichtGefunden(id);
}

/**
 * Storniert — die Zeile bleibt (Invariante 8), das Urlaubskonto bekommt
 * zurueck.
 *
 * **Der Grund geht ins AUDITLOG und nicht in `bemerkung`**, und das ist keine
 * Bequemlichkeit: `bemerkung` ist eine der Spalten, die `cse_app` nicht lesen
 * darf (Art. 9 DSGVO, 0073). Ein `bemerkung = bemerkung || …` verlangt die
 * Spalte zu LESEN und scheitert mit „permission denied" — an einer Stelle, an
 * der niemand ein Spaltenrecht vermutet. Und inhaltlich gehoert der Grund
 * ohnehin dorthin: „wer hat wann was warum getan" ist die Frage des
 * Protokolls, nicht die einer Personalnotiz.
 */
export async function storniereAbwesenheit(
  kontext: SchreibKontext, id: string, grund: string,
): Promise<void> {
  if (grund.trim() === '') throw new GrundFehlt('Eine Stornierung');
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update abwesenheit
        set status = 'storniert', storniert_von = $2::uuid,
            geaendert_am = now(), geaendert_von = $2::uuid
      where id = $1::uuid and status in ('beantragt','genehmigt','erfasst')
      returning id`,
    [id, kontext.benutzerId],
  );
  if (zeilen.length === 0) throw new AbwesenheitNichtGefunden(id);

  await kontext.schreibe(
    `select app.protokolliere('personal.abwesenheit_storniert', 'abwesenheit', $1,
                              null, jsonb_build_object('grund', $2::text))`,
    [id, grund.trim()],
  );
}

/**
 * Der Grund — ueber die Definer-Funktion, mit Auditzeile (Art. 9 DSGVO).
 *
 * `null` heisst: es gibt die Zeile nicht (oder nicht in diesem Mandanten). Ein
 * fehlendes Recht wirft — es ist etwas anderes als eine fehlende Zeile, und
 * die Oberflaeche soll den Unterschied sagen koennen.
 */
export async function leseGrund(
  kontext: LeseKontext, id: string,
): Promise<AbwesenheitsGrund | null> {
  const [g] = await kontext.abfrage<{
    abwesenheitsart_id: string; abwesenheitsart: string;
    ist_gesundheitsbezogen: boolean; au_bescheinigung_vorliegt: boolean;
    au_bis: string | null; dokument_id: string | null;
    bemerkung: string | null; ablehnungsgrund: string | null;
  }>(`select * from app.abwesenheit_grund_lesen($1::uuid)`, [id]);
  if (g === undefined) return null;
  return {
    abwesenheitsartId: g.abwesenheitsart_id,
    abwesenheitsart: g.abwesenheitsart,
    istGesundheitsbezogen: g.ist_gesundheitsbezogen,
    auBescheinigungVorliegt: g.au_bescheinigung_vorliegt,
    auBis: g.au_bis,
    dokumentId: g.dokument_id,
    bemerkung: g.bemerkung,
    ablehnungsgrund: g.ablehnungsgrund,
  };
}

/** Wer im Fenster an welchen Tagen nicht verfuegbar ist — fuer den Dienstplan. */
export interface Unverfuegbarkeit {
  readonly anstellungId: string;
  readonly personName: string;
  readonly von: string;
  readonly bis: string;
  readonly status: AbwesenheitStatus;
}

/**
 * Die Frage des Dienstplans — und die einzige, die er stellen darf (TIM-05).
 *
 * Zurueck kommen Beschaeftigung, Zeitraum und Status. Kein Grund, keine Art,
 * kein AU-Kennzeichen: der Plan zeigt „abwesend", nie „krank". Diese Signatur
 * ist die Zusage; sie steht hier und wird von einem Test Feld fuer Feld
 * geprueft.
 *
 * **Und sie bleibt in EINER Gesellschaft.** Wer in zwei Gesellschaften
 * arbeitet, meldet sich zweimal ab (D-09) — diese Abfrage laeuft unter der RLS
 * des aktiven Mandanten und sieht die fremde Abmeldung nicht. Das ist kein
 * Versehen: eine zweite Durchlaessigkeit in der Mandantenwand waere neben der
 * ArbZG-Belastung die zweite, und K-06 laesst ausdruecklich genau eine zu.
 * // TODO(client, O-209): Soll eine Abwesenheit in einer Gesellschaft die Person auch in der anderen als unverfuegbar zeigen — und auf welcher Rechtsgrundlage (Art. 9 DSGVO)?
 */
export async function unverfuegbarImFenster(
  kontext: LeseKontext, von: string, bis: string,
): Promise<readonly Unverfuegbarkeit[]> {
  const roh = await kontext.abfrage<{
    anstellung_id: string; person_name: string;
    von: string; bis: string; status: AbwesenheitStatus;
  }>(
    `select a.anstellung_id,
            (p.vorname || ' ' || p.nachname)   as person_name,
            to_char(a.von, 'YYYY-MM-DD')       as von,
            to_char(a.bis, 'YYYY-MM-DD')       as bis,
            a.status::text                     as status
       from abwesenheit a
       join anstellung an on an.mandant_id = a.mandant_id and an.id = a.anstellung_id
       join person p on p.id = an.person_id
      where a.status in ('beantragt','genehmigt','erfasst')
        and daterange(a.von, a.bis, '[]') && daterange($1::date, $2::date, '[]')
      order by a.von`,
    [von, bis],
  );
  return roh.map((z) => ({
    anstellungId: z.anstellung_id,
    personName: z.person_name,
    von: z.von,
    bis: z.bis,
    status: z.status,
  }));
}
