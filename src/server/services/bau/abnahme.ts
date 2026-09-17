/**
 * Die Abnahme nach § 12 VOB/B (BAU-01, OPS-11, LEG-01, 03-GEWERKE §7.2/§7.3).
 *
 * **Der teuerste Zeitpunkt eines Bauvertrags.** Mit der Abnahme schlagen drei
 * Dinge gleichzeitig um — die Gefahr geht ueber (§ 12 Abs. 6), die
 * Gewaehrleistungsfrist beginnt (§ 13 Abs. 4), die Schlussrechnung wird
 * faellig (§ 16 Abs. 3) — und EINER erlischt: nach **§ 11 Abs. 4 VOB/B**
 * verfaellt die Vertragsstrafe, wenn sie bei der Abnahme nicht vorbehalten
 * wird. Deshalb zeichnet dieser Dienst den Vorbehalt AUCH DANN auf, wenn es
 * keinen gab: „nicht vorbehalten" ist eine Tatsache mit Rechtsfolge und nicht
 * eine fehlende Angabe.
 *
 * Vier Dinge tut der Dienst, und keines nebenbei:
 *
 *  1. **Er friert ein, was protokolliert wird.** Der Schnappschuss haelt Kopf,
 *     Vorbehalte, Teilnehmer und Maengelliste so fest, wie sie auf dem
 *     Bildschirm standen, und siegelt sie mit SHA-256 — dieselbe Bauart wie
 *     beim Aufmass (§10.4, K-12). Frisch gejointe Zeilen zeigten im Streit die
 *     heutigen Daten neben einer Unterschrift von damals.
 *  2. **Er laesst die Verweigerung als Datensatz zu.** Eine verweigerte
 *     Abnahme ist keine fehlende Abnahme: § 12 Abs. 3 verlangt die Angabe der
 *     Maengel, auf die sich die Verweigerung stuetzt, und ohne diese Zeile
 *     gaebe es sie nirgends.
 *  3. **Er rechnet die Gewaehrleistungsfrist NICHT.** Siehe
 *     {@link GewaehrleistungsFrist}.
 *  4. **Er korrigiert durch Storno mit Ersatz.** Das Protokoll ist ab dem
 *     Einfuegen unveraenderlich (Ausloeser `kern.abnahme_einfrieren` in 0211);
 *     eine Aenderung ist ein neues Protokoll, das auf das alte zeigt.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  schnappschussHash, type SchnappschussWert,
} from '../reinigung/schnappschuss.js';

/** `bau_abnahme_art` (0210) — § 12 VOB/B. */
export type AbnahmeArt = 'foermlich' | 'fiktiv' | 'konkludent' | 'teilabnahme';

export const ABNAHME_ARTEN: readonly AbnahmeArt[] =
  ['foermlich', 'fiktiv', 'konkludent', 'teilabnahme'];

export function istAbnahmeArt(wert: unknown): wert is AbnahmeArt {
  return typeof wert === 'string' && (ABNAHME_ARTEN as readonly string[]).includes(wert);
}

/** Die Fassung des Schnappschusses — sie steht IM Schnappschuss (§10.4). */
export const ABNAHME_SCHNAPPSCHUSS_FASSUNG = 'abnahme-protokoll-v1' as const;

export class AbnahmeFehler extends Error {
  readonly status: number;
  constructor(
    readonly grund:
      | 'nicht_gefunden' | 'ungueltige_eingabe' | 'schon_abgenommen' | 'gesperrt'
      | 'teil_ohne_umfang' | 'vorbehalt_ohne_wortlaut' | 'verweigerung_ohne_grund',
    nachricht: string,
    status = 409,
  ) {
    super(nachricht);
    this.name = 'AbnahmeFehler';
    this.status = status;
  }
}

/* ---------------------------------------------------------------------------
 * 1. Die Gewaehrleistungsfrist — hinter einer Schnittstelle, nicht geraten
 * ------------------------------------------------------------------------ */

