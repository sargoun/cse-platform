/**
 * Das Wetter am Bautag (BAU-08, 03-GEWERKE §7.12/§7.16/§7.17,
 * 07-INTEGRATIONEN §16).
 *
 * Der Dienst tut drei Dinge, und das dritte ist das wichtigste:
 *
 *  1. **Er heftet an, was eine Quelle gemessen hat** — mit Station und
 *     Beobachtungszeit, beides im Schnappschuss, beides unveraenderlich.
 *  2. **Er haelt den Schnappschuss fest, statt spaeter neu zu fragen.** Der
 *     DWD revidiert Messwerte; ein Bautagebuch, das beim Anzeigen frisch
 *     abfragt, zeigt im Streitfall die heutige Fassung neben einer
 *     Unterschrift von damals (§16).
 *  3. **Er erfindet nichts.** Ist die Quelle nicht verbunden, nicht
 *     erreichbar oder ohne Werte fuer den Tag, bleibt das Wetterfeld leer, der
 *     Text lautet „Wetterdaten nicht verfuegbar" — und der Bautag SPEICHERT
 *     TROTZDEM. Das ist die Zusage aus BAU-08, und die Datenbank haelt sie
 *     mit: bei `wetter_quelle = 'keine'` sind alle Wetterspalten NULL
 *     (`bautagebuch_ohne_quelle_ohne_wert`, 0083).
 *
 * Zwei Gruende werden AUSEINANDERGEHALTEN, obwohl beide „kein Wetter"
 * bedeuten (§16, §25.2): „Keine Koordinaten am Objekt hinterlegt" ist ein
 * Pflegefehler, den jemand beheben kann; „Wetterdaten nicht verfuegbar" ist
 * eine Aussage ueber die Quelle. Wer beides in einen Satz legt, laesst das
 * fehlende Geokoordinatenpaar jahrelang stehen.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  WetterFehler, entfernungKm,
  type WetterMessung, type WetterPort,
} from '../../versand/dwd.js';

/** Der Text im Feld, wenn die Quelle nichts geliefert hat (BAU-08, woertlich). */
export const WETTER_NICHT_VERFUEGBAR = 'Wetterdaten nicht verfügbar' as const;
/** Der EIGENE Grund: am Objekt fehlen die Koordinaten (§16, §25.2). */
export const WETTER_OHNE_KOORDINATEN = 'Keine Koordinaten am Objekt hinterlegt' as const;
/** Ebenfalls eigener Grund: ohne Stationsindex gibt es keine Station. */
export const WETTER_OHNE_STATION = 'Keine DWD-Station zur Baustelle aufgelöst' as const;
/** §16: die Namensnennung ist Bedingung der Nutzung, keine Hoeflichkeit. */
export const WETTER_QUELLENHINWEIS = 'Quelle: Deutscher Wetterdienst' as const;
/**
 * Der Tag war beim Schreiben nicht mehr offen — abgeschlossen oder storniert
 * (V-183). An ihm bewegt sich nichts mehr (0082); angeheftet wurde nichts.
 */
export const WETTER_TAG_NICHT_OFFEN = 'Der Bautag ist nicht mehr offen — kein Wetter angeheftet' as const;
/**
 * Der Tag trug beim Schreiben schon Wetter, und der Nachtlauf ueberschreibt
 * keines (D-677 Nr. 3, `j_wetter_anheften`).
 */
export const WETTER_SCHON_BELEGT = 'Der Bautag trägt schon Wetter — es bleibt, wie es ist' as const;

export const WETTER_SNAPSHOT_FASSUNG = 'bautagebuch-wetter-v1' as const;

export type WetterBefundArt =
  | 'angeheftet'
  | 'nicht_verbunden'
  | 'nicht_erreichbar'
  | 'unlesbar'
  | 'keine_daten'
  | 'ohne_koordinaten'
  | 'keine_station'
  /** V-183: abgeschlossen oder storniert, vor dem Abruf oder beim Schreiben. */
  | 'nicht_offen'
  /** V-183, nur der Nachtlauf: der Tag trug schon Wetter (von Hand oder angeheftet). */
  | 'schon_belegt';

