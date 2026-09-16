/**
 * Recruiting an echtem Postgres (REC-01…REC-09, LEG-11, LEG-12).
 *
 * **Drei Zusagen, die nur hier prüfbar sind**, weil sie in der Datenbank
 * stehen und nicht im Code:
 *
 *  1. **Eine Einstellungsentscheidung verlangt einen MENSCHEN** (Art. 22
 *     DSGVO). Der Auslöser `kern.entscheidung_ist_menschlich` weist jede Zeile
 *     ab, deren `app.akteur_typ` nicht `mensch` ist. Ein Test im Code könnte
 *     nur zeigen, dass der Handler es nicht versucht — nicht, dass es
 *     unmöglich ist.
 *  2. **Die Mandantenwand.** Eine Bewerbung gehört dem Bereich, bei dem sie
 *     einging; eine Nachbargesellschaft sieht sie nicht (Invariante 3).
 *  3. **Der Löschlauf löscht ECHT** — und hält an einer Sperre. Das ist die
 *     Ausnahme von Invariante 8, und eine Ausnahme, die man behauptet und
 *     nicht prüft, ist eine Lücke.
 *
 * **Falsifizierbar:** der Entscheidungsfall läuft zweimal — einmal als Mensch
 * (muss durchgehen) und einmal als Agent (muss abgewiesen werden). Ginge der
 * zweite durch, wäre der erste wertlos.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { alsJobRolle, alsJobSitzung } from '../../src/server/jobs/sitzung.js';
import { registriereBewerberLoeschung } from '../../src/server/jobs/bewerberLoeschung.js';
import { leereRegister, type JobDefinition } from '../../src/server/jobs/registry.js';
import {
  aufbewahrungTage, nimmBewerbungAn, planeGespraech, RecruitingFehler,
} from '../../src/server/services/recruiting/dienst.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let job: JobDefinition;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * Ein Konto MIT Rolle — und ohne das sieht diese Suite nichts.
 *
 * `t_bewerbung_lesen` verlangt `app.hat_recht('recruiting.bewerbung_lesen', …)`,
 * und ein Recht hängt an einer Rolle, die an einem Benutzer hängt. Eine
 * Sitzung ohne `benutzerId` liest deshalb NULL Zeilen — was in einem Test
 * genauso aussieht wie eine dichte Mandantenwand. Der zweite Fall unten
 * („und der eigene Bereich sieht sie") ist genau dagegen da: ohne ihn hätte
 * die Wand auch dann bestanden, wenn niemand jemals etwas sähe.
 */
