/**
 * BAU-08 ohne Datenbank und ohne Netz — die reinen Teile des Wetterwegs.
 *
 * Was hier gepruet wird, ist die Zusage „es wird nichts erfunden" an der
 * Stelle, an der sie am leisesten brechen wuerde: in der Uebersetzung eines
 * gelesenen Satzes in einen Beweiswert. Drei Dinge:
 *
 *  1. **Ohne Adresse ist die Quelle NICHT VERBUNDEN und sagt es.** Sie
 *     liefert dann keinen Wert, sondern einen Grund — kein Vorgabewetter,
 *     keine Null, keine Interpolation.
 *  2. **Die Beobachtungszeit ist die der MESSUNG und in UTC.** Der Adapter
 *     rechnet nichts um: eine Ortszeit, die der Node-Prozess aus seiner
 *     eigenen Zonendatenbank ableitet, waere zweimal im Jahr um eine Stunde
 *     falsch — und zwar in der Beweiszeile eines Bautags.
 *  3. **Passt der Kopf nicht, wird nicht geraten.** Eine falsch zugeordnete
 *     Spalte ergaebe Temperaturen, die plausibel aussehen und aus der
 *     Luftfeuchte stammen.
 *
 * Der ausgehende Proxy dieser Umgebung weist `opendata.dwd.de` mit 403 ab
 * (Organisationsrichtlinie). Diese Datei fragt deshalb nie eine Adresse an —
 * sie prueft, was der Adapter aus einem TEXT macht, und das ist ohnehin der
 * Teil, der falsch sein kann.
 */
import { describe, expect, it } from 'vitest';
import {
  DwdOpenData, NichtVerbundenerWetterPort, WetterFehler,
  entfernungKm, poiZeitpunkt, wetterPort, zerlegePoi,
} from '../../src/server/versand/dwd.js';
import {
  WETTER_NICHT_VERFUEGBAR, WETTER_OHNE_KOORDINATEN, WETTER_QUELLENHINWEIS,
  baueWetterSchnappschuss, waehleBelegung, wetterFeldText, wetterKennzahlen,
} from '../../src/server/services/bau/wetter.js';
import { alsStunden } from '../../src/server/services/bau/bautagebuch.js';

/** Eine Messung, wie der Adapter sie zurueckgibt. Alle Werte stehen hier. */
function messung(beobachtetAm: string, temperaturC: number | null, niederschlagMm: number | null) {
  return {
    stationId: '00433',
    stationName: 'Berlin-Tempelhof',
    breitengrad: 52.4675,
    laengengrad: 13.4021,
    entfernungKm: 3.1,
    beobachtetAm,
    temperaturC,
    niederschlagMm,
    windMs: 2.6,
    qualitaetsniveau: null,
    quelle: 'dwd' as const,
    quelleUrl: 'https://opendata.example.invalid/00433-BEOB.csv',
    abgerufenAm: '2026-09-10T14:05:00.000Z',
  };
}

