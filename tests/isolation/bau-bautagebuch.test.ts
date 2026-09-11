/**
 * PR 45 gegen die echte Datenbank — das Bautagebuch (BAU-07, BAU-08).
 *
 * Die drei Abnahmekriterien des PR-Plans, und jedes hier, weil keines ohne
 * eine echte Postgres-Instanz zu pruefen ist: die Unaenderbarkeit sind
 * AUSLOESER, das Wetter haengt an einer Definer-Funktion und einer
 * `jsonb`-Bedingung, und der Abgleich ist eine Abfrage ueber zwei Domaenen
 * unter RLS.
 *
 *  1. **Ein Tageseintrag haelt Wetter, Mannstunden je Gewerk, Geraete,
 *     Lieferungen, Vorkommnisse und Fotos fest — nur anfuegbar, mit
 *     unveraenderlicher Korrekturspur.** Eine Mannstundenzahl, die sich
 *     nachtraeglich bewegen laesst, belegt nichts.
 *  2. **Das Wetter kommt vom DWD, MIT Beobachtungszeit und Station** — und
 *     wenn es nicht zu bekommen ist, speichert der Tag trotzdem, das Feld
 *     sagt „Wetterdaten nicht verfuegbar", und es wird nichts erfunden.
 *  3. **Die Mannstunden werden gegen `zeiteintrag` desselben Tages und
 *     derselben Baustelle gehalten — eine Abweichung wird GEMELDET.**
 *
 * **Das Doppel heisst Doppel.** `WetterDoppel` steht hier, in der Testdatei,
 * und nirgends sonst: ein Testdoppel, das im Anwendungsbaum liegt, ist
 * irgendwann das, was in der Auslieferung antwortet. Der echte Adapter
 * (`server/versand/dwd.ts`) wird in dieser Datei NIE aufgerufen — es geht
 * nichts nach draussen.
 */
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  WetterFehler, type WetterMessung, type WetterPort,
} from '../../src/server/versand/dwd.js';
import {
  WETTER_NICHT_VERFUEGBAR, hefteWetterAn, leseWetterAnzeige, wetterFeldText,
} from '../../src/server/services/bau/wetter.js';
import {
  BautagebuchFehler, ersetzeBautag, findeBautagZuDatum, gleicheMannstundenAb,
  hefteMannstundenAn, heftePositionAn, hefteTagesfotoAn, korrigiereMannstunden, legeBautagAn,
  leseMannstunden, lesePositionen, leseTagesfotos, schliesseBautag,
} from '../../src/server/services/bau/bautagebuch.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Der Bautag, an dem alles hier spielt — ein BERLINER Kalendertag (K-11). */
const TAG = '2026-09-10';

interface Aufbau {
  readonly mandant: string;
  readonly projekt: string;
  readonly objekt: string;
  readonly gewerkRohbau: string;
  readonly gewerkElektro: string;
  readonly benutzer: string;
  readonly person: string;
  readonly anstellung: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

/**
 * Eine Baustelle mit Koordinaten, zwei Gewerken und einer Beschaeftigung.
 *
 * Die Koordinaten stehen am OBJEKT und nicht am Projekt — genau da sucht sie
 * `hefteWetterAn`, und ohne sie ist der Befund `ohne_koordinaten`: ein
 * EIGENER Grund, nicht „der DWD hatte keine Daten".
 */
async function baueBaustelle(mandant: string, mitGeo = true): Promise<Aufbau> {
  const benutzer = await konto(`btb-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId('leitung')]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort,
                         geo_lat, geo_lon)
     values ($1,$2,$3,'Baustelle Nord','Musterweg','13403','Berlin',
             $4::numeric,$5::numeric) returning id`,
    [mandant, k!.id, `O-${zufall()}`,
      mitGeo ? '52.560000' : null, mitGeo ? '13.330000' : null] as never[]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum, objekt_id)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01',$5) returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer, o!.id] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, objekt_id)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b',$5) returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id, o!.id] as never[]);

  const gewerke: string[] = [];
  for (const [code, bezeichnung] of [['ROH', 'Rohbau'], ['ELT', 'Elektro']]) {
    const [g] = await sql.unsafe<{ id: string }[]>(
      `insert into gewerk (mandant_id, code, bezeichnung, erstellt_von_art)
       values ($1,$2,$3,'system') returning id`,
      [mandant, `${code!}-${zufall()}`, bezeichnung!] as never[]);
    gewerke.push(g!.id);
  }

  const [person] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Polier',$1) returning id`,
    [`Nr-${zufall()}`]);
  const [anst] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [mandant, person!.id, `PN-${zufall()}`] as never[]);

  return {
    mandant, projekt: p!.id, objekt: o!.id,
    gewerkRohbau: gewerke[0]!, gewerkElektro: gewerke[1]!,
    benutzer, person: person!.id, anstellung: anst!.id,
  };
}

