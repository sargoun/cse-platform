/**
 * Die Beschaeftigung gegen echtes Postgres: Einbahn-Status, K-14 und die
 * datierte Kondition (D-09, K-14, K-05, 01-KERN §6.14/§6.15, 0191/0192).
 *
 * **Drei Befunde, die diese Datei einfriert.**
 *
 *  1. `anstellung.status` liess sich von `beendet` zurueckdrehen — lautlos,
 *     weil `status` `text` mit CHECK ist und CHECKs Zustaende pruefen, nicht
 *     Uebergaenge. Eine Zeile, die zweimal „lief", hat keine belegbare
 *     Laufzeit mehr; jede Sollstunden- und Lohnrechnung darauf ist Auslegung.
 *  2. **K-14 war nur zur HAELFTE da.** `kern.bm_aus_anstellung_schutz` sass
 *     auf `benutzer_mandant` und verbot, eine abgeleitete Mitgliedschaft von
 *     Hand zu entziehen — die erzeugende und entziehende Seite gab es NICHT.
 *     Der Mensch behielt seinen Portalzugang zu einer Gesellschaft, die ihn
 *     nicht mehr beschaeftigt, und niemand konnte es beheben.
 *  3. Es gab keine `anstellung_kondition`. Ein einzelner mutabler
 *     Stundensatz bewertet mit jeder Erhoehung jede vergangene Kalkulation
 *     neu — deshalb ist er jetzt ein Spiegel mit genau einem Schreiber.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { beendigungsfolgen, setzeKondition, VertragEingabeFehler }
  from '../../src/server/services/personal/anstellung.js';
import { cent } from '../../src/server/services/finanz/geld.js';

let f: Fixtur;
let personal = '';   // personal.schreiben + anstellung_beenden + entgelt_*
let planung = '';    // nur personal.lesen
const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(praefix: string, personId: string | null = null): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, person_id, status)
     values ($1,$2,$2,$3,'aktiv')`, [u!.id, email, personId]);
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

async function systemrolle(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

function als<T>(
  benutzerId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  mandantId = f.reinigung,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

/**
 * Ein Kontext auf DERSELBEN Transaktion wie `alsApp`.
 *
 * Die Dienste nehmen `LeseKontext`/`SchreibKontext`, die Harness gibt eine
 * `postgres.TransactionSql`. Ohne diese Bruecke muesste der Test die Abfrage
 * des Dienstes abschreiben — und pruefte dann eine Kopie statt der Abfrage.
 */
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
  planung = await konto('planung');
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [personal, f.reinigung, await rolleMit(f.reinigung, 'personal', [
      'personal.lesen', 'personal.schreiben', 'personal.anstellung_beenden',
      'personal.entgelt_lesen', 'personal.entgelt_schreiben',
      /* `beendigungsfolgen` fragt vier FREMDE Rechte — ohne sie liefert sie
         `null` („nicht pruefbar") statt einer Zahl, und der Test pruefte
         dann die Rechteabfrage statt der Tagesgrenze. */
      'dienstplan.lesen', 'zeit.konto_lesen', 'zeit.abwesenheit_lesen',
    ])]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [planung, f.reinigung, await rolleMit(f.reinigung, 'planung', ['personal.lesen'])]);
});
afterAll(schliessen);

describe('(1) `beendet` ist eine Einbahnstrasse (§6.14)', () => {
  it('der Weg hinein steht offen', async () => {
    const zeilen = await als(personal, (tx) =>
      tx`update anstellung set status = 'beendet', austritt = '2025-06-30',
                               austritt_grund = 'Eigenkündigung'
          where id = ${f.jonasReinigung} returning status`);
    expect(zeilen[0]?.['status']).toBe('beendet');
  });

  it('der Weg hinaus nicht — auch nicht als Eigentuemer', async () => {
    await sql.unsafe(
      `update anstellung set status = 'beendet', austritt = '2025-06-30' where id = $1`,
      [f.jonasReinigung]);
    await expect(
      sql.unsafe(`update anstellung set status = 'aktiv' where id = $1`, [f.jonasReinigung]),
    ).rejects.toThrow(/nicht wieder eröffnet/u);
  });

  it('aber der Grund laesst sich an einer beendeten Zeile nachtragen', async () => {
    /*
     * Die Gegenprobe zum Trigger: ein CHECK haette ZUSTAENDE verboten und
     * damit auch diese Korrektur mitgetroffen. Nur der unzulaessige UEBERGANG
     * wirft.
     */
    await sql.unsafe(
      `update anstellung set status = 'beendet', austritt = '2025-06-30' where id = $1`,
      [f.jonasReinigung]);
    const zeilen = await als(personal, (tx) =>
      tx`update anstellung set austritt_grund = 'Aufhebungsvertrag'
          where id = ${f.jonasReinigung} returning austritt_grund`);
    expect(zeilen[0]?.['austritt_grund']).toBe('Aufhebungsvertrag');
  });
});