export interface FristEingabe {
  readonly vertragsgrundlage: string;
  /** Berliner Kalendertag `JJJJ-MM-TT` (K-11). */
  readonly abnahmeAm: string;
  readonly art: AbnahmeArt;
}

/**
 * Wie lange die Gewaehrleistung laeuft — **eine offene Frage, kein Rechenweg**.
 *
 * VOB/B § 13 Abs. 4 nennt vier Jahre fuer Bauwerke, § 634a BGB fuenf. Welches
 * Regime gilt, haengt am Vertrag; ob BGB-Bauvertraege ueberhaupt vorkommen,
 * ist nicht entschieden — und ab welchem Ereignis die Frist bei einer
 * fiktiven oder konkludenten Abnahme laeuft, erst recht nicht.
 *
 * **Ein geratenes Datum ist hier der teuerste mögliche Fehler.** Eine Frist,
 * die ein Jahr zu kurz notiert ist, laesst einen Anspruch verjaehren, und das
 * faellt genau dann auf, wenn er geltend gemacht werden soll — Jahre spaeter,
 * unwiderruflich. Deshalb liefert die Platzhalterfassung NULL, die Spalte
 * `projekt.gewaehrleistung_bis` bleibt leer, und die Oberflaeche schreibt
 * „offen (O-154)" statt eines Datums.
 * // TODO(client, O-154): Kommen BGB-Bauvertraege vor oder ausschliesslich
 * VOB/B, welche Gewaehrleistungsfrist gilt je Regime, und ab welchem Ereignis
 * laeuft sie (Abnahme, Teilabnahme, Ingebrauchnahme)?
 */
export interface GewaehrleistungsFrist {
  /** `JJJJ-MM-TT` — oder `null`, solange die Regel offen ist. */
  fristEnde(eingabe: FristEingabe): string | null;
}

/**
 * Die eingesetzte Fassung: **sie rechnet nichts**.
 *
 * Sie ist austauschbar (das ist der Zweck der Schnittstelle), und sie ist
 * ausdruecklich als Platzhalter bezeichnet, damit niemand sie fuer eine
 * Umsetzung haelt.
 */
export const FRIST_OFFEN: GewaehrleistungsFrist = {
  fristEnde: () => null,
};

/**
 * Was die Oberflaeche anstelle eines Datums schreibt.
 *
 * Der Satz steht hier und nicht in der Seite: zwei Formulierungen fuer
 * dieselbe offene Frage waeren zwei Aussagen ueber dieselbe Frist.
 */
export const FRIST_OFFEN_TEXT =
  'Die Gewährleistungsfrist wird gespeichert, nicht berechnet: ob vier Jahre '
  + '(§ 13 Abs. 4 VOB/B) oder fünf (§ 634a BGB) gelten und ab welchem Ereignis '
  + 'sie läuft, ist offen (O-154).';

export const ABNAHME_ART_TEXT: Readonly<Record<AbnahmeArt, string>> = {
  foermlich: 'förmliche Abnahme (§ 12 Abs. 4 VOB/B)',
  fiktiv: 'fiktive Abnahme durch Fristablauf (§ 12 Abs. 5 VOB/B)',
  konkludent: 'konkludente Abnahme durch schlüssiges Verhalten',
  teilabnahme: 'Teilabnahme (§ 12 Abs. 2 VOB/B)',
};

/* ---------------------------------------------------------------------------
 * 2. Der Schnappschuss (§10.4)
 * ------------------------------------------------------------------------ */

export interface SchnappschussMangel {
  readonly reihenfolge: string;
  readonly beschreibung: string;
  readonly oz: string | null;
  /** `JJJJ-MM-TT` oder `null` — als TEXT, nie als Datumsobjekt. */
  readonly fristAm: string | null;
}