describe('ohne Adresse ist DWD Open Data nicht verbunden — und erfindet nichts', () => {
  it('`wetterPort()` gibt ohne DWD_OPENDATA_BASE den nicht verbundenen Port', () => {
    // Die Umgebung dieses Baums setzt die Variable nicht, und der ausgehende
    // Proxy weist den Host ohnehin mit 403 ab. Beides fuehrt auf denselben
    // ehrlichen Zustand: nicht verbunden.
    delete process.env['DWD_OPENDATA_BASE'];
    const port = wetterPort();
    expect(port.verbunden).toBe(false);
    expect(port).toBeInstanceOf(NichtVerbundenerWetterPort);
  });

  it('und er liefert einen GRUND, keinen Wert', async () => {
    const port = new NichtVerbundenerWetterPort();
    await expect(port.beobachtungen()).rejects.toThrow(WetterFehler);
    await expect(port.beobachtungen()).rejects.toThrow(/nicht verbunden/u);
  });

  it('ein Adapter ohne Basis fragt gar nicht erst an', async () => {
    let angefragt = 0;
    const adapter = new DwdOpenData('', (async () => {
      angefragt += 1;
      return new Response('');
    }) as unknown as typeof fetch);
    await expect(adapter.beobachtungen({
      breitengrad: 52.5, laengengrad: 13.3, tag: '2026-09-10',
    })).rejects.toThrow(WetterFehler);
    // Kein Netzverkehr: die Entscheidung faellt VOR dem Aufruf.
    expect(angefragt).toBe(0);
  });

  it('der Feldtext ist der woertliche Satz aus BAU-08 — und „ohne Koordinaten" ein EIGENER',
    () => {
      for (const grund of ['nicht_verbunden', 'nicht_erreichbar', 'unlesbar', 'keine_daten'] as const) {
        expect(wetterFeldText(grund)).toBe(WETTER_NICHT_VERFUEGBAR);
      }
      // Ein Pflegefehler, den jemand beheben kann — nicht eine Aussage ueber
      // die Quelle. Beides in einen Satz zu legen laesst das fehlende
      // Koordinatenpaar jahrelang stehen.
      expect(wetterFeldText('ohne_koordinaten')).toBe(WETTER_OHNE_KOORDINATEN);
      expect(wetterFeldText('angeheftet')).toBe(WETTER_QUELLENHINWEIS);
    });
});

describe('die Beobachtungszeit ist die der Messung, in UTC', () => {
  it('`08.09.26` + `13:00` wird zu einem UTC-Zeitpunkt, ohne Umrechnung', () => {
    expect(poiZeitpunkt('08.09.26', '13:00')).toBe('2026-09-08T13:00:00.000Z');
    expect(poiZeitpunkt('8.9.26', '13:00')).toBeNull();
    expect(poiZeitpunkt('08.09.26', '13 Uhr')).toBeNull();
  });

  it('zerlegt eine POI-Datei und nimmt nur die Saetze DES Tages', () => {
    const datei = [
      'Date;Time;dry_bulb_temperature_at_2_meter_above_ground;'
      + 'precipitation_amount_last_hour;'
      + 'mean_wind_speed_during_last_10_min_at_10_meters_above_ground',
      'dd.mm.yy;hh:mm;°C;mm;m/s',
      '09.09.26;13:00;17.1;0.0;3.0',
      '10.09.26;05:00;11.4;0.0;2.1',
      '10.09.26;11:00;18.3;0.2;2.6',
      '10.09.26;17:00;15.1;---;1.9',
    ].join('\n');

    const saetze = zerlegePoi(datei, '2026-09-10');
    expect(saetze).toHaveLength(3);
    expect(saetze[0]!.beobachtetAm).toBe('2026-09-10T05:00:00.000Z');
    expect(saetze[1]!.temperaturC).toBe(18.3);
    // `---` heisst NICHT GEMESSEN und wird zu null — nicht zu 0. „0 mm" und
    // „keine Angabe" sind zwei verschiedene Aussagen.
    expect(saetze[2]!.niederschlagMm).toBeNull();
  });

  it('ein unbekannter Kopf wird ABGEWIESEN, statt Spalten zu zaehlen', () => {
    expect(() => zerlegePoi('a;b;c\n1;2;3\n4;5;6', '2026-09-10'))
      .toThrow(/nicht die erwarteten Spalten/u);
  });

  it('ein Tag ohne Saetze ist eine LEERE Liste, kein Fehler', () => {
    const datei = [
      'Date;Time;dry_bulb_temperature_at_2_meter_above_ground',
      'dd.mm.yy;hh:mm;°C',
      '09.09.26;13:00;17.1',
    ].join('\n');
    // Der Unterschied zwischen „an dem Tag lag nichts vor" und „wir lesen die
    // falsche Datei" ist der zwischen einer Luecke und einer Falschangabe.
    expect(zerlegePoi(datei, '2026-09-10')).toEqual([]);
  });
});

