/**
 * Die beiden Radarwächter gegen eine echte Datenbank (SPEC §14, RAD-08, 0148).
 *
 *  1. **Der Fristenwächter braucht keine Einstellung.** Fünf Tage stehen im
 *     SPEC; er meldet an den Verantwortlichen, ersatzweise an die Empfänger
 *     des Profils — und nur bei einem UNBERÜHRTEN Vorgang.
 *  2. **Zweimal melden gibt es nicht.** Die Quittung ist ein Index, keine
 *     Absprache: derselbe Lauf noch einmal meldet nichts.
 *  3. **Verschiebt sich die Frist, ist das eine neue Lage** — und eine neue
 *     Meldung, weil die Quittung den Fristzeitpunkt trägt.
 *  4. **RAD-08 meldet ohne Schwelle NICHT** (O-15) — und die Zahl derer, die
 *     ohne Schwelle dastehen, steht im Kennzahlensatz, damit „0 Treffer"
 *     nicht wie ein ruhiger Tag aussieht.
 *  5. Die Schwelle des Profils wirkt als Vorgabe; der Empfänger darf sie
 *     verschärfen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { registriereRadarArten } from '../../src/server/services/radar/benachrichtigung.js';
import { pruefeWarnungen } from '../../src/server/services/radar/warnung.js';
import { stelleZuAnKonto } from '../../src/server/benachrichtigung/ablage.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(mandantId: string, rolle = 'admin'): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [`rw-${zufall()}@cse.test`]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, 'Radar-Wache', 'aktiv')`, [u!.id, `rw-${zufall()}@cse.test`]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

async function legeAusschreibungAn(tageBisFrist: number | null): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung (quelle, quell_id, titel, sprache, rohdaten_hash, frist_angebot)
     values ('oeffentlichevergabe', $1, 'Unterhaltsreinigung Rathaus', 'de', $2,
             case when $3::int is null then null
                  else now() + ($3 || ' days')::interval + interval '6 hours' end)
     returning id`, [`rw-${zufall()}`, `${zufall()}${zufall()}`, tageBisFrist]);
  return a!.id;
}

async function legeVorgangAn(
  mandantId: string, ausschreibungId: string, stand: string, verantwortlich: string | null,
): Promise<string> {
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into ausschreibung_vorgang
       (mandant_id, ausschreibung_id, status, verantwortlich_benutzer_id)
     values ($1, $2, $3::ausschreibung_status, $4::uuid) returning id`,
    [mandantId, ausschreibungId, stand, verantwortlich]);
  return v!.id;
}

/** Der Lauf, wie ihn der Job fährt: als `cse_job`, ohne Sitzung. */
async function laufen(): Promise<{
  frist: number; treffer: number; gemeldet: number; ohneSchwelle: number; geprueft: number;
}> {
  return alsRolle('cse_job', async (tx: postgres.TransactionSql) => {
    const db = {
      unsafe: (a: string, w?: readonly unknown[]) =>
        tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]>,
    };
    const e = await pruefeWarnungen(db, async (meldungen) => {
      const z = await stelleZuAnKonto(db, meldungen.map((m) => ({
        benachrichtigung: m.benachrichtigung,
        benutzerId: m.empfaengerId,
        objektTyp: 'ausschreibung',
        objektId: m.ausschreibungId,
      })));
      return z.zugestellt;
    });
    return {
      frist: e.frist, treffer: e.treffer, gemeldet: e.gemeldet,
      ohneSchwelle: e.ohneSchwelle, geprueft: e.geprueft,
    };
  });
}

async function posteingang(benutzerId: string): Promise<readonly { art: string; titel: string }[]> {
  return sql.unsafe<{ art: string; titel: string }[]>(
    `select art, titel from benachrichtigung where empfaenger_id = $1 order by erstellt_am`,
    [benutzerId]);
}

beforeEach(async () => {
  f = await seed();
  registriereRadarArten();
  benutzer = await legeKontoAn(f.reinigung);
  await sql.unsafe(`delete from benachrichtigung`);
  await sql.unsafe(`delete from radar_warnung`);
  await sql.unsafe(`delete from vergabemappe_position`);
  await sql.unsafe(`delete from vergabemappe`);
  await sql.unsafe(`delete from ausschreibung_vorgang`);
  await sql.unsafe(`delete from bewertung`);
  await sql.unsafe(`delete from radar_profil_empfaenger`);
  await sql.unsafe(`delete from radar_profil_cpv`);
  await sql.unsafe(`delete from radar_profil`);
  await sql.unsafe(`delete from ausschreibung_dokument`);
  await sql.unsafe(`delete from ausschreibung_rohdaten`);
  await sql.unsafe(`delete from ausschreibung_nuts`);
  await sql.unsafe(`delete from ausschreibung`);
});

afterAll(schliessen);