/** Ein abgeschlossener Zeiteintrag auf der Baustelle. `netto = brutto − Pause`. */
async function zeiteintrag(
  bau: Aufbau, beginn: string, ende: string, pause = 0,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, objekt_id, projekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, erstellt_von_art)
     values ($1,$2,$3,$4::uuid,$5::uuid,$6::timestamptz,$7::timestamptz,$8,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [bau.mandant, bau.anstellung, bau.person, bau.objekt, bau.projekt,
      beginn, ende, pause] as never[]);
  return z!.id;
}

/**
 * Wie viele Beobachtungen stehen in `wetter_beobachtung` — gesamt oder zu
 * einer Station und einem Zeitpunkt.
 *
 * Gezaehlt wird, statt geleert zu werden: die Tabelle traegt kein
 * `mandant_id` und ueberlebt den Fixture-Aufbau; sie ist oeffentliche
 * Referenz und kennt ohnehin keine Loeschung (0083, Invariante 8).
 */
async function beobachtungen(station?: string, zeitpunkt?: string): Promise<number> {
  const [z] = await sql.unsafe<{ n: string }[]>(
    `select count(*)::text as n from wetter_beobachtung
      where ($1::text is null or station_id = $1::text)
        and ($2::timestamptz is null or zeitpunkt = $2::timestamptz)`,
    [station ?? null, zeitpunkt ?? null] as never[]);
  return Number(z!.n);
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

/** Laeuft als `cse_app` mit gebundener Sitzung — nie als Eigentuemer. */
async function alsBauleitung<T>(
  bau: Aufbau, fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [bau.mandant]);
    await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [bau.mandant]);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [bau.benutzer]);
    await tx.unsafe(`select set_config('app.person_id', '', true)`);
    await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    return fn(kontextAus(tx, bau.mandant, bau.benutzer));
  }) as Promise<T>;
}

/* ---------------------------------------------------------------------------
 * Das DOPPEL. Es heisst so, es steht hier, und es geht nichts nach draussen.
 * ------------------------------------------------------------------------ */

/**
 * `WetterDoppel` — eine Quelle, die liefert, was ihr mitgegeben wurde.
 *
 * Es erfindet KEINE Zahlen von sich aus: jeder Wert steht im Test, den man
 * gerade liest. Ein Doppel mit eingebauten „plausiblen" Messwerten waere
 * genau die Schein-Integration, die CLAUDE.md verbietet — und der Test saehe
 * gruen aus, waehrend niemand weiss, woher die Zahl kam.
 */
class WetterDoppel implements WetterPort {
  readonly verbunden = true;
  readonly bezeichnung = 'WetterDoppel (Test)' as const;
  constructor(private readonly messungen: readonly WetterMessung[]) {}
  beobachtungen(): Promise<readonly WetterMessung[]> {
    return Promise.resolve(this.messungen);
  }
}

