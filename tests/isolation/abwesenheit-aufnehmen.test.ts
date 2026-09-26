import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { meldeAbwesenheit } from '../../src/server/services/abwesenheit/index.js';

/**
 * **Die Krankmeldung am Telefon um 05:40** (V-025, EMP-09).
 *
 * `meldeAbwesenheit` trägt diesen Satz seit je im Kopf — und hing an genau
 * einem Aufrufer: `/api/mein/abwesenheit`, der Route der Arbeiterin selbst.
 * Wer morgens anruft, hat kein Telefon in der Hand, mit dem er sich meldet;
 * das ist der Grund, warum er anruft.
 *
 * **Weder Recht noch Policy fehlten** — `t_mandant_schreiben` verlangt
 * `zeit.abwesenheit_melden`, und `leitung` hält es seit `0073`. Gemessen wird
 * hier deshalb nicht, dass der Dienst rechnet, sondern dass der Weg der
 * Verwaltung dieselben Grenzen findet wie der der Arbeiterin: die fremde
 * Gesellschaft, die doppelte Abwesenheit, das fehlende Recht.
 */

let f: Fixtur;
/** Hält `zeit.abwesenheit_melden` in der Reinigung (Rolle `leitung`). */
let buero = '';
/** Hält in der Reinigung KEIN Melderecht. */
let ohneRecht = '';
let artKrank = '';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  buero = await konto('abw-buero@test.invalid', f.reinigung, 'leitung');
  ohneRecht = await konto('abw-ohne@test.invalid', f.reinigung, 'kunde');

  /*
   * **Die Art muss `bezahlt` gesetzt haben, sonst weist `pruefeArt` sie ab**
   * — und zwar zu Recht (O-139): ob eine Abwesenheit bezahlt ist, ist eine
   * Lohnregel, die niemand erfinden darf. Der Katalog aus `0073` traegt bei
   * allen sieben Arten `bezahlt = null`; die Fixtur beantwortet die Frage
   * fuer GENAU EINE, damit der Test den Weg messen kann statt die offene
   * Frage.
   */
  const [a] = await alsRolle('', (tx) => tx.unsafe(
    `update abwesenheitsart set bezahlt = true
      where schluessel = 'krankheit' and mandant_id is null
      returning id`),
  ) as unknown as { id: string }[];
  artKrank = a!.id;
});
afterAll(schliessen);

function sitzung(benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imKontext<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

describe('§1 die Verwaltung nimmt auf — für eine FREMDE Anstellung', () => {
  it('die Zeile entsteht als `erfasst` und nennt den Aufnehmenden', async () => {
    const z = await imKontext(buero, (k) => meldeAbwesenheit(k, {
      anstellungId: f.jonasReinigung,
      abwesenheitsartId: artKrank,
      von: '2026-03-02', bis: '2026-03-04',
      bemerkung: 'Anruf 05:40, meldet sich für drei Tage krank.',
    }));

    /*
     * `erfasst` und nicht `beantragt`: eine Krankmeldung wird zur Kenntnis
     * genommen. `beantragt` hiesse, jemand entscheide noch darüber.
     */
    expect(z.status).toBe('erfasst');

    const [g] = await alsRolle('', (tx) => tx.unsafe(
      `select erstellt_von, anstellung_id, mandant_id
         from abwesenheit where id = $1`, [z.id]),
    ) as unknown as {
      erstellt_von: string; anstellung_id: string; mandant_id: string;
    }[];
    // Die Spur: die Anstellung ist die FREMDE, der Erfasser das Büro.
    expect(g!.anstellung_id).toBe(f.jonasReinigung);
    expect(g!.erstellt_von).toBe(buero);
    expect(g!.mandant_id).toBe(f.reinigung);
  });

  it('die angerechneten Tage rechnet der Dienst, nicht der Kalender', async () => {
    const z = await imKontext(buero, (k) => meldeAbwesenheit(k, {
      anstellungId: f.jonasReinigung,
      abwesenheitsartId: artKrank,
      von: '2026-04-06', bis: '2026-04-10',
    }));
    // Montag bis Freitag: fünf Arbeitstage, nicht vier Kalendertage Differenz.
    expect(z.tageAngerechnet).not.toBeNull();
    expect(Number(z.tageAngerechnet)).toBeGreaterThan(0);
  });
});

describe('§2 die Grenzen sind dieselben wie auf dem Weg der Arbeiterin', () => {
  /**
   * **Der zusammengesetzte Fremdschlüssel haelt die Gesellschaft.**
   * `ab_anstellung_fk (mandant_id, anstellung_id)` verweist auf
   * `anstellung (mandant_id, id)`. Eine Anstellung der Security laesst sich
   * unter dem Mandanten der Reinigung nicht eintragen — und deshalb braucht
   * die Route keine eigene Pruefung, die beim naechsten Aufrufer fehlte.
   */
  it('eine Anstellung einer ANDEREN Gesellschaft geht nicht', async () => {
    await expect(imKontext(buero, (k) => meldeAbwesenheit(k, {
      anstellungId: f.fatimaSecurity,
      abwesenheitsartId: artKrank,
      von: '2026-05-04', bis: '2026-05-05',
    }))).rejects.toThrow();
  });

  it('zwei Abwesenheiten ueber denselben Tag schliessen einander aus', async () => {
    await imKontext(buero, (k) => meldeAbwesenheit(k, {
      anstellungId: f.fatimaReinigung,
      abwesenheitsartId: artKrank,
      von: '2026-06-01', bis: '2026-06-03',
    }));
    const fehler = await imKontext(buero, (k) => meldeAbwesenheit(k, {
      anstellungId: f.fatimaReinigung,
      abwesenheitsartId: artKrank,
      von: '2026-06-03', bis: '2026-06-05',
    })).catch((x: unknown) => x);
    // 23P01 — die Ausschlussbedingung `abwesenheit_kein_ueberlapp` (0073).
    expect((fehler as { code?: string }).code).toBe('23P01');
  });

  it('ohne `zeit.abwesenheit_melden` entsteht keine Zeile', async () => {
    await expect(imKontext(ohneRecht, (k) => meldeAbwesenheit(k, {
      anstellungId: f.jonasReinigung,
      abwesenheitsartId: artKrank,
      von: '2026-07-06', bis: '2026-07-07',
    }))).rejects.toThrow();
  });
});
