/**
 * Der Generator gegen die echte Datenbank — die sechs Abnahmekriterien von
 * PR 30 (`08-PR-PLAN.md`), jedes als eigener Fall.
 *
 * Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Revier,
 * Katalogposition, Turnus, Serie), weil der Seed sie noch nicht kennt. Er
 * laeuft als Eigentuemer und nicht als `cse_app`: geprueft wird hier der
 * Generator, nicht die Rechteschicht — die hat ihre eigenen Tests.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  generiereEinsaetze, ladeAusnahmen, ladeSerien, materialisiereSerie,
} from '../../src/server/services/dienstplan/generator.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/**
 * Ein Montag in der ZUKUNFT — und das ist keine Bequemlichkeit.
 *
 * Der Generator fasst nichts an, was schon begonnen hat (§8.2 Schritt 7:
 * `where einsatz.beginn_zeitpunkt > now()`). Ein Test mit einem Datum in der
 * Vergangenheit prueft deshalb nicht den Generator, sondern den Wachtposten
 * davor — und meldet „0 aktualisiert", wo er 8 erwartet.
 *
 * Die Zeitumstellungen unten sind aus demselben Grund die von **2027**:
 * 28.03.2027 und 31.10.2027. Die verifizierten K-11-Daten von 2026 stehen
 * dort, wo sie ohne `now()` geprueft werden koennen — in
 * `tests/isolation/ortszeit.test.ts`.
 */
const HEUTE = '2027-01-04';

interface Aufbau {
  readonly mandant: string;
  readonly objekt: string;
  readonly revier: string;
  readonly turnus: string;
  readonly serie: string;
}

async function baueTurnus(opts: {
  rrule: string; dtstart: string; dauer: number;
  feiertagsregel?: 'ausfall' | 'unveraendert';
  gueltigAb?: string; gueltigBis?: string | null; horizont?: number;
}): Promise<Aufbau> {
  const mandant = f.reinigung;
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Testobjekt', 'Teststr.', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten,
                         aktiv_ab, erstellt_von_art)
     values ($1, $2, 'Revier A', 90, date '2027-01-01', 'system') returning id`, [mandant, o!.id]);
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `select id from leistungskatalog_position where mandant_id = $1 limit 1`, [mandant]);
  const katalogId = kat?.id ?? (await legeKatalogpositionAn(mandant));
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                         rrule, dtstart_lokal, dauer_minuten, feiertagsregel,
                         gueltig_ab, gueltig_bis, erstellt_von_art)
     values ($1,$2,$3,'Unterhaltsreinigung',$4,$5::timestamp,$6,$7::turnus_feiertagsregel,
             $8::date,$9::date,'system') returning id`,
    [mandant, r!.id, katalogId, opts.rrule, opts.dtstart, opts.dauer,
      opts.feiertagsregel ?? 'ausfall', opts.gueltigAb ?? '2027-01-01',
      opts.gueltigBis ?? null] as never[]);
  const [s] = await sql.unsafe<{ id: string }[]>(
    `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                feiertage_ueberspringen, feiertag_bundesland,
                                horizont_tage, erstellt_von_art)
     values ($1,$2,'turnus','Europe/Berlin',$3,'BE',$4,'system') returning id`,
    [mandant, t!.id, (opts.feiertagsregel ?? 'ausfall') === 'ausfall', opts.horizont ?? 56]);
  return { mandant, objekt: o!.id, revier: r!.id, turnus: t!.id, serie: s!.id };
}

async function legeKatalogpositionAn(mandant: string): Promise<string> {
  const [kat] = await sql.unsafe<{ id: string }[]>(
    `select id from leistungskatalog where mandant_id = $1 limit 1`, [mandant]);
  const katalog = kat?.id ?? (await sql.unsafe<{ id: string }[]>(
    `insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
     values ($1,$2,'Testkatalog', date '2027-01-01') returning id`,
    [mandant, `kat-${zufall()}`]))[0]!.id;
  const [p] = await sql.unsafe<{ id: string }[]>(
    // `lkp_kalkulierbar` verlangt mindestens einen der drei Rechenwerte —
    // eine Katalogzeile, aus der sich kein Preis ergibt, ist keine.
    `insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                            zeitwert_minuten, gueltig_ab)
     values ($1,$2,$3,'Unterhaltsreinigung','h', 60, date '2027-01-01') returning id`,
    [mandant, katalog, `01.${zufall().slice(0, 3)}`]);
  return p!.id;
}

