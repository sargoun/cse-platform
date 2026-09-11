/**
 * Das Aufmass nach § 14 VOB/B (BAU-02, BAU-03, 03-GEWERKE §7.6 – §7.9).
 *
 * Der Dienst tut drei Dinge und keines davon nebenbei:
 *
 *  1. **Er rechnet die Menge SELBST.** Der Browser schickt den Rechenansatz
 *     als Text und keine Zahl — API-KARTE §C.15 (Review B18) ist darin
 *     ausdruecklich: eine vom Aufrufer gelieferte Menge waere eine erfundene
 *     Zahl auf dem Weg in eine Rechnung (Invariante 6). Gerechnet wird in
 *     `rechenansatz.ts`, gespeichert werden Formel UND Ergebnis.
 *  2. **Er laesst nichts vorlegen, was BAU-03 nicht erfuellt.** Ohne Messfoto
 *     kein Uebergang aus dem Entwurf, ohne Gegenzeichnung kein Festschreiben.
 *     Die harte Kante sind die Ausloeser in `0072`; die Pruefungen hier sind
 *     die LESBARE erste Linie, damit der Mensch einen Satz sieht und keinen
 *     Datenbankfehler.
 *  3. **Er friert ein, was unterschrieben wird.** Der Schnappschuss haelt die
 *     Zeilen so fest, wie sie auf dem Bildschirm standen — mit den
 *     Rechenansaetzen, denn genau die hat der Auftraggeber anerkannt (§10.4).
 *
 * Der Speicherweg der Fotos ist NICHT nachgebaut: `legeMediumAb` aus
 * `zeit/medien.ts` prueft Groesse, erkennt den Typ aus den Magic Bytes,
 * entfernt die Metadaten und legt in denselben privaten Bucket ab (TIM-10,
 * DOC-06). Ein zweiter Weg fuer dieselbe Art Beweisfoto waere ein zweiter Satz
 * Aufbewahrungsregeln.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  kanonischesJson, schnappschussHash, type SchnappschussWert,
} from '../reinigung/schnappschuss.js';
import {
  PARSER_VERSION, RechenansatzFehler, anzeigeAusSkaliert, berechneRechenansatz,
  type RechenansatzErgebnis,
} from './rechenansatz.js';

/** Die Fassung des Schnappschusses — sie steht IM Schnappschuss (§10.4). */
export const AUFMASS_SCHNAPPSCHUSS_FASSUNG = 'aufmass-schnappschuss-v1' as const;

export type AufmassStatus =
  | 'entwurf' | 'vorgelegt' | 'gegengezeichnet' | 'einseitig_festgestellt'
  | 'abgelehnt' | 'storniert';

export type Erhebungsart = 'gemeinsam' | 'einseitig';

/** Warum ein Blatt nicht weitergehen darf — typisiert, nie nur ein Text. */
export type VorlageHindernis =
  | 'kein_foto'
  | 'keine_zeile'
  | 'lv_ungeprueft'
  | 'nicht_entwurf'
  | 'keine_ankuendigung';

export class AufmassFehler extends Error {
  readonly status = 409 as const;
  constructor(readonly grund: VorlageHindernis | 'nicht_gefunden' | 'gesperrt', nachricht: string) {
    super(nachricht);
    this.name = 'AufmassFehler';
  }
}

/* ---------------------------------------------------------------------------
 * 1. Zeilen: Text hinein, Menge heraus
 * ------------------------------------------------------------------------ */

export interface ZeileEingabe {
  readonly bezeichnung: string;
  /** Woertlich, wie der Polier ihn geschrieben hat. Wird NICHT normiert. */
  readonly rechenansatz: string;
  readonly einheit: string;
  readonly lvPositionId: string | null;
  readonly ausserhalbLv: boolean;
  readonly uebermessungHinweis?: string | null;
  readonly bemerkung?: string | null;
}