export interface AbnahmeKopfAnzeige {
  readonly projekt: string;
  readonly projektNummer: string;
  readonly kunde: string;
  readonly art: AbnahmeArt;
  /** Wie angezeigt: `TT.MM.JJJJ`. */
  readonly abnahmeAm: string;
  readonly leistungsumfang: string | null;
  readonly abgenommen: boolean;
  readonly verweigerungGrund: string | null;
  readonly vorbehaltVertragsstrafe: boolean;
  readonly vorbehaltMaengel: boolean;
  readonly vorbehaltText: string | null;
  readonly teilnehmer: readonly string[];
}

/**
 * Was protokolliert wurde — eingefroren, nicht verknuepft.
 *
 * **Die Vorbehalte stehen als `"ja"`/`"nein"` im Schnappschuss und nicht als
 * `true`/`false`-Auslassung.** `kanonischesJson` erlaubt `boolean`; die
 * ausgeschriebene Form ist trotzdem die richtige, weil ein Protokoll GELESEN
 * wird: „vorbehalt_vertragsstrafe: nein" ist der Satz, an dem im Streit
 * haengt, ob der Anspruch verfallen ist, und er soll im Beweis dastehen und
 * nicht aus einem fehlenden Feld erschlossen werden muessen.
 */
export function baueAbnahmeSchnappschuss(
  kopf: AbnahmeKopfAnzeige,
  maengel: readonly SchnappschussMangel[],
  anzeigeZeitzone = 'Europe/Berlin',
): SchnappschussWert {
  return {
    fassung: ABNAHME_SCHNAPPSCHUSS_FASSUNG,
    anzeigeZeitzone,
    kopf: {
      projekt: kopf.projekt,
      projektNummer: kopf.projektNummer,
      kunde: kopf.kunde,
      art: kopf.art,
      abnahmeAm: kopf.abnahmeAm,
      leistungsumfang: kopf.leistungsumfang,
      abgenommen: kopf.abgenommen ? 'ja' : 'nein',
      verweigerungGrund: kopf.verweigerungGrund,
      vorbehaltVertragsstrafe: kopf.vorbehaltVertragsstrafe ? 'ja' : 'nein',
      vorbehaltMaengel: kopf.vorbehaltMaengel ? 'ja' : 'nein',
      vorbehaltText: kopf.vorbehaltText,
      teilnehmer: [...kopf.teilnehmer],
    },
    maengel: maengel.map((m) => ({
      reihenfolge: m.reihenfolge,
      beschreibung: m.beschreibung,
      oz: m.oz,
      fristAm: m.fristAm,
    })),
  };
}

export function abnahmeSchnappschussHash(wert: SchnappschussWert): string {
  return schnappschussHash(wert);
}

/* ---------------------------------------------------------------------------
 * 3. Lesen
 * ------------------------------------------------------------------------ */

export interface AbnahmeZeile {
  readonly id: string;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  readonly kunde: string;
  readonly art: AbnahmeArt;
  readonly abnahme_am: string;
  readonly abnahme_am_lokal: string;
  readonly protokolliert_lokal: string;
  readonly leistungsumfang: string | null;
  readonly abgenommen: boolean;
  readonly verweigerung_grund: string | null;
  readonly vorbehalt_vertragsstrafe: boolean;
  readonly vorbehalt_maengel: boolean;
  readonly vorbehalt_text: string | null;
  readonly teilnehmer: readonly string[];
  readonly snapshot_hash: string;
  readonly dokument_id: string | null;
  readonly storniert_lokal: string | null;
  readonly storno_grund: string | null;
  readonly ersetzt_durch_id: string | null;
  readonly maengel_gesamt: number;
  readonly maengel_offen: number;
  readonly protokolliert_von: string | null;
}

