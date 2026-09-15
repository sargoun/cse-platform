import 'server-only';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant, type Sitzung } from '@/server/kontext/index';

/**
 * Hält diese Sitzung diese Rechte — im AKTIVEN Bereich?
 *
 * **Der Befund, der diese Datei gebracht hat.** Ein Rundgang über alle fünf
 * Rollen, der jedem Verweis folgt, fand sechs Stellen, an denen eine Seite
 * einen Knopf zeigt, dessen Ziel dieselbe Sitzung nicht öffnen darf:
 * „Budget" (`agent.budget_verwalten`), „Protokoll" (`agent.protokoll_lesen`),
 * „MiLoG-Nachweise" (`zeit.exportieren`), „Neue Rechnung"
 * (`finanzen.schreiben`), „Prüfdauer" (`freigabe.pruefdauer_lesen`) und
 * „Zugang" (`personal.zugang_verwalten`). Eine `leitung` sah alle sechs und
 * bekam hinter jedem ein 404.
 *
 * **Ein Menüpunkt, der auf 404 führt, ist schlechter als keiner** — er verrät
 * die Existenz dessen, was er nicht zeigen darf (AUT-06). Dass die Seite
 * dahinter richtig sperrt, macht den Knopf davor nicht richtig.
 *
 * **Eine Abfrage für alle Schlüssel.** Sechs Seiten mit je einem eigenen
 * `select app.hat_recht(...)` wären sechs Stellen, an denen jemand den
 * Mandanten vergisst — und `app.hat_recht` NIMMT einen Mandanten (K-03): ein
 * globales Prädikat trüge ein in einer Gesellschaft erteiltes Recht in jede
 * andere.
 */
export async function haeltRechte(
  sitzung: Sitzung, ...schluessel: readonly string[]
): Promise<Readonly<Record<string, boolean>>> {
  if (schluessel.length === 0) return {};
  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => kontext.abfrage<{ recht: string; ok: boolean }>(
      `select r as recht, app.hat_recht(r, app.aktiver_mandant()) as ok
         from unnest($1::text[]) as r`,
      [[...schluessel]],
    ))) as Promise<readonly { recht: string; ok: boolean }[]>);
  const karte: Record<string, boolean> = {};
  for (const s of schluessel) karte[s] = false;
  for (const z of zeilen) karte[z.recht] = z.ok;
  return karte;
}
