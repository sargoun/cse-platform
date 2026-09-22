import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AnfrageFehler, AUFNAHME_WEGE, istAufnahmeWeg, nimmAnfrageAuf,
} from '../../src/server/services/datenschutz/anfrage.js';

/**
 * **Der Brief und der Anruf** (V-031, Art. 12 Abs. 1 DSGVO).
 *
 * `betroffenenanfrage` hatte genau einen Erzeuger — das öffentliche Formular,
 * über einen Prinzipal mit `formular.schreiben`. Wer im Büro den Datenschutz
 * führt, konnte lesen, entscheiden, verlängern und zuordnen, aber keine Zeile
 * anlegen. Ein Brief löste damit dieselbe Monatsfrist aus wie das Formular und
 * hatte in der Plattform, die diese Frist überwacht, keinen Platz.
 *
 * **Was hier gemessen wird, ist die FRIST und nicht das Formular.** Der
 * gefährliche Fall ist nicht die fehlende Zeile, sondern die falsch
 * berechnete Uhr: ein Brief vom Ersten, am Zwanzigsten erfasst, hat noch zehn
 * Tage — und ein Eingang in der Zukunft verschaffte eine Frist, die niemand
 * gewährt hat. Beide Richtungen stehen unten je als eigene Zusage.
 */

let f: Fixtur;
/** Hält `datenschutz.auskunft_erstellen` in der Reinigung. */
let dsb = '';
/** Hält in dieser Gesellschaft KEIN Datenschutzrecht. */
let fremd = '';
/**
 * Hält `datenschutz.auskunft_erstellen` und **nicht** `formular.schreiben`.
 *
 * Er ist der Fall, an dem sich die neue Policy überhaupt messen lässt. `admin`
 * und `leitung` tragen `formular.schreiben` von Haus aus (Katalog §87), und
 * erlaubende Policies werden verodert — an einem gewöhnlichen `leitung` wäre
 * jeder Insert erlaubt, gleich welche Policy ihn durchlässt. Der Entzug je
 * Gesellschaft (`gewaehrt = false`) trennt die beiden Wege für diese eine
 * Sitzung und macht sichtbar, welche Policy greift.
 */
let nurDs = '';

async function konto(email: string, rolle: string): Promise<string> {
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
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  dsb = await konto('aufnahme-dsb@test.invalid', 'leitung');
  fremd = await konto('aufnahme-fremd@test.invalid', 'mitarbeiter');
  nurDs = await konto('aufnahme-nur-ds@test.invalid', 'leitung');

  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung
               where schluessel = 'datenschutz.auskunft_erstellen'), $1, true)`,
    [f.reinigung]);

  /*
   * Und `formular.schreiben` wieder weg — je Gesellschaft, nicht global: eine
   * Zeile mit `mandant_id` und `gewaehrt = false` sticht die globale Bindung
   * (`app.hat_recht`, 0169). Damit hält `leitung` in DIESER Gesellschaft nur
   * noch das Datenschutzrecht.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = 'formular.schreiben'),
             $1, false)`,
    [f.reinigung]);
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

const BRIEF = {
  art: 'auskunft' as const,
  name: 'Amira Said',
  email: 'amira@post.invalid',
  eingangsweg: 'brief' as const,
};

describe('§1 die Aufnahme legt an — mit Weg und benanntem Menschen', () => {
  it('ein Brief wird zur Zeile, und der Aufnehmende steht darin', async () => {
    const a = await imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, nachricht: 'Bittet um Auskunft über alle gespeicherten Daten.',
    }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select eingangsweg::text as weg, erfasst_von, art::text as art, status::text as status
         from betroffenenanfrage where id = $1`, [a.id]),
    ) as unknown as { weg: string; erfasst_von: string; art: string; status: string }[];
    expect(z!.weg).toBe('brief');
    expect(z!.erfasst_von).toBe(dsb);
    expect(z!.art).toBe('auskunft');
    // Sie beginnt als `neu` — dieselbe Warteschlange wie das Formular.
    expect(z!.status).toBe('neu');
  });

  it('alle vier Wege gehen — `formular` ist keiner davon', async () => {
    for (const weg of AUFNAHME_WEGE) {
      const a = await imKontext(dsb, (k) => nimmAnfrageAuf(k, { ...BRIEF, eingangsweg: weg }));
      expect(a.id, weg).not.toBe('');
    }
    expect(AUFNAHME_WEGE).not.toContain('formular');
    expect(istAufnahmeWeg('formular')).toBe(false);
    expect(istAufnahmeWeg('telefon')).toBe(true);
  });

  it('`formular` wird abgewiesen — dieser Weg gehört dem Eingangsprinzipal', async () => {
    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, eingangsweg: 'formular',
    }))).rejects.toThrow(AnfrageFehler);
  });
});

describe('§2 die Frist läuft ab EINGANG, nicht ab Erfassung', () => {
  /**
   * Der Kern des Befundes. Ohne diese Zusage wäre die Aufnahme eine bequemere
   * Schreibweise für „jetzt" — und der Brief vom Ersten bekäme am Zwanzigsten
   * noch einen ganzen Monat, den Art. 12 Abs. 3 ihm nicht gibt.
   */
  it('ein rückdatierter Eingang gibt eine rückdatierte Frist', async () => {
    const [jetzt] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char((now() at time zone 'Europe/Berlin') - interval '19 days',
                      'YYYY-MM-DD"T"HH24:MI') as wert`),
    ) as unknown as { wert: string }[];

    const a = await imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, eingegangenAm: jetzt!.wert,
    }));

    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select (extract(day from (frist_am - now()))::int) as tage,
              (eingegangen_am at time zone 'Europe/Berlin')::date as eingang
         from betroffenenanfrage where id = $1`, [a.id]),
    ) as unknown as { tage: number; eingang: Date }[];

    /*
     * Ein Monat ab einem Eingang vor 19 Tagen: elf bis zwölf Tage Rest, je
     * nachdem, wie lang der Monat ist. Was die Zusage ausschliesst, ist der
     * Fehler — knapp dreissig Tage, also eine ab HEUTE gerechnete Frist.
     */
    expect(z!.tage).toBeGreaterThanOrEqual(7);
    expect(z!.tage).toBeLessThanOrEqual(13);
  });

  it('ohne Angabe ist der Eingang jetzt', async () => {
    const a = await imKontext(dsb, (k) => nimmAnfrageAuf(k, { ...BRIEF, eingangsweg: 'telefon' }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select (extract(day from (frist_am - now()))::int) as tage
         from betroffenenanfrage where id = $1`, [a.id]),
    ) as unknown as { tage: number }[];
    expect(z!.tage).toBeGreaterThanOrEqual(27);
  });

  it('ein Eingang in der ZUKUNFT wird abgewiesen', async () => {
    const [spaeter] = await alsRolle('', (tx) => tx.unsafe(
      `select to_char((now() at time zone 'Europe/Berlin') + interval '2 days',
                      'YYYY-MM-DD"T"HH24:MI') as wert`),
    ) as unknown as { wert: string }[];

    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, eingegangenAm: spaeter!.wert,
    }))).rejects.toMatchObject({ grund: 'eingang_zukunft' });
  });

  it('eine unlesbare Angabe wird abgewiesen, nicht geraten', async () => {
    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, eingegangenAm: '01.09.2026',
    }))).rejects.toMatchObject({ grund: 'eingang_unlesbar' });
  });
});

