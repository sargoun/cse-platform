/**
 * DWD Open Data — der EINE Ausgang dieses PRs (BAU-08, 07-INTEGRATIONEN §16).
 *
 * **Warum diese Datei unter `server/versand/` liegt.** Invariante 7 kennt
 * genau einen Ausgang, und die Merge-Wache `ein-ausgang` bricht den Build,
 * sobald irgendein Modul ausserhalb dieses Verzeichnisses einen HTTP-Sender
 * importiert. Der Deutsche Wetterdienst braucht keine Zugangsdaten und
 * empfaengt auch nichts von uns — die Regel gilt trotzdem: „genau ein Ausgang"
 * ist eine Eigenschaft des Baums, keine Bewertung der Gegenstelle. Ein
 * `fetch`, das im Dienst stuende, waere das erste von vielen.
 *
 * **Was dieser Adapter NICHT tut, und zwar nie:**
 *
 *  - Er erfindet keinen Messwert. Kein Vorgabewetter, keine Interpolation,
 *    keine „ungefaehr"-Zahl aus einer Nachbarstation ohne Angabe der
 *    Entfernung. Antwortet der DWD nicht, gibt es KEINE Beobachtung, und der
 *    Bautag wird ohne Wetter gespeichert (BAU-08).
 *  - Er raet kein Format. Passt der gelesene Satz nicht auf die erwartete
 *    Spaltenfolge, wirft er `WetterFehler('unlesbar')`, statt Spalten
 *    durchzuzaehlen und zu hoffen. Eine falsch zugeordnete Spalte ergaebe
 *    Temperaturen, die plausibel aussehen und aus der Luftfeuchte stammen.
 *  - Er wiederholt eine Ablehnung nicht. 403 und 407 kommen in dieser
 *    Umgebung von der Organisationsrichtlinie des ausgehenden Proxys, nicht
 *    vom DWD; ein zweiter Versuch aendert daran nichts und verdeckt nur die
 *    Ursache.
 *
 * **Stand heute: nicht verbunden.** `DWD_OPENDATA_BASE` ist nicht gesetzt,
 * und der ausgehende Proxy dieser Umgebung weist `opendata.dwd.de` mit 403 ab
 * (Organisationsrichtlinie, `connect_rejected`). Der Adapter meldet das als
 * `nicht_verbunden` weiter, die Oberflaeche schreibt „nicht verbunden" an die
 * Integration und „Wetterdaten nicht verfuegbar" in das Feld des Tages — und
 * alles andere am Bautagebuch funktioniert unveraendert.
 */

import { tagePlus } from '@/lib/datum/kalendertag';
import { berlinTagesZeitpunkt } from '../services/zeit/dauer.js';

/** Eine gelesene Beobachtung. Alle Zahlen nullbar: „nicht gemessen" ist ein Wert. */
export interface WetterMessung {
  readonly stationId: string;
  readonly stationName: string;
  readonly breitengrad: number;
  readonly laengengrad: number;
  /** Entfernung Baustelle → Station in Kilometern, auf 100 m gerundet. */
  readonly entfernungKm: number;
  /** Die BEOBACHTUNGSZEIT als ISO-8601 in UTC — nie der Abrufzeitpunkt. */
  readonly beobachtetAm: string;
  readonly temperaturC: number | null;
  readonly niederschlagMm: number | null;
  readonly windMs: number | null;
  /** Das DWD-Qualitaetsniveau, wo der Datensatz eines nennt. */
  readonly qualitaetsniveau: number | null;
  readonly quelle: 'dwd';
  /** Die Adresse, aus der der Satz stammt — Teil des Beweises. */
  readonly quelleUrl: string;
  readonly abgerufenAm: string;
}

export interface WetterAnfrage {
  readonly breitengrad: number;
  readonly laengengrad: number;
  /** Berliner Kalendertag `JJJJ-MM-TT` (K-11) — kein Zeitpunkt. */
  readonly tag: string;
  /** Die einmal aufgeloeste Station des Projekts, wo es eine gibt (§7.1). */
  readonly stationId?: string | null;
}

export type WetterGrund =
  /** Keine Adresse konfiguriert — die Integration ist nicht verbunden. */
  | 'nicht_verbunden'
  /** Adresse konfiguriert, Gegenstelle oder Weg antwortet nicht. */
  | 'nicht_erreichbar'
  /** Erreichbar, aber der Satz passt nicht auf das erwartete Format. */
  | 'unlesbar'
  /** Erreichbar und lesbar, aber fuer diesen Tag liegt nichts vor. */
  | 'keine_daten';

