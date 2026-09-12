/**
 * PR 31 — die fuenf Abnahmekriterien, an echtem Postgres.
 *
 * Sie stehen hier und nicht in `tests/kern/`, weil vier von fuenf Aussagen
 * ueber die DATENBANK sind und in TypeScript nicht falsifizierbar waeren:
 *
 *  1. Die §34a-Sperre greift IM DIENST — der Test ruft ihn direkt auf, an
 *     jeder Oberflaeche vorbei (SEC-04).
 *  2. Die Gueltigkeit wird zum SCHICHTDATUM bewertet, nicht zu `now()`.
 *  3. Derselbe Nachweis ist aus BEIDEN Anstellungen identisch sichtbar, und
 *     eine Kopie je Anstellung ist STRUKTURELL unmoeglich (D-09).
 *  4. Eine Planerin in der Reinigung sieht die Nachweislage ohne ein einziges
 *     Entgeltfeld der Security (K-05).
 *  5. Die Hinweise 60/30/7 feuern je genau einmal.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  QualifikationFehlt, assertZuordnungZulaessig, pruefeZuordnung,
} from '../../src/server/services/nachweis/tor.js';
import {
  BEWACHERLAGE_FELDER, NACHWEISLAGE_FELDER, NACHWEIS_ZEILE_FELDER, nachweislage,
} from '../../src/server/services/nachweis/uebersicht.js';
import { meldeAblaufwarnungen } from '../../src/server/services/nachweis/ablauf.js';
import { leereArten } from '../../src/server/benachrichtigung/registry.js';
import { registriereNachweisArten } from '../../src/server/services/nachweis/benachrichtigung.js';

let f: Fixtur;
let planerReinigung: string;
let planerSecurity: string;

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `nachweis-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);
}

/** Eine plattformweite Qualifikation — §34a gehoert dem Menschen, nicht der
 *  Gesellschaft, und muss in beiden benennbar sein (§6.16). */
async function qualifikation(opts: {
  schluessel?: string; blockiert?: boolean; warnstufen?: number[];
} = {}): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                rechtsgrundlage, laeuft_ab, blockiert_einsatz, warnung_tage)
     values (null, $1, 'Sachkundeprüfung §34a', 'gesetzlich', '§34a GewO', true, $2, $3)
     returning id`,
    [opts.schluessel ?? `34a_${zufall()}`, opts.blockiert ?? true,
     `{${(opts.warnstufen ?? [60, 30, 7]).join(',')}}`]);
  return q!.id;
}

async function nachweis(opts: {
  person: string; qualifikation: string; mandant: string;
  ab?: string; bis?: string | null; status?: string;
}): Promise<string> {
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1,$2,$3,$4,$5::nachweis_status,$6) returning id`,
    [opts.person, opts.qualifikation, opts.ab ?? '2020-01-01',
     opts.bis ?? null, opts.status ?? 'gueltig', opts.mandant]);
  return n!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung,
                         strasse, plz, ort)
     values ($1,$2,$3,'Buerohaus','Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`]);
  return o!.id;
}

/** Eine Schicht mit BERLINER Wanduhr 22:00–06:00 am genannten Tag. */
async function einsatz(mandant: string, objektId: string, tag: string): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          erstellt_von_art)
     values ($1,$2,'manuell',$3::date,
             ($3::date + time '22:00') at time zone 'Europe/Berlin',
             ($3::date + interval '1 day' + time '06:00') at time zone 'Europe/Berlin',
             '22:00','06:00', true, 'system')
     returning id`,
    [mandant, objektId, tag]);
  return e!.id;
}

async function anforderung(opts: {
  mandant: string; objekt: string; qualifikation: string;
  register?: boolean; zwingend?: boolean;
}): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatzanforderung (mandant_id, geltungsbereich, objekt_id,
                                     qualifikation_id, zwingend, geltung,
                                     bewacherregister_pflicht, rechtsgrundlage)
     values ($1,'objekt',$2,$3,$4,'jeder',$5,'§34a Abs. 1a GewO') returning id`,
    [opts.mandant, opts.objekt, opts.qualifikation,
     opts.zwingend ?? true, opts.register ?? false]);
  return a!.id;
}

