/**
 * „Eine Zeit fehlt": der Einwand OHNE Zeiteintrag, im ECHTEN Schreibweg des
 * Portals und gegen die echte RLS (V-189, EMP-07, TIM-11).
 *
 * Vorher entstand ein `eintrag_fehlt` ohne Eintrag nur in Tests, die per SQL
 * schreiben (`nacherfassung-frei.test.ts`) — kein Weg der Arbeiterin führte
 * dorthin. Hier geht er über denselben Dienst wie die Route: Personen-Scope,
 * Mandant der Anstellung, `withTenant` mit `portal: 'mitarbeiter'`, Policy
 * `t_selbst_einreichen`.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant,
  type LeseKontext, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import {
  EinwandZeitFehler, listeEigeneEinwaende, mandantDerAnstellung, reicheEinwandEin,
} from '../../src/server/services/zeit/einwand.js';
import { eigenerEintragZurSchicht } from '../../src/server/services/mitarbeiter/zeiten.js';

let f: Fixtur;
let fatimaKonto: string;
const SITZUNG = '00000000-0000-0000-0000-0000000003b9';
const zufall = (): string => String(Math.random()).slice(2, 10);

function sitzung(): Sitzung {
  return {
    benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId: f.reinigung,
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

async function alsPerson<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => withPersonScope(tx as never, sitzung(), fn)) as Promise<T>;
}

async function imMandantenDer<T>(
  anstellungId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) => {
    const mandantId = await withPersonScope(tx as never, sitzung(), async (k) =>
      mandantDerAnstellung(k, anstellungId));
    return withTenant(tx as never,
      { ...sitzung(), aktiverMandantId: mandantId, portal: 'mitarbeiter' }, fn);
  }) as Promise<T>;
}

/** Eine Schicht vom 02.03.2026, 06:00–14:00 Berlin, mit Zuordnung. */
async function schicht(anstellung: string, person: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Treppenhaus Nord','Kurfürstendamm 21','10719','Berlin') returning id`,
    [f.reinigung, k!.id, `OBJ-${zufall()}`]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     values ($1,$2,'manuell','2026-03-02',
             '2026-03-02 06:00' at time zone 'Europe/Berlin',
             '2026-03-02 14:00' at time zone 'Europe/Berlin',
             '06:00', '14:00', false, 'system')
     returning id`, [f.reinigung, o!.id]);
  await sql.unsafe(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2`,
    [f.reinigung, e!.id, anstellung, person] as never[]);
  return e!.id;
}

beforeEach(async () => {
  f = await seed();
  const email = `fehlt-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  fatimaKonto = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [fatimaKonto, email, f.fatima]);
  const [rolle] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null`);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [fatimaKonto, m, rolle!.id]);
  }
});

afterAll(async () => { await schliessen(); });

describe('V-189: „Eine Zeit fehlt" im Schreibweg der Arbeiterin', () => {
  it('ein Einwand ohne Eintrag entsteht — in DER Gesellschaft der gewählten Beschäftigung', async () => {
    const id = await imMandantenDer(f.fatimaSecurity, (k) => reicheEinwandEin(k, {
      anstellungId: f.fatimaSecurity,
      zeiteintragId: null,
      art: 'eintrag_fehlt',
      betrifftDatum: '2026-03-28',
      // Über die Nacht der Zeitumstellung: 22:00 MEZ bis 06:00 MESZ.
      behauptetBeginn: new Date('2026-03-28T21:00:00Z'),
      behauptetEnde: new Date('2026-03-29T04:00:00Z'),
      behauptetPauseMinuten: 30,
      begruendung: 'Die Marke am Tor ging nicht, ich war da.',
      eingereichtVonBenutzerId: fatimaKonto,
    }));

    const [z] = await sql.unsafe<{
      mandant_id: string; zeiteintrag_id: string | null; art: string; status: string;
      minuten: number;
    }[]>(
      `select mandant_id, zeiteintrag_id, art::text as art, status::text as status,
              (extract(epoch from behauptet_ende - behauptet_beginn) / 60)::int as minuten
         from zeit_einwand where id = $1`, [id]);
    expect(z?.mandant_id).toBe(f.security);
    expect(z?.zeiteintrag_id).toBeNull();
    expect(z?.art).toBe('eintrag_fehlt');
    expect(z?.status).toBe('offen');
    // Die Dauer ist der Abstand zweier Instants: sieben Stunden, keine acht.
    expect(z?.minuten).toBe(420);

    // Die Seite zeigt sie unter „Meine Meldungen ohne Eintrag".
    const eigene = await alsPerson((k) => listeEigeneEinwaende(k));
    const ohne = eigene.filter((e) => e.zeiteintragId === null);
    expect(ohne.map((e) => e.id)).toEqual([id]);
  });

  it('das Blatt der Schicht weiss, ob es einen Eintrag gibt', async () => {
    const einsatz = await schicht(f.fatimaReinigung, f.fatima);
    expect(await alsPerson((k) =>
      eigenerEintragZurSchicht(k, einsatz, f.fatimaReinigung))).toBeNull();

    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, einsatz_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
          erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
          status, erstellt_von_art)
       values ($1,$2,$3,$4,'2026-03-02T05:00:00Z','2026-03-02T13:00:00Z',0,
               'import','import','import','import','abgeschlossen','system')
       returning id`,
      [f.reinigung, f.fatimaReinigung, f.fatima, einsatz]);
    expect(await alsPerson((k) =>
      eigenerEintragZurSchicht(k, einsatz, f.fatimaReinigung))).toBe(z!.id);

    // Jonas' Blick auf dieselbe Schicht findet Fatimas Eintrag NICHT — die RLS
    // gibt nur eigene Einträge heraus, auch wenn die Anfrage die Kennung kennt.
    const jonasKonto = `jonas-${zufall()}@cse.test`;
    const [ju] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [jonasKonto]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status, person_id)
       values ($1,$2,$2,'aktiv',$3)`, [ju!.id, jonasKonto, f.jonas]);
    const [rolle] = await sql.unsafe<{ id: string }[]>(
      `select id from rolle where schluessel = 'mitarbeiter' and mandant_id is null`);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [ju!.id, f.reinigung, rolle!.id]);
    const fremd = await sql.begin(async (tx) => withPersonScope(tx as never, {
      ...sitzung(), benutzerId: ju!.id, personId: f.jonas,
    }, (k) => eigenerEintragZurSchicht(k, einsatz, f.fatimaReinigung)));
    expect(fremd).toBeNull();
  });
});