async function legeKontoAn(mandantId: string, rolle = 'leitung'): Promise<string> {
  const email = `rec-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

beforeEach(async () => {
  f = await seed();
  leereRegister();
  job = registriereBewerberLoeschung(sql);
});

afterAll(schliessen);

/** Eine Stelle und eine Bewerbung, angelegt am Portal vorbei — als Eigentümer. */
async function bewerbungAnlegen(
  mandantId: string, tageBis: number, sperre: string | null = null,
): Promise<{ stelleId: string; bewerbungId: string }> {
  return alsRolle('', async (tx) => {
    const [s] = (await tx.unsafe(
      `insert into stelle (mandant_id, titel, beschreibung, anforderungen)
       values ($1::uuid, 'Testtitel', 'Testbeschreibung', array['A','B'])
       returning id`, [mandantId])) as unknown as { id: string }[];
    const [b] = (await tx.unsafe(
      `insert into bewerbung
         (mandant_id, stelle_id, name, email, aufbewahrung_bis, loeschsperre)
       values ($1::uuid, $2::uuid, 'Test Mensch', 'test@example.test',
               (app.berlin_heute() + $3::int), $4)
       returning id`,
      [mandantId, s!.id, tageBis, sperre])) as unknown as { id: string }[];
    return { stelleId: s!.id, bewerbungId: b!.id };
  });
}

/**
 * **Ein Gespräch braucht eine Bewerbung, die es GIBT** (REC-06, REC-07,
 * D-578).
 *
 * `planeGespraech` prüfte nur die FORM der Kennung, an der Route. Zwei Fälle
 * fielen darunter durch, gemeldet von der Copilot-Runde auf PR 16:
 *
 *  - Eine gültig geformte, unbekannte Kennung lief in den zusammengesetzten
 *    Fremdschlüssel und kam als **500** heraus — ein Serverfehler für eine
 *    Eingabe, die schlicht falsch ist.
 *  - Eine **gelöschte** Bewerbung erfüllt den Fremdschlüssel weiter. Sie hätte
 *    einen Termin bekommen, den keine Liste zeigt — eine Einladung an
 *    jemanden, dessen Daten gerade anonymisiert wurden.
 */
describe('ein Gespraech braucht eine vorhandene Bewerbung (REC-06)', () => {
  function schreibkontext(
    tx: postgres.TransactionSql, mandantId: string, benutzerId: string,
  ): SchreibKontext {
    const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return {
      scope: 'mandant', portal: 'intern', benutzerId,
      aktiverMandantId: mandantId, mandantIds: [mandantId],
      abfrage, schreibe: abfrage,
    };
  }

  async function alsMensch<T>(
    mandantId: string, fn: (k: SchreibKontext) => Promise<T>,
  ): Promise<T> {
    const wer = await legeKontoAn(mandantId);
    return alsApp(
      { scope: 'mandant', mandantId, benutzerId: wer, portal: 'intern', readonly: false },
      async (tx: postgres.TransactionSql) => fn(schreibkontext(tx, mandantId, wer)),
    ) as Promise<T>;
  }

  const MORGEN = (): Date => new Date(Date.now() + 86_400_000);

  it('eine unbekannte Kennung ist ein 404, kein Serverfehler', async () => {
    await expect(alsMensch(f.reinigung, (k) => planeGespraech(
      k, '00000000-0000-4000-8000-000000000000', MORGEN(), 45, null, [])))
      .rejects.toThrow(RecruitingFehler);
  });

  it('eine GELOESCHTE Bewerbung bekommt keinen Termin mehr', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    await sql.unsafe(
      `update bewerbung set geloescht_am = now() where id = $1::uuid`, [bewerbungId]);

    await expect(alsMensch(f.reinigung, (k) => planeGespraech(
      k, bewerbungId, MORGEN(), 45, null, []))).rejects.toThrow(RecruitingFehler);

    const [z] = (await sql.unsafe(
      `select count(*)::int as n from gespraech where bewerbung_id = $1::uuid`,
      [bewerbungId])) as unknown as { n: number }[];
    expect(z!.n, 'kein Termin zu einer geloeschten Bewerbung').toBe(0);
  });

  it('und eine vorhandene bekommt ihn', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const id = await alsMensch(f.reinigung, (k) => planeGespraech(
      k, bewerbungId, MORGEN(), 45, 'Büro Neukölln', ['Warum wir?']));
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('eine Entscheidung verlangt einen Menschen (REC-08, Art. 22 DSGVO)', () => {
  /*
   * **Warum hier nicht `app.akteur_typ` geprüft wird.** Die erste Fassung des
   * Auslösers fragte genau das — und `unveraenderbarkeit.test.ts` hat es
   * abgewiesen, zu Recht: die GUC setzt der Aufrufer selbst. Ein Weg, der sie
   * schlicht nicht auf `agent` setzt, wäre durchgekommen, ohne den Riegel zu
   * berühren. Geprüft wird deshalb, was die Datenbank wirklich weiss: wer die
   * Sitzung hält.
   */
  it('ein Mensch darf entscheiden', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const konto = await legeKontoAn(f.reinigung);

    const zeilen = await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: konto,
        readonly: false, portal: 'intern',
      },
      (tx) => tx.unsafe(
        `insert into einstellungsentscheidung
           (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
         values ($1::uuid, $2::uuid, 'abgelehnt'::bewerbung_status,
                 'Fachlich nicht passend — die Anforderungen sind nicht belegt.', $3::uuid)
         returning id`,
        [f.reinigung, bewerbungId, konto]));
    expect(zeilen).toHaveLength(1);
  });

  it('eine Entscheidung im Namen eines ANDEREN wird abgewiesen', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const konto = await legeKontoAn(f.reinigung);
    const fremdesKonto = await legeKontoAn(f.reinigung);

    await expect(sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`set local role cse_app`);
      await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                              set_config('app.mandant_id', $1, true),
                              set_config('app.benutzer_id', $2, true),
                              set_config('app.readonly', 'off', true),
                              set_config('app.portal', 'intern', true)`, [f.reinigung, konto]);
      /*
       * Der einzige Unterschied zum Fall darüber: `entschieden_von` ist ein
       * ANDERER als der angemeldete Benutzer. Genau so sähe eine Entscheidung
       * aus, die ein Lauf im Namen eines Menschen einträgt — und genau die
       * verbietet Art. 22.
       */
      return tx.unsafe(
        `insert into einstellungsentscheidung
           (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
         values ($1::uuid, $2::uuid, 'abgelehnt'::bewerbung_status, 'Automatisch', $3::uuid)`,
        [f.reinigung, bewerbungId, fremdesKonto]);
    })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('der öffentliche Eingang schreibt und liest nicht (REC-03)', () => {
  /**
   * **Der Befund, den dieser Fall festhält.** `nimmBewerbungAn` schrieb
   * `insert … returning id`. Die Einfügung ist erlaubt
   * (`t_bewerbung_eingang`), das LESEN der zurückgegebenen Zeile nicht — der
   * Eingangsprinzipal hat kein `recruiting.bewerbung_lesen`, und das ist
   * Absicht: wer ein Formular abschickt, darf nicht daraufhin die
   * Bewerbungen der anderen lesen.
   *
   * Postgres meldet das als `new row violates row-level security policy` —
   * eine Meldung, die auf die Einfügung zeigt und das Lesen meint. Jede
   * Bewerbung über die Karriereseite endete damit in einem 500, und die
   * Meldung schickte die Suche in die falsche Richtung.
   *
   * Die Kennung entsteht deshalb in der Anwendung, wie bei der
   * Formularannahme (0015).
   */
  it('einfügen ja, zurückgeben nein — die Kennung kommt aus der Anwendung', async () => {
    const eingang = await legeKontoAn(f.reinigung, 'mitarbeiter');
    const id = '11111111-2222-3333-4444-555555555555';

    await alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: eingang,
        readonly: false, portal: 'intern',
      },
      (tx) => tx.unsafe(
        `insert into bewerbung (id, mandant_id, quelle, name, email, aufbewahrung_bis)
         values ($1::uuid, $2::uuid, 'initiativ', 'Probe',
                 'probe@example.test', (app.berlin_heute() + 180))`,
        [id, f.reinigung]));

    /* Angekommen ist sie — nachgesehen als Eigentümer, nicht als Eingang. */
    const da = await alsRolle('', (tx) => tx.unsafe(
      `select id from bewerbung where id = $1::uuid`, [id]));
    expect(da).toHaveLength(1);
  });

  it('und `returning` schlägt fehl — genau das war der Befund', async () => {
    const eingang = await legeKontoAn(f.reinigung, 'mitarbeiter');
    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.reinigung, benutzerId: eingang,
        readonly: false, portal: 'intern',
      },
      (tx) => tx.unsafe(
        `insert into bewerbung (mandant_id, quelle, name, email, aufbewahrung_bis)
         values ($1::uuid, 'initiativ', 'Probe', 'probe2@example.test',
                 (app.berlin_heute() + 180))
         returning id`,
        [f.reinigung]))).rejects.toMatchObject({ code: '42501' });
  });
});

