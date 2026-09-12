/**
 * Die eine Abfrage des Cron-Eingangs — gegen das ECHTE Schema.
 *
 * Der erste Entwurf schrieb `where aktiv = true`. Diese Spalte gibt es nicht:
 * `mandant` fuehrt seit 0001 `archiviert_am timestamptz`, und NULL heisst „in
 * Betrieb". Aufgefallen waere das beim ersten Nachtlauf, mit
 * „column aktiv does not exist", um drei Uhr morgens — und `je_mandant`
 * heisst, dass DANN der Dienstplan aller vier Gesellschaften ausfaellt.
 *
 * Eine Abfrage, die nur im Kopf geprueft ist, ist nicht geprueft. Deshalb
 * steht sie in einer eigenen Funktion und dieser Fall daneben.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { aktiveMandanten } from '../../src/server/jobs/mandanten.js';

let f: Fixtur;

beforeEach(async () => {
  f = await seed();
});
afterAll(schliessen);

describe('welche Gesellschaften ein je_mandant-Lauf bearbeitet', () => {
  it('alle vier — und die Abfrage laeuft ueberhaupt', async () => {
    const ids = await aktiveMandanten(sql);
    expect(ids).toHaveLength(4);
    expect([...ids].sort()).toEqual(
      [f.reinigung, f.security, f.bau, f.operations].sort());
  });

  it('eine archivierte Gesellschaft bekommt keinen Lauf mehr', async () => {
    await sql.unsafe(
      `update mandant set archiviert_am = now() where id = $1`, [f.operations]);
    const ids = await aktiveMandanten(sql);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(f.operations);
  });

  /**
   * Die Reihenfolge ist keine Schoenheit: sie entscheidet, in welcher
   * Reihenfolge `job_lauf_mandant` die Ergebnisse traegt, und eine Liste, die
   * sich bei jedem Lauf anders sortiert, laesst sich zwischen zwei Naechten
   * nicht vergleichen.
   */
  it('und immer in derselben Reihenfolge', async () => {
    expect(await aktiveMandanten(sql)).toEqual(await aktiveMandanten(sql));
  });
});
