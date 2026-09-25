/**
 * The merge-safety guards of PR 0.
 *
 * Each one refuses a change that would otherwise pass review and fail
 * silently in production. They run in `pnpm lint`, so a branch that breaks one
 * cannot merge.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pruefeXml } from './xml-wohlgeformt.js';
import { compilerOderNichts, festeZeichenketten } from './seite-ohne-uebersetzung.js';
import { UEBERSETZUNG_AUSNAHMEN } from './uebersetzung-ausnahmen.js';
import { FUNKTION_ALTLAST } from './funktion-altlast.js';

const WURZEL = process.cwd();

interface Befund {
  readonly wache: string;
  readonly datei: string;
  readonly zeile: number;
  readonly text: string;
}

/** Blockkommentare und Zeilenkommentare raus — eine Erwähnung ist keine Klasse. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)\/\/.*$/u, '$1'))
    .join('\n');
}

function dateien(verzeichnis: string, endungen: readonly string[]): string[] {
  /**
   * Ein fehlendes Verzeichnis ergibt eine LEERE Liste, nicht einen Fehler.
   *
   * Das ist Absicht — die Wachen laufen in `tests/kern/wachen.test.ts` gegen
   * einen Wegwerf-Baum, der nur `scripts/` und zwei Dateien enthält; dort gibt
   * es kein `src/`, und die geprüfte Wache soll trotzdem anlaufen.
   *
   * **Die Kehrseite muss jede Wache selbst tragen:** eine leere Liste sieht
   * genauso aus wie ein sauberer Baum. Die Tailwind-Wache hat das einmal
   * teuer bezahlt — ein falsch zusammengesetzter Pfad, `readdirSync` warf,
   * dieser `catch` schluckte es, und sie meldete "alles sauber", ohne eine
   * einzige Datei gelesen zu haben. Wer hier scannt und ein Ergebnis erwartet,
   * prüft das ausdrücklich (siehe `wacheTailwindFarben`).
   */
  const treffer: string[] = [];
  const gehe = (pfad: string): void => {
    let eintraege: string[];
    try {
      eintraege = readdirSync(pfad);
    } catch {
      return;
    }
    for (const e of eintraege) {
      if (e === 'node_modules' || e === '.next' || e === '.git' || e === 'coverage') continue;
      const voll = join(pfad, e);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (endungen.some((x) => e.endsWith(x))) treffer.push(voll);
    }
  };
  gehe(join(WURZEL, verzeichnis));
  return treffer;
}

/**
 * Ist das der ECHTE Baum? `wachen.test.ts` laesst die Wachen in einem
 * Wegwerf-Baum laufen; dort fehlen `drizzle/`, `src/server/db` und `tests/`
 * mit Absicht.
 *
 * **Das Kennzeichen ist die Sperrdatei und nicht `package.json`.** Eine Wache
 * darf `package.json` LESEN (`konformitaetsauftrag` tut es), und dann muss ein
 * Wegwerf-Baum eine schreiben duerfen, ohne dass er sich dadurch als echter
 * Baum ausgibt und jede andere Wache an einem fehlenden `src/server/db`
 * abstuerzen laesst. `pnpm-lock.yaml` legt niemand fuer ein Pruefstueck an.
 */
const ECHTER_BAUM = existsSync(join(WURZEL, 'pnpm-lock.yaml'));

/**
 * Wie `dateien`, aber im echten Baum muss etwas dabei herauskommen.
 *
 * **Der Ausfall, gegen den das geschrieben ist, steht oben in `dateien`
 * schon beschrieben und hat sich seitdem nicht geaendert:** ein falsch
 * zusammengesetzter Pfad, `readdirSync` wirft, der `catch` schluckt es, und
 * die Wache meldet "alles sauber", ohne eine einzige Datei gelesen zu haben.
 * Bisher trug genau EINE Wache diese Kehrseite selbst (`wacheTailwindFarben`).
 * Verschiebt jemand `drizzle/` oder `src/server/db`, gehen ohne diese Zeilen
 * die Wachen ueber Invariante 1 und Invariante 2 still aus — und still ist
 * hier das teure Wort: eine `numeric`-Geldspalte und ein zonenloser
 * Zeitstempel brechen nichts, sie stehen bloss ab da falsch da.
 */
function mussLesen(verzeichnis: string, endungen: readonly string[]): string[] {
  const treffer = dateien(verzeichnis, endungen);
  if (ECHTER_BAUM && treffer.length === 0) {
    throw new Error(
      `Merge-Wachen: \`${verzeichnis}\` liefert keine Datei (${endungen.join(', ')}). `
      + 'Eine Wache, die nichts liest, meldet "sauber" — das waere schlimmer als keine.',
    );
  }
  return treffer;
}

const befunde: Befund[] = [];
const melde = (wache: string, datei: string, zeile: number, text: string): void => {
  befunde.push({ wache, datei: relative(WURZEL, datei), zeile, text: text.trim().slice(0, 160) });
};

/**
 * Guard 1 — money is never `numeric` or a float column (invariant 1, K-16).
 * A `numeric` money column is the schema-level twin of a float cent.
 *
 * Two word classes, because not every `…wert` is an amount. A column whose
 * name says *money* (`betrag`, `preis`, …) can never be exempted. A column
 * carrying one of the ambiguous words (`wert`, `satz`) may be — but only by
 * NAMING its unit on the same line, so the exemption is a statement a
 * reviewer can check rather than a way to silence the guard:
 *
 *     leistungswert_qm_pro_stunde numeric(10,3) not null, -- nicht-geld: m²/h
 */
function wacheGeldSpalte(): void {
  const GELD_STARK = /(betrag|preis|summe|saldo|entgelt|kosten|honorar|einbehalt)/iu;
  const GELD_MEHRDEUTIG = /(wert|satz)/iu;
  /** An exemption is only valid if it names a unit. */
  const NICHT_GELD = /(--|\/\/)\s*nicht-geld:\s*\S+/u;
  for (const datei of [...mussLesen('src/server/db', ['.ts']), ...mussLesen('drizzle', ['.sql'])]) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        const stark = GELD_STARK.test(zeile);
        if (!stark && !GELD_MEHRDEUTIG.test(zeile)) return;
        if (!/\b(numeric|decimal|real|double precision|float)\b/iu.test(zeile)) return;
        if (!stark && NICHT_GELD.test(zeile)) return;
        melde('geld-nie-numeric', datei, i + 1, zeile);
      });
  }
}

/**
 * Guard 2 — every timestamp carries a time zone (invariant 2).
 * `timestamp without time zone` silently drops the offset, and every DST
 * calculation downstream is then wrong by an hour twice a year.
 */
/**
 * Ein Bezeichner, dann Leerraum, dann ein BLANKER `timestamp`.
 *
 * Nicht getroffen wird, was keine Spalte anlegt: `::timestamp` steht ohne
 * Leerraum am Bezeichner, `timestamptz` traegt keine Wortgrenze nach
 * `timestamp`, und die ausgeschriebenen Formen fangen die beiden
 * Lookaheads ab — sie haben ihre eigene Meldung und sollen nicht doppelt
 * erscheinen.
 */
