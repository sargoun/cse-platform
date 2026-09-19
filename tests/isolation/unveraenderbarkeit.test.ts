/**
 * PR 4 acceptance (1)–(5) — invariant 8, SEC-A9, LEG-01.
 *
 * All five run against a real Postgres with FORCE RLS, because every one of
 * them is a claim about the database rather than about the code that talks to
 * it. A mock would prove that the mock refuses a delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { AUDITIERT, KEIN_HARD_DELETE, SOFT_DELETE } from '../../src/server/db/schema/rls.js';
import { baueSelect, loeschPraedikat, SoftDeleteFehler } from '../../src/server/db/soft-delete.js';

let f: Fixtur;
beforeAll(async () => {
  f = await seed();
});
afterAll(schliessen);

async function zaehle(sql_: string, werte: readonly unknown[] = []): Promise<number> {
  const [r] = await sql.unsafe<{ n: string }[]>(sql_, werte as never[]);
  return Number(r!.n);
}

describe('(1) DELETE on audit_log fails at the database layer — for every role', () => {
  /**
   * A `BEFORE DELETE` trigger is per ROW, so it has nothing to fire on in an
   * empty table and `DELETE FROM audit_log` there succeeds trivially — having
   * deleted nothing. That is not a hole, but it does mean these assertions are
   * only meaningful with a row present, so one is written first.
   *
   * The TRUNCATE trigger below is per STATEMENT and fires either way, which is
   * the difference that makes it worth having as well.
   */
  beforeAll(async () => {
    await sql.unsafe(`select app.protokolliere('test.marke','probe','1',null,null,$1)`, [
      f.reinigung,
    ]);
  });

  /**
   * The three roles fail for three different reasons, and the reasons are the
   * point. Asserting only "it throws" would still pass on the day the trigger
   * is dropped and only the missing grant is left, or the day a grant is added
   * and only the trigger is left.
   */
  it('cse_app: no DELETE privilege at all', async () => {
    await expect(
      alsRolle('cse_app', (tx) => tx.unsafe(`delete from audit_log`)),
    ).rejects.toThrow(/permission denied|berechtigung/iu);
  });

  it('cse_job: no DELETE privilege either — a nightly job is not an exception', async () => {
    await expect(
      alsRolle('cse_job', (tx) => tx.unsafe(`delete from audit_log`)),
    ).rejects.toThrow(/permission denied|berechtigung/iu);
  });

  it('the owner, holding every privilege and bypassing RLS: the trigger raises', async () => {
    await expect(
      alsRolle('', (tx) => tx.unsafe(`delete from audit_log`)),
    ).rejects.toThrow(/Hard delete auf public\.audit_log ist gesperrt/u);
  });

  /**
   * **Seit `0204` weist Postgres die schlichte Form schon vorher ab.**
   * `kern.audit_kettenglied.audit_id` traegt einen Fremdschluessel auf
   * `audit_log`, und `heap_truncate_check_FKs` laeuft VOR den
   * `before truncate`-Ausloesern. Die schlichte Form scheitert deshalb an der
   * Datenbank statt am Riegel — der Riegel ist damit nicht schwaecher,
   * sondern doppelt; nur die Meldung gehoert jetzt jemand anderem.
   *
   * Der Fall wird deshalb FORTGESCHRIEBEN und nicht aufgeweicht. Seine Zusage
   * ist „TRUNCATE kommt nicht durch, und der Ausloeser ist es, der haelt" —
   * und die beiden Formen, die am Fremdschluessel vorbeikommen, beweisen
   * genau das. Ohne sie bewiese diese Datei ab `0204` nur noch, dass es
   * einen Fremdschluessel gibt: faellt der eines Tages, faellt mit ihm
   * lautlos die ganze Zusage.
   */
  it('TRUNCATE is a hard delete too, and fires no row trigger — so a statement trigger blocks it', async () => {
    // Die schlichte Form: der Fremdschluessel aus 0204 faengt sie zuerst ab.
    await expect(
      alsRolle('', (tx) => tx.unsafe(`truncate audit_log`)),
    ).rejects.toThrow(/cannot truncate a table referenced in a foreign key constraint/u);

    // CASCADE nimmt das Kettenbuch mit und laeuft an der Pruefung vorbei —
    // hier haelt der Ausloeser, und nur er.
    await expect(
      alsRolle('', (tx) => tx.unsafe(`truncate audit_log cascade`)),
    ).rejects.toThrow(/Hard delete auf public\.audit_log ist gesperrt/u);

    // Und dieselbe Luecke von Hand: beide Tabellen in EINER Anweisung.
    await expect(
      alsRolle('', (tx) => tx.unsafe(`truncate audit_log, kern.audit_kettenglied`)),
    ).rejects.toThrow(/Hard delete auf public\.audit_log ist gesperrt/u);
  });

  it('no application role holds DELETE or TRUNCATE on ANY registered table', async () => {
    const rollen = ['cse_app', 'cse_anon', 'cse_checkin', 'cse_job'];
    const treffer = await sql.unsafe<{ grantee: string; table_name: string; privilege_type: string }[]>(
      `select grantee, table_name, privilege_type
         from information_schema.table_privileges
        where table_schema = 'public'
          and privilege_type in ('DELETE','TRUNCATE')
          and grantee = any($1)
          and table_name = any($2)`,
      [rollen, KEIN_HARD_DELETE.map((l) => l.tabelle)] as never[],
    );
    expect(treffer).toEqual([]);
  });

  it('the row survives — a blocked delete is not a delete that reported an error', async () => {
    const vorher = await zaehle(`select count(*) n from audit_log`);
    expect(vorher).toBeGreaterThan(0);
    await expect(alsRolle('', (tx) => tx.unsafe(`delete from audit_log`))).rejects.toThrow();
    expect(await zaehle(`select count(*) n from audit_log`)).toBe(vorher);
  });
});