const ABNAHME_SPALTEN = `
  a.id, a.projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
  k.name as kunde, a.art::text as art,
  to_char(a.abnahme_am, 'YYYY-MM-DD') as abnahme_am,
  to_char(a.abnahme_am, 'DD.MM.YYYY') as abnahme_am_lokal,
  to_char(a.protokolliert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as protokolliert_lokal,
  a.leistungsumfang, a.abgenommen, a.verweigerung_grund,
  a.vorbehalt_vertragsstrafe, a.vorbehalt_maengel, a.vorbehalt_text,
  /*
   * teilnehmer ist ein JSON-Array; hier wird es zu einem Textarray
   * ausgepackt, damit die Anzeige keine JSON-Form kennen muss. Ein Element
   * ohne Namensfeld faellt NICHT weg, sondern erscheint als sein eigener
   * Text — ein Teilnehmer, der aus der Anzeige verschwindet, waere die
   * schlimmere Variante (§ 12 Abs. 4 Nr. 1 VOB/B).
   */
  coalesce((select array_agg(coalesce(t->>'name', t::text) order by ord)
              from jsonb_array_elements(a.teilnehmer) with ordinality e(t, ord)),
           '{}') as teilnehmer,
  a.snapshot_hash, a.dokument_id,
  to_char(a.storniert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
    as storniert_lokal,
  a.storno_grund, a.ersetzt_durch_id,
  (select count(*) from abnahme_mangel m where m.abnahme_id = a.id)::int as maengel_gesamt,
  (select count(*) from abnahme_mangel m
    where m.abnahme_id = a.id and m.behoben_am is null)::int as maengel_offen,
  b.name as protokolliert_von
  from abnahme a
  join projekt p on p.id = a.projekt_id and p.mandant_id = a.mandant_id
  join kunde   k on k.id = a.kunde_id and k.mandant_id = a.mandant_id
  left join benutzer b on b.id = a.erstellt_von`;

/**
 * Die Abnahmen eines Projekts — **mit den stornierten**.
 *
 * Das ist keine Nachlaessigkeit, sondern die Korrekturspur: das falsche
 * Protokoll steht neben seinem Ersatz, und beide tragen den Verweis
 * aufeinander. Eine Liste, die nur das gueltige zeigt, ist ein geglaettetes
 * Protokoll — und ein geglaettetes beweist nichts (LEG-01).
 */
export async function listeAbnahmen(
  kontext: LeseKontext,
  filter: { readonly projektId?: string | null } = {},
): Promise<readonly AbnahmeZeile[]> {
  return kontext.abfrage<AbnahmeZeile>(
    `select ${ABNAHME_SPALTEN}
      where ($1::uuid is null or a.projekt_id = $1::uuid)
      order by a.abnahme_am desc, a.protokolliert_am desc`,
    [filter.projektId ?? null],
  );
}

export async function findeAbnahme(
  kontext: LeseKontext, id: string,
): Promise<AbnahmeZeile | null> {
  const [zeile] = await kontext.abfrage<AbnahmeZeile>(
    `select ${ABNAHME_SPALTEN} where a.id = $1`,
    [id],
  );
  return zeile ?? null;
}

export interface MangelZeile {
  readonly id: string;
  readonly abnahme_id: string;
  readonly reihenfolge: number;
  readonly beschreibung: string;
  readonly frist_am: string | null;
  readonly frist_lokal: string | null;
  readonly behoben_lokal: string | null;
  readonly ueberfaellig: boolean;
  readonly oz: string | null;
  readonly lv_position_id: string | null;
  readonly reklamation_id: string | null;
  readonly reklamation_nummer: string | null;
}

/**
 * Die Maengel eines Protokolls — die Frist gegen den BERLINER Kalendertag.
 *
 * `app.berlin_heute()` und nicht `current_date`: der Kalendertag ist der
 * Berliner (K-11), und ein Node-Prozess in UTC saehe um 00:30 Berliner Zeit
 * noch den Vortag. Eine Frist, die dadurch einen Tag zu spaet als
 * ueberfaellig gilt, ist eine Frist, die man verpasst.
 */
