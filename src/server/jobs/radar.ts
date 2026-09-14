import { registriere, type JobDefinition } from './registry.js';
import type { JobVerbindung } from './sitzung.js';
import { quellStand, type QuellSchluessel } from '../services/radar/quelle.js';
import { liesOcds } from '../services/radar/ocds.js';
import { liesTed } from '../services/radar/ted.js';
import { leseEin, markiereVerschwundene, type SchreibAbfrage } from '../services/radar/import.js';
import { bewerteLauf } from '../services/radar/lauf.js';
import { netzAbruf } from '../radar/abruf.js';

/**
 * Der nächtliche Radarlauf: einlesen, bewerten, aufräumen (RAD-01 … RAD-05).
 *
 * **Übergreifend, nicht je Mandant.** Eine Bekanntmachung ist eine öffentliche
 * Tatsache und wird EINMAL eingelesen; bewertet wird sie danach gegen jedes
 * aktive Profil jeder Gesellschaft. Vier Läufe, die dieselbe Quelle abrufen,
 * wären vier Abrufe, vier Rohdatenzeilen und vier Gelegenheiten, sich zu
 * widersprechen.
 *
 * **Eine nicht verbundene Quelle ist ein Lauf mit `uebersprungen`**, kein
 * leerer Tag. Der Unterschied ist der zwischen „heute war nichts
 * ausgeschrieben" und „seit drei Wochen fragt niemand mehr nach" — und der
 * zweite Fall fällt nur auf, wenn er in `radar_ingest_lauf` steht.
 *
 * **Der Abruf steht in einer einzigen Funktion.** Sie ist einspritzbar, damit
 * der Test den Lauf ohne Netz fahren kann — und damit es genau eine Stelle
 * gibt, an der eine Antwort entsteht.
 */

import type { Abrufer } from '../radar/abruf.js';

export interface RadarBefund {
  readonly quellen: number;
  readonly uebersprungen: number;
  readonly gelesen: number;
  readonly neu: number;
  readonly geaendert: number;
  readonly verschwunden: number;
  readonly bewertungen: number;
  readonly neueBewertungen: number;
  readonly letzterFehler: string | null;
}

const QUELLEN: readonly QuellSchluessel[] = ['oeffentlichevergabe', 'ted'];

/** Wie weit zurück ein Lauf schaut. Zwei Wochen fangen auch einen Ausfall über ein langes Wochenende. */
const FENSTER_TAGE = 14;

export function registriereRadar(
  sql: JobVerbindung, abrufer: Abrufer = netzAbruf,
): JobDefinition {
  return registriere({
    schluessel: 'radar_einlesen',
    bezeichnung: 'Vergaberadar: Bekanntmachungen einlesen und bewerten (RAD-01, RAD-02, RAD-05)',
    /*
     * 04:20 — nach den Finanzläufen der Nacht und früh genug, dass die Liste
     * steht, bevor jemand sie ansieht. Die Uhrzeit ist UTC.
     */
    zeitplan: '20 4 * * *',
    bereich: 'uebergreifend',
    versuche: 1,
    ausfuehren: async (): Promise<Record<string, unknown>> => ({ ...await laufe(sql, abrufer) }),
  });
}

/**
 * Der Lauf selbst — ohne Registrierung, damit ein Test ihn direkt aufruft.
 *
 * **Die Uhr steht in der Datenbank** (Invariante 5). Ohne `jetzt` fragt der
 * Lauf `now()` ab, statt die Uhr des Rechners zu lesen, auf dem er zufällig
 * läuft; ein Test reicht den Zeitpunkt herein und kann damit eine Frist
 * nachstellen, die morgen abläuft.
 */