describe('(2) a soft-deleted row leaves the finder and stays in the table', () => {
  it('the default finder excludes it; a raw count still sees it', async () => {
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Test','Weg') returning id`,
    );
    const id = neu!.id;

    const sichtbar = async (): Promise<number> =>
      zaehle(`select count(*) n from (${baueSelect('person', 'id')}) t where t.id = $1`, [id]);

    expect(await sichtbar()).toBe(1);
    await sql.unsafe(`update person set geloescht_am = now() where id = $1`, [id]);

    expect(await sichtbar()).toBe(0);
    // Still there. Invariant 8 keeps the row; the finder keeps it out of sight.
    expect(await zaehle(`select count(*) n from person where id = $1`, [id])).toBe(1);
    // And reachable when the caller says so, which takes typing 'alle'.
    expect(
      await zaehle(
        `select count(*) n from (${baueSelect('person', 'id', { sicht: 'alle' })}) t where t.id = $1`,
        [id],
      ),
    ).toBe(1);
  });

  it('omitting the visibility argument yields the SAFE reading, never everything', () => {
    expect(loeschPraedikat('person')).toBe('geloescht_am is null');
    expect(loeschPraedikat('person', 'alle')).toBe('true');
  });

  it('a table registered as archiv or append has no geloescht_am, and the finder refuses it', () => {
    // K-16: "a soft-delete column on a table that must never be deleted is an
    // invitation". So `audit_log` must fail here, loudly, at the call site.
    expect(() => loeschPraedikat('audit_log')).toThrow(SoftDeleteFehler);
    expect(() => loeschPraedikat('mandant')).toThrow(/als `archiv` registriert/u);
    /**
     * Ein NAME, den keine Registerzeile je tragen wird — und ausdruecklich
     * keine echte Tabelle.
     *
     * Hier stand `rechnung`, solange es die Tabelle nicht gab. Mit PR 46 kam
     * sie, wurde als `archiv` registriert, und der Fall pruefte ploetzlich
     * den falschen Zweig: die Meldung lautete „ist als archiv registriert"
     * statt „steht nicht im Register". Der Test prueft den ZWEIG, nicht eine
     * bestimmte Tabelle; ein erfundener Name haelt das aus.
     */
    expect(() => loeschPraedikat('tabelle_die_es_nicht_gibt'))
      .toThrow(/steht nicht in KEIN_HARD_DELETE/u);
    /*
     * `dokument` kam mit PR 9 dazu, `vergabemappe` mit PR 70 — die Liste ist
     * ABGELEITET aus `KEIN_HARD_DELETE`, nicht gepflegt. Sie hier festzunageln
     * ist die Sperrklinke: eine neue weiche Loeschung faellt auf, statt sich
     * einzuschleichen. `vergabemappe` traegt S4, weil sie der Beleg einer
     * Abgabe ist (D-492) — die Zeilen ihrer Pruefliste bewusst nicht.
     *
     * `team`, `aufgabe` und `nachricht` kamen mit `0230`/`0231` dazu. Die
     * Sperrklinke soll AUFFALLEN lassen, nicht verbieten: sie darf wachsen,
     * wenn das Neue richtig ist. Fuer diese drei ist es nachgemessen und
     * nicht angenommen — jede traegt `geloescht_am` und `geloescht_von` (der
     * Fall darunter prueft die Spalte gegen die Datenbank), und jede hat
     * einen Grund, der zur weichen Loeschung passt: ein aufgeloestes `team`
     * ist die Antwort darauf, wer eine Aufgabe damals bekam
     * (`aufgabe.zugewiesen_team_id` zeigt darauf); eine `aufgabe` ist der
     * Nachweis, dass ein Waechterbefund offen war; eine `nachricht` IST der
     * Nachweis der Rechtsgrundlage, auf der jemand kontaktiert wurde (§7 UWG,
     * LEG-08). Keine der drei darf verschwinden, und keine ist ein Archiv.
     */
    expect(SOFT_DELETE).toEqual([
      'dokument', 'person', 'anstellung', 'vergabemappe', 'team', 'aufgabe', 'nachricht',
    ]);
    // Und der Finder greift auf jeder von ihnen — die Liste ist nicht bloss
    // eine Behauptung ueber das Register.
    for (const tabelle of SOFT_DELETE) {
      expect(loeschPraedikat(tabelle), tabelle).toBe('geloescht_am is null');
    }
  });

  /**
   * Die Gegenprobe in der DATENBANK: eine Tabelle, die `art: 'soft'` traegt,
   * aber kein `geloescht_am` hat, laesst jeden Finder auf eine unbekannte
   * Spalte laufen — und zwar erst im Betrieb, an der ersten Liste, die sie
   * anfasst. Der Fall darueber prueft das Register gegen sich selbst; dieser
   * prueft es gegen das Schema.
   */
  it('jede als `soft` registrierte Tabelle traegt geloescht_am und geloescht_von', async () => {
    const spalten = await sql.unsafe<{ table_name: string; column_name: string }[]>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and column_name in ('geloescht_am', 'geloescht_von')`,
      [SOFT_DELETE] as never[],
    );
    for (const tabelle of SOFT_DELETE) {
      const hat = spalten.filter((s) => s.table_name === tabelle).map((s) => s.column_name).sort();
      expect(hat, tabelle).toEqual(['geloescht_am', 'geloescht_von']);
    }
  });

  it('an injected alias is refused rather than pasted into SQL', () => {
    expect(() => loeschPraedikat('person', 'aktiv', 'p; drop table person --')).toThrow(
      SoftDeleteFehler,
    );
    expect(loeschPraedikat('person', 'aktiv', 'p')).toBe('p.geloescht_am is null');
  });
});

describe('(3) one UPDATE writes exactly one audit row, differing only in the changed column', () => {
  it('records the change and nothing else', async () => {
    await sql.unsafe(`update person set telefon = '+49 30 111' where id = $1`, [f.jonas]);

    const zeilen = await sql.unsafe<
      { aktion: string; vorher: Record<string, unknown>; nachher: Record<string, unknown>;
        geaendert_felder: string[]; akteur_typ: string }[]
    >(`select aktion, vorher, nachher, geaendert_felder, akteur_typ
         from audit_log where objekt_typ = 'person' and objekt_id = $1`, [f.jonas]);

    expect(zeilen).toHaveLength(1);
    const z = zeilen[0]!;
    expect(z.aktion).toBe('person.update');

    // The only real difference. `geaendert_am` moves on every update by
    // construction (S2), so it is expected company — and it is asserted here
    // rather than filtered out, because a diff that quietly drops columns is
    // how an audit trail stops being one.
    const unterschiede = Object.keys(z.nachher).filter(
      (k) => JSON.stringify(z.vorher[k]) !== JSON.stringify(z.nachher[k]),
    );
    expect(unterschiede.sort()).toEqual(['geaendert_am', 'telefon']);
    expect(z.geaendert_felder.sort()).toEqual(['geaendert_am', 'telefon']);
    expect(z.vorher['telefon']).toBeNull();
    expect(z.nachher['telefon']).toBe('+49 30 111');
  });

  it('an INSERT and a soft delete are each one row too, and the actor kind is recorded (SEC-A9)', async () => {
    const [neu] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Audit','Probe') returning id`,
    );
    const id = neu!.id;
    await sql.unsafe(`update person set geloescht_am = now() where id = $1`, [id]);

    const zeilen = await sql.unsafe<{ aktion: string; akteur_typ: string; ebene: string }[]>(
      `select aktion, akteur_typ, ebene from audit_log
        where objekt_typ = 'person' and objekt_id = $1 order by id`,
      [id],
    );
    expect(zeilen.map((z) => z.aktion)).toEqual(['person.insert', 'person.update']);
    // No session GUC is set on this connection, so the actor falls back to
    // `system` — fail-closed, and never to `mensch` (K-02).
    expect(zeilen.every((z) => z.akteur_typ === 'system')).toBe(true);
    // `person` carries no mandant_id and no mandant is active: K-16(d).
    expect(zeilen.every((z) => z.ebene === 'plattform')).toBe(true);
  });

  it('the audit payload does NOT hand the wage rate back after K-05 withheld it', async () => {
    // 05-API-KARTE §B: sensitive values are RESTRICTED, not omitted — the rate
    // is written so a wage dispute can be reconstructed, and the read is what
    // is gated. A table-wide grant on audit_log would undo K-05 one statement
    // after the column grant on `anstellung` established it.
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.column_privileges
        where table_name = 'audit_log' and grantee = 'cse_app' and privilege_type = 'SELECT'`,
    );
    const namen = spalten.map((s) => s.column_name);
    expect(namen).not.toContain('vorher');
    expect(namen).not.toContain('nachher');
    expect(namen).toContain('geaendert_felder');   // that it changed stays readable

    await expect(
      alsApp({ scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false }, (tx) =>
        tx.unsafe(`select vorher from audit_log limit 1`),
      ),
    ).rejects.toThrow(/permission denied|berechtigung/iu);

    // And the accessor that CAN return it denies everyone while the rights
    // catalogue is unseeded (K-19, D-17) — silently, and by returning nothing.
    const durch = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select * from app.audit_nutzlast_lesen((select min(id) from audit_log))`),
    );
    expect(durch).toEqual([]);
  });
});

