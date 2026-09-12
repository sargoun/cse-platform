/**
 * PR 42, Abnahme 3 und 4 — an echtem Postgres.
 *
 *  (3) Eine Schluesseluebergabe erzeugt eine Quittung mit Unterschrift,
 *      BEIDEN Beteiligten und der SERVERZEIT; die Ruecknahme schliesst sie,
 *      und beide Zustaende bleiben protokolliert.
 *  (4) Eine zweite Uebergabe ohne Ruecknahme wird ABGEWIESEN — in der
 *      Datenbank, nicht nur im Dienst.
 *
 * Abnahme 4 wird deshalb DREIMAL geprueft: durch den Dienst, am Dienst vorbei
 * als `cse_app`, und am Dienst vorbei als Eigentuemer der Tabelle. Nur die
 * dritte Probe beweist, was die Migration zusagt — eine Regel, die nur fuer
 * die Anwendungsrolle gilt, ist keine Regel.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { kanonisiere, type KanonischerWert }
  from '../../src/server/services/finanz/kanonisch.js';
import {
  buche, findeSchluessel, legeSchluesselAn, leseQuittungen, leseSchluessel,
  nimmZurueck, pruefeQuittungen, uebergib,
  EmpfaengerNichtGefunden, SchluesselEingabeFehlt, SchonAusgegeben,
} from '../../src/server/services/security/schluessel.js';

let f: Fixtur;
let leitung = '';
let objektId = '';
let schluesselId = '';
/** Jonas, angestellt in DIESER Gesellschaft — der zweite Empfaenger. */
let jonasSecurity = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `schluessel-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Objektleitung','aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Schluesselkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Haupthaus','Teststr. 7','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return o!.id;
}

function alsLeitung<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: leitung,
      portal: 'intern', readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

/** Eine Uebergabe, am Dienst vorbei — mit Pflichtfeldern, die halten. */
const ROH_AUSGABE = `
  insert into schluessel_quittung
    (mandant_id, schluessel_id, objekt_id, art, empfaenger_art, anstellung_id, person_id,
     empfaenger_name, unterzeichner_name, snapshot, snapshot_hash, erstellt_von_art)
  values ($1, $2, $3, 'ausgabe', 'mitarbeiter', $4, $5,
          'Zweite Übergabe', 'Zweite Übergabe',
          '{"probe":"roh"}'::jsonb, repeat('0',64), 'system')`;

beforeEach(async () => {
  f = await seed();
  leitung = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [leitung, f.security, await rolleId('leitung')]);
  objektId = await objekt(f.security);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                             stundensatz_intern)
     values ($1,$2,$3,'2024-03-01',1600) returning id`,
    [f.security, f.jonas, `S-${zufall()}`]);
  jonasSecurity = a!.id;
  schluesselId = await alsLeitung((k) => legeSchluesselAn(k, {
    objektId, bezeichnung: 'Generalschlüssel Haupthaus', schluesselNummer: 'GS-7',
    schliessanlage: 'Anlage A', sicherungskarteNummer: 'SK-4711',
  }));
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(3) die Uebergabe erzeugt eine Quittung — Unterschrift, beide Seiten, Serverzeit', () => {
  it('ein neuer Schluessel liegt im Depot, weil sein Journal leer ist', async () => {
    const s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('im_depot');
    expect(s!.besitzer).toBeNull();
    expect(s!.letzteBewegungLokal).toBeNull();
  });

  it('die Quittung traegt Unterschrift, Empfaenger, Uebergebenden und die Serverzeit',
    async () => {
      const behauptet = new Date(Date.now() + 90 * 60 * 1000).toISOString();
      await alsLeitung((k) => uebergib(k, {
        schluesselId,
        empfaengerArt: 'mitarbeiter',
        anstellungId: f.fatimaSecurity,
        empfaengerName: 'Fatima Yildiz',
        unterzeichnerName: 'Fatima Yildiz',
        geplanteRueckgabe: '2030-01-01',
        geraeteZeit: behauptet,
      }));

      const [q] = await sql.unsafe<{
        anstellung_id: string; person_id: string; empfaenger: string;
        unterzeichner: string; ausgeber: string; nah: boolean;
        abweichung: number; objekt_id: string; offen: string | null;
      }[]>(
        `select anstellung_id, person_id, empfaenger_name as empfaenger,
                unterzeichner_name as unterzeichner,
                ausgegeben_von_benutzer_id as ausgeber,
                (abs(extract(epoch from (now() - quittiert_am))) < 60) as nah,
                zeitabweichung_sek as abweichung, objekt_id, offen_schluessel_id as offen
           from schluessel_quittung where schluessel_id = $1`, [schluesselId]);

      // BEIDE Beteiligten: der Empfaenger als Beschaeftigung (D-09, review B8)
      // samt Mensch, und der Uebergebende als angemeldetes Konto.
      expect(q!.anstellung_id).toBe(f.fatimaSecurity);
      expect(q!.person_id).toBe(f.fatima);
      expect(q!.empfaenger).toBe('Fatima Yildiz');
      expect(q!.unterzeichner).toBe('Fatima Yildiz');
      expect(q!.ausgeber).toBe(leitung);
      // Die SERVERZEIT gewinnt; die Geraeteuhr steht als Abweichung daneben.
      expect(q!.nah).toBe(true);
      expect(Number(q!.abweichung)).toBeGreaterThan(90 * 60 - 120);
      // Die Objektkopie kommt vom Schluessel, nie vom Aufrufer.
      expect(q!.objekt_id).toBe(objektId);
      // Und die Ausgabe ist OFFEN — das ist die Spalte von Abnahme 4.
      expect(q!.offen).toBe(schluesselId);

      const s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
      expect(s!.status).toBe('ausgegeben');
      expect(s!.besitzer).toBe('Fatima Yildiz');
      expect(s!.geplanteRueckgabe).toBe('2030-01-01');
      expect(s!.ueberfaellig).toBe(false);
    });

  it('eine Uebergabe ohne Unterschrift ist keine Quittung', async () => {
    await expect(alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz',
    }))).rejects.toThrow(SchluesselEingabeFehlt);

    // Und am Dienst vorbei haelt `sq_unterzeichner`.
    await expect(sql.unsafe(
      `insert into schluessel_quittung
         (mandant_id, schluessel_id, objekt_id, art, empfaenger_art, anstellung_id,
          person_id, snapshot, snapshot_hash, erstellt_von_art)
       values ($1,$2,$3,'ausgabe','mitarbeiter',$4,$5,'{}'::jsonb, repeat('0',64),'system')`,
      [f.security, schluesselId, objektId, f.fatimaSecurity, f.fatima],
    )).rejects.toThrow(/sq_unterzeichner/u);
  });

  it('die Ruecknahme schliesst die Ausgabe — und BEIDE Zeilen bleiben stehen', async () => {
    const ausgabeId = await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));
    const rueckId = await alsLeitung((k) => nimmZurueck(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));

    const journal = await alsLeitung((k) => leseQuittungen(k, schluesselId));
    // Zwei Zeilen — nicht eine geaenderte.
    expect(journal).toHaveLength(2);
    const ausgabe = journal.find((q) => q.id === ausgabeId)!;
    const ruecknahme = journal.find((q) => q.id === rueckId)!;
    expect(ausgabe.art).toBe('ausgabe');
    expect(ruecknahme.art).toBe('ruecknahme');
    // Die Ausgabe ist geschlossen und zeigt auf die Zeile, die sie beendet hat.
    expect(ausgabe.offen).toBe(false);
    expect(ausgabe.geschlossenDurchId).toBe(rueckId);
    expect(ausgabe.geschlossenLokal).not.toBeNull();

    const s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('im_depot');
    expect(s!.besitzer).toBeNull();
  });

  it('eine Ruecknahme ohne offene Ausgabe wird abgewiesen', async () => {
    await expect(alsLeitung((k) => nimmZurueck(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }))).rejects.toThrow(/nicht ausgegeben/u);
  });

  it('der Abzug traegt die Serverzeit der Zeile und laesst sich nachrechnen', async () => {
    await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));

    const [q] = await sql.unsafe<{
      snapshot: Record<string, unknown>; snapshot_hash: string; gleich: boolean;
    }[]>(
      `select snapshot, snapshot_hash,
              (snapshot ->> 'quittiert_am_utc'
               = to_char(quittiert_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                as gleich
         from schluessel_quittung where schluessel_id = $1`, [schluesselId]);

    // Der Abzug nennt DIESELBE Sekunde wie die Spalte — `now()` ist die
    // Transaktionszeit, und der Dienst liest sie in derselben Transaktion.
    expect(q!.gleich).toBe(true);
    // Der Abzug ist ein OBJEKT, keine JSON-Zeichenkette.
    expect(typeof q!.snapshot).toBe('object');
    expect(q!.snapshot['schema']).toBe('cse.schluesselquittung.v1');
    // Und der Hash stimmt, mit demselben Kanonisierer nachgerechnet (D-233).
    const neu = createHash('sha256')
      .update(kanonisiere(q!.snapshot as KanonischerWert)).digest('hex');
    expect(neu).toBe(q!.snapshot_hash);

    const befund = await alsLeitung((k) => pruefeQuittungen(k, schluesselId));
    expect(befund.geprueft).toBe(1);
    expect(befund.intakt).toBe(true);
  });

  it('ein veraenderter Abzug faellt bei der Pruefung auf', async () => {
    const kunde = (await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id from objekt where id = $1`, [objektId]))[0]!.kunde_id;
    await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'kunde', kundeId: kunde,
      empfaengerName: 'Hausmeister Klein', unterzeichnerName: 'Hausmeister Klein',
    }));
    /**
     * `session_replication_role = replica` ist der EINE Weg an
     * `sq_unveraenderlich` vorbei — superuser-only, also fuer keine
     * Anwendungsrolle erreichbar. Genau deshalb taugt er hier: er stellt einen
     * Eingriff nach, den die Anwendung gar nicht machen kann, und die Pruefung
     * muss ihn trotzdem finden.
     */
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      await tx.unsafe(
        `update schluessel_quittung
            set snapshot = jsonb_set(snapshot, '{empfaenger,name}', '"Jemand anders"')
          where schluessel_id = $1`, [schluesselId]);
    });

    const befund = await alsLeitung((k) => pruefeQuittungen(k, schluesselId));
    expect(befund.intakt).toBe(false);
    expect(befund.brueche).toHaveLength(1);
  });

  it('die acht Ereignisse fuehren durch die fuenf Zustaende', async () => {
    const kunde = (await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id from objekt where id = $1`, [objektId]))[0]!.kunde_id;

    await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'kunde', kundeId: kunde,
      empfaengerName: 'Hausmeister Klein', unterzeichnerName: 'Hausmeister Klein',
    }));
    await alsLeitung((k) => buche(k, { schluesselId, art: 'verlustmeldung' }));
    let s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('verloren');
    // Der Besitzer BLEIBT: „wer hatte ihn zuletzt" ist die erste Frage im
    // Haftungsfall.
    expect(s!.besitzer).toBe('Hausmeister Klein');

    const sperrId = await alsLeitung((k) => buche(k, { schluesselId, art: 'sperrung' }));
    s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('gesperrt');

    // Die Entsperrung stellt den Zustand VOR der Sperre wieder her — nicht
    // „im Depot".
    await alsLeitung((k) => buche(k, {
      schluesselId, art: 'entsperrung', aufhebtQuittungId: sperrId,
    }));
    s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('verloren');

    // Die Inventur ist zustandsneutral und schiebt nur die Spur weiter.
    await alsLeitung((k) => buche(k, { schluesselId, art: 'inventur' }));
    s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('verloren');

    // Wiedergefunden schliesst die offene Ausgabe — sonst verboete
    // `sq_offene_ausgabe_uk` jede spaetere.
    await alsLeitung((k) => buche(k, { schluesselId, art: 'wiedergefunden' }));
    s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('im_depot');
    // Dass er einmal als verloren gemeldet war, bleibt Teil der Akte.
    const [verlust] = await sql.unsafe<{ gesetzt: boolean }[]>(
      `select (verlust_gemeldet_am is not null) as gesetzt
         from schluessel where id = $1`, [schluesselId]);
    expect(verlust!.gesetzt).toBe(true);

    await alsLeitung((k) => buche(k, { schluesselId, art: 'vernichtung' }));
    s = await alsLeitung((k) => findeSchluessel(k, schluesselId));
    expect(s!.status).toBe('vernichtet');
    // Danach traegt das Journal nur noch Inventurzeilen.
    await expect(alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'kunde', kundeId: kunde,
      empfaengerName: 'X', unterzeichnerName: 'X',
    }))).rejects.toThrow(/vernichtet/u);
    await expect(alsLeitung((k) => buche(k, { schluesselId, art: 'inventur' })))
      .resolves.toBeTypeOf('string');
  });

  it('eine Beschaeftigung einer anderen Gesellschaft wird benannt abgewiesen (D-09)',
    async () => {
      /**
       * `f.jonasReinigung` gibt es — nur nicht hier. Die Quittung haengt an der
       * BESCHAEFTIGUNG und nicht am Menschen (review B8); ein `person_id`, das
       * die Zeilenpolitik still auf NULL setzt, endete sonst an
       * `sq_person_bei_anstellung` und saehe aus wie ein Programmfehler.
       */
      await expect(alsLeitung((k) => uebergib(k, {
        schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.jonasReinigung,
        empfaengerName: 'Jonas Berger', unterzeichnerName: 'Jonas Berger',
      }))).rejects.toThrow(EmpfaengerNichtGefunden);
    });

  it('der Zustand laesst sich nicht setzen, nur buchen', async () => {
    // Auch als Eigentuemer: `pg_trigger_depth()` unterscheidet die Ableitung
    // von einem Eingriff, nicht die Rolle.
    await expect(sql.unsafe(
      `update schluessel set status = 'ausgegeben' where id = $1`, [schluesselId],
    )).rejects.toThrow(/nicht gesetzt, sondern gebucht/u);
    await expect(sql.unsafe(
      `update schluessel set aktueller_besitzer_text = 'Wer auch immer' where id = $1`,
      [schluesselId],
    )).rejects.toThrow(/nicht gesetzt, sondern gebucht/u);
  });

  it('eine Quittung wird nicht geaendert und nicht geloescht', async () => {
    await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));
    await expect(sql.unsafe(
      `update schluessel_quittung set empfaenger_name = 'Jemand anders'
        where schluessel_id = $1`, [schluesselId],
    )).rejects.toThrow(/wird nicht geaendert/u);
    await expect(sql.unsafe(
      `update schluessel_quittung set quittiert_am = now() - interval '2 days'
        where schluessel_id = $1`, [schluesselId],
    )).rejects.toThrow(/wird nicht geaendert/u);
    await expect(sql.unsafe(
      `delete from schluessel_quittung where schluessel_id = $1`, [schluesselId],
    )).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('(4) eine zweite Uebergabe ohne Ruecknahme wird abgewiesen — von der DATENBANK', () => {
  beforeEach(async () => {
    await alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));
  });

  it('durch den Dienst — mit einer Meldung, die den Grund nennt', async () => {
    await expect(alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: jonasSecurity,
      empfaengerName: 'Jonas Berger', unterzeichnerName: 'Jonas Berger',
    }))).rejects.toThrow(SchonAusgegeben);
  });

  it('am Dienst vorbei als `cse_app` — der Index weist ab, nicht der Dienst', async () => {
    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.security, benutzerId: leitung,
        portal: 'intern', readonly: false,
      },
      async (tx) => tx.unsafe(
        ROH_AUSGABE, [f.security, schluesselId, objektId, f.fatimaSecurity, f.fatima],
      ),
    )).rejects.toThrow(/sq_offene_ausgabe_uk/u);
  });

  it('und als EIGENTUEMER der Tabelle — FORCE RLS kennt keinen Umweg', async () => {
    /**
     * `sql` ist die Verbindung OHNE `set role cse_app`. Genau das ist der
     * Punkt von Abnahme 4: die Zusage gilt fuer einen Import, ein Skript und
     * einen kuenftigen Dienst, der den hier gebauten nicht aufruft.
     */
    await expect(sql.unsafe(
      ROH_AUSGABE, [f.security, schluesselId, objektId, f.fatimaSecurity, f.fatima],
    )).rejects.toThrow(/sq_offene_ausgabe_uk/u);
  });

  it('nach der Ruecknahme ist eine neue Uebergabe wieder moeglich', async () => {
    await alsLeitung((k) => nimmZurueck(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));
    await expect(alsLeitung((k) => uebergib(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: jonasSecurity,
      empfaengerName: 'Jonas Berger', unterzeichnerName: 'Jonas Berger',
    }))).resolves.toBeTypeOf('string');

    const journal = await alsLeitung((k) => leseQuittungen(k, schluesselId));
    // Drei Zeilen, und genau EINE ist offen.
    expect(journal).toHaveLength(3);
    expect(journal.filter((q) => q.offen)).toHaveLength(1);
  });

  it('ein zweiter Schluessel desselben Objekts ist davon unberuehrt', async () => {
    // Der partielle Index vergleicht die SCHLUESSELkennung, nicht das Objekt.
    const zweiter = await alsLeitung((k) => legeSchluesselAn(k, {
      objektId, bezeichnung: 'Nebenschlüssel', schluesselNummer: 'NS-2',
    }));
    await expect(alsLeitung((k) => uebergib(k, {
      schluesselId: zweiter, empfaengerArt: 'mitarbeiter',
      anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }))).resolves.toBeTypeOf('string');

    const bestand = await alsLeitung((k) => leseSchluessel(k, { objektId }));
    expect(bestand.filter((s) => s.status === 'ausgegeben')).toHaveLength(2);
  });

  it('zwei GLEICHZEITIGE Uebergaben: eine gewinnt, die andere scheitert', async () => {
    await alsLeitung((k) => nimmZurueck(k, {
      schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
      empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
    }));

    /**
     * Zwei offene Transaktionen, beide fuegen ein, dann beide committen. Der
     * partielle Eindeutigkeitsindex laesst die zweite blockieren und beim
     * Commit der ersten scheitern — ohne ihn haetten beide Erfolg, und der
     * Schluessel waere an zwei Orten.
     */
    const ergebnisse = await Promise.allSettled([
      alsLeitung((k) => uebergib(k, {
        schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: f.fatimaSecurity,
        empfaengerName: 'Fatima Yildiz', unterzeichnerName: 'Fatima Yildiz',
      })),
      alsLeitung((k) => uebergib(k, {
        schluesselId, empfaengerArt: 'mitarbeiter', anstellungId: jonasSecurity,
        empfaengerName: 'Jonas Berger', unterzeichnerName: 'Jonas Berger',
      })),
    ]);
    expect(ergebnisse.filter((e) => e.status === 'fulfilled')).toHaveLength(1);
    expect(ergebnisse.filter((e) => e.status === 'rejected')).toHaveLength(1);

    const journal = await alsLeitung((k) => leseQuittungen(k, schluesselId));
    expect(journal.filter((q) => q.offen)).toHaveLength(1);
  });
});