describe('der Schnappschuss traegt Station und Beobachtungszeit', () => {
  const messungen = [
    messung('2026-09-10T11:00:00.000Z', 18.3, 0.2),
    messung('2026-09-10T05:00:00.000Z', 11.4, 0),
    messung('2026-09-10T17:00:00.000Z', 15.1, 1.4),
  ];

  it('nennt Station, frueheste Beobachtungszeit, Entfernung und den Quellenhinweis', () => {
    const s = baueWetterSchnappschuss(messungen);
    expect(s.station_id).toBe('00433');
    expect(s.station_name).toBe('Berlin-Tempelhof');
    // Die FRUEHESTE, nicht die zuerst gelieferte: die Liste kommt unsortiert.
    expect(s.beobachtet_am).toBe('2026-09-10T05:00:00.000Z');
    expect(s.entfernung_km).toBe('3.1');
    // §16: die Namensnennung ist Bedingung der Nutzung, keine Hoeflichkeit.
    expect(s.quellenhinweis).toBe(WETTER_QUELLENHINWEIS);
  });

  it('haelt jede Zahl als TEXT — eine Gleitkommazahl im Beweisobjekt ist eine Falle', () => {
    const s = baueWetterSchnappschuss(messungen);
    for (const wert of s.werte) {
      expect(typeof wert.temperatur_c === 'string' || wert.temperatur_c === null).toBe(true);
      expect(typeof wert.niederschlag_mm === 'string' || wert.niederschlag_mm === null)
        .toBe(true);
    }
  });

  it('ohne Beobachtung gibt es KEINEN Schnappschuss', () => {
    expect(() => baueWetterSchnappschuss([])).toThrow(WetterFehler);
    expect(() => waehleBelegung([])).toThrow(WetterFehler);
  });

  it('Kennzahlen werden gerechnet, nicht geraten', () => {
    const k = wetterKennzahlen(messungen);
    expect(k.temperaturMin).toBe('11.4');
    expect(k.temperaturMax).toBe('18.3');
    // Summe der angehefteten Stundenwerte, einmal gerundet, am Ende.
    expect(k.niederschlag).toBe('1.60');
  });

  it('ohne gemessene Werte bleiben die Kennzahlen NULL — nicht 0', () => {
    const k = wetterKennzahlen([messung('2026-09-10T05:00:00.000Z', null, null)]);
    expect(k.temperaturMin).toBeNull();
    expect(k.niederschlag).toBeNull();
  });

  it('die Belegung ist eine ORDNUNG, keine Tageszeit (O-213)', () => {
    const b = waehleBelegung(messungen);
    expect(b.frueh).toBe('2026-09-10T05:00:00.000Z');
    expect(b.abend).toBe('2026-09-10T17:00:00.000Z');
    // Bei zwei Beobachtungen gibt es keine Mitte, und es wird keine erfunden.
    const zwei = waehleBelegung(messungen.slice(0, 2));
    expect(zwei.mittag).toBeNull();
  });
});

describe('Entfernung und Anzeige', () => {
  it('die Grosskreisentfernung Baustelle → Station, auf 100 m gerundet', () => {
    // Berlin-Tempelhof (52.4675/13.4021) → Berlin-Tegel (52.5644/13.3088):
    // gut elf Kilometer. Eine Zahl in dieser Groessenordnung ist der
    // Unterschied zwischen „3 km" und „40 km" — und der ist Beweisgewicht.
    const km = entfernungKm(52.4675, 13.4021, 52.5644, 13.3088);
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(13);
    expect(entfernungKm(52.4675, 13.4021, 52.4675, 13.4021)).toBe(0);
  });

  it('Personenminuten werden mit deutschem Komma angezeigt', () => {
    expect(alsStunden(480)).toBe('8,00');
    expect(alsStunden(450)).toBe('7,50');
    expect(alsStunden(-30)).toBe('-0,50');
  });
});