describe('die Mandantenwand trägt auch für Bewerbungen (Invariante 3)', () => {
  it('die Nachbargesellschaft sieht die Bewerbung nicht', async () => {
    await bewerbungAnlegen(f.reinigung, 30);
    const konto = await legeKontoAn(f.security);
    const fremd = await alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`select id from bewerbung`));
    expect(fremd).toHaveLength(0);
  });

  it('und der eigene Bereich sieht sie', async () => {
    await bewerbungAnlegen(f.reinigung, 30);
    const konto = await legeKontoAn(f.reinigung);
    const eigen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`select id from bewerbung`));
    expect(eigen).toHaveLength(1);
  });
});

describe('der Löschlauf löscht echt — und hält an einer Sperre (REC-07)', () => {
  it('eine abgelaufene Bewerbung trägt danach keinen Namen mehr', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, -1);
    const ergebnis = await job.ausfuehren(
      { mandantId: null, laufId: 'test-lauf-1', versuch: 1 }) as { geloescht: number };
    expect(ergebnis.geloescht).toBeGreaterThanOrEqual(1);

    /*
     * Als Eigentümer gelesen, nicht als `cse_app`: eine Policy, die die Zeile
     * verbirgt, sähe hier aus wie eine Löschung. Der Unterschied ist der ganze
     * Punkt von Art. 17 DSGVO — und genau deshalb steht hier `name` und nicht
     * nur `toHaveLength`.
     */
    const [rest] = (await alsRolle('', (tx) => tx.unsafe(
      `select name, email, telefon, nachricht, geloescht_am from bewerbung
        where id = $1::uuid`, [bewerbungId]))) as unknown as {
        name: string; email: string; telefon: string | null;
        nachricht: string | null; geloescht_am: Date | null;
      }[];
    expect(rest).toBeDefined();
    expect(rest!.name).not.toContain('Test Mensch');
    expect(rest!.email).not.toContain('test@example.test');
    expect(rest!.telefon).toBeNull();
    expect(rest!.nachricht).toBeNull();
    expect(rest!.geloescht_am).not.toBeNull();
  });

  it('und ihre Bewertungen sind ganz weg — nicht nur unsichtbar', async () => {
    /*
     * **Der Fall, der die Lücke gefunden hat.** Die Bewerbung zu anonymisieren
     * reicht nicht: `begruendung` ist ein Satz ÜBER einen Menschen. Bliebe er
     * stehen, wäre die Bewerbung gelöscht und die Person weiter beschrieben.
     * Beim ersten Lauf scheiterte der Job hier mit `permission denied for
     * table bewerbung_bewertung` — in der Auslieferung wäre daraus ein
     * Nachtlauf geworden, der jede Nacht abbricht.
     */
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, -1);
    await alsRolle('', (tx) => tx.unsafe(
      `insert into bewerbung_bewertung
         (mandant_id, bewerbung_id, kriterium, gewicht, punkte, begruendung)
       values ($1::uuid, $2::uuid, 'A', 50, 8, 'Im Lebenslauf belegt')`,
      [f.reinigung, bewerbungId]));

    await job.ausfuehren({ mandantId: null, laufId: 'test-lauf-1b', versuch: 1 });

    const rest = await alsRolle('', (tx) => tx.unsafe(
      `select id from bewerbung_bewertung where bewerbung_id = $1::uuid`, [bewerbungId]));
    expect(rest).toHaveLength(0);
  });

  it('eine abgelaufene Bewerbung MIT Sperre behält ihren Namen und wird gezählt', async () => {
    const { bewerbungId } = await bewerbungAnlegen(
      f.reinigung, -1, 'Laufendes AGG-Verfahren');
    const ergebnis = await job.ausfuehren(
      { mandantId: null, laufId: 'test-lauf-2', versuch: 1 }) as { gesperrt: number };
    expect(ergebnis.gesperrt).toBeGreaterThanOrEqual(1);

    const [rest] = (await alsRolle('', (tx) => tx.unsafe(
      `select name, geloescht_am from bewerbung where id = $1::uuid`,
      [bewerbungId]))) as unknown as { name: string; geloescht_am: Date | null }[];
    expect(rest!.name).toBe('Test Mensch');
    expect(rest!.geloescht_am).toBeNull();
  });

  it('eine noch laufende Bewerbung bleibt unberührt', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    await job.ausfuehren({ mandantId: null, laufId: 'test-lauf-3', versuch: 1 });
    const [rest] = (await alsRolle('', (tx) => tx.unsafe(
      `select name, geloescht_am from bewerbung where id = $1::uuid`,
      [bewerbungId]))) as unknown as { name: string; geloescht_am: Date | null }[];
    expect(rest!.name).toBe('Test Mensch');
    expect(rest!.geloescht_am).toBeNull();
  });

  it('jede Löschung hinterlässt ein Protokoll — ohne personenbezogene Daten', async () => {
    await bewerbungAnlegen(f.reinigung, -1);
    await job.ausfuehren({ mandantId: null, laufId: 'test-lauf-4', versuch: 1 });
    const [lauf] = (await alsRolle('', (tx) => tx.unsafe(
      `select geloescht, gesperrt from bewerbung_loeschlauf
        where mandant_id = $1::uuid order by gelaufen_am desc limit 1`,
      [f.reinigung]))) as unknown as { geloescht: number; gesperrt: number }[];
    expect(lauf).toBeDefined();
    expect(Number(lauf!.geloescht)).toBeGreaterThanOrEqual(1);
  });

  it('und der Lauf findet die Zeilen als `cse_job` — nicht nur als Superuser', async () => {
    /*
     * **Der Fall, ohne den der Lauf blind grün wäre.** In CI steht `postgres`
     * in `DATABASE_URL` — ein Superuser mit BYPASSRLS. Fände der Lauf seine
     * Zeilen nur so, meldete er in einer Auslieferung mit der Anwendungsrolle
     * jede Nacht „0 gelöscht", ohne ein rotes Zeichen. Hier wird genau der
     * Weg gegangen, den er nachts nimmt.
     */
    await bewerbungAnlegen(f.reinigung, -1);
    const gefunden = await alsJobRolle(sql, (jd) => jd.abfrage<{ id: string }>(
      `select id from bewerbung
        where geloescht_am is null and aufbewahrung_bis <= app.berlin_heute()`));
    expect(gefunden.length).toBeGreaterThanOrEqual(1);
  });

  it('und er schreibt sein Protokoll im Mandanten, nicht daneben', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.security, -1);
    await alsJobSitzung(sql, f.security, async (jd) => {
      await jd.abfrage(
        `update bewerbung set geloescht_am = now() where id = $1::uuid`, [bewerbungId]);
      await jd.abfrage(
        `insert into bewerbung_loeschlauf (mandant_id, geloescht, gesperrt, bewerbungen)
         values ($1::uuid, 1, 0, $2::uuid[])`, [f.security, [bewerbungId]]);
    }, { nurLesen: false });

    const konto = await legeKontoAn(f.reinigung);
    const fremd = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konto, portal: 'intern' },
      (tx) => tx.unsafe(`select id from bewerbung_loeschlauf`));
    expect(fremd).toHaveLength(0);
  });
});