/** Ein Doppel, das den Grund meldet, den der echte Adapter melden wuerde. */
class StummesWetterDoppel implements WetterPort {
  readonly verbunden = false;
  readonly bezeichnung = 'WetterDoppel (Test, stumm)' as const;
  constructor(private readonly grund: 'nicht_verbunden' | 'nicht_erreichbar') {}
  beobachtungen(): Promise<readonly WetterMessung[]> {
    return Promise.reject(new WetterFehler(this.grund, 'Doppel antwortet nicht.'));
  }
}

function messung(
  beobachtetAm: string, temperaturC: number | null, niederschlagMm: number | null,
): WetterMessung {
  return {
    stationId: '00433',
    stationName: 'Berlin-Tempelhof',
    breitengrad: 52.4675,
    laengengrad: 13.4021,
    entfernungKm: 0,
    beobachtetAm,
    temperaturC,
    niederschlagMm,
    windMs: 2.6,
    qualitaetsniveau: null,
    quelle: 'dwd',
    quelleUrl: 'https://opendata.example.invalid/00433-BEOB.csv',
    abgerufenAm: '2026-09-10T14:05:00.000Z',
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

/* =========================================================================
 * (1) Nur anfuegbar, mit unveraenderlicher Korrekturspur
 * ====================================================================== */

describe('(1) der Tag ist nur anfuegbar, und die Korrekturspur bleibt stehen', () => {
  it('haelt Mannstunden je Gewerk, Geraet, Lieferung und Vorkommnis', async () => {
    const bau = await baueBaustelle(f.bau);
    await alsBauleitung(bau, async (kontext) => {
      const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      await hefteMannstundenAn(kontext, {
        bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
        anzahlPersonen: 4, dauerMinuten: 480, taetigkeit: 'Schalung Achse C',
      });
      await hefteMannstundenAn(kontext, {
        bautagebuchId: tag, gewerkId: bau.gewerkElektro, herkunft: 'nachunternehmer',
        nachunternehmerName: 'Elektro Sued GmbH', anzahlPersonen: 2, dauerMinuten: 300,
      });
      await heftePositionAn(kontext, {
        bautagebuchId: tag, art: 'geraet', bezeichnung: 'Turmdrehkran',
      });
      await heftePositionAn(kontext, {
        bautagebuchId: tag, art: 'lieferung', bezeichnung: 'Bewehrung',
        menge: '3.000', einheit: 't', lieferscheinNummer: '4711',
      });
      await heftePositionAn(kontext, {
        bautagebuchId: tag, art: 'vorkommnis', bezeichnung: 'Stromausfall',
        beschreibung: 'Baustrom 09:10 bis 10:40 ausgefallen',
      });

      const stunden = await leseMannstunden(kontext, tag);
      expect(stunden).toHaveLength(2);
      // Nach GEWERK gesucht statt nach Position in der Liste: zwei Zeilen
      // derselben Transaktion tragen dasselbe `erstellt_am`, und ein Test,
      // der sich auf die Reihenfolge verlaesst, ist von Lauf zu Lauf anders.
      const rohbau = stunden.find((z) => z.gewerk_id === bau.gewerkRohbau)!;
      const elektro = stunden.find((z) => z.gewerk_id === bau.gewerkElektro)!;
      // 4 Personen × 480 Minuten ÷ 60 = 32,00 — eine erzeugte Spalte, die von
      // ihren Eingaben nicht abweichen kann.
      expect(rohbau.mannstunden).toBe('32.00');
      expect(elektro.nachunternehmer).toBe('Elektro Sued GmbH');

      const positionen = await lesePositionen(kontext, tag);
      expect(positionen.map((p) => p.art).sort()).toEqual(
        ['geraet', 'lieferung', 'vorkommnis'],
      );
    });
  });

  it('ein Foto haengt am Tag — die Registerzeile aus 0082 traegt den Bezug', async () => {
    /**
     * Ohne die Zeile `('bautagebuch','bau',null)` in `einsatz_medien_bezug`
     * und ohne die beiden schmalen Policies aus 0082 weist
     * `kern.einsatz_medien_bezug_pruefen()` JEDES Tagebuchfoto ab — und zwar
     * erst beim ersten Upload, Monate spaeter, mitten auf einer Baustelle.
     * Deshalb steht der Weg hier und nicht nur in der Migration.
     */
    const bau = await baueBaustelle(f.bau);
    await alsBauleitung(bau, async (kontext) => {
      const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      await hefteTagesfotoAn(kontext, {
        bautagebuchId: tag,
        medienId: randomUUID(),
        art: 'foto',
        bucket: 'einsatz-medien',
        pfad: `${bau.mandant}/${randomUUID()}`,
        mimeTyp: 'image/jpeg',
        groesseBytes: 12345,
        sha256: 'a'.repeat(64),
        beschreibung: 'Schalung Achse C',
      });

      const fotos = await leseTagesfotos(kontext, tag);
      expect(fotos).toHaveLength(1);
      expect(fotos[0]!.beschreibung).toBe('Schalung Achse C');
      expect(fotos[0]!.mime_typ).toBe('image/jpeg');
    });
  });

  it('ein Vorkommnis ohne Beschreibung dokumentiert nichts und wird abgewiesen', async () => {
    const bau = await baueBaustelle(f.bau);
    await alsBauleitung(bau, async (kontext) => {
      const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      await expect(heftePositionAn(kontext, {
        bautagebuchId: tag, art: 'vorkommnis', bezeichnung: 'Etwas',
      })).rejects.toThrow(BautagebuchFehler);
    });
  });

  it('eine Mannstundenzeile laesst sich NICHT aendern — auch nicht am Eigentuemer vorbei',
    async () => {
      const bau = await baueBaustelle(f.bau);
      const zeile = await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        return hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 4, dauerMinuten: 480,
        });
      });
      // Der Ausloeser, nicht der Dienst: ein zusammengebautes UPDATE kommt
      // genauso wenig durch wie ein Aufruf ueber die Schicht.
      await expect(sql.unsafe(
        `update bautagebuch_mannstunden set anzahl_personen = 9 where id = $1`, [zeile],
      )).rejects.toThrow(/nicht geaendert/u);
      await expect(sql.unsafe(
        `delete from bautagebuch_mannstunden where id = $1`, [zeile],
      )).rejects.toThrow();
    });

  it('die Korrektur ist eine NEUE Zeile, und die alte bleibt lesbar stehen', async () => {
    const bau = await baueBaustelle(f.bau);
    await alsBauleitung(bau, async (kontext) => {
      const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      const falsch = await hefteMannstundenAn(kontext, {
        bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
        anzahlPersonen: 9, dauerMinuten: 480,
      });
      const richtig = await korrigiereMannstunden(kontext, {
        zeileId: falsch,
        grund: 'Zahlendreher: es waren vier, nicht neun',
        ersatz: {
          gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 4, dauerMinuten: 480,
        },
      });

      const zeilen = await leseMannstunden(kontext, tag);
      // BEIDE stehen im Buch. Dass zuerst etwas anderes dastand, gehoert zur
      // Wahrheit des Tages — eine Liste mit nur der richtigen Zeile waere ein
      // geglaettetes Bautagebuch.
      expect(zeilen).toHaveLength(2);
      const alt = zeilen.find((z) => z.id === falsch)!;
      const neu = zeilen.find((z) => z.id === richtig)!;
      expect(alt.storniert).toBe(true);
      expect(alt.storno_grund).toMatch(/Zahlendreher/u);
      expect(alt.ersetzt_durch_id).toBe(richtig);
      expect(neu.storniert).toBe(false);
      expect(neu.ersetzt_id).toBe(falsch);
      expect(neu.anzahl_personen).toBe(4);
    });
  });

  it('ein Storno wird nicht zurueckgenommen', async () => {
    const bau = await baueBaustelle(f.bau);
    const zeile = await alsBauleitung(bau, async (kontext) => {
      const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      const falsch = await hefteMannstundenAn(kontext, {
        bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
        anzahlPersonen: 9, dauerMinuten: 480,
      });
      await korrigiereMannstunden(kontext, {
        zeileId: falsch, grund: 'Zahlendreher',
        ersatz: {
          gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 4, dauerMinuten: 480,
        },
      });
      return falsch;
    });
    await expect(sql.unsafe(
      `update bautagebuch_mannstunden set storniert_am = null where id = $1`, [zeile],
    )).rejects.toThrow(/nicht zurueckgenommen/u);
  });

  it('nach dem Abschluss kommt keine Zeile mehr hinzu — und der Dienst sagt, was stattdessen gilt',
    async () => {
      const bau = await baueBaustelle(f.bau);
      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        await hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 4, dauerMinuten: 480,
        });
        await schliesseBautag(kontext, tag);

        await expect(heftePositionAn(kontext, {
          bautagebuchId: tag, art: 'geraet', bezeichnung: 'Nachtrag',
        })).rejects.toThrow(/Ersatztag/u);
      });
    });

  it('der Ersatztag traegt die Spur: der alte bleibt lesbar und zeigt auf ihn', async () => {
    const bau = await baueBaustelle(f.bau);
    await alsBauleitung(bau, async (kontext) => {
      const alt = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      await schliesseBautag(kontext, alt);
      const neu = await ersetzeBautag(kontext, {
        bautagebuchId: alt, grund: 'Falsche Baustelle gebucht',
      });

      // Der LEBENDE Tag dieses Datums ist der Ersatz — der eindeutige Index
      // laesst genau einen zu.
      const lebend = await findeBautagZuDatum(kontext, bau.projekt, TAG);
      expect(lebend!.id).toBe(neu);
      expect(lebend!.ersetzt_id).toBe(alt);
    });

    const [alt] = await sql.unsafe<{ storniert: boolean; grund: string; ersatz: string }[]>(
      `select (storniert_am is not null) as storniert, storno_grund as grund,
              ersetzt_durch_id as ersatz
         from bautagebuch where datum = $1 and storniert_am is not null`, [TAG]);
    expect(alt!.storniert).toBe(true);
    expect(alt!.grund).toMatch(/Falsche Baustelle/u);
    expect(alt!.ersatz).not.toBeNull();
  });
});