export interface WetterBefund {
  readonly art: WetterBefundArt;
  /** Der Satz, der im Feld steht. Bei `angeheftet` der Quellenhinweis. */
  readonly text: string;
  /** Wie viele Beobachtungen angeheftet wurden. Ohne Anheftung 0. */
  readonly beobachtungen: number;
  readonly stationId: string | null;
}

/**
 * Die Werte eines Tages, wie sie ANGEHEFTET wurden.
 *
 * Alle Zahlen als Text: `kanonischesJson` (Reinigung) wirft bei einer `number`,
 * und dieselbe Regel gilt hier — eine Gleitkommazahl in einem Beweisobjekt ist
 * die Stelle, an der aus `18.3` irgendwann `18.299999999999997` wird.
 */
export interface WetterSchnappschuss {
  readonly fassung: typeof WETTER_SNAPSHOT_FASSUNG;
  /** Pflichtfeld der Datenbank (`bautagebuch_wetter_schnappschuss_vollstaendig`). */
  readonly station_id: string;
  readonly station_name: string;
  /** Die frueheste angeheftete Beobachtungszeit — ebenfalls Pflichtfeld. */
  readonly beobachtet_am: string;
  readonly entfernung_km: string;
  readonly quelle: 'dwd';
  readonly quelle_url: string;
  readonly abgerufen_am: string;
  readonly quellenhinweis: typeof WETTER_QUELLENHINWEIS;
  /**
   * Wie die drei Spalten `wetter_frueh_id`/`_mittag_id`/`_abend_id` belegt
   * wurden. Heute: erste, mittlere und letzte ANGEHEFTETE Beobachtung — eine
   * Ordnung, keine Tageszeit. Welche Uhrzeiten im Bautagebuch als frueh,
   * mittag und abend gelten, ist offen (O-213, siehe `versand/dwd.ts`), und
   * bis dahin steht neben jedem Wert seine Beobachtungszeit.
   */
  readonly belegung: 'erste_mittlere_letzte_beobachtung';
  readonly werte: readonly {
    readonly beobachtet_am: string;
    readonly temperatur_c: string | null;
    readonly niederschlag_mm: string | null;
    readonly wind_ms: string | null;
    readonly qualitaetsniveau: string | null;
  }[];
}

function alsText(wert: number | null): string | null {
  return wert === null ? null : String(wert);
}

/**
 * Baut den Schnappschuss aus den gelesenen Beobachtungen. REINE Funktion —
 * deshalb pruefbar, ohne dass irgendetwas nach draussen geht.
 */
export function baueWetterSchnappschuss(
  messungen: readonly WetterMessung[],
): WetterSchnappschuss {
  const sortiert = [...messungen].sort((a, b) => a.beobachtetAm.localeCompare(b.beobachtetAm));
  const erste = sortiert[0];
  if (erste === undefined) {
    throw new WetterFehler('keine_daten', 'Ohne Beobachtung gibt es keinen Schnappschuss.');
  }
  return {
    fassung: WETTER_SNAPSHOT_FASSUNG,
    station_id: erste.stationId,
    station_name: erste.stationName,
    beobachtet_am: erste.beobachtetAm,
    entfernung_km: String(erste.entfernungKm),
    quelle: 'dwd',
    quelle_url: erste.quelleUrl,
    abgerufen_am: erste.abgerufenAm,
    quellenhinweis: WETTER_QUELLENHINWEIS,
    belegung: 'erste_mittlere_letzte_beobachtung',
    werte: sortiert.map((m) => ({
      beobachtet_am: m.beobachtetAm,
      temperatur_c: alsText(m.temperaturC),
      niederschlag_mm: alsText(m.niederschlagMm),
      wind_ms: alsText(m.windMs),
      qualitaetsniveau: alsText(m.qualitaetsniveau),
    })),
  };
}