function kontextAus(tx: Parameters<Parameters<typeof alsApp>[1]>[0]) {
  return {
    unsafe: async (s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly unknown[],
  };
}

const alsPlaner = <T>(
  benutzer: string, mandant: string,
  fn: (db: ReturnType<typeof kontextAus>) => Promise<T>,
): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

beforeEach(async () => {
  f = await seed();
  planerReinigung = await konto();
  planerSecurity = await konto();
  await mitglied(planerReinigung, f.reinigung, 'leitung');
  await mitglied(planerSecurity, f.security, 'leitung');
});

afterAll(async () => {
  await schliessen();
});

// ---------------------------------------------------------------------------

describe('(1) die Sperre greift IM DIENST, nicht in der Oberflaeche (SEC-04)', () => {
  it('ein vor dem Schichtdatum ablaufender Nachweis laesst die Zuweisung scheitern', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    // Gueltig bis zum 1. Maerz — die Schicht beginnt am 10.
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-03-01' });
    const e = await einsatz(f.security, o, '2026-03-10');

    const fehler = await alsPlaner(planerSecurity, f.security, async (db) =>
      assertZuordnungZulaessig(db, f.fatimaSecurity, e).then(() => null, (x: unknown) => x));

    expect(fehler).toBeInstanceOf(QualifikationFehlt);
    const q1 = (fehler as QualifikationFehlt).befund;
    expect(q1.erfuellt).toBe(false);
    expect(q1.stichtag).toBe('2026-03-10');
    expect(q1.fehlend.map((x) => x.qualifikationId)).toContain(q);
    // Der Text nennt die Rechtsgrundlage — die Planerin muss wissen, WAS fehlt.
    expect((fehler as QualifikationFehlt).message).toContain('§34a');
  });

  it('und die Datenbank weist dieselbe Zuweisung auch OHNE den Dienst ab', async () => {
    // Die zweite Schicht: ein Import, ein Skript oder eine Konsolensitzung, die
    // den Dienst nicht kennt, kommt an derselben Regel nicht vorbei.
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-03-01' });
    const e = await einsatz(f.security, o, '2026-03-10');

    await expect(sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1,$2,$3,$4,'system')`,
      [f.security, e, f.fatimaSecurity, f.fatima],
    )).rejects.toThrow(/SEC-04\/LEG-04/u);
  });

  it('mit gueltigem Nachweis geht dieselbe Zuweisung durch — und traegt den Beweis', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-12-31' });
    const e = await einsatz(f.security, o, '2026-03-10');

    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1,$2,$3,$4,'system')`,
      [f.security, e, f.fatimaSecurity, f.fatima]);

    // §9.3/§9.4: die Zeile traegt den Beweis, dass die Pruefung STATTGEFUNDEN
    // hat — auch dann, wenn kein Dienst beteiligt war.
    const [z] = await sql.unsafe<{ geprueft: Date | null; schnapp: Record<string, unknown> }[]>(
      `select qualifikation_geprueft_am geprueft, qualifikation_snapshot schnapp
         from einsatz_zuordnung where einsatz_id = $1`, [e]);
    expect(z!.geprueft).not.toBeNull();
    expect(z!.schnapp['erfuellt']).toBe(true);
    expect(z!.schnapp['stichtag']).toBe('2026-03-10');
    // §9.5: „nichts gefunden" bleibt von „geprueft und bestanden" unterscheidbar.
    expect(z!.schnapp['anforderungen_gefunden']).toBe(1);
  });

  it('SEC-03: gueltiger Nachweis UND fehlende Registereintragung sperrt trotzdem', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q, register: true });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-12-31' });
    const e = await einsatz(f.security, o, '2026-03-10');

    const fehler = await alsPlaner(planerSecurity, f.security, async (db) =>
      assertZuordnungZulaessig(db, f.fatimaSecurity, e).then(() => null, (x: unknown) => x));
    expect(fehler).toBeInstanceOf(QualifikationFehlt);
    expect((fehler as QualifikationFehlt).befund.fehlend.map((x) => x.bewacherregister))
      .toContain('fehlt');

    // Mit lebender Eintragung geht dieselbe Zuweisung durch.
    await sql.unsafe(
      `insert into bewacher_eintrag (person_id, bewacher_id, status, gueltig_bis)
       values ($1,$2,'registriert','2027-01-01')`, [f.fatima, `BW-${zufall()}`]);
    const zweiter = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, e));
    expect(zweiter.erfuellt).toBe(true);
  });

  it('ein gesperrter Registerstatus zaehlt NICHT als registriert (O-40)', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q, register: true });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-12-31' });
    await sql.unsafe(
      `insert into bewacher_eintrag (person_id, bewacher_id, status)
       values ($1,$2,'gesperrt')`, [f.fatima, `BW-${zufall()}`]);
    const e = await einsatz(f.security, o, '2026-03-10');

    const befund = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, e));
    expect(befund.erfuellt).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('(2) bewertet wird zum SCHICHTDATUM, nicht zu now()', () => {
  it('ein heute abgelaufener Nachweis deckt die VERGANGENE Schicht weiterhin', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    // Der Nachweis lief am 3. Maerz 2020 ab — heute ist er laengst hinueber.
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2019-01-01', bis: '2020-03-03' });
    const vergangen = await einsatz(f.security, o, '2020-03-03');

    const befund = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, vergangen));
    expect(befund.stichtag).toBe('2020-03-03');
    expect(befund.erfuellt).toBe(true);
  });

  it('derselbe Nachweis deckt einen Tag spaeter nicht mehr — die Grenze ist scharf', async () => {
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2019-01-01', bis: '2020-03-03' });
    const danach = await einsatz(f.security, o, '2020-03-04');

    const befund = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, danach));
    expect(befund.erfuellt).toBe(false);
  });

  it('der Stichtag ist der BERLINER Tag der Schicht, nicht der UTC-Tag (K-11)', async () => {
    // Die Schicht beginnt am 3. Juli um 22:00 Ortszeit = 20:00Z. Beide Tage
    // stimmen hier ueberein; die Probe ist der Nachweis, der GENAU am 3. endet
    // und die Schicht damit noch deckt.
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2019-01-01', bis: '2026-07-03' });
    const e = await einsatz(f.security, o, '2026-07-03');

    const befund = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, e));
    expect(befund.stichtag).toBe('2026-07-03');
    expect(befund.erfuellt).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('(3) EIN Nachweis, zwei Anstellungen — eine Kopie ist unmoeglich (D-09)', () => {
  it('es gibt keine Spalte, an die eine Kopie je Anstellung haengen koennte', async () => {
    const q = await qualifikation();
    // Der Beweis ist ein fehlschlagendes INSERT: die Datenbank kennt die
    // Spalte nicht, also gibt es die zweite Wahrheit nicht als Zustand,
    // sondern nur als Tippfehler.
    await expect(sql.unsafe(
      `insert into nachweis (person_id, anstellung_id, qualifikation_id, gueltig_ab,
                             erfasst_von_mandant_id)
       values ($1,$2,$3,'2026-01-01',$4)`,
      [f.fatima, f.fatimaSecurity, q, f.security],
    )).rejects.toThrow(/column "anstellung_id" of relation "nachweis" does not exist/u);
  });

  it('und `nachweis` traegt auch kein mandant_id — der Nachweis gehoert dem Menschen', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'nachweis'`);
    const namen = spalten.map((s) => s.column_name);
    expect(namen).not.toContain('anstellung_id');
    expect(namen).not.toContain('mandant_id');
    // `erfasst_von_mandant_id` ist die Verantwortlichkeit, nicht die
    // Sichtbarkeit — sie darf nicht `mandant_id` heissen (§6.17).
    expect(namen).toContain('erfasst_von_mandant_id');
  });

  it('beide Gesellschaften sehen DIESELBE Zeile, mit derselben Gueltigkeit', async () => {
    const q = await qualifikation();
    // Erfasst hat ihn die SECURITY.
    const n = await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                               ab: '2026-01-01', bis: '2026-12-31' });

    const gelesen = async (benutzer: string, mandant: string) =>
      alsPlaner(benutzer, mandant, async (db) =>
        (await db.unsafe(
          `select id, gueltig_bis::text from nachweis where person_id = $1`, [f.fatima],
        )) as readonly { id: string; gueltig_bis: string }[]);

    const ausSecurity = await gelesen(planerSecurity, f.security);
    const ausReinigung = await gelesen(planerReinigung, f.reinigung);

    expect(ausSecurity).toHaveLength(1);
    // Der Punkt: die REINIGUNG sieht den von der Security erfassten Nachweis.
    // Sonst plant sie gegen nichts — und `erfasst_von_mandant_id` waere
    // stillschweigend zu einer Sichtbarkeitsspalte geworden.
    expect(ausReinigung).toEqual(ausSecurity);
    expect(ausReinigung[0]!.id).toBe(n);
  });

  it('ein Mensch OHNE Anstellung im Bereich bleibt dennoch unsichtbar', async () => {
    // Die Gegenprobe: die Sichtbarkeit kommt aus D-09 §6, nicht daher, dass
    // `nachweis` kein mandant_id traegt. Jonas arbeitet nur in der Reinigung.
    const q = await qualifikation();
    await nachweis({ person: f.jonas, qualifikation: q, mandant: f.reinigung,
                     ab: '2026-01-01', bis: '2026-12-31' });
    const ausSecurity = await alsPlaner(planerSecurity, f.security, async (db) =>
      db.unsafe(`select id from nachweis where person_id = $1`, [f.jonas]));
    expect(ausSecurity).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('(4) die Nachweislage traegt KEIN Entgeltfeld (K-05, D-09 §6)', () => {
  it('die Gestalt des Ergebnisses, Feld fuer Feld', async () => {
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-12-31' });
    await sql.unsafe(
      `insert into bewacher_eintrag (person_id, bewacher_id, status, gueltig_bis)
       values ($1,$2,'registriert','2027-01-01')`, [f.fatima, `BW-${zufall()}`]);

    const lage = await alsPlaner(planerReinigung, f.reinigung, async (db) =>
      nachweislage(db, f.fatima, '2026-06-01'));

    // Nicht „enthaelt kein `stundensatz`" — die VOLLSTAENDIGE Feldliste. Eine
    // Stichprobe faende ein durchgereichtes `anstellung`-Objekt nicht.
    expect(Object.keys(lage).sort()).toEqual([...NACHWEISLAGE_FELDER].sort());
    expect(lage.nachweise).toHaveLength(1);
    expect(Object.keys(lage.nachweise[0]!).sort())
      .toEqual([...NACHWEIS_ZEILE_FELDER].sort());
    expect(Object.keys(lage.bewacher).sort()).toEqual([...BEWACHERLAGE_FELDER].sort());

    // Und der Inhalt, damit die Liste nicht bloss leer richtig ist.
    expect(lage.nachweise[0]!.gueltigAmStichtag).toBe(true);
    expect(lage.bewacher.gueltigAmStichtag).toBe(true);
    // „No fake integrations": die Lage sagt selbst, dass niemand verbunden ist.
    expect(lage.bewacher.quelle).toBe('manuell');
    expect(lage.bewacher.verbindung).toBe('nicht_verbunden');

    const alsText = JSON.stringify(lage);
    for (const wort of ['stundensatz', 'tarif', 'entgelt', 'lohn', 'personalnummer']) {
      expect(alsText.toLowerCase(), wort).not.toContain(wort);
    }
  });

  it('und die zweite Linie steht auch: der Satz ist fuer cse_app nicht gegrantet', async () => {
    // K-05 — Spaltenprivilegien statt maskierender Sicht. Selbst eine
    // Planerin, die es versucht, kommt an die Spalte nicht heran; die Abfrage
    // scheitert an der BERECHTIGUNG, nicht an einer leeren Zeile.
    await expect(alsPlaner(planerSecurity, f.security, async (db) =>
      db.unsafe(`select stundensatz_intern from anstellung where id = $1`, [f.fatimaSecurity]),
    )).rejects.toThrow(/permission denied/u);
  });

  it('die Reinigung sieht die Gueltigkeit auch fuer eine Schicht der Security', async () => {
    // Der eigentliche D-09-§6-Punkt: Nachweisgueltigkeit ja, Lohndaten nein.
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-02-01' });
    const lage = await alsPlaner(planerReinigung, f.reinigung, async (db) =>
      nachweislage(db, f.fatima, '2026-06-01'));
    expect(lage.nachweise).toHaveLength(1);
    expect(lage.nachweise[0]!.gueltigAmStichtag).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('(5) die Hinweise 60/30/7 feuern je genau einmal', () => {
  beforeEach(() => {
    leereArten();
    registriereNachweisArten();
  });

  it('drei Laeufe an drei Schwellentagen — drei Meldungen, jede einmal', async () => {
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2025-01-01', bis: '2026-03-03' });

    const lauf = (heute: string) => alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, heute));

    // 61 Tage vorher: nichts.
    expect((await lauf('2026-01-01')).gemeldet).toHaveLength(0);
    // 60: die erste Stufe.
    expect((await lauf('2026-01-02')).gemeldet.map((m) => m.stufeTage)).toEqual([60]);
    // 59, 58, 57: nichts mehr — DAS ist die Zusage.
    for (const tag of ['2026-01-03', '2026-01-04', '2026-01-05']) {
      expect((await lauf(tag)).gemeldet, tag).toHaveLength(0);
    }
    expect((await lauf('2026-02-01')).gemeldet.map((m) => m.stufeTage)).toEqual([30]);
    expect((await lauf('2026-02-20')).gemeldet).toHaveLength(0);
    expect((await lauf('2026-02-24')).gemeldet.map((m) => m.stufeTage)).toEqual([7]);
    expect((await lauf('2026-03-01')).gemeldet).toHaveLength(0);

    const quittungen = await sql.unsafe<{ stufe_tage: number }[]>(
      `select stufe_tage from nachweis_warnung order by stufe_tage desc`);
    expect(quittungen.map((z) => z.stufe_tage)).toEqual([60, 30, 7]);
  });

  it('zwei Laeufe am selben Tag melden einmal — der Schluessel entscheidet, nicht die Reihenfolge', async () => {
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2025-01-01', bis: '2026-03-03' });
    const ersteRunde = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-01-02'));
    const zweiteRunde = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-01-02'));
    expect(ersteRunde.gemeldet).toHaveLength(1);
    expect(zweiteRunde.gemeldet).toHaveLength(0);
  });

  it('ein verpasster Lauf verschluckt die Stufe nicht, meldet sie aber nur einmal nach', async () => {
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2025-01-01', bis: '2026-03-03' });
    // Der Waechter lief zwei Monate nicht. Beim naechsten Lauf sind 60 und 30
    // faellig — beide gehen hinaus, keine geht verloren.
    const nachlauf = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-02-01'));
    expect(nachlauf.gemeldet.map((m) => m.stufeTage)).toEqual([60, 30]);
    const wieder = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-02-02'));
    expect(wieder.gemeldet).toHaveLength(0);
  });

  it('eine VERLAENGERUNG darf erneut warnen — die Stufe gilt je Ablaufdatum', async () => {
    const q = await qualifikation();
    const n = await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                               ab: '2025-01-01', bis: '2026-03-03' });
    await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-01-02'));
    // Verlaengert bis 2027. Ohne `gueltig_bis` im Schluessel bliebe die
    // 60-Tage-Warnung zum NEUEN Datum fuer immer aus.
    await sql.unsafe(`update nachweis set gueltig_bis = '2027-03-03' where id = $1`, [n]);
    const neu = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2027-01-02'));
    expect(neu.gemeldet.map((m) => m.stufeTage)).toEqual([60]);
  });

  it('die Meldung fuehrt auf die eigene Nachweisseite und ist nicht sammelbar', async () => {
    const q = await qualifikation();
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2025-01-01', bis: '2026-03-03' });
    const bericht = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-01-02'));
    const eine = bericht.gemeldet[0]!.benachrichtigung;
    expect(eine.ziel).toBe('/portal/mein/nachweise');
    expect(eine.sammelbar).toBe(false);
    expect(bericht.unzustellbar).toHaveLength(0);
  });

  it('eine Stufe ohne registrierte Art wird GEMELDET, nicht verschluckt', async () => {
    const q = await qualifikation({ warnstufen: [90] });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2025-01-01', bis: '2026-03-03' });
    const bericht = await alsPlaner(planerSecurity, f.security, async (db) =>
      meldeAblaufwarnungen(db, '2026-01-02'));
    expect(bericht.gemeldet).toHaveLength(0);
    expect(bericht.unzustellbar.map((u) => u.stufeTage)).toEqual([90]);
  });
});

// ---------------------------------------------------------------------------

describe('das Tor faellt nicht nach oben offen', () => {
  it('ohne Anforderung ist die Zuweisung erlaubt — und als ungeprueft vermerkt (§9.5)', async () => {
    const o = await objekt(f.security);
    const e = await einsatz(f.security, o, '2026-03-10');
    const befund = await alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, e));
    expect(befund.erfuellt).toBe(true);
    // Der Unterschied zwischen „geprueft und bestanden" und „nichts gefunden"
    // bleibt in der Zeile stehen, sonst waere die leere Grundanforderung
    // (O-149) von einer bestandenen Pruefung nicht unterscheidbar.
    expect(befund.anforderungenGefunden).toBe(0);
  });

  it('eine Planerin OHNE personal.nachweis_lesen bekommt trotzdem eine richtige Antwort', async () => {
    /**
     * Der Ausfall, gegen den `SECURITY DEFINER` steht: als Aufrufer gelesen
     * saehe eine Sitzung ohne Personalrecht null `nachweis`-Zeilen, das
     * `not exists` traefe zu und JEDE Zuweisung waere gesperrt — geschlossen,
     * also sicher, und flaechig blockierend, also unbrauchbar.
     */
    const q = await qualifikation();
    const o = await objekt(f.security);
    await anforderung({ mandant: f.security, objekt: o, qualifikation: q });
    await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security,
                     ab: '2026-01-01', bis: '2026-12-31' });
    const e = await einsatz(f.security, o, '2026-03-10');

    const ohneRecht = await konto();
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
       values ($1,$2,$3, array['dienstplan','security'])`,
      [ohneRecht, f.security, await rolleId('leitung')]);

    const befund = await alsPlaner(ohneRecht, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, e));
    expect(befund.erfuellt).toBe(true);
    expect(befund.anforderungenGefunden).toBe(1);
  });

  it('eine nicht lesbare Schicht ist nicht „erfuellt", sondern ein Fehler', async () => {
    // Dreiwertige Logik darf keine Compliancefrage entscheiden (§9.1).
    await expect(alsPlaner(planerSecurity, f.security, async (db) =>
      pruefeZuordnung(db, f.fatimaSecurity, '00000000-0000-0000-0000-000000000000')))
      .rejects.toThrow(/nicht pruefbar/u);
  });
});