describe('(1) Der Fristenwaechter (SPEC §14)', () => {
  it('meldet unter fuenf Tagen an den Verantwortlichen — und nur dann', async () => {
    const knapp = await legeAusschreibungAn(3);
    const weit = await legeAusschreibungAn(30);
    await legeVorgangAn(f.reinigung, knapp, 'geprueft', benutzer);
    await legeVorgangAn(f.reinigung, weit, 'geprueft', benutzer);

    const e = await laufen();
    expect(e.frist, 'nur die knappe Frist').toBe(1);
    expect(e.gemeldet).toBe(1);

    const eingang = await posteingang(benutzer);
    expect(eingang).toHaveLength(1);
    expect(eingang[0]!.art).toBe('radar.frist_knapp');
    expect(eingang[0]!.titel).toMatch(/Abgabe in 3 Tagen/u);
  });

  it('ein Vorgang in Bearbeitung ist beruehrt — und wird nicht gemeldet', async () => {
    const knapp = await legeAusschreibungAn(2);
    const vorgang = await legeVorgangAn(f.reinigung, knapp, 'geprueft', benutzer);
    /* Die Mappe zuerst: `in_bearbeitung` setzt sie voraus (0147). */
    await sql.unsafe(
      `insert into vergabemappe (mandant_id, ausschreibung_vorgang_id) values ($1,$2)`,
      [f.reinigung, vorgang]);
    await sql.unsafe(
      `update ausschreibung_vorgang set status = 'in_bearbeitung' where id = $1`, [vorgang]);

    const e = await laufen();
    expect(e.frist, 'wer dran ist, braucht keine Erinnerung').toBe(0);
  });

  it('ein verworfener Vorgang meldet nicht — die Entscheidung ist gefallen', async () => {
    const knapp = await legeAusschreibungAn(1);
    await sql.unsafe(
      `insert into ausschreibung_vorgang
         (mandant_id, ausschreibung_id, status, verworfen_grund, verantwortlich_benutzer_id)
       values ($1,$2,'verworfen','Keine Kapazitaet im Leistungszeitraum.',$3)`,
      [f.reinigung, knapp, benutzer]);

    const e = await laufen();
    expect(e.frist).toBe(0);
  });

  it('ohne Verantwortlichen melden die Empfaenger des Profils — ohne Punktschwelle', async () => {
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil (mandant_id, name) values ($1, 'Reinigung Berlin') returning id`,
      [f.reinigung]);
    await sql.unsafe(
      `insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id, ab_punkte)
       values ($1,$2,$3,null)`, [f.reinigung, p!.id, benutzer]);

    const knapp = await legeAusschreibungAn(4);
    await sql.unsafe(
      `insert into ausschreibung_vorgang (mandant_id, ausschreibung_id, status, radar_profil_id)
       values ($1,$2,'neu',$3)`, [f.reinigung, knapp, p!.id]);

    const e = await laufen();
    expect(e.frist, 'die Frist haengt nicht an der Punktschwelle').toBe(1);
    expect((await posteingang(benutzer))[0]!.art).toBe('radar.frist_knapp');
  });
});

describe('(2) Zweimal melden gibt es nicht', () => {
  it('derselbe Lauf noch einmal meldet nichts', async () => {
    const knapp = await legeAusschreibungAn(3);
    await legeVorgangAn(f.reinigung, knapp, 'neu', benutzer);

    expect((await laufen()).gemeldet).toBe(1);
    expect((await laufen()).gemeldet, 'die Quittung ist ein Index, keine Absprache').toBe(0);
    expect(await posteingang(benutzer)).toHaveLength(1);
  });

  it('eine verschobene Frist ist eine neue Lage und meldet erneut', async () => {
    const knapp = await legeAusschreibungAn(3);
    await legeVorgangAn(f.reinigung, knapp, 'neu', benutzer);
    expect((await laufen()).gemeldet).toBe(1);

    /* Die Vergabestelle verlaengert — und verkuerzt spaeter wieder. */
    await sql.unsafe(
      `update ausschreibung set frist_angebot = now() + interval '2 days 6 hours' where id = $1`,
      [knapp]);
    expect((await laufen()).gemeldet, 'andere Frist, andere Lage').toBe(1);
    expect(await posteingang(benutzer)).toHaveLength(2);
  });
});

describe('(3) RAD-08 meldet nur mit gesetzter Schwelle (O-15)', () => {
  async function legeBewertungAn(punkte: number, abPunkte: number | null): Promise<string> {
    const a = await legeAusschreibungAn(30);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil (mandant_id, name, benachrichtigung_ab_punkte)
       values ($1, 'Reinigung Berlin', $2) returning id`, [f.reinigung, abPunkte]);
    await sql.unsafe(
      `insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id, ab_punkte)
       values ($1,$2,$3,null)`, [f.reinigung, p!.id, benutzer]);
    await alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into bewertung
         (mandant_id, ausschreibung_id, radar_profil_id, regel_version, profil_version,
          punkte, skala_max, ausgeschlossen, wert_kriterium, aufschluesselung, begruendung,
          eingaben_hash)
       values ($1,$2,$3,'radar-v1',1,$4,100,false,'bewertet','[]'::jsonb,
               'Passt zum Profil.', $5)`,
      [f.reinigung, a, p!.id, punkte, zufall() + zufall()]));
    return a;
  }

  it('ohne Schwelle keine Treffermeldung — und die Zahl steht im Bericht', async () => {
    await legeBewertungAn(90, null);
    const e = await laufen();
    expect(e.treffer).toBe(0);
    expect(e.ohneSchwelle, '„0 Treffer" darf nicht wie ein ruhiger Tag aussehen').toBe(1);
    expect(await posteingang(benutzer)).toHaveLength(0);
  });

  it('mit der Profilschwelle meldet sie — die Schwelle des Profils ist die Vorgabe', async () => {
    await legeBewertungAn(90, 70);
    const e = await laufen();
    expect(e.treffer).toBe(1);
    expect(e.ohneSchwelle).toBe(0);

    const eingang = await posteingang(benutzer);
    expect(eingang).toHaveLength(1);
    expect(eingang[0]!.art).toBe('radar.treffer');
    expect(eingang[0]!.titel).toMatch(/^90 Punkte/u);
  });

  it('unter der Schwelle meldet sie nicht', async () => {
    await legeBewertungAn(40, 70);
    expect((await laufen()).treffer).toBe(0);
  });

  it('der Empfaenger darf die Profilschwelle verschaerfen', async () => {
    const a = await legeAusschreibungAn(30);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil (mandant_id, name, benachrichtigung_ab_punkte)
       values ($1, 'Reinigung Berlin', 40) returning id`, [f.reinigung]);
    await sql.unsafe(
      `insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id, ab_punkte)
       values ($1,$2,$3,95)`, [f.reinigung, p!.id, benutzer]);
    await alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into bewertung
         (mandant_id, ausschreibung_id, radar_profil_id, regel_version, profil_version,
          punkte, skala_max, ausgeschlossen, wert_kriterium, aufschluesselung, begruendung,
          eingaben_hash)
       values ($1,$2,$3,'radar-v1',1,60,100,false,'bewertet','[]'::jsonb,'Passt.',$4)`,
      [f.reinigung, a, p!.id, zufall() + zufall()]));

    expect((await laufen()).treffer, '60 liegt ueber 40, aber unter den eigenen 95').toBe(0);
  });

  it('eine ausgeschlossene Bekanntmachung meldet nie', async () => {
    const a = await legeAusschreibungAn(30);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil (mandant_id, name, benachrichtigung_ab_punkte)
       values ($1, 'Reinigung Berlin', 10) returning id`, [f.reinigung]);
    await sql.unsafe(
      `insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id)
       values ($1,$2,$3)`, [f.reinigung, p!.id, benutzer]);
    await alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into bewertung
         (mandant_id, ausschreibung_id, radar_profil_id, regel_version, profil_version,
          punkte, skala_max, ausgeschlossen, ausschluss_grund, wert_kriterium,
          aufschluesselung, begruendung, eingaben_hash)
       values ($1,$2,$3,'radar-v1',1,80,100,true,'Negativ-Stichwort „Streusalz"','bewertet',
               '[]'::jsonb,'Ausgeschlossen.',$4)`,
      [f.reinigung, a, p!.id, zufall() + zufall()]));

    expect((await laufen()).treffer,
      'die eigene Bewertung zu ignorieren waere die schlimmere Variante').toBe(0);
  });
});

describe('(4) Die Waende', () => {
  it('cse_app schreibt keine Quittung — der Waechter schon', async () => {
    const a = await legeAusschreibungAn(3);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into radar_warnung (mandant_id, ausschreibung_id, empfaenger_id, art)
         values ($1,$2,$3,'frist_knapp')`, [f.reinigung, a, benutzer])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  it('eine fremde Gesellschaft sieht die Quittung nicht', async () => {
    const knapp = await legeAusschreibungAn(3);
    await legeVorgangAn(f.reinigung, knapp, 'neu', benutzer);
    await laufen();

    const fremder = await legeKontoAn(f.security);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: fremder,
        portal: 'intern', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(`select id from radar_warnung`));
    expect(zeilen).toHaveLength(0);
  });

  it('ein Empfaenger aus einer fremden Gesellschaft wird abgewiesen', async () => {
    const a = await legeAusschreibungAn(3);
    const fremder = await legeKontoAn(f.security);
    await expect(alsRolle('cse_job', async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into radar_warnung (mandant_id, ausschreibung_id, empfaenger_id, art)
       values ($1,$2,$3,'frist_knapp')`, [f.reinigung, a, fremder])))
      .rejects.toThrow(/gehoert nicht zu dieser Gesellschaft/u);
  });
});
