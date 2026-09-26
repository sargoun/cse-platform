/**
 * Kandidatendatensätze über die Dienste — einer bestätigt, einer noch nicht
 * (REC-04, V-223, D-717).
 *
 * **Über die echten Dienste.** `erfasseKandidat` legt an, `bestaetigeKandidat`
 * bestätigt — in der Sitzung eines Menschen mit `recruiting.bewerbung_lesen`,
 * durch dieselbe Policy (`t_kandidat_schreiben`, 0166) wie im Portal. Bis
 * V-223 hatte `kandidat` keinen Schreiber, auch nicht hier.
 *
 * **Kein Agentenvorschlag im Seed.** Der Demobetrieb liest nichts aus (er hat
 * für diese Vorgangsart keine Vorlage und sagt das), und ein im Seed
 * geschriebener Datensatz mit `quelle_art = 'agent'` behauptete einen Lauf,
 * den es nicht gab. Beide Datensätze sind deshalb von einem Menschen erfasst.
 *
 * Nur auf der Vorführfläche (Demodaten) und nur einmal: erkannt am
 * Kennzeichen in der Notiz.
 */
import type postgres from 'postgres';
import { bestaetigeKandidat, erfasseKandidat } from '../../services/recruiting/kandidat.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export const KANDIDAT_KENNZEICHEN = '(Demodaten)';

export interface KandidatSeedErgebnis {
  readonly erfasst: number;
  readonly bestaetigt: number;
}

const LEER: KandidatSeedErgebnis = { erfasst: 0, bestaetigt: 0 };

export async function seedKandidat(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<KandidatSeedErgebnis> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return LEER;

  const [schon] = await sql<{ id: string }[]>`
    select id from kandidat
     where mandant_id = ${reinigung} and notiz like ${`%${KANDIDAT_KENNZEICHEN}%`} limit 1`;
  if (schon !== undefined) return LEER;

  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'recruiting.bewerbung_lesen'
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     order by b.email limit 1`;
  if (mensch === undefined) return LEER;

  /* Zwei lebende Bewerbungen ohne Datensatz — die jüngsten. */
  const bewerbungen = await sql<{ id: string }[]>`
    select b.id from bewerbung b
     where b.mandant_id = ${reinigung} and b.geloescht_am is null
       and b.aufbewahrung_bis >= app.berlin_heute()
       and not exists (select 1 from kandidat k where k.bewerbung_id = b.id)
     order by b.eingegangen_am desc, b.id limit 2`;
  const [erste, zweite] = bewerbungen;
  if (erste === undefined) return LEER;

  return alsPortalSitzung(sql, reinigung, mensch.id, async (k) => {
    await erfasseKandidat(k, erste.id, {
      qualifikationen: ['Unterhaltsreinigung', 'Glasreinigung', 'Führerschein Klasse B'],
      sprachen: ['Deutsch', 'Polnisch'],
      erfahrungJahre: 6,
      notiz: `Aus dem Telefonat mit der Bewerberin übernommen ${KANDIDAT_KENNZEICHEN}.`,
    });
    await bestaetigeKandidat(k, erste.id);
    if (zweite === undefined) return { erfasst: 1, bestaetigt: 1 };
    await erfasseKandidat(k, zweite.id, {
      qualifikationen: ['Objektbetreuung'],
      sprachen: ['Deutsch', 'Englisch'],
      erfahrungJahre: null,
      notiz: `Erfahrungsjahre nicht genannt — noch nicht geprüft ${KANDIDAT_KENNZEICHEN}.`,
    });
    return { erfasst: 2, bestaetigt: 1 };
  });
}
