/**
 * Ein Entwurf bekommt sein Bild über die Dienste (SOC-02, V-225, D-719).
 *
 * **Mit Speicher** wird das Galeriemotiv der Reinigung als Datei hochgeladen
 * (`legeBeitragsbildAn`: Typ am Inhalt, Metadaten entfernt, privater Behälter
 * `marke`) und an den Entwurf gehängt (`setzeBeitragsbild`) — derselbe Weg
 * wie das Formular am Beitrag. **Ohne Speicher** hängt derselbe Dienst das
 * statische Galeriemotiv an; hochgeladen wird dann nichts, und das sagt die
 * Ausgabe des Seeds.
 *
 * Nur auf der Vorführfläche (Demodaten) und nur, solange der Entwurf noch
 * kein Bild trägt.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type postgres from 'postgres';
import type { Speicher } from '../../storage/adapter.js';
import { legeBeitragsbildAn } from '../../services/social/beitragsbild.js';
import { setzeBeitragsbild } from '../../services/social/dienst.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface BeitragsbildSeedErgebnis {
  readonly angehaengt: number;
  readonly hochgeladen: boolean;
}

const LEER: BeitragsbildSeedErgebnis = { angehaengt: 0, hochgeladen: false };

export async function seedBeitragsbild(
  sql: Sql, ids: ReadonlyMap<string, string>, speicher: Speicher | null, demodaten: boolean,
): Promise<BeitragsbildSeedErgebnis> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return LEER;

  const [entwurf] = await sql<{ id: string }[]>`
    select id from beitrag
     where mandant_id = ${reinigung} and status = 'entwurf' and medien_id is null
     order by erstellt_am, id limit 1`;
  if (entwurf === undefined) return LEER;

  const [galerie] = await sql<{ id: string; pfad: string; alt: string }[]>`
    select id, pfad, alt_text as alt from medien
     where mandant_id = ${reinigung} and galerie_rang is not null
     order by galerie_rang, id limit 1`;
  if (galerie === undefined) return LEER;

  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'social.schreiben'
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     order by b.email limit 1`;
  if (mensch === undefined) return LEER;

  /* Die Datei des Motivs — nur, wenn es sie im Baum gibt und ein Speicher verbunden ist. */
  const datei = speicher === null ? null
    : await readFile(resolve(process.cwd(), 'public', galerie.pfad.replace(/^\/+/u, '')))
      .then((b) => new Uint8Array(b)).catch(() => null);

  return alsPortalSitzung(sql, reinigung, mensch.id, async (k) => {
    if (speicher !== null && datei !== null) {
      const medienId = await legeBeitragsbildAn(k, speicher, {
        daten: datei, alt: `${galerie.alt} (Demodaten, hochgeladen)`,
      });
      await setzeBeitragsbild(k, entwurf.id, medienId);
      return { angehaengt: 1, hochgeladen: true };
    }
    await setzeBeitragsbild(k, entwurf.id, galerie.id);
    return { angehaengt: 1, hochgeladen: false };
  });
}
