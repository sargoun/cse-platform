import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

/**
 * Die Betroffenenanfrage und der Barrierebericht (LEG-09, LEG-07).
 *
 * **Drei Zusagen, jede mit einem Preis:**
 *
 *  1. **Die Monatsfrist ist kalendarisch und in Berliner Zeit gerechnet.**
 *     Art. 12 Abs. 3 DSGVO nennt einen MONAT, nicht dreissig Tage — im Februar
 *     sind das drei Tage Unterschied, und drei Tage entscheiden über
 *     fristgerecht. Eine generierte Spalte ginge nicht: `timestamptz +
 *     interval` ist nicht immutable, weil der Kalendertag von der Zone abhängt.
 *  2. **Der Eingangsprinzipal legt an und liest NICHT.** Eine Übernahme der
 *     öffentlichen Fläche liefert damit keinen Lesezugriff auf die Liste
 *     derer, die eine Auskunft verlangt haben — und das ist die Liste, die am
 *     meisten verrät.
 *  3. **Ein Barrierebericht braucht keine E-Mail-Adresse.** Der Meldeweg muss
 *     ohne Identifikation offen sein; ein Pflichtfeld wäre eine Hürde vor dem
 *     Weg, der Hürden melden soll.
 */

let f: Fixtur;
let bearbeiter: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('dsb@anfrage.test') returning id`);
  bearbeiter = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [bearbeiter]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'dsb@anfrage.test', 'Datenschutz', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [bearbeiter]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null), true)`,
    [bearbeiter, f.reinigung]);
});
afterAll(schliessen);

function sitzung(mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId: bearbeiter,
           readonly: false, portal: 'intern' as const };
}

/** Eine Anfrage anlegen — am Portal vorbei, als Eigentümer. */
async function anfrageAnlegen(eingang: string, art = 'auskunft'): Promise<string> {
  const [z] = await alsRolle('', (tx) => tx.unsafe(
    `insert into betroffenenanfrage (mandant_id, art, name, email, eingegangen_am)
     values ($1::uuid, $2::betroffenenanfrage_art, 'Amira Said', 'amira@example.test',
             $3::timestamptz)
     returning id`, [f.reinigung, art, eingang])) as unknown as { id: string }[];
  return z!.id;
}

describe('§1 die Monatsfrist — ein Monat, kein Dreissigtagezeitraum', () => {
  it('rechnet vom 31. Januar auf den 28. Februar, nicht auf den 2. März', async () => {
    const id = await anfrageAnlegen('2026-01-31 12:00:00+01');
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char(frist_am at time zone 'Europe/Berlin', 'YYYY-MM-DD') as frist
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { frist: string }[];
    /*
     * `+ interval '30 days'` gaebe den 2. Maerz — zwei Tage NACH der
     * gesetzlichen Frist. Genau der Fehler, den eine Aufsichtsbehoerde als
     * Fristversaeumnis zaehlt.
     */
    expect(z!.frist).toBe('2026-02-28');
  });

  it('hält die Uhrzeit über den Sommerzeitwechsel', async () => {
    /*
     * 15. Maerz + ein Monat = 15. April, und dazwischen liegt die
     * Zeitumstellung (29. Maerz 2026). „Ein Monat spaeter, 12 Uhr" heisst fuer
     * einen Juristen 12 Uhr ORTSZEIT — nicht 11 oder 13.
     */
    const id = await anfrageAnlegen('2026-03-15 12:00:00+01');
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char(frist_am at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') as frist
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { frist: string }[];
    expect(z!.frist).toBe('2026-04-15 12:00');
  });

  it('zählt die verbleibenden Tage gegen die VERLÄNGERTE Frist, wo es eine gibt', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await alsApp(sitzung(), (tx) => tx.unsafe(
      `update betroffenenanfrage
          set verlaengert_bis = eingegangen_am + interval '3 months',
              verlaengert_grund = 'Umfangreicher Antrag ueber drei Gesellschaften.'
        where id = $1::uuid`, [id]));
    const [z] = await alsApp(sitzung(), (tx) => tx.unsafe(
      `select to_char(coalesce(verlaengert_bis, frist_am) at time zone 'Europe/Berlin',
                      'YYYY-MM-DD') as wirksam
         from betroffenenanfrage where id = $1::uuid`, [id])) as unknown as { wirksam: string }[];
    expect(z!.wirksam).toBe('2026-04-01');
  });

  it('lässt keine Verlängerung um MEHR als zwei Monate zu (Art. 12 Abs. 3 Satz 3)', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage
          set verlaengert_bis = eingegangen_am + interval '6 months',
              verlaengert_grund = 'zu lang'
        where id = $1::uuid`, [id]))).rejects.toThrow(/hoechstens_zwei_monate/u);
  });

  it('lässt keine Verlängerung OHNE Grund zu — sie wäre unwirksam', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set verlaengert_bis = eingegangen_am + interval '2 months'
        where id = $1::uuid`, [id]))).rejects.toThrow(/verlaengerung_begruendet/u);
  });
});