/** Ein Lauf ueber genau diese Serie — mit festem „heute", damit der Test steht. */
async function lauf(a: Aufbau, heute = HEUTE) {
  // Das Suchfenster muss den Horizont der Serie abdecken; ein Jahr reicht
  // fuer jeden Fall hier und haelt den Test unabhaengig von `horizont_tage`.
  const bis = new Date(`${heute}T00:00:00Z`);
  bis.setUTCFullYear(bis.getUTCFullYear() + 1);
  const bisDatum = bis.toISOString().slice(0, 10);
  const serien = await ladeSerien(sql, a.mandant, heute, bisDatum);
  const serie = serien.find((s) => s.planungsserieId === a.serie);
  expect(serie, 'die Serie muss in app.planungsbedarf erscheinen').toBeDefined();
  const ausnahmen = await ladeAusnahmen(sql, serie!, heute, bisDatum);
  return materialisiereSerie(sql, serie!, ausnahmen, { heute, laufId: null });
}

async function einsaetze(serie: string) {
  return sql.unsafe<{
    quell_schluessel: string; plan_datum: string; beginn_lokal: string; ende_lokal: string;
    status: string; beginn_zeitpunkt: Date; ende_zeitpunkt: Date; zeitanomalie: string;
    feiertag_id: string | null; minuten: number;
  }[]>(
    `select quell_schluessel, to_char(plan_datum,'YYYY-MM-DD') as plan_datum,
            to_char(beginn_lokal,'HH24:MI') as beginn_lokal,
            to_char(ende_lokal,'HH24:MI') as ende_lokal,
            status::text as status, beginn_zeitpunkt, ende_zeitpunkt,
            zeitanomalie::text as zeitanomalie, feiertag_id,
            (extract(epoch from (ende_zeitpunkt - beginn_zeitpunkt))/60)::int as minuten
       from einsatz where planungsserie_id = $1 order by beginn_zeitpunkt`, [serie]);
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(1) acht Wochen, und ein zweiter Lauf legt nichts nach', () => {
  it('eine woechentliche Serie ergibt genau acht Einsaetze', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    const b1 = await lauf(a);
    expect(b1.erzeugt).toBe(8);
    expect((await einsaetze(a.serie))).toHaveLength(8);

    const b2 = await lauf(a);
    expect(b2.erzeugt, 'ein zweiter Lauf legt NICHTS an').toBe(0);
    expect(b2.aktualisiert).toBe(8);
    expect((await einsaetze(a.serie))).toHaveLength(8);
  });
});

describe('(2) eine einmal verschobene Schicht bleibt verschoben', () => {
  it('und die Serie bleibt vollstaendig', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    await lauf(a);
    await sql.unsafe(
      `insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, ersatz_beginn_lokal,
                                    grund, erstellt_von_art)
       values ($1,$2,date '2027-01-18','verschiebung', timestamp '2027-01-20 09:30',
               'Kunde hat Zutritt verlegt','system')`, [a.mandant, a.turnus]);
    await lauf(a);

    const nachher = await einsaetze(a.serie);
    expect(nachher.filter((e) => e.status === 'geplant')).toHaveLength(8);
    const verschoben = nachher.find((e) => e.plan_datum === '2027-01-20');
    expect(verschoben?.beginn_lokal).toBe('09:30');
    // Der Schluessel nennt weiter den URSPRUNGSTERMIN — sonst legte der
    // dritte Lauf eine zweite Schicht am 21. an.
    expect(verschoben?.quell_schluessel).toBe(`serie:${a.serie}:20270118:0600`);
    expect(nachher.some((e) => e.plan_datum === '2027-01-18')).toBe(false);

    const dritter = await lauf(a);
    expect(dritter.erzeugt, 'der dritte Lauf legt nichts nach').toBe(0);
    expect((await einsaetze(a.serie)).filter((e) => e.status === 'geplant')).toHaveLength(8);
  });
});

