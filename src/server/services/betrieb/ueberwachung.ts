/**
 * **Die Betriebsüberwachung — ein gescheiterter Lauf wird sichtbar** (SPEC §14,
 * Phase 10).
 *
 * **Der Befund, der diese Datei nötig machte.** Ein Nachtlauf, der um vier Uhr
 * scheitert, schreibt `job_lauf.ergebnis = 'fehler'` und eine Zeile auf
 * `stderr` (`alarm.ts`) — und dann passiert nichts. Kein Bildschirm zeigt ihn,
 * kein Mensch sieht ihn, und der Ausfall fällt erst auf, wenn jemand die
 * Mahnungen vermisst. Das ist dieselbe Sorte Lücke wie in `bootstrap.ts` und
 * `zeitplan.ts`, nur am anderen Ende: dort lief nichts, hier sieht niemand,
 * dass etwas nicht lief.
 *
 * **Drei Ausfälle, und der stillste ist der schlimmste.**
 *
 *  1. `fehler` — der Lauf ist gescheitert. Laut, in der Datenbank, mit Text.
 *  2. `haengt` — der Lauf hat begonnen und nie geendet. Er meldet nichts,
 *     weil er nie dazu kommt.
 *  3. `ausgeblieben` — der Lauf ist gar nicht erst gestartet. **Er erzeugt
 *     keinen Fehler, er erzeugt nur nichts.** Kein Protokoll hat eine Zeile
 *     dafür; sichtbar wird er ausschliesslich im Vergleich mit dem Zeitplan.
 *
 * **Warum kein Schwellwert erfunden wird.** Der Erwartungsabstand kommt aus
 * dem Cron des Jobs (`erwartungsabstand`), nicht aus einer Zahl daneben. Wo
 * der Zeitplan an den Kalender gebunden ist, sagt die Überwachung „nicht
 * beurteilbar" statt zu raten — ein Bildschirm, der grundlos rot ist, wird
 * nach zwei Wochen nicht mehr gelesen, und dann steht der echte Ausfall auch
 * darin.
 *
 * **Eine Uhr, und zwar die der Datenbank.** Das Alter eines Laufs rechnet
 * Postgres aus (`now() - gestartet_am`), nicht der Node-Prozess: `gestartet_am`
 * ist mit der Datenbankuhr gestempelt, und zwei Uhren, die gegeneinander
 * laufen, erzeugen genau an der Schwelle einen Fehlalarm oder ein Schweigen
 * (Invariante 2, Invariante 5).
 */
import type { JobBereich, JobDefinition } from '@/server/jobs/registry';
import { erwartungsabstand, type Erwartung } from '@/server/jobs/zeitplan';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
  readonly aktiverMandantId: string;
}

/**
 * **Wie viele ausgefallene Auslöser sind einer zu viel?**
 *
 * Einer. Der Faktor ist trotzdem zwei, und das ist keine Grosszügigkeit,
 * sondern die Grenze zwischen Tatsache und Vermutung: genau beim einfachen
 * Abstand ist der nächste Lauf gerade erst fällig — er kann in der Warteschlange
 * stehen, der Auslöser kann Sekunden brauchen. Beim doppelten Abstand ist ein
 * Auslöser BEWEISBAR ausgefallen, und ein Befund, der beweisbar ist, wird
 * geglaubt.
 *
 * Dieselbe Zahl gilt für einen Lauf, der begonnen und nie geendet hat: wer
 * länger läuft als zwei seiner eigenen Abstände, wartet nicht mehr, er hängt.
 */
export const AUSGEBLIEBEN_FAKTOR = 2;

export type Befundart =
  /** Der letzte Lauf ist gescheitert. */
  | 'fehler'
  /** Der letzte Lauf hat begonnen und nie geendet. */
  | 'haengt'
  /** Der Lauf lief, aber nicht für jede Gesellschaft. */
  | 'teilweise'
  /** Der Zeitplan verlangt einen Lauf, es kam keiner. */
  | 'ausgeblieben'
  /** Dieser Job hat in dieser Datenbank noch nie gelaufen. */
  | 'nie_gelaufen';

/** Der Rang entscheidet die Reihenfolge — oben, was jemanden weckt. */
const RANG: Readonly<Record<Befundart, number>> = {
  fehler: 0, haengt: 1, teilweise: 2, ausgeblieben: 3, nie_gelaufen: 4,
};

