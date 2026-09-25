/**
 * Eigene Termine über den Dienst — angelegt, einer davon abgesagt (CAL-01,
 * V-221, D-715).
 *
 * **Über die echten Dienste.** `legeTerminAn` legt an, `sageTerminAb` sagt
 * ab — jede Zeile durchläuft die Sitzung eines Menschen mit
 * `kalender.schreiben`, dieselbe Policy (`t_kalender_schreiben`, 0160) und
 * dasselbe Prüfprotokoll wie im Portal. Die Termine aus `berichtsdaten.ts`
 * entstehen weiter als Zeilen; diese hier zeigen den Weg, den es bis V-221
 * nicht gab — und den abgesagten Termin, den kein Weg setzte.
 *
 * **Die Zeitpunkte rechnet die Datenbank**: Berliner Wanduhr relativ zu
 * `app.berlin_heute()`, als Instant (Invariante 2).
 *
 * Nur auf der Vorführfläche (Demodaten) und nur einmal: erkannt am
 * Kennzeichen in der Beschreibung.
 */
import type postgres from 'postgres';
import { legeTerminAn, sageTerminAb } from '../../services/kalender/termin.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export const TERMIN_KENNZEICHEN = '(Demodaten, Terminpflege)';

export interface TerminSeedErgebnis {
  readonly angelegt: number;
  readonly abgesagt: number;
}

const LEER: TerminSeedErgebnis = { angelegt: 0, abgesagt: 0 };

export async function seedTermine(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<TerminSeedErgebnis> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return LEER;

  const [schon] = await sql<{ id: string }[]>`
    select id from kalender_eintrag
     where mandant_id = ${reinigung}
       and beschreibung like ${`%${TERMIN_KENNZEICHEN}%`} limit 1`;
  if (schon !== undefined) return LEER;

  /*
   * Ein Mensch, der Termine setzt UND die Namen der anderen lesen darf —
   * sonst nähme niemand teil (`pruefeTeilnehmer` liest unter RLS).
   */
  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel in ('kalender.schreiben', 'system.benutzer_lesen')
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     group by b.id, b.email
    having count(distinct be.schluessel) = 2
     order by b.email limit 1`;
  if (mensch === undefined) return LEER;

  const [andere] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
     where b.id <> ${mensch.id} and b.status = 'aktiv' and b.ist_dienstkonto = false
       and bm.entzogen_am is null
     order by b.email limit 1`;

  const [z] = await sql<{ runde: Date; begehung: Date; abnahme: Date }[]>`
    select ((app.berlin_heute() + 3)::timestamp + interval '8 hours 30 minutes')
             at time zone 'Europe/Berlin' as runde,
           ((app.berlin_heute() + 5)::timestamp + interval '14 hours')
             at time zone 'Europe/Berlin' as begehung,
           ((app.berlin_heute() + 8)::timestamp + interval '10 hours')
             at time zone 'Europe/Berlin' as abnahme`;
  if (z === undefined) return LEER;
  const stunde = 3600 * 1000;

  return alsPortalSitzung(sql, reinigung, mensch.id, async (k) => {
    await legeTerminAn(k, {
      art: 'besprechung',
      titel: 'Objektleitungsrunde Reinigung',
      beschreibung: `Wochenplanung und Reklamationen ${TERMIN_KENNZEICHEN}`,
      ort: 'Büro, Besprechungsraum 1',
      beginn: z.runde, ende: new Date(z.runde.getTime() + stunde),
      ganztaegig: false,
      teilnehmer: andere === undefined ? [] : [andere.id],
    });
    await legeTerminAn(k, {
      art: 'kundentermin',
      titel: 'Begehung mit der Hausverwaltung',
      beschreibung: `Qualitätsrundgang durch Treppenhaus und Tiefgarage ${TERMIN_KENNZEICHEN}`,
      ort: 'Kurfürstendamm 21, Berlin',
      beginn: z.begehung, ende: new Date(z.begehung.getTime() + 90 * 60 * 1000),
      ganztaegig: false,
      teilnehmer: [],
    });
    const abzusagen = await legeTerminAn(k, {
      art: 'kundentermin',
      titel: 'Abnahme Grundreinigung',
      beschreibung: `Abnahme mit dem Kunden vor Ort ${TERMIN_KENNZEICHEN}`,
      ort: 'Kurfürstendamm 21, Berlin',
      beginn: z.abnahme, ende: new Date(z.abnahme.getTime() + stunde),
      ganztaegig: false,
      teilnehmer: [],
    });
    await sageTerminAb(k, abzusagen,
      'Der Kunde hat den Termin telefonisch abgesagt — neuer Termin folgt (Demodaten).');
    return { angelegt: 3, abgesagt: 1 };
  });
}