export async function laufe(
  sql: JobVerbindung, abrufer: Abrufer, jetztOderNull: Date | null = null,
): Promise<RadarBefund> {
  const jetzt = jetztOderNull ?? await alsJob(sql, async (db) => {
    const zeilen = (await db.unsafe(`select now() as jetzt`)) as { jetzt: Date }[];
    return zeilen[0]?.jetzt ?? new Date(0);
  });
  let uebersprungen = 0;
  let gelesen = 0;
  let neu = 0;
  let geaendert = 0;
  let verschwunden = 0;
  let letzterFehler: string | null = null;

  for (const quelle of QUELLEN) {
    const stand = quellStand(quelle);
    const laufId = await beginneLauf(sql, quelle, stand.verbunden ? 'laeuft' : 'uebersprungen',
      stand.verbunden ? null : stand.hinweis);
    if (!stand.verbunden || stand.basisUrl === null) {
      uebersprungen += 1;
      continue;
    }

    try {
      const text = await abrufer(quelle, stand.basisUrl);
      const zeilen = (quelle === 'ted' ? liesTed(text) : liesOcds(text))
        .map((b) => ({ bekanntmachung: b, rohText: text }));

      const ergebnis = await alsJob(sql, async (db) => leseEin(db, zeilen, laufId));
      gelesen += ergebnis.gelesen;
      neu += ergebnis.neu;
      geaendert += ergebnis.geaendert;

      /*
       * Erst nach ZWEI Läufen ohne Wiedersehen (Datenmodell §2.9): ein
       * einzelner Ausfall der Quelle erklärte sonst den ganzen Bestand für
       * verschwunden — und jeder offene Vorgang bekäme eine Warnung, die
       * nichts bedeutet.
       */
      const grenze = new Date(jetzt.getTime() - 2 * 86_400_000);
      verschwunden += await alsJob(sql, async (db) => markiereVerschwundene(db, quelle, grenze));

      await beendeLauf(sql, laufId, ergebnis.uebersprungen > 0 ? 'teilweise' : 'erfolg', {
        gelesen: ergebnis.gelesen, neu: ergebnis.neu, geaendert: ergebnis.geaendert,
        unveraendert: ergebnis.unveraendert, verschwunden,
      }, null);
    } catch (grund: unknown) {
      /*
       * Eine Quelle, die ausfällt, nimmt die andere nicht mit: national und
       * europäisch sind zwei Dienste, und ein Ausfall von TED darf nicht die
       * Ausschreibungen des Bezirksamts verschlucken.
       */
      letzterFehler = grund instanceof Error ? grund.message : String(grund);
      await beendeLauf(sql, laufId, 'fehler', {}, letzterFehler);
    }
  }

  const bewertung = await alsJob(sql, async (db) => bewerteLauf(db, {
    seit: new Date(jetzt.getTime() - FENSTER_TAGE * 86_400_000),
    jetzt,
  }));

  return {
    quellen: QUELLEN.length, uebersprungen, gelesen, neu, geaendert, verschwunden,
    bewertungen: bewertung.bewertungen, neueBewertungen: bewertung.neueZeilen, letzterFehler,
  };
}

/**
 * Die Radartabellen tragen keinen Mandanten — der Lauf braucht deshalb keine
 * gebundene Gesellschaft, nur die Jobrolle.
 */
async function alsJob<T>(sql: JobVerbindung, fn: (db: SchreibAbfrage) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_job`);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    return fn({ unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> });
  }) as Promise<T>;
}

async function beginneLauf(
  sql: JobVerbindung, quelle: QuellSchluessel, status: string, hinweis: string | null,
): Promise<string> {
  return alsJob(sql, async (db) => {
    const zeilen = (await db.unsafe(
      `insert into radar_ingest_lauf (quelle, status, fehler_text, beendet_am)
       values ($1::ausschreibung_quelle, $2::radar_lauf_status, $3,
               case when $2 = 'laeuft' then null else now() end)
       returning id`, [quelle, status, hinweis])) as { id: string }[];
    return zeilen[0]?.id ?? '';
  });
}

async function beendeLauf(
  sql: JobVerbindung, laufId: string, status: string,
  zahlen: { gelesen?: number; neu?: number; geaendert?: number; unveraendert?: number; verschwunden?: number },
  fehler: string | null,
): Promise<void> {
  if (laufId === '') return;
  await alsJob(sql, async (db) => db.unsafe(
    `update radar_ingest_lauf
        set status = $2::radar_lauf_status, beendet_am = now(),
            saetze_gelesen = $3::integer, saetze_neu = $4::integer,
            saetze_geaendert = $5::integer, saetze_unveraendert = $6::integer,
            saetze_verschwunden = $7::integer, fehler_text = $8
      where id = $1::uuid`,
    [laufId, status, zahlen.gelesen ?? 0, zahlen.neu ?? 0, zahlen.geaendert ?? 0,
      zahlen.unveraendert ?? 0, zahlen.verschwunden ?? 0, fehler]));
}
