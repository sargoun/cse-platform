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

/**
 * **Wie lange gilt EIN Lauf als derselbe Lauf?**
 *
 * `/api/jobs/[schluessel]` bildet den Idempotenzschluessel aus
 * `<job>:<Berliner Datum>` — und das ist fuer einen Nachtlauf genau richtig:
 * zwei Ausloeser derselben Nacht ergeben einen Lauf, kein zweites Mahnwesen.
 *
 * **Fuer einen Lauf alle fuenf Minuten ist es toedlich.** `social_plan` traegt
 * einen Zeitplan mit `Stern-Schraegstrich-5` in der Minute: nach dem ERSTEN
 * Lauf eines Tages faende jeder weitere seinen
 * Schluessel schon vergeben und wuerde uebersprungen. Ein Beitrag, der auf
 * 14:00 gelegt ist, ginge dann bis zum naechsten Morgen nicht hinaus — und der
 * Lauf meldete brav „uebersprungen", also nicht einmal einen Fehler. Genau die
 * Sorte Ausfall, die dieses Register sonst verhindert.
 *
 * Das Fenster kommt deshalb aus dem ZEITPLAN und nicht aus einer zweiten
 * Angabe daneben: es gibt eine Quelle dafuer, wie oft ein Lauf laeuft, und
 * das ist sein Cron.
 *
 * Gelesen werden nur die beiden Felder, die ueber „oefter als taeglich"
 * entscheiden: Minute und Stunde. Der Rest — Tag, Monat, Wochentag — kann ein
 * Fenster nur noch SELTENER machen, nie haeufiger, und ein zu kleines Fenster
 * laesst hoechstens einen doppelten Ausloeser durch; ein zu grosses legt einen
 * Lauf still. Deshalb wird nach unten gerundet.
 *
 * **Und was sie nicht lesen kann, raet sie nicht, sondern wirft.** Eine
 * Minutenliste (`15,45 * * * *`) heisst zweimal je Stunde, dreissig Minuten
 * auseinander; stillschweigend „taeglich" daraus zu machen waere genau der
 * Ausfall, den diese Funktion verhindern soll — nur eine Ebene tiefer
 * versteckt. `tests/kern/job-zeitplan.test.ts` ruft sie fuer JEDEN
 * registrierten Job auf, ein unlesbarer Zeitplan wird also beim Festschreiben
 * rot und nicht im Betrieb still.
 */
export function fensterMinuten(zeitplan: string): number {
  const [minute, stunde] = zeitplan.trim().split(/\s+/u);
  if (minute === undefined || stunde === undefined) {
    throw new Error(
      `„${zeitplan}" ist kein Zeitplan. Ohne Minute und Stunde laesst sich nicht `
      + 'sagen, wie oft ein Lauf laeuft — und geraten wird das hier nicht.');
  }

  if (minute === '*') return 1;
  const jedeNMinuten = /^\*\/([0-9]+)$/u.exec(minute);
  if (jedeNMinuten !== null) {
    const n = Number(jedeNMinuten[1]);
    // `*/60` und groesser trifft in jeder Stunde nur die Minute 0.
    if (n > 0 && n < 60) return n;
    if (n >= 60) return 60;
    throw new Error(`„${zeitplan}": „${minute}" ist kein Minutenschritt.`);
  }
  if (!/^[0-9]{1,2}$/u.test(minute) || Number(minute) > 59) {
    throw new Error(
      `„${zeitplan}": „${minute}" ist keine feste Minute und kein Schritt. `
      + 'Eine Liste oder Spanne kann mehrmals je Stunde treffen; welches Fenster '
      + 'dann gilt, steht hier nicht — statt es zu raten, bleibt der Zeitplan '
      + 'ungelesen.');
  }

  /*
   * Feste Minute: zwei Laeufe liegen damit mindestens eine Stunde
   * auseinander. 60 ist deshalb IMMER sicher; was die Stunde hergibt, macht
   * das Fenster nur noch groesser — und ein groesseres Fenster faengt mehr
   * doppelte Ausloeser ab. Eine Stundenliste (`8-18`, `6,18`) faellt deshalb
   * auf 60 und nicht auf einen Fehler: sie ist lesbar genug fuer die einzige
   * Frage, die hier gestellt wird.
   */
  if (stunde === '*') return 60;
  const jedeNStunden = /^\*\/([0-9]+)$/u.exec(stunde);
  if (jedeNStunden !== null) {
    const n = Number(jedeNStunden[1]);
    return n > 0 && n < 24 ? n * 60 : 1440;
  }
  if (/^[0-9]{1,2}$/u.test(stunde) && Number(stunde) <= 23) return 1440;
  return 60;
}

/**
 * Der Idempotenzschluessel eines Laufs — auf sein Fenster abgerundet.
 *
 * `jetzt` wird hereingereicht und nicht gelesen: ein Schluessel, der von der
 * Uhr der Funktion abhaengt, laesst sich ueber die Zeitgrenze nicht pruefen
 * (dieselbe Ueberlegung wie bei `planFehler`, Invariante 5).
 *
 * Gerechnet wird in BERLINER Minuten seit der Epoche, damit der taegliche
 * Fall („ein Lauf je Kalendertag") derselbe bleibt wie vorher: der
 * Tagesschluessel eines Laufs um 03:00 Berliner Zeit ist derselbe, ob im
 * Sommer oder im Winter.
 */
export function idempotenzSchluessel(
  schluessel: string, zeitplan: string, jetzt: Date, versatzMinuten: number,
): string {
  const fenster = fensterMinuten(zeitplan);
  const berlinMinuten = Math.floor(jetzt.getTime() / 60_000) + versatzMinuten;
  const eimer = Math.floor(berlinMinuten / fenster) * fenster;
  if (fenster >= 1440) {
    /*
     * Taeglich: derselbe Schluessel wie bisher — das BERLINER Kalenderdatum,
     * dasselbe, das die Route als `tag` zurueckgibt.
     *
     * Formatiert wird deshalb `eimer` SELBST und nicht der zurueckgerechnete
     * Zeitpunkt: `eimer` traegt Berliner Minuten, also die Wanduhr, und
     * `toISOString` liest sie als solche. Hier stand einmal
     * `eimer - versatzMinuten` — der echte UTC-Augenblick des Berliner
     * Mitternachtsbeginns, und der liegt im Sommer am 14. um 22:00, wenn der
     * Berliner Tag der 15. ist. Der Nachtlauf vom 15. hiess dann
     * `mahnlauf:2026-06-14`: ein Schluessel, der dem `tag` derselben Antwort
     * widerspricht — genau die Sorte stiller Abweichung, an der ein Protokoll
     * sein Vertrauen verliert.
     */
    const tag = new Date(eimer * 60_000);
    return `${schluessel}:${tag.toISOString().slice(0, 10)}`;
  }
  /*
   * Unterhalb eines Tages: der echte UTC-Augenblick des Fensterbeginns.
   *
   * **Und zwar absichtlich nicht die Wanduhr.** In der Nacht der Rueckstellung
   * gibt es 02:05 Berliner Zeit ZWEIMAL. Ein Schluessel aus der Wanduhr waere
   * fuer beide derselbe, und der zweite Lauf — eine volle Stunde spaeter —
   * wuerde als Wiederholung uebersprungen. Ein Beitrag, der in dieser Stunde
   * faellig ist, bliebe liegen, und der Lauf meldete „uebersprungen".
   */
  const zeit = new Date((eimer - versatzMinuten) * 60_000);
  return `${schluessel}:${zeit.toISOString().slice(0, 16)}Z`;
}