export interface WetterKennzahlen {
  /** Als Text fuer `numeric` — nie als Gleitkommazahl an die Datenbank. */
  readonly temperaturMin: string | null;
  readonly temperaturMax: string | null;
  /**
   * Die SUMME der angehefteten Stundenwerte, nicht die Tagesmenge des DWD.
   * Fehlt eine Stunde in der Reihe, ist diese Zahl kleiner als die wirkliche —
   * deshalb steht die Zahl der Beobachtungen im Schnappschuss daneben, statt
   * dass hier etwas hochgerechnet wird.
   */
  readonly niederschlag: string | null;
}

/** Min, Max und Niederschlag aus den Beobachtungen. Rechnet, erfindet nicht. */
export function wetterKennzahlen(messungen: readonly WetterMessung[]): WetterKennzahlen {
  const temperaturen = messungen
    .map((m) => m.temperaturC)
    .filter((t): t is number => t !== null);
  const niederschlaege = messungen
    .map((m) => m.niederschlagMm)
    .filter((n): n is number => n !== null);

  return {
    temperaturMin: temperaturen.length === 0 ? null : String(Math.min(...temperaturen)),
    temperaturMax: temperaturen.length === 0 ? null : String(Math.max(...temperaturen)),
    niederschlag: niederschlaege.length === 0
      ? null
      // Auf zwei Stellen, wie die Spalte sie fuehrt — einmal gerundet, am Ende.
      : (Math.round(niederschlaege.reduce((a, b) => a + b, 0) * 100) / 100).toFixed(2),
  };
}

/** Welche drei Beobachtungen in die drei Spalten wandern (siehe `belegung`). */
export function waehleBelegung(
  messungen: readonly WetterMessung[],
): { readonly frueh: string; readonly mittag: string | null; readonly abend: string | null } {
  const sortiert = [...messungen].sort((a, b) => a.beobachtetAm.localeCompare(b.beobachtetAm));
  const erste = sortiert[0];
  if (erste === undefined) {
    throw new WetterFehler('keine_daten', 'Ohne Beobachtung gibt es keine Belegung.');
  }
  const letzte = sortiert[sortiert.length - 1];
  const mitte = sortiert[Math.floor(sortiert.length / 2)];
  return {
    frueh: erste.beobachtetAm,
    mittag: sortiert.length >= 3 && mitte !== undefined ? mitte.beobachtetAm : null,
    abend: sortiert.length >= 2 && letzte !== undefined ? letzte.beobachtetAm : null,
  };
}

/** Der Satz, der im Feld des Tages steht. */
export function wetterFeldText(art: WetterBefundArt): string {
  switch (art) {
    case 'angeheftet': return WETTER_QUELLENHINWEIS;
    case 'ohne_koordinaten': return WETTER_OHNE_KOORDINATEN;
    case 'keine_station': return WETTER_OHNE_STATION;
    case 'nicht_offen': return WETTER_TAG_NICHT_OFFEN;
    case 'schon_belegt': return WETTER_SCHON_BELEGT;
    default: return WETTER_NICHT_VERFUEGBAR;
  }
}

interface TagZeile {
  readonly id: string;
  readonly datum: string;
  readonly projekt_id: string;
  readonly abgeschlossen_am: string | null;
  readonly storniert: boolean;
  readonly wetter_quelle: string;
  readonly geo_lat: string | null;
  readonly geo_lon: string | null;
  readonly wetter_station_id: string | null;
}

/** Ein Befund ohne Anheftung — der Tag bleibt, wie er ist. */
function ohneAnheftung(art: WetterBefundArt, stationId: string | null = null): WetterBefund {
  return { art, text: wetterFeldText(art), beobachtungen: 0, stationId };
}

/**
 * Heftet das Wetter eines Tages an — oder sagt begruendet, warum nicht.
 *
 * **Der Port wird UEBERGEBEN, nicht hier gebaut** (dasselbe Muster wie beim
 * Medienspeicher in `zeit/medien.ts`): so laesst sich der Weg pruefen, ohne
 * dass ein Test etwas nach draussen schickt — und ohne dass ein Testdoppel
 * jemals aussieht wie die echte Quelle.
 *
 * Es wird NIE geworfen, wenn das Wetter fehlt: der Aufrufer bekommt einen
 * Befund zurueck, und der Bautag bleibt, wie er ist. Ein Fehler an dieser
 * Stelle haette den Tag mitgerissen — genau das verbietet BAU-08.
 */