/* =========================================================================
 * (2) Das Wetter — mit Beobachtungszeit und Station, oder gar nicht
 * ====================================================================== */

describe('(2) das Wetter kommt vom DWD, mit Beobachtungszeit und Station', () => {
  it('heftet an, was die Quelle gemessen hat — Station und Zeit im Schnappschuss',
    async () => {
      const bau = await baueBaustelle(f.bau);
      await sql.unsafe(
        `insert into wetter_station (id, name, breitengrad, laengengrad)
         values ('00433','Berlin-Tempelhof',52.4675,13.4021) on conflict do nothing`);
      await sql.unsafe(
        `update projekt set wetter_station_id = '00433' where id = $1`, [bau.projekt]);

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        const befund = await hefteWetterAn(kontext, { bautagebuchId: tag }, new WetterDoppel([
          messung('2026-09-10T05:00:00.000Z', 11.4, 0),
          messung('2026-09-10T11:00:00.000Z', 18.3, 0.2),
          messung('2026-09-10T17:00:00.000Z', 15.1, 1.4),
        ]));

        expect(befund.art).toBe('angeheftet');
        expect(befund.beobachtungen).toBe(3);
        expect(befund.stationId).toBe('00433');

        const anzeige = await leseWetterAnzeige(kontext, tag);
        expect(anzeige!.quelle).toBe('dwd');
        expect(anzeige!.station).toBe('Berlin-Tempelhof');
        // Die BEOBACHTUNGSZEIT, nicht der Abrufzeitpunkt — und in Berliner
        // Ortszeit angezeigt: 05:00 UTC ist im September 07:00 in Berlin.
        expect(anzeige!.beobachtetAmLokal).toBe('10.09.2026 07:00');
        expect(anzeige!.temperaturMin).toBe('11.4');
        expect(anzeige!.temperaturMax).toBe('18.3');
      });
    });

  it('der Schnappschuss ist ein jsonb-OBJEKT, kein kodierter String', async () => {
    // Die Falle, die `jsonb` am haeufigsten kaputtmacht: `JSON.stringify(obj)`
    // in einen `$n::jsonb`-Parameter legt eine JSON-ZEICHENKETTE ab, und
    // `->>` liefert danach NULL. Die Bedingung aus 0083 faengt das beim
    // Schreiben ab — dieser Test beweist, dass sie nicht umgangen wird.
    const bau = await baueBaustelle(f.bau);
    await sql.unsafe(
      `insert into wetter_station (id, name, breitengrad, laengengrad)
       values ('00433','Berlin-Tempelhof',52.4675,13.4021) on conflict do nothing`);
    await sql.unsafe(
      `update projekt set wetter_station_id = '00433' where id = $1`, [bau.projekt]);

    const tag = await alsBauleitung(bau, async (kontext) => {
      const id = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
      await hefteWetterAn(kontext, { bautagebuchId: id }, new WetterDoppel([
        messung('2026-09-10T11:00:00.000Z', 18.3, 0.2),
      ]));
      return id;
    });

    const [zeile] = await sql.unsafe<{
      typ: string; station: string | null; beobachtet: string | null; quelle: string;
    }[]>(
      `select jsonb_typeof(wetter_snapshot) as typ,
              wetter_snapshot ->> 'station_id' as station,
              wetter_snapshot ->> 'beobachtet_am' as beobachtet,
              wetter_quelle::text as quelle
         from bautagebuch where id = $1`, [tag]);
    expect(zeile!.typ).toBe('object');
    expect(zeile!.station).toBe('00433');
    expect(zeile!.beobachtet).toBe('2026-09-10T11:00:00.000Z');
    expect(zeile!.quelle).toBe('dwd');

    // Und die Beobachtung steht wirklich in `wetter_beobachtung` — mit der
    // BEOBACHTUNGSZEIT als Schluessel, nicht mit dem Abrufzeitpunkt.
    expect(await beobachtungen('00433', '2026-09-10T11:00:00Z')).toBe(1);
  });

  it('ist die Quelle nicht zu erreichen, SPEICHERT der Tag trotzdem — und nichts wird erfunden',
    async () => {
      const bau = await baueBaustelle(f.bau);
      await sql.unsafe(
        `insert into wetter_station (id, name, breitengrad, laengengrad)
         values ('00433','Berlin-Tempelhof',52.4675,13.4021) on conflict do nothing`);
      await sql.unsafe(
        `update projekt set wetter_station_id = '00433' where id = $1`, [bau.projekt]);
      const vorher = await beobachtungen();

      const tag = await alsBauleitung(bau, async (kontext) => {
        const id = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        await hefteMannstundenAn(kontext, {
          bautagebuchId: id, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 4, dauerMinuten: 480,
        });
        const befund = await hefteWetterAn(
          kontext, { bautagebuchId: id }, new StummesWetterDoppel('nicht_erreichbar'),
        );
        // KEIN Wurf: ein Fehler an dieser Stelle haette den Tag mitgerissen.
        expect(befund.art).toBe('nicht_erreichbar');
        expect(befund.text).toBe(WETTER_NICHT_VERFUEGBAR);

        const anzeige = await leseWetterAnzeige(kontext, id);
        expect(anzeige!.quelle).toBe('keine');
        expect(anzeige!.text).toBe(WETTER_NICHT_VERFUEGBAR);
        // Der Tag und seine Stunden stehen unveraendert.
        expect(await leseMannstunden(kontext, id)).toHaveLength(1);
        return id;
      });

      const [zeile] = await sql.unsafe<{
        quelle: string; snapshot: unknown; tmin: string | null; niederschlag: string | null;
      }[]>(
        `select wetter_quelle::text as quelle, wetter_snapshot as snapshot,
                temperatur_min_c::text as tmin, niederschlag_mm::text as niederschlag
           from bautagebuch where id = $1`, [tag]);
      // „keine" heisst KEINE Zahl — die Bedingung aus 0083 laesst nichts
      // anderes zu. Kein Vorgabewetter, keine Null, keine Interpolation.
      expect(zeile!.quelle).toBe('keine');
      expect(zeile!.snapshot).toBeNull();
      expect(zeile!.tmin).toBeNull();
      expect(zeile!.niederschlag).toBeNull();
      // Und es wurde auch keine Messung abgelegt: `vorher` zaehlt, was schon
      // dastand — `wetter_beobachtung` traegt kein `mandant_id` und wird
      // deshalb vom Fixture-Aufbau NICHT geleert (Referenzdaten, 0083).
      expect(await beobachtungen()).toBe(vorher);
    });

  it('ohne Koordinaten am Objekt ist der Grund ein EIGENER, nicht „DWD hatte nichts"',
    async () => {
      const bau = await baueBaustelle(f.bau, false);
      await alsBauleitung(bau, async (kontext) => {
        const id = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        const befund = await hefteWetterAn(kontext, { bautagebuchId: id }, new WetterDoppel([
          messung('2026-09-10T11:00:00.000Z', 18.3, 0),
        ]));
        expect(befund.art).toBe('ohne_koordinaten');
        expect(befund.text).not.toBe(WETTER_NICHT_VERFUEGBAR);
        expect(befund.text).toBe(wetterFeldText('ohne_koordinaten'));
      });
    });
});

