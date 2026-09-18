/**
 * Wo wird ein Rechteschlüssel tatsächlich BENUTZT?
 *
 * Ein Schlüssel gilt als benutzt, wenn Code ihn prüft — nicht, wenn der
 * Katalog ihn aufzählt. Der erzeugte Seed-Block in `0008` enthält
 * naturgemäss jeden Schlüssel; würde er mitgezählt, wäre jeder Schlüssel
 * immer "benutzt" und die Prüfung eine Tautologie. Genau das ist beim ersten
 * Lauf passiert.
 *
 * Zwei Filter, beide gegen falsch-positive Funde:
 *  - die erzeugten Katalogblöcke werden vor dem Scannen herausgeschnitten;
 *  - ein Treffer, dessen letztes Segment eine Dateiendung ist, ist ein Pfad
 *    (`services/zeit.ts`), kein Schlüssel;
 *  - Kommentare werden entfernt. Ein Schlüssel, der in einem Kommentar
 *    ERWÄHNT wird, wird nicht geprüft — und beim ersten Lauf zählten genau
 *    zwei Erwähnungen in Prosa als Benutzung.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { MODULE } from './extrahiere.js';
import { BEGINN, ENDE } from './seed-sql.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/** Endungen, die einen Treffer als Dateipfad entlarven. */
const ENDUNGEN = new Set(['ts', 'tsx', 'js', 'mjs', 'sql', 'md', 'json', 'css', 'png', 'svg']);

/**
 * Zwei Detektoren, und der zweite ist der wichtigere.
 *
 * `MODUL_LITERAL` findet Schlüssel an ihrem Modul — breit, aber blind für
 * genau den Fall, den die Vorgabe als Fixture nennt: `rechnung.lesen`. Das
 * Modul `rechnung` gibt es nicht (der Schlüssel heisst `finanzen.lesen`), also
 * greift der Modulfilter nicht, und ein erfundener Schlüssel käme durch.
 *
 * `AUFRUF` findet stattdessen die STELLE: was in `hat_recht(…)` steht oder
 * unter `recht:` im Routenmanifest, ist ein Rechteschlüssel — egal, wie sein
 * erstes Segment heisst. Was dort steht und keine Katalogzeile hat, ist ein
 * dauerhaft leerer Bildschirm.
 */
const MODUL_LITERAL = new RegExp(
  `['"\`]((?:${MODULE.join('|')})\\.[a-z_]+(?:\\.[a-z_]+)?)['"\`]`, 'gu',
);

const AUFRUF = /(?:hat_recht|hatRecht)\s*\(\s*['"`]([a-z_.]+)['"`]|\brecht:\s*['"`]([a-z_.]+)['"`]/gu;

function dateien(verzeichnis: string, endungen: readonly string[]): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...dateien(voll, endungen));
    else if (endungen.some((x) => e.endsWith(x))) treffer.push(voll);
  }
  return treffer;
}

/** Entfernt Kommentare: `--`, `//` und `/* … *​/`. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .split('\n')
    .map((z) => z.replace(/(^|\s)(--|\/\/).*$/u, '$1'))
    .join('\n');
}

/**
 * Entfernt `schluessel: '…'`-Eigenschaften.
 *
 * In diesem Projekt benennt `schluessel:` die Kennung eines REGISTERS — eine
 * Benachrichtigungsart (`crm.neuer_lead`), einen Job, ein Formular. Ein
 * Rechteschlüssel steht nie dort: er steht in `hat_recht('…')`, unter `recht:`
 * oder unter `schreibRecht:`, und genau die findet `AUFRUF`.
 *
 * Ohne diesen Schnitt meldete `MODUL_LITERAL` jede Benachrichtigungsart als
 * unregistrierten Rechteschlüssel — dieselbe Form (`<modul>.<etwas>`, und die
 * Datenbank erzwingt sie für Benachrichtigungen sogar per CHECK). Die Prüfung
 * verlöre damit ihre Aussage: wer sie kennt, benennt seine Arten um, statt den
 * echten Fund zu suchen.
 */