export async function hefteWetterAn(
  kontext: SchreibKontext,
  eingabe: { readonly bautagebuchId: string },
  port: WetterPort,
  /**
   * Wer anheftet (V-183): der Mensch am Knopf oder der Nachtlauf
   * `wetter_zuordnung`. Er steht in `geaendert_von_art`; ein Lauf, der sich
   * als Mensch eintruege, verfaelschte die Spur, wer den Tag zuletzt
   * angefasst hat.
   */
  akteur: 'mensch' | 'system' = 'mensch',
): Promise<WetterBefund> {
  const [tag] = await kontext.abfrage<TagZeile>(
    `select b.id, to_char(b.datum, 'YYYY-MM-DD') as datum, b.projekt_id,
            to_char(b.abgeschlossen_am, 'YYYY-MM-DD"T"HH24:MI:SSOF') as abgeschlossen_am,
            (b.storniert_am is not null) as storniert, b.wetter_quelle::text as wetter_quelle,
            o.geo_lat::text as geo_lat, o.geo_lon::text as geo_lon,
            p.wetter_station_id
       from bautagebuch b
       join projekt p on p.id = b.projekt_id and p.mandant_id = b.mandant_id
       left join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
      where b.id = $1 and b.mandant_id = $2`,
    [eingabe.bautagebuchId, kontext.aktiverMandantId],
  );

  if (tag === undefined) {
    return { art: 'keine_daten', text: WETTER_NICHT_VERFUEGBAR, beobachtungen: 0, stationId: null };
  }
  /*
   * V-183: VOR dem Abruf, was sich am Tag nicht mehr bewegen darf. Ein
   * abgeschlossener oder stornierter Tag bekommt nichts (0082) — bisher
   * fragte der Weg trotzdem beim DWD und meldete danach „angeheftet", obwohl
   * das UPDATE keine Zeile traf. Der Nachtlauf fasst ausserdem kein Wetter an,
   * das schon da ist (D-677 Nr. 3); der Knopf darf es neu holen.
   */
  if (tag.abgeschlossen_am !== null || tag.storniert) return ohneAnheftung('nicht_offen');
  if (akteur === 'system' && tag.wetter_quelle !== 'keine') return ohneAnheftung('schon_belegt');
  if (tag.geo_lat === null || tag.geo_lon === null) {
    return {
      art: 'ohne_koordinaten', text: WETTER_OHNE_KOORDINATEN, beobachtungen: 0, stationId: null,
    };
  }
  if (tag.wetter_station_id === null || tag.wetter_station_id === '') {
    return {
      art: 'keine_station', text: WETTER_OHNE_STATION, beobachtungen: 0, stationId: null,
    };
  }

  let messungen: readonly WetterMessung[];
  try {
    messungen = await port.beobachtungen({
      breitengrad: Number(tag.geo_lat),
      laengengrad: Number(tag.geo_lon),
      tag: tag.datum,
      stationId: tag.wetter_station_id,
    });
  } catch (fehler: unknown) {
    const art: WetterBefundArt = fehler instanceof WetterFehler ? fehler.grund : 'nicht_erreichbar';
    return { art, text: wetterFeldText(art), beobachtungen: 0, stationId: tag.wetter_station_id };
  }

  if (messungen.length === 0) {
    return {
      art: 'keine_daten', text: WETTER_NICHT_VERFUEGBAR,
      beobachtungen: 0, stationId: tag.wetter_station_id,
    };
  }

  /**
   * Die Entfernung wird HIER gerechnet und nicht vom Adapter uebernommen:
   * „naechste Station 40 km entfernt" ist ein anderes Beweisgewicht als
   * „3 km", und die Zahl gehoert in den Schnappschuss (§16).
   */
  const [erste] = messungen;
  const entfernung = erste === undefined
    ? 0
    : entfernungKm(Number(tag.geo_lat), Number(tag.geo_lon), erste.breitengrad, erste.laengengrad);
  const mitEntfernung = messungen.map((m) => ({ ...m, entfernungKm: entfernung }));

  const schnappschuss = baueWetterSchnappschuss(mitEntfernung);
  const kennzahlen = wetterKennzahlen(mitEntfernung);
  const belegung = waehleBelegung(mitEntfernung);

  /**
   * Jede Beobachtung wandert einzeln durch die Definer-Funktion aus 0083 —
   * idempotent ueber `(station_id, zeitpunkt)`. `cse_app` darf auf
   * `wetter_beobachtung` nicht schreiben; sonst koennte jede angemeldete
   * Sitzung Messwerte erfinden.
   */
  const kennungen = new Map<string, string>();
  for (const m of mitEntfernung) {
    const [zeile] = await kontext.schreibe<{ id: string | null }>(
      `select app.wetter_beobachtung_uebernehmen(
                $1, $2, $3::numeric, $4::numeric, $5::timestamptz,
                $6::numeric, $7::numeric, $8::numeric, $9::smallint, $10::jsonb) as id`,
      [
        m.stationId, m.stationName, m.breitengrad, m.laengengrad, m.beobachtetAm,
        m.temperaturC, m.niederschlagMm, m.windMs, m.qualitaetsniveau,
        /**
         * Das OBJEKT, nicht `JSON.stringify` — ein `$n::jsonb` mit einer
         * Zeichenkette legt eine JSON-STRING in die Spalte, und `->>` liefert
         * danach NULL. Der Treiber serialisiert ein Objekt selbst.
         */
        { quelle_url: m.quelleUrl, abgerufen_am: m.abgerufenAm },
      ],
    );
    if (zeile?.id != null) kennungen.set(m.beobachtetAm, zeile.id);
  }

  /*
   * `returning id`: ob eine Zeile getroffen wurde, sagt nur die Antwort. Der
   * Abruf dauert bis zu 30 s, und im Nachtlauf liegt die Kandidatenliste noch
   * laenger zurueck — wer den Tag inzwischen schliesst, storniert oder (fuer
   * den Lauf) mit Wetter versieht, laesst das UPDATE leer ausgehen, ohne
   * Fehler. Bisher stand dann trotzdem „angeheftet" im Befund und im
   * Laufprotokoll (V-183).
   */
  const getroffen = await kontext.schreibe<{ id: string }>(
    `update bautagebuch
        set wetter_quelle = 'dwd',
            wetter_frueh_id  = $3::uuid,
            wetter_mittag_id = $4::uuid,
            wetter_abend_id  = $5::uuid,
            wetter_snapshot  = $6::jsonb,
            temperatur_min_c = $7::numeric,
            temperatur_max_c = $8::numeric,
            niederschlag_mm  = $9::numeric,
            geaendert_von    = app.aktueller_benutzer(),
            geaendert_von_art = $10::akteur_art
      where id = $1 and mandant_id = $2
        and abgeschlossen_am is null and storniert_am is null
        and ($10::akteur_art <> 'system' or wetter_quelle = 'keine')
      returning id`,
    [
      tag.id, kontext.aktiverMandantId,
      kennungen.get(belegung.frueh) ?? null,
      belegung.mittag === null ? null : kennungen.get(belegung.mittag) ?? null,
      belegung.abend === null ? null : kennungen.get(belegung.abend) ?? null,
      schnappschuss,
      kennzahlen.temperaturMin, kennzahlen.temperaturMax, kennzahlen.niederschlag,
      akteur,
    ],
  );
  if (getroffen.length === 0) {
    /* Warum nicht — erneut gelesen, denn es hat sich eben erst entschieden. */
    const [jetzt] = await kontext.abfrage<{ offen: boolean }>(
      `select (abgeschlossen_am is null and storniert_am is null) as offen
         from bautagebuch where id = $1 and mandant_id = $2`,
      [tag.id, kontext.aktiverMandantId],
    );
    return ohneAnheftung(jetzt?.offen === true ? 'schon_belegt' : 'nicht_offen',
      schnappschuss.station_id);
  }

  return {
    art: 'angeheftet',
    text: WETTER_QUELLENHINWEIS,
    beobachtungen: mitEntfernung.length,
    stationId: schnappschuss.station_id,
  };
}

