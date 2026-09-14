/**
 * Der Vergaberadar gegen eine echte Datenbank (RAD-01 … RAD-09, 0145).
 *
 *  1. **Idempotenz ist kein Vorsatz, sondern ein Index.** Dieselbe Antwort
 *     zweimal eingespielt legt keine zweite Zeile an, ändert nichts und
 *     schreibt keine zweite Rohdatenzeile. Eine geänderte Antwort ändert die
 *     Zeile — und die alte Rohantwort bleibt daneben stehen.
 *  2. **Die Falle, an der der Radar stehen bliebe**: ein nachgeschärftes
 *     Profil erzeugt eine NEUE Bewertung, statt am Eindeutigkeitsindex zu
 *     scheitern. Ohne `eingaben_hash` im Schlüssel stürbe der Lauf beim ersten
 *     schon bewerteten Fall (Datenmodell §2.13).
 *  3. **Die Wände**: `cse_app` schreibt keine Bekanntmachung und keine
 *     Bewertung; ohne `radar.lesen` sieht eine Sitzung nichts; ein fremder
 *     Mandant sieht die Bewertung nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { liesOcds } from '../../src/server/services/radar/ocds.js';
import { leseEin, markiereVerschwundene } from '../../src/server/services/radar/import.js';
import { bewerteLauf } from '../../src/server/services/radar/lauf.js';
import { laufe } from '../../src/server/jobs/radar.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * Eine Administration DIESER Gesellschaft. „Irgendein Konto, dessen E-Mail mit
 * admin beginnt" reicht nicht: `radar.lesen` haengt an der Mitgliedschaft, und
 * eine Administration der Sicherheit sieht in der Reinigung nichts — richtig
 * so, aber als Testvoraussetzung falsch.
 */
async function legeAdministrationAn(mandantId: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [`admin-${zufall()}@cse.test`]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, 'Radar-Administration', 'aktiv')`, [u!.id, `admin-${zufall()}@cse.test`]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

const JETZT = new Date('2026-09-14T10:00:00Z');
const SEIT = new Date('2026-01-01T00:00:00Z');

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzerId ?? benutzer, portal: 'intern' as const, readonly: false,
  };
}

function ocdsText(teil: {
  ocid: string; titel: string; cpv?: string; nuts?: string; wert?: string; frist?: string;
  status?: string;
}): string {
  return JSON.stringify({
    releases: [{
      ocid: teil.ocid,
      date: '2026-09-01T08:00:00Z',
      language: 'de',
      tag: ['tender'],
      links: { self: `https://oeffentlichevergabe.de/b/${teil.ocid}` },
      parties: [{
        roles: ['buyer'], name: 'Bezirksamt Mitte von Berlin',
        address: { locality: 'Berlin', postalCode: '10178', region: teil.nuts ?? 'DE300' },
      }],
      tender: {
        title: teil.titel,
        description: 'Laufende Unterhaltsreinigung.',
        status: teil.status ?? 'active',
        procurementMethodDetails: 'Öffentliche Ausschreibung nach UVgO',
        value: { amount: teil.wert ?? '120000.00', currency: 'EUR' },
        classification: { scheme: 'CPV', id: teil.cpv ?? '90910000-9' },
        items: [{ deliveryAddresses: [{ region: teil.nuts ?? 'DE300' }] }],
        tenderPeriod: { endDate: teil.frist ?? '2026-10-15T12:00:00Z' },
      },
    }],
  });
}

async function einlesen(text: string): Promise<{ neu: number; geaendert: number; unveraendert: number }> {
  const zeilen = liesOcds(text).map((b) => ({ bekanntmachung: b, rohText: text }));
  const e = await alsRolle('cse_job', async (tx) => leseEin(
    { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> }, zeilen));
  return { neu: e.neu, geaendert: e.geaendert, unveraendert: e.unveraendert };
}