export async function ladeMaengel(
  kontext: LeseKontext, abnahmeId: string,
): Promise<readonly MangelZeile[]> {
  return kontext.abfrage<MangelZeile>(
    `select m.id, m.abnahme_id, m.reihenfolge, m.beschreibung,
            to_char(m.frist_am, 'YYYY-MM-DD') as frist_am,
            to_char(m.frist_am, 'DD.MM.YYYY') as frist_lokal,
            to_char(m.behoben_am, 'DD.MM.YYYY') as behoben_lokal,
            (m.behoben_am is null and m.frist_am is not null
             and m.frist_am < app.berlin_heute()) as ueberfaellig,
            l.oz, m.lv_position_id, m.reklamation_id, r.nummer as reklamation_nummer
       from abnahme_mangel m
       left join lv_position l on l.id = m.lv_position_id and l.mandant_id = m.mandant_id
       left join reklamation r on r.id = m.reklamation_id and r.mandant_id = m.mandant_id
      where m.abnahme_id = $1
      order by m.reihenfolge`,
    [abnahmeId],
  );
}

/* ---------------------------------------------------------------------------
 * 4. Protokollieren
 * ------------------------------------------------------------------------ */

export interface MangelEingabe {
  readonly beschreibung: string;
  /** `JJJJ-MM-TT` oder `null` — die im Protokoll festgehaltene Frist. */
  readonly fristAm: string | null;
  readonly lvPositionId: string | null;
}

export interface AbnahmeEingabe {
  readonly projektId: string;
  readonly art: AbnahmeArt;
  /** Berliner Kalendertag `JJJJ-MM-TT` (K-11) — NICHT die Serverzeit. */
  readonly abnahmeAm: string;
  readonly leistungsumfang: string | null;
  readonly abgenommen: boolean;
  readonly verweigerungGrund: string | null;
  readonly vorbehaltVertragsstrafe: boolean;
  readonly vorbehaltMaengel: boolean;
  readonly vorbehaltText: string | null;
  readonly teilnehmer: readonly string[];
  readonly maengel: readonly MangelEingabe[];
}

const KALENDERTAG = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Prueft die Eingabe, so wie die Datenbank sie ein zweites Mal pruefen wird.
 *
 * **Die harte Kante sind die Bedingungen in 0211**; diese Pruefung ist die
 * LESBARE erste Linie, damit der Mensch einen Satz sieht und keinen
 * Datenbankfehler mit Transaktionsabbruch. Beide muessen dasselbe sagen — ein
 * Dienst, der weniger prueft als die Tabelle, verschiebt die Meldung nur; ein
 * Dienst, der MEHR prueft, erfindet eine Regel.
 */