describe('(2) der Spiegel hat GENAU EINEN Schreiber (§6.14, 0191)', () => {
  it('`cse_app` kann Wochenstunden und Stundensatz nicht schreiben', async () => {
    for (const spalte of [
      'arbeitszeitmodell', 'wochenstunden', 'arbeitstage_woche',
      'stundensatz_intern', 'tarifgruppe', 'kostenstelle',
    ]) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'anstellung', $1, 'UPDATE') as ok`, [spalte]);
      expect(z?.ok, `cse_app darf anstellung.${spalte} schreiben`).toBe(false);
    }
    await expect(
      als(personal, (tx) =>
        tx`update anstellung set wochenstunden = 10 where id = ${f.jonasReinigung}`),
    ).rejects.toThrow(/permission denied/iu);
  });

  it('Personalnummer und Eintritt aber sehr wohl — sonst waere die Seite tot', async () => {
    const zeilen = await als(personal, (tx) =>
      tx`update anstellung set personalnummer = 'R-9999', eintritt = '2024-02-01'
          where id = ${f.jonasReinigung} returning personalnummer`);
    expect(zeilen[0]?.['personalnummer']).toBe('R-9999');
  });

  it('eine doppelte Personalnummer bleibt am Constraint haengen', async () => {
    await expect(
      als(personal, (tx) =>
        tx`update anstellung set personalnummer = 'R-1001' where id = ${f.jonasReinigung}`),
    ).rejects.toThrow(/anstellung_personalnummer_uk|duplicate key/iu);
  });
});

describe('(3) anstellung_kondition — datiert, ueberschneidungsfrei, gespiegelt', () => {
  it('`personal.entgelt_schreiben` ist Pflicht — `personal.schreiben` genuegt nicht', async () => {
    await expect(
      als(planung, (tx) =>
        tx`insert into anstellung_kondition
             (mandant_id, anstellung_id, gilt_ab, wochenstunden)
           values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', 39)`),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('der Satz ist auch auf DIESER Tabelle als Spalte entzogen (K-05)', async () => {
    for (const spalte of ['stundensatz_intern_cent', 'tarifgruppe']) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'anstellung_kondition', $1, 'SELECT') as ok`,
        [spalte]);
      expect(z?.ok, `cse_app darf anstellung_kondition.${spalte} lesen`).toBe(false);
    }
    /* Aber schreibbar: eine Kondition wird als GANZES eingetragen (§11). */
    const [schreiben] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_column_privilege('cse_app', 'anstellung_kondition',
                                   'stundensatz_intern_cent', 'INSERT') as ok`);
    expect(schreiben?.ok).toBe(true);
  });

  it('zwei gleichzeitig gueltige Konditionen sind unmoeglich', async () => {
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition
           (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent)
         values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', 1400)`);
    await expect(
      als(personal, (tx) =>
        tx`insert into anstellung_kondition
             (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent)
           values (${f.reinigung}, ${f.jonasReinigung}, '2025-01-01', 1500)`),
    ).rejects.toThrow(/ak_kein_ueberlapp|exclusion/iu);
  });

  it('nach dem Schliessen der Periode geht die naechste — und der Satz ist DATIERT', async () => {
    await als(personal, async (tx) => {
      await tx`insert into anstellung_kondition
                 (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent)
               values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', 1400)`;
      await tx`update anstellung_kondition set gilt_bis = '2024-12-31'
                where anstellung_id = ${f.jonasReinigung} and gilt_bis is null`;
      await tx`insert into anstellung_kondition
                 (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent)
               values (${f.reinigung}, ${f.jonasReinigung}, '2025-01-01', 1500)`;
    });

    const alt = await als(personal, (tx) =>
      tx`select app.entgelt_lesen(${f.jonasReinigung}, '2024-06-01') as satz`);
    const neu = await als(personal, (tx) =>
      tx`select app.entgelt_lesen(${f.jonasReinigung}, '2025-06-01') as satz`);
    expect(String(alt[0]?.['satz']), 'die Vergangenheit bleibt, wie sie war').toBe('1400');
    expect(String(neu[0]?.['satz'])).toBe('1500');
  });

  it('vor der ERSTEN Kondition gibt es keinen Satz — der Spiegel faellt nicht ein', async () => {
    /*
     * Der Rueckfall auf `anstellung.stundensatz_intern` gilt nur fuer
     * Beschaeftigungen OHNE jede Kondition (Bestand vor 0192). Faellt er auch
     * fuer einen Stichtag VOR der ersten Kondition zurueck, liefert er den
     * heutigen Wert fuer einen vergangenen Tag — genau die stillschweigende
     * Neubewertung, gegen die die datierte Tabelle eingefuehrt wurde.
     */
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition
           (mandant_id, anstellung_id, gilt_ab, stundensatz_intern_cent)
         values (${f.reinigung}, ${f.jonasReinigung}, '2024-06-01', 1500)`);
    const davor = await als(personal, (tx) =>
      tx`select app.entgelt_lesen(${f.jonasReinigung}, '2024-01-01') as satz`);
    expect(davor[0]?.['satz']).toBeNull();
  });

  it('der Spiegel-Ausloeser schreibt die HEUTE gueltige Kondition auf `anstellung`', async () => {
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition
           (mandant_id, anstellung_id, gilt_ab, arbeitszeitmodell, wochenstunden,
            arbeitstage_woche, stundensatz_intern_cent, tarifgruppe, kostenstelle)
         values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', 'vollzeit', 39, 5,
                 1650, 'RTV 2', 'K-100')`);
    const [spiegel] = await sql.unsafe<{
      modell: string; stunden: string; tage: string; satz: string;
      tarif: string; kostenstelle: string;
    }[]>(
      `select arbeitszeitmodell as modell, wochenstunden::text as stunden,
              arbeitstage_woche::text as tage, stundensatz_intern::text as satz,
              tarifgruppe as tarif, kostenstelle
         from anstellung where id = $1`, [f.jonasReinigung]);
    expect(spiegel?.modell).toBe('vollzeit');
    expect(Number(spiegel?.stunden)).toBe(39);
    expect(Number(spiegel?.tage)).toBe(5);
    expect(spiegel?.satz).toBe('1650');
    expect(spiegel?.tarif).toBe('RTV 2');
    expect(spiegel?.kostenstelle).toBe('K-100');
  });

  it('eine ZUKUENFTIGE Kondition aendert den Spiegel nicht', async () => {
    const [heute] = await sql.unsafe<{ tag: string }[]>(
      `select to_char(app.berlin_heute() + 400, 'YYYY-MM-DD') as tag`);
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition
           (mandant_id, anstellung_id, gilt_ab, wochenstunden)
         values (${f.reinigung}, ${f.jonasReinigung}, ${heute!.tag}, 12)`);
    const [spiegel] = await sql.unsafe<{ stunden: string | null }[]>(
      `select wochenstunden::text as stunden from anstellung where id = $1`,
      [f.jonasReinigung]);
    expect(spiegel?.stunden, 'eine Erhoehung ab naechstem Jahr gilt nicht heute').toBeNull();
  });

  it('eine Kondition wird nicht geloescht (Invariante 8)', async () => {
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition (mandant_id, anstellung_id, gilt_ab)
         values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01')`);
    await expect(
      als(personal, (tx) => tx`delete from anstellung_kondition`),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      sql.unsafe(`delete from anstellung_kondition`),
    ).rejects.toThrow();
  });
});