/**
 * **Eine Stellenanzeige geht nur mit einer GENEHMIGTEN Freigabe hinaus**
 * (REC-02, Invariante 7, 0167).
 *
 * 0166 hatte nur `stelle_freigegeben_hat_freigabe check (… freigabe_id is not
 * null)`. Eine `check`-Bedingung kann keine andere Tabelle lesen, also stand
 * dort genau das: DASS eine Kennung dasteht. Welche, mit welchem Ausgang und
 * für welche Aktion, blieb offen — und damit liess sich eine Stelle mit einer
 * offenen, einer abgelehnten oder der Freigabe eines Social-Beitrags auf
 * `veroeffentlicht` setzen. Gemeldet hat das die Copilot-Runde auf PR 16.
 *
 * Geprüft wird hier als EIGENTÜMER: der Riegel muss auch dann halten, wenn
 * niemand über die Anwendung geht. Genau das ist der Unterschied zwischen
 * einer Regel im Dienst und einer in der Datenbank (Invariante 3).
 */
describe('eine Stelle wird nicht ohne GENEHMIGUNG freigegeben (REC-02, 0167)', () => {
  /**
   * **Eine Rohschreibung MIT Mandantenkontext** — und warum sie sein muss.
   *
   * Der Riegel fragt `app.freigabe_genehmigt`, einen Definer, dessen Policy
   * auf `freigabe` (`d_freigabe_lesen`, 0123) `mandant_id =
   * app.aktiver_mandant()` verlangt. Eine Rohverbindung ohne gesetzte GUCs hat
   * keinen aktiven Mandanten, sieht deshalb NULL Zeilen und fällt in den
   * Riegel — **richtig herum**: er schliesst, wenn er nicht nachsehen kann.
   *
   * Der Test setzt den Kontext also, statt den Riegel zu lockern. Genau das
   * tut der echte Weg auch: `withTenant` setzt dieselben beiden GUCs. Dieselbe
   * Lehre wie in `social.test.ts`, und sie hat hier zwei Fehlschläge gekostet,
   * bevor sie hier stand.
   */
  async function imMandanten<T>(
    mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                              set_config('app.mandant_id', $1, true)`, [mandantId]);
      return fn(tx);
    }) as Promise<T>;
  }

  /**
   * `bezugId` ist die Stelle, der die Freigabe GILT.
   *
   * Sie fehlte hier zuerst, und der Riegel liess die Freigabe trotzdem
   * durch — das war der zweite Befund derselben Runde: geprueft wurden
   * Ausgang, Mandant und Aktion, nicht aber, WOFUER die Zustimmung gilt.
   */
  async function freigabeAnlegen(
    mandantId: string, status: string, bezugId: string,
    aktion = 'stelle_veroeffentlichen',
  ): Promise<string> {
    const mensch = await legeKontoAn(mandantId);
    const [fr] = (await sql.unsafe(
      `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                             zusammenfassung, risiko, vorschau_payload, payload_hash,
                             freigegeben_von, freigegeben_am, bezug_typ, bezug_id,
                             erforderliches_recht)
       values ($1::uuid, $2, $3::freigabe_status, 'stellenanzeige_entwurf', 'Probe',
               'Probe', 'mittel'::risiko_stufe, '{}'::jsonb,
               encode(sha256(convert_to('probe', 'UTF8')), 'hex'),
               case when $3 = 'genehmigt' then $4::uuid else null end,
               case when $3 = 'genehmigt' then now() else null end, 'stelle', $5::uuid,
               'recruiting.stelle_veroeffentlichen')
       returning id`,
      [mandantId, aktion, status, mensch, bezugId])) as unknown as { id: string }[];
    return fr!.id;
  }

  it('mit einer OFFENEN Freigabe wird sie abgewiesen', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(f.reinigung, 'offen', stelleId);
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben', freigabe_id = $2::uuid
        where id = $1::uuid`, [stelleId, freigabeId])))
      .rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });

  it('mit einer ABGELEHNTEN ebenso', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(f.reinigung, 'abgelehnt', stelleId);
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben', freigabe_id = $2::uuid
        where id = $1::uuid`, [stelleId, freigabeId])))
      .rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });

  /**
   * **Die AKTION geht mit** (0130 §6). Ohne sie öffnete die Zustimmung zu
   * einem Social-Beitrag eine Stellenanzeige: dieselbe Kennung, derselbe
   * Mandant, derselbe Status — und eine völlig andere Entscheidung.
   */
  it('eine GENEHMIGTE Freigabe fuer etwas anderes traegt sie auch nicht', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(
      f.reinigung, 'genehmigt', stelleId, 'social_veroeffentlichen');
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben', freigabe_id = $2::uuid
        where id = $1::uuid`, [stelleId, freigabeId])))
      .rejects.toThrow(/GENEHMIGTEN Freigabe/u);
  });

  /**
   * **Die Zustimmung gilt EINEM TEXT, nicht einer Gattung.**
   *
   * Der Riegel prüfte Ausgang, Mandant und Aktion — und damit hätte eine
   * echte, genehmigte `stelle_veroeffentlichen`-Freigabe der EINEN Anzeige
   * die ANDERE geöffnet: `stelle.freigabe_id` ist eine beschreibbare Spalte,
   * und wer zwei Anzeigen führt, hängt die Kennung um. Wer eine Hilfskraft
   * genehmigt bekommen hat, hätte damit eine Leitungsstelle veröffentlicht,
   * unter derselben Zustimmung.
   *
   * Genau dafür schreibt `legeStelleVor` den Nutzlast-Hash mit. Gemeldet hat
   * es die Copilot-Runde auf PR 16 — derselbe Befund wie der erste, eine
   * Ebene tiefer.
   */
  it('eine genehmigte Freigabe einer ANDEREN Stelle traegt sie nicht', async () => {
    const eine = await bewerbungAnlegen(f.reinigung, 30);
    const andere = await bewerbungAnlegen(f.reinigung, 30);
    /* Echt, genehmigt, richtiger Mandant, richtige Aktion — nur fuer die andere. */
    const fremde = await freigabeAnlegen(f.reinigung, 'genehmigt', andere.stelleId);
    await expect(imMandanten(f.reinigung, (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben', freigabe_id = $2::uuid
        where id = $1::uuid`, [eine.stelleId, fremde])))
      .rejects.toThrow(/anderen Stelle/u);
  });

  it('und ganz ohne Freigabe erst recht nicht', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    await expect(alsRolle('', (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben' where id = $1::uuid`, [stelleId])))
      .rejects.toThrow();
  });

  it('mit einer GENEHMIGTEN Freigabe fuer DIESE Aktion geht sie durch', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(f.reinigung, 'genehmigt', stelleId);
    await imMandanten(f.reinigung, (tx) => tx.unsafe(
      `update stelle set status = 'freigegeben', freigabe_id = $2::uuid
        where id = $1::uuid`, [stelleId, freigabeId]));
    const [s] = (await alsRolle('', (tx) => tx.unsafe(
      `select status::text as status from stelle where id = $1::uuid`,
      [stelleId]))) as unknown as { status: string }[];
    expect(s!.status).toBe('freigegeben');
  });

  /**
   * **Der Nachzug in beide Richtungen** (`freigabe_zieht_stelle_nach`).
   *
   * Ein Ausführer in `freigabe/ausfuehrung.ts` wäre die halbe Lösung: er läuft
   * nur bei `genehmigt`. Bei einer ABLEHNUNG bliebe die Stelle auf ihrem Stand
   * stehen, während ihre Freigabe abgelehnt ist — zwei Bildschirme, zwei
   * Antworten, und niemand sucht danach.
   */
  it('die Entscheidung zieht die Stelle nach — genehmigt wird freigegeben', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(f.reinigung, 'offen', stelleId);
    const mensch = await legeKontoAn(f.reinigung);
    await alsRolle('', (tx) => tx.unsafe(
      `update stelle set freigabe_id = $2::uuid where id = $1::uuid`,
      [stelleId, freigabeId]));
    await imMandanten(f.reinigung, (tx) => tx.unsafe(
      `update freigabe set status = 'genehmigt', freigegeben_von = $2::uuid,
                           freigegeben_am = now()
        where id = $1::uuid`, [freigabeId, mensch]));
    const [s] = (await alsRolle('', (tx) => tx.unsafe(
      `select status::text as status from stelle where id = $1::uuid`,
      [stelleId]))) as unknown as { status: string }[];
    expect(s!.status).toBe('freigegeben');
  });

  it('und eine ABLEHNUNG holt sie in den Entwurf zurueck, ohne Kennung', async () => {
    const { stelleId } = await bewerbungAnlegen(f.reinigung, 30);
    const freigabeId = await freigabeAnlegen(f.reinigung, 'offen', stelleId);
    await alsRolle('', (tx) => tx.unsafe(
      `update stelle set freigabe_id = $2::uuid where id = $1::uuid`,
      [stelleId, freigabeId]));
    await alsRolle('', (tx) => tx.unsafe(
      `update freigabe set status = 'abgelehnt', begruendung = 'Probe'
        where id = $1::uuid`, [freigabeId]));
    const [s] = (await alsRolle('', (tx) => tx.unsafe(
      `select status::text as status, freigabe_id from stelle where id = $1::uuid`,
      [stelleId]))) as unknown as { status: string; freigabe_id: string | null }[];
    expect(s!.status).toBe('entwurf');
    expect(s!.freigabe_id).toBeNull();
  });
});

