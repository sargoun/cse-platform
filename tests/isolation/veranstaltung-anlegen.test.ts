import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  aendereVeranstaltung, archiviereVeranstaltung, legeVeranstaltungAn, VeranstaltungFehler,
} from '../../src/server/services/security/veranstaltung-anlegen.js';

/**
 * Eine Veranstaltung anlegen, ändern und archivieren (V-004, SEC-08).
 *
 * **Warum diese Datei entsteht.** `einsatz_quelle` kennt sechs Ursprünge; die
 * `veranstaltung` entstand ausschliesslich im Seed — der dritte war tot.
 *
 * Vier Dinge fallen leise aus, und die prüft diese Datei:
 *
 *  1. **Der Ort.** `veranstaltung_ort_genannt` verlangt ein Objekt ODER einen
 *     Text. Ein Straßenfest ist kein Objekt im Bestand und braucht trotzdem
 *     eine Wache, die weiss, wohin sie fährt.
 *  2. **Die BERLINER Wanduhrzeit** (Invariante 2). Der Mensch tippt, was auf
 *     seiner Wand steht; gespeichert wird der Instant. Eine Veranstaltung um
 *     20:00 am 31.12. ist in Berlin 19:00 UTC — im Winter.
 *  3. **Die Zeitumstellung.** Dieselbe Wanduhrzeit im Juli ist 18:00 UTC,
 *     nicht 19:00. Wer das in JavaScript rechnet, hat zwei Fassungen
 *     derselben Regel; hier rechnet Postgres, und diese Prüfung hält es fest.
 *  4. **Das Archivieren** darf keiner Wache den Dienst unter den Füßen
 *     wegziehen, die morgen Abend dort steht.
 */

