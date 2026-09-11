/**
 * Das Leistungsverzeichnis: OZ-Hierarchie, Ordnung und Summen (BAU-01,
 * 03-GEWERKE §7.5, §10.2).
 *
 * Ein LV ist ein Baum aus Losen, Titeln, Untertiteln und Positionen, und seine
 * Ordnung ist die **Ordnungszahl** — „01.02.0030", so wie sie im LV des
 * Auftraggebers steht. Zwei Dinge daran sind schwieriger, als sie aussehen:
 *
 *  1. **Textsortierung stellt `1.2.10` VOR `1.2.9`.** Für einen Menschen ist
 *     das offensichtlich falsch; für ein `order by oz` ist es korrekt, weil
 *     „1" vor „9" kommt. Deshalb gibt es neben `oz` einen `sortier_pfad`, in
 *     dem jede Zahl auf feste Breite aufgefüllt ist — und diese Datei
 *     berechnet ihn genauso, wie der Ausloeser `bau.setze_lv_pfad()` in
 *     `0071` ihn berechnet. Eine Isolationsprüfung vergleicht beide
 *     Fassungen Zeichen für Zeichen; zwei Sortierungen, die auseinanderlaufen,
 *     wären zwei verschiedene Leistungsverzeichnisse.
 *  2. **Die Σ je Titel und je Los muss auf den Cent mit der LV-Summe
 *     übereinstimmen.** Das gelingt nur, wenn genau EINMAL gerundet wird, und
 *     zwar je Position: Σ der gerundeten Positionsbeträge ist unabhängig
 *     davon, in welcher Reihenfolge und über welche Zwischenebenen summiert
 *     wird. Wer stattdessen je Ebene rundete, bekäme Titelsummen, die sich
 *     um Cent von ihrer Gesamtsumme unterscheiden — der klassische Streitfall
 *     in einer Schlussrechnung.
 *
 * Der Dienst LIEST und rechnet; er schreibt nichts.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { addiere, cent, multipliziereMitMenge, NULL_CENT, type Cent } from '../finanz/geld.js';
import { mengeAusPostgresOderNull } from '../finanz/menge.js';

/** Die Hierarchieebenen aus `lv_art` (03-GEWERKE §3.3). */
export type LvArt = 'los' | 'titel' | 'untertitel' | 'position' | 'hinweistext';

/** `lv_positionsart` (03-GEWERKE §3.3) — die Werte stammen aus GAEB DA XML. */
export type LvPositionsart =
  | 'unbestimmt' | 'normalposition' | 'bedarfsposition' | 'alternativposition'
  | 'zuschlagsposition' | 'grundposition';

/**
 * Eine Zeile, wie sie aus der Datenbank kommt.
 *
 * `einheitspreisCent` ist `null`, wenn der Aufrufer `bau.preis_lesen` nicht
 * hält — die Spalte ist per Spalten-GRANT nicht lesbar (K-05, §1.9), also
 * fehlt sie im Ergebnis, statt maskiert zu werden. Die Summenfunktion sagt
 * dann „unvollständig" und behauptet keine Null.
 */
export interface LvZeile {
  readonly id: string;
  readonly elternId: string | null;
  readonly oz: string;
  readonly ebene: number;
  readonly art: LvArt;
  readonly positionsart: LvPositionsart;
  readonly kurztext: string;
  readonly einheit: string | null;
  /** `numeric(12,3)` in der Form, die Postgres liefert: `"25.000"`. */
  readonly mengeVertrag: string | null;
  readonly einheitspreisCent: bigint | null;
  /** APR-03: gesetzt, wenn die Zeile maschinell extrahiert wurde. */
  readonly konfidenz: string | null;
  readonly geprueftAm: string | null;
}

/** Ein Knoten des OZ-Baums, mit seiner Summe. */
export interface LvKnoten {
  readonly zeile: LvZeile;
  readonly kinder: readonly LvKnoten[];
  /** Σ dieses Teilbaums, in Cent — die Summe der gerundeten Positionsbeträge. */
  readonly summeCent: Cent;
  /**
   * Wahr, sobald irgendeine Position des Teilbaums keinen lesbaren Preis oder
   * keine Menge hat. Eine Summe ohne diese Marke behauptete Vollständigkeit,
   * die sie nicht hat.
   */
  readonly unvollstaendig: boolean;
  /** Positionen, die nach O-155 NICHT eingerechnet sind. */
  readonly ausgenommen: number;
}