describe('(4) the registry and the database agree — in both directions', () => {
  it('every registered table carries both triggers', async () => {
    const trigger = await sql.unsafe<{ tabelle: string; name: string }[]>(
      `select c.relname tabelle, t.tgname name
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname = 'public'`,
    );
    for (const { tabelle } of KEIN_HARD_DELETE) {
      const namen = trigger.filter((t) => t.tabelle === tabelle).map((t) => t.name);
      expect(namen, tabelle).toContain(`trg_${tabelle}_kein_hard_delete`);
      expect(namen, tabelle).toContain(`trg_${tabelle}_kein_truncate`);
    }
  });

  it('and no table carries the trigger without being registered — the registry cannot go stale', async () => {
    const gesperrt = await sql.unsafe<{ tabelle: string }[]>(
      `select distinct c.relname tabelle
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname = 'public'
          and t.tgfoid = 'kern.verhindere_loeschung'::regproc`,
    );
    expect(gesperrt.map((g) => g.tabelle).sort()).toEqual(
      [...KEIN_HARD_DELETE.map((l) => l.tabelle)].sort(),
    );
  });

  it('every audited table carries the audit trigger, and audit_log audits nothing', async () => {
    const auditiert = await sql.unsafe<{ tabelle: string }[]>(
      `select distinct c.relname tabelle
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname = 'public'
          and t.tgfoid = 'kern.protokolliere_aenderung'::regproc`,
    );
    expect(auditiert.map((a) => a.tabelle).sort()).toEqual(
      AUDITIERT.map((a) => a.tabelle).sort(),
    );
    // A table that audits itself recurses; audit_log has one writer anyway.
    expect(AUDITIERT.map((a) => a.tabelle)).not.toContain('audit_log');
  });

  it('geaendert_am is set by the database, never by the caller (S2)', async () => {
    const alt = new Date('2000-01-01T00:00:00Z').toISOString();
    await sql.unsafe(`update person set geaendert_am = $1, telefon = '+49 30 222' where id = $2`, [
      alt,
      f.fatima,
    ]);
    const [z] = await sql.unsafe<{ geaendert_am: Date }[]>(
      `select geaendert_am from person where id = $1`,
      [f.fatima],
    );
    expect(new Date(z!.geaendert_am).getUTCFullYear()).toBeGreaterThan(2000);
  });
});