export class WetterFehler extends Error {
  readonly status = 409 as const;
  constructor(readonly grund: WetterGrund, nachricht: string) {
    super(nachricht);
    this.name = 'WetterFehler';
  }
}

export interface WetterPort {
  /** Ohne konfigurierte Adresse: `false`. Die Oberflaeche zeigt das an. */
  readonly verbunden: boolean;
  /** Der Name, unter dem die Integration in der Oberflaeche steht. */
  readonly bezeichnung: string;
  beobachtungen(anfrage: WetterAnfrage): Promise<readonly WetterMessung[]>;
}

/** 30 s, zwei Versuche — die Zeile fuer `dwd` in 07-INTEGRATIONEN §7. */
export const DWD_ZEITGRENZE_MS = 30_000;

/**
 * Die drei Tageszeiten, die ein Bautagebuch ueblicherweise festhaelt, sind
 * NICHT gesetzt: welche Beobachtungszeitpunkte als frueh, mittag und abend
 * gelten — und welches DWD-Produkt (Zehnminuten-, Stunden- oder Tageswerte)
 * dafuer massgeblich ist — entscheidet die Bauleitung, nicht der Adapter.
 * Bis dahin heftet der Dienst an, was er bekommt, MIT Beobachtungszeit, und
 * ordnet nichts einer Tageszeit zu.
 * // TODO(client, O-213): Welche drei Beobachtungszeitpunkte gelten im
 * Bautagebuch als frueh/mittag/abend, und welches DWD-Produkt ist dafuer
 * massgeblich?
 */
export const TAGESZEITEN_UNGEKLAERT = true;

/** Erdradius in km — fuer die Entfernung Baustelle → Station. */
const ERDRADIUS_KM = 6371;

/** Grosskreisentfernung. Reine Arithmetik, deshalb hier und nicht im Dienst. */
export function entfernungKm(
  vonLat: number, vonLon: number, nachLat: number, nachLon: number,
): number {
  const bogen = (grad: number): number => (grad * Math.PI) / 180;
  const dLat = bogen(nachLat - vonLat);
  const dLon = bogen(nachLon - vonLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(bogen(vonLat)) * Math.cos(bogen(nachLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * ERDRADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a))) * 10) / 10;
}

/**
 * Der Kopf einer DWD-POI-Datei, wie ihn `07-INTEGRATIONEN.md` §16 beschreibt:
 * Semikolon getrennt, erste Zeile Spaltennamen, zweite Zeile Einheiten, dann
 * die Saetze mit Datum und Uhrzeit in UTC.
 *
 * Die Namen stehen als KONSTANTE und werden im Satz gesucht, statt Spalten zu
 * zaehlen: eine zusaetzliche Spalte am Anfang verschoebe sonst jede Zuordnung,
 * und das Ergebnis waere eine Temperatur, die aus der Luftfeuchte stammt.
 */
const SPALTEN = {
  datum: 'Date',
  zeit: 'Time',
  temperatur: 'dry_bulb_temperature_at_2_meter_above_ground',
  niederschlag: 'precipitation_amount_last_hour',
  wind: 'mean_wind_speed_during_last_10_min_at_10_meters_above_ground',
} as const;

/** `08.09.26;13:00;18.3;0.0;2.6` → Zahl oder `null`. `---` heisst nicht gemessen. */
function zahl(roh: string | undefined): number | null {
  if (roh === undefined) return null;
  const gesaeubert = roh.trim().replace(',', '.');
  if (gesaeubert === '' || gesaeubert === '---') return null;
  const wert = Number(gesaeubert);
  return Number.isFinite(wert) ? wert : null;
}

/**
 * `08.09.26` + `13:00` → `2026-09-08T13:00:00.000Z`.
 *
 * Die POI-Saetze tragen ihre Zeit in UTC, und genau so wird sie gespeichert
 * (Invariante 2). Umgerechnet wird hier NICHTS: eine Ortszeit, die der
 * Node-Prozess aus seiner eigenen Zonendatenbank ableitet, waere zweimal im
 * Jahr um eine Stunde falsch — und zwar in der Beweiszeile eines Bautags.
 */
