import 'server-only';
import type { LeseKontext } from '../kontext/index.js';

/**
 * Hält diese Sitzung diese Rechte — **innerhalb einer schon offenen
 * Transaktion**?
 *
 * **Der Unterschied zu `app/portal/rechte.ts`.** `haeltRechte` öffnet eine
 * eigene Transaktion und ist damit die richtige Antwort für einen Verweis, der
 * gezeigt oder verschwiegen wird (AUT-06). Diese Funktion beantwortet die
 * andere Frage: eine Seite liest in EINER Transaktion mehrere Tabellen, deren
 * RLS verschiedene Rechte verlangt, und muss danach sagen können, ob eine
 * leere Liste „nichts offen" oder „nicht geprüft" heisst.
 *
 * **Warum es diese Unterscheidung überhaupt gibt.** Ein Modulkopf zeigt
 * Kacheln über `einsatz` (`dienstplan.lesen`), `leistungsnachweis`
 * (`nachweis.lesen`) und `turnus` (`reinigung.lesen`) — die Route selbst ist
 * aber nur auf `reinigung.lesen` bewacht. RLS filtert still: ohne das zweite
 * Recht kommen null Zeilen zurück, und die Kachel meldete „0 offene
 * Nachweise" oder „Generator läuft", wo niemand nachgesehen hat. Eine
 * Falschauskunft, die wie eine Entwarnung aussieht, ist schlimmer als eine
 * fehlende Auskunft — `ladePlanfenster.abwesenheitGeprueft` macht es für die
 * Abwesenheiten schon so vor.
 *
 * `app.hat_recht` NIMMT den Mandanten (K-03): ein globales Prädikat trüge ein
 * in einer Gesellschaft erteiltes Recht in jede andere.
 */
export async function rechteImKontext(
  kontext: LeseKontext, ...schluessel: readonly string[]
): Promise<Readonly<Record<string, boolean>>> {
  const karte: Record<string, boolean> = {};
  for (const s of schluessel) karte[s] = false;
  if (schluessel.length === 0) return karte;
  const zeilen = await kontext.abfrage<{ recht: string; ok: boolean }>(
    `select r as recht, app.hat_recht(r, app.aktiver_mandant()) as ok
       from unnest($1::text[]) as r`,
    [[...schluessel]],
  );
  for (const z of zeilen) karte[z.recht] = z.ok;
  return karte;
}
