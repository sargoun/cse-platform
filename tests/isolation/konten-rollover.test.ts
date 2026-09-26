/**
 * Das Stundenkonto eines Monats entsteht — und der Saldo wandert weiter
 * (V-008, EMP-04, §12.2).
 *
 * **Der Befund, den diese Datei festnagelt.** `eroeffneKonto` hatte im ganzen
 * Baum keinen einzigen Aufrufer: jedes Stundenkonto stammte aus dem Seed.
 * `bucheFreigegebeneZeiten` wirft ohne Konto `KontoFehltFehler`,
 * `bucheKorrektur` ebenso — am 1. Januar wäre damit für jeden Menschen die
 * Zeitbuchung gescheitert, und zwar als Fehler in einem Nachtlauf, den
 * niemand liest.
 *
 * Dazu die zweite Hälfte: `saldo_vortrag_minuten` trug seit je den Kommentar
 * „Setzt `job:konten_rollover` beim Sperren" — und `schliesseMonatAb` schrieb
 * ihn nicht. Ein gesperrter März mit Guthaben übergab dem April **null**; die
 * Summe über zwölf Monate ergab nicht das Jahr, sondern zwölfmal den Monat.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  eroeffneKonto, folgemonat, leseKonten, schliesseMonatAb, uebertrageSaldo,
} from '../../src/server/services/zeit/stundenkonto.js';

let f: Fixtur;
let planer = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: planer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
           portal: 'intern', readonly: false }, fn);

beforeAll(async () => {
  f = await seed();
  const email = `kontenlauf-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  planer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [planer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1,$2,'Kontenlauf','aktiv',
             (select id from rolle where schluessel='super_admin' and mandant_id is null))`,
    [planer, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel='admin' and mandant_id is null),true)`,
    [planer, f.reinigung]);
});
afterAll(schliessen);

async function konto(jahr: number, monat: number): Promise<{
  status: string; saldo_vortrag_minuten: number; saldo_minuten: number;
} | undefined> {
  const [z] = await sql.unsafe(
    `select status::text as status, saldo_vortrag_minuten, saldo_minuten
       from stundenkonto where anstellung_id = $1 and jahr = $2 and monat = $3`,
    [f.jonasReinigung, jahr, monat] as never[]) as never[];
  return z as never;
}

describe('§1 der Folgemonat — mit dem Jahreswechsel, den ein `+ 1` vergisst', () => {
  it('rechnet innerhalb des Jahres weiter', () => {
    expect(folgemonat(2026, 3)).toStrictEqual({ jahr: 2026, monat: 4 });
  });

  it('springt vom Dezember in den Januar des NÄCHSTEN Jahres', () => {
    /*
     * Der eine Fall, den eine Fassung mit `monat + 1` still falsch macht:
     * sie erzeugt den 13. Monat, und `make_date` wirft — im Januar, nachts.
     */
    expect(folgemonat(2026, 12)).toStrictEqual({ jahr: 2027, monat: 1 });
  });
});

