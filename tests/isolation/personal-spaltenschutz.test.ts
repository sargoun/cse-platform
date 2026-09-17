/**
 * Der Spaltenschutz der Personaldomaene gegen echtes Postgres
 * (K-05, SEC-03, LEG-09, 01-KERN §11, 0190/0193).
 *
 * **Der Befund, den diese Datei einfriert.** Zwei Rechte bewachten je eine
 * Tuer neben einer offenen Wand:
 *
 *  - `person.geburtsdatum` war `cse_app` tabellenweit lesbar. Das Manifest
 *    fuehrt `…/personen/[id]/stammdaten` mit dem eigenen Recht
 *    `personal.stammdaten_lesen` — und jede beliebige Abfrage im Haus las das
 *    Geburtsdatum mit.
 *  - `app.anstellung_entgelt_lesen` prueft bis 0193 nur
 *    `m = any (app.sichtbare_mandanten())`. Jede Sitzung, die die Gesellschaft
 *    ueberhaupt sah, las jeden Stundensatz darin — und `personal.entgelt_lesen`
 *    ist fuer `admin` und `leitung` nur BINDBAR, die Luecke war also real
 *    begehbar.
 *
 * Geprueft wird deshalb beides von beiden Seiten: der direkte Weg ist
 * verschlossen (`permission denied`, nicht maskiert), der Definer-Weg verlangt
 * das Recht (42501, nicht `null`), und jeder erfolgreiche Abruf hinterlaesst
 * genau eine Auditzeile.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let mitRecht = '';      // haelt entgelt_lesen + stammdaten_lesen
let ohneRecht = '';     // haelt personal.lesen + personal.schreiben
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

/**
 * Eine mandanteneigene Rolle mit GENAU den genannten Rechten.
 *
 * Die Systemrolle `leitung` traegt `personal.entgelt_lesen` nur als bindbar,
 * `admin` ebenso — ein Test, der eine Systemrolle nimmt, prueft deshalb
 * entweder zu viel oder zu wenig. Eine eigene Rolle mit einer erschoepfenden
 * Rechteliste macht die Aussage jedes Falls eindeutig.
 */
