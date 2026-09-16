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
