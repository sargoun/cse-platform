import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktiveRolle, aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { pruefeZugang, rechtepruefer, PORTAL_START } from '@/server/auth/zugang';
import { leisteFuer, type LeistenSchluessel } from '@/server/registry/tableiste';
import type { Sitzung } from '@/server/kontext/index';

/**
 * Was jede Portalseite zuerst tut: Sitzung holen, Tor fragen, Antwort befolgen.
 *
 * **An EINER Stelle**, weil AUT-04 verlangt, dass die Autorisierung im Layout
 * UND im Dienst laeuft — und weil eine je Seite kopierte Pruefung die Seite
 * vergisst, die als zwoelfte dazukommt. Was hier zurueckkommt, ist entweder
 * eine Sitzung mit Rolle und Leiste oder `null`, und `null` heisst genau eine
 * Sache: nicht angemeldet.
 */
export interface PortalZugang {
  readonly sitzung: Sitzung;
  readonly rolle: string | null;
  readonly leiste: LeistenSchluessel;
}

export async function portalZugang(pfad: string): Promise<PortalZugang | null> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return null;

  const entscheidung = await (db().begin(async (tx: postgres.TransactionSql) => {
    await tx.unsafe(`set local role cse_app`);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [sitzung.benutzerId]);
    await tx.unsafe(`select set_config('app.scope', $1, true)`, [sitzung.ansicht]);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`,
      [sitzung.aktiverMandantId ?? '']);
    await tx.unsafe(`select set_config('app.aal', $1, true)`, [sitzung.aal]);
    await tx.unsafe(`select set_config('app.portal', $1, true)`, [sitzung.portal]);
    return pruefeZugang(pfad, sitzung, rechtepruefer(
      async <T,>(q: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(q, w as never[])) as readonly T[],
    ));
  }) as Promise<Awaited<ReturnType<typeof pruefeZugang>>>);

  if (entscheidung.art === 'anmeldung') return null;
  if (entscheidung.art === 'falsches_portal') {
    /**
     * Die K-04-Decke: eine Arbeiterin, die `/portal/reinigung` tippt, landet
     * in ihrem Portal — nicht auf einem 404, das sie ratlos zurücklässt.
     *
     * Die Ziele stehen als LITERALE da und nicht als `entscheidung.ziel`.
     * `typedRoutes` prüft `redirect()` gegen die bekannten Routen, und ein zur
     * Laufzeit gebauter Pfad ist keine — ein Cast hätte die Prüfung
     * ausgeschaltet, statt sie zu erfüllen. Der Preis ist diese Verzweigung;
     * der Gewinn ist, dass ein Tippfehler im Ziel den Build bricht statt eine
     * Weiterleitung ins Nichts zu bauen.
     */
    if (sitzung.portal === 'mitarbeiter') redirect('/portal/mein');
    if (sitzung.portal === 'kunde') redirect('/portal/kunde');
    // Ein `intern`-Portal hat keine feste Wurzel — der Mandant steht im Pfad.
    // Wer dort in eine fremde Familie greift, bekommt 404 wie alle anderen.
    notFound();
  }
  if (entscheidung.art !== 'erlaubt') {
    /**
     * `unbekannt`, `kein_recht`, `zweiter_faktor` — alle drei enden als 404
     * und NICHT als 403 (AUT-06, SEC-A3). Ein 403 bestätigt, dass es die
     * Sache gibt; genau das ist die Auskunft, die niemand bekommen soll.
     * Deshalb dieselbe Antwort für drei verschiedene Gründe.
     */
    notFound();
  }

  const rolle = await aktiveRolle(sitzung);
  return { sitzung, rolle, leiste: leisteFuer(sitzung.portal, sitzung.ansicht, rolle) };
}

export { PORTAL_START };