describe('§2 eine Entscheidung trägt einen Menschen und einen Grund', () => {
  it('weist „beantwortet" ohne beides ab', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update betroffenenanfrage set status = 'beantwortet' where id = $1::uuid`, [id],
    ))).rejects.toThrow(/beantwortung_belegt/u);
  });

  it('nimmt sie mit Zeitpunkt, Mensch und Entscheidung an', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsApp(sitzung(), (tx) => tx.unsafe(
      `update betroffenenanfrage
          set status = 'beantwortet', beantwortet_am = now(),
              beantwortet_von = app.aktueller_benutzer(),
              entscheidung = 'Auskunft nach Art. 15 erteilt, Kopie per E-Mail versendet.'
        where id = $1::uuid`, [id]))).resolves.toBeTruthy();
  });
});

describe('§3 der Eingangsprinzipal legt an und liest nicht', () => {
  /*
   * Nachgebildet wird die Lage des Prinzipals: `formular.schreiben` ja,
   * `datenschutz.auskunft_erstellen` nein. Geprueft wird die POLICY, nicht der
   * Binder — der steht in `kontext/eingang.ts` und hat seinen eigenen Fall.
   */
  it('die Leseregel verlangt `datenschutz.auskunft_erstellen`', async () => {
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select qual::text as regel from pg_policies
        where tablename = 'betroffenenanfrage' and policyname = 't_betroffenenanfrage_lesen'`,
    )) as unknown as { regel: string }[];
    expect(z!.regel).toContain('datenschutz.auskunft_erstellen');
    /* Und NICHT `formular.schreiben` — das haelt der Eingang. */
    expect(z!.regel).not.toContain('formular.schreiben');
  });

  it('die Anlegeregel verlangt `formular.schreiben` und gibt kein Lesen', async () => {
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select with_check::text as regel, cmd from pg_policies
        where tablename = 'betroffenenanfrage' and policyname = 't_betroffenenanfrage_eingang'`,
    )) as unknown as { regel: string; cmd: string }[];
    expect(z!.cmd).toBe('INSERT');
    expect(z!.regel).toContain('formular.schreiben');
  });

  it('gelöscht wird gar nichts — auch nicht vom Eigentümer', async () => {
    const id = await anfrageAnlegen('2026-01-01 12:00:00+01');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `delete from betroffenenanfrage where id = $1::uuid`, [id]))).rejects.toThrow();
  });
});

describe('§4 der Barrierebericht braucht keine Adresse', () => {
  it('nimmt eine Meldung ohne E-Mail an', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung)
       values ($1::uuid, 'Die Tabelle auf der Preisseite ist mit NVDA nicht lesbar.')`,
      [f.reinigung]))).resolves.toBeTruthy();
  });

  it('weist eine Meldung OHNE Beschreibung ab — das ist das einzige Pflichtfeld', async () => {
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung, email)
       values ($1::uuid, '   ', 'jemand@example.test')`,
      [f.reinigung]))).rejects.toThrow();
  });

  it('verlangt für „behoben" einen Menschen und einen Satz', async () => {
    const [b] = await alsRolle('', (tx) => tx.unsafe(
      `insert into barrierebericht (mandant_id, beschreibung)
       values ($1::uuid, 'Kontrast auf den Hinweiskästen zu gering.') returning id`,
      [f.reinigung])) as unknown as { id: string }[];
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update barrierebericht set status = 'behoben' where id = $1::uuid`, [b!.id],
    ))).rejects.toThrow(/erledigung_belegt/u);
  });
});

describe('§5 Mandantentrennung', () => {
  it('die Security sieht die Anfragen der Reinigung nicht', async () => {
    await anfrageAnlegen('2026-01-01 12:00:00+01');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: bearbeiter,
        readonly: true, portal: 'intern' },
      (tx) => tx.unsafe(`select id from betroffenenanfrage`),
    ) as unknown as { id: string }[];
    expect(zeilen.length).toBe(0);
  });
});