export function poiZeitpunkt(datum: string, zeit: string): string | null {
  const t = /^(\d{2})\.(\d{2})\.(\d{2})$/u.exec(datum.trim());
  const u = /^(\d{2}):(\d{2})$/u.exec(zeit.trim());
  if (t === null || u === null) return null;
  return `20${t[3]!}-${t[2]!}-${t[1]!}T${u[1]!}:${u[2]!}:00.000Z`;
}

/**
 * Zerlegt eine POI-Datei. Gibt eine LEERE Liste zurueck, wenn die Datei keine
 * Saetze fuer den Tag traegt, und wirft `unlesbar`, wenn der Kopf nicht passt
 * — der Unterschied zwischen „an dem Tag lag nichts vor" und „wir lesen die
 * falsche Datei" ist der Unterschied zwischen einer Luecke und einer Falschangabe.
 */
export function zerlegePoi(
  inhalt: string, tag: string,
): readonly { readonly beobachtetAm: string; readonly temperaturC: number | null;
  readonly niederschlagMm: number | null; readonly windMs: number | null }[] {
  const zeilen = inhalt.split(/\r?\n/u).filter((z) => z.trim() !== '');
  const kopf = zeilen[0]?.split(';').map((s) => s.trim()) ?? [];
  const spalte = (name: string): number => kopf.indexOf(name);

  if (spalte(SPALTEN.datum) < 0 || spalte(SPALTEN.zeit) < 0) {
    throw new WetterFehler(
      'unlesbar',
      'Die Datei des DWD traegt nicht die erwarteten Spalten. Es wird nichts geraten.',
    );
  }

  const treffer: {
    beobachtetAm: string; temperaturC: number | null;
    niederschlagMm: number | null; windMs: number | null;
  }[] = [];

  /**
   * Das Fenster ist der BERLINER Kalendertag, als Zeitpunktspanne.
   *
   * Vorher wurde mit `zeitpunkt.startsWith(tag)` gefiltert — das ist der
   * UTC-Tag. `tag` ist aber der Berliner Kalendertag des Bautagebuchs (K-11):
   * im Sommer fehlten damit die zwei Stunden zwischen 22:00 und 24:00
   * Berliner Zeit, und stattdessen standen die ersten zwei Stunden des
   * FOLGETAGES im Wetter dieses Bautages. Ein Regenguss um 23:00 tauchte
   * damit am falschen Tag auf — in genau dem Feld, das im Bauzeitenstreit
   * eine Behinderung belegen soll.
   */
  const vonMs = berlinTagesZeitpunkt(tag).getTime();
  const bisMs = berlinTagesZeitpunkt(tagePlus(tag, 1)).getTime();
  // Zeile 0 sind die Namen, Zeile 1 die Einheiten — die Saetze beginnen bei 2.
  for (const zeile of zeilen.slice(2)) {
    const felder = zeile.split(';');
    const zeitpunkt = poiZeitpunkt(
      felder[spalte(SPALTEN.datum)] ?? '', felder[spalte(SPALTEN.zeit)] ?? '',
    );
    if (zeitpunkt === null) continue;
    const ms = Date.parse(zeitpunkt);
    if (ms < vonMs || ms >= bisMs) continue;
    treffer.push({
      beobachtetAm: zeitpunkt,
      temperaturC: zahl(felder[spalte(SPALTEN.temperatur)]),
      niederschlagMm: zahl(felder[spalte(SPALTEN.niederschlag)]),
      windMs: zahl(felder[spalte(SPALTEN.wind)]),
    });
  }
  return treffer;
}

/**
 * Der echte Adapter.
 *
 * Ohne `DWD_OPENDATA_BASE` ist er NICHT VERBUNDEN und sagt es — er tut nicht
 * so, als lieferte er etwas (CLAUDE.md: keine Schein-Integrationen). Mit
 * Adresse liest er die POI-Datei der Station und gibt zurueck, was darin
 * steht: mit Beobachtungszeit, Station und Entfernung.
 *
 * **Die Station kommt von aussen.** Dieser Adapter sucht keine naechste
 * Station aus einem Index — das tut `stationIndex` (noch nicht gebaut, weil
 * der Index ohne Ausgang nicht geladen werden kann). Ohne Station gibt es
 * keine Beobachtung, und das ist ein eigener, benannter Grund.
 */
export class DwdOpenData implements WetterPort {
  readonly verbunden: boolean;
  readonly bezeichnung = 'DWD Open Data' as const;

