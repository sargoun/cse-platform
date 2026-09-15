import type { JobDefinition } from './registry.js';

/**
 * Der Auslöseplan — **erzeugt aus dem Register, nie daneben gepflegt**.
 *
 * **Der Befund, der diese Datei nötig machte.** Sechzehn Jobs tragen einen
 * Zeitplan (`zeitplan: '0 3 * * *'`), es gibt einen Runner, ein Laufprotokoll
 * und eine bewachte Auslöseroute — und nichts, das sie ruft. Kein
 * `vercel.json`, keine `cron.schedule`-Zeile, kein n8n-Ablauf. Jede Datei
 * einzeln gebaut und geprüft; zusammen läuft kein einziger Wächter. Das ist
 * dieselbe Lücke wie in `bootstrap.ts`, nur eine Ebene weiter draussen, und
 * sie wird nirgends rot: ein Test, der einen Job ausführt, beweist, dass er
 * funktioniert, und sagt nichts darüber, ob ihn jemand startet.
 *
 * **Warum erzeugt und nicht geschrieben.** Ein Zeitplan, der im Code steht und
 * ein zweites Mal in einer Cron-Tabelle, sind zwei Wahrheiten. Die eine ändert
 * jemand, die andere nicht — und der Job läuft dann zu einer Zeit, die kein
 * Mensch erwartet, oder gar nicht. Hier gibt es eine Quelle: `JobDefinition.
 * zeitplan`. Der Rest wird daraus gebaut, und `tests/kern/job-zeitplan.test.ts`
 * besteht darauf, dass jeder registrierte Job im Plan vorkommt.
 *
 * **Das Geheimnis steht NICHT hier.** Der erzeugte Text nennt
 * `current_setting('cse.job_token')` — eine Datenbankeinstellung, gesetzt wie
 * `cse.fenster_schluessel` (D-302). Ein Token in einer Migration ist ein Token
 * in der Versionsgeschichte, und dort bleibt es auch nach dem Wechsel.
 */

/** Wohin der Auslöser ruft. Ohne Basis kein Plan — geraten wird nichts. */
export interface PlanOptionen {
  /** Die öffentliche Adresse dieser Installation, z. B. `https://cse.example`. */
  readonly basis: string;
}

export interface Planzeile {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly zeitplan: string;
  readonly bereich: JobDefinition['bereich'];
  /** Der Name des Cron-Eintrags in `cron.job` — stabil über Neubauten. */
  readonly eintrag: string;
}

export function planzeilen(alle: readonly JobDefinition[]): readonly Planzeile[] {
  return [...alle]
    .sort((a, b) => a.schluessel.localeCompare(b.schluessel, 'de'))
    .map((j) => ({
      schluessel: j.schluessel,
      bezeichnung: j.bezeichnung,
      zeitplan: j.zeitplan,
      bereich: j.bereich,
      eintrag: `cse_${j.schluessel}`,
    }));
}

/**
 * Der Plan als SQL für Supabase cron (`pg_cron` + `pg_net`).
 *
 * **Warum Supabase cron und nicht Vercel cron.** Vercel ruft mit GET und ohne
 * eigene Kopfzeilen; `/api/jobs/[schluessel]` verlangt POST **und** das
 * Geheimnis in `x-job-token`. Eine Auslöseadresse, die ohne Geheimnis
 * funktionieren müsste, wäre ein Schalter für jeden, der die URL kennt — und
 * genau deshalb antwortet die Route 503, statt ersatzweise offen zu laufen.
 * `pg_net` kann beides, also macht es das. Das steht so auch im Stack
 * (CLAUDE.md: „Supabase cron + Edge Functions; n8n nur für externen Klebstoff").
 *
 * `cron.unschedule` davor: ein zweiter Lauf dieses Skripts soll den Eintrag
 * ERSETZEN, nicht verdoppeln. Zwei Einträge desselben Jobs sind zwei
 * Mahnläufe — die Idempotenz in `job_lauf` fängt das zwar ab, aber ein Plan,
 * der sich auf die Notbremse verlässt, ist keiner.
 */
export function cronPlanSql(
  alle: readonly JobDefinition[], optionen: PlanOptionen,
): string {
  const basis = optionen.basis.replace(/\/+$/u, '');
  if (!/^https?:\/\/[^\s/]+/u.test(basis)) {
    throw new Error(
      `„${optionen.basis}" ist keine Basisadresse. Ohne sie ruft der Auslöser ins Leere `
      + '— und geraten wird hier nichts.');
  }

  const kopf = [
    '-- ERZEUGT aus dem Job-Register (`src/server/jobs/zeitplan.ts`).',
    '-- Nicht von Hand ändern: `pnpm jobs:plan` schreibt diese Datei neu.',
    '--',
    '-- Vorher EINMAL, und nicht in einer Migration (das Token gehört nicht in',
    '-- die Versionsgeschichte):',
    '--   create extension if not exists pg_cron;',
    '--   create extension if not exists pg_net;',
    "--   alter database postgres set cse.job_token = '<das Geheimnis aus JOB_TOKEN>';",
    '',
  ].join('\n');

  const zeilen = planzeilen(alle).map((p) => [
    `-- ${p.bezeichnung} (${p.bereich})`,
    `select cron.unschedule('${p.eintrag}')`,
    `  where exists (select 1 from cron.job where jobname = '${p.eintrag}');`,
    `select cron.schedule('${p.eintrag}', '${p.zeitplan}', $cse$`,
    '  select net.http_post(',
    `    url     := '${basis}/api/jobs/${p.schluessel}',`,
    "    headers := jsonb_build_object('content-type', 'application/json',",
    "                                  'x-job-token', current_setting('cse.job_token')),",
    "    body    := '{}'::jsonb",
    '  );',
    '$cse$);',
  ].join('\n'));

  return `${kopf}${zeilen.join('\n\n')}\n`;
}