/**
 * Wie breit eine Zahl im Sortierpfad aufgefüllt wird.
 *
 * Sechs Stellen, und dieselbe Zahl steht in `bau.setze_lv_pfad()` (0071).
 * GAEB-Ordnungszahlmasken sind in der Praxis zwei- bis vierstellig je Stufe;
 * sechs lässt Luft, ohne den Pfad unlesbar zu machen. Sie ist eine
 * TECHNISCHE Festlegung: eine Position mit mehr als 999.999 in einer Stufe
 * gibt es nicht, und gäbe es sie, sortierte sie hinter allem anderen — was
 * auffällt, statt still falsch zu sein.
 */
export const OZ_BREITE = 6;

/**
 * `"1.2.10"` → `"000001.000002.000010"`.
 *
 * Buchstabenzusätze bleiben erhalten und stehen HINTER der aufgefüllten Zahl
 * („0030.A" → `000030.a`), weil sie in der Praxis Unterteilungen derselben
 * Position sind: `0030` kommt vor `0030.A`. Grossbuchstaben werden für den
 * Vergleich kleingeschrieben, damit „30.A" und „30.a" nicht zwei Ordnungen
 * ergeben — die ANZEIGE bleibt davon unberührt, sie zeigt `oz` wörtlich.
 */
export function ozSortierSchluessel(oz: string): string {
  return oz
    .trim()
    .split('.')
    .map((segment) => {
      const treffer = /^(\d*)(.*)$/u.exec(segment);
      const ziffern = treffer?.[1] ?? '';
      const rest = treffer?.[2] ?? '';
      return `${ziffern.padStart(OZ_BREITE, '0')}${rest.toLowerCase()}`;
    })
    .join('.');
}

/**
 * Die Ordnung des Leistungsverzeichnisses.
 *
 * Verglichen wird der Sortierschlüssel, nicht die OZ: `1.2.10` gehört HINTER
 * `1.2.9`, und ein Textvergleich auf `oz` stellte es davor.
 */
export function vergleicheOz(a: string, b: string): number {
  const links = ozSortierSchluessel(a);
  const rechts = ozSortierSchluessel(b);
  if (links < rechts) return -1;
  if (links > rechts) return 1;
  return 0;
}

/**
 * Der Betrag einer Position: Menge × Einheitspreis, **einmal** gerundet.
 *
 * Die Rundung selbst steckt in `multipliziereMitMenge` (halbe Einheit auf,
 * `finanz/geld.ts`) und ist dort benannt — K-16 verlangt, dass die Regel dort
 * steht, wo gerundet wird. Ob eine Abrechnung tatsächlich je Position rundet
 * oder erst je Titel, ist eine kaufmännische Entscheidung:
 * // TODO(client, O-04): Wird je Position gerundet oder erst auf der
 * Titelsumme, und mit welcher Regel (kaufmaennisch, ab-, aufrunden)?
 * Bis zur Antwort rundet die Anwendung JE POSITION — nur so stimmen Σ je
 * Titel, Σ je Los und die LV-Summe auf den Cent überein.
 */
export function positionsBetragCent(
  mengeVertrag: string | null,
  einheitspreisCent: bigint | null,
): Cent | null {
  if (mengeVertrag === null || einheitspreisCent === null) return null;
  return multipliziereMitMenge(cent(einheitspreisCent), mengeAusPostgresOderNull(mengeVertrag));
}

/**
 * Zählt diese Position in die Auftragssumme?
 *
 * **Bedarfs- und Alternativpositionen zählen NICHT** — sie sind angeboten,
 * aber nicht beauftragt, und sie in eine Summe zu nehmen hiesse, dem Kunden
 * einen Auftragswert zu nennen, den er nie erteilt hat. Das ist die
 * ausdrückliche Vorgabe von 03-GEWERKE §3.3, solange O-155 offen ist.
 * // TODO(client, O-155): Welche Positionsarten kommen vor, und wie geht jede
 * in die Angebots- bzw. Auftragssumme ein?
 */
export function zaehltInSumme(zeile: LvZeile): boolean {
  if (zeile.art !== 'position') return false;
  return zeile.positionsart !== 'bedarfsposition' && zeile.positionsart !== 'alternativposition';
}

/**
 * Baut aus den flachen Zeilen den OZ-Baum — in LV-Ordnung, mit Summen.
 *
 * Zeilen ohne auffindbaren Elternteil hängen an der Wurzel, statt zu
 * verschwinden: ein Teilbaum, den ein Filter halbiert hat, darf seine
 * Positionen nicht verlieren, sonst fehlt Geld in der Summe und niemand sieht,
 * dass etwas fehlt.
 */
