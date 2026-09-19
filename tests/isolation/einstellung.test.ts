/**
 * Einstellen gegen echtes Postgres — erst der Mensch, dann die Beschaeftigung
 * (D-09, EMP-14, LEG-09, Invariante 3, Invariante 9, 0365/0367/0368).
 *
 * **Vier Befunde, die diese Datei einfriert.**
 *
 *  1. `t_person_schreiben` und `t_anstellung_schreiben` (0004) prueften KEIN
 *     Recht. Jede interne Sitzung mit einem aktiven Bereich konnte einen
 *     Menschen und eine Beschaeftigung anlegen. Folgenlos, solange es keine
 *     Schreibflaeche gab — mit `/personal/anstellungen/neu` ist sie da.
 *  2. Die Dublette bei einer SCHWESTERGESELLSCHAFT ist von hier aus
 *     unsichtbar (`t_person_lesen`): die Einstellungsmaske findet nichts und
 *     legt eine zweite `person`-Zeile an. Genau dagegen ist
 *     `app.person_zusammenfuehren` (0194) gebaut — und die ArbZG-Belastung
 *     aggregiert dann zweimal die Haelfte (Invariante 9).
 *  3. Die Probe darf das NICHT mit einem Namen beantworten: getrennte
 *     Verantwortliche, und wo ein Mensch sonst arbeitet, ist sein Datum
 *     (O-860). Sie gibt zwei Zahlen zurueck und protokolliert sich selbst.
 *  4. `geplant` hatte keinen Ausgang: 0191 zieht nur `beendet` nach. Eine
 *     Beschaeftigung, die zum Ersten beginnt, blieb geplant, bis jemand sie
 *     von Hand umsetzte (0368).
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  DubletteImHaus, dublettenProbe, stelleEin,
} from '../../src/server/services/personal/einstellung.js';

let f: Fixtur;
let personal = '';      // personal.schreiben in reinigung
let nurLesen = '';      // nur personal.lesen in reinigung
let bauPersonal = '';   // personal.schreiben in bau
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

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, rolle]);
}

function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

/** Ein Kontext auf DERSELBEN Transaktion — der Dienst wird geprueft, keine Kopie. */
function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

beforeEach(async () => {
  f = await seed();
  personal = await konto('personal');
  nurLesen = await konto('lesen');
  bauPersonal = await konto('bau_personal');
  await mitglied(personal, f.reinigung,
    await rolleMit(f.reinigung, 'personal', ['personal.lesen', 'personal.schreiben']));
  await mitglied(nurLesen, f.reinigung,
    await rolleMit(f.reinigung, 'lesen', ['personal.lesen']));
  await mitglied(bauPersonal, f.bau,
    await rolleMit(f.bau, 'bau_personal', ['personal.lesen', 'personal.schreiben']));
});
afterAll(schliessen);

describe('(1) die Anlage verlangt ein RECHT — in der Datenbank, nicht nur in der Route', () => {
  it('mit `personal.schreiben` entstehen Mensch und Beschaeftigung', async () => {
    const ergebnis = await als(personal, (tx) =>
      stelleEin(kontextAus(tx, personal, f.reinigung), {
        mensch: {
          art: 'neu', vorname: 'Aylin', nachname: `Demir-${zufall()}`,
          telefon: null, sprache: 'tr',
        },
        personalnummer: `R-${zufall()}`,
        eintritt: '2024-01-15',
      }));
    expect(ergebnis.personNeu).toBe(true);
    expect(ergebnis.status).toBe('aktiv');

    const [zeile] = await sql.unsafe<{ person_id: string; status: string }[]>(
      `select person_id, status from anstellung where id = $1`, [ergebnis.anstellungId]);
    expect(zeile?.person_id).toBe(ergebnis.personId);
  });

  it('OHNE das Recht weist die Policy den `person`-Insert ab (0367)', async () => {
    /*
     * Bis 0367 ging genau das durch: `t_person_schreiben` verlangte einen
     * aktiven Mandanten und nichts weiter. Die Route war die einzige Wache —
     * und eine Wache, die nur in der Anwendung steht, ist bei der naechsten
     * Route weg (Invariante 3).
     */
    await expect(als(nurLesen, (tx) =>
      tx`insert into person (vorname, nachname) values ('Ohne', 'Recht')`,
    )).rejects.toThrow(/row-level security/iu);
  });

  it('und ebenso den `anstellung`-Insert (0367)', async () => {
    await expect(als(nurLesen, (tx) =>
      tx`insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
         values (${f.reinigung}, ${f.jonas}, ${`X-${zufall()}`}, '2025-01-01')`,
    )).rejects.toThrow(/row-level security/iu);
  });

  it('eine Beschaeftigung in einer FREMDEN Gesellschaft geht nicht (Invariante 3)', async () => {
    await expect(als(personal, (tx) =>
      tx`insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
         values (${f.security}, ${f.jonas}, ${`S-${zufall()}`}, '2025-01-01')`,
    )).rejects.toThrow(/row-level security/iu);
  });
});