describe('(3) eine woechentliche Serie ueber die Zeitumstellung', () => {
  it('behaelt die Ortszeit, waehrend der Instant um eine Stunde wandert', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=SA', dtstart: '2027-03-13T22:00', dauer: 480,
      gueltigAb: '2027-03-01',
    });
    await lauf(a, '2027-03-13');
    const alle = await einsaetze(a.serie);
    const nach = (tag: string) => alle.find((e) => e.plan_datum === tag);

    for (const e of alle) {
      expect(e.beginn_lokal, `${e.plan_datum} beginnt lokal gleich`).toBe('22:00');
      expect(e.ende_lokal, `${e.plan_datum} endet lokal gleich`).toBe('06:00');
    }
    // 21.03. ist noch MEZ, 28.03. ist die Umstellungsnacht, 04.04. ist MESZ.
    expect(nach('2027-03-20')?.minuten).toBe(480);
    expect(nach('2027-03-27')?.minuten).toBe(420);
    expect(nach('2027-04-03')?.minuten).toBe(480);
    // Der Instant der 22:00 wandert: 21:00Z vor, 20:00Z nach der Umstellung.
    expect(nach('2027-03-20')?.beginn_zeitpunkt.toISOString()).toBe('2027-03-20T21:00:00.000Z');
    expect(nach('2027-04-03')?.beginn_zeitpunkt.toISOString()).toBe('2027-04-03T20:00:00.000Z');
  });

  it('und in der Rueckstellungsnacht sind es 540 Minuten', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=SA', dtstart: '2027-10-09T22:00', dauer: 480,
      gueltigAb: '2027-10-01',
    });
    await lauf(a, '2027-10-09');
    const alle = await einsaetze(a.serie);
    expect(alle.find((e) => e.plan_datum === '2027-10-30')?.minuten).toBe(540);
    // KONTROLLE: die Nacht NACH der Umstellung ist wieder gewoehnlich.
    expect(alle.find((e) => e.plan_datum === '2027-11-06')?.minuten).toBe(480);
  });
});

describe('(4) der Feiertag (CLN-03)', () => {
  it('mit `ausfall` entsteht keine Schicht am 3. Oktober', async () => {
    await sql.unsafe(
      `insert into feiertag (bundesland, datum, bezeichnung, gesetzlich)
       values ('BE', date '2027-10-04', 'Testfeiertag', true)
       on conflict (bundesland, datum) do nothing`);
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-10-04T06:00', dauer: 180,
      gueltigAb: '2027-10-01', feiertagsregel: 'ausfall', horizont: 21,
    });
    const b = await lauf(a, '2027-10-01');
    const tage = (await einsaetze(a.serie)).map((e) => e.plan_datum);
    expect(tage).not.toContain('2027-10-04');
    expect(b.uebersprungen.some((u) => u.grund === 'feiertag')).toBe(true);
  });

  it('mit `unveraendert` entsteht sie und traegt den Feiertag', async () => {
    await sql.unsafe(
      `insert into feiertag (bundesland, datum, bezeichnung, gesetzlich)
       values ('BE', date '2027-10-04', 'Testfeiertag', true)
       on conflict (bundesland, datum) do nothing`);
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-10-04T06:00', dauer: 180,
      gueltigAb: '2027-10-01', feiertagsregel: 'unveraendert', horizont: 21,
    });
    await lauf(a, '2027-10-01');
    const alle = await einsaetze(a.serie);
    const feiertagsschicht = alle.find((e) => e.plan_datum === '2027-10-04');
    expect(feiertagsschicht).toBeDefined();
    expect(feiertagsschicht?.feiertag_id).not.toBeNull();
  });
});

describe('(5) zehn Serien zur selben Sekunde an einem Objekt (TIM-04)', () => {
  it('ergeben zehn sichtbare Einsaetze, nicht einen', async () => {
    const erste = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    await lauf(erste);
    // Neun weitere Serien auf DEMSELBEN Objekt, mit derselben Anfangszeit.
    for (let i = 0; i < 9; i += 1) {
      const [r] = await sql.unsafe<{ id: string }[]>(
        `insert into revier (mandant_id, objekt_id, bezeichnung, sollzeit_minuten,
                             aktiv_ab, erstellt_von_art)
         values ($1,$2,$3,90,date '2027-01-01','system') returning id`,
        [erste.mandant, erste.objekt, `Revier ${i + 2}`]);
      const [kat] = await sql.unsafe<{ id: string }[]>(
        `select leistungskatalog_position_id as id from turnus where id = $1`, [erste.turnus]);
      const [t] = await sql.unsafe<{ id: string }[]>(
        `insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                             rrule, dtstart_lokal, dauer_minuten, feiertagsregel, gueltig_ab,
                             erstellt_von_art)
         values ($1,$2,$3,$4,'FREQ=WEEKLY;BYDAY=MO', timestamp '2027-01-04 06:00', 180,
                 'ausfall', date '2027-01-01','system') returning id`,
        [erste.mandant, r!.id, kat!.id, `Turnus ${i + 2}`]);
      const [s] = await sql.unsafe<{ id: string }[]>(
        `insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                    feiertage_ueberspringen, feiertag_bundesland,
                                    horizont_tage, erstellt_von_art)
         values ($1,$2,'turnus','Europe/Berlin',true,'BE',56,'system') returning id`,
        [erste.mandant, t!.id]);
      await lauf({ ...erste, turnus: t!.id, serie: s!.id, revier: r!.id });
    }

    const [z] = await sql.unsafe<{ anzahl: number }[]>(
      `select count(*)::int as anzahl from einsatz
        where objekt_id = $1 and beginn_zeitpunkt = (
          select zeitpunkt from app.loese_ortszeit(date '2027-01-04','06:00','Europe/Berlin'))`,
      [erste.objekt]);
    expect(z!.anzahl, 'zehn Schichten, zehn Zeilen').toBe(10);
  });
});