describe('(4) K-14 — abgeleitete Mitgliedschaften sind ADDITIV', () => {
  it('eine neue Beschaeftigung erzeugt die abgeleitete Mitgliedschaft', async () => {
    const jonasKonto = await konto('jonas', f.jonas);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7001','2025-01-01','aktiv')`, [f.security, f.jonas]);
    const zeilen = await sql.unsafe<{ slug: string; abgeleitet: boolean; rolle: string }[]>(
      `select m.slug, bm.aus_anstellung as abgeleitet, r.schluessel as rolle
         from benutzer_mandant bm
         join mandant m on m.id = bm.mandant_id
         join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.entzogen_am is null`, [jonasKonto]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.slug).toBe('security');
    expect(zeilen[0]?.abgeleitet).toBe(true);
    expect(zeilen[0]?.rolle).toBe('mitarbeiter');
  });

  it('eine ERTEILTE Rolle wird nicht ueberschrieben — und ueberlebt den Austritt', async () => {
    /*
     * Der Fall aus K-14 wortwoertlich: eine `leitung` der Reinigung ist dort
     * normalerweise auch angestellt. Ein Trigger, der ihre Zeile
     * ueberschreibt, nimmt ihr lautlos den ganzen Bereich.
     */
    const chefin = await konto('chefin', f.jonas);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, aus_anstellung)
       values ($1,$2,$3,false)`, [chefin, f.reinigung, await systemrolle('leitung')]);

    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'R-7002','2025-01-01','aktiv')`, [f.reinigung, f.jonas]);
    const nachAnlage = await sql.unsafe<{ rolle: string; abgeleitet: boolean }[]>(
      `select r.schluessel as rolle, bm.aus_anstellung as abgeleitet
         from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null`,
      [chefin, f.reinigung]);
    expect(nachAnlage, 'genau eine Mitgliedschaft, die erteilte').toHaveLength(1);
    expect(nachAnlage[0]?.rolle).toBe('leitung');
    expect(nachAnlage[0]?.abgeleitet).toBe(false);

    /* Beide Beschaeftigungen beenden — die erteilte Rolle bleibt. */
    await sql.unsafe(
      `update anstellung set status = 'beendet', austritt = '2025-12-31'
        where person_id = $1 and mandant_id = $2`, [f.jonas, f.reinigung]);
    const nachAustritt = await sql.unsafe<{ rolle: string }[]>(
      `select r.schluessel as rolle from benutzer_mandant bm join rolle r on r.id = bm.rolle_id
        where bm.benutzer_id = $1 and bm.mandant_id = $2 and bm.entzogen_am is null`,
      [chefin, f.reinigung]);
    expect(nachAustritt.map((z) => z.rolle)).toEqual(['leitung']);
  });

  it('die ABGELEITETE Zeile wird beim Austritt entzogen — mit Grund', async () => {
    const jonasKonto = await konto('jonas', f.jonas);
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7003','2025-01-01','aktiv') returning id`, [f.security, f.jonas]);
    await sql.unsafe(
      `update anstellung set status = 'beendet', austritt = '2025-12-31' where id = $1`,
      [neu!.id]);
    const [zeile] = await sql.unsafe<{
      abgeleitet: boolean; entzogen: string | null; grund: string | null;
    }[]>(
      `select aus_anstellung as abgeleitet, entzogen_am::text as entzogen, entzugsgrund as grund
         from benutzer_mandant where benutzer_id = $1 and mandant_id = $2`,
      [jonasKonto, f.security]);
    expect(zeile?.entzogen).not.toBeNull();
    expect(zeile?.grund).toMatch(/K-14/u);
    /*
     * `aus_anstellung` faellt auf `false` MIT dem Entzug — der Schutztrigger
     * `kern.bm_aus_anstellung_schutz` (0007) verbietet genau die Kombination
     * „war abgeleitet, bleibt abgeleitet, wird entzogen".
     */
    expect(zeile?.abgeleitet).toBe(false);
  });

  it('solange eine ANDERE laufende Beschaeftigung derselben Gesellschaft besteht: kein Entzug', async () => {
    /*
     * Zwei Beschaeftigungen bei derselben Gesellschaft sind moeglich (O-137).
     * Die erste zu beenden darf den Zugang nicht nehmen — der Mensch arbeitet
     * dort weiter.
     */
    const jonasKonto = await konto('jonas', f.jonas);
    const [eins] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7004','2025-01-01','aktiv') returning id`, [f.security, f.jonas]);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7005','2025-02-01','aktiv')`, [f.security, f.jonas]);
    await sql.unsafe(
      `update anstellung set status = 'beendet', austritt = '2025-12-31' where id = $1`,
      [eins!.id]);
    const [zeile] = await sql.unsafe<{ entzogen: string | null }[]>(
      `select entzogen_am::text as entzogen from benutzer_mandant
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);
    expect(zeile?.entzogen).toBeNull();
  });

  it('ohne Konto gibt es nichts zu pflegen — und keinen Fehler', async () => {
    /*
     * Der Normalfall einer Reinigungskraft ohne Portalzugang. Ein Trigger, der
     * hier wirft, macht das Anlegen einer Beschaeftigung unmoeglich.
     */
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7006','2025-01-01','aktiv') returning id`, [f.security, f.jonas]);
    expect(neu?.id).toBeTruthy();
  });
});