describe('§3 die Policy hält, was der Dienst verspricht', () => {
  it('ohne Datenschutzrecht entsteht keine Zeile', async () => {
    await expect(imKontext(fremd, (k) => nimmAnfrageAuf(k, BRIEF))).rejects.toThrow();
  });

  /**
   * **Die Gegenprobe zu §1: der Dienst allein reicht nicht.**
   *
   * `nimmAnfrageAuf` prüft `formular` in TypeScript; wer an ihm vorbei
   * schreibt, trifft die Policy. Gemessen wird an `nurDs` — dem Konto, dem
   * `formular.schreiben` je Gesellschaft entzogen ist. An einem gewöhnlichen
   * `leitung` ginge der Insert durch, und zwar durch die Policy des
   * Eingangsprinzipals: erlaubende Policies werden verodert. Das ist kein
   * Loch (derselbe Mensch könnte das öffentliche Formular absenden), aber es
   * ist auch nicht die Trennung — die steht im CHECK darunter.
   */
  it('roher `insert` mit `formular` scheitert an der Aufnahme-Policy', async () => {
    // Der Weg des Büros geht.
    await imKontext(nurDs, (k) => nimmAnfrageAuf(k, BRIEF));

    // Der Weg des Eingangsprinzipals nicht.
    await expect(alsApp(sitzung(nurDs), async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return tx.unsafe(
        `insert into betroffenenanfrage
           (mandant_id, art, name, email, eingangsweg)
         values (app.aktiver_mandant(), 'auskunft', 'Amira Said',
                 'amira@post.invalid', 'formular')`);
    })).rejects.toThrow(/row-level security/);
  });

  it('`formular` ohne Aufnehmenden und Aufnahme mit — der Check hält beides', async () => {
    // Ein aufgenommener Weg OHNE `erfasst_von` ist keine Aufnahme.
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into betroffenenanfrage (mandant_id, art, name, email, eingangsweg)
       values ($1, 'auskunft', 'Amira Said', 'amira@post.invalid', 'brief')`,
      [f.reinigung]))).rejects.toThrow(/aufnahme_belegt/);

    // Und ein Formulareingang MIT `erfasst_von` ist eine Erfindung.
    await expect(alsRolle('', (tx) => tx.unsafe(
      `insert into betroffenenanfrage
         (mandant_id, art, name, email, eingangsweg, erfasst_von)
       values ($1, 'auskunft', 'Amira Said', 'amira@post.invalid', 'formular', $2)`,
      [f.reinigung, dsb]))).rejects.toThrow(/aufnahme_belegt/);
  });
});

describe('§4 die Eingaben werden geprüft, nicht durchgereicht', () => {
  it('ohne Namen, ohne Adresse, ohne Art — je ein eigener Grund', async () => {
    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, { ...BRIEF, name: '  ' })))
      .rejects.toMatchObject({ grund: 'name_fehlt' });
    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, { ...BRIEF, email: 'amira' })))
      .rejects.toMatchObject({ grund: 'email_ungueltig' });
    await expect(imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, art: 'beschwerde' as never,
    }))).rejects.toMatchObject({ grund: 'art_fehlt' });
  });

  it('die Adresse wird klein geschrieben, der Name nur beschnitten', async () => {
    const a = await imKontext(dsb, (k) => nimmAnfrageAuf(k, {
      ...BRIEF, name: '  Amira Said  ', email: 'Amira@Post.Invalid',
    }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select name, email from betroffenenanfrage where id = $1`, [a.id]),
    ) as unknown as { name: string; email: string }[];
    expect(z!.name).toBe('Amira Said');
    expect(z!.email).toBe('amira@post.invalid');
  });
});
