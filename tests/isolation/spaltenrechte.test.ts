import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';

afterAll(schliessen);

/**
 * 0089 — die zwei Spalten von `projekt`, die `cse_app` NICHT lesen darf.
 *
 * 03-GEWERKE §14.3 verlangt, dass die Auftragssumme und der
 * Sicherheitseinbehalt eines Bauprojekts nicht an jeder Sitzung haengen, die
 * das Projekt sehen darf. Umgesetzt ist das als Spalten-GRANT (K-05): `select`
 * auf der Tabelle entzogen, eine erschoepfende Spaltenliste zurueckgegeben.
 *
 * **Gepruefte hat das bisher niemand.** Die Zusicherung existierte nur als
 * Grant in einer Migration — und ein Grant, den keine Pruefung liest, ist beim
 * naechsten `grant select on projekt to cse_app` still wieder weg.
 *
 * **`permission denied`, nicht NULL.** Der Spaltenentzug maskiert nicht, er
 * weist ab. Das ist Absicht (0089:56-57): eine maskierte Zahl sieht aus wie
 * eine Zahl. Eine Pruefung, die auf NULL prueft, faellt hier — und soll es.
 */
describe('K-05 — `projekt`: zwei Spalten sind fuer `cse_app` nicht lesbar', () => {
  for (const spalte of ['auftragssumme_netto_cent', 'sicherheitseinbehalt_bp']) {
    it(`\`${spalte}\` weist ab statt zu maskieren`, async () => {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'projekt', $1, 'SELECT') as ok`,
        [spalte],
      );
      expect(z?.ok, `cse_app darf projekt.${spalte} lesen`).toBe(false);
    });

    it(`\`${spalte}\` bleibt SCHREIBBAR — eine Spalte darf blind befuellt werden`, () => {
      // §11: schreibbar und unlesbar ist ein gueltiger Zustand. Ohne diese
      // Gegenprobe hiesse die Reparatur moeglicherweise „die Spalte ist tot".
      return sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'projekt', $1, 'UPDATE') as ok`,
        [spalte],
      ).then(([z]) => { expect(z?.ok).toBe(true); });
    });
  }

  it('und die uebrigen Spalten sind es sehr wohl', async () => {
    // Sonst liesse sich „zwei Spalten entzogen" nicht von „die Tabelle ist
    // entzogen" unterscheiden.
    for (const spalte of ['id', 'mandant_id', 'nummer', 'bezeichnung', 'status']) {
      const [z] = await sql.unsafe<{ ok: boolean }[]>(
        `select has_column_privilege('cse_app', 'projekt', $1, 'SELECT') as ok`,
        [spalte],
      );
      expect(z?.ok, `cse_app darf projekt.${spalte} nicht lesen`).toBe(true);
    }
  });
});

/**
 * 0094 — `app.arbzg_befund_ueberholen` verlangt den Mandanten, statt ihn im
 * Nachtlauf wegzulassen.
 *
 * **Was offenstand.** Das Praedikat lautete
 * `(v_aufrufer is null or v.mandant_id = v_aufrufer)`. Im Live-Pfad wirkt die
 * Schranke; im Nachtlauf verbindet `cse_job` ohne Mandanten, `v_aufrufer` ist
 * null, und die linke Seite ist wahr — also keine Schranke. Der eigene
 * Kommentar der Funktion sagte „nur im Mandanten des Aufrufers"; fuer den
 * Nachtlauf war das nicht wahr.
 *
 * Aufgefallen waere es erst an einer fremden Kennung in `details.belege` —
 * freiem `jsonb` ohne Fremdschluessel. Dann verschwaende der ArbZG-Befund
 * einer anderen Gesellschaft aus deren Eingang, ohne dass irgendwo etwas
 * meldet.
 */
describe('0094 — der Nachtlauf muss den Mandanten nennen', () => {
  it('die alte Ein-Argument-Form gibt es nicht mehr', async () => {
    /*
     * Sonst bliebe sie neben der neuen stehen und waere weiter aufrufbar —
     * derselbe Fehler wie ein PUBLIC-Grant, der neben einem Rollengrant
     * stehen bleibt.
     */
    const [z] = await sql.unsafe<{ anzahl: string }[]>(`
      select count(*)::text as anzahl
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'arbzg_befund_ueberholen'
         and pg_get_function_identity_arguments(p.oid) = 'uuid[]'`);
    expect(z?.anzahl).toBe('0');
  });

  it('sie gehoert `cse_definer` und PUBLIC darf sie nicht', async () => {
    const [z] = await sql.unsafe<{ eigner: string; oeffentlich: boolean }[]>(`
      select pg_get_userbyid(p.proowner) as eigner,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
               as oeffentlich
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'arbzg_befund_ueberholen'`);
    expect(z?.eigner).toBe('cse_definer');
    expect(z?.oeffentlich).toBe(false);
  });

  /**
   * **Der Nachtpfad laesst sich hier nicht fahren — und genau deshalb gibt es
   * ihn.**
   *
   * Das Tor der Funktion lautet `session_user <> 'cse_job'`. `session_user`
   * ist von `SECURITY DEFINER` UND von `set role` unberuehrt: er nennt die
   * Rolle, die sich wirklich verbunden hat. Die Fixtur verbindet als
   * `postgres` und schaltet mit `set local role` um — `current_user` wechselt,
   * `session_user` nicht. Ein Test, der den Pfad „erreicht" haette, haette
   * damit bewiesen, dass das Tor NICHT haelt.
   *
   * Was sich hier pruefen laesst, ist der Katalog: die alte Form ist weg, die
   * neue gehoert `cse_definer`, PUBLIC haelt nichts, und der Live-Pfad weist
   * einen fremden Mandanten ab. Der Nachtpfad selbst gehoert in eine Pruefung
   * mit echter `cse_job`-Anmeldung — die es hier nicht gibt, weil bisher auch
   * kein Planer den Job faehrt (`src/server/jobs/runner.ts` ist die Mechanik,
   * die Anbindung an Supabase Cron kommt spaeter).
   */
  it('der LIVE-Pfad weist einen fremden Mandanten ab', async () => {
    /*
     * Mit gebundener Sitzung ist `app.aktiver_mandant()` gesetzt. Ein
     * abweichender Parameter heisst dann: der Aufrufer meint eine andere
     * Gesellschaft als die, in der er steht. Still den aktiven zu nehmen
     * verstecke den Widerspruch — die Funktion sagt ihn.
     */
    await expect(sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.mandant_id', $1, true)`,
        ['00000000-0000-0000-0000-0000000000aa']);
      await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
      return tx.unsafe(
        `select app.arbzg_befund_ueberholen(
                  array['00000000-0000-0000-0000-000000000001'::uuid],
                  '00000000-0000-0000-0000-0000000000ff'::uuid)`,
      );
    })).rejects.toThrow(/nicht der aktive|nicht berechtigt/u);
  });
});