export interface ZeileGerechnet extends ZeileEingabe {
  readonly reihenfolge: number;
  readonly ergebnis: RechenansatzErgebnis;
}

/** Ein Rechenansatz, der nicht aufgeht — MIT der Zeile, in der er steht. */
export class ZeilenFehler extends Error {
  readonly status = 422 as const;
  constructor(
    readonly reihenfolge: number,
    readonly grund: string,
    readonly offset: number,
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'ZeilenFehler';
  }
}

/**
 * Rechnet jede Zeile — und bricht bei der ersten ab, die nicht aufgeht.
 *
 * **Mit Zeilennummer und Zeichenoffset.** Ein „ungueltiger Rechenansatz" ohne
 * beides schickt jemanden, der zwoelf Zeilen aufgenommen hat, auf die Suche;
 * hier steht, welche Zeile und welches Zeichen.
 *
 * Eine Zeile haengt an einer LV-Position ODER ist ausdruecklich ausserhalb des
 * Leistungsverzeichnisses (BAU-05) — die Datenbank bestaetigt das ein zweites
 * Mal (`az_bezug`), aber eine Meldung aus dem Dienst ist lesbar.
 */
export function rechneZeilen(eingaben: readonly ZeileEingabe[]): readonly ZeileGerechnet[] {
  if (eingaben.length === 0) {
    throw new AufmassFehler('keine_zeile', 'Ein Aufmassblatt ohne Zeile misst nichts.');
  }
  return eingaben.map((zeile, index) => {
    if (zeile.lvPositionId === null && !zeile.ausserhalbLv) {
      throw new ZeilenFehler(
        index + 1, 'ohne_bezug', 0,
        'Die Zeile braucht eine LV-Position — oder die ausdrueckliche Angabe, '
        + 'dass sie ausserhalb des Leistungsverzeichnisses liegt (BAU-05).',
      );
    }
    try {
      return { ...zeile, reihenfolge: index + 1, ergebnis: berechneRechenansatz(zeile.rechenansatz) };
    } catch (fehler: unknown) {
      if (fehler instanceof RechenansatzFehler) {
        throw new ZeilenFehler(index + 1, fehler.grund, fehler.offset, fehler.message);
      }
      throw fehler;
    }
  });
}

/* ---------------------------------------------------------------------------
 * 2. BAU-03: die beiden Tore, lesbar
 * ------------------------------------------------------------------------ */

export interface VorlageStand {
  readonly status: AufmassStatus;
  readonly erhebungsart: Erhebungsart;
  readonly ankuendigungAm: string | null;
  readonly zeilen: number;
  /** Aufnahmen mit `zweck = 'nachweis'` — andere zaehlen fuer BAU-03 nicht. */
  readonly nachweisFotos: number;
  /** OZ der maschinell gelesenen, unbestaetigten LV-Positionen (APR-03, K-10). */
  readonly ungepruefteOz: readonly string[];
}

/**
 * Darf dieses Blatt aus dem Entwurf heraus?
 *
 * Gibt ALLE Hindernisse zurueck, nicht das erste: wer ein Foto nachreicht und
 * dann erfaehrt, dass ausserdem eine LV-Position ungeprueft ist, laeuft zweimal
 * auf die Baustelle.
 */
export function pruefeVorlage(stand: VorlageStand): readonly VorlageHindernis[] {
  const hindernisse: VorlageHindernis[] = [];
  if (stand.status !== 'entwurf') hindernisse.push('nicht_entwurf');
  if (stand.zeilen === 0) hindernisse.push('keine_zeile');
  // BAU-03: mindestens eine Aufnahme, und zwar eine als Nachweis gekennzeichnete.
  if (stand.nachweisFotos === 0) hindernisse.push('kein_foto');
  if (stand.ungepruefteOz.length > 0) hindernisse.push('lv_ungeprueft');
  /**
   * §14 Abs. 2 VOB/B: eine einseitige Feststellung setzt die Ankuendigung
   * voraus. Ohne sie bleibt das Blatt liegen, statt als festgestellt zu gelten.
   * // TODO(client, O-156): Unter welchen Voraussetzungen wird ein einseitiges
   * Aufmass abgerechnet — Ankuendigungsfrist, Teilnahmeaufforderung,
   * Widerspruchsfrist?
   */
  if (stand.erhebungsart === 'einseitig' && stand.ankuendigungAm === null) {
    hindernisse.push('keine_ankuendigung');
  }
  return hindernisse;
}