export function baueOzBaum(zeilen: readonly LvZeile[]): readonly LvKnoten[] {
  const kinderVon = new Map<string, LvZeile[]>();
  const vorhanden = new Set(zeilen.map((z) => z.id));
  const wurzeln: LvZeile[] = [];

  for (const zeile of zeilen) {
    if (zeile.elternId === null || !vorhanden.has(zeile.elternId)) {
      wurzeln.push(zeile);
      continue;
    }
    const liste = kinderVon.get(zeile.elternId);
    if (liste === undefined) kinderVon.set(zeile.elternId, [zeile]);
    else liste.push(zeile);
  }

  const baue = (zeile: LvZeile): LvKnoten => {
    const kinder = (kinderVon.get(zeile.id) ?? [])
      .sort((a, b) => vergleicheOz(a.oz, b.oz))
      .map(baue);

    const eigen = zaehltInSumme(zeile)
      ? positionsBetragCent(zeile.mengeVertrag, zeile.einheitspreisCent)
      : NULL_CENT;

    const summeCent = addiere(
      eigen ?? NULL_CENT,
      ...kinder.map((k) => k.summeCent),
    );
    return {
      zeile,
      kinder,
      summeCent,
      unvollstaendig: eigen === null || kinder.some((k) => k.unvollstaendig),
      ausgenommen:
        (zeile.art === 'position' && !zaehltInSumme(zeile) ? 1 : 0)
        + kinder.reduce((s, k) => s + k.ausgenommen, 0),
    };
  };

  return wurzeln.sort((a, b) => vergleicheOz(a.oz, b.oz)).map(baue);
}

/** Die Gesamtsumme des Verzeichnisses — Σ über die Wurzeln. */
export function lvSummeCent(baum: readonly LvKnoten[]): Cent {
  return addiere(...baum.map((k) => k.summeCent));
}

/** Der Baum flach, in LV-Ordnung — die Reihenfolge, in der die Tabelle rendert. */
export function flachInOrdnung(baum: readonly LvKnoten[]): readonly LvKnoten[] {
  const raus: LvKnoten[] = [];
  const gehe = (knoten: LvKnoten): void => {
    raus.push(knoten);
    for (const kind of knoten.kinder) gehe(kind);
  };
  for (const knoten of baum) gehe(knoten);
  return raus;
}

/**
 * APR-03/K-10: eine maschinell extrahierte, ungeprüfte Zeile darf keine
 * abrechenbare Menge tragen.
 *
 * Die harte Kante steht als Ausloeser in `0072` (`bau.pruefe_lv_geprueft()`);
 * diese Funktion ist die LESBARE Fassung derselben Bedingung, damit die
 * Oberfläche die Zeile mit der Pille „Unbestätigter Wert" zeigen kann, statt
 * den Menschen erst beim Speichern in einen Datenbankfehler laufen zu lassen.
 */
export function istUngeprueftMaschinell(zeile: LvZeile): boolean {
  return zeile.konfidenz !== null && zeile.geprueftAm === null;
}

/* ---------------------------------------------------------------------------
 * Lesen
 * ------------------------------------------------------------------------ */

export interface ProjektZeile {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly kunde: string;
  readonly art: string;
  readonly status: string;
  readonly vertragsgrundlage: string;
  readonly soll_ende_lokal: string | null;
  readonly lv_anzahl: number;
  readonly aufmass_anzahl: number;
}

/** Die Bauprojekte des Mandanten — die juengste Frist zuerst. */
export async function listeProjekte(
  kontext: LeseKontext,
): Promise<readonly ProjektZeile[]> {
  return kontext.abfrage<ProjektZeile>(
    `select p.id, p.nummer, p.bezeichnung, k.name as kunde,
            p.art::text as art, p.status::text as status,
            p.vertragsgrundlage::text as vertragsgrundlage,
            to_char(p.soll_ende, 'DD.MM.YYYY') as soll_ende_lokal,
            (select count(*) from leistungsverzeichnis lv
              where lv.projekt_id = p.id and lv.archiviert_am is null)::int as lv_anzahl,
            (select count(*) from aufmass a
              where a.projekt_id = p.id and a.storniert_am is null)::int as aufmass_anzahl
       from projekt p
       join kunde k on k.id = p.kunde_id and k.mandant_id = p.mandant_id
      where p.archiviert_am is null
      order by p.soll_ende nulls last, p.nummer`,
  );
}

