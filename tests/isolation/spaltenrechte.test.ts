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
