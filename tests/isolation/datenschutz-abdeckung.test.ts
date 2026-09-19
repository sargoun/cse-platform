import { afterAll, describe, expect, it } from 'vitest';
import { schliessen, sql } from './harness.js';
import { ABDECKUNG as AUSKUNFT_ABDECKUNG }
  from '../../src/server/services/datenschutz/auskunft.js';
import { ABDECKUNG as LOESCHUNG_ABDECKUNG }
  from '../../src/server/services/datenschutz/loeschentscheidung.js';

/**
 * **Die Wache gegen den Befund, der sich sonst mit jeder Migration
 * wiederholt.**
 *
 * Gefunden wurde er zweimal an derselben Stelle: die Art.-15-Auskunft führte
 * für einen `ansprechpartner` DREI Abschnitte, obwohl `ansprechpartner_id` in
 * SIEBEN Tabellen steht — und lieferte die Datei trotzdem mit
 * `vollstaendig = true`, Prüfsumme und dem Wort „Vollständig" an die betroffene
 * Person aus. Die Löschmatrix hatte denselben Zuschnitt und behauptete darüber
 * „N von N entschieden".
 *
 * **Warum gerade diese Prüfung und nicht ein Kommentar.** Beide Dateien
 * schützen sich sorgfältig gegen den Fall „das Recht fehlt" (`gesperrt` bzw.
 * `ungelesen` statt leer). Gegen den Fall „die Tabelle steht nicht in der
 * Liste" kann sich keine Liste selbst schützen: was fehlt, erscheint nirgends.
 * Die einzige Instanz, die die Wahrheit kennt, ist das Schema — also fragt
 * dieser Test das Schema und stellt es gegen die Liste.
 *
 * **Sie fällt bei der nächsten neuen Tabelle**, und das ist der Zweck. Wer eine
 * Tabelle mit `person_id`, `ansprechpartner_id` oder `bewerbung_id` anlegt,
 * entscheidet damit auch, was eine Auskunft und eine Löschentscheidung darüber
 * sagen — hier oder gar nicht. Eine Tabelle darf in `OFFENE_ABSCHNITTE` bzw.
 * `NICHT_IN_DER_MATRIX` stehen; sie darf nur nicht FEHLEN.
 */

afterAll(schliessen);

/**
 * Nur BASE TABLE, keine Sichten.
 *
 * `information_schema.columns` führt Sichten mit, und `zeiteintrag_offen`,
 * `zeiteintrag_ohne_auftrag` und `milog_aufzeichnung` sind welche: sie
 * schneiden Zeilen, die weiter oben schon vollständig stehen. Eine Sicht in
 * die Auskunft aufzunehmen hiesse, dieselben Daten zweimal auszugeben.
 */
async function tabellenMit(spalte: string): Promise<readonly string[]> {
  const zeilen = await sql.unsafe<{ table_name: string }[]>(
    `select c.table_name
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = $1
        and t.table_type = 'BASE TABLE'
      order by 1`, [spalte]);
  return zeilen.map((z) => z.table_name);
}

const SPALTEN = ['person_id', 'ansprechpartner_id', 'bewerbung_id'] as const;

describe('jede Tabelle mit Personenbezug steht in der Art.-15-Auskunft', () => {
  for (const spalte of SPALTEN) {
    it(`${spalte}: keine Tabelle fehlt in ABSCHNITTE plus OFFENE_ABSCHNITTE`, async () => {
      const imSchema = await tabellenMit(spalte);
      expect(imSchema.length).toBeGreaterThan(0);
      const fehlend = imSchema.filter((t) => !AUSKUNFT_ABDECKUNG.has(t));
      expect(
        fehlend,
        'Eine Tabelle mit Personenbezug, die in keinem Abschnitt vorkommt, '
        + 'erscheint in der Auskunft NIRGENDS — und die Datei trägt trotzdem '
        + 'das Wort „Vollständig". Nimm sie als Abschnitt auf, oder als '
        + 'OFFENE_ABSCHNITTE-Zeile mit ihrer offenen Frage.',
      ).toEqual([]);
    });
  }

  it('die Abdeckung nennt keine Tabelle, die es gar nicht gibt', async () => {
    /*
     * Die Gegenrichtung: eine umbenannte oder entfernte Tabelle bliebe sonst
     * als Abschnitt stehen, und die Auskunft behauptete eine Abdeckung, deren
     * `select` beim ersten Aufruf scheitert.
     */
    const vorhanden = new Set(await tabellenVorhanden());
    const tot = [...AUSKUNFT_ABDECKUNG].filter((t) => !vorhanden.has(t));
    expect(tot).toEqual([]);
  });
});

describe('jede Tabelle mit Personenbezug steht in der Löschmatrix', () => {
  for (const spalte of SPALTEN) {
    it(`${spalte}: keine Tabelle fehlt in ORTE plus NICHT_IN_DER_MATRIX`, async () => {
      const imSchema = await tabellenMit(spalte);
      const fehlend = imSchema.filter((t) => !LOESCHUNG_ABDECKUNG.has(t));
      expect(
        fehlend,
        'Die Seite zählt „N von N entschieden". Fehlt eine Tabelle in ORTE, '
        + 'ist das N eine Aussage über die Liste und nicht über den Bestand.',
      ).toEqual([]);
    });
  }

  it('die Abdeckung nennt keine Tabelle, die es gar nicht gibt', async () => {
    const vorhanden = new Set(await tabellenVorhanden());
    const tot = [...LOESCHUNG_ABDECKUNG].filter((t) => !vorhanden.has(t));
    expect(tot).toEqual([]);
  });
});

async function tabellenVorhanden(): Promise<readonly string[]> {
  const zeilen = await sql.unsafe<{ table_name: string }[]>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`);
  return zeilen.map((z) => z.table_name);
}