describe('§2 ein Konto lässt sich eröffnen — idempotent', () => {
  it('legt das Konto an und gibt es zurück', async () => {
    const k = await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2041, monat: 5,
    }));
    expect(k.jahr).toBe(2041);
    expect(k.monat).toBe(5);
    expect((await konto(2041, 5))?.status).toBe('offen');
  });

  it('gibt beim ZWEITEN Aufruf dasselbe zurück statt ein zweites anzulegen', async () => {
    const a = await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2041, monat: 6,
    }));
    const b = await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2041, monat: 6,
    }));
    expect(b.id).toBe(a.id);
    const [zahl] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from stundenkonto
        where anstellung_id = $1 and jahr = 2041 and monat = 6`, [f.jonasReinigung]);
    expect(zahl!.anzahl).toBe('1');
  });

  it('setzt KEINE Sollzeit — sie ist offen (O-18)', async () => {
    const k = await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2041, monat: 7,
    }));
    /*
     * Eine hergeleitete Sollzeit saehe aus wie eine hinterlegte und wuerde zur
     * Grundlage eines Saldos, den niemand vereinbart hat.
     */
    expect(k.sollMinuten).toBe(0);
  });
});

describe('§3 der Vortrag wandert — auch in ein VORHANDENES Konto', () => {
  it('legt den Folgemonat an, wenn es ihn noch nicht gibt', async () => {
    const gesetzt = await als((tx) => uebertrageSaldo(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2042, monat: 2, vortragMinuten: 450,
    }));
    expect(gesetzt).toBe(true);
    expect(Number((await konto(2042, 2))?.saldo_vortrag_minuten)).toBe(450);
  });

  it('SCHREIBT NACH, wenn das Konto schon offen steht', async () => {
    /*
     * Der Fall, den `on conflict do nothing` still verschluckt: der Nachtlauf
     * hat das Konto laengst geoeffnet, dann wird der Vormonat gesperrt — und
     * der Vortrag bliebe bei 0.
     */
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2042, monat: 3,
    }));
    expect(Number((await konto(2042, 3))?.saldo_vortrag_minuten)).toBe(0);

    const gesetzt = await als((tx) => uebertrageSaldo(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2042, monat: 3, vortragMinuten: -120,
    }));
    expect(gesetzt).toBe(true);
    expect(Number((await konto(2042, 3))?.saldo_vortrag_minuten)).toBe(-120);
  });

  it('lässt einen GESPERRTEN Folgemonat unberührt und meldet es', async () => {
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2042, monat: 4,
    }));
    await sql.unsafe(
      `update stundenkonto set status='gesperrt', gesperrt_am=now(), gesperrt_von=$1
        where anstellung_id=$2 and jahr=2042 and monat=4`,
      [planer, f.jonasReinigung] as never[]);

    const gesetzt = await als((tx) => uebertrageSaldo(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2042, monat: 4, vortragMinuten: 999,
    }));
    /*
     * Dort haengt ein gepraegter § 17-Nachweis. Ein rueckwirkend verschobener
     * Vortrag machte ihn still falsch — die Zahl geht stattdessen ueber
     * `bucheKorrektur` in den ersten OFFENEN Monat.
     */
    expect(gesetzt).toBe(false);
    expect(Number((await konto(2042, 4))?.saldo_vortrag_minuten)).toBe(0);
  });
});

describe('§4 der Monatsabschluss trägt den Saldo weiter (V-008)', () => {
  it('öffnet den Folgemonat mit dem Saldo des gesperrten', async () => {
    /* Ein Monat mit einer Gutschrift von 90 Minuten. */
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2043, monat: 8,
    }));
    const [k] = await sql.unsafe<{ id: string }[]>(
      `select id from stundenkonto
        where anstellung_id=$1 and jahr=2043 and monat=8`, [f.jonasReinigung]);
    await sql.unsafe(
      /* `sb_erstellt_von_ausser_system`: eine manuelle Buchung nennt ihren Menschen. */
      `insert into stundenkonto_bewegung
         (mandant_id, stundenkonto_id, art, minuten, wirksam_am, quelle, begruendung,
          erstellt_von)
       values ($1,$2,'korrektur',90,'2043-08-01','manuell',
               'Startguthaben der Pruefung',$3)`,
      [f.reinigung, k!.id, planer] as never[]);

    const ergebnis = await als((tx) => schliesseMonatAb(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2043, monat: 8,
    }));
    expect(ergebnis.vortragGesetzt).toBe(true);

    const september = await konto(2043, 9);
    expect(september).toBeDefined();
    expect(Number(september?.saldo_vortrag_minuten)).toBe(ergebnis.saldoMinuten);
    expect(Number(september?.saldo_vortrag_minuten)).toBe(90);
  });

  it('trägt über den JAHRESWECHSEL in den Januar', async () => {
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2044, monat: 12,
    }));
    const ergebnis = await als((tx) => schliesseMonatAb(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2044, monat: 12,
    }));
    expect(ergebnis.vortragGesetzt).toBe(true);
    expect(await konto(2045, 1)).toBeDefined();
  });

  it('meldet `false`, wenn der Folgemonat selbst gesperrt ist', async () => {
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2046, monat: 3,
    }));
    await als((tx) => eroeffneKonto(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2046, monat: 4,
    }));
    await sql.unsafe(
      `update stundenkonto set status='gesperrt', gesperrt_am=now(), gesperrt_von=$1
        where anstellung_id=$2 and jahr=2046 and monat=4`,
      [planer, f.jonasReinigung] as never[]);

    const ergebnis = await als((tx) => schliesseMonatAb(kontextAus(tx), {
      anstellungId: f.jonasReinigung, jahr: 2046, monat: 3,
    }));
    expect(ergebnis.vortragGesetzt).toBe(false);
  });

  it('die Kontenliste zeigt den Vortrag, den der Abschluss gesetzt hat', async () => {
    const konten = await als((tx) =>
      leseKonten(kontextAus(tx), { anstellungId: f.jonasReinigung, jahr: 2043 }));
    const september = konten.find((k) => k.monat === 9);
    expect(september?.saldoVortragMinuten).toBe(90);
  });
});