export const BEFUND_LABEL: Readonly<Record<Befundart, string>> = {
  fehler: 'Gescheitert',
  haengt: 'Hängt',
  teilweise: 'Teilweise gescheitert',
  ausgeblieben: 'Ausgeblieben',
  nie_gelaufen: 'Noch nie gelaufen',
};

/** Was ein Fehler dieser EINEN Gesellschaft war — aus `job_lauf_mandant`. */
export interface MandantFehler {
  readonly ergebnis: string;
  readonly fehlertext: string | null;
  readonly zeitpunkt: string;
}

export interface Befund {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly zeitplan: string;
  readonly bereich: JobBereich;
  readonly art: Befundart;
  /** Der letzte Lauf — bei `nie_gelaufen` gibt es keinen. */
  readonly laufId: string | null;
  readonly zuletzt: string | null;
  readonly alterText: string | null;
  readonly fehlertext: string | null;
  /**
   * Bei `teilweise`: wie viele Gesellschaften der Lauf nicht geschafft hat —
   * aus den Kennzahlen des Laufs, plattformweit gezählt.
   */
  readonly fehlerhafteMandanten: number | null;
  /** Was davon DIESE Gesellschaft betrifft. Leer heisst: hier nichts. */
  readonly hier: readonly MandantFehler[];
  readonly erwartung: string;
  /**
   * Wie viele Läufe dieses Jobs begonnen und nie geendet haben. Die Zahl steht
   * auch dann da, wenn ein schwererer Befund den Rang gewinnt — ein hängender
   * Lauf verschwindet sonst hinter einem gescheiterten.
   */
  readonly haengende: number;
}

/** Eine Zeile der Gesamtliste: jeder Job mit seinem letzten Stand. */
export interface Laufstand {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly zeitplan: string;
  readonly bereich: JobBereich;
  readonly erwartung: string;
  readonly beurteilbar: boolean;
  readonly zuletzt: string | null;
  readonly ergebnis: string | null;
  readonly befund: Befundart | null;
}

/** Ein gescheiterter Lauf im Rückblick — auch wenn danach einer gelang. */
export interface Fehllauf {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly gestartet: string;
  readonly ergebnis: string;
  readonly fehlertext: string | null;
  readonly hier: readonly MandantFehler[];
}

/** Ob überhaupt ein Auslöser eingerichtet ist — die Frage vor allen anderen. */
export interface Ausloeser {
  readonly erweiterung: boolean;
  readonly eintraege: number | null;
  readonly erwartet: number;
  readonly text: string;
}

export interface Betriebslage {
  readonly mandantId: string;
  readonly stand: string;
  readonly ausloeser: Ausloeser;
  readonly befunde: readonly Befund[];
  readonly staende: readonly Laufstand[];
  readonly fehllaeufe: readonly Fehllauf[];
  readonly unauffaellig: number;
  readonly unbeurteilbar: number;
}

interface LaufZeile {
  readonly job: string;
  readonly id: string;
  readonly gestartet_am: Date;
  readonly beendet_am: Date | null;
  readonly ergebnis: string | null;
  readonly fehlertext: string | null;
  readonly kennzahlen: Record<string, unknown> | null;
  readonly alter_minuten: number;
}

/**
 * Ein Lauf, der begonnen und nie geendet hat.
 *
 * **Er wird eigens gesucht, und das ist der Punkt.** Die Liste „letzter Lauf je
 * Job" zeigt ihn nicht: sobald ein neuer Lauf startet, steht der alte nicht
 * mehr vorn — und genau der ist der aufgegebene. Wer nur den neuesten Lauf
 * ansieht, sieht einen hängenden Lauf nie wieder, nachdem der nächste
 * losgelaufen ist.
 */
interface OffeneZeile {
  readonly id: string;
  readonly job: string;
  readonly gestartet_am: Date;
  readonly alter_minuten: number;
  /** Ein neuerer Lauf desselben Jobs existiert — dieser wird nie mehr beendet. */
  readonly ueberholt: boolean;
}

interface MandantZeile {
  readonly job_lauf_id: string;
  readonly ergebnis: string;
  readonly fehlertext: string | null;
  readonly erstellt_am: Date;
}

