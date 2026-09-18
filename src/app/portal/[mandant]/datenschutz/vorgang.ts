import 'server-only';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant, type LeseKontext } from '@/server/kontext/index';
import { haeltRechte } from '@/app/portal/rechte';
import {
  lade, ladeZuordnung, type AnfrageZeile, type Zuordnung,
} from '@/server/services/datenschutz/anfrage';
import type { PortalZugang } from '@/app/portal/zugang';

/**
 * Die Akte in EINEM Aufruf — für alle vier Vorgangsseiten.
 *
 * **Warum das hier steht und nicht viermal in einer Seite.** Jede der vier
 * Seiten braucht dasselbe: die Anfrage, die Zuordnung, die drei
 * Datenschutzrechte für die Navigation — und einen 404, wenn es die Anfrage
 * nicht gibt. Viermal ausgeschrieben sind das vier Gelegenheiten, den 404 zu
 * vergessen und statt „gibt es nicht" eine leere Seite zu zeigen.
 *
 * **Das Tor steht seit `kennung-tor`/`mandanten-tor` in der SEITE, nicht
 * hier.** `kennungOder404(id)` und `mandantTor(pfad, mandant)` sind die ersten
 * beiden Zeilen jeder der vier Seiten, wie bei jeder anderen Portalseite auch.
 * Eingepackt waren sie zwar ausgeführt, aber unsichtbar: eine Vermessung des
 * Quelltextes — und ein Mensch, der die Seite liest — sah eine Seite ohne Tor,
 * und die nächste Seite, die den Helfer NICHT nimmt, hätte keines gehabt, ohne
 * dass es jemandem auffiel. Das Tor gehört dorthin, wo man es vergessen kann,
 * und genau deshalb wird es dort geprüft.
 *
 * **Ein Vorgang, den die Sitzung nicht lesen darf, ist einer, den es nicht
 * gibt** (AUT-06). `lade()` gibt `null`, wenn die Policy null Zeilen liefert —
 * und das ist derselbe Fall wie eine falsche Kennung. Hier wird daraus
 * `notFound()`, nicht ein 403 und nicht eine leere Tabelle.
 *
 * **Die drei Rechte kommen in EINER Abfrage** (`haeltRechte`): die Navigation
 * zeigt nur Wege, die diese Sitzung wirklich öffnen darf.
 */
export interface Vorgang {
  readonly z: AnfrageZeile;
  readonly zuordnung: Zuordnung;
  readonly darf: Readonly<Record<string, boolean>>;
}

export const DATENSCHUTZRECHTE = [
  'datenschutz.auskunft_erstellen',
  'datenschutz.berichtigung_bearbeiten',
  'datenschutz.loeschung_pruefen',
] as const;

/**
 * @param zugang         Der Zugang aus dem Tor der SEITE — `mandantTor` ist
 *                       dort schon gelaufen, ein zweites Mal hiesse eine
 *                       zweite Zugangsabfrage je Aufruf.
 * @param id             Die Kennung, in der Seite bereits durch
 *                       `kennungOder404` gegangen.
 * @param weitereRechte  Rechte, die die Seite zusätzlich zur Navigation
 *                       braucht — etwa `crm.lesen` für den Kontaktzweig oder
 *                       das Recht eines Verweisziels (D-567).
 * @param dazu           Was die Seite über den Vorgang hinaus laden will, im
 *                       SELBEN Schnappschuss. Ohne das läse eine Seite die
 *                       Akte und ihre Tabelle aus zwei Ständen.
 */
export async function ladeVorgang<T>(
  zugang: PortalZugang, mandant: string, id: string,
  weitereRechte: readonly string[],
  dazu: (kontext: LeseKontext, v: Vorgang) => Promise<T>,
): Promise<Vorgang & { readonly extra: T }> {
  const darf = await haeltRechte(
    zugang.sitzung, ...DATENSCHUTZRECHTE, ...weitereRechte);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const z = await lade(kontext, id);
      if (z === null) return null;
      const zuordnung = await ladeZuordnung(kontext, mandant, id);
      const v: Vorgang = { z, zuordnung, darf };
      return { v, extra: await dazu(kontext, v) };
    }))) as { v: Vorgang; extra: T } | null;

  if (daten === null) notFound();
  return { ...daten.v, extra: daten.extra };
}
