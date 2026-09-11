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
  for (const datei of [...dateien('src/server/db', ['.ts']), ...dateien('drizzle', ['.sql'])]) {
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
      });
  }
}

/**
 * Guard 3 — a route handler never touches the database directly.
 * CLAUDE.md: authorize → call a service → return. A handler holding a query
 * is a handler that can be given one without a tenant predicate.
 */
function wacheRouteOhneDb(): void {
  for (const datei of dateien('src/app', ['.ts', '.tsx'])) {
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
function wacheTodoClient(): void {
  const register = readFileSync(join(WURZEL, 'docs/DECISIONS.md'), 'utf8');
  const bekannt = new Set(
    [...register.matchAll(/^\|\s*(O-\d{1,3})\s*\|/gmu)].map((m) => m[1] ?? ''),
  );
  const zuPruefen = [
    ...dateien('src', ['.ts', '.tsx']),
    ...dateien('scripts', ['.ts']),
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
    ...dateien('src', ['.ts', '.tsx']),
    ...dateien('drizzle', ['.sql']),
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
  for (const datei of dateien('src', ['.ts', '.tsx'])
    .concat(dateien('tests', ['.ts']))) {
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

function wacheEinAusgang(): void {
  const erlaubt = [join('server', 'versand'), join('server', 'agent', 'policy')];
  const zuPruefen = dateien('src', ['.ts', '.tsx']).filter(
    (d) => !erlaubt.some((e) => d.includes(e)),
  );

  for (const datei of zuPruefen) {
    readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
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
  const quellen = dateien('src', ['.ts', '.tsx']);
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
          if (schatten.has(rest) || rest === 'none' || farben.has(rest)) continue;
          continue;
        }
        if (!FARBPRAEFIX.includes(praefix)) continue;
        if (farben.has(rest)) continue;
        melde('tailwind-farbe', datei, i + 1,
          `\`${praefix}-${rest}\` — keine Farbe im Thema.`);
      }
    });
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
  for (const datei of [...dateien('src', ['.ts', '.tsx']), ...dateien('scripts', ['.ts'])]) {
    // Ohne Kommentare: der Beispielcode in einem Docblock ist kein Aufruf —
    // diese Wache fand sonst zuerst ihre eigene Erklaerung.
    const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
    zeilen.forEach((zeile, i) => {
      if (!ZEIT_ANZEIGE.test(zeile)) return;
      // Prozente und Zahlen tragen keine Zone — `toLocaleString` auf einer
      // Zahl ist kein Datum und faellt hier nicht hinein.
      if (/toLocaleString\s*\(\s*'de-DE'\s*\)/u.test(zeile)) return;
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

async function main(): Promise<void> {
  wacheGeldSpalte();
  wacheZeitstempel();
  wacheRouteOhneDb();
  wacheTodoClient();
  wacheDatumZone();
  wacheBacktickImSql();
  wacheEuRegion();
  wacheEinAusgang();
  wacheTailwindFarben();
  wacheAnzeigeZeitzone();
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
