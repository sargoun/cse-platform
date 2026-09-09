/**
 * Ein Lesekontext fuer die ENTWICKLUNGSFLAECHEN — und nur fuer sie.
 *
 * **Warum es ihn gibt.** Die Kennzahlen (PR 18) sind fertig, die angemeldete
 * Portal-Shell kommt mit PR 19/20. Ohne einen Kontext dazwischen liesse sich
 * bis dahin keine einzige Kachel ansehen, und "es ist gebaut, man sieht es
 * nur nicht" ist keine Zusage, die jemand pruefen kann.
 *
 * **Warum er gefaehrlich waere, wenn er bliebe.** Er bindet den Super-Admin
 * ohne Anmeldung. Deshalb zwei Sperren, nicht eine:
 *
 *  1. `devFlaechenAn()` — ohne `CSE_DEV_FLAECHEN=1` wirft er. In einem
 *     Deployment ist der Schalter nicht gesetzt.
 *  2. Er laeuft `readonly = on`. Selbst wenn jemand die erste Sperre umgeht,
 *     kann er nichts aendern: K-03 verlangt `not app.ist_readonly()` in jeder
 *     `WITH CHECK`.
 *
 * Er verschwindet mit PR 20, wenn die echte Anmeldung steht.
 */
import { devFlaechenAn } from '../../lib/dev-flaechen.js';
import type { LeseKontext, Transaktion } from './index.js';

export class DevFlaecheAusFehler extends Error {
  constructor() {
    super(
      'Der Entwicklungskontext ist ohne CSE_DEV_FLAECHEN=1 nicht verfügbar. '
      + 'Er bindet einen Super-Admin ohne Anmeldung — das gehört in kein '
      + 'Deployment.',
    );
    this.name = 'DevFlaecheAusFehler';
  }
}

export class KeinAdminFehler extends Error {
  constructor() {
    super('Kein Super-Admin gefunden. `pnpm db:seed` legt ihn an.');
    this.name = 'KeinAdminFehler';
  }
}

/**
 * Liest als der geseedete Super-Admin, in genau einem Bereich — oder in der
 * Gruppenansicht ueber alle, wenn `mandantId` null ist.
 */
export async function withDevAdmin<T>(
  tx: Transaktion,
  mandantId: string | null,
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  if (!devFlaechenAn()) throw new DevFlaecheAusFehler();

  /**
   * Die beiden Nachschlagevorgaenge laufen VOR `set local role cse_app`.
   *
   * Als `cse_app` saehen sie nichts: `benutzer` und `mandant` tragen RLS, und
   * ohne gebundene Sitzung schliesst K-04 fail-closed — `select count(*) from
   * benutzer` antwortet 0. Der Kontext braucht aber genau diese Zeilen, um zu
   * wissen, WEN er binden soll. Erst nachschlagen, dann binden; ab dem
   * Rollenwechsel liest jede weitere Abfrage unter RLS.
   *
   * Der Preis: dieser Bootstrap liest mit den Rechten der Verbindung. Genau
   * deshalb ist der Kontext hinter `CSE_DEV_FLAECHEN` verriegelt und
   * verschwindet mit PR 20 — eine angemeldete Sitzung braucht ihn nicht, weil
   * sie ihren Benutzer schon kennt.
   */
  const [admin] = (await tx.unsafe(
    `select b.id from benutzer b
       join rolle r on r.id = b.globale_rolle_id
      where r.schluessel = 'super_admin' and b.status = 'aktiv'
      limit 1`,
  )) as { id: string }[];
  if (admin === undefined) throw new KeinAdminFehler();

  const [bereiche] = (await tx.unsafe(
    `select coalesce(array_agg(id), '{}') as ids from mandant where archiviert_am is null`,
  )) as { ids: readonly string[] }[];
  const alle = bereiche?.ids ?? [];
  const mandantIds = mandantId === null ? alle : [mandantId];

  await tx.unsafe(`set local role cse_app`);
  const setze = async (name: string, wert: string): Promise<void> => {
    await tx.unsafe(`select set_config($1, $2, true)`, [name, wert]);
  };

  await setze('app.scope', mandantId === null ? 'gruppe' : 'mandant');
  await setze('app.mandant_id', mandantId ?? '');
  await setze('app.mandant_ids', mandantIds.join(','));
  await setze('app.benutzer_id', admin.id);
  await setze('app.person_id', '');
  // Der Super-Admin traegt `benutzer_2fa_pflicht`; Rechte mit `erfordert_2fa`
  // blieben sonst still leer, und die Kachel zeigte 0 statt eines Fehlers.
  await setze('app.aal', 'aal2');
  await setze('app.portal', 'intern');
  await setze('app.readonly', 'on');
  await setze('app.sitzung_id', '');
  await setze('app.akteur_typ', 'mensch');

  return fn({
    scope: mandantId === null ? 'gruppe' : 'mandant',
    portal: 'intern',
    benutzerId: admin.id,
    aktiverMandantId: mandantId,
    mandantIds,
    abfrage: async <R,>(sql: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(sql, werte)) as readonly R[],
  });
}