/** Der deutsche Satz zu jedem Hindernis — die Oberflaeche erfindet keinen. */
export const HINDERNIS_TEXT: Readonly<Record<VorlageHindernis, string>> = {
  kein_foto: 'Ohne Messfoto wird kein Aufmass vorgelegt (BAU-03).',
  keine_zeile: 'Das Blatt enthält keine Zeile.',
  lv_ungeprueft:
    'Mindestens eine LV-Position wurde maschinell gelesen und ist noch nicht bestätigt.',
  nicht_entwurf: 'Das Blatt ist kein Entwurf mehr.',
  keine_ankuendigung:
    'Ein einseitiges Aufmaß setzt die angekündigte Feststellung voraus (§ 14 Abs. 2 VOB/B).',
};

/* ---------------------------------------------------------------------------
 * 3. Der Schnappschuss (§10.4)
 * ------------------------------------------------------------------------ */

export interface SchnappschussZeile {
  readonly reihenfolge: string;
  readonly bezeichnung: string;
  readonly oz: string | null;
  /** Die Formel, woertlich — genau sie hat der Auftraggeber anerkannt. */
  readonly rechenansatz: string;
  /** Das Ergebnis in fester Skala, als Text. Nie eine Gleitkommazahl. */
  readonly ergebnisSkaliert: string;
  readonly menge: string;
  readonly einheit: string;
}

export interface AufmassKopfAnzeige {
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly projekt: string;
  readonly kunde: string;
  readonly bereich: string | null;
  readonly messdatum: string;
  readonly erhebungsart: Erhebungsart;
}

/**
 * Was unterschrieben wurde — eingefroren, nicht verknuepft.
 *
 * Die naheliegende Fassung — beim Anzeigen die Zeilen frisch joinen — zeigt
 * im Streitfall die HEUTIGEN Mengen neben einer Unterschrift von damals und
 * ist als Beweis wertlos (§10.4, K-12). Alle Zahlen stehen als TEXT im
 * Schnappschuss: `kanonischesJson` wirft bei einer `number`, und das ist die
 * Stelle, an der eine Menge sonst als Gleitkommazahl in den Beweis geriete.
 */
export function baueAufmassSchnappschuss(
  kopf: AufmassKopfAnzeige,
  zeilen: readonly SchnappschussZeile[],
  anzeigeZeitzone = 'Europe/Berlin',
): SchnappschussWert {
  return {
    fassung: AUFMASS_SCHNAPPSCHUSS_FASSUNG,
    parserVersion: PARSER_VERSION,
    anzeigeZeitzone,
    kopf: {
      nummer: kopf.nummer,
      bezeichnung: kopf.bezeichnung,
      projekt: kopf.projekt,
      kunde: kopf.kunde,
      bereich: kopf.bereich,
      messdatum: kopf.messdatum,
      erhebungsart: kopf.erhebungsart,
    },
    zeilen: zeilen.map((z) => ({
      reihenfolge: z.reihenfolge,
      bezeichnung: z.bezeichnung,
      oz: z.oz,
      rechenansatz: z.rechenansatz,
      ergebnisSkaliert: z.ergebnisSkaliert,
      menge: z.menge,
      einheit: z.einheit,
    })),
  };
}

export function aufmassSchnappschussHash(wert: SchnappschussWert): string {
  return schnappschussHash(wert);
}

