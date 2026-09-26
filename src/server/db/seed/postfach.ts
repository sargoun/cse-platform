/**
 * Eine Bewerbung aus dem Postfach — von Hand erfasst, über den Dienst
 * (REC-03, REC-07, V-224, D-718).
 *
 * Das Postfach ist nicht angeschlossen (O-938); der Seed zeigt den Weg, den
 * es bis dahin gibt: `erfasseBewerbungAusPostfach` in der Sitzung eines
 * Menschen mit `recruiting.bewerbung_lesen`, Quelle `mail`, Löschfrist aus
 * derselben Einstellung wie beim Formular.
 *
 * Nur auf der Vorführfläche (Demodaten) und nur einmal: erkannt an der
 * Adresse.
 */
import type postgres from 'postgres';
import { erfasseBewerbungAusPostfach } from '../../services/recruiting/postfach.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export const POSTFACH_ADRESSE = 'm.yilmaz.bewerbung@beispiel.test';

export async function seedPostfach(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<{ readonly erfasst: number }> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return { erfasst: 0 };

  const [schon] = await sql<{ id: string }[]>`
    select id from bewerbung where mandant_id = ${reinigung} and email = ${POSTFACH_ADRESSE}
     limit 1`;
  if (schon !== undefined) return { erfasst: 0 };

  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'recruiting.bewerbung_lesen'
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     order by b.email limit 1`;
  if (mensch === undefined) return { erfasst: 0 };

  /* Eine offene Stelle, wenn es eine gibt — sonst eine Initiativbewerbung per E-Mail. */
  const [stelle] = await sql<{ id: string }[]>`
    select id from stelle where mandant_id = ${reinigung} and geschlossen_am is null
     order by erstellt_am limit 1`;

  await alsPortalSitzung(sql, reinigung, mensch.id, (k) => erfasseBewerbungAusPostfach(k, {
    stelleId: stelle?.id ?? null,
    name: 'Mehmet Yılmaz',
    email: POSTFACH_ADRESSE,
    telefon: null,
    nachricht: 'Guten Tag, ich bewerbe mich auf Ihre Anzeige. Ich habe vier Jahre in der '
      + 'Unterhaltsreinigung gearbeitet und kann ab dem nächsten Monat beginnen. '
      + '(Demodaten — per E-Mail eingegangen und von Hand übertragen.)',
  }));
  return { erfasst: 1 };
}
