/**
 * Eine Sitzung wie im Portal — `cse_app` mit gebundenem Mandanten.
 *
 * Der Seed laeuft sonst als Eigentuemer, und der sieht alles. Was er ueber
 * einen DIENST schreibt, soll aber genau das durchlaufen, was ein Mensch im
 * Portal durchlaeuft: `app.hat_recht`, die Policies, die Definer-Funktionen.
 * Als Eigentuemer geprueft hiesse: nicht geprueft — und ein Seed, der die Tore
 * umgeht, erzeugt Zeilen, die es im Betrieb nie geben koennte.
 *
 * Die Funktion stand zuerst in `zeit.ts`; mit dem zweiten Aufrufer
 * (`konto.ts`) waeren es zwei Fassungen desselben Sitzungsaufbaus geworden,
 * und die zweite haette irgendwann `app.readonly` vergessen.
 */
import type postgres from 'postgres';
import type { SchreibKontext } from '../../kontext/index.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export async function alsPortalSitzung<T>(
  sql: Sql, mandantId: string, benutzerId: string,
  fn: (kontext: SchreibKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    const setze = async (name: string, wert: string): Promise<void> => {
      await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
    };
    await setze('app.scope', 'mandant');
    await setze('app.mandant_id', mandantId);
    await setze('app.mandant_ids', mandantId);
    await setze('app.benutzer_id', benutzerId);
    await setze('app.portal', 'intern');
    await setze('app.readonly', 'off');
    await setze('app.akteur_typ', 'mensch');
    const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[];
    return fn({
      scope: 'mandant', portal: 'intern', benutzerId,
      aktiverMandantId: mandantId, mandantIds: [mandantId],
      abfrage, schreibe: abfrage,
    });
  }) as Promise<T>;
}
