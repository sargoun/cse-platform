/**
 * `pnpm jobs:plan` — schreibt den Auslöseplan aus dem Job-Register.
 *
 * Er landet in `docs/JOB-AUSLOESER.sql` und gehört in die Versionsgeschichte:
 * was wann läuft, ist eine Betriebsentscheidung und keine Einstellung, die
 * jemand still in einer Konsole klickt. Das GEHEIMNIS steht nicht darin —
 * der erzeugte Text liest es aus `cse.job_token` (siehe `jobs/zeitplan.ts`).
 *
 * Die Basisadresse kommt aus `CSE_KANONISCHE_BASIS`, derselben Quelle wie
 * `sitemap.xml` und jeder JSON-LD-`@id`. Zwei Wahrheiten über den eigenen
 * Host gibt es nicht.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alleJobs } from '../src/server/jobs/bootstrap.js';
import { cronPlanSql } from '../src/server/jobs/zeitplan.js';

/**
 * **Die eingecheckte Fassung traegt KEINEN plausiblen Host.**
 *
 * Eine erzeugte Datei mit `https://cse-gruppe.example` darin sieht fertig aus,
 * und irgendwann fuegt sie jemand in eine Produktionskonsole ein. Dann steht
 * ein Cron-Eintrag in der echten Datenbank, der jede Nacht eine fremde Adresse
 * ruft — mit dem Geheimnis im Kopf. Deshalb ist die Vorgabe
 * `.invalid`: RFC 2606 reserviert die Endung, sie loest nirgends auf, und ein
 * versehentliches Einfuegen scheitert sofort und laut statt still und falsch.
 *
 * Wer den Plan wirklich einspielt, erzeugt ihn mit der echten Basis:
 *   CSE_KANONISCHE_BASIS=https://… pnpm jobs:plan
 */
const PLATZHALTER = 'https://basis-einsetzen.invalid';
const basis = process.env['CSE_KANONISCHE_BASIS'] ?? PLATZHALTER;

/*
 * Die Registrierung braucht eine Abfrage — hier wird keine gestellt: `alleJobs`
 * reicht sie nur an die Jobfunktionen weiter, die erst beim LAUFEN abfragen.
 * Ein Stummel, der bei Benutzung wirft, ist deshalb richtig: er kann nur
 * anschlagen, wenn jemand diese Annahme bricht.
 */
const nie = (): never => {
  throw new Error('Der Planer stellt keine Abfragen — hier laeuft kein Job.');
};
const jobs = alleJobs({ unsafe: nie, begin: nie });

const ziel = resolve(import.meta.dirname, '../docs/JOB-AUSLOESER.sql');
writeFileSync(ziel, cronPlanSql(jobs, { basis }), 'utf8');
process.stdout.write(`${String(jobs.length)} Jobs → docs/JOB-AUSLOESER.sql\n`);
if (basis === PLATZHALTER) {
  process.stdout.write(
    'Basis: PLATZHALTER (.invalid). Fuer den Einsatz mit CSE_KANONISCHE_BASIS erzeugen.\n',
  );
}
