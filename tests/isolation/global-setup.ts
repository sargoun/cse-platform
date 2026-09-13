/**
 * Vor dem ersten Arbeiter — einmal je Lauf (D-424).
 *
 *  1. `scripts/test-db.sh up`: der Server steht, `cse_test` ist migriert und
 *     traegt den Fingerabdruck der Migrationen. Unveraendert.
 *  2. Die Vorlage `cse_test_vorlage` — ein Klon von `cse_test` plus der ECHTE
 *     Seed — und `cse_test_vorlage_inhalt`, dieselbe plus die Texte der
 *     oeffentlichen Seiten. Beide tragen einen Fingerabdruck ueber alles,
 *     woraus sie entstehen; stimmt er, wird nicht neu gebaut.
 *  3. Je Arbeiter eine Datenbank `cse_test_w<n>`, geklont aus `cse_test`.
 *
 * **Warum Klone und nicht fuenf Seeds.** Fuenf Dateien fuhren je einen
 * eigenen `test-db.sh neu` (108 Migrationen) und einen eigenen Seed — rund
 * anderthalb Minuten je Datei, siebeneinhalb im Lauf. `create database …
 * template` kopiert dieselben Bytes in einer Sekunde. Der Seed laeuft
 * weiterhin, nur einmal; was `seed.test.ts` ueber ihn beweist, beweist es
 * am Klon der Vorlage genauso, denn der Klon IST die geseedete Datenbank.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import {
  anzahlWorker, datenbankName, kloneDatenbank, mitDatenbank, pruefeBezeichner, psql,
  verwaltungsUrl, vorlagenNamen, workerUrl,
} from './parallel.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const BASIS_URL = process.env['TEST_DATABASE_URL']
  ?? 'postgres://postgres@localhost:55432/cse_test';

/**
 * Was in eine Vorlage eingeht.
 *
 * Nicht nur der Seed selbst: er importiert die Dienste, die er vorfuehrt
 * (Nummernkreis, Rechnung, Dienstplan …), und der Inhaltsimport die
 * Seitentexte. Der Abdruck nimmt deshalb den ganzen Baum, aus dem beide
 * importieren koennen — und nicht eine Liste, die beim naechsten Import
 * veraltet. Eine Aenderung darin kostet einen Neubau von zwei Minuten; eine
 * Vorlage, die nicht mehr zum Code passt, kostete einen gruenen Lauf ueber
 * einen falschen Seed. In CI ist der Container frisch: dort wird immer gebaut.
 */
const VORLAGEN_QUELLEN = [
  'drizzle',
  'src',
  'scripts',
  'package.json',
  'pnpm-lock.yaml',
  'tests/isolation/global-setup.ts',
  'tests/isolation/parallel.ts',
];

function dateienUnter(pfad: string): string[] {
  const voll = join(WURZEL, pfad);
  if (statSync(voll).isFile()) return [voll];
  return readdirSync(voll, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name))
    .sort();
}

/** Der Fingerabdruck einer Vorlage: Pfade und Inhalte, keine Zeitstempel. */
export function vorlagenAbdruck(): string {
  const h = createHash('sha256');
  for (const quelle of VORLAGEN_QUELLEN) {
    for (const datei of dateienUnter(quelle)) {
      h.update(datei.slice(WURZEL.length));
      h.update(readFileSync(datei));
    }
  }
  return h.digest('hex').slice(0, 32);
}

/** Der Fingerabdruck einer vorhandenen Datenbank — ohne Verbindung zu ihr. */
function abdruckVon(verwaltung: string, name: string): string {
  return psql(verwaltung,
    `select coalesce((select split_part(s, '=', 2)
                        from pg_db_role_setting r
                        join pg_database d on d.oid = r.setdatabase,
                             unnest(r.setconfig) as s
                       where d.datname = '${pruefeBezeichner(name)}' and s like 'cse.vorlage=%'
                       limit 1), '')`);
}

function tsx(skript: string, url: string): void {
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'), [join(WURZEL, skript)], {
    cwd: WURZEL, stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
  });
}

export default function aufbau(): void {
  const basisName = pruefeBezeichner(datenbankName(BASIS_URL));
  const verwaltung = verwaltungsUrl(BASIS_URL);
  const vorlagen = vorlagenNamen(basisName);
  const sage = (zeile: string): void => { process.stdout.write(`${zeile}\n`); };

  // 1. Server und migrierte Basis — wie bisher, mit demselben Fingerabdruck.
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'up'], {
    cwd: WURZEL, stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: BASIS_URL },
  });

  // `create database … template` verlangt, dass NIEMAND sonst an der Vorlage
  // haengt. Was jetzt noch an `cse_test` haengt, ist ein abgebrochener Lauf
  // oder ein Server, der auf die Testdatenbank zeigt — beides gehoert nicht
  // in einen Testlauf, und `test-db.sh neu` kappt es genauso.
  const gekappt = psql(verwaltung,
    `select count(pg_terminate_backend(pid)) from pg_stat_activity
      where datname = '${basisName}' and pid <> pg_backend_pid()`);
  if (gekappt !== '0') sage(`${gekappt} offene Verbindung(en) zu ${basisName} gekappt — ein frueherer Lauf?`);

  // 2. Die Vorlagen — nur, wenn sich etwas geaendert hat.
  const abdruck = vorlagenAbdruck();
  const vorhanden = abdruckVon(verwaltung, vorlagen.seed) === abdruck
    && abdruckVon(verwaltung, vorlagen.inhalt) === abdruck;
  if (vorhanden) {
    sage(`Vorlagen stehen auf Stand ${abdruck.slice(0, 8)} — nichts angefasst.`);
  } else {
    sage(`Vorlagen werden gebaut (${abdruck.slice(0, 8)}): Seed …`);
    kloneDatenbank(verwaltung, vorlagen.seed, basisName);
    tsx('src/server/db/seed/index.ts', mitDatenbank(BASIS_URL, vorlagen.seed));
    // Der Abdruck kommt ERST nach dem Seed: eine halb gebaute Vorlage —
    // abgebrochener Lauf, Fehler in der Mitte — traegt keinen, und der
    // naechste Lauf baut sie neu, statt sie fuer fertig zu halten.
    psql(verwaltung, `alter database "${vorlagen.seed}" set cse.vorlage = '${abdruck}'`);

    sage('… und Inhaltsimport.');
    kloneDatenbank(verwaltung, vorlagen.inhalt, vorlagen.seed);
    tsx('scripts/content-import.ts', mitDatenbank(BASIS_URL, vorlagen.inhalt));
    psql(verwaltung, `alter database "${vorlagen.inhalt}" set cse.vorlage = '${abdruck}'`);
  }

  // 3. Je Arbeiter ein frischer Klon der migrierten Basis.
  const anzahl = anzahlWorker(process.env, availableParallelism());
  for (let i = 1; i <= anzahl; i += 1) {
    kloneDatenbank(verwaltung, datenbankName(workerUrl(BASIS_URL, String(i))), basisName);
  }
  sage(`${String(anzahl)} Arbeiter, je eine Datenbank ${basisName}_w1 … ${basisName}_w${String(anzahl)}.`);
}
