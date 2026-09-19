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
 * Der Dienst LIEST und rechnet. Die eine Ausnahme ist
 * {@link bestaetigeLvPosition}: die Bestaetigung einer maschinell gelesenen
 * Position (APR-03) ist der Vorgang, der das Leistungsverzeichnis
 * abrechenbar macht, und sie gehoert zu dieser Datei und nicht in eine
 * zweite.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
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
 * Zählt diese POSITIONSART in die Auftragssumme?
 *
 * **Bedarfs- und Alternativpositionen zählen NICHT** — sie sind angeboten,
 * aber nicht beauftragt, und sie in eine Summe zu nehmen hiesse, dem Kunden
 * einen Auftragswert zu nennen, den er nie erteilt hat. Das ist die
 * ausdrückliche Vorgabe von 03-GEWERKE §3.3, solange O-155 offen ist.
 *
 * **Die Art steht getrennt von der Zeile, weil zwei Seiten sie brauchen.**
 * Der LV-Baum hat einen ganzen `LvZeile`-Satz, die Positionsdetailseite hat
 * nur die Spalte — und sie hatte deshalb ihre EIGENE Kopie dieser Regel im
 * Seitenkörper. Zwei Kopien einer offenen Frage beantworten sie irgendwann
 * verschieden, und das fällt erst auf, wenn zwei Seiten zwei Auftragssummen
 * über denselben Vertrag zeigen.
 * // TODO(client, O-155): Welche Positionsarten kommen vor, und wie geht jede
 * in die Angebots- bzw. Auftragssumme ein?
 */
export function zaehltPositionsartInSumme(positionsart: string): boolean {
  return positionsart !== 'bedarfsposition' && positionsart !== 'alternativposition';
}

/**
 * Zählt diese Position in die Auftragssumme?
 *
 * `art !== 'position'` zuerst: ein Los oder ein Titel trägt seine Summe aus
 * den Kindern, und ein Hinweistext trägt gar keine.
 */
export function zaehltInSumme(zeile: LvZeile): boolean {
  if (zeile.art !== 'position') return false;
  return zaehltPositionsartInSumme(zeile.positionsart);
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
 * Die harte Kante steht als Ausloeser in `0072`
 * (`kern.aufmass_vorlage_pruefen()`, Bedingung `l.konfidenz is not null and
 * l.geprueft_am is null`); diese Funktion ist die LESBARE Fassung derselben
 * Bedingung, damit die
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
  /** Welches Verzeichnis die Position traegt — Hauptauftrag oder ein Nachtrag. */
  readonly verzeichnis: string;
  readonly verzeichnis_art: string;
  readonly fassung: number;
}

/** Die Ueberschrift einer Gruppe in der Auswahl — „Hauptauftrag · LV Rohbau, Fassung 2". */
export const LV_ART_TEXT: Readonly<Record<string, string>> = {
  hauptauftrag: 'Hauptauftrag',
  nachtrag: 'Nachtrag',
  ausschreibung: 'Ausschreibung',
  eigenkalkulation: 'Eigenkalkulation',
};

/**
 * Die Positionen, auf die heute gebucht werden darf — **je Verzeichnis nur die
 * juengste lebende Fassung**.
 *
 * **Der Fehler, den dieser Filter verhindert.** Der LV-Import legt eine NEUE
 * Fassung an und laesst die alte stehen (sie ist der Beleg dessen, was
 * urspruenglich vereinbart wurde, § 2 Abs. 6 VOB/B). Ohne
 * Verzeichnisbezug stand danach JEDE OZ zweimal in dieser Auswahl — Fassung 1
 * und Fassung 2, angezeigt als `{oz} · {kurztext}` und damit nicht
 * unterscheidbar. Wer die falsche traf, buchte die Menge auf eine ueberholte
 * Position: `findeLvPosition` summiert je `lv_position_id`, die Position der
 * aktuellen Fassung blieb auf 0, die Mehrmengenwarnung nach § 2 Abs. 3 VOB/B
 * (BAU-05) feuerte nie, und die Menge hing am Einheitspreis der alten
 * Fassung. Das ist kein Anzeigefehler, sondern ein falsches Ergebnis in der
 * Schlussrechnung.
 *
 * **Gruppiert wird nach (`art`, `nachtrag_id`) und nicht nur nach `art`:** je
 * Nachtrag gibt es ein eigenes Verzeichnis mit eigener Fassungszaehlung
 * (`lv_fassung_uk`), und der Hauptauftrag ist die Gruppe mit
 * `nachtrag_id is null`. Die Anzeige nennt Verzeichnis und Fassung je Zeile,
 * damit zwei gleiche OZ aus Hauptauftrag und Nachtrag auseinanderzuhalten
 * sind.
 */