describe('(5) the three audit GUCs are audit-only — no policy may name them (K-02)', () => {
  /**
   * A policy keyed on `app.akteur_typ` would let the caller widen its own
   * access by declaring itself an agent. The GUCs exist so `audit_log` can
   * record who acted, and for nothing else. This scans every policy in the
   * database rather than the migration text, so a policy added from anywhere
   * is covered.
   */
  it('no RLS policy references app.akteur_typ, app.akteur_id or app.ip', async () => {
    const treffer = await sql.unsafe<{ tabelle: string; policy: string; ausdruck: string }[]>(
      `select c.relname tabelle, p.polname policy,
              coalesce(pg_get_expr(p.polqual, p.polrelid), '')
              || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ausdruck
         from pg_policy p join pg_class c on c.oid = p.polrelid`,
    );
    const verboten = /app\.akteur_typ|app\.akteur_id|app\.ip\b/u;
    expect(treffer.filter((t) => verboten.test(t.ausdruck))).toEqual([]);
    // The scan must actually be looking at something.
    expect(treffer.length).toBeGreaterThan(5);
  });

  it('nor does any function that a policy calls — the indirection is the loophole', async () => {
    const funktionen = await sql.unsafe<{ name: string; quelle: string }[]>(
      `select n.nspname || '.' || p.proname name, p.prosrc quelle
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('app','kern')`,
    );
    const verboten = /app\.akteur_typ|app\.akteur_id|app\.ip\b/u;
    const nennt = funktionen.filter((fn) => verboten.test(fn.quelle)).map((fn) => fn.name);
    // Exactly one function may name them: the audit writer itself.
    expect(nennt.sort()).toEqual(['app.protokolliere']);
  });
});