/**
 * **Wer aufruft, ist nicht wer sich verbunden hat.**
 *
 * Im Rumpf einer `security definer`-Funktion ist `current_user` ihr
 * EIGENTUEMER. Ruft sie eine zweite Funktion, wird gegen diesen Eigentuemer
 * geprueft — nicht gegen `cse_app`.
 *
 * Das hat 0093 gekostet: der Entzug des PUBLIC-Eintrags war richtig, die
 * Annahme „jede betroffene Funktion traegt ohnehin einen `cse_*`-Grant" war
 * es nicht. `fin.rechnung_nummer_ziehen` gehoert `cse_definer` und ruft
 * `app.protokolliere`, das an `cse_app` vergeben war; gedeckt war
 * `cse_definer` allein durch PUBLIC. Das Festschreiben JEDER Rechnung endete
 * danach mit `permission denied for function protokolliere`.
 *
 * **Warum die Isolationssuite es nicht gefunden hat und diese Pruefung es
 * findet.** Die Fixtur verbindet als `postgres`; ein Superuser unterliegt
 * keiner Rechtepruefung, also laeuft dort auch durch, was fuer `cse_definer`
 * verboten waere. Gefunden hat es die Browsersuite in CI. Diese Pruefung
 * fragt deshalb nicht die Laufzeit, sondern den KATALOG: sie liest die
 * Rumpftexte und vergleicht die Aufrufe gegen die Grants.
 *
 * Sie waechst von selbst mit: jede weitere Funktion, die im Zuge von D-300
 * auf `cse_definer` umgestellt wird, bringt ihre Aufrufe mit.
 */