export async function ladeLvAuswahl(
  kontext: LeseKontext, projektId: string,
): Promise<readonly LvAuswahlZeile[]> {
  return kontext.abfrage<LvAuswahlZeile>(
    `with aktuell as (
       select distinct on (lv.art, coalesce(lv.nachtrag_id, $2::uuid))
              lv.id, lv.art::text as art, lv.bezeichnung, lv.fassung
         from leistungsverzeichnis lv
        where lv.projekt_id = $1 and lv.archiviert_am is null
        order by lv.art, coalesce(lv.nachtrag_id, $2::uuid), lv.fassung desc
     )
     select l.id, l.oz, l.kurztext, l.einheit,
            (l.konfidenz is not null and l.geprueft_am is null) as ungeprueft,
            a.bezeichnung as verzeichnis, a.art as verzeichnis_art, a.fassung
       from lv_position l
       join aktuell a on a.id = l.leistungsverzeichnis_id
      where l.projekt_id = $1 and l.art = 'position' and l.archiviert_am is null
      order by a.art, a.bezeichnung, a.fassung desc, l.sortier_pfad`,
    [projektId, '00000000-0000-0000-0000-000000000000'],
  );
}

/** Eine Gruppe der Auswahl — ein Verzeichnis in einer Fassung. */
export interface LvAuswahlGruppe {
  readonly schluessel: string;
  readonly beschriftung: string;
  readonly zeilen: readonly LvAuswahlZeile[];
}

/**
 * Die Auswahl in Gruppen, so wie ein `optgroup` sie braucht.
 *
 * Die Gruppierung steht HIER und nicht im Koerper der beiden Seiten, die sie
 * brauchen (Aufmasserfassung und Maengelliste der Abnahme): zwei Fassungen
 * derselben Einteilung liefen beim ersten Sonderfall auseinander, und dann
 * zeigten zwei Seiten dieselbe Position unter zwei Ueberschriften.
 */
export function gruppiereLvAuswahl(
  zeilen: readonly LvAuswahlZeile[],
): readonly LvAuswahlGruppe[] {
  const gruppen: LvAuswahlGruppe[] = [];
  for (const zeile of zeilen) {
    const schluessel = `${zeile.verzeichnis_art}|${zeile.verzeichnis}|${String(zeile.fassung)}`;
    const letzte = gruppen[gruppen.length - 1];
    if (letzte !== undefined && letzte.schluessel === schluessel) {
      (letzte.zeilen as LvAuswahlZeile[]).push(zeile);
      continue;
    }
    gruppen.push({
      schluessel,
      beschriftung:
        `${LV_ART_TEXT[zeile.verzeichnis_art] ?? zeile.verzeichnis_art} · ${zeile.verzeichnis}`
        + ` (Fassung ${String(zeile.fassung)})`,
      zeilen: [zeile],
    });
  }
  return gruppen;
}

/* ---------------------------------------------------------------------------
 * Eine Position im Detail (BAU-01, BAU-05, Seitenkarte §5.9)
 * ------------------------------------------------------------------------ */

/** Der Projektkopf, den `findeProjekt` fuer die Detailseite mitbringen muss. */
export interface ProjektDetailZeile extends ProjektZeile {
  readonly objekt: string | null;
  readonly verantwortlich: string | null;
  readonly soll_beginn_lokal: string | null;
  readonly ist_beginn_lokal: string | null;
  readonly ist_ende_lokal: string | null;
  readonly gewaehrleistung_bis_lokal: string | null;
  /** Cent als Text — nie `number` (Invariante 1). NULL ohne `bau.preis_lesen`. */
  readonly auftragssumme_cent: string | null;
  /** Basispunkte (250 = 2,50 %). NULL ohne `bau.preis_lesen`. */
  readonly sicherheitseinbehalt_bp: number | null;
  readonly darf_preis_lesen: boolean;
  readonly darf_kalkulation_lesen: boolean;
  readonly nachtraege_offen: number;
  readonly nachtraege_gesamt: number;
  readonly behinderungen_laufend: number;
  readonly bautage: number;
  readonly abnahmen: number;
  readonly abgenommen_lokal: string | null;
}

