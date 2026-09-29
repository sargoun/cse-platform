/**
 * Bewerbungsgespräche in allen drei Ständen (REC-06, CAL-01, V-220, D-714).
 *
 * **Über die echten Dienste.** `planeGespraech` legt an, `sageGespraechAb`
 * sagt ab (mit Grund), `vermerkeGespraech` vermerkt ein geführtes — jede Zeile
 * durchläuft die Sitzung eines Menschen mit `recruiting.bewerbung_lesen` und
 * `kalender.schreiben`, dieselben Policies und denselben Auslöser (0471) wie
 * im Portal. Ohne diese Zeilen zeigte die Gesprächsliste nur „geplant", und
 * der Kalender hätte nie ein abgesagtes Gespräch durchgestrichen.
 *
 * **Die Zeitpunkte rechnet die Datenbank** — relativ zu `app.berlin_heute()`,
 * Berliner Wanduhr, als Instant (Invariante 2). Das geführte Gespräch liegt
 * zwei Tage zurück; `planeGespraech` prüft keine Zukunft (das tut die Route),
 * vermerkt wird es erst danach, gegen `now()`.
 *
 * **Und verschoben wird eines** (`verschiebeGespraech`): das geplante wandert
 * einen Tag weiter — die Demo zeigt so auch `recruiting.gespraech_verschoben`
 * mit altem und neuem Termin im Protokoll (Prüfung der Gruppe
 * kalender-dokumente).
 *
 * **Gespräche nur zu Bewerbungen, die VOR dem geführten Gespräch eingingen.**
 * Vorher nahm der Seed die zwei jüngsten — und seit der Postfach-Bewerbung
 * stand ein Gespräch da, das zwei Tage vor dem Eingang seiner Bewerbung
 * geführt worden sein sollte.
 *
 * Nur auf der Vorführfläche (Demodaten) und nur einmal: erkannt am Ort.
 */
import type postgres from 'postgres';
import { planeGespraech } from '../../services/recruiting/dienst.js';
import {
  sageGespraechAb, vermerkeGespraech, verschiebeGespraech,
} from '../../services/recruiting/gespraech.js';
import { alsPortalSitzung } from './sitzung.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export const GESPRAECH_ORT = 'Kurfürstendamm 21, Besprechungsraum 2 (Demodaten)';

export interface GespraechSeedErgebnis {
  readonly geplant: number;
  /** Davon über `verschiebeGespraech` verlegt. */
  readonly verschoben: number;
  readonly abgesagt: number;
  readonly gefuehrt: number;
}

const LEER: GespraechSeedErgebnis = { geplant: 0, verschoben: 0, abgesagt: 0, gefuehrt: 0 };

export async function seedGespraeche(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<GespraechSeedErgebnis> {
  const reinigung = ids.get('reinigung');
  if (!demodaten || reinigung === undefined) return LEER;

  const [schon] = await sql<{ id: string }[]>`
    select id from gespraech where mandant_id = ${reinigung} and ort = ${GESPRAECH_ORT} limit 1`;
  if (schon !== undefined) return LEER;

  /* Ein Mensch, der Gespräche planen darf — beide Rechte, kein Dienstkonto. */
  const [mensch] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${reinigung}
      join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id
      join berechtigung be on be.id = rb.berechtigung_id
     where be.schluessel in ('recruiting.bewerbung_lesen', 'kalender.schreiben')
       and b.status = 'aktiv' and b.ist_dienstkonto = false and bm.entzogen_am is null
     group by b.id, b.email
    having count(distinct be.schluessel) = 2
     order by b.email limit 1`;
  if (mensch === undefined) return LEER;

  const [zeiten] = await sql<{ bald: Date; verlegt: Date; spaeter: Date; vorbei: Date }[]>`
    select ((app.berlin_heute() + 4)::timestamp + interval '10 hours')
             at time zone 'Europe/Berlin' as bald,
           ((app.berlin_heute() + 5)::timestamp + interval '11 hours')
             at time zone 'Europe/Berlin' as verlegt,
           ((app.berlin_heute() + 6)::timestamp + interval '14 hours 30 minutes')
             at time zone 'Europe/Berlin' as spaeter,
           ((app.berlin_heute() - 2)::timestamp + interval '9 hours')
             at time zone 'Europe/Berlin' as vorbei`;
  if (zeiten === undefined) return LEER;

  /* Nur Bewerbungen, die vor dem geführten Gespräch eingingen — die jüngsten davon. */
  const bewerbungen = await sql<{ id: string }[]>`
    select id from bewerbung
     where mandant_id = ${reinigung} and geloescht_am is null
       and aufbewahrung_bis >= app.berlin_heute()
       and eingegangen_am < ${zeiten.vorbei}
     order by eingegangen_am desc limit 2`;
  const [erste, zweite] = bewerbungen;
  if (erste === undefined) return LEER;

  const fragen = [
    'Welche Objekte haben Sie bisher betreut?',
    'Ab wann könnten Sie beginnen?',
    'Wie stellen Sie sich die Einarbeitung vor?',
  ];

  return alsPortalSitzung(sql, reinigung, mensch.id, async (k) => {
    const geplant = await planeGespraech(k, erste.id, zeiten.bald, 60, GESPRAECH_ORT, fragen);
    await verschiebeGespraech(k, geplant, zeiten.verlegt, 45);

    const vorbei = await planeGespraech(k, erste.id, zeiten.vorbei, 45, GESPRAECH_ORT,
      fragen);
    await vermerkeGespraech(k, vorbei);

    let abgesagt = 0;
    if (zweite !== undefined) {
      const abzusagen = await planeGespraech(k, zweite.id, zeiten.spaeter, 60,
        GESPRAECH_ORT, fragen);
      await sageGespraechAb(k, abzusagen,
        'Die Bewerberin hat telefonisch abgesagt — sie hat eine andere Stelle angenommen '
        + '(Demodaten).');
      abgesagt = 1;
    }
    return { geplant: 1, verschoben: 1, abgesagt, gefuehrt: 1 };
  });
}