export interface WetterAnzeige {
  readonly quelle: 'dwd' | 'manuell' | 'keine';
  readonly text: string;
  readonly station: string | null;
  readonly beobachtetAmLokal: string | null;
  readonly temperaturMin: string | null;
  readonly temperaturMax: string | null;
  readonly niederschlag: string | null;
  readonly notiz: string | null;
}

/**
 * Was die Seite zum Wetter eines Tages zeigt.
 *
 * Ohne Quelle steht dort GENAU der Satz aus BAU-08 und keine Null — „0 °C" und
 * „keine Angabe" sind zwei verschiedene Aussagen, und die erste ist im
 * Bauprozess eine Falschangabe.
 */
export async function leseWetterAnzeige(
  kontext: LeseKontext, bautagebuchId: string,
): Promise<WetterAnzeige | null> {
  const [zeile] = await kontext.abfrage<{
    wetter_quelle: 'dwd' | 'manuell' | 'keine';
    station: string | null;
    beobachtet_lokal: string | null;
    temperatur_min_c: string | null;
    temperatur_max_c: string | null;
    niederschlag_mm: string | null;
    wetter_notiz: string | null;
  }>(
    `select b.wetter_quelle::text as wetter_quelle,
            coalesce(b.wetter_snapshot ->> 'station_name',
                     b.wetter_snapshot ->> 'station_id') as station,
            to_char((b.wetter_snapshot ->> 'beobachtet_am')::timestamptz
                      at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as beobachtet_lokal,
            b.temperatur_min_c::text, b.temperatur_max_c::text, b.niederschlag_mm::text,
            b.wetter_notiz
       from bautagebuch b
      where b.id = $1`,
    [bautagebuchId],
  );
  if (zeile === undefined) return null;

  return {
    quelle: zeile.wetter_quelle,
    text: zeile.wetter_quelle === 'keine' ? WETTER_NICHT_VERFUEGBAR : WETTER_QUELLENHINWEIS,
    station: zeile.station,
    beobachtetAmLokal: zeile.beobachtet_lokal,
    temperaturMin: zeile.temperatur_min_c,
    temperaturMax: zeile.temperatur_max_c,
    niederschlag: zeile.niederschlag_mm,
    notiz: zeile.wetter_notiz,
  };
}