/** Nur fuer Pruefzwecke: dieselbe Kanonisierung wie beim Unterschreiben. */
export function aufmassSchnappschussText(wert: SchnappschussWert): string {
  return kanonischesJson(wert);
}

/* ---------------------------------------------------------------------------
 * 4. Lesen und Schreiben
 * ------------------------------------------------------------------------ */

export interface AufmassZeileZeile {
  readonly id: string;
  readonly reihenfolge: number;
  readonly bezeichnung: string;
  readonly rechenansatz: string;
  readonly ergebnis_skaliert: string;
  readonly menge: string;
  readonly einheit: string;
  readonly oz: string | null;
  readonly lv_position_id: string | null;
  readonly ausserhalb_lv: boolean;
  readonly parser_version: string | null;
  readonly bemerkung: string | null;
}

export interface AufmassKopfZeile {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly bereich: string | null;
  readonly messdatum: string;
  readonly messdatum_lokal: string;
  readonly status: AufmassStatus;
  readonly erhebungsart: Erhebungsart;
  readonly ankuendigung_am: string | null;
  readonly gesperrt_lokal: string | null;
  readonly projekt_id: string;
  readonly projekt: string;
  readonly kunde: string;
  readonly zeilen: number;
  readonly fotos: number;
}

/**
 * Die Blaetter eines Projekts, in der Reihenfolge, in der die Bauleitung sie
 * sucht: das juengste Messdatum zuerst.
 *
 * **Jede Uhrzeit kommt fertig aus der Datenbank.** `to_char(... at time zone
 * 'Europe/Berlin')` rechnet in Postgres; der Node-Prozess rechnet keine Zone
 * um (Invariante 2, PHASE-5-STAND).
 */
export async function listeAufmasse(
  kontext: LeseKontext,
  filter: { readonly projektId?: string | null } = {},
): Promise<readonly AufmassKopfZeile[]> {
  return kontext.abfrage<AufmassKopfZeile>(
    `select a.id, a.nummer, a.bezeichnung, a.bereich,
            to_char(a.messdatum, 'YYYY-MM-DD') as messdatum,
            to_char(a.messdatum, 'DD.MM.YYYY') as messdatum_lokal,
            a.status::text as status, a.erhebungsart::text as erhebungsart,
            to_char(a.ankuendigung_am, 'DD.MM.YYYY') as ankuendigung_am,
            to_char(a.gesperrt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as gesperrt_lokal,
            a.projekt_id, p.bezeichnung as projekt, k.name as kunde,
            (select count(*) from aufmass_zeile z where z.aufmass_id = a.id)::int as zeilen,
            (select count(*) from aufmass_foto f
              where f.aufmass_id = a.id and f.zweck = 'nachweis')::int as fotos
       from aufmass a
       join projekt p on p.id = a.projekt_id and p.mandant_id = a.mandant_id
       join kunde   k on k.id = a.kunde_id and k.mandant_id = a.mandant_id
      where a.storniert_am is null
        and ($1::uuid is null or a.projekt_id = $1::uuid)
      order by a.messdatum desc, a.nummer desc`,
    [filter.projektId ?? null],
  );
}

export async function findeAufmass(
  kontext: LeseKontext, id: string,
): Promise<AufmassKopfZeile | null> {
  const [zeile] = await kontext.abfrage<AufmassKopfZeile>(
    `select a.id, a.nummer, a.bezeichnung, a.bereich,
            to_char(a.messdatum, 'YYYY-MM-DD') as messdatum,
            to_char(a.messdatum, 'DD.MM.YYYY') as messdatum_lokal,
            a.status::text as status, a.erhebungsart::text as erhebungsart,
            to_char(a.ankuendigung_am, 'DD.MM.YYYY') as ankuendigung_am,
            to_char(a.gesperrt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as gesperrt_lokal,
            a.projekt_id, p.bezeichnung as projekt, k.name as kunde,
            (select count(*) from aufmass_zeile z where z.aufmass_id = a.id)::int as zeilen,
            (select count(*) from aufmass_foto f
              where f.aufmass_id = a.id and f.zweck = 'nachweis')::int as fotos
       from aufmass a
       join projekt p on p.id = a.projekt_id and p.mandant_id = a.mandant_id
       join kunde   k on k.id = a.kunde_id and k.mandant_id = a.mandant_id
      where a.id = $1`,
    [id],
  );
  return zeile ?? null;
}

