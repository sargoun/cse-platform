import 'server-only';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant, type Sitzung } from '@/server/kontext/index';

/**
 * **Der Slug des aktiven Mandanten — aus der Sitzung, nie aus der Adresse**
 * (Invariante 3, V-278).
 *
 * Vierundzwanzig Routen nahmen den Slug ihrer Umleitung aus `?mandant=` der
 * Formularadresse. Gehandelt haben sie immer im aktiven Mandanten der
 * Sitzung — aber das ZIEL konnte auseinanderlaufen, wenn Formularadresse und
 * Sitzung verschiedene Gesellschaften nannten: gespeichert in der einen,
 * zurückgeführt auf das Blatt der anderen. Eine zweite Quelle für eine
 * Angabe, die die Sitzung schon hat.
 *
 * Gelesen wird in einer eigenen, lesenden Transaktion VOR der eigentlichen —
 * damit auch die Abweisung einer unvollständigen Eingabe, die noch vor jeder
 * Datenbankarbeit zurückführt, das richtige Blatt trifft. Ohne aktiven
 * Mandanten (Gruppen-, Personen-, Kundenansicht) ist der Slug leer; die
 * Routen führen dann auf `/portal`.
 */
export async function slugDesAktivenMandanten(sitzung: Sitzung): Promise<string> {
  if (sitzung.ansicht !== 'mandant' || sitzung.aktiverMandantId === null) return '';
  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => kontext.abfrage<{ slug: string }>(
      `select m.slug from mandant m where m.id = app.aktiver_mandant()`)))) as readonly {
    slug: string;
  }[];
  return zeilen[0]?.slug ?? '';
}

/**
 * Der Pfad unter dem Portal der Gesellschaft — oder `/portal`, wenn kein Slug
 * da ist. Ein leerer Slug ergäbe sonst `/portal//…`.
 */
export function portalPfad(slug: string, rest: string): string {
  return slug === '' ? '/portal' : `/portal/${slug}${rest}`;
}