export async function findeProjekt(
  kontext: LeseKontext, id: string,
): Promise<ProjektZeile | null> {
  const [zeile] = await kontext.abfrage<ProjektZeile>(
    `select p.id, p.nummer, p.bezeichnung, k.name as kunde,
            p.art::text as art, p.status::text as status,
            p.vertragsgrundlage::text as vertragsgrundlage,
            to_char(p.soll_ende, 'DD.MM.YYYY') as soll_ende_lokal,
            0 as lv_anzahl, 0 as aufmass_anzahl
       from projekt p
       join kunde k on k.id = p.kunde_id and k.mandant_id = p.mandant_id
      where p.id = $1`,
    [id],
  );
  return zeile ?? null;
}

export interface LvKopfZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly art: string;
  readonly fassung: number;
  readonly positionen: number;
}

export async function listeVerzeichnisse(
  kontext: LeseKontext, projektId: string,
): Promise<readonly LvKopfZeile[]> {
  return kontext.abfrage<LvKopfZeile>(
    `select lv.id, lv.bezeichnung, lv.art::text as art, lv.fassung,
            (select count(*) from lv_position p
              where p.leistungsverzeichnis_id = lv.id and p.archiviert_am is null)::int
              as positionen
       from leistungsverzeichnis lv
      where lv.projekt_id = $1 and lv.archiviert_am is null
      order by lv.art, lv.fassung desc`,
    [projektId],
  );
}

/**
 * Die Zeilen eines Verzeichnisses — **in der Ordnung der Datenbank**.
 *
 * `order by sortier_pfad` und nicht `order by oz`: der Sortierpfad ist die
 * normierte Fassung, in der `1.2.10` hinter `1.2.9` steht. Der Baum wird
 * anschliessend in TypeScript gebaut, weil die Anzeige ohnehin gruppiert —
 * aber die Reihenfolge kommt fertig aus der Abfrage, damit beide Ordnungen
 * dieselbe sind.
 *
 * **Der Einheitspreis kommt durch `app.lv_preis_lesen`, nicht aus der Spalte.**
 * Die Spalte ist fuer `cse_app` nicht lesbar (K-05, §1.9); ein `select l.*`
 * scheiterte hier mit einem Rechtefehler. Wer `bau.preis_lesen` nicht haelt,
 * bekommt NULL — und die Summenfunktion sagt „unvollstaendig" statt „0 €".
 */
export async function ladeLvPositionen(
  kontext: LeseKontext, leistungsverzeichnisId: string,
): Promise<readonly LvZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; eltern_id: string | null; oz: string; ebene: number; art: LvArt;
    positionsart: LvPositionsart; kurztext: string; einheit: string | null;
    menge_vertrag: string | null; einheitspreis_cent: string | null;
    konfidenz: string | null; geprueft_am: string | null;
  }>(
    `select l.id, l.eltern_id, l.oz, l.ebene, l.art::text as art,
            l.positionsart::text as positionsart, l.kurztext, l.einheit,
            l.menge_vertrag::text as menge_vertrag,
            app.lv_preis_lesen(l.id)::text as einheitspreis_cent,
            l.konfidenz::text as konfidenz,
            to_char(l.geprueft_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as geprueft_am
       from lv_position l
      where l.leistungsverzeichnis_id = $1 and l.archiviert_am is null
      order by l.sortier_pfad`,
    [leistungsverzeichnisId],
  );

  return zeilen.map((z) => ({
    id: z.id,
    elternId: z.eltern_id,
    oz: z.oz,
    ebene: z.ebene,
    art: z.art,
    positionsart: z.positionsart,
    kurztext: z.kurztext,
    einheit: z.einheit,
    mengeVertrag: z.menge_vertrag,
    // `bigint` kommt als Text aus dem Treiber — und geht als `bigint` weiter,
    // nie als `number`: ab 2^53 verlöre er Cent (Invariante 1).
    einheitspreisCent: z.einheitspreis_cent === null ? null : BigInt(z.einheitspreis_cent),
    konfidenz: z.konfidenz,
    geprueftAm: z.geprueft_am,
  }));
}

/** Die LV-Positionen als Auswahl fuer die Aufmasserfassung — ohne Preise. */
export interface LvAuswahlZeile {
  readonly id: string;
  readonly oz: string;
  readonly kurztext: string;
  readonly einheit: string | null;
  readonly ungeprueft: boolean;
}

export async function ladeLvAuswahl(
  kontext: LeseKontext, projektId: string,
): Promise<readonly LvAuswahlZeile[]> {
  return kontext.abfrage<LvAuswahlZeile>(
    `select l.id, l.oz, l.kurztext, l.einheit,
            (l.konfidenz is not null and l.geprueft_am is null) as ungeprueft
       from lv_position l
      where l.projekt_id = $1 and l.art = 'position' and l.archiviert_am is null
      order by l.sortier_pfad`,
    [projektId],
  );
}