export async function ladeZeilen(
  kontext: LeseKontext, aufmassId: string,
): Promise<readonly AufmassZeileZeile[]> {
  return kontext.abfrage<AufmassZeileZeile>(
    `select z.id, z.reihenfolge, z.bezeichnung, z.rechenansatz,
            z.ergebnis_skaliert::text as ergebnis_skaliert, z.menge::text as menge,
            z.einheit, l.oz, z.lv_position_id, z.ausserhalb_lv, z.parser_version,
            z.bemerkung
       from aufmass_zeile z
       left join lv_position l on l.id = z.lv_position_id and l.mandant_id = z.mandant_id
      where z.aufmass_id = $1
      order by z.reihenfolge`,
    [aufmassId],
  );
}

/** Der Stand, den `pruefeVorlage` beurteilt — eine Abfrage, keine vier. */
export async function ladeVorlageStand(
  kontext: LeseKontext, aufmassId: string,
): Promise<VorlageStand | null> {
  const [zeile] = await kontext.abfrage<{
    status: AufmassStatus; erhebungsart: Erhebungsart; ankuendigung_am: string | null;
    zeilen: number; nachweis_fotos: number; ungeprueft: readonly string[] | null;
  }>(
    `select a.status::text as status, a.erhebungsart::text as erhebungsart,
            to_char(a.ankuendigung_am, 'YYYY-MM-DD') as ankuendigung_am,
            (select count(*) from aufmass_zeile z where z.aufmass_id = a.id)::int as zeilen,
            (select count(*) from aufmass_foto f
              where f.aufmass_id = a.id and f.zweck = 'nachweis')::int as nachweis_fotos,
            (select array_agg(l.oz order by l.sortier_pfad)
               from aufmass_zeile z
               join lv_position l on l.id = z.lv_position_id and l.mandant_id = z.mandant_id
              where z.aufmass_id = a.id
                and l.konfidenz is not null and l.geprueft_am is null) as ungeprueft
       from aufmass a
      where a.id = $1`,
    [aufmassId],
  );
  if (zeile === undefined) return null;
  return {
    status: zeile.status,
    erhebungsart: zeile.erhebungsart,
    ankuendigungAm: zeile.ankuendigung_am,
    zeilen: zeile.zeilen,
    nachweisFotos: zeile.nachweis_fotos,
    ungepruefteOz: zeile.ungeprueft ?? [],
  };
}

export interface AufmassEingabe {
  readonly projektId: string;
  readonly bezeichnung: string;
  readonly bereich: string | null;
  /** Berliner Kalendertag, `YYYY-MM-DD` — kommt aus `@/server/db/heute`. */
  readonly messdatum: string;
  readonly erhebungsart: Erhebungsart;
  readonly ankuendigungAm: string | null;
  readonly zeilen: readonly ZeileEingabe[];
}

/**
 * Legt das Blatt mit seinen Zeilen an — im Entwurf, und **mit serverseitig
 * gerechneten Mengen**.
 *
 * Die Nummer entsteht je Projekt fortlaufend aus dem, was schon da ist. Das
 * ist bewusst KEIN `nummernkreis`: der Zaehler aus FIN-03 gehoert den
 * Belegnummern, deren Lueckenlosigkeit § 14 UStG verlangt, und ein Aufmassblatt
 * ist kein Beleg in diesem Sinn.
 * // TODO(client, O-155): Folgt die Aufmassnummer einer Vorgabe des
 * Auftraggebers (Blattnummer im LV-Kopf), oder zaehlt sie je Projekt?
 */
