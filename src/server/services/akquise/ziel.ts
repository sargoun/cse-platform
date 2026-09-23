/**
 * Die Akquiseliste — anlegen, ansehen, bewerten, verwerfen (§12).
 *
 * Ein `akquise_ziel` ist eine **Firma, über die noch niemand gesprochen hat**.
 * Es ist kein Lead: ein Lead hat einen Anlass (eine Anfrage, eine
 * Ausschreibung, eine Empfehlung), eine Frist und einen Besitzer. Ein
 * Akquiseziel hat nur eine Vermutung. Die beiden zu vermischen hiesse, die
 * Lead-Liste — die Arbeitsliste des Vertriebs — mit Vermutungen zu fluten und
 * die SLA-Eskalation (REQ-06) auf Firmen laufen zu lassen, die nie angefragt
 * haben.
 *
 * Die Naht zwischen beiden Welten ist `uebernehmen()`, und über sie geht ein
 * **Mensch**: er entscheidet, dass aus einer Vermutung ein Vorgang wird.
 */
import { bewerte, type ZielDaten } from './bewertung.js';
import type { Abfrage, Fund } from './quelle.js';

export type ZielStatus = 'neu' | 'geprueft' | 'uebernommen' | 'verworfen';

export interface Ziel {
  readonly id: string;
  readonly firmenname: string;
  readonly branche: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly website: string | null;
  readonly allgemeineEmail: string | null;
  readonly telefon: string | null;
  readonly punktzahl: number | null;
  readonly punktzahlBegruendung: string | null;
  readonly passenderBereich: string | null;
  readonly bedarfVermutung: string | null;
  readonly status: ZielStatus;
  readonly verworfenGrund: string | null;
  readonly leadId: string | null;
  readonly quelleBezeichnung: string | null;
  readonly gefundenAm: Date;
  /**
   * Wer die Firma wann angesehen hat (V-080).
   *
   * `markiereGeprueft` stempelt beides seit je; gelesen hat es niemand, weil
   * es niemand herausgab — und weil kein Formular die Handlung auslöste.
   */
  readonly angesehenAm: Date | null;
  readonly angesehenVon: string | null;
}

export class AkquiseFehler extends Error {
  constructor(nachricht: string, readonly grund:
    'nicht_gefunden' | 'schon_uebernommen' | 'verworfen_ohne_grund' | 'kein_bereich') {
    super(nachricht);
    this.name = 'AkquiseFehler';
  }
}

const FELDER = `z.id, z.firmenname, z.branche, z.strasse, z.plz, z.ort, z.website,
                z.allgemeine_email, z.telefon, z.punktzahl, z.punktzahl_begruendung,
                z.passender_bereich, z.bedarf_vermutung, z.status, z.verworfen_grund,
                z.lead_id, z.gefunden_am, q.bezeichnung as quelle_bezeichnung,
                z.angesehen_am,
                (select b.name from benutzer b where b.id = z.angesehen_von)
                  as angesehen_von_name`;

interface Zeile {
  id: string; firmenname: string; branche: string | null; strasse: string | null;
  plz: string | null; ort: string | null; website: string | null;
  allgemeine_email: string | null; telefon: string | null;
  punktzahl: number | null; punktzahl_begruendung: string | null;
  passender_bereich: string | null; bedarf_vermutung: string | null;
  status: ZielStatus; verworfen_grund: string | null; lead_id: string | null;
  gefunden_am: Date; quelle_bezeichnung: string | null;
  angesehen_am: Date | null; angesehen_von_name: string | null;
}

function zuZiel(z: Zeile): Ziel {
  return {
    id: z.id, firmenname: z.firmenname, branche: z.branche, strasse: z.strasse,
    plz: z.plz, ort: z.ort, website: z.website, allgemeineEmail: z.allgemeine_email,
    telefon: z.telefon,
    // `smallint` kommt je nach Treiber als Zeichenkette zurueck.
    punktzahl: z.punktzahl === null ? null : Number(z.punktzahl),
    punktzahlBegruendung: z.punktzahl_begruendung,
    passenderBereich: z.passender_bereich, bedarfVermutung: z.bedarf_vermutung,
    status: z.status, verworfenGrund: z.verworfen_grund, leadId: z.lead_id,
    quelleBezeichnung: z.quelle_bezeichnung, gefundenAm: z.gefunden_am,
    angesehenAm: z.angesehen_am,
    /* `null` heisst hier auch: der Name ist für diese Sitzung nicht lesbar. */
    angesehenVon: z.angesehen_von_name,
  };
}