/* =========================================================================
 * (3) Der Abgleich gegen die Zeiterfassung
 * ====================================================================== */

describe('(3) die Mannstunden werden gegen `zeiteintrag` gehalten — und Abweichung gemeldet',
  () => {
    it('deckungsgleich, wenn Tagebuch und Zeiterfassung dasselbe sagen', async () => {
      const bau = await baueBaustelle(f.bau);
      // Zwei Schichten à 8 h auf DIESER Baustelle, Berliner Ortszeit
      // 07:00–15:00 = 05:00–13:00 UTC im September.
      await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');
      await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        await hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 2, dauerMinuten: 480,
        });
        const abgleich = await gleicheMannstundenAb(kontext, tag);
        expect(abgleich!.tagebuchEigenMinuten).toBe(960);
        expect(abgleich!.zeiteintragMinuten).toBe(960);
        expect(abgleich!.abweichungMinuten).toBe(0);
        expect(abgleich!.befund).toBe('deckungsgleich');
      });
    });

    it('eine Abweichung wird GEMELDET, nicht versteckt — mit Vorzeichen und Zahl', async () => {
      const bau = await baueBaustelle(f.bau);
      // Nur EINE Schicht erfasst, das Tagebuch zaehlt zwei Leute.
      await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        await hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 2, dauerMinuten: 480,
        });
        const abgleich = await gleicheMannstundenAb(kontext, tag);
        expect(abgleich!.befund).toBe('abweichung');
        expect(abgleich!.abweichungMinuten).toBe(480);
        expect(abgleich!.text).toMatch(/8,00 h mehr/u);
        // Und die Stunden je Gewerk stehen daneben — die Zahl, die BAU-07 will.
        expect(abgleich!.jeGewerk).toHaveLength(1);
        expect(abgleich!.jeGewerk[0]!.eigenMinuten).toBe(960);
      });
    });

    it('die Pause zaehlt mit: verglichen wird gegen die NETTOzeit', async () => {
      const bau = await baueBaustelle(f.bau);
      await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z', 30);

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        await hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 1, dauerMinuten: 480,
        });
        const abgleich = await gleicheMannstundenAb(kontext, tag);
        expect(abgleich!.zeiteintragMinuten).toBe(450);
        expect(abgleich!.abweichungMinuten).toBe(30);
        expect(abgleich!.befund).toBe('abweichung');
      });
    });

    it('Nachunternehmerstunden erzeugen KEINE Abweichung — sie schreiben keinen Zeiteintrag',
      async () => {
        const bau = await baueBaustelle(f.bau);
        await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');

        await alsBauleitung(bau, async (kontext) => {
          const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
          await hefteMannstundenAn(kontext, {
            bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
            anzahlPersonen: 1, dauerMinuten: 480,
          });
          await hefteMannstundenAn(kontext, {
            bautagebuchId: tag, gewerkId: bau.gewerkElektro, herkunft: 'nachunternehmer',
            nachunternehmerName: 'Elektro Sued GmbH', anzahlPersonen: 3, dauerMinuten: 480,
          });
          const abgleich = await gleicheMannstundenAb(kontext, tag);
          // Waeren beide Herkuenfte in einer Summe, meldete JEDER Tag mit
          // Nachunternehmern eine Abweichung — und niemand laese die Meldung
          // noch.
          expect(abgleich!.befund).toBe('deckungsgleich');
          expect(abgleich!.tagebuchNachunternehmerMinuten).toBe(1440);
          expect(abgleich!.text).toMatch(/Nachunternehmer/u);
        });
      });

    it('eine stornierte Zeile zaehlt nicht mehr mit — die Richtigstellung schon', async () => {
      const bau = await baueBaustelle(f.bau);
      await zeiteintrag(bau, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        const falsch = await hefteMannstundenAn(kontext, {
          bautagebuchId: tag, gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
          anzahlPersonen: 9, dauerMinuten: 480,
        });
        await korrigiereMannstunden(kontext, {
          zeileId: falsch, grund: 'Zahlendreher: einer, nicht neun',
          ersatz: {
            gewerkId: bau.gewerkRohbau, herkunft: 'eigen',
            anzahlPersonen: 1, dauerMinuten: 480,
          },
        });
        const abgleich = await gleicheMannstundenAb(kontext, tag);
        expect(abgleich!.tagebuchEigenMinuten).toBe(480);
        expect(abgleich!.befund).toBe('deckungsgleich');
      });
    });

    it('ein Zeiteintrag der NACHBARBAUSTELLE zaehlt nicht mit', async () => {
      const bau = await baueBaustelle(f.bau);
      const andere = await baueBaustelle(f.bau);
      await zeiteintrag(andere, '2026-09-10T05:00:00Z', '2026-09-10T13:00:00Z');

      await alsBauleitung(bau, async (kontext) => {
        const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
        const abgleich = await gleicheMannstundenAb(kontext, tag);
        expect(abgleich!.zeiteintragMinuten).toBe(0);
        expect(abgleich!.befund).toBe('ohne_angabe');
      });
    });

    it('der Tag ist der BERLINER Kalendertag: eine Schicht ab 23:00 zaehlt zum Vortag',
      async () => {
        const bau = await baueBaustelle(f.bau);
        // 09.09. 23:00 Berlin = 21:00 UTC. Nach UTC waere das der 9., nach
        // Berliner Kalender auch — aber 10.09. 00:30 Berlin (09.09. 22:30 UTC)
        // gehoert dem 10., und genau das ist die Grenze, die K-11 zieht.
        await zeiteintrag(bau, '2026-09-09T22:30:00Z', '2026-09-10T04:30:00Z');

        await alsBauleitung(bau, async (kontext) => {
          const tag = await legeBautagAn(kontext, { projektId: bau.projekt, datum: TAG });
          const abgleich = await gleicheMannstundenAb(kontext, tag);
          // 09.09. 22:30 UTC ist 10.09. 00:30 Berliner Zeit — die Schicht
          // gehoert dem 10., und ein UTC-Mitternachtsschnitt haette sie dem
          // 9. zugeschrieben.
          expect(abgleich!.zeiteintragMinuten).toBe(360);
        });
      });
  });