// ---------------------------------------------------------------------------
// Die automatische Zuordnung (BAU-08 „auto-attached", V-183, D-677)
// ---------------------------------------------------------------------------

/**
 * Wie weit der Nachtlauf zurueckblickt: die sieben Kalendertage VOR heute.
 *
 * Eine Betriebsgroesse, keine Geschaeftsregel: sie deckt ein Wochenende,
 * einen Feiertag und ein paar ausgefallene Laeufe ab. Heute selbst gehoert nie
 * dazu — ein Schnappschuss vom Vormittag waere ein halber Tag, und ein
 * einmal angehefteter Tag wird vom Lauf nicht wieder angefasst.
 */
export const WETTER_ZUORDNUNG_TAGE = 7;

/**
 * Erreicht der Nachtlauf diesen Bautag noch (V-183, D-677)? — die Frage, die
 * die Tagesseite stellen muss, BEVOR sie „das Wetter heftet der Nachtlauf
 * automatisch an" sagt.
 *
 * Der Lauf fasst nur `datum >= heute - tage` an (`ordneWetterZu`). Ein
 * offener Tag von vor drei Wochen — nachgetragen, als Ersatztag mit altem
 * Datum angelegt, oder sieben Naechte ohne Koordinaten — bekam trotzdem die
 * Zusage, und wer ihr glaubte, drueckte den Knopf nicht: der Tag blieb ohne
 * Wetter, und genau dieser Beleg fehlt im Behinderungsstreit (BAU-08).
 *
 * **Echt groesser, nicht groesser-gleich.** Der Lauf um 04:40 UTC hat den Tag
 * `heute - tage` am selben Berliner Tag schon zum letzten Mal angefasst; mit
 * `>=` versprach die Seite ihn fuer diesen Tag bis Mitternacht weiter. Ein
 * kuenftiger Tag wird erreicht, sobald er vorbei ist.
 *
 * Rein, ohne Uhr: `heute` ist der Berliner Kalendertag aus der Datenbank
 * (`berlinHeute()`), beide als `JJJJ-MM-TT`. Gerechnet wird in ganzen
 * Kalendertagen, nicht in Stunden — eine Zeitumstellung verschiebt nichts.
 */