const ZEIT = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
  /*
   * Die Zone steht dabei — sonst sähen die beiden `02:30` der
   * Rückstellungsnacht gleich aus, und ein Lauf, der eine Stunde später
   * scheiterte, wäre vom früheren nicht zu unterscheiden (D-583).
   */
  timeZone: 'Europe/Berlin', timeZoneName: 'short',
});

/** Minuten als Satz — „vor 3 Stunden" liest sich, „vor 187 Minuten" nicht. */
export function alterText(minuten: number): string {
  const m = Math.floor(minuten);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${String(m)} Minuten`;
  const stunden = Math.floor(m / 60);
  if (stunden < 48) return `vor ${String(stunden)} Stunden`;
  return `vor ${String(Math.floor(stunden / 24))} Tagen`;
}

/** Der Erwartungsabstand als Satz — die Grundlage jedes Ausbleibens. */
export function erwartungText(e: Erwartung): string {
  if (e.art === 'unbestimmt') return e.grund;
  if (e.minuten < 60) return `alle ${String(e.minuten)} Minuten`;
  if (e.minuten < 1440) return `alle ${String(Math.round(e.minuten / 60))} Stunden`;
  const tage = Math.round(e.minuten / 1440);
  return tage === 1 ? 'einmal täglich' : `alle ${String(tage)} Tage`;
}

export function ausloeserLage(erweiterung: boolean, eintraege: number | null, erwartet: number): Ausloeser {
  if (!erweiterung) {
    return {
      erweiterung, eintraege, erwartet,
      text: 'Die Erweiterung `pg_cron` ist in dieser Datenbank nicht eingerichtet. '
        + 'Kein Lauf startet von selbst — was unten „noch nie gelaufen" heisst, hat '
        + 'hier seine Ursache. Der Plan steht in `docs/JOB-AUSLOESER.sql` und wird einmal '
        + 'eingespielt (`pnpm jobs:plan`).',
    };
  }
  if (eintraege === null) {
    return {
      erweiterung, eintraege, erwartet,
      text: '`pg_cron` ist eingerichtet, aber `cron.job` ist für diese Verbindung nicht '
        + 'lesbar. Ob die Einträge stehen, sagt dieser Bildschirm deshalb nicht — '
        + 'geraten wird es nicht.',
    };
  }
  if (eintraege < erwartet) {
    return {
      erweiterung, eintraege, erwartet,
      text: `${String(eintraege)} von ${String(erwartet)} Einträgen stehen in `
        + '`cron.job`. Für die fehlenden startet nichts. `pnpm jobs:plan` erzeugt den '
        + 'vollständigen Plan neu.',
    };
  }
  return {
    erweiterung, eintraege, erwartet,
    text: `Alle ${String(erwartet)} Läufe sind in \`cron.job\` eingetragen.`,
  };
}

/**
 * Liest die Lage: jeder registrierte Job gegen sein Laufprotokoll.
 *
 * `job_lauf` trägt kein `mandant_id` (0010) — die Läufe sind plattformweit,
 * und lesbar ist die Tabelle nur mit `system.betrieb_lesen` gegen den aktiven
 * Mandanten. Was je Gesellschaft schiefging, steht in `job_lauf_mandant`, und
 * das ist ein Mandantendatum: **die Fehler anderer Gesellschaften stehen hier
 * nicht**, sondern in deren Betriebsansicht. Der Bildschirm sagt das, statt
 * eine leere Liste als „nichts passiert" durchgehen zu lassen.
 */