export function pruefeAbnahme(eingabe: AbnahmeEingabe): void {
  if (!KALENDERTAG.test(eingabe.abnahmeAm)) {
    throw new AbnahmeFehler(
      'ungueltige_eingabe',
      'Die Abnahme trägt einen Kalendertag in der Form JJJJ-MM-TT.',
      422,
    );
  }
  if (eingabe.art === 'teilabnahme'
      && (eingabe.leistungsumfang === null || eingabe.leistungsumfang.trim() === '')) {
    throw new AbnahmeFehler(
      'teil_ohne_umfang',
      'Eine Teilabnahme braucht den Leistungsumfang: § 12 Abs. 2 VOB/B nimmt „in sich '
      + 'abgeschlossene Teile der Leistung" ab, und welcher Teil das war, steht im '
      + 'Protokoll oder nirgends.',
      422,
    );
  }
  if (!eingabe.abgenommen
      && (eingabe.verweigerungGrund === null || eingabe.verweigerungGrund.trim() === '')) {
    throw new AbnahmeFehler(
      'verweigerung_ohne_grund',
      'Eine verweigerte Abnahme braucht ihren Grund (§ 12 Abs. 3 VOB/B) — sie ist ein '
      + 'Datensatz und nicht ein fehlender.',
      422,
    );
  }
  if ((eingabe.vorbehaltVertragsstrafe || eingabe.vorbehaltMaengel)
      && (eingabe.vorbehaltText === null || eingabe.vorbehaltText.trim() === '')) {
    throw new AbnahmeFehler(
      'vorbehalt_ohne_wortlaut',
      'Ein Vorbehalt braucht seinen Wortlaut: § 11 Abs. 4 VOB/B verlangt die Erklärung, '
      + 'nicht ein Häkchen.',
      422,
    );
  }
  for (const m of eingabe.maengel) {
    if (m.beschreibung.trim() === '') {
      throw new AbnahmeFehler(
        'ungueltige_eingabe', 'Ein Mangel ohne Beschreibung ist keiner.', 422,
      );
    }
    if (m.fristAm !== null && !KALENDERTAG.test(m.fristAm)) {
      throw new AbnahmeFehler(
        'ungueltige_eingabe',
        'Die Mängelfrist trägt einen Kalendertag in der Form JJJJ-MM-TT.',
        422,
      );
    }
  }
}

/**
 * Protokolliert die Abnahme — Kopf und Maengel in EINER Transaktion.
 *
 * **Die Reihenfolge ist zwingend und nicht Geschmack.** Der Schnappschuss
 * enthaelt die Maengelliste, also muss er VOR dem Einfuegen aus der EINGABE
 * gebaut werden — die Zeilen gibt es zu diesem Zeitpunkt noch nicht. Und weil
 * `snapshot_hash` `not null` ist, ist der Kopf ab dem Einfuegen gesiegelt: die
 * Maengel gehen danach dazu, aber NUR in derselben Transaktion (der Ausloeser
 * `kern.abnahme_mangel_erben` in 0211 weist alles andere ab). Waere es
 * anders, gaebe es zwei Maengellisten zu einem Protokoll — die in der Tabelle
 * und die im Siegel.
 *
 * `kunde_id` wird mitgeschickt und vom Ausloeser VERWORFEN: er leitet sie vom
 * Projekt ab (§1.8). Der Wert hier ist also bedeutungslos und steht nur, weil
 * die Spalte `not null` ist — die Kundenzugehoerigkeit ist keine Eingabe.
 *
 * **Die Gewaehrleistungsfrist wird nicht geschrieben.** `frist.fristEnde()`
 * wird gerufen, damit die Schnittstelle einen Aufrufer hat und beim Austausch
 * der Fassung genau EINE Stelle zu aendern ist; solange sie NULL liefert,
 * bleibt `projekt.gewaehrleistung_bis` unberuehrt.
 */
