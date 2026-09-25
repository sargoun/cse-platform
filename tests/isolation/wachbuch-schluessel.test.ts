/**
 * Das Wachbuch nimmt Schluesseleintraege an (V-180, D-674; SEC-05 „key",
 * SEC-07) — an echtem Postgres.
 *
 * **Der Befund.** Der Wachbuchdienst wies die Art `schluessel` grundsaetzlich
 * ab — „die Schluesselverwaltung ist noch nicht gebaut". Sie war gebaut
 * (0079), der Fremdschluessel `wachbuch_schluessel_fk` stand da, und
 * `schluessel_quittung.wachbuch_eintrag_id` wurde von keinem Weg gesetzt.
 * Eine Schluesselbewegung tauchte damit weder als eigene Seite noch ueber
 * eine Verknuepfung im Wachbuch auf.
 *
 * Geprueft wird:
 *  1. eine Seite der Art `schluessel` mit dem Schluessel DIESES Objekts —
 *     und die Kette bleibt intakt (der Schluessel steht in der Nutzlast);
 *  2. der Schluessel eines anderen Objekts wird vor dem Schreiben abgewiesen;
 *  3. die Richtigstellung einer Schluesselseite behaelt den Schluessel;
 *  4. eine Quittung mit `imWachbuch` schreibt die Seite in DERSELBEN
 *     Transaktion und zeigt auf sie; ohne Urheber scheitert beides zusammen;
 *  5. die Wache im Mitarbeiterportal (M1-Scope) schreibt die Seite mit dem
 *     Schluessel ihres Objekts (`schluessel.t_selbst_m1`, 0466).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  BezugPasstNichtZumObjekt, korrigiereEintrag, leseBuch, leseEintrag, pruefeKette,
  schreibeEintrag, KeinUrheber,
} from '../../src/server/services/security/wachbuch.js';
import {
  legeSchluesselAn, leseQuittungen, uebergib,
} from '../../src/server/services/security/schluessel.js';

let f: Fixtur;
let wache = '';
let ohnePerson = '';
let objektId = '';
let schluesselId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null): Promise<string> {
  const email = `wb-schluessel-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  return u!.id;
}

async function objekt(): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Wachkunde')
     returning id`, [f.security, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Werkstor','Teststr. 1','10115','Berlin') returning id`,
    [f.security, k!.id, `O-${zufall()}`]);
  return o!.id;
}

function alsBenutzer<T>(
  benutzer: string, personId: string | null, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: benutzer,
      ...(personId === null ? {} : { personId }), portal: 'intern', readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}
const alsWache = <T,>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> =>
  alsBenutzer(wache, f.fatima, fn);

beforeEach(async () => {
  f = await seed();
  /* Leitung MIT Person: Fatima, beschaeftigt in der Security (Urheber). */
  wache = await konto(f.fatima);
  ohnePerson = await konto(null);
  for (const b of [wache, ohnePerson]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [b, f.security, await rolleId('leitung')]);
  }
  objektId = await objekt();
  schluesselId = await alsWache((k) => legeSchluesselAn(k, {
    objektId, bezeichnung: 'Generalschlüssel Werkstor', schluesselNummer: 'GS-1',
  }));
});
afterAll(schliessen);