/**
 * **Der Löschlauf nimmt eine EINGESTELLTE Bewerbung nicht mit** (O-376).
 *
 * Das öffentliche Formular sagt zu: gelöscht nach der Frist, „sofern kein
 * Arbeitsverhältnis zustande kommt". Der Lauf las nur die Frist — samt
 * `einstellungsentscheidung`, also dem Nachweis, den REC-08 verlangt. Zusage
 * und Verhalten liefen auseinander; vor der Aufsicht zählt die Zusage.
 */
describe('eingestellte Bewerbungen haelt der Loeschlauf zurueck (O-376)', () => {
  it('die Frist ist abgelaufen — und der Name steht noch da', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, -1);
    await alsRolle('', (tx) => tx.unsafe(
      `update bewerbung set status = 'eingestellt' where id = $1::uuid`, [bewerbungId]));

    await job.ausfuehren({ mandantId: null, laufId: 'test-o376', versuch: 1 });

    const [rest] = (await alsRolle('', (tx) => tx.unsafe(
      `select name, geloescht_am from bewerbung where id = $1::uuid`,
      [bewerbungId]))) as unknown as { name: string; geloescht_am: Date | null }[];
    expect(rest!.name).toBe('Test Mensch');
    expect(rest!.geloescht_am).toBeNull();
  });

  it('eine NICHT eingestellte mit derselben Frist geht dagegen', async () => {
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, -1);
    await job.ausfuehren({ mandantId: null, laufId: 'test-o376b', versuch: 1 });
    const [rest] = (await alsRolle('', (tx) => tx.unsafe(
      `select geloescht_am from bewerbung where id = $1::uuid`,
      [bewerbungId]))) as unknown as { geloescht_am: Date | null }[];
    expect(rest!.geloescht_am).not.toBeNull();
  });
});