export function nachtlaufErreichtTag(
  datum: string, heute: string, tage: number = WETTER_ZUORDNUNG_TAGE,
): boolean {
  const tagNummer = (kalendertag: string): number => {
    const [j, m, t] = kalendertag.split('-').map(Number);
    return Date.UTC(j ?? Number.NaN, (m ?? Number.NaN) - 1, t ?? Number.NaN) / 86_400_000;
  };
  const abstand = tagNummer(heute) - tagNummer(datum);
  if (!Number.isFinite(abstand)) return false;
  return abstand < tage;
}

/** Was der Nachtlauf an einem Projekt braucht, bevor er fragen kann (§16, §25.2). */
export interface WetterVoraussetzung {
  /** Das Objekt der Baustelle traegt Breite und Laenge. */
  readonly koordinaten: boolean;
  /** Dem Projekt ist eine DWD-Station zugeordnet. */
  readonly station: boolean;
}

/**
 * Ob der Weg zum Wetter fuer dieses Projekt ueberhaupt offen ist — dieselben
 * zwei Pruefungen, mit denen `hefteWetterAn` VOR dem Abruf aufhoert
 * (`ohne_koordinaten`, `keine_station`). Ohne sie heftet auch der Nachtlauf
 * nichts an, und die Tagesseite sagt das mit dem Grund, statt ihn zu
 * versprechen. `null`, wenn das Projekt hier nicht zu sehen ist.
 */
export async function leseWetterVoraussetzung(
  kontext: LeseKontext, projektId: string,
): Promise<WetterVoraussetzung | null> {
  const [zeile] = await kontext.abfrage<{ koordinaten: boolean; station: boolean }>(
    `select (o.geo_lat is not null and o.geo_lon is not null) as koordinaten,
            coalesce(p.wetter_station_id, '') <> '' as station
       from projekt p
       left join objekt o on o.id = p.objekt_id and o.mandant_id = p.mandant_id
      where p.id = $1::uuid`,
    [projektId],
  );
  return zeile === undefined ? null : { koordinaten: zeile.koordinaten, station: zeile.station };
}

/**
 * Was der Nachtlauf fuer einen offenen Bautag ohne Wetter tun WIRD — die eine
 * Antwort, aus der die Tagesseite ihren Satz waehlt (V-183, D-677):
 *
 *  - `automatisch`: er heftet an, sobald der Tag vorbei ist;
 *  - `ohne_koordinaten` / `keine_station`: er fragt gar nicht erst — derselbe
 *    Grund, mit dem `hefteWetterAn` aufhoert, und die Pflege, die ihn behebt;
 *  - `ausserhalb_fenster`: der Tag liegt vor den letzten
 *    `WETTER_ZUORDNUNG_TAGE` Tagen, der Lauf erreicht ihn nie mehr.
 *
 * Ist die Voraussetzung nicht lesbar (`null`), wird nichts versprochen — sie
 * zaehlt wie fehlende Koordinaten.
 */
export type NachtlaufAussicht =
  | 'automatisch' | 'ausserhalb_fenster' | 'ohne_koordinaten' | 'keine_station';

export function nachtlaufAussicht(
  datum: string, heute: string, voraussetzung: WetterVoraussetzung | null,
): NachtlaufAussicht {
  if (voraussetzung === null || !voraussetzung.koordinaten) return 'ohne_koordinaten';
  if (!voraussetzung.station) return 'keine_station';
  return nachtlaufErreichtTag(datum, heute) ? 'automatisch' : 'ausserhalb_fenster';
}

/**
 * Fuehrt eine Arbeit in EINER eigenen Transaktion mit gebundenem Mandanten
 * aus — im Nachtlauf `alsJobSitzung`, im Test dasselbe. Je Bautag eine
 * eigene: der Abruf beim DWD darf dauern (30 s Zeitgrenze), und eine
 * Transaktion ueber alle Tage hielte waehrenddessen jede schon angeheftete
 * Zeile gesperrt.
 */