function ohneRegisterKennungen(inhalt: string): string {
  return inhalt.replace(/\bschluessel:\s*['"`][^'"`]*['"`]/gu, 'schluessel: _');
}

/**
 * Dieselbe Aufgabe für SQL — und dort gibt es DREI Register mit derselben
 * Form `<modul>.<etwas>`, die keine Rechteschlüssel sind.
 *
 * Der Unterschied ist nicht sichtbar: `'zeit.geolokalisierung'` (eine
 * Einstellung), `'zeit.eingestempelt'` (eine Auditaktion) und `'zeit.lesen'`
 * (ein Rechteschlüssel) sehen für einen Textscanner gleich aus. Ohne diesen
 * Schnitt meldete die Prüfung jede Einstellung und jede Auditaktion als
 * unregistriertes Recht — und wer sie kennt, benennt seine Einstellungen um,
 * statt den echten Fund zu suchen. Genau davor warnt der Kommentar über
 * `ohneRegisterKennungen`.
 *
 * Was ein Rechteschlüssel ist, bleibt unberührt: `app.hat_recht('…')` und
 * `app.rechte_mandanten('gruppe.…')` findet `AUFRUF` weiterhin, und ein
 * Tippfehler dort bricht den Build wie zuvor.
 */
function ohneSqlRegister(inhalt: string): string {
  return inhalt
    // (1) Betriebseinstellungen: `app.einstellung(<mandant>, '<schluessel>')`
    //     und die einargumentige Form. Eigentümer: 01-KERN §6.30.
    .replace(/\bapp\.einstellung\s*\([^)]*\)/gu, 'app.einstellung(_)')
    /**
     * (2) Auditaktionen: das erste Argument von `app.protokolliere(...)` ist
     *     der Name der HANDLUNG (`zeit.eingestempelt`), nicht ein Recht.
     *
     * Verschluckt wird der ganze Aufruf bis zum abschliessenden `);`, mit
     * Zeichenketten am Stück — sonst entkäme jede Aktion, die als Ausdruck
     * geschrieben ist (`case when … then 'zeit.eingestempelt' … end`), und
     * ausgerechnet die interessanten sind Ausdrücke.
     */
    .replace(/\bapp\.protokolliere\s*\((?:[^';]|'(?:[^']|'')*')*\);/gu,
      'app.protokolliere(_);')
    /**
     * (3) Der Seed der Einstellungen selbst: eine `insert into
     *     mandant_einstellung … ;`-Anweisung besteht der Länge nach aus
     *     Schlüsseln dieses Registers.
     *
     * Das Muster verschluckt Zeichenketten AM STÜCK statt bis zum nächsten
     * Semikolon zu laufen. Eine erste Fassung tat das Zweite und stolperte
     * über einen Beschreibungstext, in dem ein Semikolon steht — sie schnitt
     * mitten in der `values`-Liste ab, und die Hälfte der Schlüssel kam
     * trotzdem durch. Ein Satzzeichen in einem Fließtext darf nicht
     * entscheiden, was diese Prüfung sieht.
     */
    .replace(
      /\binsert\s+into\s+(?:public\.)?mandant_einstellung(?:[^';]|'(?:[^']|'')*')*;/giu,
      'insert into mandant_einstellung _;')
    /**
     * (4) Das VIERTE Register derselben Form: die Plattformeinstellungen.
     *
     * `app.plattform_einstellung('finanzen.bauabzugsteuer_satz_bp')` ist ein
     * Einstellungsschlüssel und kein Recht — genau wie (1) für die
     * Betriebseinstellungen. Dass es so lange gutging, ist Zufall: die
     * vorhandenen Plattformschlüssel beginnen mit `auth.`, und `auth` steht
     * nicht in `MODULE`. `finanzen` steht dort, und der erste Schlüssel mit
     * diesem Präfix meldete sich prompt als unregistriertes Recht.
     *
     * Beide Formen: der Aufruf (auch in einer SQL-Zeichenkette in TypeScript,
     * denn `funde()` schneidet jede Quelle gleich) und der Seed der Tabelle.
     */
    .replace(/\bapp\.plattform_einstellung\s*\([^)]*\)/gu, 'app.plattform_einstellung(_)')
    .replace(
      /\binsert\s+into\s+(?:public\.)?plattform_einstellung(?:[^';]|'(?:[^']|'')*')*;/giu,
      'insert into plattform_einstellung _;')
    /**
     * (5) Das FUENFTE Register: die Benachrichtigungsarten.
     *
     * `benachrichtigung.art` traegt `<modul>.<ereignis>` — die Tabelle
     * erzwingt die Form per CHECK, und sie ist Zeichen fuer Zeichen die eines
     * Rechteschluessels. In TypeScript stehen die Arten unter `schluessel:`
     * und werden oben geschnitten; in SQL stehen sie als Literal in der
     * `insert`-Anweisung eines Definer-Schreibers
     * (`app.agent_stopp_vermerken`, 0128).
     *
     * `benachrichtigung\b` und nicht `benachrichtigung`: sonst verschluckt
     * dasselbe Muster `benachrichtigung_praeferenz` gleich mit — eine andere
     * Tabelle, deren Inhalt hier niemand ausblenden wollte.
     */
    .replace(
      /\binsert\s+into\s+(?:public\.)?benachrichtigung\b(?:[^';]|'(?:[^']|'')*')*;/giu,
      'insert into benachrichtigung _;');
}

/**
 * Ein Name in Backticks INNERHALB einer Zeichenkette ist Prosa, kein Wert.
 *
 * Dieses Projekt nennt Bezeichner in Fliesstext mit Backticks — in
 * `comment on column`, in `grund:`-Feldern des RLS-Registers und in Saetzen,
 * die eine Oberflaeche anzeigt. `MODUL_LITERAL` sieht dort ein
 * backtick-begrenztes `<modul>.<wort>` und haelt es fuer einen
 * Rechteschluessel. Sechs Meldungen dieser Art kamen mit der Domaenenwelle auf
 * einmal, und keine einzige war ein Recht:
 *
 *     comment on column nachricht.kunde_id is
 *       'Denormalisiert aus `nachricht.kunde_id` (Ausloeser, beide Richtungen).'
 *
 * Das ist eine SPALTE. Waere die Meldung berechtigt, muesste man eine
 * Katalogzeile fuer `nachricht.kunde_id` anlegen — ein Recht, das niemand je
 * prueft, und genau der leere Eintrag, den K-19 verhindern will.
 *
 * **Warum das nichts aufweicht.** Geschnitten wird nur, was in einer
 * Zeichenkette steht UND darin von Backticks umschlossen ist. Ein Schluessel
 * an seiner Verwendungsstelle steht nie so: er steht als Argument von
 * `hat_recht(…)` oder unter `recht:`, und dort findet ihn `AUFRUF` — der
 * staerkere der beiden Detektoren, der an der STELLE erkennt und nicht am
 * Modulnamen. Der bleibt unberuehrt.
 */
function ohneProsaInZeichenketten(inhalt: string): string {
  return inhalt.replace(
    /'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/gu,
    (zeichenkette) => zeichenkette.replace(/`[a-z_]+\.[a-z_.]+`/gu, '`_`'),
  );
}

/**
 * Das SECHSTE und das SIEBTE Register derselben Form: Auditaktionen und
 * Benachrichtigungsarten.
 *
 * Beide tragen `<modul>.<ereignis>` — Zeichen fuer Zeichen die Form eines
 * Rechteschluessels, und beide sind keine Rechte:
 *
 *     app.protokolliere('radar.stand_gesetzt', 'ausschreibung_vorgang', …)
 *     where a.aktion = 'radar.stand_gesetzt'
 *     if p_art is distinct from 'dienstplan.plan_veroeffentlicht' then
 *
 * Die Benachrichtigungsart war bisher nur in ihrer EINEN Schreibform
 * ausgenommen (`insert into benachrichtigung …`, Fall 5). Ein Definer, der die
 * Art zuerst PRUEFT und dann zustellt (0266), schreibt sie aber in einem
 * Vergleich — und der sah aus wie ein Recht. Dass es so lange gutging, lag
 * daran, dass bis dahin niemand die Art gegen einen festen Wert geprueft hat.
 *
 * Geschnitten wird deshalb an der Stelle, die die Bedeutung traegt: das erste
 * Argument von `app.protokolliere(…)`, und ein Literal, das mit `aktion` oder
 * `art` verglichen wird.
 */
function ohneAktionUndArt(inhalt: string): string {
  return inhalt
    .replace(/\bapp\.protokolliere\s*\(\s*['"`][a-z_.]+['"`]/giu,
      "app.protokolliere('_'")
    .replace(
      /\b(?:[a-z_]+\.)?(?:p_)?(?:aktion|art)\s*(?:=|<>|!=|is\s+(?:not\s+)?distinct\s+from)\s*['"`][a-z_.]+['"`]/giu,
      "aktion = '_'");
}


/** Schneidet den erzeugten Katalogblock heraus — er ist die Liste, nicht ihre Benutzung. */
function ohneKatalogblock(inhalt: string): string {
  const von = inhalt.indexOf(BEGINN);
  const bis = inhalt.indexOf(ENDE);
  if (von < 0 || bis < 0) return inhalt;
  return inhalt.slice(0, von) + inhalt.slice(bis + ENDE.length);
}

export interface Fund {
  readonly schluessel: string;
  readonly datei: string;
}

export function funde(): readonly Fund[] {
  const quellen = [
    ...dateien(join(WURZEL, 'src'), ['.ts', '.tsx']),
    ...dateien(join(WURZEL, 'drizzle'), ['.sql']),
  ].filter((d) => !d.endsWith('katalog.generiert.ts'));

  const alle: Fund[] = [];
  for (const datei of quellen) {
    const inhalt = ohneAktionUndArt(ohneProsaInZeichenketten(ohneSqlRegister(ohneRegisterKennungen(
      ohneKommentare(ohneKatalogblock(readFileSync(datei, 'utf8')))))));
    for (const m of inhalt.matchAll(MODUL_LITERAL)) {
      const schluessel = m[1]!;
      if (ENDUNGEN.has(schluessel.split('.').at(-1)!)) continue;
      alle.push({ schluessel, datei: relative(WURZEL, datei) });
    }
    for (const m of inhalt.matchAll(AUFRUF)) {
      const schluessel = m[1] ?? m[2]!;
      // Ein Schlüssel hat mindestens zwei Segmente; `null` und dergleichen
      // sind keine.
      if (!schluessel.includes('.')) continue;
      alle.push({ schluessel, datei: relative(WURZEL, datei) });
    }
  }
  return alle;
}

export function benutzteSchluessel(): ReadonlySet<string> {
  return new Set(funde().map((f) => f.schluessel));
}