/**
 * **Der Status einer Bewerbung wandert NUR über eine Entscheidung**
 * (REC-08, Art. 22 DSGVO, 0168).
 *
 * `t_bewerbung_schreiben` gab jedem `update` frei, der
 * `recruiting.bewerbung_lesen` hält — ohne Spalten- und ohne Zustandsgrenze.
 * Der Riegel `kern.entscheidung_ist_menschlich` hielt damit genau eine Tür zu,
 * während die Wand daneben offen stand: `status = 'eingestellt'` liess sich
 * direkt schreiben, ohne Entscheidung, ohne Begründung, ohne Namen dessen, der
 * sie traf. Gemeldet hat das die Copilot-Runde auf PR 16.
 */
describe('cse_app schreibt nicht auf `bewerbung` (REC-08, 0168)', () => {
  it('ein direktes `update status` wird abgewiesen', async () => {
    const konto = await legeKontoAn(f.reinigung, 'admin');
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: konto, portal: 'intern' as const, readonly: false,
    };
    await expect(alsApp(sitzung, (tx) => tx.unsafe(
      `update bewerbung set status = 'eingestellt' where id = $1::uuid`, [bewerbungId])))
      .rejects.toThrow();
  });

  /**
   * **Und auch die Uhr nicht.** `aufbewahrung_bis` zu verschieben wäre die
   * lautlose Version derselben Umgehung: die Bewerbung bliebe über die Frist
   * hinaus liegen, ohne dass jemand eine `loeschsperre` mit Grund gesetzt hat
   * (REC-07).
   */
  it('auch `aufbewahrung_bis` laesst sich nicht verschieben', async () => {
    const konto = await legeKontoAn(f.reinigung, 'admin');
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: konto, portal: 'intern' as const, readonly: false,
    };
    await expect(alsApp(sitzung, (tx) => tx.unsafe(
      `update bewerbung set aufbewahrung_bis = app.berlin_heute() + 9999
        where id = $1::uuid`, [bewerbungId])))
      .rejects.toThrow();
  });

  /**
   * **Der Weg über die Entscheidung geht weiter** — sonst wäre der Riegel
   * ein Verbot statt einer Bahn. Der Nachzug hängt seit 0168 an einem Definer
   * (`app.entscheidung_zieht_bewerbung_nach`), damit `cse_app` die Erlaubnis
   * nicht selbst braucht.
   */
  it('aber eine Entscheidung zieht den Status nach', async () => {
    const konto = await legeKontoAn(f.reinigung, 'admin');
    const { bewerbungId } = await bewerbungAnlegen(f.reinigung, 30);
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: konto, portal: 'intern' as const, readonly: false,
    };
    await alsApp(sitzung, (tx) => tx.unsafe(
      `insert into einstellungsentscheidung
         (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
       values ($1::uuid, $2::uuid, 'eingestellt', 'Probe', $3::uuid)`,
      [f.reinigung, bewerbungId, konto]));

    const [b] = (await alsRolle('', (tx) => tx.unsafe(
      `select status::text as status from bewerbung where id = $1::uuid`,
      [bewerbungId]))) as unknown as { status: string }[];
    expect(b!.status).toBe('eingestellt');
  });
});

