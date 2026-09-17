import 'server-only';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant, type LeseKontext } from '@/server/kontext/index';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import {
  lade, ladeZuordnung, type AnfrageZeile, type Zuordnung,
} from '@/server/services/datenschutz/anfrage';
import { mandantTor, type MandantTor } from '@/app/portal/unterseite';

/**
 * Das Tor und die Akte in EINEM Aufruf — für alle vier Vorgangsseiten.
 *
 * **Warum das hier steht und nicht viermal in einer Seite.** Jede der vier
 * Seiten braucht dasselbe: das Mandantstor, die Anfrage, die Zuordnung, die
 * drei Datenschutzrechte für die Navigation — und einen 404, wenn es die
 * Anfrage nicht gibt. Viermal ausgeschrieben sind das vier Gelegenheiten, den
 * 404 zu vergessen und statt „gibt es nicht" eine leere Seite zu zeigen.
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

export type VorgangTor =
  | { readonly art: 'antwort'; readonly tor: Exclude<MandantTor, { art: 'ok' }> }
  | ({ readonly art: 'ok' } & Vorgang & {
      readonly zugang: Extract<MandantTor, { art: 'ok' }>['zugang'];
    });

/**
 * @param weitereRechte Rechte, die die Seite zusätzlich zur Navigation braucht
 *                      — etwa `crm.lesen` für den Kontaktzweig.
 * @param dazu          Was die Seite über den Vorgang hinaus laden will, im
 *                      SELBEN Schnappschuss. Ohne das läse eine Seite die
 *                      Akte und ihre Tabelle aus zwei Ständen.
 */
export async function ladeVorgang<T>(
  pfad: string, mandant: string, idRoh: string | undefined,
  weitereRechte: readonly string[],
  dazu: (kontext: LeseKontext, v: Vorgang) => Promise<T>,
): Promise<VorgangTor & { readonly extra: T }> {
  const id = kennungOder404(idRoh);
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') {
    return { art: 'antwort', tor, extra: undefined as T };
  }
  const { zugang } = tor;
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
  return { art: 'ok', zugang, ...daten.v, extra: daten.extra };
}
