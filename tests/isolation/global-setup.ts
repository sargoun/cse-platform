/**
 * Vor dem ersten Arbeiter — einmal je Lauf (D-424).
 *
 *  0. Eine SPERRE je Basis fuer die Dauer des Laufs: ein zweiter Lauf auf
 *     derselben `cse_test` wird abgewiesen, nicht geduldet — er wuerde dem
 *     ersten die Arbeiterdatenbanken unter den Fuessen wegziehen.
 *  1. `scripts/test-db.sh up`: der Server steht, `cse_test` ist migriert und
 *     traegt den Fingerabdruck der Migrationen. Ist die Basis nicht
 *     jungfraeulich (die alte, serielle Suite liess ihre Fixturen darin), wird
 *     sie mit `neu` neu gebaut: die Vorlage entsteht aus Migrationen plus Seed
 *     und aus nichts sonst.
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
import postgres from 'postgres';
import {
  ANHANG_HOECHSTENS, anzahlWorker, datenbankName, kloneDatenbank, mitDatenbank,
  pruefeBezeichner, psql, verwaltungsUrl, vorlagenNamen, workerUrl,
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

/**
 * Der Fingerabdruck einer Vorlage: der Tag, dann Pfade und Inhalte.
 *
 * Der Tag, weil der Seed Einsaetze, Fristen und Abwesenheiten relativ zu
 * HEUTE anlegt (`seed/index.ts`, `seed/operations.ts`): eine Vorlage von
 * gestern traegt gestrige Zeilen, und `baueAuf()` haette dann nicht mehr
 * dasselbe Ergebnis wie der frische Seed, den es ersetzt. Einmal am Tag neu
 * zu bauen kostet anderthalb Minuten; Zeitstempel der Dateien zaehlen nicht.
 */
export function vorlagenAbdruck(tag: string = new Date().toISOString().slice(0, 10)): string {
  const h = createHash('sha256');
  h.update(tag);
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

/**
 * Mit dem `server-only`-Hook: der Seed durchlaeuft die Dienste des Portals
 * (`seed/eingang.ts` → `finanz/eingang/ablage.ts`), und die tragen den Marker
 * — zu Recht. Derselbe Aufruf wie `pnpm db:seed`.
 */
function tsx(skript: string, url: string): void {
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'), [
    '--import', join(WURZEL, 'scripts/hooks/server-only.mjs'), join(WURZEL, skript),
  ], {
    cwd: WURZEL, stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
  });
}

function testDb(befehl: 'up' | 'neu'): void {
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), befehl], {
    cwd: WURZEL, stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: BASIS_URL },
  });
}

/**
 * Die Sperre des Laufs — eine Beratungssperre (`pg_advisory_lock`) auf dem
 * Server, gehalten von EINER Verbindung, die erst der Abbau schliesst.
 *
 * Die Sperre in `test-db.sh` deckt nur den Aufbau der Basis; was hier
 * folgt — Verbindungen kappen, Vorlagen und Arbeiterdatenbanken mit `drop …
 * with (force)` neu klonen — traefe einen zweiten Lauf mitten in seinen
 * Tests. Eine Dateisperre nuetzte nichts: sie muesste den ganzen Lauf
 * halten, und ein abgestuerzter Prozess liesse sie liegen. Die Sitzung
 * dagegen endet mit dem Prozess, und mit ihr die Sperre.
 */
let sperre: postgres.Sql | null = null;

async function sperren(verwaltung: string, basisName: string): Promise<void> {
  sperre = postgres(verwaltung, { max: 1, onnotice: () => {} });
  const [zeile] = await sperre<{ frei: boolean }[]>`
    select pg_try_advisory_lock(hashtext(${`cse-isolation:${basisName}`})) as frei`;
  if (zeile?.frei !== true) {
    await sperre.end({ timeout: 5 });
    sperre = null;
    throw new Error(
      `Ein anderer Lauf der Isolationssuite arbeitet gerade auf ${basisName} — zwei Laeufe `
      + 'auf derselben Basis zoegen einander die Datenbanken weg. Warten, bis er fertig ist, '
      + 'oder TEST_DATABASE_URL auf eine andere Basis zeigen lassen.',
    );
  }
}

export default async function aufbau(): Promise<() => Promise<void>> {
  // Mit Platz fuer den laengsten Anhang: `cse_test` + `_vorlage_inhalt` muss
  // unter den 63 Zeichen bleiben, die Postgres einem Namen laesst — sonst
  // kuerzt der Server still, und zwei Namen fallen zusammen.
  const basisName = pruefeBezeichner(datenbankName(BASIS_URL), ANHANG_HOECHSTENS);
  const verwaltung = verwaltungsUrl(BASIS_URL);
  const vorlagen = vorlagenNamen(basisName);
  const sage = (zeile: string): void => { process.stdout.write(`${zeile}\n`); };

  // 1. Server und migrierte Basis — wie bisher, mit demselben Fingerabdruck.
  testDb('up');
  await sperren(verwaltung, basisName);

  // Jungfraeulich heisst: keine Gesellschaft, kein Mensch, kein Konto. Eine
  // Migration legt nichts davon an; die alte, serielle Suite liess genau das
  // in `cse_test` zurueck, und `up` bewahrt es, weil der Migrationsstand
  // stimmt. Eine Vorlage aus solcher Basis erbte fremde Zeilen.
  const schmutzig = psql(BASIS_URL,
    `select exists (select 1 from mandant) or exists (select 1 from person)
         or exists (select 1 from auth.users)`);
  if (schmutzig === 't') {
    sage(`${basisName} traegt Zeilen, die keine Migration anlegt — wird neu gebaut.`);
    testDb('neu');
  }

  // `create database … template` verlangt, dass NIEMAND sonst an der Vorlage
  // haengt. Was jetzt noch an `cse_test` haengt, ist ein Server, der auf die
  // Testdatenbank zeigt, oder eine offene Shell — beides gehoert nicht in
  // einen Testlauf, und `test-db.sh neu` kappt es genauso.
  const gekappt = psql(verwaltung,
    `select count(pg_terminate_backend(pid)) from pg_stat_activity
      where datname = '${basisName}' and pid <> pg_backend_pid()`);
  if (gekappt !== '0') sage(`${gekappt} offene Verbindung(en) zu ${basisName} gekappt.`);

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

  // Der Abbau gibt die Sperre frei — und nichts sonst: die Datenbanken
  // bleiben stehen, damit ein Fehlschlag sich noch ansehen laesst.
  return async () => {
    await sperre?.end({ timeout: 5 });
    sperre = null;
  };
}