/**
 * Der Projektkopf mit allem, was die Detailseite zeigt — in EINER Abfrage.
 *
 * **Die Auftragssumme kommt aus `app.projekt_summe_lesen` und nicht aus der
 * Spalte** (K-05, §1.9, 0089/0213). `select p.auftragssumme_netto_cent`
 * scheiterte hier HART mit einem Rechtefehler: 0089 hat das Tabellenrecht
 * ganz entzogen und eine erschoepfende Spaltenliste ohne die beiden
 * Kaufmannsspalten erteilt — es wird nichts maskiert, es fehlt. Die
 * Leserfunktion prueft `bau.preis_lesen`, protokolliert den Zugriff und gibt
 * ohne das Recht KEINE Zeile zurueck; `left join lateral … on true` macht
 * daraus NULL, und die Seite schreibt den Satz statt „0 €".
 *
 * **`kalkulation.lesen` wird VORHER gefragt, nicht ausprobiert.**
 * `app.projekt_kennzahlen` wirft `insufficient_privilege`, wenn das Recht
 * fehlt — und eine Ausnahme innerhalb der EINEN gebundenen Transaktion der
 * Seite bricht die ganze Seite ab, statt einen Hinweis zu zeigen. Dasselbe
 * Muster steht in `angebote/[id]/page.tsx`.
 */
export async function findeProjektDetail(
  kontext: LeseKontext, id: string,
): Promise<ProjektDetailZeile | null> {
  const [zeile] = await kontext.abfrage<ProjektDetailZeile>(
    `select p.id, p.nummer, p.bezeichnung, k.name as kunde,
            p.art::text as art, p.status::text as status,
            p.vertragsgrundlage::text as vertragsgrundlage,
            to_char(p.soll_ende, 'DD.MM.YYYY') as soll_ende_lokal,
            to_char(p.soll_beginn, 'DD.MM.YYYY') as soll_beginn_lokal,
            to_char(p.ist_beginn, 'DD.MM.YYYY') as ist_beginn_lokal,
            to_char(p.ist_ende, 'DD.MM.YYYY') as ist_ende_lokal,
            to_char(p.gewaehrleistung_bis, 'DD.MM.YYYY') as gewaehrleistung_bis_lokal,
            o.bezeichnung as objekt,
            b.name as verantwortlich,
            s.auftragssumme_netto_cent::text as auftragssumme_cent,
            s.sicherheitseinbehalt_bp,
            (select app.hat_recht('bau.preis_lesen', app.aktiver_mandant()))
              as darf_preis_lesen,
            (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant()))
              as darf_kalkulation_lesen,
            (select count(*) from leistungsverzeichnis lv
              where lv.projekt_id = p.id and lv.archiviert_am is null)::int as lv_anzahl,
            (select count(*) from aufmass a
              where a.projekt_id = p.id and a.storniert_am is null)::int as aufmass_anzahl,
            (select count(*) from nachtrag n
              where n.projekt_id = p.id and n.storniert_am is null
                and n.status = 'angemeldet' and n.eingereicht_am is null)::int
              as nachtraege_offen,
            (select count(*) from nachtrag n
              where n.projekt_id = p.id and n.storniert_am is null)::int as nachtraege_gesamt,
            (select count(*) from behinderung bh
              where bh.projekt_id = p.id and bh.storniert_am is null
                and bh.wegfall_angezeigt_am is null
                and bh.status in ('freigegeben','angezeigt'))::int as behinderungen_laufend,
            (select count(*) from bautagebuch bt
              where bt.projekt_id = p.id and bt.storniert_am is null)::int as bautage,
            (select count(*) from abnahme ab
              where ab.projekt_id = p.id and ab.storniert_am is null)::int as abnahmen,
            (select to_char(ab.abnahme_am, 'DD.MM.YYYY') from abnahme ab
              where ab.projekt_id = p.id and ab.storniert_am is null
                and ab.abgenommen and ab.art <> 'teilabnahme'
              order by ab.abnahme_am limit 1) as abgenommen_lokal
       from projekt p
       join kunde k on k.id = p.kunde_id and k.mandant_id = p.mandant_id
       left join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
       left join benutzer b on b.id = p.verantwortlich_benutzer_id
       left join lateral app.projekt_summe_lesen(p.id) s on true
      where p.id = $1`,
    [id],
  );
  return zeile ?? null;
}