const BLANKER_ZEITSTEMPEL =
  /\b([a-z_][a-z0-9_]*)\s+timestamp\b(?!\s*\()(?!\s+with(?:out)?\s+time\s+zone)/giu;

function wacheZeitstempel(): void {
  for (const datei of [...dateien('src/server/db', ['.ts']), ...dateien('drizzle', ['.sql'])]) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (/timestamp\s+without\s+time\s+zone/iu.test(zeile)) {
          melde('zeit-immer-tz', datei, i + 1, zeile);
        }
        if (/\btimestamp\s*\(/iu.test(zeile) && !/withTimezone|with\s+time\s+zone/iu.test(zeile)) {
          melde('zeit-immer-tz', datei, i + 1, zeile);
        }
        /*
         * Der BLANKE `timestamp` — ohne Klammern, ohne Zusatz.
         *
         * Die Wache kannte genau zwei Formen: `timestamp without time zone`
         * ausgeschrieben und den Drizzle-Aufruf `timestamp(`. Eine
         * Spaltendeklaration in einer Migration schreibt aber keine von
         * beiden:
         *
         *     erfasst_am timestamp not null default now(),
         *
         * PostgreSQL liest das als `timestamp without time zone` — genau die
         * Spalte, gegen die Invariante 2 geschrieben ist. Die Wache sah sie
         * nicht und meldete "alle sauber". Der Offset faellt dann beim
         * Schreiben weg, jede Dauer ueber eine Zeitumstellung ist um eine
         * Stunde falsch, zweimal im Jahr, und nichts bricht: es steht bloss
         * eine plausible falsche Zahl auf dem Stundennachweis.
         *
         * Zwei Ausnahmen, beide am Text pruefbar: ein Bezeichner auf `_lokal`
         * ist der dokumentierte Wanduhr-Anker aus 0029/0069 — die Ortszeit
         * einer Serie, die absichtlich ohne Zone steht —, und ein
         * Kommentar ist keine Deklaration. Die beiden Pruefungen darueber
         * lesen Kommentarzeilen weiter mit; sie treffen nur ausgeschriebene
         * Formen, die in Prosa nicht zufaellig entstehen.
         */
        const roh = zeile.trimStart();
        if (roh.startsWith('--') || roh.startsWith('*') || roh.startsWith('//')
            || roh.startsWith('/*')) return;
        for (const m of zeile.matchAll(BLANKER_ZEITSTEMPEL)) {
          if (/_lokal$/iu.test(m[1] ?? '')) continue;
          melde('zeit-immer-tz', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 3 — a route handler never touches the database directly.
 * CLAUDE.md: authorize → call a service → return. A handler holding a query
 * is a handler that can be given one without a tenant predicate.
 */
function wacheRouteOhneDb(): void {
  for (const datei of mussLesen('src/app', ['.ts', '.tsx'])) {
    if (!/route\.tsx?$/u.test(datei)) continue;
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        if (/\bdb\s*\./u.test(zeile) || /\bdrizzle\b/u.test(zeile) || /\bsql`/u.test(zeile)) {
          melde('route-ohne-db', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 4 — every `TODO(client)` carries an O-number that DECISIONS.md holds.
 * This is what makes the open register real rather than aspirational: a
 * question raised in code and not written down is a question nobody answers.
 */
/**
 * Guard — a `page.tsx` exports only what Next.js knows.
 *
 * **Why this is a guard and not a review note.** Next.js generates route types
 * at BUILD time and refuses any additional export from a page module:
 *
 *   Property 'felderAus' is incompatible with index signature.
 *   Type '(roh: string | string[] | undefined) => …' is not assignable to 'never'.
 *
 * `npx tsc --noEmit` does not see it — `.next/types` does not exist yet. The
 * failure therefore appears in `pnpm build`, which in this project takes three
 * minutes, and in the browser suite, which fails to start at all and reports
 * „Timed out waiting from config.webServer" — a message that reads like a
 * broken server and not like a misplaced helper function.
 *
 * It has happened: a parser for the field messages of the enquiry form sat in
 * `angebot/[bereich]/page.tsx` because that is where it was used. The fix is
 * always the same and always cheap — move it next to the page component, which
 * is exactly why those files exist (`Angebot.tsx`, `Danke.tsx`, `Anfrage.tsx`).
 * The expensive part is finding out.
 */
const PAGE_EXPORTE_ERLAUBT = new Set([
  'default', 'metadata', 'generateMetadata', 'viewport', 'generateViewport',
  'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
  'preferredRegion', 'maxDuration', 'config', 'generateStaticParams',
  'experimental_ppr',
]);

function wachePageExporte(): void {
  for (const datei of mussLesen('src/app', ['.tsx', '.ts'])) {
    if (!/\/page\.tsx?$/u.test(datei)) continue;
    const inhalt = ohneKommentare(readFileSync(datei, 'utf8'));
    inhalt.split('\n').forEach((zeile, i) => {
      /*
       * `export default` und `export type`/`export interface` sind harmlos:
       * das eine ist erlaubt, das andere verschwindet beim Uebersetzen.
       */
      const treffer = /^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/u
        .exec(zeile);
      const name = treffer?.[1];
      if (name !== undefined && !PAGE_EXPORTE_ERLAUBT.has(name)) {
        melde('page-fremder-export', datei, i + 1,
              `\`${name}\` — eine page.tsx exportiert nur, was Next.js kennt. `
              + 'Der Bau schlaegt fehl, `tsc --noEmit` sieht es nicht.');
      }
    });
  }
}

function wacheTodoClient(): void {
  const register = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');
  const bekannt = new Set(
    [...register.matchAll(/^\|\s*(O-\d{1,3})\s*\|/gmu)].map((m) => m[1] ?? ''),
  );
  const zuPruefen = [
    ...mussLesen('src', ['.ts', '.tsx']),
    ...mussLesen('scripts', ['.ts']),
    // Migrations too. `0001` and `0002` each raise a real client question in a
    // SQL comment, and a question the guard cannot see is a question that can
    // fall out of the register without anything noticing.
    ...dateien('drizzle', ['.sql']),
  ].filter(
    // The scanner is not scanned: this file names the marker in order to look
    // for it, and a guard that trips over its own documentation is a guard
    // people disable.
    (d) => !d.includes(join('scripts', 'guards')),
  );
  for (const datei of zuPruefen) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        /**
         * `TODO\(client\b` — nicht `TODO\(client\)`.
         *
         * Der Ausdruck verlangte die schliessende Klammer UNMITTELBAR nach
         * `client`. Die Schreibweise dieses Projekts ist aber
         * `TODO(client, O-18): …` — die Wache traf also KEINE einzige Zeile
         * und meldete jahrelang nichts. Ein gruener Waechter, der nichts
         * prueft, ist schlechter als gar keiner: er belegt den Platz, an dem
         * jemand sonst nachgesehen haette.
         */
        if (!/TODO\(client\b/u.test(zeile)) return;
        const nummer = /\b(O-\d{1,3})\b/u.exec(zeile)?.[1];
        if (nummer === undefined) {
          melde('todo-client-ohne-nummer', datei, i + 1, zeile);
        } else if (!bekannt.has(nummer)) {
          melde('todo-client-nicht-im-register', datei, i + 1, zeile);
        }
      });
  }
}

/**
 * Guard 5b — `date at time zone` waehlt die falsche Ueberladung.
 *
 * `($1::date) at time zone 'Europe/Berlin'` sieht aus, als machte es aus einem
 * Berliner Kalendertag den Zeitpunkt seiner Mitternacht. Es tut das Gegenteil:
 * Postgres castet das Datum nach `timestamptz` (UTC-Mitternacht) und rechnet
 * es dann NACH Berlin. Heraus kommt `02:00` als zonenlose Zeit — im Vergleich
 * mit einer `timestamptz`-Spalte also 02:00 UTC. Ein Tagesfenster beginnt
 * damit im Sommer vier Stunden zu spaet und im Winter zwei, und was fehlt, ist
 * genau die Nachtschicht.
 *
 * Richtig ist `($1::date)::timestamp at time zone 'Europe/Berlin'` — oder, in
 * einer Migration, `app.loese_ortszeit`. Der Fehler stand an fuenf Stellen im
 * Security-Modul und hat dort ein Jahr lang niemandem etwas gemeldet.
 */
function wacheDatumZone(): void {
  /**
   * Auch `make_date(...) at time zone` — der Fund, den die erste Fassung
   * durchliess. Sie suchte nur `::date`; `make_date()` liefert aber
   * ebenso `date` und trifft damit dieselbe falsche Ueberladung. Der
   * Monatsabschluss stand vier Monate lang so da.
   */
  const FALSCH = /(?:::date|make_date\s*\([^)]*\))\s*\)?\s*(?:\+\s*(?:\d+|interval\s+'[^']*')\s*\))?\s*at\s+time\s+zone/iu;
  for (const datei of [
    ...mussLesen('src', ['.ts', '.tsx']),
    ...mussLesen('drizzle', ['.sql']),
    /*
     * **Auch die Pruefungen.** Die Wache las sie nicht, und genau dort faellt
     * der Fehler am teuersten aus: eine Pruefung, die dieselbe Ueberladung
     * benutzt wie der Code, ist gruen und beweist nichts. In diesem Zweig ist
     * das VIERMAL vorgekommen (HEIC, Geraeteabweichung, Formularsekunden,
     * Monatsnachweis) — jedes Mal stand daneben eine gruene Zusicherung, die
     * den Irrtum bloss wiederholte.
     *
     * `wachen.test.ts` ist ausgenommen, aus demselben Grund wie
     * `scripts/guards` bei der TODO-Wache: dort steht das Muster als
     * FIXTUR, damit diese Wache daran gemessen werden kann. Ein Waechter, der
     * ueber seiner eigenen Falsifikation stolpert, wird abgeschaltet.
     */
    ...mussLesen('tests', ['.ts', '.tsx'])
      .filter((d) => !d.endsWith(join('tests', 'kern', 'wachen.test.ts'))),
  ]) {
    readFileSync(datei, 'utf8')
      .split('\n')
      .forEach((zeile, i) => {
        // Der Kommentar, der das Muster ERKLAERT, ist kein Verstoss.
        if (/^\s*(--|\*|\/\/)/u.test(zeile)) return;
        if (FALSCH.test(zeile)) melde('datum-zone-ueberladung', datei, i + 1, zeile);
      });
  }
}

/**
 * Wache — ein Backtick in einem SQL-Template beendet die Zeichenkette.
 *
 * Die Abfragen stehen in Template-Literalen. Wer darin einen Kommentar mit
 * `Spaltenname` in Backticks schreibt — so, wie der ganze Rest dieses Baums
 * kommentiert ist —, beendet die Zeichenkette mitten im SQL. Der Build
 * scheitert dann mit `TS1005: ',' expected` an einer Zeile, die voellig in
 * Ordnung aussieht, und man sucht den Fehler im falschen Ausdruck.
 *
 * Das ist in dieser Sitzung DREIMAL passiert, jedes Mal beim Erklaeren einer
 * gerade reparierten Stelle. Eine Falle, in die man beim Sorgfaeltigsein
 * tappt, gehoert in eine Wache und nicht in die Erinnerung.
 *
 * Erkannt wird der einfache, haeufige Fall: eine Zeile INNERHALB eines
 * mehrzeiligen SQL-Templates, die mit einem SQL-Kommentar oder einem
 * Block-Kommentarstern beginnt und einen Backtick enthaelt. Der richtige Weg
 * ist derselbe Kommentar mit `--` und ohne Backticks.
 */
function wacheBacktickImSql(): void {
  /*
   * Der Bereich beginnt an einer Zeile, die eine SQL-Verbform UND einen
   * Backtick traegt, und endet an der naechsten Zeile mit einem Backtick.
   *
   * Absichtlich eng: eine Paritaetszaehlung ueber die ganze Datei zaehlt jeden
   * Backtick in jedem Regex und jeder Doku mit und meldet dann Kommentare, die
   * voellig in Ordnung sind. Eine Wache mit falschen Treffern wird abgeschaltet
   * — und dann prueft sie gar nichts mehr.
   */
  const OEFFNET = /(?:unsafe|abfrage|schreibe|sql)\s*(?:<[^>]*>)?\s*\(?\s*`/u;
  for (const datei of mussLesen('src', ['.ts', '.tsx'])
    .concat(mussLesen('tests', ['.ts']))) {
    const zeilen = readFileSync(datei, 'utf8').split('\n');
    let imSql = false;
    zeilen.forEach((zeile, i) => {
      if (!imSql) {
        // Nur wenn das Template offen BLEIBT: `sql.unsafe(`…`)` in einer Zeile
        // oeffnet und schliesst zugleich und faengt keinen Kommentar ein.
        const offen = ((zeile.match(/`/gu) ?? []).length % 2) === 1;
        /*
         * Zwei Formen oeffnen ein SQL-Template, und die erste Fassung kannte
         * nur eine. Bei der haeufigeren steht der Aufruf auf der einen Zeile
         * und die Abfrage auf der naechsten:
         *
         *     await sql.unsafe<{ id: string }[]>(
         *       `insert into einsatz (...
         *
         * Dort traegt die oeffnende Zeile KEINE Verbform — sie beginnt bloss
         * mit einem Backtick. Genau diese Form hat der Fehler dreimal
         * getroffen, und genau sie liess die Wache durch: sie meldete sauber
         * und prueffte nichts.
         */
        const beginntMitTick = zeile.trimStart().startsWith('`');
        if (offen && (beginntMitTick || OEFFNET.test(zeile))
            && !zeile.trimStart().startsWith('*')) imSql = true;
        return;
      }
      if (/^\s*(?:--|\*|\/\/)/u.test(zeile) && zeile.includes('`')) {
        melde('sql-backtick-im-kommentar', datei, i + 1, zeile);
      }
      if (zeile.includes('`')) imSql = false;
    });
  }
}