describe('(6) jede Schicht haengt an einer Anstellung, nie an einer Person', () => {
  it('`einsatz` selbst hat gar keine person_id', async () => {
    // Strukturell, nicht durch Beispiel: es gibt keine Spalte, an die eine
    // Person zu haengen waere (D-09).
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_name = 'einsatz' and column_name = 'person_id'`);
    expect(spalten).toEqual([]);
  });

  it('die Besetzung nennt eine ANSTELLUNG, und die ist Pflicht', async () => {
    const [s] = await sql.unsafe<{ is_nullable: string }[]>(
      `select is_nullable from information_schema.columns
        where table_name = 'einsatz_zuordnung' and column_name = 'anstellung_id'`);
    expect(s?.is_nullable).toBe('NO');
  });

  it('die daneben stehende person_id KANN nicht abweichen', async () => {
    /**
     * `einsatz_zuordnung` traegt `person_id` denormalisiert — das ist der
     * dokumentierte Abweichungsfall aus §5.4, und die Frage ist nicht, ob die
     * Spalte da ist, sondern ob sie driften kann. Sie kann nicht: der
     * zusammengesetzte Fremdschluessel `(anstellung_id, person_id)` zeigt auf
     * `anstellung (id, person_id)`.
     *
     * Geprueft wird das mit dem Paar, das die Fixtur eigens dafuer hat:
     * Fatimas Reinigungsanstellung mit JONAS' Person-Id. Ohne den Schluessel
     * ginge die Zeile durch, und ab da haette dieselbe Schicht zwei Wahrheiten
     * darueber, wer sie geleistet hat.
     */
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    await lauf(a);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `select id from einsatz where planungsserie_id = $1 limit 1`, [a.serie]);

    await expect(sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
       select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
         from einsatz where id = $2`,
      [f.reinigung, e!.id, f.fatimaReinigung, f.jonas],
    )).rejects.toThrow(/ez_person_fk|foreign key/u);

    // Dieselbe Zeile mit dem RICHTIGEN Paar geht durch.
    await expect(sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
       select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
         from einsatz where id = $2`,
      [f.reinigung, e!.id, f.fatimaReinigung, f.fatima],
    )).resolves.toBeDefined();
  });
});

describe('der Lauf ueber alle Serien eines Mandanten', () => {
  it('meldet je Serie, was er getan hat', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    const berichte = await generiereEinsaetze(sql, a.mandant, { heute: HEUTE, laufId: null });
    const meiner = berichte.find((b) => b.planungsserieId === a.serie);
    expect(meiner?.erzeugt).toBe(8);
    const [ps] = await sql.unsafe<{ generiert_bis: string; letzte_meldung: unknown }[]>(
      `select to_char(generiert_bis,'YYYY-MM-DD') as generiert_bis, letzte_meldung
         from planungsserie where id = $1`, [a.serie]);
    expect(ps!.generiert_bis).toBe('2027-02-28');
    const meldung = typeof ps!.letzte_meldung === 'string'
      ? (JSON.parse(ps!.letzte_meldung) as Record<string, unknown>)
      : (ps!.letzte_meldung as Record<string, unknown>);
    expect(meldung).toMatchObject({ erzeugt: 8 });
  });

  it('eine geloeschte Serienregel storniert kuenftige Schichten, statt sie zu loeschen', async () => {
    const a = await baueTurnus({
      rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2027-01-04T06:00', dauer: 180,
    });
    await lauf(a);
    await sql.unsafe(
      `update turnus set rrule = 'FREQ=WEEKLY;BYDAY=TU' where id = $1`, [a.turnus]);
    const b = await lauf(a);
    const alle = await einsaetze(a.serie);
    expect(b.storniert).toBe(8);
    expect(alle.filter((e) => e.status === 'storniert')).toHaveLength(8);
    expect(alle.filter((e) => e.status === 'geplant')).toHaveLength(8);
    // Nichts ist verschwunden: 16 Zeilen, acht davon mit Grund.
    expect(alle).toHaveLength(16);
    expect(alle.every((e) => e.status !== 'storniert' || e.zeitanomalie !== null)).toBe(true);
  });
});