/**
 * Die Fundstelle einer maschinell gelesenen Position — `quelle_bereich` in
 * lesbar.
 *
 * **Warum die Spalte nicht einfach roh dasteht.** `quelle_bereich` ist
 * `jsonb` und haelt laut 03-GEWERKE §7.5 „the table/region on that page";
 * WELCHE Form das ist, legt der erste extrahierende Leser fest — heute gibt
 * es keinen (O-41), also ist die Spalte in jeder Zeile NULL. Diese Funktion
 * bereitet genau das vor: sie erkennt die naheliegende Rechteckform und gibt
 * sonst den Wert kompakt zurueck, statt ihn wegzulassen. Eine mitgelesene
 * Spalte ohne Leser ist die naechste, die jemand fuer vorhanden haelt.
 *
 * Sie RECHNET nichts und interpretiert nichts: sie zeigt an, was dasteht.
 */
export function fundstelleText(bereich: unknown): string | null {
  if (bereich === null || bereich === undefined) return null;
  if (typeof bereich === 'string') return bereich === '' ? null : bereich;
  if (typeof bereich !== 'object') return String(bereich);
  const feld = (name: string): number | null => {
    const wert = (bereich as Record<string, unknown>)[name];
    return typeof wert === 'number' ? wert : null;
  };
  const x = feld('x');
  const y = feld('y');
  const breite = feld('breite') ?? feld('w');
  const hoehe = feld('hoehe') ?? feld('h');
  if (x !== null && y !== null && breite !== null && hoehe !== null) {
    return `x ${String(x)}, y ${String(y)} · ${String(breite)} × ${String(hoehe)}`;
  }
  try {
    return JSON.stringify(bereich);
  } catch {
    return null;
  }
}

/** Eine LV-Position mit ihrer Herkunft — der Kopf der Positionsseite. */
export interface LvPositionDetail {
  readonly id: string;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly leistungsverzeichnis_id: string;
  readonly lv_bezeichnung: string;
  readonly lv_art: string;
  readonly lv_fassung: number;
  readonly eltern_id: string | null;
  readonly oz: string;
  readonly ebene: number;
  readonly art: LvArt;
  readonly positionsart: LvPositionsart;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly einheit: string | null;
  readonly menge_vertrag: string | null;
  readonly einheitspreis_cent: string | null;
  readonly gaeb_dp: string | null;
  readonly quelle_seite: number | null;
  readonly quelle_bereich: unknown;
  readonly konfidenz: string | null;
  readonly geprueft_lokal: string | null;
  readonly geprueft_von_name: string | null;
  readonly darf_preis_lesen: boolean;
  /** Σ der aufgemessenen Menge, `numeric(12,3)` als Text — nie Gleitkomma. */
  readonly menge_aufgemessen: string;
  readonly aufmass_blaetter: number;
}