describe('K-01/K-08 — eine Definer-Funktion darf, was sie aufruft', () => {
  it('jeder `app.*`-Aufruf aus einer `cse_definer`-Funktion ist ihr erlaubt', async () => {
    const fehlend = await sql.unsafe<{ von: string; ruft: string }[]>(`
      with quelle as (
        select n.nspname || '.' || p.proname as von, p.prosrc
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where pg_get_userbyid(p.proowner) = 'cse_definer'
           and n.nspname in ('app', 'kern', 'fin', 'zeit_intern')
      ),
      aufruf as (
        select distinct q.von, m[1] as ruft
          from quelle q,
               regexp_matches(q.prosrc, 'app\\.([a-z_]+)\\s*\\(', 'g') m
      )
      select a.von, a.ruft
        from aufruf a
       where exists (
               -- Nur Funktionen, die es im Schema app wirklich gibt: guc und
               -- Verwandte stehen teils in einem anderen Schema oder sind gar
               -- keine Funktion, und eine fehlende Zeile ist dann kein
               -- Rechteproblem, sondern ein Treffer des Ausdrucks.
               select 1 from pg_proc p2
                 join pg_namespace n2 on n2.oid = p2.pronamespace
                where n2.nspname = 'app' and p2.proname = a.ruft)
         and not exists (
               select 1 from pg_proc p3
                 join pg_namespace n3 on n3.oid = p3.pronamespace
                where n3.nspname = 'app' and p3.proname = a.ruft
                  and has_function_privilege('cse_definer', p3.oid, 'EXECUTE'))
       order by 1, 2`);

    expect(
      fehlend.map((z) => `${z.von} ruft app.${z.ruft}, darf aber nicht`),
    ).toEqual([]);
  });

  it('und die Gegenprobe: der Ausdruck findet ueberhaupt Aufrufe', async () => {
    /*
     * Ohne sie hiesse „nichts fehlt" moeglicherweise „nichts gemessen" — der
     * Fehler, den in diesem Zweig schon neun Merge-Wachen gemacht haben.
     */
    const [z] = await sql.unsafe<{ anzahl: string }[]>(`
      with quelle as (
        select p.prosrc from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where pg_get_userbyid(p.proowner) = 'cse_definer'
           and n.nspname in ('app', 'kern', 'fin', 'zeit_intern')
      )
      select count(*)::text as anzahl
        from quelle q, regexp_matches(q.prosrc, 'app\\.([a-z_]+)\\s*\\(', 'g') m`);
    expect(Number(z?.anzahl)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

/**
 * **Ein Recht ist kein Weg** — die verallgemeinerte Fassung eines Fehlers,
 * der in diesem Zweig dreimal aufgetreten ist.
 *
 *   0096  `grant execute` auf `app.protokolliere`, aber nicht an den
 *         EIGENTUEMER der aufrufenden Definer-Funktion.
 *   0099  `grant insert on benachrichtigung to cse_job` (aus 0011) — und
 *         keine Policy fuer `cse_job` auf einer Tabelle mit `force row level
 *         security`.
 *   0100  `cse_job` musste `benutzer` lesen, um den Empfaenger aufzuloesen,
 *         und hatte weder Spaltenrecht noch Policy.
 *
 * Alle drei sehen im Quelltext nach Absicht aus, und alle drei haetten erst
 * zur Laufzeit gemeldet — zwei davon um drei Uhr nachts, in einem Prozess,
 * dem niemand zusieht. Unter `force row level security` heisst „keine
 * anwendbare Policy" nicht „alles erlaubt", sondern „nichts": das Recht steht
 * im Katalog, die Zeile kommt nie an.
 *
 * Dieser Test faellt beim naechsten Mal, und zwar beim Anlegen der Migration
 * statt beim ersten Lauf.
 */
describe('kein Tabellenrecht ohne Policy (force RLS)', () => {
  it('jede Rolle mit einem Recht auf einer force-RLS-Tabelle hat dort auch eine Policy',
    async () => {
      const luecken = await sql.unsafe<{ rolle: string; tabelle: string; rechte: string }[]>(`
        with rechte as (
          select g.grantee as rolle, g.table_name as tabelle,
                 string_agg(distinct g.privilege_type, ',' order by g.privilege_type) as rechte
            from information_schema.role_table_grants g
            join pg_class c on c.relname = g.table_name
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
           where g.grantee like 'cse\\_%'
             and g.table_schema = 'public'
             and c.relforcerowsecurity
             -- Der Eigentuemer einer Definer-Funktion arbeitet ueber sie und
             -- nicht ueber eigene Policies; K-01 regelt ihn getrennt.
             and g.grantee <> 'cse_definer'
           group by 1, 2
        )
        select r.rolle, r.tabelle, r.rechte
          from rechte r
         where not exists (
               select 1 from pg_policy p
                 join pg_class c2 on c2.oid = p.polrelid
                where c2.relname = r.tabelle
                  and r.rolle::regrole::oid = any(p.polroles))
         order by 1, 2`);

      expect(
        luecken.map((z) => `${z.rolle} hat ${z.rechte} auf ${z.tabelle}, aber keine Policy`),
      ).toEqual([]);
    });

  it('und die Gegenprobe: der Ausdruck sieht ueberhaupt Rechte', async () => {
    const [z] = await sql.unsafe<{ anzahl: string }[]>(`
      select count(*)::text as anzahl
        from information_schema.role_table_grants g
        join pg_class c on c.relname = g.table_name
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
       where g.grantee like 'cse\\_%' and g.table_schema = 'public'
         and c.relforcerowsecurity`);
    expect(Number(z?.anzahl)).toBeGreaterThan(50);
  });
});
