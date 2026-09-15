/**
 * Die drei fehlenden SPEC-§14-Wächter gegen eine echte Datenbank (0149).
 *
 *  1. **Die Umkehrung der Rechtefrage stimmt mit der Hinrichtung überein.**
 *     `kern.traeger_des_rechts` und `app.hat_recht` teilen sich eine
 *     Implementierung (D-494) — der Test prüft es an derselben Person.
 *  2. **Schicht beendet, kein Zeiteintrag**: gemeldet wird nur eine ZUSAGE,
 *     nur nach dem Nachlauf, und nur ohne Eintrag.
 *  3. **Morgen unbesetzt**: gezählt werden Zusagen, nicht Einteilungen — und
 *     die Untergrenze ist das Minimum, wo es gesetzt ist.
 *  4. **Zweimal melden gibt es nicht** — aber morgen wieder, wenn die Lage
 *     bleibt (`kennung` ist der Tag).
 *  5. Ein Dienstkonto bekommt nichts: es hat keinen Posteingang, den jemand
 *     liest.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  NACHLAUF_STUNDEN, findeOffeneSchichten, findeUnbesetzteSchichten, planer, quittiere,
} from '../../src/server/services/waechter/dienstplan.js';

let f: Fixtur;
let planerKonto: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(
  mandantId: string, rolle: string, dienstkonto = false,
): Promise<string> {
  const mail = `w-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [mail]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, ist_dienstkonto)
     values ($1, $2, 'Wachtest', 'aktiv', $3)`, [u!.id, mail, dienstkonto]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

/** Ein Einsatz mit Zeitfenster relativ zu jetzt, plus Objekt. */
async function legeEinsatzAn(teil: {
  mandantId: string; beginnStunden: number; endeStunden: number;
  soll?: number; min?: number; tagOffset?: number;
}): Promise<string> {
  /*
   * Kunde und Objekt gehören zur Fixtur: `einsatz` verlangt einen Kunden —
   * entweder über das Objekt oder direkt (Trigger aus 0028). Eine Schicht ohne
   * Auftraggeber gibt es in diesem Betrieb nicht.
   */
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Bezirksamt Mitte') returning id`,
    [teil.mandantId, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort, kunde_id)
     values ($1, $2, 'Dienstgebäude Mitte', 'Musterweg 1', '10178', 'Berlin', $3) returning id`,
    [teil.mandantId, `OBJ-${zufall()}`, k!.id]);
  /**
   * **Zwei Zeitachsen, und der Unterschied ist genau das, was die zweite
   * Wache prüft.** Ohne `tagOffset` liegt die Schicht relativ zu JETZT — so
   * testet man „vor fünf Stunden beendet". Mit `tagOffset` liegt sie auf
   * einem BERLINER Kalendertag: „morgen 06:00". Beides über `now()` zu
   * rechnen ginge schief, sobald der Lauf nach 18:00 UTC stattfindet — dann
   * wäre „jetzt + 24 h" bereits übermorgen in Berlin, und der Test schlüge
   * abends fehl und morgens nicht (Invariante 2, K-11).
   */
  const [e] = teil.tagOffset === undefined
    ? await sql.unsafe<{ id: string }[]>(
      `insert into einsatz
         (mandant_id, quelle, quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt,
          zeitzone, beginn_lokal, ende_lokal, endet_am_folgetag,
          objekt_id, soll_besetzung, min_besetzung, status, erstellt_von_art)
       select $1, 'manuell', $2,
              (now() at time zone 'Europe/Berlin')::date,
              now() + ($3 || ' hours')::interval,
              now() + ($4 || ' hours')::interval,
              'Europe/Berlin',
              (now() + ($3 || ' hours')::interval) at time zone 'Europe/Berlin',
              (now() + ($4 || ' hours')::interval) at time zone 'Europe/Berlin',
              -- endet_am_folgetag, gerechnet. beginn_lokal und ende_lokal
              -- sind time-Spalten, und einsatz_folgetag verlangt
              -- endet_am_folgetag ODER ende_lokal > beginn_lokal. Eine
              -- Schicht "vor drei Stunden begonnen, vor einer beendet" liegt
              -- normalerweise in einem Berliner Tag -- zwischen Mitternacht
              -- und drei Uhr aber nicht: Beginn 23:14, Ende 01:14, und als
              -- Uhrzeiten gelesen ist das Ende FRUEHER. Der Einsatz wurde
              -- abgewiesen, und zwar nur in diesen drei Stunden: ein Test,
              -- der nachts faellt und morgens nicht. Das ist keine Schwaeche
              -- der Bedingung, sondern ihr Zweck (Invariante 2: Schichten
              -- kreuzen Mitternacht). Die Fixtur benennt den Fall, statt ihn
              -- zu meiden.
              ((now() + ($4 || ' hours')::interval) at time zone 'Europe/Berlin')::date
                > ((now() + ($3 || ' hours')::interval) at time zone 'Europe/Berlin')::date,
              $5, $6::int, $7::int, 'geplant', 'system'
       returning id`,
      [teil.mandantId, `w-${zufall()}`, String(teil.beginnStunden), String(teil.endeStunden),
        o!.id, teil.soll ?? 1, teil.min ?? (teil.soll ?? 1)])
    : await sql.unsafe<{ id: string }[]>(
      `insert into einsatz
         (mandant_id, quelle, quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt,
          zeitzone, beginn_lokal, ende_lokal, endet_am_folgetag,
          objekt_id, soll_besetzung, min_besetzung, status, erstellt_von_art)
       select $1, 'manuell', $2,
              app.berlin_heute() + $3::int,
              ((app.berlin_heute() + $3::int)::timestamp + ($4 || ' hours')::interval)
                at time zone 'Europe/Berlin',
              ((app.berlin_heute() + $3::int)::timestamp + ($5 || ' hours')::interval)
                at time zone 'Europe/Berlin',
              'Europe/Berlin',
              (app.berlin_heute() + $3::int)::timestamp + ($4 || ' hours')::interval,
              (app.berlin_heute() + $3::int)::timestamp + ($5 || ' hours')::interval,
              -- Dieselbe Rechnung wie oben, hier aus den Stundenzahlen: ein
              -- Fenster 22:00–06:00 endet am Folgetag.
              $5::int >= 24 or ($5::int % 24) < ($4::int % 24),
              $6, $7::int, $8::int, 'geplant', 'system'
       returning id`,
      [teil.mandantId, `w-${zufall()}`, String(teil.tagOffset), String(teil.beginnStunden),
        String(teil.endeStunden), o!.id, teil.soll ?? 1, teil.min ?? (teil.soll ?? 1)]);
  return e!.id;
}

async function legeZuordnungAn(
  mandantId: string, einsatzId: string, anstellungId: string, personId: string, status: string,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung
       (mandant_id, einsatz_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        funktion, status, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'reinigungskraft',
            $5::zuordnung_status, 'system'
       from einsatz e where e.id = $2::uuid
     returning id`, [mandantId, einsatzId, anstellungId, personId, status]);
  return z!.id;
}

