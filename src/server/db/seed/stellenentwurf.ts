/**
 * Ein Mensch bearbeitet den Entwurf des Agenten (REC-02, V-222, D-716).
 *
 * Der Recruiting-Seed legt je Gesellschaft einen Stellenentwurf mit
 * `entwurf_von_art = 'agent'` an. Hier bearbeitet ihn ein Mensch über den
 * Dienst (`aendereStelle`) — mit einer Anforderung, die er selbst ergänzt,
 * und derselben Policy wie im Portal. Danach steht der Entwurf mit
 * „Entwurf bearbeiten" da und das Prüfprotokoll nennt, wer ihn bearbeitet hat.
 *
 * **Kein Agentenlauf im Seed.** Die Agenten sind im Seed aus (D-435); ein
 * Lauf, den der Seed einschaltete, wäre eine Entscheidung, die dem Betrieb
 * gehört.
 *
 * Nur auf der Vorführfläche (Demodaten) und nur einmal: erkannt am
 * Prüfprotokoll.
 */
import type postgres from 'postgres';
import { aendereStelle } from '../../services/recruiting/stellenentwurf.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export const STELLE_ERGAENZUNG = 'Deutschkenntnisse für die Übergabe an die Objektleitung';

export async function seedStellenentwurf(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<{ readonly bearbeitet: number }> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return { bearbeitet: 0 };

  const [stelle] = await sql<{
    id: string; titel: string; beschreibung: string; anforderungen: string[];
    einsatzort: string | null; wochenstunden: string | null; frist: string | null;
  }[]>`
    select s.id, s.titel, s.beschreibung, s.anforderungen, s.einsatzort,
           s.wochenstunden::text as wochenstunden, s.bewerbungsfrist::text as frist
      from stelle s
     where s.mandant_id = ${reinigung} and s.entwurf_von_art = 'agent'
       and s.status = 'entwurf' and s.freigabe_id is null
       and not exists (select 1 from audit_log a
                        where a.objekt_typ = 'stelle' and a.objekt_id = s.id::text
                          and a.aktion = 'recruiting.stelle_bearbeitet')
     order by s.erstellt_am, s.id limit 1`;
  if (stelle === undefined) return { bearbeitet: 0 };

  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel = 'recruiting.stelle_schreiben'
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     order by b.email limit 1`;
  if (mensch === undefined) return { bearbeitet: 0 };

  await alsPortalSitzung(sql, reinigung, mensch.id, (k) => aendereStelle(k, stelle.id, {
    titel: stelle.titel,
    beschreibung: stelle.beschreibung,
    anforderungen: stelle.anforderungen.includes(STELLE_ERGAENZUNG)
      ? stelle.anforderungen : [...stelle.anforderungen, STELLE_ERGAENZUNG],
    einsatzort: stelle.einsatzort,
    wochenstunden: stelle.wochenstunden === null ? null : Number(stelle.wochenstunden),
    bewerbungsfrist: stelle.frist,
  }));
  return { bearbeitet: 1 };
}
