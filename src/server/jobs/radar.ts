import { registriere, type JobDefinition } from './registry.js';
import type { JobVerbindung } from './sitzung.js';
import { quellStand, type QuellSchluessel } from '../services/radar/quelle.js';
import { liesOcds } from '../services/radar/ocds.js';
import { liesTed } from '../services/radar/ted.js';
import { leseEin, markiereVerschwundene, type SchreibAbfrage } from '../services/radar/import.js';
import { bewerteLauf } from '../services/radar/lauf.js';
import { netzAbruf, type Abrufer } from '../radar/abruf.js';

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
 * **Eine Quelle, die ausfällt, färbt den Lauf rot.** Sie nimmt die andere
 * nicht mit — national und europäisch sind zwei Dienste —, aber am Ende wirft
 * der Lauf: sonst stünde in `job_lauf` ein grüner Eintrag, während seit Tagen
 * keine Bekanntmachung mehr ankommt.
 *
 * **Der Abruf steht in einer einzigen Funktion.** Sie ist einspritzbar, damit
 * der Test den Lauf ohne Netz fahren kann — und damit es genau eine Stelle
 * gibt, an der eine Antwort entsteht.
 */

export class RadarQuellenFehler extends Error {
  constructor(letzter: string) {
    super(`Radar: eine Quelle war nicht erreichbar — ${letzter}`);
    this.name = 'RadarQuellenFehler';
  }
}

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
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      const befund = await laufe(sql, abrufer, null, kontext.laufId);
      /*
       * **Erst zaehlen, dann werfen.** Die Zahlen stehen in
       * `radar_ingest_lauf` und die Bewertung ist gelaufen; was danach fehlt,
       * ist die Farbe des Job-Laufs. Ein gruener Lauf ueber einer toten Quelle
       * ist die stille Variante — und die faellt erst auf, wenn jemand eine
       * Vergabe verpasst hat.
       */
      if (befund.letzterFehler !== null) throw new RadarQuellenFehler(befund.letzterFehler);
      return { ...befund };
    },
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
  jobLaufId: string | null = null,
): Promise<RadarBefund> {
  const jetzt = jetztOderNull ?? await alsJob(sql, async (db) => {
    const zeilen = (await db.unsafe(`select now() as jetzt`)) as { jetzt: Date }[];
    return zeilen[0]?.jetzt ?? new Date(0);
  });
  let uebersprungen = 0;
  let gelesen = 0;
  let neu = 0;
  let geaendert = 0;
  let verschwundenGesamt = 0;
  let letzterFehler: string | null = null;

  for (const quelle of QUELLEN) {
    const stand = quellStand(quelle);
    /* Der Stand VOR diesem Lauf — danach steht die eigene Zeile schon da. */
    const vorlaufErfolgreich = await letzterLaufErfolgreich(sql, quelle);
    const laufId = await beginneLauf(sql, quelle, stand.verbunden ? 'laeuft' : 'uebersprungen',
      stand.verbunden ? null : stand.hinweis, jobLaufId);
    if (!stand.verbunden || stand.basisUrl === null) {
      uebersprungen += 1;
      continue;
    }

    try {
      const text = await abrufer(quelle, stand.basisUrl);
      const gelesenes = quelle === 'ted' ? liesTed(text) : liesOcds(text);
      /* Jede Zeile traegt IHRE Rohantwort — nicht die der ganzen Seite. */
      const eintraege = gelesenes.zeilen.map((b) => ({ bekanntmachung: b, rohText: b.rohJson }));

      const ergebnis = await alsJob(sql, async (db) => leseEin(db, eintraege, laufId));
      gelesen += ergebnis.gelesen + gelesenes.uebersprungen;
      neu += ergebnis.neu;
      geaendert += ergebnis.geaendert;

      /*
       * **Aufgeraeumt wird nur nach einem VOLLSTAENDIGEN Lauf und nur, wenn
       * der vorige Lauf derselben Quelle auch erfolgreich war** (Datenmodell
       * §2.9). Eine Altersgrenze allein taeuscht: war die Quelle eine Woche
       * weg und liefert dann eine halbe Seite, erklaerte sie ihren ganzen
       * Bestand fuer verschwunden — genau der Ausfall, den die Regel
       * verhindern soll.
       */
      const unvollstaendig = ergebnis.uebersprungen > 0 || gelesenes.uebersprungen > 0;
      const grenze = new Date(jetzt.getTime() - 2 * 86_400_000);
      const verschwunden = await alsJob(sql, async (db) => markiereVerschwundene(
        db, quelle, grenze, { vorlaufErfolgreich, vollstaendig: !unvollstaendig }));
      verschwundenGesamt += verschwunden;

      await beendeLauf(sql, laufId, unvollstaendig ? 'teilweise' : 'erfolg', {
        gelesen: ergebnis.gelesen + gelesenes.uebersprungen,
        neu: ergebnis.neu, geaendert: ergebnis.geaendert,
        unveraendert: ergebnis.unveraendert,
        /* Je Quelle die EIGENE Zahl — die Summe steht im Befund, nicht in der Zeile. */
        verschwunden,
      }, unvollstaendig
        ? `${String(gelesenes.uebersprungen)} Saetze ohne Kennung oder Titel, `
          + `${String(ergebnis.uebersprungen)} beim Schreiben abgewiesen`
        : null);
    } catch (grund: unknown) {
      /*
       * Eine Quelle, die ausfällt, nimmt die andere nicht mit: national und
       * europäisch sind zwei Dienste, und ein Ausfall von TED darf nicht die
       * Ausschreibungen des Bezirksamts verschlucken. Rot wird der Job
       * trotzdem — am Ende, wenn beide Quellen ihre Zeile haben.
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
    quellen: QUELLEN.length, uebersprungen, gelesen, neu, geaendert,
    verschwunden: verschwundenGesamt,
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

/**
 * War der letzte ABGESCHLOSSENE Lauf dieser Quelle erfolgreich?
 *
 * Die Antwort entscheidet, ob heute aufgeraeumt werden darf — „zwei
 * aufeinanderfolgende erfolgreiche Laeufe" heisst genau das und nicht „alt
 * genug".
 */
async function letzterLaufErfolgreich(
  sql: JobVerbindung, quelle: QuellSchluessel,
): Promise<boolean> {
  return alsJob(sql, async (db) => {
    const zeilen = (await db.unsafe(
      `select status::text as status from radar_ingest_lauf
        where quelle = $1::ausschreibung_quelle and beendet_am is not null
        order by beendet_am desc limit 1`, [quelle])) as { status: string }[];
    return zeilen[0]?.status === 'erfolg';
  });
}

async function beginneLauf(
  sql: JobVerbindung, quelle: QuellSchluessel, status: string, hinweis: string | null,
  jobLaufId: string | null,
): Promise<string> {
  return alsJob(sql, async (db) => {
    const zeilen = (await db.unsafe(
      `insert into radar_ingest_lauf (quelle, status, fehler_text, job_lauf_id, beendet_am)
       values ($1::ausschreibung_quelle, $2::radar_lauf_status, $3, $4::uuid,
               case when $2 = 'laeuft' then null else now() end)
       returning id`, [quelle, status, hinweis, jobLaufId])) as { id: string }[];
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