let f: Fixtur;
let benutzer: string;
let kunde: string;
let objekt: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('wachleitung@cse.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'wachleitung@cse.test', 'Wachleitung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.security, f.reinigung]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               $3)`,
      [benutzer, m, m === f.security]);
  }

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, status)
     values ($1, 'K-TEST-SEC', 'Veranstalter Testallee e. V.', 'aktiv') returning id`,
    [f.security]);
  kunde = k!.id;
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, objektnummer, bezeichnung, kunde_id,
                         strasse, plz, ort, land)
     values ($1, 'OBJ-TEST-SEC', 'Werkhalle 3', $2, 'Testallee', '10115', 'Berlin', 'de')
     returning id`, [f.security, kunde]);
  objekt = o!.id;
});
afterAll(schliessen);

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    aktiverMandantId: mandantId,
    benutzerId: benutzer,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

function sitzung(mandantId = f.security) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

const GRUND = {
  bezeichnung: 'Sommerfest Werkhalle 3',
  beginn: '2027-07-10T18:00',
  ende: '2027-07-11T02:00',
} as const;

async function anlegen(felder: Record<string, unknown> = {}) {
  return alsApp(sitzung(), (tx) => legeVeranstaltungAn(kontextAus(tx, f.security), {
    ...GRUND, kundeId: kunde, objektId: objekt, ...felder,
  } as never));
}

describe('§1 der Ort ist ein Objekt ODER ein Text — nie keines', () => {
  it('nimmt ein Objekt dieser Gesellschaft an', async () => {
    const a = await anlegen();
    const [z] = await sql.unsafe<{ objekt_id: string | null; ort: string | null }[]>(
      `select objekt_id, veranstaltungsort_text as ort from veranstaltung where id = $1`,
      [a.id]);
    expect(z!.objekt_id).toBe(objekt);
    expect(z!.ort).toBeNull();
  });

  it('nimmt eine Anschrift als TEXT an — ein Straßenfest ist kein Objekt', async () => {
    const a = await anlegen({
      objektId: undefined, ortText: 'Festplatz Rummelsburger Bucht, Zugang Ost',
      bezeichnung: 'Straßenfest',
    });
    const [z] = await sql.unsafe<{ objekt_id: string | null; ort: string | null }[]>(
      `select objekt_id, veranstaltungsort_text as ort from veranstaltung where id = $1`,
      [a.id]);
    expect(z!.objekt_id).toBeNull();
    expect(z!.ort).toBe('Festplatz Rummelsburger Bucht, Zugang Ost');
  });

  it('WEIST eine Veranstaltung ohne beides ab — mit einem Satz', async () => {
    await expect(anlegen({ objektId: undefined, ortText: undefined }))
      .rejects.toThrow(/wohin sie fährt/u);
  });

  it('WEIST eine Veranstaltung ohne Bezeichnung ab', async () => {
    await expect(anlegen({ bezeichnung: '  ' })).rejects.toThrow(VeranstaltungFehler);
  });
});

describe('§2 Beginn und Ende sind BERLINER Wanduhrzeit (Invariante 2)', () => {
  it('speichert 18:00 Berliner Sommerzeit als 16:00 UTC', async () => {
    const a = await anlegen({ bezeichnung: 'Sommer' });
    const [z] = await sql.unsafe<{ utc: string }[]>(
      `select to_char(beginn at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
         from veranstaltung where id = $1`, [a.id]);
    expect(z!.utc).toBe('2027-07-10 16:00');
  });

  it('speichert dieselbe Wanduhrzeit im WINTER als 17:00 UTC', async () => {
    /*
     * Der eigentliche Grund, warum Postgres rechnet und nicht JavaScript:
     * dieselbe Zeichenkette ergibt je nach Jahreszeit einen anderen Instant.
     * Eine Fassung, die einen festen Versatz annaehme, laege die halbe Zeit
     * eine Stunde daneben — und eine Wache eine Stunde zu frueh oder zu spaet
     * vor der Tuer.
     */
    const a = await anlegen({
      bezeichnung: 'Winter', beginn: '2027-01-10T18:00', ende: '2027-01-11T02:00',
    });
    const [z] = await sql.unsafe<{ utc: string }[]>(
      `select to_char(beginn at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
         from veranstaltung where id = $1`, [a.id]);
    expect(z!.utc).toBe('2027-01-10 17:00');
  });

  it('nimmt eine Veranstaltung über MITTERNACHT an', async () => {
    const a = await anlegen({ bezeichnung: 'Über Mitternacht' });
    const [z] = await sql.unsafe<{ stunden: string }[]>(
      `select extract(epoch from (ende - beginn)) / 3600 as stunden
         from veranstaltung where id = $1`, [a.id]);
    expect(Number(z!.stunden)).toBe(8);
  });

  it('WEIST ein Ende vor dem Beginn ab', async () => {
    await expect(anlegen({ beginn: '2027-07-10T18:00', ende: '2027-07-10T17:00' }))
      .rejects.toThrow(/vor dem Beginn/u);
  });

  it('WEIST eine verstümmelte Zeitangabe ab — nicht als Datenbankfehler', async () => {
    await expect(anlegen({ beginn: '10.07.2027 18 Uhr' }))
      .rejects.toThrow(/Datums- und Uhrzeitangabe/u);
  });
});

describe('§3 Besetzung und Besucherzahl', () => {
  it('setzt ohne Angabe eine Sollbesetzung von 1', async () => {
    const a = await anlegen({ bezeichnung: 'Einer reicht' });
    const [z] = await sql.unsafe<{ soll_besetzung: number }[]>(
      `select soll_besetzung from veranstaltung where id = $1`, [a.id]);
    expect(z!.soll_besetzung).toBe(1);
  });

  it('WEIST eine Sollbesetzung von null ab (veranstaltung_soll_besetzung)', async () => {
    await expect(anlegen({ sollBesetzung: '0' })).rejects.toThrow(VeranstaltungFehler);
  });

  it('WEIST eine negative Besucherzahl ab', async () => {
    await expect(anlegen({ erwarteteBesucher: '-1' })).rejects.toThrow(VeranstaltungFehler);
  });
});

describe('§4 die Gesellschaftsgrenze (Invariante 3)', () => {
  it('eine Veranstaltung der Security ist aus der Reinigung nicht änderbar', async () => {
    const a = await anlegen({ bezeichnung: 'Nur für die Security' });
    await expect(alsApp(sitzung(f.reinigung), (tx) =>
      aendereVeranstaltung(kontextAus(tx, f.reinigung), {
        ...GRUND, id: a.id, kundeId: kunde, ortText: 'Anderswo',
        bezeichnung: 'Übernommen',
      }))).rejects.toThrow(VeranstaltungFehler);
    const [z] = await sql.unsafe<{ bezeichnung: string }[]>(
      `select bezeichnung from veranstaltung where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nur für die Security');
  });

  it('die Zeile trägt den AKTIVEN Mandanten', async () => {
    const a = await anlegen({ bezeichnung: 'Mandantentreu' });
    const [z] = await sql.unsafe<{ mandant_id: string }[]>(
      `select mandant_id from veranstaltung where id = $1`, [a.id]);
    expect(z!.mandant_id).toBe(f.security);
  });
});