describe('(2) die Dublette im eigenen Haus wird abgewiesen, nicht angelegt', () => {
  it('derselbe Name in derselben Gesellschaft: Abbruch mit Satz', async () => {
    // Jonas Berger ist in der Reinigung beschaeftigt (Fixtur).
    await expect(als(personal, (tx) =>
      stelleEin(kontextAus(tx, personal, f.reinigung), {
        mensch: {
          art: 'neu', vorname: 'Jonas', nachname: 'Berger', telefon: null, sprache: 'de',
        },
        personalnummer: `R-${zufall()}`,
        eintritt: '2025-01-01',
      }),
    )).rejects.toThrow(DubletteImHaus);
  });

  it('auch in anderer Schreibweise — `app.namensform` vergleicht getrimmt und klein', async () => {
    await expect(als(personal, (tx) =>
      stelleEin(kontextAus(tx, personal, f.reinigung), {
        mensch: {
          art: 'neu', vorname: ' jonas ', nachname: 'BERGER', telefon: null, sprache: 'de',
        },
        personalnummer: `R-${zufall()}`,
        eintritt: '2025-01-01',
      }),
    )).rejects.toThrow(DubletteImHaus);
  });

  it('eine ZWEITE Beschaeftigung desselben Menschen ist dagegen erlaubt (O-137)', async () => {
    const ergebnis = await als(personal, (tx) =>
      stelleEin(kontextAus(tx, personal, f.reinigung), {
        mensch: { art: 'bestehend', personId: f.jonas },
        personalnummer: `R-zweit-${zufall()}`,
        eintritt: '2025-06-01',
      }));
    expect(ergebnis.personNeu).toBe(false);
    expect(ergebnis.personId).toBe(f.jonas);
  });
});

describe('(3) die Probe ueber die Gesellschaftsgrenze gibt ZAHLEN, keine Namen (O-860)', () => {
  it('aus dem Bau gesehen ist Fatima `fremd` und nicht `hier`', async () => {
    /*
     * Fatima Yildiz ist in Reinigung UND Security beschaeftigt, nicht im Bau.
     * `t_person_lesen` zeigt sie einer Bausitzung nicht — genau deshalb gibt
     * es die Probe: ohne sie legte der Bau eine zweite Personenzeile an.
     */
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bauPersonal, portal: 'intern', readonly: false },
      (tx) => dublettenProbe(kontextAus(tx, bauPersonal, f.bau), 'Fatima', 'Yildiz'));
    expect(befund.hier).toBe(0);
    expect(befund.fremd).toBeGreaterThanOrEqual(1);
  });

  it('aus der Reinigung gesehen ist sie `hier`', async () => {
    const befund = await als(personal, (tx) =>
      dublettenProbe(kontextAus(tx, personal, f.reinigung), 'Fatima', 'Yildiz'));
    expect(befund.hier).toBeGreaterThanOrEqual(1);
  });

  it('ein leerer Nachname traefe jede Zeile — sie antwortet mit Nullen', async () => {
    const befund = await als(personal, (tx) =>
      dublettenProbe(kontextAus(tx, personal, f.reinigung), 'Fatima', '  '));
    expect(befund).toEqual({ hier: 0, fremd: 0 });
  });

  it('jede Probe hinterlaesst eine Auditzeile — eine Auskunft ist eine Offenlegung', async () => {
    const vorher = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from audit_log where aktion = 'personal.dublettenprobe'`);
    await als(personal, (tx) =>
      dublettenProbe(kontextAus(tx, personal, f.reinigung), 'Fatima', 'Yildiz'));
    const nachher = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from audit_log where aktion = 'personal.dublettenprobe'`);
    expect(Number(nachher[0]!.n)).toBe(Number(vorher[0]!.n) + 1);
  });

  it('ohne `personal.schreiben` antwortet sie gar nicht', async () => {
    await expect(als(nurLesen, (tx) =>
      dublettenProbe(kontextAus(tx, nurLesen, f.reinigung), 'Fatima', 'Yildiz'),
    )).rejects.toThrow(/nicht berechtigt|permission/iu);
  });
});

describe('(4) `geplant` hat einen Ausgang (0368)', () => {
  it('ein Eintritt in der Zukunft entsteht als `geplant`', async () => {
    const [tag] = await sql.unsafe<{ morgen: string }[]>(
      `select to_char(app.berlin_heute() + 30, 'YYYY-MM-DD') as morgen`);
    const ergebnis = await als(personal, (tx) =>
      stelleEin(kontextAus(tx, personal, f.reinigung), {
        mensch: { art: 'bestehend', personId: f.jonas },
        personalnummer: `R-plan-${zufall()}`,
        eintritt: tag!.morgen,
      }));
    expect(ergebnis.status).toBe('geplant');
  });

  it('und der Nachlauf setzt ihn `aktiv`, sobald der erste Arbeitstag da ist', async () => {
    const [tag] = await sql.unsafe<{ heute: string }[]>(
      `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
    /* Als Eigentuemer angelegt, damit der Test den NACHLAUF prueft und nicht
       noch einmal die Anlage. */
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,$3,$4::date,'geplant') returning id`,
      [f.reinigung, f.jonas, `R-nach-${zufall()}`, tag!.heute]);

    await alsRolle('cse_job', (tx) =>
      tx.unsafe(`select app.anstellung_status_nachziehen()`));

    const [nach] = await sql.unsafe<{ status: string }[]>(
      `select status from anstellung where id = $1`, [a!.id]);
    expect(nach?.status).toBe('aktiv');
  });

  it('eine geplante Zeile mit Eintritt in der Zukunft bleibt geplant', async () => {
    const [tag] = await sql.unsafe<{ spaeter: string }[]>(
      `select to_char(app.berlin_heute() + 10, 'YYYY-MM-DD') as spaeter`);
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,$3,$4::date,'geplant') returning id`,
      [f.reinigung, f.jonas, `R-spaet-${zufall()}`, tag!.spaeter]);

    await alsRolle('cse_job', (tx) =>
      tx.unsafe(`select app.anstellung_status_nachziehen()`));

    const [nach] = await sql.unsafe<{ status: string }[]>(
      `select status from anstellung where id = $1`, [a!.id]);
    expect(nach?.status).toBe('geplant');
  });
});