export async function protokolliereAbnahme(
  kontext: SchreibKontext,
  eingabe: AbnahmeEingabe,
  frist: GewaehrleistungsFrist = FRIST_OFFEN,
): Promise<{ readonly id: string; readonly hash: string; readonly fristEnde: string | null }> {
  pruefeAbnahme(eingabe);

  const [projekt] = await kontext.abfrage<{
    id: string; nummer: string; bezeichnung: string; kunde: string;
    vertragsgrundlage: string; abnahme_lokal: string;
  }>(
    `select p.id, p.nummer, p.bezeichnung, k.name as kunde,
            p.vertragsgrundlage::text as vertragsgrundlage,
            to_char($2::date, 'DD.MM.YYYY') as abnahme_lokal
       from projekt p
       join kunde k on k.id = p.kunde_id and k.mandant_id = p.mandant_id
      where p.id = $1 and p.mandant_id = $3`,
    [eingabe.projektId, eingabe.abnahmeAm, kontext.aktiverMandantId],
  );
  if (projekt === undefined) {
    // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
    throw new AbnahmeFehler('nicht_gefunden', 'Projekt nicht gefunden.', 404);
  }

  /** Die OZ der bezogenen Positionen — sie steht IM Siegel, nicht als Kennung. */
  const ozJePosition = new Map<string, string>();
  const bezogene = eingabe.maengel
    .map((m) => m.lvPositionId)
    .filter((x): x is string => x !== null);
  if (bezogene.length > 0) {
    const zeilen = await kontext.abfrage<{ id: string; oz: string }>(
      `select l.id, l.oz from lv_position l
        where l.id = any($1::uuid[]) and l.projekt_id = $2 and l.archiviert_am is null`,
      [bezogene, eingabe.projektId],
    );
    for (const z of zeilen) ozJePosition.set(z.id, z.oz);
    if (zeilen.length !== new Set(bezogene).size) {
      throw new AbnahmeFehler(
        'ungueltige_eingabe',
        'Mindestens ein Mangel zeigt auf eine LV-Position, die nicht zu diesem Projekt '
        + 'gehört.',
        422,
      );
    }
  }

  const maengel = eingabe.maengel.map((m, index) => ({
    ...m,
    reihenfolge: index + 1,
    oz: m.lvPositionId === null ? null : ozJePosition.get(m.lvPositionId) ?? null,
  }));

  const schnappschuss = baueAbnahmeSchnappschuss(
    {
      projekt: projekt.bezeichnung,
      projektNummer: projekt.nummer,
      kunde: projekt.kunde,
      art: eingabe.art,
      abnahmeAm: projekt.abnahme_lokal,
      leistungsumfang: eingabe.leistungsumfang,
      abgenommen: eingabe.abgenommen,
      verweigerungGrund: eingabe.verweigerungGrund,
      vorbehaltVertragsstrafe: eingabe.vorbehaltVertragsstrafe,
      vorbehaltMaengel: eingabe.vorbehaltMaengel,
      vorbehaltText: eingabe.vorbehaltText,
      teilnehmer: eingabe.teilnehmer,
    },
    maengel.map((m) => ({
      reihenfolge: String(m.reihenfolge),
      beschreibung: m.beschreibung,
      oz: m.oz,
      fristAm: m.fristAm,
    })),
  );
  const hash = abnahmeSchnappschussHash(schnappschuss);

  const [kopf] = await kontext.schreibe<{ id: string }>(
    `insert into abnahme (mandant_id, projekt_id, kunde_id, art, abnahme_am,
                          leistungsumfang, vorbehalt_vertragsstrafe, vorbehalt_maengel,
                          vorbehalt_text, abgenommen, verweigerung_grund, teilnehmer,
                          snapshot, snapshot_hash, erstellt_von, erstellt_von_person_id)
     values ($1, $2, $1, $3::bau_abnahme_art, $4::date, $5, $6, $7, $8, $9, $10,
             $11::text::jsonb, $12::text::jsonb, $13,
             app.aktueller_benutzer(), app.aktuelle_person())
     returning id`,
    [
      kontext.aktiverMandantId, eingabe.projektId, eingabe.art, eingabe.abnahmeAm,
      eingabe.leistungsumfang, eingabe.vorbehaltVertragsstrafe, eingabe.vorbehaltMaengel,
      eingabe.vorbehaltText, eingabe.abgenommen, eingabe.verweigerungGrund,
      /**
       * `::text::jsonb` und nicht `::jsonb`: der Treiber typisiert den
       * Parameter nach dem Cast, und bei `jsonb` serialisiert er die bereits
       * fertige Zeichenkette EIN ZWEITES MAL — in der Spalte stuende dann eine
       * JSON-Zeichenkette statt eines Objekts. Dieselbe Falle wie beim
       * Aufmass-Schnappschuss (0072, `gegenzeichne`).
       */
      JSON.stringify(eingabe.teilnehmer.map((name) => ({ name }))),
      JSON.stringify(schnappschuss), hash,
    ],
  );
  if (kopf === undefined) {
    throw new AbnahmeFehler('nicht_gefunden', 'Die Abnahme liess sich nicht anlegen.', 404);
  }

  for (const m of maengel) {
    await kontext.schreibe(
      `insert into abnahme_mangel (mandant_id, abnahme_id, projekt_id, kunde_id,
                                   lv_position_id, reihenfolge, beschreibung, frist_am,
                                   erstellt_von, erstellt_von_person_id)
       values ($1, $2, $3, $1, $4::uuid, $5, $6, $7::date,
               app.aktueller_benutzer(), app.aktuelle_person())`,
      [
        kontext.aktiverMandantId, kopf.id, eingabe.projektId, m.lvPositionId,
        m.reihenfolge, m.beschreibung, m.fristAm,
      ],
    );
  }

  return {
    id: kopf.id,
    hash,
    fristEnde: frist.fristEnde({
      vertragsgrundlage: projekt.vertragsgrundlage,
      abnahmeAm: eingabe.abnahmeAm,
      art: eingabe.art,
    }),
  };
}