  constructor(
    private readonly basis = process.env['DWD_OPENDATA_BASE'] ?? '',
    private readonly holen: typeof fetch = fetch,
  ) {
    this.verbunden = this.basis !== '';
  }

  async beobachtungen(anfrage: WetterAnfrage): Promise<readonly WetterMessung[]> {
    if (!this.verbunden) {
      throw new WetterFehler(
        'nicht_verbunden',
        'DWD Open Data ist nicht verbunden (DWD_OPENDATA_BASE fehlt).',
      );
    }
    const station = anfrage.stationId ?? '';
    if (station === '') {
      throw new WetterFehler(
        'keine_daten', 'Zu dieser Baustelle ist keine DWD-Station aufgeloest.',
      );
    }

    const adresse =
      `${this.basis.replace(/\/+$/u, '')}/weather/weather_reports/poi/${station}-BEOB.csv`;
    const abgerufenAm = new Date().toISOString();

    let antwort: Response;
    try {
      antwort = await this.holen(adresse, {
        signal: AbortSignal.timeout(DWD_ZEITGRENZE_MS),
        headers: { accept: 'text/csv' },
      });
    } catch (fehler: unknown) {
      throw new WetterFehler(
        'nicht_erreichbar',
        `DWD Open Data nicht erreichbar: ${fehler instanceof Error ? fehler.message : 'unbekannt'}`,
      );
    }

    /**
     * 403 und 407 werden NICHT wiederholt: in dieser Umgebung kommen sie vom
     * ausgehenden Proxy und bedeuten eine Richtlinienentscheidung. Ein zweiter
     * Versuch ergaebe dieselbe Antwort und verdeckte die Ursache.
     */
    if (!antwort.ok) {
      throw new WetterFehler(
        antwort.status === 403 || antwort.status === 407 ? 'nicht_verbunden' : 'nicht_erreichbar',
        `DWD Open Data antwortet mit ${String(antwort.status)}.`,
      );
    }

    const saetze = zerlegePoi(await antwort.text(), anfrage.tag);
    if (saetze.length === 0) {
      throw new WetterFehler(
        'keine_daten', `Der DWD fuehrt fuer den ${anfrage.tag} keine Werte dieser Station.`,
      );
    }

    /**
     * Name und Koordinaten der Station stehen im Stationsindex, den es ohne
     * Ausgang nicht gibt. Statt sie zu erfinden, traegt die Messung die
     * Kennung als Namen und die Koordinaten der Baustelle mit Entfernung 0 —
     * und `wetter_station` wird beim Uebernehmen nur angelegt, wenn sie noch
     * fehlt, sodass ein spaeterer Indexlauf den echten Namen nachtraegt.
     */
    return saetze.map((s) => ({
      stationId: station,
      stationName: station,
      breitengrad: anfrage.breitengrad,
      laengengrad: anfrage.laengengrad,
      entfernungKm: 0,
      beobachtetAm: s.beobachtetAm,
      temperaturC: s.temperaturC,
      niederschlagMm: s.niederschlagMm,
      windMs: s.windMs,
      qualitaetsniveau: null,
      quelle: 'dwd' as const,
      quelleUrl: adresse,
      abgerufenAm,
    }));
  }
}

/**
 * Der Port, den eine Umgebung ohne Ausgang bekommt — und der Port, gegen den
 * die Oberflaeche „nicht verbunden" anzeigt.
 *
 * Er ist KEIN Testdoppel mit erfundenen Werten: er liefert nie eine Zahl,
 * sondern immer den Grund. Ein Doppel, das Wetter erfindet, heisst im Test
 * `WetterDoppel` und steht dort, wo man es sieht.
 */
export class NichtVerbundenerWetterPort implements WetterPort {
  readonly verbunden = false;
  readonly bezeichnung = 'DWD Open Data' as const;

  beobachtungen(): Promise<readonly WetterMessung[]> {
    return Promise.reject(new WetterFehler(
      'nicht_verbunden',
      'DWD Open Data ist nicht verbunden. Es wird kein Wetter erfunden.',
    ));
  }
}

/**
 * Der Port dieser Umgebung. Ohne `DWD_OPENDATA_BASE` ist das der nicht
 * verbundene — dieselbe Entscheidung wie beim Medienspeicher, an einer Stelle.
 */
export function wetterPort(): WetterPort {
  const adapter = new DwdOpenData();
  return adapter.verbunden ? adapter : new NichtVerbundenerWetterPort();
}