/**
 * **Die Frist, die Daten vernichtet, laeuft nach der BERLINER Uhr**
 * (Invariante 2, K-11, REC-07, LEG-11).
 *
 * `nimmBewerbungAn` stellte die Frist mit `current_date` — dem Kalendertag der
 * Datenbanksitzung, und die laeuft in UTC. Der Loeschlauf vergleicht dagegen
 * mit `app.berlin_heute()`. Zwischen 00:00 und 02:00 Berliner Zeit sind das
 * ZWEI VERSCHIEDENE Tage: die Bewerbung bekam eine Frist, die einen Tag zu
 * frueh ablaeuft, und wurde einen Tag zu frueh geloescht.
 *
 * Der Fall stellt die Sitzung ausdruecklich auf UTC — genau die Lage im
 * Betrieb — und verlangt, dass die Frist trotzdem vom Berliner Tag aus
 * zaehlt. Mit `current_date` faellt er in den zwei Nachtstunden; mit
 * `app.berlin_heute()` zu jeder Stunde des Jahres.
 */
describe('die Aufbewahrungsfrist zaehlt vom Berliner Kalendertag (Invariante 2)', () => {
  let f: Fixtur;
  beforeEach(async () => { f = await seed(); });

  /**
   * **Der Fall sucht sich die Zeitzone, in der es weh tut.**
   *
   * `current_date` ist der Kalendertag der SITZUNG. Ob er von Berlins Tag
   * abweicht, haengt an der Stunde, in der die Pruefung laeuft — ein Fall,
   * der um 12 Uhr mittags gruen ist und um 1 Uhr nachts rot, ist kein Fall,
   * sondern ein Wuerfel. Er waehlt deshalb ZUR LAUFZEIT eine Zone, deren
   * Datum jetzt gerade ein anderes ist als Berlins: `Etc/GMT-14` (UTC+14)
   * liegt 12–13 Stunden vor Berlin, `Etc/GMT+12` 13–14 Stunden dahinter —
   * zusammen decken sie jede Stunde des Tages ab, und mindestens eine der
   * beiden weicht immer ab.
   *
   * Mit `current_date` faellt er dann zuverlaessig; mit `app.berlin_heute()`
   * haelt er zu jeder Stunde des Jahres.
   */
  it('die Frist zaehlt ab dem Berliner Heute — in einer Sitzung mit fremdem Datum', async () => {
    const konto = await legeKontoAn(f.reinigung, 'admin');
    const sitzung = {
      scope: 'mandant' as const, mandantId: f.reinigung,
      benutzerId: konto, portal: 'intern' as const, readonly: false,
    };
    const [zeile] = (await alsApp(sitzung, async (tx: postgres.TransactionSql) => {
      const abweichende = (await tx.unsafe(
        `select z as zone
           from unnest(array['Etc/GMT-14', 'Etc/GMT+12']) as z
          where (now() at time zone z)::date <> app.berlin_heute()
          limit 1`)) as unknown as { zone: string }[];
      const zone = abweichende[0]?.zone;
      expect(zone, 'keine der beiden Zonen weicht ab — die Auswahl stimmt nicht')
        .toBeTypeOf('string');
      await tx.unsafe(`set local timezone to '${zone as string}'`);

      const kontext = {
        aktiverMandantId: f.reinigung,
        benutzerId: konto,
        abfrage: async <T,>(a: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(a, w as never[])) as unknown as readonly T[],
        schreibe: async (a: string, w: readonly unknown[] = []) => {
          await tx.unsafe(a, w as never[]);
        },
      } as unknown as SchreibKontext;
      const id = await nimmBewerbungAn(kontext, {
        stelleId: null, name: 'Nachtbewerbung', email: 'nacht@example.org',
        telefon: null, nachricht: null,
      });
      /*
       * Die Zahl der Tage kommt aus derselben Einstellung, die der Dienst
       * gefragt hat (O-373) — sie hier zu wiederholen hiesse, den Fall an
       * einem Wert zu messen, den er selbst gesetzt hat.
       */
      const tage = await aufbewahrungTage(kontext);
      return tx.unsafe(
        `select aufbewahrung_bis::text as bis,
                (app.berlin_heute() + ($2::int || ' days')::interval)::date::text as soll,
                (current_date + ($2::int || ' days')::interval)::date::text as falsch
           from bewerbung where id = $1::uuid`, [id, tage]);
    })) as unknown as { bis: string; soll: string; falsch: string }[];

    expect(zeile!.bis).toBe(zeile!.soll);
    /*
     * Und die Gegenprobe: der Fall misst wirklich einen Unterschied. Waeren
     * beide Tage gleich, bewiese das Obige nichts.
     */
    expect(zeile!.soll).not.toBe(zeile!.falsch);
  });
});