async function rolleMit(
  mandant: string, schluessel: string, rechte: readonly string[],
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `${schluessel}_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

async function mitgliedschaft(
  benutzer: string, mandant: string, rolle: string,
): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, rolle]);
}

/** Eine Sitzung in der Reinigung — schreibend, internes Portal. */
function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

beforeEach(async () => {
  f = await seed();
  mitRecht = await konto('voll');
  ohneRecht = await konto('planung');
  await mitgliedschaft(mitRecht, f.reinigung, await rolleMit(f.reinigung, 'voll', [
    'personal.lesen', 'personal.schreiben',
    'personal.entgelt_lesen', 'personal.entgelt_schreiben',
    'personal.stammdaten_lesen',
  ]));
  await mitgliedschaft(ohneRecht, f.reinigung, await rolleMit(f.reinigung, 'planung', [
    'personal.lesen', 'personal.schreiben',
  ]));
});
afterAll(schliessen);

describe('(1) person: die drei Stammdatenfelder sind als SPALTE entzogen', () => {
  it('`select geburtsdatum` weist ab — es maskiert nicht', async () => {
    /*
     * Auf der Abfrage geprueft und nicht auf dem Wert: der Spaltenentzug
     * verweigert, er liefert kein NULL. Eine maskierte Zahl saehe aus wie eine
     * Zahl, und eine Pruefung auf NULL waere gruen, sobald jemand den Grant
     * zurueckgibt.
     */
    await expect(
      als(mitRecht, (tx) => tx`select geburtsdatum from person where id = ${f.fatima}`),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('auch `geburtsort` und `staatsangehoerigkeit` — und `select *` damit ebenfalls', async () => {
    for (const spalte of ['geburtsort', 'staatsangehoerigkeit']) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'person', $1, 'SELECT') as ok`, [spalte]);
      expect(z?.ok, `cse_app darf person.${spalte} lesen`).toBe(false);
    }
    await expect(
      als(mitRecht, (tx) => tx`select * from person where id = ${f.fatima}`),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('und die uebrigen Spalten sind lesbar — sonst waere die Tabelle entzogen', async () => {
    const zeilen = await als(mitRecht, (tx) =>
      tx`select id, vorname, nachname, telefon, sprache from person where id = ${f.fatima}`);
    expect(zeilen).toHaveLength(1);
  });

  it('SCHREIBBAR bleiben sie trotzdem — schreibbar und unlesbar ist gueltig (§11)', async () => {
    for (const spalte of ['geburtsdatum', 'geburtsort', 'staatsangehoerigkeit']) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'person', $1, 'UPDATE') as ok`, [spalte]);
      expect(z?.ok, `cse_app darf person.${spalte} nicht schreiben`).toBe(true);
    }
  });
});

describe('(2) app.person_stammdaten_lesen — der eine Lesepfad', () => {
  beforeEach(async () => {
    await sql.unsafe(
      `update person set geburtsdatum = '1990-03-04', geburtsort = 'Ankara',
                        staatsangehoerigkeit = 'TR' where id = $1`, [f.fatima]);
  });

  it('mit dem Recht kommen genau die drei Felder', async () => {
    const zeilen = await als(mitRecht, (tx) =>
      tx`select * from app.person_stammdaten_lesen(${f.fatima})`);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.['geburtsort']).toBe('Ankara');
    expect(String(zeilen[0]?.['staatsangehoerigkeit'])).toBe('TR');
  });

  it('OHNE das Recht wirft sie — sie liefert nicht leer', async () => {
    /*
     * Der Unterschied ist fuer die Oberflaeche wesentlich: „kein Recht" und
     * „nichts hinterlegt" fuehren zu zwei verschiedenen naechsten Schritten.
     */
    await expect(
      als(ohneRecht, (tx) => tx`select * from app.person_stammdaten_lesen(${f.fatima})`),
    ).rejects.toThrow(/nicht berechtigt/u);
  });

  it('eine Person AUSSERHALB der Gesellschaft gibt keine Zeile und keinen Fehler (AUT-06)', async () => {
    /*
     * `jonas` arbeitet nur in der Reinigung. Aus der Security gefragt, darf die
     * Funktion nicht „nicht berechtigt" sagen — das bestaetigte seine Existenz.
     */
    const ausSecurity = await konto('security');
    await mitgliedschaft(ausSecurity, f.security,
      await rolleMit(f.security, 'voll_sec', ['personal.lesen', 'personal.stammdaten_lesen']));
    const zeilen = await als(
      ausSecurity, (tx) => tx`select * from app.person_stammdaten_lesen(${f.jonas})`, f.security);
    expect(zeilen).toHaveLength(0);
  });

  it('jeder erfolgreiche Abruf schreibt GENAU EINE Auditzeile mit Rechtsgrundlage', async () => {
    const [vorher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where aktion = 'personal.stammdaten_gelesen'`);
    await als(mitRecht, (tx) => tx`select * from app.person_stammdaten_lesen(${f.fatima})`);
    const zeilen = await sql.unsafe<{ nachher: unknown }[]>(
      `select nachher from audit_log where aktion = 'personal.stammdaten_gelesen'
        order by erstellt_am desc limit 1`);
    const [nachher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where aktion = 'personal.stammdaten_gelesen'`);
    expect(Number(nachher!.n)).toBe(Number(vorher!.n) + 1);
    expect(JSON.stringify(zeilen[0]?.nachher)).toContain('BewachV');
  });

  it('ein abgewiesener Abruf schreibt KEINE Auditzeile', async () => {
    const [vorher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where aktion = 'personal.stammdaten_gelesen'`);
    await expect(
      als(ohneRecht, (tx) => tx`select * from app.person_stammdaten_lesen(${f.fatima})`),
    ).rejects.toThrow();
    const [nachher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log where aktion = 'personal.stammdaten_gelesen'`);
    expect(Number(nachher!.n)).toBe(Number(vorher!.n));
  });
});

describe('(3) die Schreibpolicy der Personalstelle (0190)', () => {
  it('mit `personal.schreiben` laesst sich die Zeile eines ANDEREN Menschen pflegen', async () => {
    /*
     * Vor 0190 war das strukturell unmoeglich: die einzige UPDATE-Policy war
     * `t_person_selbstpflege` (`id = app.aktuelle_person()`), und `cse_app`
     * hielt genau einen Spalten-UPDATE-Grant (`sprache`). Die Stammdatenmaske
     * war ein reines Leseblatt.
     */
    const zeilen = await als(ohneRecht, (tx) =>
      tx`update person set geburtsort = 'Izmir' where id = ${f.fatima} returning id`);
    expect(zeilen).toHaveLength(1);
  });

  it('aber nicht die eines Menschen, den diese Gesellschaft nicht beschaeftigt', async () => {
    const ausBau = await konto('bau');
    await mitgliedschaft(ausBau, f.bau,
      await rolleMit(f.bau, 'planung_bau', ['personal.lesen', 'personal.schreiben']));
    const zeilen = await als(
      ausBau, (tx) => tx`update person set geburtsort = 'Fremd' where id = ${f.fatima} returning id`,
      f.bau);
    expect(zeilen, 'eine fremde Gesellschaft pflegt keine Stammdaten').toHaveLength(0);
  });

  it('und in der Gruppenansicht schreibt niemand (Invariante 10)', async () => {
    /*
     * Null Zeilen und kein Wurf, und das ist die richtige Form: die Policy
     * bindet an `app.aktiver_mandant()`, den es in der Gruppenansicht nicht
     * gibt (K-20) — die Zeile ist fuer das UPDATE unsichtbar, `with check`
     * kommt gar nicht mehr dran. Geprueft wird deshalb die WIRKUNG.
     */
    const zeilen = await alsApp(
      {
        scope: 'gruppe', mandantIds: [f.reinigung, f.security],
        benutzerId: ohneRecht, readonly: true,
      },
      (tx) => tx`update person set geburtsort = 'Gruppe' where id = ${f.fatima} returning id`);
    expect(zeilen).toHaveLength(0);
    const [danach] = await sql.unsafe<{ ort: string | null }[]>(
      `select geburtsort as ort from person where id = $1`, [f.fatima]);
    expect(danach?.ort).not.toBe('Gruppe');
  });
});

describe('(4) app.entgelt_lesen — gehaertet (0193)', () => {
  it('mit `personal.entgelt_lesen` kommt der Satz der eigenen Gesellschaft', async () => {
    const zeilen = await als(mitRecht, (tx) =>
      tx`select app.entgelt_lesen(${f.fatimaReinigung}) as satz`);
    expect(String(zeilen[0]?.['satz'])).toBe('1450');
  });

  it('OHNE das Recht wirft sie — das war die Luecke', async () => {
    await expect(
      als(ohneRecht, (tx) => tx`select app.entgelt_lesen(${f.fatimaReinigung}) as satz`),
    ).rejects.toThrow(/nicht berechtigt/u);
  });

  it('der alte Name delegiert und ist damit genauso gehaertet', async () => {
    await expect(
      als(ohneRecht, (tx) =>
        tx`select app.anstellung_entgelt_lesen(${f.fatimaReinigung}) as satz`),
    ).rejects.toThrow(/nicht berechtigt/u);
    const zeilen = await als(mitRecht, (tx) =>
      tx`select app.anstellung_entgelt_lesen(${f.fatimaReinigung}) as satz`);
    expect(String(zeilen[0]?.['satz'])).toBe('1450');
  });

  it('eine FREMDE Gesellschaft gibt `null` und keinen Fehler (AUT-06)', async () => {
    /*
     * Hier darf nicht geworfen werden: eine Fehlermeldung „nicht berechtigt"
     * bestaetigte, dass es die Beschaeftigung in der Schwestergesellschaft
     * gibt.
     */
    const zeilen = await als(mitRecht, (tx) =>
      tx`select app.entgelt_lesen(${f.fatimaSecurity}) as satz`);
    expect(zeilen[0]?.['satz']).toBeNull();
  });

  it('und der Spaltenentzug auf `anstellung` bleibt der Grund dafuer', async () => {
    await expect(
      als(mitRecht, (tx) => tx`select stundensatz_intern, tarifgruppe from anstellung`),
    ).rejects.toThrow(/permission denied/iu);
  });
});