/**
 * Eine Position — mit Preis nur ueber `app.lv_preis_lesen` (K-05, §1.9).
 *
 * **`steuer_kennzeichen` steht NICHT in dieser Abfrage, und das ist keine
 * Auslassung.** 0071 entzieht `cse_app` das `select` auf `lv_position` und
 * erteilt eine erschoepfende Spaltenliste OHNE `einheitspreis_cent` UND ohne
 * `steuer_kennzeichen` („OMITTED", Zeile 689) — die Kraft auf der Baustelle
 * braucht die Kalkulation des Auftrags nicht. Ein Spalten-GRANT maskiert
 * nicht, er verweigert: die Spalte hier zu lesen liess die GANZE Abfrage mit
 * „permission denied for table lv_position" scheitern, und zwar fuer jeden
 * Benutzer, auch fuer den mit `bau.preis_lesen`. Genau das ist passiert, und
 * nur eine Probe gegen echtes Postgres hat es gezeigt.
 *
 * Fuer den Preis gibt es den gepruegten Leser; fuer das Steuerkennzeichen
 * gibt es keinen, und einen zu bauen hiesse zu entscheiden, wer es sehen
 * darf.
 * // TODO(client, O-632): Soll das Steuerkennzeichen der LV-Position (§ 13b
 * UStG — Bauleistungen sind der Regelfall des Wechsels der Steuerschuld) in
 * der Oberflaeche erscheinen, und hinter welchem Recht — `bau.preis_lesen`
 * wie der Einheitspreis, oder einem eigenen? Bis zur Antwort zeigt die
 * Positionsseite die Spalte nicht und sagt das.
 *
 * **Die aufgemessene Menge wird in Postgres summiert**, nicht im
 * Node-Prozess: `aufmass_zeile.menge` ist `numeric(12,3)`, und eine Summe
 * ueber JavaScript-Zahlen verlor bei jeder dritten Zeile eine
 * Tausendstelstelle — auf eine Schlussrechnung gerechnet ein Betrag, den
 * niemand nachvollziehen kann.
 *
 * Gezaehlt werden NUR lebende Blaetter: ein storniertes Blatt ist kein
 * Aufmass, und seine Menge in einer Gegenueberstellung mit der Vertragsmenge
 * behauptete eine Uebererfuellung, die nie stattgefunden hat.
 */
export async function findeLvPosition(
  kontext: LeseKontext, id: string,
): Promise<LvPositionDetail | null> {
  const [zeile] = await kontext.abfrage<LvPositionDetail>(
    `select l.id, l.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
            l.leistungsverzeichnis_id, lv.bezeichnung as lv_bezeichnung,
            lv.art::text as lv_art, lv.fassung as lv_fassung,
            l.eltern_id, l.oz, l.ebene, l.art::text as art,
            l.positionsart::text as positionsart, l.kurztext, l.langtext, l.einheit,
            l.menge_vertrag::text as menge_vertrag,
            app.lv_preis_lesen(l.id)::text as einheitspreis_cent,
            l.gaeb_dp, l.quelle_seite, l.quelle_bereich,
            l.konfidenz::text as konfidenz,
            to_char(l.geprueft_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as geprueft_lokal,
            b.name as geprueft_von_name,
            (select app.hat_recht('bau.preis_lesen', app.aktiver_mandant()))
              as darf_preis_lesen,
            coalesce((select sum(z.menge) from aufmass_zeile z
                       join aufmass a on a.id = z.aufmass_id and a.mandant_id = z.mandant_id
                      where z.lv_position_id = l.id and a.storniert_am is null), 0)::text
              as menge_aufgemessen,
            (select count(distinct z.aufmass_id) from aufmass_zeile z
               join aufmass a on a.id = z.aufmass_id and a.mandant_id = z.mandant_id
              where z.lv_position_id = l.id and a.storniert_am is null)::int
              as aufmass_blaetter
       from lv_position l
       join leistungsverzeichnis lv on lv.id = l.leistungsverzeichnis_id
                                   and lv.mandant_id = l.mandant_id
       join projekt p on p.id = l.projekt_id and p.mandant_id = l.mandant_id
       left join benutzer b on b.id = l.geprueft_von
      where l.id = $1 and l.archiviert_am is null`,
    [id],
  );
  return zeile ?? null;
}

export interface LvAhne {
  readonly id: string;
  readonly oz: string;
  readonly art: LvArt;
  readonly kurztext: string;
  readonly ebene: number;
}

/**
 * Der Weg von der Wurzel bis zu dieser Position — Los, Titel, Untertitel.
 *
 * **Rekursiv ueber `eltern_id` und nicht ueber `pfad`.** Der materialisierte
 * Pfad aus 0071 setzt die volle OZ je Stufe zusammen (`1.2` + `1.2.9` =
 * `1.2.1.2.9`); ihn zu zerlegen hiesse, die Zusammensetzungsregel eines
 * Ausloesers in einer Abfrage nachzubauen. Laufen die beiden Fassungen
 * auseinander, zeigt die Brotkrume einen Titel, unter dem die Position nicht
 * steht — und niemand merkt es.
 */