describe('die Anforderung haengt an der Arbeit, und der Katalog bleibt sauber', () => {
  it('eine mandantenfremde Qualifikation laesst sich nicht anfordern', async () => {
    const [q] = await sql.unsafe<{ id: string }[]>(
      `insert into qualifikation (mandant_id, schluessel, bezeichnung)
       values ($1,$2,'Nur Reinigung') returning id`, [f.reinigung, `int_${zufall()}`]);
    const o = await objekt(f.security);
    await expect(anforderung({ mandant: f.security, objekt: o, qualifikation: q!.id }))
      .rejects.toThrow(/gehoert Mandant/u);
  });

  it('eine plattformweite dagegen schon — §34a gilt in beiden Gesellschaften', async () => {
    const q = await qualifikation();
    const o = await objekt(f.reinigung);
    await expect(anforderung({ mandant: f.reinigung, objekt: o, qualifikation: q }))
      .resolves.toBeTruthy();
  });

  it('eine zwingende Anforderung mit `mindestens_einer` ist noch nicht eintragbar', async () => {
    // Zwischenstand aus §6.6: sie waere zur Schreibzeit von niemandem geprueft,
    // und SEC-04s Hartsperre gaelte stillschweigend nicht.
    const q = await qualifikation();
    const o = await objekt(f.security);
    await expect(sql.unsafe(
      `insert into einsatzanforderung (mandant_id, geltungsbereich, objekt_id,
                                       qualifikation_id, zwingend, geltung, mindestanzahl)
       values ($1,'objekt',$2,$3,true,'mindestens_einer',2)`,
      [f.security, o, q],
    )).rejects.toThrow(/ea_geltung_zwischenstand/u);
  });

  it('kein Hard Delete auf einem Nachweis — auch nicht als Eigentuemer', async () => {
    const q = await qualifikation();
    const n = await nachweis({ person: f.fatima, qualifikation: q, mandant: f.security });
    await expect(sql.unsafe(`delete from nachweis where id = $1`, [n]))
      .rejects.toThrow();
  });
});