/** Der Lauf, wie ihn der Job fährt: als `cse_job`. */
async function alsWaechter<T>(fn: (db: {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}) => Promise<T>): Promise<T> {
  return alsRolle('cse_job', async (tx: postgres.TransactionSql) => fn({
    unsafe: (a: string, w?: readonly unknown[]) =>
      tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]>,
  })) as Promise<T>;
}

beforeEach(async () => {
  f = await seed();
  planerKonto = await legeKontoAn(f.reinigung, 'leitung');
  await sql.unsafe(`delete from waechter_meldung`);
  await sql.unsafe(`delete from benachrichtigung`);
  await sql.unsafe(`delete from zeiteintrag`);
  await sql.unsafe(`delete from einsatz_zuordnung`);
  await sql.unsafe(`delete from einsatz`);
});

afterAll(schliessen);

describe('(1) Die Umkehrung der Rechtefrage (D-494)', () => {
  it('traeger_des_rechts und hat_recht sind sich einig', async () => {
    const traeger = await alsWaechter(async (db) => {
      const [z] = (await db.unsafe(
        `select kern.traeger_des_rechts($1::uuid, 'dienstplan.schreiben') as ids`,
        [f.reinigung])) as readonly { ids: string[] }[];
      return z!.ids;
    });
    expect(traeger, 'die Leitung schreibt den Dienstplan').toContain(planerKonto);

    /* Die Hinrichtung, aus der Sitzung derselben Person. */
    const [aus] = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planerKonto,
        portal: 'intern', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()) as darf`),
    ) as readonly { darf: boolean }[];
    expect(aus!.darf, 'beide Richtungen, eine Implementierung').toBe(true);
  });

  it('ein Dienstkonto zaehlt nicht als Empfaenger', async () => {
    const dienst = await legeKontoAn(f.reinigung, 'leitung', true);
    const traeger = await alsWaechter(async (db) => planer(db, f.reinigung));
    expect(traeger).toContain(planerKonto);
    expect(traeger, 'ein Dienstkonto hat keinen Posteingang, den jemand liest')
      .not.toContain(dienst);
  });

  it('eine fremde Gesellschaft liefert diesen Menschen nicht', async () => {
    const traeger = await alsWaechter(async (db) => planer(db, f.security));
    expect(traeger).not.toContain(planerKonto);
  });
});

describe('(2) Schicht beendet, kein Zeiteintrag', () => {
  it('meldet eine ZUSAGE nach dem Nachlauf — und nicht davor', async () => {
    const frisch = await legeEinsatzAn({
      mandantId: f.reinigung, beginnStunden: -3, endeStunden: -1,
    });
    await legeZuordnungAn(
      f.reinigung, frisch, f.jonasReinigung, f.jonas, 'zugesagt');

    const nochNicht = await alsWaechter(findeOffeneSchichten);
    expect(nochNicht, `eine Stunde nach Ende ist keine Meldung (Nachlauf ${String(NACHLAUF_STUNDEN)} h)`)
      .toHaveLength(0);

    const alt = await legeEinsatzAn({
      mandantId: f.reinigung, beginnStunden: -8, endeStunden: -5,
    });
    await legeZuordnungAn(f.reinigung, alt, f.jonasReinigung, f.jonas, 'zugesagt');

    const offen = await alsWaechter(findeOffeneSchichten);
    expect(offen).toHaveLength(1);
    expect(offen[0]!.einsatzId).toBe(alt);
    expect(offen[0]!.stundenHer).toBeGreaterThanOrEqual(5);
  });

  it('eine blosse Einteilung ohne Zusage ist eine Besetzungsluecke, keine Zeitluecke', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: -8, endeStunden: -5 });
    await legeZuordnungAn(f.reinigung, e, f.jonasReinigung, f.jonas, 'geplant');
    expect(await alsWaechter(findeOffeneSchichten)).toHaveLength(0);
  });

  it('mit Zeiteintrag meldet sie nicht — mit storniertem schon', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: -8, endeStunden: -5 });
    const z = await legeZuordnungAn(f.reinigung, e, f.jonasReinigung, f.jonas, 'zugesagt');

    const [ze] = await sql.unsafe<{ id: string }[]>(
      `insert into zeiteintrag
         (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
          beginn_zeitpunkt, ende_zeitpunkt, pause_minuten, dauer_brutto_minuten,
          dauer_netto_minuten, erfassungsart_beginn, erfassungsart_ende,
          quelle_beginn, quelle_ende, status, erstellt_von_art,
          nacherfasst, behauptet_beginn, behauptet_ende)
       select $1, $2, $3, e.id, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 0, 180, 180,
              'planer_manuell', 'planer_manuell', 'planer_entscheidung', 'planer_entscheidung',
              'abgeschlossen', 'system',
              /* Eine Planerentscheidung IST eine Nacherfassung (0034) — und eine
                 Nacherfassung braucht die behaupteten Zeiten. */
              true, e.beginn_zeitpunkt, e.ende_zeitpunkt
         from einsatz e where e.id = $5::uuid
       returning id`,
      [f.reinigung, f.jonasReinigung, f.jonas, z, e]);
    expect(await alsWaechter(findeOffeneSchichten)).toHaveLength(0);

    await sql.unsafe(
      `update zeiteintrag set status = 'storniert', storniert_am = now(),
              storno_grund = 'Doppelt erfasst — die zweite Zeile ist die richtige.'
        where id = $1`, [ze!.id]);
    expect(await alsWaechter(findeOffeneSchichten),
      'ein stornierter Eintrag ist keiner').toHaveLength(1);
  });

  it('ein stornierter Einsatz meldet nicht', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: -8, endeStunden: -5 });
    await legeZuordnungAn(f.reinigung, e, f.jonasReinigung, f.jonas, 'zugesagt');
    await sql.unsafe(
      `update einsatz set status = 'storniert', storniert_am = now(),
              storno_grund = 'Auftrag wurde vom Kunden abbestellt.'
        where id = $1`, [e]);
    expect(await alsWaechter(findeOffeneSchichten)).toHaveLength(0);
  });
});

describe('(3) Morgen unbesetzt', () => {
  it('zaehlt ZUSAGEN, nicht Einteilungen', async () => {
    const e = await legeEinsatzAn({
      mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14, soll: 2, min: 2, tagOffset: 1,
    });
    await legeZuordnungAn(f.reinigung, e, f.jonasReinigung, f.jonas, 'geplant');
    await legeZuordnungAn(f.reinigung, e, f.fatimaReinigung, f.fatima, 'geplant');

    const luecken = await alsWaechter(findeUnbesetzteSchichten);
    expect(luecken, 'zwei Einteilungen, null Zusagen — morgen steht niemand da').toHaveLength(1);
    expect(luecken[0]!.besetzt).toBe(0);
    expect(luecken[0]!.soll).toBe(2);
  });

  it('die Untergrenze ist das Minimum, wo es gesetzt ist', async () => {
    const e = await legeEinsatzAn({
      mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14, soll: 3, min: 2, tagOffset: 1,
    });
    await legeZuordnungAn(f.reinigung, e, f.jonasReinigung, f.jonas, 'zugesagt');
    await legeZuordnungAn(f.reinigung, e, f.fatimaReinigung, f.fatima, 'zugesagt');

    expect(await alsWaechter(findeUnbesetzteSchichten),
      'zwei von drei ist knapp, aber ueber dem Minimum — keine Meldung').toHaveLength(0);
  });

  it('uebermorgen ist nicht morgen', async () => {
    await legeEinsatzAn({
      mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14, soll: 1, tagOffset: 2,
    });
    expect(await alsWaechter(findeUnbesetzteSchichten)).toHaveLength(0);
  });
});

describe('(4) Das Gedaechtnis', () => {
  it('zweimal dieselbe Lage quittiert nur einmal', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14 });
    const erst = await alsWaechter(async (db) => quittiere(db, {
      mandantId: f.reinigung, waechter: 'morgen_unbesetzt', objektTyp: 'einsatz',
      objektId: e, empfaengerId: planerKonto, kennung: '2026-09-15',
    }));
    const zweit = await alsWaechter(async (db) => quittiere(db, {
      mandantId: f.reinigung, waechter: 'morgen_unbesetzt', objektTyp: 'einsatz',
      objektId: e, empfaengerId: planerKonto, kennung: '2026-09-15',
    }));
    /* `quittiere` gibt seit der Pruefrunde die KENNUNG der Quittung zurueck —
       damit der Lauf sie zurueckgeben kann, wenn nichts zugestellt wurde. */
    expect(erst).not.toBeNull();
    expect(zweit, 'die Quittung ist ein Index, keine Absprache').toBeNull();
  });

  it('ein anderer TAG ist eine neue Lage und meldet erneut', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14 });
    const erst = await alsWaechter(async (db) => quittiere(db, {
      mandantId: f.reinigung, waechter: 'morgen_unbesetzt', objektTyp: 'einsatz',
      objektId: e, empfaengerId: planerKonto, kennung: '2026-09-15',
    }));
    const morgen = await alsWaechter(async (db) => quittiere(db, {
      mandantId: f.reinigung, waechter: 'morgen_unbesetzt', objektTyp: 'einsatz',
      objektId: e, empfaengerId: planerKonto, kennung: '2026-09-16',
    }));
    expect(erst).not.toBeNull();
    expect(morgen, 'morgen immer noch unbesetzt ist eine neue Lage').not.toBeNull();
  });

  it('ein Empfaenger aus einer fremden Gesellschaft wird abgewiesen', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14 });
    const fremder = await legeKontoAn(f.security, 'leitung');
    await expect(alsWaechter(async (db) => quittiere(db, {
      mandantId: f.reinigung, waechter: 'morgen_unbesetzt', objektTyp: 'einsatz',
      objektId: e, empfaengerId: fremder, kennung: '',
    }))).rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });

  it('cse_app schreibt keine Quittung', async () => {
    const e = await legeEinsatzAn({ mandantId: f.reinigung, beginnStunden: 6, endeStunden: 14 });
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: planerKonto,
        portal: 'intern', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into waechter_meldung
           (mandant_id, waechter, objekt_typ, objekt_id, empfaenger_id)
         values ($1,'morgen_unbesetzt','einsatz',$2,$3)`, [f.reinigung, e, planerKonto])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });
});