export interface ListenFilter {
  readonly status?: readonly ZielStatus[];
  readonly bereich?: string;
  readonly mindestpunktzahl?: number;
  readonly grenze?: number;
}

/**
 * Die Arbeitsliste, nach Punktzahl absteigend.
 *
 * `nulls last`: eine Firma ohne Bewertung steht unten, nicht oben. Ohne die
 * Angabe sortiert Postgres NULL bei `desc` nach vorn — die unbewerteten
 * Zeilen stuenden dann genau dort, wo der Vertrieb die besten erwartet.
 */
export async function liste(
  db: Abfrage, mandantId: string, filter: ListenFilter = {},
): Promise<readonly Ziel[]> {
  const werte: unknown[] = [mandantId];
  let sql = `select ${FELDER}
               from akquise_ziel z
               left join akquise_quelle q on q.id = z.quelle_id
              where z.mandant_id = $1 and z.archiviert_am is null`;

  if (filter.status !== undefined && filter.status.length > 0) {
    werte.push(filter.status);
    sql += ` and z.status = any($${werte.length}::akquise_status[])`;
  }
  if (filter.bereich !== undefined) {
    werte.push(filter.bereich);
    sql += ` and z.passender_bereich = $${werte.length}`;
  }
  if (filter.mindestpunktzahl !== undefined) {
    werte.push(filter.mindestpunktzahl);
    sql += ` and z.punktzahl >= $${werte.length}`;
  }
  werte.push(filter.grenze ?? 100);
  sql += ` order by z.punktzahl desc nulls last, z.gefunden_am desc
           limit $${werte.length}`;

  return ((await db.unsafe(sql, werte)) as Zeile[]).map(zuZiel);
}

export async function lade(db: Abfrage, mandantId: string, id: string): Promise<Ziel | null> {
  const zeilen = (await db.unsafe(
    `select ${FELDER}
       from akquise_ziel z
       left join akquise_quelle q on q.id = z.quelle_id
      where z.mandant_id = $1 and z.id = $2 and z.archiviert_am is null`,
    [mandantId, id],
  )) as Zeile[];
  const z = zeilen[0];
  return z === undefined ? null : zuZiel(z);
}

export interface NeuesZiel extends Fund {
  readonly quelleId?: string | null;
}

/**
 * Eine Firma aufnehmen — und sofort bewerten.
 *
 * **Die Bewertung läuft hier und nicht später.** Eine Zeile ohne Punktzahl ist
 * in der Liste unsichtbar (sie steht unten) und in der Auswertung eine Lücke.
 * Sie erst beim Öffnen zu rechnen hiesse, dass die Sortierung von der
 * Reihenfolge abhängt, in der jemand Zeilen angeklickt hat.
 *
 * **`on conflict do nothing`, nicht „aktualisieren".** Der eindeutige Index
 * greift über Name und Ort. Trifft eine Quelle dieselbe Firma noch einmal,
 * bleibt die vorhandene Zeile stehen — mitsamt dem, was ein Mensch daran
 * entschieden hat. Ein Überschreiben setzte ein „verworfen, kein Bedarf"
 * wieder auf „neu" zurück, und der Vertrieb telefonierte zum zweiten Mal
 * hinterher.
 */
