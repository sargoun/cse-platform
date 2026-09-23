import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  SchichtFehler, legeEinzelschichtAn, pruefeEinzelschicht, sageEinsatzAb,
  wanduhrDauerMinuten,
} from '../../src/server/services/dienstplan/einzelschicht.js';

/**
 * **Die einzelne Schicht — angelegt und abgesagt** (V-013, TIM-01, TIM-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `einsatz.quelle` kennt seit `0028` den Wert `manuell`, und
 * `kern.einsatz_quell_schluessel_setzen` vergibt einer schlüssellosen Zeile
 * eigens `manuell:<id>`. Die Datenbank war vorbereitet — **angelegt hat so
 * eine Zeile nie jemand.** Ein Einsatz entstand aus einer Serie, aus einer
 * Veranstaltung oder gar nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die vier Prüfungen, die CLAUDE.md vor jeder Planungsoberfläche verlangt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §2 trägt sie namentlich: die Schicht 22:00–06:00, die Nacht der
 * Vorstellung, die Nacht der Rückstellung, und zehn Schichten zum selben
 * Zeitpunkt auf EINEM Objekt. Sie stehen hier nicht, weil sie sich gut
 * lesen, sondern weil jede von ihnen eine Zahl auf einer Lohnabrechnung
 * verändert.
 */

let f: Fixtur;
let leitung = '';
let kundeId = '';
let objektId = '';
let objektOhneKunde = '';
let fremdesObjekt = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function objekt(mandant: string, kunde: string | null): Promise<string> {
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [mandant, kunde, `O-${zufall()}`]);
  return o!.id;
}

beforeAll(async () => {
  f = await seed();
  leitung = await konto('schicht-leitung@test.invalid', f.reinigung, 'leitung');
  for (const r of ['dienstplan.lesen', 'dienstplan.schreiben']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
  objektId = await objekt(f.reinigung, kundeId);
  objektOhneKunde = await objekt(f.reinigung, null);

  const [k2] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Fremdkunde','Hauptstr.','1','10827','Berlin') returning id`,
    [f.security, `K-${zufall()}`]);
  fremdesObjekt = await objekt(f.security, k2!.id);
});
afterAll(schliessen);

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>,
  o: { readonly readonly?: boolean } = {},
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: leitung,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

interface Zeile {
  readonly quelle: string;
  readonly schluessel: string;
  readonly kunde_id: string;
  readonly beginn: string;
  readonly ende: string;
  readonly dauer_minuten: number;
  readonly anomalie: string;
  readonly status: string;
  readonly storno: string | null;
  readonly erstellt_von: string | null;
  readonly art: string;
}

async function zeile(id: string): Promise<Zeile> {
  const [z] = await sql.unsafe<Zeile[]>(
    `select quelle::text as quelle, quell_schluessel as schluessel, kunde_id::text as kunde_id,
            to_char(beginn_zeitpunkt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as beginn,
            to_char(ende_zeitpunkt   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as ende,
            (extract(epoch from (ende_zeitpunkt - beginn_zeitpunkt)) / 60)::int as dauer_minuten,
            zeitanomalie::text as anomalie, status::text as status,
            storno_grund as storno, erstellt_von::text as erstellt_von,
            erstellt_von_art::text as art
       from einsatz where id = $1`, [id]);
  return z!;
}

const basis = {
  planDatum: '2026-05-14', beginnLokal: '08:00', endeLokal: '12:00',
  endetAmFolgetag: false, sollBesetzung: 1, minBesetzung: 1,
};

describe('§1 die Schicht entsteht — mit dem, was die Datenbank beisteuert', () => {
  it('legt sie als `manuell` an, mit Schlüssel und Kunde aus dem Objekt', async () => {
    const { einsatzId } = await imKontext((k) =>
      legeEinzelschichtAn(k, { ...basis, objektId }));
    const z = await zeile(einsatzId);
    expect(z.quelle).toBe('manuell');
    /* `kern.einsatz_quell_schluessel_setzen` — die Zeile brachte keinen mit. */
    expect(z.schluessel).toBe(`manuell:${einsatzId}`);
    /* `kern.einsatz_kunde_setzen` — der Kunde wird dem Aufrufer nicht geglaubt. */
    expect(z.kunde_id).toBe(kundeId);
    expect(z.status).toBe('geplant');
    expect(z.erstellt_von).toBe(leitung);
    expect(z.art).toBe('mensch');
  });

  it('rechnet die Wanduhr in echte Zeitpunkte um — in der Anweisung, nicht in Node', async () => {
    const { einsatzId } = await imKontext((k) =>
      legeEinzelschichtAn(k, { ...basis, objektId }));
    const z = await zeile(einsatzId);
    /* 14. Mai ist Sommerzeit: Berlin = UTC+2. */
    expect(z.beginn).toBe('2026-05-14T06:00Z');
    expect(z.ende).toBe('2026-05-14T10:00Z');
    expect(z.dauer_minuten).toBe(240);
    expect(z.anomalie).toBe('keine');
  });
});