async function legeProfilAn(mandantId: string, teil: {
  name?: string; cpv?: string; nuts?: string[]; positiv?: string[];
} = {}): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into radar_profil (mandant_id, name, nuts_praefixe, positiv_keywords)
     values ($1, $2, $3::text[], $4::text[]) returning id`,
    [mandantId, teil.name ?? 'Unterhaltsreinigung Berlin', teil.nuts ?? ['DE3'],
      teil.positiv ?? ['Unterhaltsreinigung']]);
  await sql.unsafe(
    `insert into radar_profil_cpv (mandant_id, radar_profil_id, cpv_code) values ($1, $2, $3)`,
    [mandantId, p!.id, teil.cpv ?? '90910000']);
  return p!.id;
}

async function laufen(): Promise<{ neueZeilen: number; bewertungen: number }> {
  const e = await alsRolle('cse_job', async (tx) => bewerteLauf(
    { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> },
    { seit: SEIT, jetzt: JETZT }));
  return { neueZeilen: e.neueZeilen, bewertungen: e.bewertungen };
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  await sql.unsafe(`delete from bewertung`);
  await sql.unsafe(`delete from ausschreibung_rohdaten`);
  await sql.unsafe(`delete from ausschreibung_nuts`);
  await sql.unsafe(`delete from ausschreibung`);
  await sql.unsafe(`delete from radar_profil_cpv`);
  await sql.unsafe(`delete from radar_profil`);
  await sql.unsafe(`delete from radar_ingest_lauf`);
});

afterAll(schliessen);

describe('(1) Einlesen ist idempotent (RAD-03)', () => {
  it('dieselbe Antwort zweimal: eine Zeile, eine Rohdatenzeile, nichts geaendert', async () => {
    const text = ocdsText({ ocid: 'DE-2026-1', titel: 'Unterhaltsreinigung Rathaus' });

    const erst = await einlesen(text);
    expect(erst.neu).toBe(1);

    const zweit = await einlesen(text);
    expect(zweit.neu, 'kein zweiter Datensatz').toBe(0);
    expect(zweit.geaendert, 'byte-gleich heisst unveraendert').toBe(0);
    expect(zweit.unveraendert).toBe(1);

    const [zahl] = await sql.unsafe<{ n: number; roh: number }[]>(
      `select (select count(*) from ausschreibung)::int as n,
              (select count(*) from ausschreibung_rohdaten)::int as roh`);
    expect(zahl!.n).toBe(1);
    expect(zahl!.roh, 'eine identische Antwort schreibt keine zweite Rohdatenzeile').toBe(1);
  });

  it('eine geaenderte Frist aendert die Zeile — und die alte Rohantwort bleibt', async () => {
    await einlesen(ocdsText({ ocid: 'DE-2026-2', titel: 'Glasreinigung' }));
    const geaendert = await einlesen(
      ocdsText({ ocid: 'DE-2026-2', titel: 'Glasreinigung', frist: '2026-10-01T12:00:00Z' }));
    expect(geaendert.geaendert).toBe(1);

    const [a] = await sql.unsafe<{ frist: Date; roh: number }[]>(
      `select frist_angebot as frist,
              (select count(*) from ausschreibung_rohdaten r where r.ausschreibung_id = a.id)::int as roh
         from ausschreibung a where a.quell_id = 'DE-2026-2'`);
    expect(a!.frist.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(a!.roh, 'die Beweiskette waechst, sie wird nicht ersetzt').toBe(2);
  });

  it('was die Quelle nicht mehr liefert, hoert auf zu zaehlen', async () => {
    await einlesen(ocdsText({ ocid: 'DE-2026-3', titel: 'Objektschutz' }));
    /* Der Lauf von morgen hat diese Bekanntmachung nicht mehr gesehen. */
    const anzahl = await alsRolle('cse_job', async (tx) => markiereVerschwundene(
      { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> },
      'oeffentlichevergabe', new Date(Date.now() + 60_000)));
    expect(anzahl).toBe(1);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select quell_status as status from ausschreibung where quell_id = 'DE-2026-3'`);
    expect(z!.status).toBe('verschwunden');
  });

  it('eine aufgehobene Vergabe kommt als aufgehoben herein', async () => {
    await einlesen(ocdsText({ ocid: 'DE-2026-4', titel: 'Aufgehoben', status: 'cancelled' }));
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select quell_status as status from ausschreibung where quell_id = 'DE-2026-4'`);
    expect(z!.status).toBe('aufgehoben');
  });
});

describe('(2) Der Bewertungslauf (RAD-05)', () => {
  it('bewertet jede Bekanntmachung gegen jedes aktive Profil — und zweimal laufen schreibt nichts dazu', async () => {
    await legeProfilAn(f.reinigung);
    await einlesen(ocdsText({ ocid: 'DE-2026-10', titel: 'Unterhaltsreinigung Rathaus' }));

    const erst = await laufen();
    expect(erst.bewertungen).toBe(1);
    expect(erst.neueZeilen).toBe(1);

    const zweit = await laufen();
    expect(zweit.neueZeilen, 'unveraenderte Eingaben schreiben nichts').toBe(0);

    const [b] = await sql.unsafe<{
      punkte: number; begruendung: string; verfahren: string; typ: string; zeilen: number;
    }[]>(
      `select punkte, begruendung, verfahren, jsonb_typeof(aufschluesselung) as typ,
              jsonb_array_length(aufschluesselung) as zeilen from bewertung`);
    expect(b!.punkte).toBeGreaterThan(0);
    expect(b!.verfahren).toBe('deterministisch');
    expect(b!.begruendung, 'der Satz nennt das Profil').toContain('Unterhaltsreinigung Berlin');
    /*
     * **Ein Feld, keine Zeichenkette** (D-467). `JSON.stringify` an einem
     * `::jsonb`-Parameter kodiert postgres.js ein zweites Mal; gespeichert
     * steht dann „[{…}]" als TEXT, und jede Seite, die darüber läuft, fällt
     * mit „map is not a function". Der Fall ist einmal passiert.
     */
    expect(b!.typ, 'aufschluesselung ist ein JSON-Feld').toBe('array');
    expect(b!.zeilen, 'eine Zeile je Regel').toBeGreaterThanOrEqual(5);
  });

  /**
   * **Die Falle aus dem Datenmodell §2.13.** Ohne `eingaben_hash` im
   * Eindeutigkeitsschlüssel würde ein nachgeschärftes Profil am Index
   * scheitern, der Anhäng-Trigger verböte das Ausweichen auf `do update`, und
   * der Lauf stürbe bei der ersten schon bewerteten Bekanntmachung — also
   * genau dann, wenn jemand das Profil zum ersten Mal benutzt.
   */
  it('ein nachgeschaerftes Profil erzeugt eine NEUE Bewertung, statt den Lauf zu toeten', async () => {
    const profil = await legeProfilAn(f.reinigung);
    await einlesen(ocdsText({ ocid: 'DE-2026-11', titel: 'Unterhaltsreinigung Rathaus' }));
    await laufen();

    await sql.unsafe(
      `update radar_profil set positiv_keywords = array['Unterhaltsreinigung','Rathaus'] where id = $1`,
      [profil]);

    const nach = await laufen();
    expect(nach.neueZeilen, 'eine geaenderte Eingabe ist eine neue Zeile').toBe(1);

    const [zahl] = await sql.unsafe<{ n: number; versionen: number }[]>(
      `select count(*)::int as n, count(distinct profil_version)::int as versionen from bewertung`);
    expect(zahl!.n, 'die alte Bewertung bleibt als Aufzeichnung').toBe(2);
    expect(zahl!.versionen).toBe(2);
  });

  it('ein bestaetigtes Duplikat wird nicht zweimal bewertet (O-192)', async () => {
    await legeProfilAn(f.reinigung);
    await einlesen(ocdsText({ ocid: 'DE-2026-12', titel: 'Unterhaltsreinigung A' }));
    await einlesen(ocdsText({ ocid: 'DE-2026-13', titel: 'Unterhaltsreinigung B' }));
    const [a, b] = await sql.unsafe<{ id: string }[]>(
      `select id from ausschreibung order by quell_id`);
    /* Unbestaetigt: beide werden bewertet — eine Vermutung nimmt nichts aus der Liste. */
    await sql.unsafe(
      `update ausschreibung set ist_duplikat_von = $1, duplikat_konfidenz = 0.9 where id = $2`,
      [a!.id, b!.id]);
    expect((await laufen()).bewertungen).toBe(2);

    /* Bestaetigt ein Mensch das Duplikat, faellt es aus dem Lauf — ohne dass
       eine Bewertung geloescht wuerde: `bewertung` ist anhaengend. */
    await sql.unsafe(`update ausschreibung set duplikat_bestaetigt_von = $1 where id = $2`,
      [benutzer, b!.id]);
    expect((await laufen()).bewertungen, 'bestaetigt: nur noch das Original').toBe(1);
  });

  it('jede Gesellschaft bewertet mit ihrem eigenen Profil', async () => {
    await legeProfilAn(f.reinigung, { name: 'Reinigung Berlin' });
    await legeProfilAn(f.security, { name: 'Sicherheit Berlin', cpv: '79710000', positiv: ['Objektschutz'] });
    await einlesen(ocdsText({ ocid: 'DE-2026-14', titel: 'Unterhaltsreinigung Rathaus' }));

    await laufen();
    const zeilen = await sql.unsafe<{ mandant_id: string; punkte: number }[]>(
      `select mandant_id, punkte from bewertung order by punkte desc`);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]!.mandant_id, 'die Reinigung trifft, die Sicherheit nicht').toBe(f.reinigung);
    expect(zeilen[0]!.punkte).toBeGreaterThan(zeilen[1]!.punkte);
  });
});

describe('(3) Die Waende (K-03, K-04, RAD-05)', () => {
  it('cse_app schreibt keine Bekanntmachung und keine Bewertung', async () => {
    await expect(alsApp(sitzung(), async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into ausschreibung (quelle, quell_id, titel, rohdaten_hash)
       values ('ted', 'X', 'Von Hand', 'x')`)))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /permission|denied|policy/iu.test(e.message));

    const profil = await legeProfilAn(f.reinigung);
    const vonHand = alsApp(sitzung(), async (tx: postgres.TransactionSql) => tx.unsafe(
      `insert into bewertung (mandant_id, ausschreibung_id, radar_profil_id, regel_version,
                              profil_version, punkte, skala_max, begruendung, eingaben_hash)
       values ($1, gen_random_uuid(), $2, 'v', 1, 99, 100, 'von Hand', 'h')`,
      [f.reinigung, profil] as never[]));
    await expect(vonHand)
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /permission|denied|policy/iu.test(e.message));
  });

  it('eine Bewertung ist anhaengend: aendern und loeschen sind nicht vorgesehen', async () => {
    await legeProfilAn(f.reinigung);
    await einlesen(ocdsText({ ocid: 'DE-2026-20', titel: 'Unterhaltsreinigung Rathaus' }));
    await laufen();
    await expect(sql.unsafe(`update bewertung set punkte = 100`))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /anhaengend/u.test(e.message));
    await expect(sql.unsafe(`delete from bewertung`))
      .rejects.toSatisfy((e: unknown) => e instanceof Error && /anhaengend/u.test(e.message));
    /* Aufraeumen fuer den naechsten Fall: der Trigger gilt auch fuer den Eigentuemer. */
    await sql.unsafe(`alter table bewertung disable trigger trg_bewertung_anhaengend`);
    await sql.unsafe(`delete from bewertung`);
    await sql.unsafe(`alter table bewertung enable trigger trg_bewertung_anhaengend`);
  });

  it('eine fremde Gesellschaft sieht die Bewertung nicht', async () => {
    await legeProfilAn(f.reinigung);
    await einlesen(ocdsText({ ocid: 'DE-2026-21', titel: 'Unterhaltsreinigung Rathaus' }));
    await laufen();

    const eigen = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select count(*)::int as n from bewertung`)) as { n: number }[];
    expect(eigen[0]!.n).toBe(1);

    const fremd = await alsApp(sitzung(f.bau), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select count(*)::int as n from bewertung`)) as { n: number }[];
    expect(fremd[0]!.n, 'RLS trennt die Gesellschaften').toBe(0);
  });

  it('die Bekanntmachung selbst ist gemeinsame Referenz — aber nur mit radar.lesen', async () => {
    await einlesen(ocdsText({ ocid: 'DE-2026-22', titel: 'Unterhaltsreinigung Rathaus' }));

    const mitRecht = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select count(*)::int as n from ausschreibung`)) as { n: number }[];
    expect(mitRecht[0]!.n, 'eine oeffentliche Bekanntmachung gehoert keiner Gesellschaft').toBe(1);

    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select r.id, b.id, $1, false from rolle r, berechtigung b
        where r.schluessel = 'admin' and r.mandant_id is null and b.schluessel = 'radar.lesen'`,
      [f.reinigung]);
    const ohneRecht = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select count(*)::int as n from ausschreibung`)) as { n: number }[];
    expect(ohneRecht[0]!.n, 'ohne radar.lesen sieht die Sitzung nichts').toBe(0);
  });
});

/**
 * (4) **Der Nachtlauf — mit einer Quelle, die antwortet, und einer, die es
 * nicht gibt.**
 *
 * Der Abruf ist einspritzbar; hier greift kein Test ins Netz. Was geprüft
 * wird, ist das, was man sonst erst nach Wochen merkt: dass eine nicht
 * verbundene Quelle SICHTBAR übersprungen wird, statt als ruhiger Tag
 * durchzugehen.
 */
describe('(4) Der Nachtlauf (RAD-01, RAD-02)', () => {
  it('eine nicht verbundene Quelle wird sichtbar uebersprungen, die andere liest ein', async () => {
    await legeProfilAn(f.reinigung);
    const vorher = process.env['RADAR_OEFFENTLICHEVERGABE_URL'];
    process.env['RADAR_OEFFENTLICHEVERGABE_URL'] = 'https://beispiel.test/ocds';
    delete process.env['RADAR_TED_URL'];

    const befund = await laufe(
      sql as unknown as Parameters<typeof laufe>[0],
      async () => ocdsText({ ocid: 'DE-2026-30', titel: 'Unterhaltsreinigung Rathaus' }),
      JETZT);

    if (vorher === undefined) delete process.env['RADAR_OEFFENTLICHEVERGABE_URL'];
    else process.env['RADAR_OEFFENTLICHEVERGABE_URL'] = vorher;

    expect(befund.neu).toBe(1);
    expect(befund.uebersprungen, 'TED ist nicht verbunden — und das steht im Protokoll').toBe(1);
    expect(befund.neueBewertungen).toBe(1);

    const laeufe = await sql.unsafe<{ quelle: string; status: string; fehler_text: string | null }[]>(
      `select quelle, status, fehler_text from radar_ingest_lauf order by quelle`);
    expect(laeufe).toHaveLength(2);
    const ted = laeufe.find((l) => l.quelle === 'ted');
    expect(ted?.status).toBe('uebersprungen');
    expect(ted?.fehler_text, 'der Lauf sagt, was fehlt').toContain('RADAR_TED_URL');
    expect(laeufe.find((l) => l.quelle === 'oeffentlichevergabe')?.status).toBe('erfolg');
  });

  it('eine Quelle, die ausfaellt, nimmt die andere nicht mit', async () => {
    const vorher = process.env['RADAR_OEFFENTLICHEVERGABE_URL'];
    process.env['RADAR_OEFFENTLICHEVERGABE_URL'] = 'https://beispiel.test/ocds';

    const befund = await laufe(
      sql as unknown as Parameters<typeof laufe>[0],
      async () => { throw new Error('HTTP 503'); },
      JETZT);

    if (vorher === undefined) delete process.env['RADAR_OEFFENTLICHEVERGABE_URL'];
    else process.env['RADAR_OEFFENTLICHEVERGABE_URL'] = vorher;

    expect(befund.letzterFehler).toContain('503');
    const [lauf] = await sql.unsafe<{ status: string; fehler_text: string }[]>(
      `select status, fehler_text from radar_ingest_lauf where quelle = 'oeffentlichevergabe'`);
    expect(lauf!.status, 'ein Ausfall ist ein Fehler, kein leerer Tag').toBe('fehler');
    expect(lauf!.fehler_text).toContain('503');
  });
});