describe('(1) eine Seite der Art Schluessel', () => {
  it('entsteht mit dem Schluessel DIESES Objekts, und die Kette bleibt intakt', async () => {
    const id = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'schluessel', schluesselId,
      betreff: 'Generalschlüssel an Fremdfirma', eintragstext: 'Für Wartung ausgegeben.',
    }));
    const [z] = await sql.unsafe<{ art: string; schluessel_id: string }[]>(
      `select art::text, schluessel_id from wachbuch_eintrag where id = $1`, [id]);
    expect(z).toEqual({ art: 'schluessel', schluessel_id: schluesselId });

    const blatt = await alsWache((k) => leseEintrag(k, id));
    expect(blatt?.schluessel).toBe('Generalschlüssel Werkstor · GS-1');
    const kette = await alsWache((k) => pruefeKette(k, objektId));
    expect(kette.intakt).toBe(true);
  });

  it('der Schluessel eines ANDEREN Objekts wird vor dem Schreiben abgewiesen', async () => {
    const anderes = await objekt();
    const fremd = await alsWache((k) => legeSchluesselAn(k, {
      objektId: anderes, bezeichnung: 'Nebenhaus',
    }));
    const fehler = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'schluessel', schluesselId: fremd,
      betreff: 'Falscher Schlüssel', eintragstext: 'Sollte nicht entstehen.',
    }).then(() => null, (x: unknown) => x));
    expect(fehler).toBeInstanceOf(BezugPasstNichtZumObjekt);
    expect((fehler as BezugPasstNichtZumObjekt).tabelle).toBe('schluessel');
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from wachbuch_eintrag where objekt_id = $1`, [objektId]);
    expect(n!.n).toBe(0);
  });

  it('die Richtigstellung einer Schluesselseite behaelt den Schluessel', async () => {
    const alt = await alsWache((k) => schreibeEintrag(k, {
      objektId, art: 'schluessel', schluesselId,
      betreff: 'Schlüssel zurück', eintragstext: 'Zurückgenommen um 18:00.',
    }));
    const neu = await alsWache((k) => korrigiereEintrag(k, {
      eintragId: alt, grund: 'Uhrzeit falsch notiert',
      betreff: 'Schlüssel zurück', eintragstext: 'Zurückgenommen um 19:00.',
    }));
    const [z] = await sql.unsafe<{ art: string; schluessel_id: string }[]>(
      `select art::text, schluessel_id from wachbuch_eintrag where id = $1`, [neu]);
    expect(z).toEqual({ art: 'schluessel', schluessel_id: schluesselId });
  });
});

describe('(2) die Quittung schreibt ihre Seite — in derselben Transaktion', () => {
  it('mit imWachbuch: Seite der Art Schluessel, und die Quittung zeigt auf sie', async () => {
    await alsWache((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
      geplanteRueckgabe: '2030-01-01', imWachbuch: true,
    }));
    const [q] = await alsWache((k) => leseQuittungen(k, schluesselId));
    expect(q!.wachbuchEintragId).not.toBeNull();
    const [seite] = await sql.unsafe<{
      art: string; schluessel_id: string; objekt_id: string; betreff: string; text: string;
    }[]>(
      `select art::text, schluessel_id, objekt_id, betreff, eintragstext as text
         from wachbuch_eintrag where id = $1`, [q!.wachbuchEintragId]);
    expect(seite).toMatchObject({
      art: 'schluessel', schluessel_id: schluesselId, objekt_id: objektId,
      betreff: 'Schlüssel Ausgabe: Generalschlüssel Werkstor (GS-1)',
    });
    expect(seite!.text).toContain('Empfänger: Fatima Yildiz');
    expect(seite!.text).toContain('Geplante Rückgabe: 01.01.2030');

    /* Und das Buch des Objekts kennt die Quittung, die die Seite schrieb. */
    const buch = await alsWache((k) => leseBuch(k, { objektId }));
    expect(buch.map((e) => e.quittungId)).toContain(q!.id);
    expect((await alsWache((k) => pruefeKette(k, objektId))).intakt).toBe(true);
  });

  it('ohne imWachbuch bleibt es bei der Quittung — kein stiller Eintrag', async () => {
    await alsWache((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));
    const [q] = await alsWache((k) => leseQuittungen(k, schluesselId));
    expect(q!.wachbuchEintragId).toBeNull();
  });

  it('ohne Beschaeftigung als Urheber scheitern Seite UND Quittung zusammen', async () => {
    const fehler = await alsBenutzer(ohnePerson, null, (k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz', imWachbuch: true,
    })).then(() => null, (x: unknown) => x);
    expect(fehler).toBeInstanceOf(KeinUrheber);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from schluessel_quittung where schluessel_id = $1`,
      [schluesselId]);
    expect(n!.n).toBe(0);
  });
});

describe('(3) die Wache im Mitarbeiterportal — M1-Scope', () => {
  it('schreibt die Seite mit dem Schluessel ihres Objekts (schluessel.t_selbst_m1)', async () => {
    /* Eine laufende Schicht an diesem Objekt, Fatima eingeteilt. */
    const [k] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id from objekt where id = $1`, [objektId]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            objekt_id, kunde_id, endet_am_folgetag, erstellt_von_art)
       select $1, $2, (now() at time zone 'Europe/Berlin')::date,
              now() - interval '1 hour', now() + interval '4 hours',
              ((now() - interval '1 hour') at time zone 'Europe/Berlin')::time,
              ((now() + interval '4 hours') at time zone 'Europe/Berlin')::time,
              $3, $4,
              ((now() + interval '4 hours') at time zone 'Europe/Berlin')::date
                > ((now() - interval '1 hour') at time zone 'Europe/Berlin')::date,
              'system'
       returning id`, [f.security, `E-${zufall()}`, objektId, k!.kunde_id]);
    /*
     * Ein EIGENER Mensch und nicht Fatima: `benutzer.person_id` ist eindeutig
     * (ein Zugang je Mensch, EMP-14), und `beforeEach` hat Fatima schon ein
     * Konto gegeben — dieselbe Lage wie in `security-wachbuch.test.ts`.
     */
    const [mensch] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Nadia','Kowalski') returning id`);
    const [beschaeftigung] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                               stundensatz_intern)
       values ($1,$2,$3,'2024-01-01',1780) returning id`,
      [f.security, mensch!.id, `S-${zufall()}`]);
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1,$2,$3,$4,'system')`, [f.security, e!.id, beschaeftigung!.id, mensch!.id]);
    const guard = await konto(mensch!.id);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [guard, f.security, await rolleId('mitarbeiter')]);

    const id = await alsApp(
      {
        scope: 'mandant', mandantId: f.security, benutzerId: guard, personId: mensch!.id,
        portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => {
        const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(s, w as never[])) as readonly R[];
        return schreibeEintrag({
          scope: 'mandant', portal: 'mitarbeiter', benutzerId: guard,
          aktiverMandantId: f.security, mandantIds: [f.security],
          abfrage, schreibe: abfrage,
        }, {
          objektId, einsatzId: e!.id, art: 'schluessel', schluesselId,
          betreff: 'Schlüssel übernommen', eintragstext: 'Von der Vorschicht übernommen.',
        });
      },
    );
    const [z] = await sql.unsafe<{ schluessel_id: string }[]>(
      `select schluessel_id from wachbuch_eintrag where id = $1`, [id]);
    expect(z!.schluessel_id).toBe(schluesselId);
  });
});