/**
 * Guard 6 — Invariante 7: es gibt genau EINEN Ausgang.
 *
 * Ein Mailtransport oder ein HTTP-Sender ausserhalb von `server/versand`
 * bricht den Build. Das ist der Unterschied zwischen "wir schicken alles ueber
 * das Gate" als Vorsatz und als Eigenschaft: der Vorsatz haelt, bis jemand
 * unter Zeitdruck ein `nodemailer` importiert, und danach faellt es niemandem
 * mehr auf.
 */
const TRANSPORTE = [
  'nodemailer', 'resend', '@sendgrid', 'postmark', 'mailgun', 'aws-sdk/client-ses',
  '@aws-sdk/client-ses', 'twilio', 'node-fetch', 'axios', 'got', 'undici',
];

/**
 * Das native `fetch` braucht keinen Import — und war deshalb der eine
 * Ausgang, den die Liste oben nicht sehen konnte.
 *
 * `server/storage` steht hier und NICHT in `erlaubt`: der Speicher-Adapter
 * spricht mit dem eigenen Supabase-Bucket, also mit der eigenen
 * Infrastruktur und nicht mit einem Empfaenger. Ein `nodemailer` dort waere
 * trotzdem ein Verstoss, und die Importpruefung faengt ihn weiterhin.
 *
 * `server/radar` aus demselben Grund, mit einem Unterschied, der ihn noch
 * schmaler macht: dieser Adapter LIEST. Er holt oeffentliche
 * Vergabebekanntmachungen (RAD-01, RAD-02) und schickt dabei nichts als eine
 * Adresse — kein Empfaenger, kein Inhalt, keine Nachricht. Invariante 7
 * handelt davon, dass nichts das System VERLAESST; der eine Ausgang dafuer
 * bleibt `server/versand`. Damit das hier eine Zusage bleibt und keine
 * Luecke, steht hier genau EINE Datei — nicht ihr Verzeichnis: ein spaeterer
 * Parser daneben soll nicht mitgeerbt bekommen, was fuer den Adapter gilt.
 */
const FETCH_ERLAUBT = [
  join('server', 'versand'), join('server', 'agent', 'policy'), join('server', 'storage'),
  join('server', 'radar', 'abruf.ts'),
];

function wacheEinAusgang(): void {
  const erlaubt = [join('server', 'versand'), join('server', 'agent', 'policy')];
  const zuPruefen = mussLesen('src', ['.ts', '.tsx']).filter(
    (d) => !erlaubt.some((e) => d.includes(e)),
  );

  for (const datei of zuPruefen) {
    const fetchErlaubt = FETCH_ERLAUBT.some((e) => datei.includes(e));
    readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
      /*
       * **Was die Wache vorher nicht sah.** Sie las ausschliesslich
       * Importnamen. `nodemailer` fiel auf, `await fetch('https://…/send')`
       * nicht — und `fetch` ist seit Node 18 global, es braucht keinen
       * Import und keine Abhaengigkeit. Der eine Ausgang war damit eine
       * Zusage ueber die `package.json` und nicht ueber den Code: jede
       * Mailversand-API, jeder Webhook, jeder Kanal liess sich in einer
       * Zeile danebenlegen, ohne dass etwas rot wurde. Invariante 7 ist
       * dann nur noch ein Vorsatz.
       *
       * Erlaubt bleibt der Ruf an die EIGENE API: ein Pfad, der mit `/`
       * beginnt, verlaesst das System nicht.
       */
      const roh = zeile.trimStart();
      const istKommentar = roh.startsWith('//') || roh.startsWith('*') || roh.startsWith('/*');
      if (!istKommentar && !fetchErlaubt && /\bfetch\s*\(/u.test(zeile)
          && !/\bfetch\s*\(\s*[`'"]\//u.test(zeile)) {
        melde('ein-ausgang', datei, i + 1,
          `natives \`fetch\` ausserhalb von server/versand — Invariante 7 kennt genau einen Ausgang.`);
      }
      const treffer = /(?:from|require\()\s*['"]([^'"]+)['"]/u.exec(zeile);
      if (treffer === null) return;
      const modul = treffer[1] ?? '';
      if (TRANSPORTE.some((t) => modul === t || modul.startsWith(`${t}/`))) {
        melde('ein-ausgang', datei, i + 1,
          `\`${modul}\` ausserhalb von server/versand — Invariante 7 kennt genau einen Ausgang.`);
      }
    });
  }
}

/**
 * Guard 14 — der Speicher vergisst nur ueber EINEN Weg (DOC-07, ACC-06, D-483).
 *
 * `Speicher.entferne` loescht ein Objekt im Bucket. Erlaubt ist das genau
 * zweimal: in `dokument/loeschung.ts` — nach dem weichen Loeschen der Zeile,
 * das die Datenbank fuer gesperrte und fuer bebuchte Dokumente abweist —
 * und als Ruecknahme einer WAISE: ein Objekt, das gerade hochgeladen wurde
 * und dessen Zeile in derselben Transaktion nicht entstand. Jeder andere
 * Aufruf ist ein Loeschweg am Archiv vorbei, und genau den soll es nicht
 * geben — auch nicht unter Zeitdruck, auch nicht „nur fuer Bilder".
 */
const ENTFERNEN_ERLAUBT = [
  join('server', 'storage', 'adapter.ts'),
  join('server', 'services', 'dokument', 'loeschung.ts'),
  // Waisen-Ruecknahmen nach gescheitertem Insert:
  join('server', 'services', 'buchhaltung', 'datev', 'export.ts'),
  join('server', 'services', 'buchhaltung', 'belegarchiv.ts'),
  join('server', 'services', 'finanz', 'mahnung', 'index.ts'),
  join('server', 'services', 'finanz', 'bank', 'import.ts'),
  join('api', 'finanzen', 'eingangsrechnungen', 'route.ts'),
  join('api', 'check-in', '[token]', 'medien', 'route.ts'),
  // Eine beigelegte Vergabeunterlage, deren Zeile in derselben Transaktion
  // nicht entstand — dieselbe Ruecknahme wie beim Belegupload (PR 70).
  join('api', 'vergabe', 'unterlage', 'route.ts'),
];

function wacheSpeicherEntfernen(): void {
  for (const datei of mussLesen('src', ['.ts', '.tsx'])) {
    if (ENTFERNEN_ERLAUBT.some((e) => datei.includes(e))) continue;
    readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
      const roh = zeile.trimStart();
      if (roh.startsWith('//') || roh.startsWith('*') || roh.startsWith('/*')) return;
      if (/\.entferne\s*\(/u.test(zeile)) {
        melde('speicher-entfernen-nur-ueber-loeschung', datei, i + 1,
          'Speicher.entferne ausserhalb von dokument/loeschung.ts — ein Loeschweg am Archiv vorbei (DOC-07).');
      }
    });
  }
}

/** Guard 5 — the database region is pinned, and a test can read it (D-04). */
function wacheEuRegion(): void {
  const pfad = join(WURZEL, 'supabase/config.toml');
  const inhalt = readFileSync(pfad, 'utf8');
  if (!/eu-central-1/u.test(inhalt)) {
    melde('eu-region', pfad, 1, 'supabase/config.toml nennt keine EU-Region (D-04)');
  }
}


/**
 * Guard 7 — jede Farbklasse muss im Tailwind-Thema existieren.
 *
 * **Der Ausfall, der diese Wache erzwungen hat.** `border-border` und
 * `text-red` standen in acht Dateien. Das Thema kennt aber `line` und `brand`,
 * nicht `border` und `red` — Tailwind erzeugt für eine unbekannte Farbe KEINE
 * Regel und meldet auch nichts. Ergebnis: jede Rahmenlinie der Anwendung war
 * unsichtbar und das eine rote Akzentwort nicht rot. Im Markup sah alles
 * richtig aus, im Browser fehlte es, und kein Test schlug an — die
 * Design-Prüfungen messen berechnete Stile an Elementen mit `style`-Attribut,
 * nicht an Klassen.
 *
 * Deshalb wird hier gegen das ECHTE Thema geprüft und nicht gegen eine
 * gepflegte Liste: eine umbenannte Farbe fällt damit sofort auf, statt still
 * jede Stelle zu entfärben, die den alten Namen benutzt.
 */