describe('(4b) ein von Hand entzogener Zugang kommt nicht durch eine Datumsaenderung zurueck', () => {
  it('ein Austritt in der ZUKUNFT legt keine neue Mitgliedschaft an', async () => {
    /*
     * **Der Befund, den dieser Fall einfriert.** Der Ausloeser haengt an
     * `update of status, geloescht_am` — er feuert also bei jedem UPDATE, das
     * `status` in der SET-Liste NENNT, auch wenn der Wert derselbe bleibt.
     * `beendeAnstellung` nennt sie immer
     * (`status = case when $4 then 'beendet' else status end`), und bei einem
     * Austritt in der Zukunft bleibt der Status `aktiv`. Der Ausloeser ging
     * damit in den ANLEGE-Zweig, sah keine Zeile mit `entzogen_am is null` —
     * die von Hand entzogene traegt ja einen Zeitpunkt — und legte eine neue
     * an. Aus „Beschaeftigung beenden" wurde eine Zugangserteilung.
     */
    const jonasKonto = await konto('jonas', f.jonas);
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7101','2025-01-01','aktiv') returning id`, [f.security, f.jonas]);

    /* Von Hand entziehen — erst uebernehmen, dann entziehen (0007). */
    await sql.unsafe(
      `update benutzer_mandant set aus_anstellung = false
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);
    await sql.unsafe(
      `update benutzer_mandant set entzogen_am = now(), entzugsgrund = 'gesperrt'
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);

    /* Genau die UPDATE-Form, die `beendeAnstellung` schreibt. */
    await sql.unsafe(
      `update anstellung
          set austritt = app.berlin_heute() + 30, austritt_grund = 'Eigenkündigung',
              status = case when false then 'beendet' else status end
        where id = $1`, [neu!.id]);

    const zeilen = await sql.unsafe<{ offen: boolean }[]>(
      `select (entzogen_am is null) as offen from benutzer_mandant
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);
    expect(zeilen, 'keine ZWEITE Mitgliedschaft').toHaveLength(1);
    expect(zeilen[0]?.offen, 'der Entzug haelt').toBe(false);
  });

  it('und auch eine neue Beschaeftigung erteilt ihn nicht von selbst wieder (O-615)', async () => {
    const jonasKonto = await konto('jonas', f.jonas);
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7102','2025-01-01','aktiv')`, [f.security, f.jonas]);
    await sql.unsafe(
      `update benutzer_mandant set aus_anstellung = false
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);
    await sql.unsafe(
      `update benutzer_mandant set entzogen_am = now(), entzugsgrund = 'gesperrt'
        where benutzer_id = $1 and mandant_id = $2`, [jonasKonto, f.security]);

    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,'S-7103','2026-01-01','aktiv')`, [f.security, f.jonas]);

    const offen = await sql.unsafe<{ id: string }[]>(
      `select id from benutzer_mandant
        where benutzer_id = $1 and mandant_id = $2 and entzogen_am is null`,
      [jonasKonto, f.security]);
    expect(offen, 'die Wiedererteilung ist eine Handlung, kein Nebeneffekt').toHaveLength(0);
  });
});

