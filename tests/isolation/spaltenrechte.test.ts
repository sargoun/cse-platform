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