describe('§2 die vier Prüfungen, die vor jeder Planungsoberfläche stehen', () => {
  /** Schicht 22:00–06:00 — acht Stunden, über Mitternacht. */
  it('22:00–06:00 endet am Folgetag und dauert acht Stunden', async () => {
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...basis, objektId, beginnLokal: '22:00', endeLokal: '06:00', endetAmFolgetag: true,
    }));
    const z = await zeile(einsatzId);
    expect(z.beginn).toBe('2026-05-14T20:00Z');
    expect(z.ende).toBe('2026-05-15T04:00Z');
    expect(z.dauer_minuten).toBe(480);
  });

  /**
   * **Die Nacht der Vorstellung** (29.03.2026): 02:00 bis 03:00 Ortszeit gibt
   * es nicht. Eine Schicht 22:00–06:00 über diese Nacht ist SIEBEN Stunden
   * lang — die Wanduhr sagt acht, und wer die Wanduhr bezahlt, bezahlt eine
   * Stunde zu viel.
   */
  it('DST-Vorstellung: die Nachtschicht ist sieben Stunden lang', async () => {
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...basis, objektId, planDatum: '2026-03-28',
      beginnLokal: '22:00', endeLokal: '06:00', endetAmFolgetag: true,
    }));
    const z = await zeile(einsatzId);
    expect(z.dauer_minuten).toBe(7 * 60);
    expect(wanduhrDauerMinuten('22:00', '06:00', true)).toBe(8 * 60);
  });

  /** Eine Schicht, die IN der Lücke beginnt, trägt den Befund. */
  it('DST-Vorstellung: ein Beginn um 02:30 ist `dst_luecke`', async () => {
    const { einsatzId, zeitanomalie } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...basis, objektId, planDatum: '2026-03-29', beginnLokal: '02:30', endeLokal: '06:00',
    }));
    expect(zeitanomalie).toBe('dst_luecke');
    expect((await zeile(einsatzId)).anomalie).toBe('dst_luecke');
  });

  /**
   * **Die Nacht der Rückstellung** (25.10.2026): 02:00 bis 03:00 gibt es
   * zweimal. Dieselbe Nachtschicht ist NEUN Stunden lang.
   */
  it('DST-Rückstellung: die Nachtschicht ist neun Stunden lang', async () => {
    const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...basis, objektId, planDatum: '2026-10-24',
      beginnLokal: '22:00', endeLokal: '06:00', endetAmFolgetag: true,
    }));
    expect((await zeile(einsatzId)).dauer_minuten).toBe(9 * 60);
  });

  it('DST-Rückstellung: ein Beginn um 02:30 ist `dst_doppelt`', async () => {
    const { zeitanomalie } = await imKontext((k) => legeEinzelschichtAn(k, {
      ...basis, objektId, planDatum: '2026-10-25', beginnLokal: '02:30', endeLokal: '06:00',
    }));
    expect(zeitanomalie).toBe('dst_doppelt');
  });

  /**
   * **Zehn Schichten zur selben Sekunde auf einem Objekt** (TIM-04). Es gibt
   * absichtlich keine Ausschlussbedingung: Überschneidung ist ein BEFUND,
   * keine Sperre. Wer hier ein `EXCLUDE USING gist` ergänzte, machte aus
   * einem sichtbaren Konflikt einen `duplicate key`.
   */
  it('zehn Schichten zum selben Zeitpunkt auf EINEM Objekt sind zehn Zeilen', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { einsatzId } = await imKontext((k) => legeEinzelschichtAn(k, {
        ...basis, objektId, planDatum: '2026-06-01', beginnLokal: '06:00', endeLokal: '14:00',
      }));
      ids.push(einsatzId);
    }
    expect(new Set(ids).size).toBe(10);
    const [z] = await sql.unsafe<{ anzahl: number }[]>(
      `select count(*)::int as anzahl from einsatz
        where objekt_id = $1 and plan_datum = '2026-06-01' and storniert_am is null`,
      [objektId]);
    expect(z?.anzahl).toBe(10);

    /* Und jeder Schlüssel ist ein eigener — `einsatz_quelle_uk` ist unique. */
    const schluessel = await Promise.all(ids.map(async (i) => (await zeile(i)).schluessel));
    expect(new Set(schluessel).size).toBe(10);
  });
});