describe('(4c) beendigungsfolgen — die Tagesgrenze steht in Berlin', () => {
  /**
   * Eine Schicht mit Berliner WANDUHRZEIT und eine Zuordnung darauf.
   *
   * `app.loese_ortszeit` und nicht `at time zone` von Hand: das ist die EINE
   * Umrechnung Wanduhr -> Instant (0032), und ein Test, der sie umgeht, prueft
   * seine eigene Rechnung. `01:00` am Tag nach dem Austritt ist im Sommer
   * `23:00 UTC` am Austrittstag — genau der Fall, an dem die UTC-Grenze
   * scheiterte.
   */
  async function einsatzMit(
    datum: string, von: string, status = 'geplant',
  ): Promise<void> {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name)
       values ($1, $2, 'Beendenkunde') returning id`, [f.reinigung, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1, $2, $3, 'Beendenobjekt', 'Teststr. 1', '10115', 'Berlin') returning id`,
      [f.reinigung, k!.id, `O-${zufall()}`]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                            beginn_lokal, ende_lokal, endet_am_folgetag,
                            objekt_id, kunde_id, soll_besetzung, min_besetzung,
                            erstellt_von_art, status)
       values ($1, 'manuell', $2, $3::date,
               (select zeitpunkt from app.loese_ortszeit($3::date, $4::time, 'Europe/Berlin')),
               (select zeitpunkt from app.loese_ortszeit($3::date, $5::time, 'Europe/Berlin')),
               'Europe/Berlin', $4::time, $5::time, false,
               $6, $7, 1, 1, 'system', 'geplant')
       returning id`,
      [f.reinigung, `beenden:${zufall()}`, datum, von, '23:30', o!.id, k!.id]);
    /*
     * **Eine Absage traegt ihren Zeitpunkt und ihren Grund** —
     * `ez_absage_begruendet` (0028) laesst `status = 'abgesagt'` ohne beides
     * gar nicht erst entstehen. Das ist keine Huerde der Fixtur, sondern die
     * Zusage, um die es geht: wer nicht mehr gebunden ist, ist es aus einem
     * aufgezeichneten Grund. Eine Fixtur, die daran vorbeischriebe, pruefte
     * eine Lage, die der Betrieb nicht kennt.
     *
     * `now()` und kein Wanduhr-Literal: `abgesagt_am` ist ein INSTANT
     * (Invariante 5, Serveruhr). Die Berliner Wanduhrzeit steht oben an den
     * Zeiten der SCHICHT, wo sie hingehoert — dort geht sie ueber
     * `app.loese_ortszeit` in einen Instant, und die Tagesgrenze der
     * Auswertung zieht `beendigungsfolgen` selbst in Berlin. Gerechnet wird
     * auch hier auf UTC-Instanten; berlinerisch ist die Eingabe und die
     * Anzeige (Invariante 2).
     */
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      status, beginn_zeitpunkt, ende_zeitpunkt,
                                      abgesagt_am, absage_grund, erstellt_von_art)
       select $1, $2, $3, $4, $5::zuordnung_status, beginn_zeitpunkt, ende_zeitpunkt,
              case when $5 = 'abgesagt' then now() end,
              case when $5 = 'abgesagt' then 'Krankmeldung der Mitarbeiterin' end,
              'system'
         from einsatz where id = $2`,
      [f.reinigung, e!.id, f.jonasReinigung, f.jonas, status]);
  }

  it('eine Nachtschicht um 01:00 Berlin am Tag NACH dem Austritt zaehlt mit', async () => {
    /*
     * **Der Befund.** Die Grenze stand als `$2::date + interval '1 day'` —
     * ein `timestamp without time zone`, im Vergleich mit einer
     * `timestamptz`-Spalte in der SITZUNGSzone gelesen, und die ist UTC. Sie
     * lag damit im Sommer zwei Stunden zu spaet, und was herausfiel, war
     * genau die Nachtschicht (Invariante 2, Guard 5b). Die Seite meldete
     * „0 Einsätze nach dem Austritt" vor einer Bestaetigung, die sich nicht
     * zuruecknehmen laesst.
     *
     * 2025-06-30 23:00 UTC ist 2025-07-01 01:00 in Berlin — also NACH einem
     * Austritt am 30. Juni.
     */
    await einsatzMit('2025-07-01', '01:00');
    const folgen = await als(personal, (tx) =>
      beendigungsfolgen(kontextAus(tx, personal, f.reinigung), f.jonasReinigung, '2025-06-30'));
    expect(folgen.einsaetzeNachAustritt).toBe(1);
  });

  it('eine Schicht am Austrittstag selbst zaehlt NICHT — er ist der letzte Arbeitstag', async () => {
    await einsatzMit('2025-06-30', '08:00');
    const folgen = await als(personal, (tx) =>
      beendigungsfolgen(kontextAus(tx, personal, f.reinigung), f.jonasReinigung, '2025-06-30'));
    expect(folgen.einsaetzeNachAustritt).toBe(0);
  });

  it('abgesagte und ersetzte Zuordnungen binden niemanden mehr', async () => {
    await einsatzMit('2025-07-05', '08:00', 'abgesagt');
    await einsatzMit('2025-07-06', '08:00', 'ersetzt');
    const folgen = await als(personal, (tx) =>
      beendigungsfolgen(kontextAus(tx, personal, f.reinigung), f.jonasReinigung, '2025-06-30'));
    expect(folgen.einsaetzeNachAustritt,
      'eine Warnung, die immer steht, wird nicht mehr gelesen').toBe(0);
  });
});