export async function erfasseAufmass(
  kontext: SchreibKontext, eingabe: AufmassEingabe,
): Promise<{ readonly id: string; readonly nummer: string }> {
  const zeilen = rechneZeilen(eingabe.zeilen);

  const [kopf] = await kontext.schreibe<{ id: string; nummer: string }>(
    `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, bereich,
                          messdatum, erhebungsart, ankuendigung_am, status,
                          aufgenommen_von_anstellung_id, erstellt_von)
     select $1, p.id, p.kunde_id,
            lpad((coalesce(
              (select max(nullif(regexp_replace(a2.nummer, '\\D', '', 'g'), '')::bigint)
                 from aufmass a2 where a2.projekt_id = p.id), 0) + 1)::text, 4, '0'),
            $3, $4, $5::date, $6::aufmass_erhebungsart, $7::date, 'entwurf',
            (select an.id from anstellung an
              where an.mandant_id = $1 and an.person_id = app.aktuelle_person()
              limit 1),
            app.aktueller_benutzer()
       from projekt p
      where p.id = $2 and p.mandant_id = $1
     returning id, nummer`,
    [
      kontext.aktiverMandantId, eingabe.projektId, eingabe.bezeichnung, eingabe.bereich,
      eingabe.messdatum, eingabe.erhebungsart, eingabe.ankuendigungAm,
    ],
  );
  if (kopf === undefined) {
    // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
    throw new AufmassFehler('nicht_gefunden', 'Projekt nicht gefunden.');
  }

  for (const zeile of zeilen) {
    await kontext.schreibe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id,
                                  lv_position_id, ausserhalb_lv, reihenfolge, bezeichnung,
                                  rechenansatz, rechenansatz_ast, parser_version,
                                  ergebnis_skaliert, menge, einheit,
                                  uebermessung_hinweis, bemerkung, erstellt_von)
       values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10, $11::bigint,
               $12::numeric, $13, $14, $15, app.aktueller_benutzer())`,
      [
        kontext.aktiverMandantId, kopf.id, eingabe.projektId,
        zeile.lvPositionId, zeile.ausserhalbLv, zeile.reihenfolge, zeile.bezeichnung,
        zeile.ergebnis.formel, JSON.stringify(zeile.ergebnis.ast), zeile.ergebnis.parserVersion,
        zeile.ergebnis.skaliert.toString(), zeile.ergebnis.mengePostgres, zeile.einheit,
        zeile.uebermessungHinweis ?? null, zeile.bemerkung ?? null,
      ],
    );
  }
  return kopf;
}

/**
 * Hängt eine bereits abgelegte Aufnahme an das Blatt (BAU-03).
 *
 * Die Datei selbst ist vorher durch `legeMediumAb` gegangen — Groesse, Typ aus
 * den Magic Bytes, EXIF entfernt, privater Bucket. Hier entsteht nur die
 * Verbindung, und `kunde_id` sowie der Kopfzustand kommen vom Ausloeser, nicht
 * vom Aufrufer.
 */
export async function hefteFotoAn(
  kontext: SchreibKontext,
  eingabe: {
    readonly aufmassId: string;
    readonly medienId: string;
    readonly zeileId?: string | null;
    readonly zweck?: 'nachweis' | 'uebersicht' | 'detail';
    readonly beschreibung?: string | null;
    readonly geraeteZeit?: string | null;
  },
): Promise<void> {
  await kontext.schreibe(
    `insert into aufmass_foto (mandant_id, aufmass_id, aufmass_zeile_id, kunde_id,
                               medien_id, zweck, beschreibung, geraete_zeit,
                               erstellt_von, erstellt_von_person_id)
     select $1, a.id, $3::uuid, a.kunde_id, $4::uuid, $5::aufmass_foto_zweck, $6, $7::timestamptz,
            app.aktueller_benutzer(), app.aktuelle_person()
       from aufmass a
      where a.id = $2 and a.mandant_id = $1`,
    [
      kontext.aktiverMandantId, eingabe.aufmassId, eingabe.zeileId ?? null, eingabe.medienId,
      eingabe.zweck ?? 'nachweis', eingabe.beschreibung ?? null, eingabe.geraeteZeit ?? null,
    ],
  );
}

/**
 * Die Gegenzeichnung (BAU-03) — der Uebergang, an dem beide Tore fallen.
 *
 * Der Ablauf ist bewusst zweistufig und in EINER Transaktion: erst der
 * Uebergang `entwurf → vorgelegt`, an dem die Fotopflicht und die
 * LV-Pruefung greifen, dann die Unterschrift, die den Kopf auf
 * `gegengezeichnet` hebt und einfriert. Wer nur unterschriebe, umginge die
 * Fotopflicht; wer nur vorlegte, haette ein Blatt ohne Feststellung.
 *
 * Der Schnappschuss entsteht aus DEN GESPEICHERTEN ZEILEN, nicht aus etwas,
 * das der Browser mitschickt (CLN-04-Muster, Review B25): nur so bezeugt der
 * Digest, was der Server angezeigt hat.
 */
export async function gegenzeichne(
  kontext: SchreibKontext,
  eingabe: {
    readonly aufmassId: string;
    readonly unterzeichnerName: string;
    readonly unterzeichnerFunktion?: string | null;
    readonly vorbehalt?: string | null;
    readonly signaturMedienId?: string | null;
    readonly geraeteZeit?: string | null;
  },
): Promise<{ readonly status: AufmassStatus; readonly hash: string }> {
  const stand = await ladeVorlageStand(kontext, eingabe.aufmassId);
  if (stand === null) throw new AufmassFehler('nicht_gefunden', 'Aufmass nicht gefunden.');

  const hindernisse = pruefeVorlage(stand).filter((h) => h !== 'nicht_entwurf');
  if (hindernisse.length > 0) {
    throw new AufmassFehler(
      hindernisse[0] as VorlageHindernis,
      hindernisse.map((h) => HINDERNIS_TEXT[h]).join(' '),
    );
  }

  if (stand.status === 'entwurf') {
    await kontext.schreibe(
      `update aufmass set status = 'vorgelegt' where id = $1 and status = 'entwurf'`,
      [eingabe.aufmassId],
    );
  }

  const kopf = await findeAufmass(kontext, eingabe.aufmassId);
  if (kopf === null) throw new AufmassFehler('nicht_gefunden', 'Aufmass nicht gefunden.');
  const zeilen = await ladeZeilen(kontext, eingabe.aufmassId);

  const schnappschuss = baueAufmassSchnappschuss(
    {
      nummer: kopf.nummer,
      bezeichnung: kopf.bezeichnung,
      projekt: kopf.projekt,
      kunde: kopf.kunde,
      bereich: kopf.bereich,
      messdatum: kopf.messdatum_lokal,
      erhebungsart: kopf.erhebungsart,
    },
    zeilen.map((z) => ({
      reihenfolge: z.reihenfolge.toString(),
      bezeichnung: z.bezeichnung,
      oz: z.oz,
      rechenansatz: z.rechenansatz,
      ergebnisSkaliert: z.ergebnis_skaliert,
      menge: z.menge,
      einheit: z.einheit,
    })),
  );
  const hash = aufmassSchnappschussHash(schnappschuss);

  await kontext.schreibe(
    `insert into aufmass_signatur (mandant_id, aufmass_id, kunde_id, rolle,
                                   unterzeichner_name, unterzeichner_funktion, vorbehalt,
                                   signatur_medien_id, geraete_zeit, snapshot, snapshot_hash,
                                   erstellt_von, erstellt_von_person_id)
     select $1, a.id, a.kunde_id, 'auftraggeber', $3, $4, $5, $6::uuid, $7::timestamptz,
            $8::text::jsonb, $9, app.aktueller_benutzer(), app.aktuelle_person()
       from aufmass a
      where a.id = $2 and a.mandant_id = $1`,
    [
      kontext.aktiverMandantId, eingabe.aufmassId, eingabe.unterzeichnerName,
      eingabe.unterzeichnerFunktion ?? null, eingabe.vorbehalt ?? null,
      eingabe.signaturMedienId ?? null, eingabe.geraeteZeit ?? null,
      /**
       * `::text::jsonb` und nicht `::jsonb`: der Treiber typisiert den
       * Parameter nach dem Cast, und bei `jsonb` serialisiert er die bereits
       * fertige Zeichenkette EIN ZWEITES MAL — in der Spalte stuende dann eine
       * JSON-Zeichenkette statt eines Objekts, und jede Abfrage auf
       * `snapshot->'zeilen'` liefe ins Leere. Gefunden hat es
       * `tests/isolation/bau-aufmass.test.ts`, weil er den Schnappschuss
       * wieder ausliest statt nur zu pruefen, dass er da ist.
       */
      JSON.stringify(schnappschuss), hash,
    ],
  );

  const danach = await findeAufmass(kontext, eingabe.aufmassId);
  return { status: danach?.status ?? 'vorgelegt', hash };
}

/** Die Anzeige neben der Formel — eine Stelle, nicht drei in drei Seiten. */
export function formatiereErgebnis(ergebnisSkaliert: string, einheit: string): string {
  return `${anzeigeAusSkaliert(BigInt(ergebnisSkaliert))} ${einheit}`;
}

export interface FotoZeile {
  readonly id: string;
  readonly zweck: string;
  readonly beschreibung: string | null;
  readonly empfangen_lokal: string;
  readonly bucket: string;
  readonly pfad: string;
  readonly mime_typ: string;
  readonly zeitabweichung_sek: number | null;
}

/**
 * Die Messfotos eines Blattes — mit ihrem SERVEREINGANG, nicht mit der
 * Behauptung des Geraets (TIM-08).
 *
 * Die Abweichung steht daneben: dass ein Tablet zwei Stunden falsch geht, ist
 * eine Tatsache des Protokolls und keine Zeitangabe im Dokument.
 */
export async function ladeFotos(
  kontext: LeseKontext, aufmassId: string,
): Promise<readonly FotoZeile[]> {
  return kontext.abfrage<FotoZeile>(
    `select f.id, f.zweck::text as zweck, f.beschreibung,
            to_char(f.empfangen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as empfangen_lokal,
            m.bucket, m.pfad, m.mime_typ, f.zeitabweichung_sek
       from aufmass_foto f
       join einsatz_medien m on m.id = f.medien_id and m.mandant_id = f.mandant_id
      where f.aufmass_id = $1
      order by f.reihenfolge, f.empfangen_am`,
    [aufmassId],
  );
}

export interface SignaturZeile {
  readonly id: string;
  readonly rolle: string;
  readonly unterzeichner_name: string;
  readonly unterzeichner_funktion: string | null;
  readonly unterzeichnet_lokal: string;
  readonly vorbehalt: string | null;
  readonly snapshot_hash: string;
}

export async function ladeSignaturen(
  kontext: LeseKontext, aufmassId: string,
): Promise<readonly SignaturZeile[]> {
  return kontext.abfrage<SignaturZeile>(
    `select s.id, s.rolle::text as rolle, s.unterzeichner_name, s.unterzeichner_funktion,
            to_char(s.unterzeichnet_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
              as unterzeichnet_lokal,
            s.vorbehalt, s.snapshot_hash
       from aufmass_signatur s
      where s.aufmass_id = $1
      order by s.unterzeichnet_am`,
    [aufmassId],
  );
}