describe('§3 was die Eingabe nicht sein darf', () => {
  it('Ende vor Beginn ohne Folgetag ist ein Tippfehler, keine Nachtschicht', () => {
    expect(() => pruefeEinzelschicht({
      ...basis, objektId, beginnLokal: '22:00', endeLokal: '06:00', endetAmFolgetag: false,
    })).toThrow(SchichtFehler);
  });

  it('eine Schicht dauert weniger als 24 Stunden', () => {
    expect(() => pruefeEinzelschicht({
      ...basis, objektId, beginnLokal: '08:00', endeLokal: '08:00', endetAmFolgetag: true,
    })).toThrow(/24 Stunden/u);
  });

  it('die Mindestbesetzung ist nicht grösser als das Soll', () => {
    expect(() => pruefeEinzelschicht({ ...basis, objektId, sollBesetzung: 2, minBesetzung: 3 }))
      .toThrow(/Mindestbesetzung/u);
  });

  it('die Pause ist kürzer als die Schicht', () => {
    expect(() => pruefeEinzelschicht({ ...basis, objektId, pauseMinuten: 240 }))
      .toThrow(SchichtFehler);
  });

  it('ein Objekt ohne Kunden trägt keine Schicht — mit einem Satz, nicht mit einem Auslösertext',
    async () => {
      await expect(imKontext((k) => legeEinzelschichtAn(k, { ...basis, objektId: objektOhneKunde })))
        .rejects.toMatchObject({ grund: 'kein_kunde', status: 409 });
    });

  it('ein Objekt einer anderen Gesellschaft ist nicht erreichbar', async () => {
    await expect(imKontext((k) => legeEinzelschichtAn(k, { ...basis, objektId: fremdesObjekt })))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
  });
});

describe('§4 absagen — mit Grund, nie durch Löschen', () => {
  it('setzt Status, Zeitpunkt und Grund', async () => {
    const { einsatzId } = await imKontext((k) =>
      legeEinzelschichtAn(k, { ...basis, objektId }));
    await imKontext((k) => sageEinsatzAb(k, einsatzId, 'Kunde hat abgesagt'));
    const z = await zeile(einsatzId);
    expect(z.status).toBe('storniert');
    expect(z.storno).toBe('Kunde hat abgesagt');
  });

  it('ohne Grund geht es nicht — `einsatz_storno_begruendet` als Satz', async () => {
    const { einsatzId } = await imKontext((k) =>
      legeEinzelschichtAn(k, { ...basis, objektId }));
    await expect(imKontext((k) => sageEinsatzAb(k, einsatzId, ' ')))
      .rejects.toMatchObject({ grund: 'grund_fehlt' });
    expect((await zeile(einsatzId)).status).toBe('geplant');
  });

  it('zweimal absagen ist kein zweiter Vorgang', async () => {
    const { einsatzId } = await imKontext((k) =>
      legeEinzelschichtAn(k, { ...basis, objektId }));
    await imKontext((k) => sageEinsatzAb(k, einsatzId, 'Objekt nicht zugänglich'));
    await expect(imKontext((k) => sageEinsatzAb(k, einsatzId, 'Objekt nicht zugänglich')))
      .rejects.toMatchObject({ grund: 'schon_storniert', status: 409 });
  });

  it('eine fremde Schicht gibt es nicht', async () => {
    await expect(imKontext((k) => sageEinsatzAb(
      k, '00000000-0000-0000-0000-000000000000', 'egal')))
      .rejects.toMatchObject({ grund: 'nicht_gefunden', status: 404 });
  });
});

describe('§5 die Rolle, nicht der Dienst', () => {
  /**
   * Invariante 10: in der Gruppenansicht entsteht nichts. `t_mandant` prüft
   * `not app.ist_readonly()` im `with check` — hier steht kein Dienst
   * dazwischen, nur rohes SQL.
   */
  it('eine nur-lesende Sitzung legt keine Schicht an', async () => {
    await expect(imKontext((k) => k.schreibe(
      `insert into einsatz (mandant_id, quelle, objekt_id, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            erstellt_von_art, erstellt_von)
       values ($1::uuid, 'manuell', $2::uuid, '2026-05-14',
               '2026-05-14T06:00Z', '2026-05-14T10:00Z', '08:00', '12:00',
               'mensch', $3::uuid)`,
      [f.reinigung, objektId, leitung]), { readonly: true }))
      .rejects.toThrow(/row-level security|row level security/iu);
  });

  it('eine Schicht ohne Objekt der Gesellschaft weist der Auslöser ab, nicht erst die Policy',
    async () => {
      await expect(imKontext((k) => k.schreibe(
        `insert into einsatz (mandant_id, quelle, objekt_id, plan_datum,
                              beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                              erstellt_von_art, erstellt_von)
         values ($1::uuid, 'manuell', $2::uuid, '2026-05-14',
                 '2026-05-14T06:00Z', '2026-05-14T10:00Z', '08:00', '12:00',
                 'mensch', $3::uuid)`,
        [f.reinigung, fremdesObjekt, leitung])))
        .rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
    });
});