export async function ladeLvPfad(
  kontext: LeseKontext, id: string,
): Promise<readonly LvAhne[]> {
  return kontext.abfrage<LvAhne>(
    `with recursive kette as (
       select l.id, l.eltern_id, l.oz, l.art::text as art, l.kurztext, l.ebene
         from lv_position l where l.id = $1
       union all
       select e.id, e.eltern_id, e.oz, e.art::text as art, e.kurztext, e.ebene
         from lv_position e
         join kette kt on kt.eltern_id = e.id
     )
     select id, oz, art, kurztext, ebene from kette
      where id <> $1
      order by ebene`,
    [id],
  );
}

/** Ein Aufmassblatt, das auf diese Position bucht (BAU-02, BAU-05). */
export interface AufmassAufPosition {
  readonly zeile_id: string;
  readonly aufmass_id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly messdatum_lokal: string;
  readonly reihenfolge: number;
  readonly rechenansatz: string;
  readonly menge: string;
  readonly einheit: string;
  readonly ergebnis_skaliert: string;
  readonly storniert: boolean;
}

export async function ladeAufmasseJePosition(
  kontext: LeseKontext, lvPositionId: string,
): Promise<readonly AufmassAufPosition[]> {
  return kontext.abfrage<AufmassAufPosition>(
    `select z.id as zeile_id, z.aufmass_id, a.nummer, a.bezeichnung,
            a.status::text as status,
            to_char(a.messdatum, 'DD.MM.YYYY') as messdatum_lokal,
            z.reihenfolge, z.rechenansatz, z.menge::text as menge, z.einheit,
            z.ergebnis_skaliert::text as ergebnis_skaliert,
            (a.storniert_am is not null) as storniert
       from aufmass_zeile z
       join aufmass a on a.id = z.aufmass_id and a.mandant_id = z.mandant_id
      where z.lv_position_id = $1
      order by a.messdatum desc, a.nummer desc, z.reihenfolge`,
    [lvPositionId],
  );
}

/** Ein Nachtrag mit Bezug auf diese Position (BAU-04). */
export interface NachtragAufPosition {
  readonly id: string;
  readonly nummer: string;
  readonly titel: string;
  readonly status: string;
  readonly projekt_id: string;
  /** Woran der Bezug haengt — die Oberflaeche sagt es, statt ihn zu behaupten. */
  readonly bezug: 'nachtrags_lv' | 'auftragszeile' | 'aufmasszeile';
}

/**
 * Die Nachtraege, die auf diese Position zeigen — auf DREI Wegen, und der
 * Weg steht dabei.
 *
 * `nachtrag` traegt KEINE `lv_position_id`, und das ist richtig: ein Nachtrag
 * ist ein Anspruch und keine Zeile eines Verzeichnisses. Verbunden sind beide
 * deshalb ueber
 *
 *  1. das **Nachtrags-LV** (`leistungsverzeichnis.nachtrag_id`) — die
 *     Position steht IM Nachtrag,
 *  2. die **Auftragszeile** (`auftrag_leistung_id` auf beiden Seiten) — der
 *     Nachtrag betrifft dieselbe beauftragte Leistung,
 *  3. die **Aufmasszeile** (`aufmass_zeile.nachtrag_id`) — eine gemessene
 *     Menge auf dieser Position ist einem Nachtrag zugeordnet (BAU-05).
 *
 * Den Weg zu verschweigen und alle drei als „gehoert dazu" zu zeigen, waere
 * die Behauptung einer Verbindung, die es in dieser Form nicht gibt — und im
 * Streit ueber § 2 Abs. 6 VOB/B ist genau die Art des Bezugs die Frage.
 */
