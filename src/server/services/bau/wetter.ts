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

export const WETTER_SNAPSHOT_FASSUNG = 'bautagebuch-wetter-v1' as const;

export type WetterBefundArt =
  | 'angeheftet'
  | 'nicht_verbunden'
  | 'nicht_erreichbar'
  | 'unlesbar'
  | 'keine_daten'
  | 'ohne_koordinaten'
  | 'keine_station';

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
    default: return WETTER_NICHT_VERFUEGBAR;
  }
}

interface TagZeile {
  readonly id: string;
  readonly datum: string;
  readonly projekt_id: string;
  readonly abgeschlossen_am: string | null;
  readonly geo_lat: string | null;
  readonly geo_lon: string | null;
  readonly wetter_station_id: string | null;
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
): Promise<WetterBefund> {
  const [tag] = await kontext.abfrage<TagZeile>(
    `select b.id, to_char(b.datum, 'YYYY-MM-DD') as datum, b.projekt_id,
            to_char(b.abgeschlossen_am, 'YYYY-MM-DD"T"HH24:MI:SSOF') as abgeschlossen_am,
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

  await kontext.schreibe(
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
            geaendert_von_art = 'mensch'
      where id = $1 and mandant_id = $2 and abgeschlossen_am is null`,
    [
      tag.id, kontext.aktiverMandantId,
      kennungen.get(belegung.frueh) ?? null,
      belegung.mittag === null ? null : kennungen.get(belegung.mittag) ?? null,
      belegung.abend === null ? null : kennungen.get(belegung.abend) ?? null,
      schnappschuss,
      kennzahlen.temperaturMin, kennzahlen.temperaturMax, kennzahlen.niederschlag,
    ],
  );

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