export type KontextLauf = <T>(
  arbeit: (kontext: SchreibKontext) => Promise<T>,
  optionen: { readonly schreibend: boolean },
) => Promise<T>;

export interface WetterZuordnung {
  /** Ob die Quelle verbunden ist. Ohne sie fragt der Lauf nichts und schreibt nichts. */
  readonly verbunden: boolean;
  /** Offene Bautage ohne Wetter im Fenster — die Tage, die der Lauf anfasst. */
  readonly offen: number;
  readonly angeheftet: number;
  /** Je Grund, warum ein Tag KEIN Wetter bekam (ohne `angeheftet`). */
  readonly befunde: Readonly<Partial<Record<WetterBefundArt, number>>>;
  /**
   * Tage im Fenster, die schon abgeschlossen waren, bevor der Lauf kam. An
   * sie heftet er nichts an: ab dem Abschluss bewegt sich am Tag nichts mehr
   * (0082), und ob das Wetter davon ausgenommen ist, fragt O-922.
   *
   * // TODO(client, O-922): Darf der Nachtlauf das DWD-Wetter an einen Bautag heften, der schon abgeschlossen ist — oder soll das Wetter vor dem Abschluss angeheftet werden, und der Abschluss ohne Wetter bleibt ohne?
   */
  readonly abgeschlossenOhneWetter: number;
}

/**
 * Heftet das Wetter an jeden offenen Bautag der letzten Tage, der noch keins
 * hat (`wetter_quelle = 'keine'`) — derselbe Weg wie der Knopf
 * (`hefteWetterAn`), mit `akteur = 'system'`.
 *
 * **Ohne verbundene Quelle geschieht nichts.** Der Lauf zaehlt die Tage, die
 * er angefasst HAETTE, und meldet `verbunden: false` — er fragt keinen
 * Adapter, schreibt kein „nicht verfuegbar" und erfindet keinen Wert. Dass
 * das Feld leer bleibt, ist die Aussage (BAU-08).
 *
 * **Ein Tag mit Wetter wird nie ueberschrieben** — weder ein angehefteter noch
 * ein von Hand eingetragener. Die Policy `j_wetter_anheften` (0468) haelt das
 * auch dann, wenn zwischen Lesen und Schreiben jemand von Hand eintraegt.
 */
export async function ordneWetterZu(
  lauf: KontextLauf,
  port: WetterPort,
  tage: number = WETTER_ZUORDNUNG_TAGE,
): Promise<WetterZuordnung> {
  const kandidaten = await lauf((kontext) => kontext.abfrage<{
    id: string; abgeschlossen: boolean;
  }>(
    `select b.id, (b.abgeschlossen_am is not null) as abgeschlossen
       from bautagebuch b
      where b.mandant_id = $1::uuid
        and b.storniert_am is null
        and b.wetter_quelle = 'keine'
        and b.datum >= app.berlin_heute() - $2::int
        and b.datum < app.berlin_heute()
      order by b.datum, b.id`,
    [kontext.aktiverMandantId, tage],
  ), { schreibend: false });

  const offen = kandidaten.filter((k) => !k.abgeschlossen);
  const abgeschlossenOhneWetter = kandidaten.length - offen.length;
  if (!port.verbunden) {
    return {
      verbunden: false, offen: offen.length, angeheftet: 0, befunde: {}, abgeschlossenOhneWetter,
    };
  }

  let angeheftet = 0;
  const befunde: Partial<Record<WetterBefundArt, number>> = {};
  for (const tag of offen) {
    const befund = await lauf(
      (kontext) => hefteWetterAn(kontext, { bautagebuchId: tag.id }, port, 'system'),
      { schreibend: true },
    );
    if (befund.art === 'angeheftet') angeheftet += 1;
    else befunde[befund.art] = (befunde[befund.art] ?? 0) + 1;
  }
  return { verbunden: true, offen: offen.length, angeheftet, befunde, abgeschlossenOhneWetter };
}