export async function liesBetriebslage(
  kontext: Abfrage, alle: readonly JobDefinition[],
): Promise<Betriebslage> {
  const letzte = await kontext.abfrage<LaufZeile>(
    `select distinct on (l.job)
            l.job, l.id, l.gestartet_am, l.beendet_am, l.ergebnis::text as ergebnis,
            l.fehlertext, l.kennzahlen,
            (extract(epoch from (now() - l.gestartet_am)) / 60)::float8 as alter_minuten
       from job_lauf l
      order by l.job, l.gestartet_am desc`);

  const offene = await kontext.abfrage<OffeneZeile>(
    `select l.id, l.job, l.gestartet_am,
            (extract(epoch from (now() - l.gestartet_am)) / 60)::float8 as alter_minuten,
            exists (select 1 from job_lauf n
                     where n.job = l.job and n.gestartet_am > l.gestartet_am) as ueberholt
       from job_lauf l
      where l.beendet_am is null
      order by l.gestartet_am`);

  const fehlerRoh = await kontext.abfrage<LaufZeile>(
    `select l.job, l.id, l.gestartet_am, l.beendet_am, l.ergebnis::text as ergebnis,
            l.fehlertext, l.kennzahlen,
            (extract(epoch from (now() - l.gestartet_am)) / 60)::float8 as alter_minuten
       from job_lauf l
      where l.ergebnis in ('fehler','teilweise','abgebrochen')
      order by l.gestartet_am desc
      limit 20`);

  const laufIds = [...new Set([...letzte, ...fehlerRoh].map((l) => l.id))];
  const jeMandant = laufIds.length === 0 ? [] : await kontext.abfrage<MandantZeile>(
    `select job_lauf_id, ergebnis::text as ergebnis, fehlertext, erstellt_am
       from job_lauf_mandant
      where ergebnis <> 'erfolg' and job_lauf_id = any($1::uuid[])
      order by erstellt_am`, [laufIds]);
  const hierJeLauf = new Map<string, MandantFehler[]>();
  for (const z of jeMandant) {
    const liste = hierJeLauf.get(z.job_lauf_id) ?? [];
    liste.push({
      ergebnis: z.ergebnis, fehlertext: z.fehlertext, zeitpunkt: ZEIT.format(z.erstellt_am),
    });
    hierJeLauf.set(z.job_lauf_id, liste);
  }

  /*
   * Uhr und Auslöser in EINER Zeile.
   *
   * Die Uhr ist die der DATENBANK, und sie hat keinen Ersatz: `gestartet_am`
   * ist mit ihr gestempelt, und die Alter oben sind mit ihr gerechnet. Eine
   * Ausweichuhr aus dem Node-Prozess wäre eine zweite, die gegen die erste
   * läuft — genau an der Schwelle entstünde dann ein Fehlalarm oder ein
   * Schweigen. Bleibt die Zeile aus, endet das hier laut.
   *
   * Der Auslöser daneben: `pg_extension` liest jede Rolle, `cron.job` nicht
   * unbedingt. Deshalb wird die Leseerlaubnis GEFRAGT, statt die Abfrage zu
   * wagen — ein Fehler mitten in der Transaktion bräche sie ab, und die ganze
   * Seite wäre weg, weil eine Nebenauskunft fehlt.
   */
  const [umgebung] = await kontext.abfrage<{
    jetzt: Date; erweiterung: boolean; lesbar: boolean;
  }>(`select now() as jetzt,
             exists (select 1 from pg_extension where extname = 'pg_cron') as erweiterung,
             coalesce((select has_table_privilege(c.oid, 'select')
                         from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'cron' and c.relname = 'job'), false) as lesbar`);
  if (umgebung === undefined) {
    throw new Error(
      'Die Datenbank hat auf `select now()` keine Zeile geliefert. Ohne ihre Uhr '
      + 'rechnet diese Überwachung nicht mit der Prozessuhr weiter — zwei Uhren '
      + 'erzeugen genau an der Schwelle einen Fehlalarm oder ein Schweigen.');
  }
  let eintraege: number | null = null;
  if (umgebung.erweiterung && umgebung.lesbar) {
    const [z] = await kontext.abfrage<{ anzahl: number }>(
      `select count(*)::int as anzahl from cron.job where jobname like 'cse\\_%'`);
    eintraege = z?.anzahl ?? 0;
  }

  const letzterJeJob = new Map(letzte.map((l) => [l.job, l]));
  const offeneJeJob = new Map<string, OffeneZeile[]>();
  for (const o of offene) offeneJeJob.set(o.job, [...(offeneJeJob.get(o.job) ?? []), o]);
  const befunde: Befund[] = [];
  const staende: Laufstand[] = [];
  let unbeurteilbar = 0;

  for (const job of [...alle].sort((a, b) => a.schluessel.localeCompare(b.schluessel, 'de'))) {
    const e = erwartungsabstand(job.zeitplan);
    const text = erwartungText(e);
    if (e.art === 'unbestimmt') unbeurteilbar += 1;
    const lauf = letzterJeJob.get(job.schluessel);

    /*
     * **Ein offener Lauf ist zunächst ein LAUFENDER** — das ist kein Befund.
     * Er wird einer, wenn ihn ein neuerer Lauf überholt hat (dann wird er nie
     * mehr beendet) oder wenn er länger offen ist als zwei seiner eigenen
     * Abstände.
     */
    const haengende = (offeneJeJob.get(job.schluessel) ?? []).filter(
      (o) => o.ueberholt
        || (e.art === 'bekannt' && o.alter_minuten > e.minuten * AUSGEBLIEBEN_FAKTOR));

    /* Der Zustand aus dem NEUESTEN Lauf — ohne das Hängen, das eigens gesucht wird. */
    let primaer: Befundart | null = null;
    if (lauf === undefined) {
      primaer = 'nie_gelaufen';
    } else if (lauf.ergebnis === 'fehler' || lauf.ergebnis === 'abgebrochen') {
      primaer = 'fehler';
    } else if (lauf.ergebnis === 'teilweise') {
      primaer = 'teilweise';
    } else if (lauf.beendet_am !== null && e.art === 'bekannt'
      && lauf.alter_minuten > e.minuten * AUSGEBLIEBEN_FAKTOR) {
      primaer = 'ausgeblieben';
    }

    /*
     * Zwei Befunde für denselben Job wären zwei Zeilen für ein Problem. Es
     * gewinnt der schwerere — und die Zahl der hängenden Läufe steht daneben,
     * damit der unterlegene nicht verschwindet.
     */
    const art = [primaer, haengende.length > 0 ? ('haengt' as const) : null]
      .filter((a): a is Befundart => a !== null)
      .sort((a, b) => RANG[a] - RANG[b])[0] ?? null;

    staende.push({
      schluessel: job.schluessel, bezeichnung: job.bezeichnung, zeitplan: job.zeitplan,
      bereich: job.bereich, erwartung: text, beurteilbar: e.art === 'bekannt',
      zuletzt: lauf === undefined ? null : ZEIT.format(lauf.gestartet_am),
      ergebnis: lauf === undefined ? null : (lauf.ergebnis ?? 'läuft'),
      befund: art,
    });

    if (art === null) continue;
    /* Bei `haengt` zeigt der Befund den ÄLTESTEN hängenden Lauf, nicht den neuesten. */
    const bezug = art === 'haengt' ? haengende[0] : lauf;
    const fehlerhaft = lauf?.kennzahlen?.['fehlerhaft'];
    befunde.push({
      schluessel: job.schluessel, bezeichnung: job.bezeichnung, zeitplan: job.zeitplan,
      bereich: job.bereich, art,
      laufId: bezug?.id ?? null,
      zuletzt: bezug === undefined ? null : ZEIT.format(bezug.gestartet_am),
      alterText: bezug === undefined ? null : alterText(bezug.alter_minuten),
      fehlertext: art === 'haengt' ? null : (lauf?.fehlertext ?? null),
      fehlerhafteMandanten: art === 'haengt' || typeof fehlerhaft !== 'number'
        ? null : fehlerhaft,
      hier: bezug === undefined ? [] : (hierJeLauf.get(bezug.id) ?? []),
      erwartung: text,
      haengende: haengende.length,
    });
  }

  befunde.sort((a, b) => RANG[a.art] - RANG[b.art]
    || a.schluessel.localeCompare(b.schluessel, 'de'));

  const bezeichnungen = new Map(alle.map((j) => [j.schluessel, j.bezeichnung]));
  const fehllaeufe: readonly Fehllauf[] = fehlerRoh.map((l) => ({
    schluessel: l.job,
    /*
     * Ein Lauf im Protokoll, den das Register nicht mehr kennt, ist möglich:
     * ein Job kann ausgebaut worden sein. Sein Schlüssel bleibt trotzdem
     * lesbar, und das ist besser als ihn zu verschweigen.
     */
    bezeichnung: bezeichnungen.get(l.job) ?? `${l.job} (nicht mehr registriert)`,
    gestartet: ZEIT.format(l.gestartet_am),
    ergebnis: l.ergebnis ?? '—',
    fehlertext: l.fehlertext,
    hier: hierJeLauf.get(l.id) ?? [],
  }));

  return {
    mandantId: kontext.aktiverMandantId,
    stand: ZEIT.format(umgebung.jetzt),
    ausloeser: ausloeserLage(umgebung.erweiterung, eintraege, alle.length),
    befunde,
    staende,
    fehllaeufe,
    unauffaellig: alle.length - befunde.length,
    unbeurteilbar,
  };
}