export async function ladeNachtraegeJePosition(
  kontext: LeseKontext, lvPositionId: string,
): Promise<readonly NachtragAufPosition[]> {
  return kontext.abfrage<NachtragAufPosition>(
    /*
     * **Keine `n.*`, sondern sechs benannte Spalten** — und das ist keine
     * Stilfrage. 0080 entzieht `cse_app` das `select` auf `nachtrag` und
     * erteilt eine erschoepfende Spaltenliste OHNE `betrag_netto_cent` und
     * `beauftragter_betrag_netto_cent` („OMITTED", Zeile 387): der Betrag
     * eines Nachtrags ist Kalkulation. Ein `select n.*` in den drei
     * Vereinigungszweigen expandierte auf ALLE Spalten und liess die Abfrage
     * mit „permission denied for table nachtrag" scheitern — fuer jeden
     * Benutzer. Eine Probe gegen echtes Postgres hat es gezeigt; im Typsystem
     * ist `n.*` unsichtbar.
     */
    `with pos as (
       select l.id, l.projekt_id, l.auftrag_leistung_id, l.leistungsverzeichnis_id
         from lv_position l where l.id = $1
     )
     select distinct on (n.id, bezug) n.id, n.nummer, n.titel, n.status,
            n.projekt_id, bezug
       from (
         select n.id, n.nummer, n.titel, n.status::text as status, n.projekt_id,
                n.storniert_am, 'nachtrags_lv'::text as bezug
           from nachtrag n
           join leistungsverzeichnis lv on lv.nachtrag_id = n.id and lv.mandant_id = n.mandant_id
           join pos on pos.leistungsverzeichnis_id = lv.id

         union all

         select n.id, n.nummer, n.titel, n.status::text as status, n.projekt_id,
                n.storniert_am, 'auftragszeile'::text as bezug
           from nachtrag n
           join pos on pos.auftrag_leistung_id is not null
                   and n.auftrag_leistung_id = pos.auftrag_leistung_id
                   and n.projekt_id = pos.projekt_id

         union all

         select n.id, n.nummer, n.titel, n.status::text as status, n.projekt_id,
                n.storniert_am, 'aufmasszeile'::text as bezug
           from nachtrag n
           join aufmass_zeile z on z.nachtrag_id = n.id and z.mandant_id = n.mandant_id
           join pos on pos.id = z.lv_position_id
       ) n
      where n.storniert_am is null
      order by n.id, bezug, n.nummer`,
    [lvPositionId],
  );
}

/**
 * Eine maschinell gelesene Position BESTAETIGEN (APR-03, K-10).
 *
 * **Was daran haengt:** der Ausloeser `kern.aufmass_vorlage_pruefen()` (0072)
 * weist jede Vorlage eines Aufmasses ab, deren Zeilen auf eine
 * unbestaetigte, maschinell gelesene Position buchen — ein Preis, den ein Modell aus einem PDF gelesen hat, darf
 * keine abrechenbare Menge tragen, bevor ein benannter Mensch ihn bestaetigt
 * hat. Diese Funktion ist die einzige Stelle, an der dieser Mensch benannt
 * wird.
 *
 * **Der Name der Funktion ist wichtig, weil er nachschlagbar sein muss.** Hier
 * stand `bau.pruefe_lv_geprueft()` — so heisst sie in
 * `03-GEWERKE.md §7.5`, aber in keiner Migration und in keiner lebenden
 * Datenbank. Wer die genannte Sicherung nachlesen wollte, fand sie nicht.
 *
 * `geprueft_am` kommt von `now()` und nicht vom Aufrufer (Invariante 5), und
 * eine ZWEITE Bestaetigung wird abgewiesen: die erste ist die, die zaehlt,
 * und sie zu ueberschreiben verwischte, wer eigentlich geprueft hat.
 */
export async function bestaetigeLvPosition(
  kontext: SchreibKontext, id: string,
): Promise<{ readonly id: string; readonly oz: string } | null> {
  const [zeile] = await kontext.schreibe<{ id: string; oz: string }>(
    `update lv_position
        set geprueft_am = now(), geprueft_von = app.aktueller_benutzer()
      where id = $1 and mandant_id = $2 and archiviert_am is null
        and konfidenz is not null and geprueft_am is null
      returning id, oz`,
    [id, kontext.aktiverMandantId],
  );
  return zeile ?? null;
}