/**
 * Ein Mangel ist behoben — die eine Angabe, die sich nach dem Protokoll noch
 * bewegt (neben dem Verweis auf eine Reklamation).
 *
 * Das Datum ist ein BERLINER Kalendertag und kommt vom Aufrufer: wann ein
 * Mangel beseitigt wurde, weiss der Mensch auf der Baustelle und nicht der
 * Server. Die SERVERZEIT steht daneben im Auditblock (`geaendert_am`), und
 * damit ist nachvollziehbar, wann die Meldung einging — das ist die Trennung
 * aus Invariante 5, angewandt auf eine Tatsache, die nicht im System
 * entstanden ist.
 */
export async function meldeMangelBehoben(
  kontext: SchreibKontext,
  eingabe: { readonly mangelId: string; readonly behobenAm: string },
): Promise<boolean> {
  if (!KALENDERTAG.test(eingabe.behobenAm)) {
    throw new AbnahmeFehler(
      'ungueltige_eingabe',
      'Das Behebungsdatum trägt einen Kalendertag in der Form JJJJ-MM-TT.',
      422,
    );
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update abnahme_mangel
        set behoben_am = $2::date, geaendert_von = app.aktueller_benutzer()
      where id = $1 and mandant_id = $3 and behoben_am is null
      returning id`,
    [eingabe.mangelId, eingabe.behobenAm, kontext.aktiverMandantId],
  );
  return zeilen.length > 0;
}

/**
 * Storniert ein Protokoll — der EINZIGE Weg zur Korrektur (§1.3, LEG-01).
 *
 * Es wird nichts geloescht und nichts geaendert: das falsche Protokoll bleibt
 * stehen, traegt seinen Grund und zeigt auf sein Ersatzprotokoll. Ein
 * Abnahmeprotokoll, das man haette ueberschreiben koennen, waere als Beweis
 * wertlos — und genau deshalb weist `kern.abnahme_einfrieren` jede andere
 * Aenderung ab.
 */
export async function storniereAbnahme(
  kontext: SchreibKontext,
  eingabe: {
    readonly id: string;
    readonly grund: string;
    readonly ersetztDurchId?: string | null;
  },
): Promise<boolean> {
  if (eingabe.grund.trim() === '') {
    throw new AbnahmeFehler(
      'ungueltige_eingabe',
      'Ein Storno braucht seinen Grund — ohne ihn ist die Korrekturspur eine Lücke.',
      422,
    );
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update abnahme
        set storniert_am = now(), storniert_von = app.aktueller_benutzer(),
            storno_grund = $2, ersetzt_durch_id = $3::uuid,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and mandant_id = $4 and storniert_am is null
      returning id`,
    [eingabe.id, eingabe.grund, eingabe.ersetztDurchId ?? null, kontext.aktiverMandantId],
  );
  return zeilen.length > 0;
}