export async function nimmAuf(
  db: Abfrage, mandantId: string, eingabe: NeuesZiel,
): Promise<{ readonly id: string | null; readonly zustand: 'neu' | 'bekannt' }> {
  const daten: ZielDaten = {
    firmenname: eingabe.firmenname,
    branche: eingabe.branche ?? null,
    plz: eingabe.plz ?? null,
    ort: eingabe.ort ?? null,
    website: eingabe.website ?? null,
    allgemeineEmail: eingabe.allgemeineEmail ?? null,
    telefon: eingabe.telefon ?? null,
  };
  const b = bewerte(daten);

  const zeilen = (await db.unsafe(
    `insert into akquise_ziel
       (mandant_id, quelle_id, firmenname, branche, strasse, plz, ort, website,
        allgemeine_email, telefon, punktzahl, punktzahl_begruendung,
        passender_bereich, bedarf_vermutung, punktzahl_berechnet_am)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
     on conflict do nothing
     returning id`,
    [
      mandantId, eingabe.quelleId ?? null, eingabe.firmenname,
      eingabe.branche ?? null, eingabe.strasse ?? null, eingabe.plz ?? null,
      eingabe.ort ?? null, eingabe.website ?? null, eingabe.allgemeineEmail ?? null,
      eingabe.telefon ?? null, b.punktzahl, b.begruendung, b.passenderBereich,
      b.bedarfVermutung,
    ],
  )) as { id: string }[];

  const z = zeilen[0];
  return z === undefined
    ? { id: null, zustand: 'bekannt' }
    : { id: z.id, zustand: 'neu' };
}

/**
 * **Als angesehen stempeln** — wer hat die Firma wann geprüft (V-080).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das ein KNOPF ist und kein Seitenaufruf.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der naheliegende Weg wäre, beim Öffnen des Blattes zu stempeln — „angesehen
 * heisst angesehen". Er wäre falsch: ein Seitenaufruf ist ein GET, und ein
 * GET, der schreibt, wird von jedem Vorschau-Abruf, jedem Linkprüfer und
 * jedem zweiten Reiter ausgelöst. Der Stempel sagt dann nicht „ein Mensch hat
 * entschieden", sondern „irgendetwas hat diese Adresse geholt".
 *
 * Gestempelt wird deshalb, wenn jemand es SAGT. Der Zustand `geprueft`
 * bedeutet damit, was er soll: jemand hat sich die Firma angesehen und sie
 * bewusst weder übernommen noch verworfen — sie bleibt in der Liste, aber
 * nicht mehr unter „neu".
 *
 * **`status` geht nur aus `neu` heraus** (`case when status = 'neu'`): ein
 * übernommenes oder verworfenes Ziel fällt nicht auf `geprueft` zurück, wenn
 * es noch einmal jemand ansieht. Der Zeitstempel wird trotzdem erneuert — er
 * sagt, wann zuletzt jemand hingesehen hat, und das ist auch dann eine
 * Auskunft.
 */
export async function markiereGeprueft(
  db: Abfrage, mandantId: string, id: string, benutzerId: string,
): Promise<void> {
  const zeilen = (await db.unsafe(
    `update akquise_ziel
        set status = case when status = 'neu' then 'geprueft'::akquise_status else status end,
            angesehen_am = now(), angesehen_von = $3
      where mandant_id = $1 and id = $2 and archiviert_am is null
      returning id`,
    [mandantId, id, benutzerId],
  )) as { id: string }[];
  if (zeilen[0] === undefined) {
    throw new AkquiseFehler('Dieses Akquiseziel gibt es nicht.', 'nicht_gefunden');
  }
}

/**
 * Verwerfen — nur MIT Grund.
 *
 * Der CHECK in der Tabelle verlangt ihn ohnehin; hier steht er noch einmal,
 * damit die Oberfläche eine Meldung in Worten bekommt statt einer
 * Constraint-Verletzung. Der Grund ist kein Formalismus: er ist das, was den
 * nächsten Lauf davon abhält, dieselbe Firma wieder oben anzuzeigen.
 */
export async function verwirf(
  db: Abfrage, mandantId: string, id: string, grund: string,
): Promise<void> {
  if (grund.trim() === '') {
    throw new AkquiseFehler(
      'Zum Verwerfen gehört ein Grund — sonst schlägt dieselbe Firma morgen wieder auf.',
      'verworfen_ohne_grund',
    );
  }
  const zeilen = (await db.unsafe(
    `update akquise_ziel set status = 'verworfen', verworfen_grund = $3
      where mandant_id = $1 and id = $2 and status <> 'uebernommen'
        and archiviert_am is null
      returning id`,
    [mandantId, id, grund.trim()],
  )) as { id: string }[];
  if (zeilen[0] === undefined) {
    throw new AkquiseFehler(
      'Dieses Akquiseziel gibt es nicht oder es ist bereits übernommen.', 'nicht_gefunden',
    );
  }
}