function wacheTailwindFarben(): void {
  /**
   * Ohne Tailwind-Konfiguration gibt es nichts zu prüfen — das ist der
   * Wegwerf-Baum der Wachen-Tests, der nur `scripts/` kopiert. Im echten
   * Projekt ist die Datei immer da; fehlte sie dort, fiele der Build vorher.
   */
  if (!existsSync(join(WURZEL, 'tailwind.config.ts'))) return;

  /**
   * `createRequire` und nicht `await import(…)`.
   *
   * Die Wachen laufen auch in einem Baum ohne `package.json` — dort übersetzt
   * `tsx` nach CJS, und ein dynamisches `import()` einer TypeScript-Datei
   * scheitert dort still. Ein `require` über `createRequire` funktioniert in
   * BEIDEN Modi, und die Wache bleibt damit synchron.
   */
  const laden = createRequire(import.meta.url);
  const geladen = laden(join(WURZEL, 'tailwind.config.ts')) as {
    default?: { theme?: { extend?: Record<string, unknown> } };
    theme?: { extend?: Record<string, unknown> };
  };
  const extend = (geladen.default ?? geladen).theme?.extend ?? {};

  /** `{ brand: { DEFAULT, hover } }` → `brand`, `brand-hover`. */
  const namen = (wert: unknown, praefix = ''): string[] => {
    if (typeof wert !== 'object' || wert === null) return praefix === '' ? [] : [praefix];
    return Object.entries(wert as Record<string, unknown>).flatMap(([k, v]) =>
      namen(v, k === 'DEFAULT' ? praefix : (praefix === '' ? k : `${praefix}-${k}`)));
  };

  const farben = new Set([
    ...namen(extend['colors']),
    // Tailwind-Vorgaben, die jedes Thema behält.
    'white', 'black', 'transparent', 'current', 'inherit',
  ]);
  const schriftgroessen = new Set(Object.keys(extend['fontSize'] ?? {}));
  const schatten = new Set(Object.keys(extend['boxShadow'] ?? {}));

  /**
   * **`bg-` traegt nicht nur Farben, sondern auch Hintergrundbilder.**
   *
   * DESIGN §5 „Standalone pages" hat `bg-wash-brand` gebracht — den einen
   * Lichthauch hinter einer alleinstehenden Flaeche. Er steht in
   * `backgroundImage`, nicht in `colors`, und die Wache meldete ihn als
   * „keine Farbe im Thema". Das war eine Falschmeldung der teuersten Sorte:
   * die Klasse ist gueltig, Tailwind erzeugt sie, und wer die Wache ein paar
   * Mal irrtuemlich rot sieht, faengt an, sie zu umgehen.
   *
   * Geprueft wird trotzdem — nur gegen die RICHTIGE Tabelle: ein
   * `bg-wash-irgendwas`, das im Thema nicht steht, faellt weiter durch.
   */
  const hintergrundbilder = new Set(Object.keys(extend['backgroundImage'] ?? {}));

  /**
   * Präfixe, deren Rest eine FARBE sein muss. `text-` und `border-` stehen
   * nicht dabei: `text-sm` ist eine Schriftgrösse und `border-t` eine Seite,
   * beide völlig gültig — sie werden unten gesondert behandelt.
   */
  const FARBPRAEFIX = ['bg', 'ring', 'divide', 'accent', 'fill', 'stroke'];
  // Seiten, Breiten und Stile von `border-*`, die keine Farben sind.
  const BORDER_SONST = new Set([
    '0', '2', '4', '8', 't', 'r', 'b', 'l', 'x', 'y', 's', 'e',
    'solid', 'dashed', 'dotted', 'double', 'none', 'hidden', 'collapse', 'separate',
  ]);
  const TEXT_SONST = new Set([
    'left', 'center', 'right', 'justify', 'start', 'end',
    'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
  ]);
  /**
   * Tailwinds eigene Schattenstufen. `theme.extend` ersetzt sie nicht, es legt
   * daneben — `shadow-lg` ist also gueltig, ohne im Thema zu stehen.
   * `shadow-2xl` und das blanke `shadow` fasst der Ausdruck unten gar nicht an:
   * er verlangt nach dem Bindestrich einen Buchstaben.
   */
  const SHADOW_VORGABE = new Set(['sm', 'md', 'lg', 'xl', 'inner', 'none']);

  /**
   * Gelesen wird, was WIRKLICH eine Klassenliste ist.
   *
   * `src/lib/design/theme.ts` hält Tokennamen wie `'border-strong'` als
   * Objektschlüssel — richtig dort, und keine Tailwind-Klasse. Ein Kommentar,
   * der `placeholder-as-label` erwähnt, ist ebenso wenig eine. Beide meldete
   * eine erste Fassung, und eine Wache mit falschen Treffern wird abgeschaltet.
   *
   * Deshalb: Kommentare weg, und ausserhalb von `.tsx` nur Zeilen, die
   * überhaupt von Klassen sprechen.
   */
  const quellen = mussLesen('src', ['.ts', '.tsx']);
  /**
   * Hier MUSS etwas gefunden werden: die Konfiguration oben gibt es, also ist
   * das der echte Baum. Null Dateien hiesse, die Wache liest ins Leere und
   * meldet "sauber" — genau der Ausfall, den sie beim ersten Versuch selbst
   * hatte.
   */
  if (quellen.length === 0) {
    throw new Error(
      'Tailwind-Wache: `src/` enthält keine Quelldateien, obwohl eine '
      + 'tailwind.config.ts existiert. Eine Wache, die nichts liest, meldet '
      + '"sauber" — das wäre schlimmer als keine.',
    );
  }
  for (const datei of quellen) {
    const tsx = datei.endsWith('.tsx');
    ohneKommentare(readFileSync(datei, 'utf8')).split('\n').forEach((zeile, i) => {
      if (!tsx && !/class/iu.test(zeile)) return;

      /**
       * Nur den MODULPFAD entfernen, nicht die ganze Zeile.
       *
       * `@/lib/placeholder-assets` sähe sonst aus wie `placeholder-assets`.
       * Eine erste Fassung übersprang jede Zeile, die mit `import` oder
       * `export` beginnt — und übersah damit
       * `export const K = () => <div className="border-border" />`, also genau
       * die einzeilige Komponente. Die Wache bestand ihren eigenen
       * Falsifikationstest nicht.
       */
      const geprueft = zeile
        .replace(/\bfrom\s*['"`][^'"`]*['"`]/gu, ' ')
        .replace(/\b(?:import|require)\s*\(\s*['"`][^'"`]*['"`]\s*\)/gu, ' ')
        .replace(/^\s*import\s+['"`][^'"`]*['"`]/u, ' ');
      for (const m of geprueft.matchAll(/\b([a-z]+)-([a-z][a-z0-9-]*)\b/gu)) {
        const [, praefix, rest] = m as unknown as [string, string, string];

        /**
         * Eine CSS-EIGENSCHAFT ist keine Tailwind-Klasse.
         *
         * `border-bottom: 1px solid …` in einem `<style>`-Block sah fuer die
         * Wache aus wie `border-bottom` als Klasse — und das Angebotsdokument
         * (DESIGN §11) ist genau so gebaut: gedruckte Regeln, die es als
         * Klassen nicht gibt. Das Unterscheidungsmerkmal ist der Doppelpunkt
         * UNMITTELBAR danach: eine Deklaration hat ihn, eine Klasse nie —
         * bei `hover:text-brand` steht er davor.
         */
        if (geprueft[(m.index ?? 0) + m[0].length] === ':') continue;

        if (praefix === 'text') {
          if (schriftgroessen.has(rest) || TEXT_SONST.has(rest) || farben.has(rest)) continue;
          melde('tailwind-farbe', datei, i + 1,
            `\`text-${rest}\` — weder Schriftgrösse noch Farbe im Thema. Tailwind erzeugt dafür nichts.`);
          continue;
        }
        if (praefix === 'border') {
          /**
           * Eine SEITE plus eine BREITE ist keine Farbe.
           *
           * `border-t-0` setzt `border-top-width: 0`. Die Wache las davon nur
           * `t-0`, fand es nicht in ihrer Liste und meldete „keine Farbe im
           * Thema" — eine Falschmeldung, und die teuerste Sorte: wer sie ein
           * paar Mal sieht, faengt an, die Wache zu umgehen, und dann faellt
           * die echte Meldung mit durch.
           */
          if (/^(?:t|r|b|l|x|y|s|e)-(?:0|2|4|8)$/u.test(rest)) continue;
          if (BORDER_SONST.has(rest) || farben.has(rest)) continue;
          melde('tailwind-farbe', datei, i + 1,
            `\`border-${rest}\` — keine Farbe im Thema. Die Linie bleibt unsichtbar.`);
          continue;
        }
        if (praefix === 'shadow') {
          /**
           * **Der Zweig endete vorher in beiden Faellen mit `continue`.**
           *
           * `schatten` wurde aus dem Thema gelesen und dann nie benutzt: ein
           * `shadow-…`, das es im Thema nicht gibt, ging still durch. Das ist
           * derselbe Ausfall, gegen den diese Wache ueberhaupt geschrieben ist
           * — Tailwind erzeugt fuer einen unbekannten Schatten keine Regel und
           * meldet nichts. Wer `shadow-pop` im Thema umbenennt, verliert damit
           * die Erhebung jeder Karte auf jedem Bildschirm; im Markup steht
           * alles richtig, im Browser ist die Flaeche flach, und kein Test
           * schlaegt an. Eine Pruefung, die geschrieben und dann stillgelegt
           * wurde, ist schlimmer als keine: sie belegt den Platz.
           */
          if (schatten.has(rest) || SHADOW_VORGABE.has(rest) || farben.has(rest)) continue;
          melde('tailwind-farbe', datei, i + 1,
            `\`shadow-${rest}\` — kein Schatten im Thema. Die Flaeche bleibt flach.`);
          continue;
        }
        if (!FARBPRAEFIX.includes(praefix)) continue;
        if (farben.has(rest)) continue;
        if (praefix === 'bg' && hintergrundbilder.has(rest)) continue;
        melde('tailwind-farbe', datei, i + 1,
          `\`${praefix}-${rest}\` — keine Farbe im Thema.`);
      }
    });
  }
}

/**
 * Wache — **kein roter Knopf in einer Schleife** (DESIGN §5).
 *
 * „One primary button per view", und der Grund steht daneben: Rot ist knapp,
 * und ein Bildschirm mit neun roten Knoepfen hat GAR KEINE Hauptaktion. Ein
 * `variante="primary"` INNERHALB einer `.map()`-Schleife ist nie einer —
 * es ist einer je Zeile, also so viele, wie die Liste lang ist.
 *
 * **Gemessen, als diese Wache entstand: dreizehn Stellen.** Zwoelf rote
 * „Schliessen" in der Periodenliste, eines je Monat. Ein rotes „Link
 * ausgeben" je Einteilung. Ein rotes „Ansehen" je Benachrichtigung. Keine
 * davon ist falsch gebaut — sie sind nur alle gleich laut, und das Auge
 * findet keinen Halt.
 *
 * **Warum eine Klammerbilanz und kein `grep`.** Der erste Anlauf zaehlte
 * `.map(` und suchte das Ende an einer Zeile, die auf `))}` endet. Das fand
 * 33 Stellen, von denen 20 laengst ausserhalb der Schleife lagen — eine
 * Wache, die zu zwei Dritteln irrt, wird umgangen. Diese hier faehrt die
 * Klammern mit und kennt Zeichenketten, also auch die Klammer in einem Text.
 *
 * Die Behebung ist nie „das Rot wegnehmen", sondern die Frage: was ist hier
 * die eine Handlung? Traegt die Zeile ein JA/NEIN-Paar, faellt das NEIN auf
 * `ghost` — sonst stehen zwei gleich aussehende Knoepfe nebeneinander.
 */
function wacheRoterKnopfInSchleife(): void {
  for (const datei of mussLesen('src', ['.tsx'])) {
    const inhalt = readFileSync(datei, 'utf8');
    if (!inhalt.includes('variante="primary"')) continue;

    /** Jede `.map(`-Klammer mit ihrem ECHTEN Ende. */
    const spannen: readonly (readonly [number, number])[] = [
      ...inhalt.matchAll(/\.map\(/gu),
    ].map((m) => {
      let j = (m.index ?? 0) + m[0].length - 1;
      let tiefe = 0;
      let zeichenkette: string | null = null;
      let flucht = false;
      /** `block` fuer `/* … *\/`, `zeile` fuer `// …` bis zum Zeilenende. */
      let kommentar: 'block' | 'zeile' | null = null;
      const start = j;
      for (; j < inhalt.length; j += 1) {
        const c = inhalt[j] ?? '';
        /*
         * **Kommentare werden MITGEFAHREN, nicht vorher entfernt.**
         *
         * Zweimal hat diese Wache an derselben Stelle falschen Alarm
         * geschlagen: ein gewoehnliches `"` in einem deutschen Satz INNERHALB
         * eines Kommentars („82,50") eroeffnete hier eine Zeichenkette, die
         * nie wieder zuging — und von da an zaehlte die Klammerbilanz
         * irrefuehrend weiter. Der Knopf am Ende der Datei lag dann
         * scheinbar in einer `.map()`, die hundertsechzig Zeilen frueher
         * geschlossen hatte.
         *
         * Vorher zu entfernen ginge nicht: `ohneKommentare` ersetzt einen
         * Blockkommentar durch EIN Leerzeichen, und damit stimmt die
         * Zeilennummer im Befund nicht mehr. Die Meldung zeigte dann auf
         * eine fremde Zeile — und eine Wache, der man die Stelle nicht
         * glaubt, wird umgangen (derselbe Grund, aus dem hier ueberhaupt
         * eine Klammerbilanz steht und kein `grep`).
         */
        if (kommentar === 'block') {
          if (c === '*' && inhalt[j + 1] === '/') { kommentar = null; j += 1; }
          continue;
        }
        if (kommentar === 'zeile') {
          if (c === '\n') kommentar = null;
          continue;
        }
        if (zeichenkette !== null) {
          if (flucht) flucht = false;
          else if (c === '\\') flucht = true;
          else if (c === zeichenkette) zeichenkette = null;
          continue;
        }
        if (c === '/' && inhalt[j + 1] === '*') { kommentar = 'block'; j += 1; continue; }
        if (c === '/' && inhalt[j + 1] === '/') { kommentar = 'zeile'; j += 1; continue; }
        if (c === "'" || c === '"' || c === '`') { zeichenkette = c; continue; }
        if (c === '(') tiefe += 1;
        else if (c === ')') { tiefe -= 1; if (tiefe === 0) break; }
      }
      return [start, j] as const;
    });

    for (const m of inhalt.matchAll(/variante="primary"/gu)) {
      const i = m.index ?? 0;
      const drin = spannen.some(([a, b]) => a < i && i < b);
      if (!drin) continue;
      const zeile = inhalt.slice(0, i).split('\n').length;
      melde('roter-knopf-in-schleife', datei, zeile,
        'variante="primary" steht in einer .map()-Schleife — das ist ein roter '
        + 'Knopf JE ZEILE. DESIGN §5: einer je Bildschirm.');
    }
  }
}

/**
 * Alles läuft in `main()`, und `main()` wird ohne Top-Level-`await` gestartet.
 *
 * Die Wachen werden in `tests/kern/wachen.test.ts` in einem Wegwerf-Baum
 * ausgeführt, der keine `package.json` enthält — dort gilt CJS, und ein
 * `await` auf oberster Ebene ist ein Übersetzungsfehler. Die Folge war, dass
 * FÜNF Wachenprüfungen scheiterten, ohne dass eine Wache etwas gefunden hätte:
 * der Prozess starb vorher. Eine Wache, die nicht startet, meldet nichts.
 */
/**
 * Fest verdrahtete oeffentliche Adressen in Konfigurationsdateien.
 *
 * **Der Fehler, der diese Wache erzwungen hat.** Die Angleichung der
 * Profilpfade an die Seitenkarte (`/reinigung` → `/unternehmen/reinigung`)
 * liess `lighthouserc.json` zurueck. Kein Test schlug an: die Kreuzprobe
 * vergleicht die Routenliste und den App-Router-Baum gegen das Manifest und
 * schaut in keine Konfigurationsdatei. CI fiel erst im Lighthouse-Schritt,
 * mit `ERRORED_DOCUMENT_REQUEST` und Statuscode 404 — eine Viertelstunde
 * spaeter und drei Ebenen von der Ursache entfernt.
 *
 * Eine Adresse, die in einer Konfiguration steht und nirgends sonst, veraltet
 * genau so: lautlos.
 */
/**
 * Wache — jede Datums-ANZEIGE nennt ihre Zeitzone, und die ist Berlin.
 *
 * Invariante 2: gespeichert UTC, angezeigt `Europe/Berlin`. Der Speicherteil
 * ist durch `wacheZeitstempel` und die Spaltentypen gedeckt; der ANZEIGETEIL
 * hing bis hierhin an der Disziplin.
 *
 * Und er faellt leise. `new Date(x).toLocaleDateString('de-DE')` nimmt die
 * Zone des Servers — auf Vercel ist das UTC. Eine Schicht, die am 3. um 00:30
 * Berliner Zeit beginnt, erscheint dann als der 2.; im Sommer verschiebt sich
 * jede Uhrzeit um zwei Stunden. Nichts wirft, nichts faellt rot: es steht ein
 * plausibles Datum da, und es ist das falsche. Genau die Sorte Fehler, die
 * erst im Streit ueber einen Stundennachweis auffaellt.
 *
 * Erlaubt ist deshalb nur, was seine Zone ausdruecklich nennt — entweder
 * `timeZone:` im selben Aufruf oder die geprueften Helfer aus
 * `services/zeit/dauer.ts`.
 */
const ZEIT_ANZEIGE = /\.toLocale(?:Date|Time)?String\s*\(|new\s+Intl\.DateTimeFormat\s*\(/u;

function wacheAnzeigeZeitzone(): void {
  // `tests` steht mit dabei, aus demselben Grund wie bei `wacheDatumZone`:
  // eine Zusicherung, die ein Datum ohne Zone formatiert, misst die Serverzone
  // gegen die Serverzone und geht IMMER auf — auch dann, wenn die Anzeige
  // daneben falsch ist.
  for (const datei of [
    ...mussLesen('src', ['.ts', '.tsx']),
    ...mussLesen('scripts', ['.ts']),
    ...mussLesen('tests', ['.ts', '.tsx']),
  ]) {
    // Ohne Kommentare: der Beispielcode in einem Docblock ist kein Aufruf —
    // diese Wache fand sonst zuerst ihre eigene Erklaerung.
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
      if (!ZEIT_ANZEIGE.test(zeile)) return;
      /*
       * Prozente und Zahlen tragen keine Zone — `toLocaleString` auf einer
       * Zahl ist kein Datum und faellt hier nicht hinein.
       *
       * **Die Ausnahme war vorher blind.** Sie sah nur den AUFRUF und nicht,
       * worauf er steht: `new Date(x).toLocaleString('de-DE')` ist Zeichen
       * fuer Zeichen derselbe Aufruf — und genau der Fehler, gegen den diese
       * Wache geschrieben ist. Er ging durch, ohne dass jemand etwas
       * umgehen musste. Auf Vercel laeuft der Server in UTC: eine Schicht,
       * die am 3. um 00:30 Berliner Zeit beginnt, stand als der 2. im
       * Stundennachweis, im Sommer jede Uhrzeit zwei Stunden daneben.
       *
       * Ausgenommen bleibt deshalb nur, was auf derselben Zeile kein
       * Datum nennt. Im Zweifel meldet die Wache — eine Zahl, die einmal
       * zuviel gemeldet wird, kostet eine Zeile Kommentar; ein Datum, das
       * einmal zuwenig gemeldet wird, kostet einen Streit ueber Stunden.
       */
      const ZAHL_OHNE_ZONE = /\.toLocaleString\s*\(\s*'de-DE'\s*\)/u;
      const NENNT_DATUM = /new\s+Date|Date\s*[.(]|datum|zeit|date|uhr|_am\b|_at\b/iu;
      if (ZAHL_OHNE_ZONE.test(zeile) && !NENNT_DATUM.test(zeile)) return;
      // Die Zone darf im selben Aufruf stehen, also auch ein paar Zeilen
      // weiter unten: `new Intl.DateTimeFormat('de-DE', {` bricht um.
      const fenster = zeilen.slice(i, i + 6).join(' ');
      if (/timeZone\s*:/u.test(fenster)) return;
      melde('anzeige-berlin', datei, i + 1,
        `Datumsanzeige ohne timeZone — nimmt die Serverzone (auf Vercel UTC): ${zeile.trim()}`);
    });
  }
}

async function wacheKonfigAdressen(): Promise<void> {
  const dateien = ['lighthouserc.json'];
  const vorhanden = dateien.filter((d) => existsSync(join(WURZEL, d)));

  /**
   * Kein `lighthouserc.json` heisst: dies ist keiner der echten Baeume,
   * sondern einer der Fixture-Baeume, in denen `wachen.test.ts` die Wachen
   * gegen absichtlich kaputten Code laufen laesst. Dort gibt es nichts zu
   * pruefen — und der Manifest-Import gaebe es auch nicht.
   */
  if (vorhanden.length === 0) return;

  /**
   * Lazy, aus demselben Grund: ein Import an der Dateispitze wird auch im
   * Fixture-Baum aufgeloest, und dort existiert `src/` nicht. Genau daran
   * fielen elf Wachenproben, nachdem diese Wache dazukam.
   */
  const { findeRoute } = await import('../../src/server/registry/routen.js');

  const muster = /https?:\/\/[^"'\s]*localhost:3000(\/[^"'\s]*)?/gu;
  let geprueft = 0;

  for (const datei of vorhanden) {
    const voll = join(WURZEL, datei);
    readFileSync(voll, 'utf8').split('\n').forEach((zeile, i) => {
      for (const m of zeile.matchAll(muster)) {
        const pfad = m[1] ?? '/';
        geprueft += 1;
        if (findeRoute(pfad) === undefined) {
          melde('konfig-adresse', voll, i + 1, `${pfad} steht in keinem Routen-Manifest`);
        }
      }
    });
  }

  // Die Datei ist da, also muss sie Adressen nennen. Ohne diese Zusage
  // bestünde die Wache über einer leeren Menge.
  if (geprueft === 0) {
    throw new Error('Wache Konfig-Adressen: keine einzige Adresse gefunden — Muster kaputt?');
  }
}

/**
 * Guard 11 — die §14-UStG-Vorabpruefung hat GENAU EINE Fassung, und die
 * Festschreibung ruft sie (PR 47, FIN-04, `05-FINANZEN.md` §6).
 *
 * Zwei Ausfaelle, beide leise:
 *
 *  1. Jemand baut eine zweite Regelliste — in einer Route, in einer Seite, in
 *     einem spaeteren Dienst. Ab dann gibt es zwei Antworten auf „erfuellt
 *     dieser Beleg §14 UStG", und die eine, die blockiert, ist nicht die, die
 *     der Mensch auf dem Bildschirm gesehen hat.
 *  2. Jemand nimmt den Aufruf aus `finalisiere()` heraus — weil ein Test
 *     stoert, weil eine Migration gerade laeuft, weil es schnell gehen muss.
 *     Die Datenbank weist den Beleg dann immer noch ab (`0085`), aber mit
 *     einer Meldung ueber einen Ausloeser statt mit der deutschen Feldliste.
 *
 * Die Wache prueft beides. Fehlt `finanz/rechnung.ts` ganz — so wie im
 * Wegwerf-Baum der Wachenprobe —, gibt es nichts zu pruefen und sie schweigt.
 */
function wacheValidator(): void {
  const dienst = join(WURZEL, 'src/server/services/finanz/rechnung.ts');
  if (!existsSync(dienst)) return;

  const pruefer = join(WURZEL, 'src/server/services/finanz/ustg14.ts');
  if (!existsSync(pruefer)) {
    melde('validator-nicht-uebersprungen', dienst, 1,
      'services/finanz/ustg14.ts fehlt — die §14-UStG-Vorabpruefung hat keine Fassung.');
    return;
  }

  /**
   * Der RUMPF von `finalisiere` — nicht die ganze Datei. Ein Import oben
   * genuegt nicht: eine Datei kann den Pruefer importieren und ihn an genau
   * der einen Stelle nicht rufen, an der er zaehlt.
   */
  const inhalt = readFileSync(dienst, 'utf8');
  const start = inhalt.indexOf('export async function finalisiere');
  if (start === -1) {
    melde('validator-nicht-uebersprungen', dienst, 1,
      'finalisiere() gibt es nicht mehr — die Wache weiss nicht, wo sie nachsehen soll.');
  } else {
    const rest = inhalt.slice(start + 1);
    const ende = rest.indexOf('\nexport ');
    const rumpf = ende === -1 ? rest : rest.slice(0, ende);
    const zeile = inhalt.slice(0, start).split('\n').length;
    if (!/pruefeRechnung\s*\(/u.test(rumpf)) {
      melde('validator-nicht-uebersprungen', dienst, zeile,
        'finalisiere() ruft pruefeRechnung() nicht — §14 UStG wird vor der '
        + 'Nummernvergabe nicht geprueft (FIN-04).');
    }
    if (!/\.fehler\.length\s*>\s*0/u.test(rumpf)) {
      melde('validator-nicht-uebersprungen', dienst, zeile,
        'finalisiere() wertet den Befund nicht aus — ein Bericht ohne Abbruch bei '
        + 'einem Fehler ist eine Pruefung, die nichts verhindert.');
    }
  }

  // Und die zweite Fassung: niemand sonst definiert diese Funktionen.
  const DEFINITION =
    /(?:function|const|let|var)\s+(pruefePflichtfelder|pruefeRechnung|kleinbetragLage)\b/u;
  for (const datei of dateien('src', ['.ts', '.tsx'])) {
    if (datei === pruefer) continue;
    ohneKommentare(readFileSync(datei, 'utf8')).split('\n').forEach((z, i) => {
      const treffer = DEFINITION.exec(z);
      if (treffer !== null) {
        melde('validator-nicht-uebersprungen', datei, i + 1,
          `\`${treffer[1] ?? ''}\` ist hier ein zweites Mal definiert — die `
          + '§14-UStG-Regelliste steht ausschliesslich in services/finanz/ustg14.ts.');
      }
    });
  }
}

/**
 * Guard 13 — zwei Migrationen duerfen nicht dieselbe Nummer tragen.
 *
 * **Der Fall, aus dem diese Wache kommt.** Zwei Zweige liefen eine Nacht lang
 * nebeneinander, und beide nummerierten weiter, wo sie abgezweigt waren:
 * `0085`, `0087` und `0088` gab es danach zweimal. Der Migrator sortiert
 * `readdirSync(...).sort()` — er nummeriert nicht, er reiht Dateinamen. Zwei
 * `0087` laufen also in alphabetischer Reihenfolge ihres NAMENS, und die hat
 * mit der Reihenfolge, in der sie geschrieben wurden, nichts zu tun.
 *
 * Das ist keine Fehlermeldung, sondern ein stiller Tausch: `0087_r…` lief vor
 * `0087_s…`, obwohl `0087_s…` zwei Tage aelter ist. Solange die beiden
 * dieselbe Tabelle nicht anfassen, faellt nichts auf. Fassen sie sie an, ist
 * das Ergebnis von der Sortierreihenfolge abhaengig — und ein Zweig, der beim
 * Zusammenfuehren gruen war, kann auf `main` eine andere Datenbank erzeugen
 * als beim Pruefen.
 *
 * Wer zusammenfuehrt, benennt deshalb um, bevor er merged. Diese Wache sagt
 * ihm, dass er es muss.
 */
function wacheMigrationsnummer(): void {
  const verzeichnis = join(WURZEL, 'drizzle');
  if (!existsSync(verzeichnis)) return;
  const jeNummer = new Map<string, string[]>();
  for (const name of readdirSync(verzeichnis).filter((d) => d.endsWith('.sql')).sort()) {
    const nummer = /^(\d{4})_/u.exec(name)?.[1];
    if (nummer === undefined) {
      melde('migrationsnummer', `drizzle/${name}`, 1,
        'Dateiname beginnt nicht mit vier Ziffern und einem Unterstrich.');
      continue;
    }
    jeNummer.set(nummer, [...(jeNummer.get(nummer) ?? []), name]);
  }
  for (const [nummer, namen] of jeNummer) {
    if (namen.length > 1) {
      melde('migrationsnummer', `drizzle/${namen[0] ?? ''}`, 1,
        `Nummer ${nummer} ist ${namen.length}× vergeben: ${namen.join(', ')} — `
        + 'der Migrator sortiert nach NAMEN, nicht nach Nummer. Umbenennen, '
        + 'bevor zusammengefuehrt wird.');
    }
  }
}



/**
 * **`create or replace function` darf keine spätere Schicht verschlucken.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Ausfall, gegen den das geschrieben ist — er ist wirklich passiert.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.angebot_versand_pruefen` wurde in `0024` angelegt (Platzhalterwerte)
 * und in `0295` ERSETZT, um Invariante 7 hineinzulegen: ohne benannten
 * Menschen verlässt nichts das Haus. `0392` brauchte zwei weitere Prüfungen
 * darin, ging von der 0024-Fassung aus — und löschte damit die Preisfreigabe.
 *
 * Danach fiel der Versand ohne Freigabe nur noch am CHECK
 * `angebot_freigabe_vor_versand` auf, mit „violates check constraint" statt
 * dem Satz über den fehlenden Arbeitsschritt; und ein Versand aus
 * `status = 'in_pruefung'` wäre am CHECK ganz vorbeigelaufen, weil dessen
 * erster Zweig diesen Status erlaubt. `0295` sagt das an genau dieser Stelle
 * selbst — im Kommentar, den der Ersetzende nicht mehr sah.
 *
 * **`create or replace` kennt keine halbe Fassung.** Wer eine Funktion
 * ersetzt, ersetzt sie GANZ; was in einer späteren Migration dazukam, ist weg,
 * ohne dass Postgres, TypeScript oder ein Linter etwas dazu sagt. Gefunden hat
 * es eine Isolationsprüfung — nach der Migration, nach dem Typecheck, nach dem
 * Lint.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Wache verlangt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Definiert mehr als eine Migration dieselbe Funktion, muss die NEUESTE die
 * Nummern aller älteren irgendwo in ihrem Text nennen. Das ist keine Formalie:
 * wer sie nennt, hat sie gelesen. Ein Kommentar wie „0024 legte sie an, 0295
 * fügte die Freigabe hinzu" kostet eine Zeile und ist die einzige Stelle, an
 * der ein Mensch merkt, dass da noch etwas war.
 *
 * **Sie prüft NICHT, ob der Inhalt vollständig ist** — das kann sie nicht.
 * Sie erzwingt den Blick, nicht das Ergebnis.
 */
function wacheFunktionMehrfachErsetzt(): void {
  const verzeichnis = join(WURZEL, 'drizzle');
  if (!existsSync(verzeichnis)) return;
  const dateien = readdirSync(verzeichnis).filter((d) => d.endsWith('.sql')).sort();

  /** Funktionsname → Migrationsnummern, in Reihenfolge. */
  const jeFunktion = new Map<string, string[]>();
  const inhalt = new Map<string, string>();
  for (const name of dateien) {
    const nummer = /^(\d{4})_/u.exec(name)?.[1];
    if (nummer === undefined) continue;
    const text = readFileSync(join(verzeichnis, name), 'utf8');
    inhalt.set(nummer, text);
    /* `create [or replace] function <schema>.<name>(` — ohne Rücksicht auf
       Zeilenumbrüche zwischen Name und Klammer. */
    const muster = /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/giu;
    const gesehen = new Set<string>();
    for (const treffer of text.matchAll(muster)) {
      const fn = treffer[1]!.toLowerCase();
      if (gesehen.has(fn)) continue;
      gesehen.add(fn);
      jeFunktion.set(fn, [...(jeFunktion.get(fn) ?? []), nummer]);
    }
  }

  for (const [fn, nummern] of jeFunktion) {
    if (nummern.length < 2) continue;
    const neueste = nummern[nummern.length - 1]!;
    const aeltere = nummern.slice(0, -1);
    const text = inhalt.get(neueste) ?? '';
    const ungenannt = aeltere.filter((n) => !text.includes(n));
    if (ungenannt.length === 0) continue;
    if (FUNKTION_ALTLAST.has(`${neueste}:${fn}`)) continue;
    const datei = dateien.find((d) => d.startsWith(`${neueste}_`)) ?? neueste;
    melde('funktion-mehrfach-ersetzt', `drizzle/${datei}`, 1,
      `\`${fn}\` wird auch in ${ungenannt.map((n) => `${n}`).join(', ')} definiert, und `
      + 'diese Migration nennt sie nicht. `create or replace` ersetzt die Funktion GANZ — '
      + 'was dort dazukam, ist danach weg, ohne dass jemand etwas sagt. Die aeltere '
      + 'Fassung lesen und ihre Nummer im Kommentar nennen.');
  }
}

/**
 * Jede SVG unter `public/` ist wohlgeformtes XML.
 *
 * **Warum es diese Wache gibt.** Alle acht Motivtafeln waren monatelang
 * kaputt und niemand sah es: der Kommentar ueber dem Overlay-Verlauf nannte
 * den CSS-Token mitsamt seinen zwei fuehrenden Bindestrichen, und ein
 * XML-Kommentar darf keinen doppelten Bindestrich enthalten. Eine SVG IST
 * XML. Der Server lieferte die Datei mit 200, der Browser weigerte sich sie
 * zu zeichnen, und die Startseite zeigte an jeder Bildstelle ein kaputtes
 * Symbol.
 *
 * **Warum kein Test es fing.** Der Browsertest prueft die sichtbare
 * Kennzeichnung `Platzhalterbild` — ein `<span>` NEBEN dem Bild. Das
 * `<img>`-Element war da, sein `src` stimmte, die Antwort war 200. Gruen war
 * also alles, was geprueft wurde; ungeprueft blieb das einzige, worauf es
 * ankam. Deshalb steht die Pruefung hier und nicht dort: eine Datei, die kein
 * Browser lesen kann, ist im Repository falsch, nicht erst auf der Seite.
 *
 * Geprueft wird mit `DOMParser` gegen `image/svg+xml`; der meldet denselben
 * Fehler, an dem auch der Browser aussteigt.
 */
/**
 * Jede SVG unter `public/` muss wohlgeformtes XML sein (D-376).
 *
 * **Der Ausfall, gegen den das geschrieben ist.** Acht Motivtafeln lagen im
 * Baum, sahen im Editor richtig aus und waren nie wohlgeformt: ein
 * XML-Kommentar enthielt einen doppelten Bindestrich. Der Server lieferte sie
 * mit 200 aus, der Browser verwarf sie beim Parsen und zeichnete ein kaputtes
 * Bild. Die Startseite war leer, und niemand sah warum.
 *
 * **Warum keine Pruefung im Browsertest.** Es gab eine. Sie war gruen. Sie
 * prueft die sichtbare Kennzeichnung NEBEN dem Bild — und die stand ja da.
 * Das `<img>` war im DOM, der `src` stimmte, die Antwort war 200, die Datei
 * existierte. Alles eine Ebene unter dem Fehler war in Ordnung; genau deshalb
 * gehoert die Pruefung hierher, wo die Datei selbst gelesen wird, und nicht
 * dorthin, wo eine Seite sie einbindet.
 */
function wacheSvgWohlgeformt(): void {
  /**
   * Geprueft wird das VERZEICHNIS, nicht die Trefferzahl.
   *
   * `mussLesen` waere hier falsch: kommen eines Tages echte Fotos und
   * verschwinden die Tafeln, ist null SVG das richtige Ergebnis und kein
   * Grund, den Zweig rot zu faerben. Der Ausfall, den `mussLesen` abfaengt —
   * ein vertippter Pfad, der still nichts liest —, faellt hier auf den
   * Pfad selbst zurueck: `public/` gibt es im echten Baum immer.
   */
  if (ECHTER_BAUM && !existsSync(join(WURZEL, 'public'))) {
    throw new Error(
      'Merge-Wachen: `public/` fehlt. Eine Wache, die nichts liest, meldet "sauber".',
    );
  }

  for (const datei of dateien('public', ['.svg'])) {
    const fehler = pruefeXml(readFileSync(datei, 'utf8'));
    if (fehler !== null) {
      melde(
        'svg-wohlgeformt', datei, fehler.zeile,
        `Kein wohlgeformtes XML — der Browser liefert die Datei mit 200 aus und `
        + `zeichnet sie NICHT: ${fehler.text}`,
      );
    }
  }
}

/**
 * Jeder Konformitaetsbereich hat seinen EIGENEN CI-Auftrag und seinen eigenen
 * Aufruf — und kein Auftrag faehrt `pnpm test:compliance` unbesehen.
 *
 * **Der Fehlschlag, gegen den das geschrieben ist.** `tests/compliance/`
 * enthaelt Pruefungen gegen FREMDE Werkzeuge, und jedes Werkzeug installiert
 * sich sein Auftrag selbst: KoSIT braucht `KOSIT_JAR`, veraPDF `VERAPDF_CLI`.
 * Beide Auftraege riefen `pnpm test:compliance` auf, und das faehrt die ganze
 * Konfiguration. Also fuhr der KoSIT-Auftrag auch den veraPDF-Test, ohne
 * dessen Werkzeug — und die Tests sind mit Absicht so gebaut, dass ein
 * fehlendes Werkzeug in CI ein Fehlschlag ist und kein Ueberspringen. Ergebnis:
 * ein roter Auftrag, dessen eigene Pruefung gruen war, und das an einem Tag,
 * an dem niemand an der XRechnung etwas geaendert hatte.
 *
 * **Warum eine Wache und nicht nur die Korrektur.** Der naechste Bereich
 * (Z3/GoBD in Phase 7 zum Beispiel) bringt wieder ein eigenes Werkzeug mit.
 * Wer ihn anlegt und den Auftrag vergisst, bekaeme entweder einen Bereich,
 * den niemand prueft, oder faerbte zwei fremde Auftraege rot. Beides faellt
 * hier auf, bevor es zusammengefuehrt wird.
 */
function wacheKonformitaetsauftrag(): void {
  const wurzel = join(WURZEL, 'tests', 'compliance');
  // Kein Konformitaetsbereich, nichts zu sagen — und die Wache laeuft auch im
  // Wegwerf-Baum von `wachen.test.ts`, sobald der einen anlegt.
  if (!existsSync(wurzel)) return;

  const paket = join(WURZEL, 'package.json');
  const ablauf = join(WURZEL, '.github', 'workflows', 'compliance.yml');
  if (!existsSync(ablauf)) {
    melde('konformitaetsauftrag', ablauf, 1,
      'Es gibt `tests/compliance/`, aber keinen CI-Ablauf, der die Pruefungen faehrt.');
    return;
  }
  if (!existsSync(paket)) {
    melde('konformitaetsauftrag', paket, 1,
      'Es gibt `tests/compliance/`, aber keine `package.json` mit den Skripten je Bereich.');
    return;
  }
  const skripte = (JSON.parse(readFileSync(paket, 'utf8')) as {
    scripts?: Record<string, string>;
  }).scripts ?? {};
  const ablaufText = readFileSync(ablauf, 'utf8');

  /*
   * Der unbesehene Aufruf ist der Fehler selbst — `pnpm test:compliance` ohne
   * Bereich am Ende der Zeile. Die Wache liest zeilenweise, damit
   * `test:compliance:zugferd` NICHT als Treffer zaehlt.
   */
  ablaufText.split('\n').forEach((zeile, i) => {
    if (/pnpm\s+(run\s+)?test:compliance\s*$/u.test(zeile)) {
      melde('konformitaetsauftrag', ablauf, i + 1,
        'Dieser Auftrag faehrt ALLE Konformitaetspruefungen, auch die fremder '
        + 'Bereiche, deren Werkzeug er nicht installiert hat. `pnpm '
        + 'test:compliance:<bereich>` aufrufen.');
    }
  });

  const bereiche = readdirSync(wurzel)
    .filter((d) => statSync(join(wurzel, d)).isDirectory())
    .filter((d) => dateien(join('tests', 'compliance', d), ['.test.ts']).length > 0);
  if (bereiche.length === 0) {
    throw new Error(
      'Merge-Wachen: `tests/compliance/` enthaelt keinen Bereich mit Tests. '
      + 'Eine Wache, die nichts liest, meldet "sauber".',
    );
  }

  for (const bereich of bereiche) {
    const name = `test:compliance:${bereich}`;
    const skript = skripte[name];
    if (skript === undefined) {
      melde('konformitaetsauftrag', paket, 1,
        `Bereich \`tests/compliance/${bereich}\` hat kein Skript \`${name}\`. `
        + 'Ohne eigenes Skript kann sein CI-Auftrag nur alles fahren — auch fremde '
        + 'Werkzeuge, die er nicht hat.');
    } else if (!skript.includes(`tests/compliance/${bereich}`)) {
      melde('konformitaetsauftrag', paket, 1,
        `\`${name}\` schraenkt nicht auf \`tests/compliance/${bereich}\` ein und `
        + 'faehrt damit auch fremde Bereiche.');
    }
    if (!ablaufText.includes(name)) {
      melde('konformitaetsauftrag', ablauf, 1,
        `Kein Auftrag ruft \`pnpm ${name}\` auf. Ein Konformitaetsbereich, den `
        + 'CI nicht faehrt, ist eine Pruefung auf Zuruf (FIN-11, §5.14.3).');
    }
  }

  /*
   * Und die Gegenrichtung: ein Skript fuer einen Bereich, den es nicht mehr
   * gibt, laesst einen CI-Auftrag gruen durchlaufen, ohne eine Datei zu lesen.
   */
  for (const name of Object.keys(skripte)) {
    const bereich = /^test:compliance:(.+)$/u.exec(name)?.[1];
    if (bereich !== undefined && !bereiche.includes(bereich)) {
      melde('konformitaetsauftrag', paket, 1,
        `\`${name}\` zeigt auf \`tests/compliance/${bereich}\` — das Verzeichnis `
        + 'gibt es nicht (mehr). Der Auftrag laeuft gruen, ohne zu pruefen.');
    }
  }
}

/**
 * Guard — **kein interner Redirect gegen `nextUrl.origin`.**
 *
 * `NextRequest.nextUrl` trägt die Adresse, unter der der SERVER die Anfrage
 * angenommen hat, nicht die, die im Browser steht. Hinter einem Proxy, einem
 * Tunnel oder einem anderen Port ist das eine andere — und ein `303` dorthin
 * schickt den Menschen nach dem Absenden eines Formulars auf einen Wirt, den
 * er nie aufgerufen hat. Beendet der Proxy TLS, steht dort ausserdem `http`,
 * und der Rückweg aus dem Portal ist ein Downgrade.
 *
 * Gefunden wurde das zweimal von Hand: einmal als `{"fehler":
 * "fremder_ursprung"}` beim Sprachwechsel (D-562), einmal als 404 nach jedem
 * Formular. Beim zweiten Mal steckte dieselbe Zeile in 27 Dateien.
 *
 * Richtig ist `erwarteterUrsprung(anfrage)` — es liest den `Host`-Kopf und
 * fällt erst danach auf `nextUrl` zurück — oder `internesZiel(...)`, das
 * zusätzlich prüft, dass ein mitgegebener Rückweg derselbe Ursprung ist.
 * `server/auth/ursprung.ts` ist die eine Stelle, an der `nextUrl` stehen darf.
 */
function wacheInternerUrsprung(): void {
  for (const datei of mussLesen('src', ['.ts', '.tsx'])) {
    if (datei.replace(/\\/gu, '/').endsWith('src/server/auth/ursprung.ts')) continue;
    ohneKommentare(readFileSync(datei, 'utf8'))
      .split('\n')
      .forEach((zeile, i) => {
        if (/\bnextUrl\s*\.\s*(?:origin|host)\b/u.test(zeile)) {
          melde('interner-ursprung', datei, i + 1, zeile.trim());
        }
      });
  }
}

/**
 * Die Sperrklinke gegen die deutsche Verdrahtung (D-419, D-592).
 *
 * **Warum sie VOR der Umstellung steht.** 383 Dateien unter `portal/` und
 * `components/` tragen ihre sichtbaren Woerter als Zeichenketten im Rumpf;
 * deshalb wurde beim Sprachwechsel auf Englisch die Seitenleiste englisch und
 * der Seiteninhalt blieb deutsch. Die Umstellung dauert laenger als eine
 * Sitzung. Ohne diese Wache waechst der Rueckstand waehrend der Arbeit weiter
 * — und wird nie kleiner.
 *
 * **Sie meldet in BEIDE Richtungen.** Eine Datei mit fester Zeichenkette, die
 * nicht in der Liste steht, ist eine neue Verdrahtung. Ein Listeneintrag ohne
 * feste Zeichenkette ist eine erledigte Seite, die noch drinsteht — und wer
 * ihn nicht streicht, nimmt der Wache genau dort die Schaerfe, wo sie eben
 * erst gewonnen wurde. Ein Eintrag auf eine Datei, die es nicht mehr gibt,
 * faellt in dieselbe Klasse.
 */
function wacheSeiteOhneUebersetzung(): void {
  /*
   * Ohne den Compiler liest diese Wache nichts. Im Wegwerf-Baum ist das
   * richtig; im echten Baum ist es der Ausfall, vor dem `dateien()` warnt —
   * „alles sauber", ohne eine Zeile gelesen zu haben.
   */
  if (compilerOderNichts() === null) {
    if (ECHTER_BAUM) {
      melde('seite-ohne-uebersetzung', 'scripts/guards/seite-ohne-uebersetzung.ts', 1,
        'TypeScript liess sich nicht laden — die Wache konnte nicht pruefen.');
    }
    return;
  }

  const erlaubt = new Set(UEBERSETZUNG_AUSNAHMEN);
  const gesehen = new Set<string>();
  /*
   * Dazu die beiden Flächen der Beschäftigten OHNE Sitzung (V-200, SEITENKARTE
   * §12): Stempeluhr und Anmeldung. Sie lagen ausserhalb der Wurzeln, und
   * genau dort blieben sie fest deutsch, ohne dass diese Wache etwas sah.
   */
  const wurzeln = ['src/app/portal', 'src/components', 'src/app/check-in', 'src/app/auth/mitarbeiter'];
  let gelesen = 0;

  for (const wurzel of wurzeln) {
    /* `dateien` setzt die Wurzel selbst davor — ein absoluter Pfad hier
       ergaebe `<WURZEL>/<WURZEL>/src/...`, und der `catch` darin schluckt
       das lautlos. Genau dagegen steht die Zaehlung unten. */
    for (const datei of dateien(wurzel, ['.tsx'])) {
      gelesen += 1;
      const rel = relative(WURZEL, datei).replace(/\\/gu, '/');
      const funde = festeZeichenketten(datei);
      if (funde.length > 0) {
        gesehen.add(rel);
        if (!erlaubt.has(rel)) {
          const f = funde[0];
          melde('seite-ohne-uebersetzung', datei, f?.zeile ?? 1,
            `${funde.length} fest verdrahtete Beschriftung(en), z. B. „${f?.text ?? ''}" `
            + '— Text nach src/lib/i18n/verwaltung/ holen');
        }
      }
    }
  }

  /*
   * Eine leere Liste sieht aus wie ein sauberer Baum (siehe `dateien`). Diese
   * Wache haette dann „alles sauber" gemeldet, ohne eine Datei gelesen zu
   * haben — und der Abgleich unten haette alle 383 Eintraege als erledigt
   * gemeldet. Beides waere falsch, also wird der Lauf hier festgestellt.
   */
  if (gelesen === 0) {
    /*
     * Im Wegwerf-Baum von `wachen.test.ts` gibt es kein `src/app/portal` — und
     * dort ist das richtig so, nicht ein Ausfall. Im ECHTEN Baum ist es einer:
     * die Wache haette „alles sauber" gemeldet, ohne eine Datei gelesen zu
     * haben, und der Abgleich unten haette alle 396 Eintraege als erledigt
     * ausgewiesen.
     */
    if (ECHTER_BAUM) {
      melde('seite-ohne-uebersetzung', 'scripts/guards/uebersetzung-ausnahmen.ts', 1,
        'Keine einzige .tsx gelesen — die Wache lief ins Leere.');
    }
    return;
  }

  for (const rel of erlaubt) {
    if (gesehen.has(rel)) continue;
    melde('seite-ohne-uebersetzung', 'scripts/guards/uebersetzung-ausnahmen.ts', 1,
      `„${rel}" hat keine feste Beschriftung mehr (oder existiert nicht mehr) `
      + '— die Zeile gehoert aus der Ausnahmeliste gestrichen.');
  }
}

async function main(): Promise<void> {
  wacheGeldSpalte();
  wacheZeitstempel();
  wacheRouteOhneDb();
  wachePageExporte();
  wacheTodoClient();
  wacheDatumZone();
  wacheBacktickImSql();
  wacheEuRegion();
  wacheEinAusgang();
  wacheSpeicherEntfernen();
  wacheTailwindFarben();
  wacheAnzeigeZeitzone();
  wacheValidator();
  wacheMigrationsnummer();
  wacheFunktionMehrfachErsetzt();
  wacheSvgWohlgeformt();
  wacheKonformitaetsauftrag();
  wacheInternerUrsprung();
  wacheSeiteOhneUebersetzung();
  wacheRoterKnopfInSchleife();
  await wacheKonfigAdressen();

  if (befunde.length > 0) {
    console.error(`\n${befunde.length} Verstoß/Verstöße gegen die Merge-Wachen:\n`);
    for (const b of befunde) {
      console.error(`  [${b.wache}] ${b.datei}:${b.zeile}\n      ${b.text}`);
    }
    console.error('');
    process.exit(1);
  }
  console.log('Merge-Wachen: alle sauber.');
}

main().catch((fehler: unknown) => {
  // Ein Absturz der Wachen ist ein roter Lauf, kein grüner. Ohne diesen
  // `catch` würde eine abgelehnte Zusage nur eine Warnung ausgeben.
  console.error('Merge-Wachen abgebrochen:', fehler);
  process.exit(1);
});