describe('(4d) setzeKondition beantwortet eine Ueberschneidung mit einem Satz', () => {
  it('eine rueckwirkende Kondition IN einer geschlossenen Periode wirft keinen GIST-Fehler', async () => {
    await als(personal, async (tx) => {
      await tx`insert into anstellung_kondition
                 (mandant_id, anstellung_id, gilt_ab, gilt_bis, wochenstunden)
               values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', '2024-12-31', 39)`;
    });
    await expect(
      als(personal, (tx) =>
        setzeKondition(kontextAus(tx, personal, f.reinigung), {
          anstellungId: f.jonasReinigung, giltAb: '2024-06-01', stundensatzCent: cent(1500n),
        })),
    ).rejects.toThrow(VertragEingabeFehler);
    await expect(
      als(personal, (tx) =>
        setzeKondition(kontextAus(tx, personal, f.reinigung), {
          anstellungId: f.jonasReinigung, giltAb: '2024-06-01', stundensatzCent: cent(1500n),
        })),
      'der Satz nennt den Zeitraum, der im Weg steht',
    ).rejects.toThrow(/2024-01-01/u);
  });

  it('nach einer geschlossenen Periode geht die naechste weiterhin', async () => {
    await als(personal, async (tx) => {
      await tx`insert into anstellung_kondition
                 (mandant_id, anstellung_id, gilt_ab, gilt_bis, wochenstunden)
               values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', '2024-12-31', 39)`;
      await setzeKondition(kontextAus(tx, personal, f.reinigung), {
        anstellungId: f.jonasReinigung, giltAb: '2025-01-01', stundensatzCent: cent(1500n),
      });
    });
    const zeilen = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from anstellung_kondition where anstellung_id = $1`,
      [f.jonasReinigung]);
    expect(Number(zeilen[0]?.n)).toBe(2);
  });
});

describe('(4e) der Spiegel wird GELEERT, wenn heute keine Kondition gilt', () => {
  it('eine in der Vergangenheit geschlossene Kondition laesst keinen alten Wert stehen', async () => {
    /*
     * Der unbezahlte Ruhezeitraum, den 0192 im Kopf ausdruecklich als
     * legitime LUECKE beschreibt. Vorher blieb der Spiegel auf den Werten der
     * letzten Kondition stehen: die Vertrags- und die Entgeltseite zeigten
     * Wochenstunden, die niemand mehr vereinbart hat.
     */
    await als(personal, (tx) =>
      tx`insert into anstellung_kondition
           (mandant_id, anstellung_id, gilt_ab, arbeitszeitmodell, wochenstunden)
         values (${f.reinigung}, ${f.jonasReinigung}, '2024-01-01', 'vollzeit', 39)`);
    const [vorher] = await sql.unsafe<{ stunden: string | null }[]>(
      `select wochenstunden::text as stunden from anstellung where id = $1`,
      [f.jonasReinigung]);
    expect(Number(vorher?.stunden)).toBe(39);

    await als(personal, (tx) =>
      tx`update anstellung_kondition set gilt_bis = '2024-12-31'
          where anstellung_id = ${f.jonasReinigung} and gilt_bis is null`);
    const [nachher] = await sql.unsafe<{ stunden: string | null; modell: string }[]>(
      `select wochenstunden::text as stunden, arbeitszeitmodell as modell
         from anstellung where id = $1`, [f.jonasReinigung]);
    expect(nachher?.stunden, 'kein stehengebliebener Wert').toBeNull();
    expect(nachher?.modell).toBe('unbekannt');
  });

  it('der Nachzieher raeumt dieselbe Lage auf', async () => {
    await sql.unsafe(
      `insert into anstellung_kondition
         (mandant_id, anstellung_id, gilt_ab, gilt_bis, wochenstunden)
       values ($1,$2,'2024-01-01','2024-12-31',39)`, [f.reinigung, f.jonasReinigung]);
    await sql.unsafe(
      `update anstellung set wochenstunden = 39, arbeitszeitmodell = 'vollzeit'
        where id = $1`, [f.jonasReinigung]);

    const [ergebnis] = await alsRolle('cse_job', (tx) =>
      tx.unsafe<{ n: number }[]>(
        `select app.anstellung_kondition_spiegel_nachziehen() as n`));
    expect(Number(ergebnis?.n)).toBeGreaterThanOrEqual(1);

    const [nachher] = await sql.unsafe<{ stunden: string | null }[]>(
      `select wochenstunden::text as stunden from anstellung where id = $1`,
      [f.jonasReinigung]);
    expect(nachher?.stunden).toBeNull();
  });
});

describe('(5) app.anstellung_status_nachziehen — der Kalender entscheidet', () => {
  it('ein vergangenes Austrittsdatum setzt `beendet`, ein zukuenftiges nicht', async () => {
    const [tage] = await sql.unsafe<{ gestern: string; morgen: string }[]>(
      `select to_char(app.berlin_heute() - 1, 'YYYY-MM-DD') as gestern,
              to_char(app.berlin_heute() + 30, 'YYYY-MM-DD') as morgen`);
    await sql.unsafe(`update anstellung set austritt = $2 where id = $1`,
      [f.jonasReinigung, tage!.gestern]);
    await sql.unsafe(`update anstellung set austritt = $2 where id = $1`,
      [f.fatimaReinigung, tage!.morgen]);

    /* Nur `cse_job` darf den Nachlauf fahren — er ist keine Handlung eines Menschen. */
    const [ergebnis] = await alsRolle('cse_job', (tx) =>
      tx.unsafe<{ n: number }[]>(`select app.anstellung_status_nachziehen() as n`));
    expect(Number(ergebnis?.n)).toBeGreaterThanOrEqual(1);

    const zeilen = await sql.unsafe<{ id: string; status: string }[]>(
      `select id, status from anstellung where id = any($1::uuid[])`,
      [[f.jonasReinigung, f.fatimaReinigung]]);
    const nach = new Map(zeilen.map((z) => [z.id, z.status]));
    expect(nach.get(f.jonasReinigung)).toBe('beendet');
    expect(nach.get(f.fatimaReinigung)).toBe('aktiv');
  });

  it('`cse_app` darf ihn nicht ausfuehren', async () => {
    await expect(
      als(personal, (tx) => tx`select app.anstellung_status_nachziehen()`),
    ).rejects.toThrow(/permission denied/iu);
  });
});