describe('V-193: Tag und behauptete Zeit gelten gegen die Uhr der Datenbank', () => {
  /** Der Berliner Tag `n` Tage von heute, aus der Datenbank (Invariante 5). */
  async function tag(n: number): Promise<string> {
    const [z] = await sql.unsafe<{ t: string }[]>(
      `select to_char(app.berlin_heute() + $1::int, 'YYYY-MM-DD') as t`, [n]);
    return z!.t;
  }
  /** 08:00 Berliner Zeit an diesem Tag, als Instant aus der Datenbank. */
  async function achtUhr(datum: string): Promise<Date> {
    const [z] = await sql.unsafe<{ t: Date }[]>(
      `select ($1::date + time '08:00') at time zone 'Europe/Berlin' as t`, [datum]);
    return z!.t;
  }
  function melde(e: { betrifftDatum: string; behauptetBeginn?: Date; behauptetEnde?: Date }) {
    return imMandantenDer(f.fatimaReinigung, (k) => reicheEinwandEin(k, {
      anstellungId: f.fatimaReinigung, zeiteintragId: null, art: 'eintrag_fehlt',
      begruendung: 'Die Marke am Tor ging nicht.', eingereichtVonBenutzerId: fatimaKonto, ...e,
    }));
  }
  async function grund(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn();
      return null;
    } catch (fehler) {
      if (fehler instanceof EinwandZeitFehler) return fehler.grund;
      throw fehler;
    }
  }
  async function anzahl(): Promise<number> {
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from zeit_einwand where anstellung_id = $1`, [f.fatimaReinigung]);
    return Number(z!.n);
  }

  it('VORHER angelegt: ein künftiger Tag wird abgewiesen — und nichts geschrieben', async () => {
    const vorher = await anzahl();
    const morgen = await tag(1);
    expect(await grund(() => melde({ betrifftDatum: morgen }))).toBe('tag_in_zukunft');
    expect(await anzahl()).toBe(vorher);
  });

  it('eine behauptete Zeit nach jetzt wird abgewiesen, auch an einem vergangenen Tag', async () => {
    const gestern = await tag(-1);
    const beginn = await achtUhr(gestern);
    const ende = await achtUhr(await tag(1));
    expect(await grund(() => melde({
      betrifftDatum: gestern, behauptetBeginn: beginn, behauptetEnde: ende,
    }))).toBe('zeit_in_zukunft');
  });

  it('bei „Eine Zeit fehlt" liegt der behauptete Beginn am gewählten Tag', async () => {
    const vorgestern = await tag(-2);
    const amFolgetag = await achtUhr(await tag(-1));
    expect(await grund(() => melde({
      betrifftDatum: vorgestern, behauptetBeginn: amFolgetag,
    }))).toBe('beginn_nicht_am_tag');
  });

  it('ein vergangener Tag mit Zeit an diesem Tag geht durch — auch über Mitternacht', async () => {
    const vorgestern = await tag(-2);
    const [nacht] = await sql.unsafe<{ von: Date; bis: Date }[]>(
      `select ($1::date + time '22:00') at time zone 'Europe/Berlin' as von,
              ($1::date + 1 + time '06:00') at time zone 'Europe/Berlin' as bis`, [vorgestern]);
    const id = await melde({
      betrifftDatum: vorgestern, behauptetBeginn: nacht!.von, behauptetEnde: nacht!.bis,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    // Und heute ohne Uhrzeit — der Tag darf heute sein.
    const heute = await tag(0);
    expect(await melde({ betrifftDatum: heute })).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