describe('§5 ändern und archivieren', () => {
  it('ändert Bezeichnung, Ort und Fenster', async () => {
    const a = await anlegen({ bezeichnung: 'Vorher' });
    await alsApp(sitzung(), (tx) => aendereVeranstaltung(kontextAus(tx, f.security), {
      id: a.id, kundeId: kunde, bezeichnung: 'Nachher',
      ortText: 'Neuer Platz', beginn: '2027-08-01T10:00', ende: '2027-08-01T22:00',
      sollBesetzung: '4',
    }));
    const [z] = await sql.unsafe<
      { bezeichnung: string; ort: string | null; objekt_id: string | null;
        soll_besetzung: number }[]>(
        `select bezeichnung, veranstaltungsort_text as ort, objekt_id, soll_besetzung
           from veranstaltung where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nachher');
    expect(z!.ort).toBe('Neuer Platz');
    expect(z!.objekt_id).toBeNull();
    expect(z!.soll_besetzung).toBe(4);
  });

  it('archiviert und LÖSCHT nichts (Invariante 8)', async () => {
    const a = await anlegen({ bezeichnung: 'Wird archiviert' });
    await alsApp(sitzung(), (tx) =>
      archiviereVeranstaltung(kontextAus(tx, f.security), a.id));
    const [z] = await sql.unsafe<{ archiviert_am: string | null; anzahl: string }[]>(
      `select archiviert_am, count(*) over ()::text as anzahl
         from veranstaltung where id = $1`, [a.id]);
    expect(z!.archiviert_am).not.toBeNull();
    expect(z!.anzahl).toBe('1');
  });

  it('WEIST das Archivieren ab, solange eine Schicht in der Zukunft steht', async () => {
    const a = await anlegen({ bezeichnung: 'Morgen besetzt' });
    /*
     * Die Schicht entsteht hier roh — der Weg ueber `eventbesetzung` hat sein
     * eigenes Pruefstueck, und was hier zaehlt, ist allein die Sperre.
     */
    await sql.unsafe(
      `insert into einsatz (mandant_id, objekt_id, veranstaltung_id, quelle, status,
                            plan_datum, beginn_lokal, ende_lokal,
                            beginn_zeitpunkt, ende_zeitpunkt,
                            soll_besetzung, erstellt_von_art)
       values ($1, $2, $3, 'veranstaltung', 'geplant',
               (now() + interval '2 days')::date,
               '18:00', '23:59',
               ((now() + interval '2 days')::date + time '18:00')
                 at time zone 'Europe/Berlin',
               ((now() + interval '2 days')::date + time '23:59')
                 at time zone 'Europe/Berlin',
               1, 'system')`,
      [f.security, objekt, a.id]);
    await expect(alsApp(sitzung(), (tx) =>
      archiviereVeranstaltung(kontextAus(tx, f.security), a.id)))
      .rejects.toThrow(/Zukunft/u);
  });

  it('WEIST ein zweites Archivieren ab', async () => {
    const a = await anlegen({ bezeichnung: 'Nur einmal' });
    await alsApp(sitzung(), (tx) =>
      archiviereVeranstaltung(kontextAus(tx, f.security), a.id));
    await expect(alsApp(sitzung(), (tx) =>
      archiviereVeranstaltung(kontextAus(tx, f.security), a.id)))
      .rejects.toThrow(VeranstaltungFehler);
  });
});
