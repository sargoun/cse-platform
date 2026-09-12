/**
 * PR 30 — die Zusagen der Migration 0028, gegen ihren eigenen Text geprueft.
 *
 * Keine Datenbank, mit Absicht: das sind Behauptungen ueber das REPOSITORY, und
 * sie muessen auf einem Rechner ohne laufendes Postgres in derselben Sekunde
 * fallen, in der jemand die Datei aendert. Die Datenbankseite — RLS greift,
 * Mandanten sehen einander nicht — pruefen die Isolationstests, und die
 * brauchen eine Instanz.
 *
 * Geprueft wird nur, was STILL falsch wird. Eine vergessene Bedingung meldet
 * sich beim Anwenden der Migration; eine fehlende `force`-Zeile, eine
 * Ausschlusssperre auf `einsatz` oder ein einspaltiger Fremdschluessel dagegen
 * lassen die Migration anstandslos durchlaufen und faellt erst auf, wenn eine
 * Nachtschicht verschwunden ist oder eine Reinigungsschicht an einem
 * Security-Turnus haengt.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');
const SQL = readFileSync(join(WURZEL, 'drizzle/0028_dienstplan.sql'), 'utf8');

/** Der Text ohne Blockkommentare — eine Erwaehnung ist keine Anweisung. */
const ANWEISUNGEN = SQL.replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .split('\n')
  .filter((z) => !/^\s*--/u.test(z))
  .join('\n');

const TABELLEN = ['feiertag', 'planungsserie', 'einsatz', 'einsatz_zuordnung'] as const;
/** Die drei mandantengebundenen; `feiertag` ist Landesreferenz (§5.1). */
const MANDANTENTABELLEN = ['planungsserie', 'einsatz', 'einsatz_zuordnung'] as const;

describe('0028 legt genau die vier Tabellen der Phase-5-Grundlage an', () => {
  it('jede einmal, und keine weitere', () => {
    const angelegt = [...ANWEISUNGEN.matchAll(/^create table (\w+) \(/gmu)].map((m) => m[1]);
    expect(angelegt).toEqual([...TABELLEN]);
  });

  it('und die vier Aufzaehlungstypen, die §5 benutzt', () => {
    const typen = [...ANWEISUNGEN.matchAll(/^create type (\w+) as enum/gmu)].map((m) => m[1]);
    expect(typen).toEqual(['einsatz_status', 'einsatz_quelle', 'zeitanomalie', 'zuordnung_status']);
  });

  it('`einsatz_status` kennt kein `unbesetzt` und kein `veroeffentlicht`', () => {
    /**
     * Beides waere eine zweite Wahrheit: die Besetzung ergibt sich aus
     * `besetzt_anzahl` gegen `soll_besetzung`, und ein Veroeffentlichungsschritt
     * steht in keiner SPEC-Zeile — ihn als Zustand zu modellieren waere eine
     * erfundene Geschaeftsregel (K-17).
     */
    const zeile = /create type einsatz_status as enum \(([^)]*)\)/u.exec(ANWEISUNGEN)?.[1] ?? '';
    expect(zeile).not.toMatch(/unbesetzt/u);
    expect(zeile).not.toMatch(/veroeffentlicht/u);
  });
});

describe('TIM-04 — zehn Schichten zur selben Sekunde an einem Objekt', () => {
  /**
   * Der Fall, den §16 einen blockierenden Defekt nennt. Eine Ausschlusssperre
   * hier machte aus einem SICHTBAREN Konflikt (§10.1 meldet ihn) einen
   * `duplicate key` in dem Moment, in dem jemand die zehnte Wache eintraegt —
   * und die Schicht, die nicht angelegt werden konnte, besetzt niemand.
   */
  it('keine Ausschlussbedingung auf `einsatz`', () => {
    expect(ANWEISUNGEN).not.toMatch(/exclude\s+using/iu);
  });

  it('und kein eindeutiger Index ueber Objekt und Beginn', () => {
    const eindeutige = [...ANWEISUNGEN.matchAll(/create unique index[\s\S]*?;/gu)].map((m) => m[0]);
    const ueberObjektUndBeginn = eindeutige.filter(
      (i) => /\bobjekt_id\b/u.test(i) && /\bbeginn_zeitpunkt\b/u.test(i),
    );
    expect(ueberObjektUndBeginn).toEqual([]);
  });

  it('die Prueferin findet ueberhaupt eindeutige Indizes — sonst prueft sie nichts', () => {
    // Ohne diese Zusage bestuende die vorige Pruefung auf einer leeren Menge.
    expect([...ANWEISUNGEN.matchAll(/create unique index/gu)].length).toBeGreaterThan(2);
  });
});

describe('K-01 — RLS ist an, und der Eigentuemer ist nicht ausgenommen', () => {
  it.each(TABELLEN)('%s traegt enable UND force row level security', (tabelle) => {
    expect(ANWEISUNGEN).toContain(`alter table ${tabelle} enable row level security;`);
    // Ohne `force` sieht jede Verbindung, die als Eigentuemer laeuft, alles —
    // und jeder Test, der als Eigentuemer laeuft, besteht.
    expect(ANWEISUNGEN).toMatch(new RegExp(`alter table ${tabelle} force\\s+row level security;`, 'u'));
  });

  it.each(MANDANTENTABELLEN)('%s traegt t_mandant und t_gruppe mit Rechteschluessel', (tabelle) => {
    /**
     * K-03: eine Policy ohne `hat_recht`-Konjunkt ist ein Defekt. Blosse
     * Mandantenzugehoerigkeit darf ein Modul nicht oeffnen — sonst liest ein
     * Kundenlogin den Dienstplan.
     */
    const mandant = new RegExp(
      `create policy t_mandant on ${tabelle} for all to cse_app[\\s\\S]*?;`, 'u',
    ).exec(ANWEISUNGEN)?.[0];
    expect(mandant, `${tabelle}: keine t_mandant-Policy`).toBeDefined();
    expect(mandant).toContain("app.hat_recht('dienstplan.lesen'");
    expect(mandant).toContain("app.hat_recht('dienstplan.schreiben'");
    expect(mandant).toContain('app.ist_readonly()');

    const gruppe = new RegExp(
      `create policy t_gruppe on ${tabelle} for select to cse_app[\\s\\S]*?;`, 'u',
    ).exec(ANWEISUNGEN)?.[0];
    expect(gruppe, `${tabelle}: keine t_gruppe-Policy`).toBeDefined();
    expect(gruppe).toContain("app.rechte_mandanten('gruppe.dienstplan.lesen')");
  });

  it('keine Gruppen-Policy schreibt (Invariante 10, von Postgres erzwungen)', () => {
    // Jede `t_gruppe` ist `for select`. Waere eine `for all`, koennte in
    // Gruppensicht geschrieben werden — und zwar an jedem Dienstwaechter vorbei.
    for (const m of ANWEISUNGEN.matchAll(/create policy t_gruppe on (\w+) for (\w+)/gu)) {
      expect(m[2], `t_gruppe on ${m[1]}`).toBe('select');
    }
  });

  it('feiertag ist NICHT mandantengebunden und hat keine Schreib-Policy fuer cse_app', () => {
    const block = /create table feiertag \(([\s\S]*?)\n\);/u.exec(ANWEISUNGEN)?.[1] ?? '';
    expect(block).not.toMatch(/\bmandant_id\b/u);
    // K-16: ein Katalog ist gruppenweit ODER je Mandant, nie beides — eine
    // nullbare mandant_id waere der Mittelweg, den kein RLS-Praedikat
    // ausdruecken kann.
    expect(ANWEISUNGEN).toContain('create policy f_lesen on feiertag for select to cse_app');
    expect(ANWEISUNGEN).not.toMatch(/create policy \w+ on feiertag for (all|insert|update) to cse_app/u);
  });
});

describe('Die Nachtlaeufe kommen an ihre Zeilen — sonst schreiben sie lautlos nichts', () => {
  /**
   * `cse_job` haelt kein `BYPASSRLS` (K-01), und unter `force` gilt die RLS
   * auch fuer ihn: ohne eigene Policy liest der Generator null Zeilen und
   * schreibt keine. Das faellt nicht als Fehler auf, sondern als ein
   * Dienstplan, der ueber Nacht leer bleibt.
   */
  it.each(['feiertag', 'planungsserie', 'einsatz'] as const)(
    '%s traegt mindestens eine Policy fuer cse_job',
    (tabelle) => {
      expect(ANWEISUNGEN).toMatch(
        new RegExp(`create policy \\w+ on ${tabelle} for \\w+ to cse_job`, 'u'),
      );
    },
  );

  it('einsatz_zuordnung legt kein Nachtlauf an — wer auf einer Schicht steht, entscheidet ein Mensch', () => {
    const jobPolicies = [
      ...ANWEISUNGEN.matchAll(/create policy \w+ on einsatz_zuordnung for (\w+) to cse_job/gu),
    ].map((m) => m[1]);
    expect(jobPolicies).not.toContain('insert');
    expect(jobPolicies).not.toContain('all');
    expect(jobPolicies).toContain('select');
  });

  it('und schreibt dort nur die Aufbewahrungsfrist — als SPALTEN-Grant, nicht als Zeilenregel', () => {
    /**
     * Eine Policy kann keine Spalte einschraenken; ein Grant kann es. Ohne
     * diesen Grant haette §13 fuer diese Tabelle keinen Schreiber, die Frist
     * bliebe fuer immer NULL — und weil der Raeumungspfad nur Zeilen mit
     * gesetzter Frist ansieht, faellt genau das nie auf.
     */
    expect(ANWEISUNGEN).toContain(
      'grant update (aufbewahrung_bis, loeschsperre) on einsatz_zuordnung to cse_job;',
    );
    expect(ANWEISUNGEN).not.toMatch(/grant [^;]*\binsert\b[^;]*on einsatz_zuordnung to cse_job/u);
  });
});

describe('K-16 — kein einspaltiger Fremdschluessel in eine Mandantentabelle', () => {
  /**
   * Der Fehler, den diese Pruefung fangen soll: `references turnus (id)` statt
   * `(mandant_id, turnus_id) references turnus (mandant_id, id)`. Beides legt
   * an, beides sieht in der Durchsicht gleich aus — nur haengt im ersten Fall
   * eine Reinigungsschicht widerspruchsfrei an einem Security-Turnus.
   *
   * Erlaubt sind genau die Elternteile OHNE `mandant_id`: `mandant` selbst,
   * die globalen `benutzer` und `person`, die Landesreferenz `feiertag` und das
   * Plattformprotokoll `job_lauf` (K-21). §14.4 benennt die letzten beiden
   * ausdruecklich als die gewollten Ausnahmen.
   */
  const OHNE_MANDANT = new Set(['mandant', 'benutzer', 'person', 'feiertag', 'job_lauf']);

  it('jeder einspaltige `references` zeigt auf eine mandantenfreie Tabelle', () => {
    const einspaltig = [...ANWEISUNGEN.matchAll(/references\s+(\w+)\s*\(\s*id\s*\)/gu)].map(
      (m) => m[1]!,
    );
    expect(einspaltig.length).toBeGreaterThan(3);
    expect(einspaltig.filter((t) => !OHNE_MANDANT.has(t))).toEqual([]);
  });

  it('und jeder zusammengesetzte zeigt auf (mandant_id, id) des Elternteils', () => {
    const zusammengesetzt = [
      ...ANWEISUNGEN.matchAll(/foreign key \(([^)]*)\)\s*\n?\s*references (\w+) \(([^)]*)\)/gu),
    ];
    expect(zusammengesetzt.length).toBeGreaterThan(5);
    for (const [, kind, eltern, ziel] of zusammengesetzt) {
      const spalten = (ziel ?? '').split(',').map((s) => s.trim());
      // Die eine Ausnahme mit anderer Form: (anstellung_id, person_id) →
      // anstellung (id, person_id). Sie ist es, die die denormalisierte
      // person_id festnagelt (§2.3 Nr. 8).
      if (spalten[0] === 'id') {
        expect(`${eltern}(${ziel})`).toBe('anstellung(id, person_id)');
        continue;
      }
      expect(spalten[0], `${eltern} (${ziel}) aus (${kind})`).toBe('mandant_id');
    }
  });
});

describe('Invariante 2 — Zeitpunkte sind timestamptz, Kalendertage sind date', () => {
  it('kein `timestamp` ohne Zone in der Migration', () => {
    // Die Merge-Wache prueft dasselbe fuer den ganzen Baum; hier steht es
    // nochmal, weil in DIESER Datei die Nachtschicht und die zwei
    // Umstellungsnaechte haengen.
    expect(ANWEISUNGEN).not.toMatch(/timestamp\s+without\s+time\s+zone/iu);
    expect(ANWEISUNGEN).not.toMatch(/\btimestamp\s*[(,\s]\s*not\s+null/iu);
  });

  it('plan_datum und feiertag.datum sind `date`, nicht `timestamptz`', () => {
    // Ein Kalendertag ist eine Tatsache der Berliner Wanduhr (K-11). Als
    // Zeitpunkt gespeichert begaenne er um Mitternacht UTC — also um 01:00
    // oder 02:00 Berliner Zeit, und die Nachtschicht faellt in den falschen Tag.
    expect(ANWEISUNGEN).toMatch(/^\s*plan_datum\s+date not null,$/mu);
    expect(ANWEISUNGEN).toMatch(/^\s*datum\s+date not null,$/mu);
  });

  it('die Wanduhr-Schnappschuesse sind `time`, und `endet_am_folgetag` steht daneben', () => {
    /**
     * 22:00–06:00 ist keine negative Dauer, sondern eine Nachtschicht. Ohne die
     * Flagge waere `ende_lokal < beginn_lokal` von einem Tippfehler nicht zu
     * unterscheiden — und die Bedingung darauf ist es, die den Tippfehler
     * trotzdem faengt.
     */
    expect(ANWEISUNGEN).toMatch(/beginn_lokal\s+time not null/u);
    expect(ANWEISUNGEN).toMatch(/ende_lokal\s+time not null/u);
    expect(ANWEISUNGEN).toContain(
      'check (endet_am_folgetag or ende_lokal > beginn_lokal)',
    );
  });

  it('keine berechnete Zeit in einer CHECK-Bedingung oder einem Indexpraedikat', () => {
    /**
     * §1.10: `now()` und `current_date` sind `STABLE`. In einer Bedingung
     * aendern sie den Wahrheitswert einer Zeile, die sich nie geaendert hat —
     * spaetere UPDATEs schlagen fehl und `pg_dump`/restore bricht ab. In einem
     * Indexpraedikat weist PostgreSQL sie rundheraus zurueck, und die Migration
     * legt den Index nicht an, auf den der naechtliche Generator zaehlt.
     */
    for (const m of ANWEISUNGEN.matchAll(/(check \([^;]*?\)|where [^;]*?)(?=,\n|\n\s*\)|;)/gu)) {
      expect(m[0], m[0].slice(0, 80)).not.toMatch(/\b(now\(\)|current_date|current_timestamp)\b/u);
    }
  });
});

describe('D-09 — kostenrelevant haengt an der Beschaeftigung', () => {
  it('einsatz_zuordnung traegt anstellung_id, und `einsatz` traegt keines', () => {
    const zuordnung = /create table einsatz_zuordnung \(([\s\S]*?)\n\);/u.exec(ANWEISUNGEN)?.[1] ?? '';
    expect(zuordnung).toMatch(/anstellung_id uuid not null/u);
    // Die denormalisierte person_id ist erlaubt — und der Fremdschluessel
    // darueber macht Drift unmoeglich.
    expect(zuordnung).toMatch(/person_id\s+uuid not null/u);

    const einsatz = /create table einsatz \(([\s\S]*?)\n\);/u.exec(ANWEISUNGEN)?.[1] ?? '';
    /**
     * Kein `anstellung_id` und kein `person_id` auf der Schicht: ein
     * 24/7-Posten mit drei Wachen waere sonst entweder drei Schichten oder eine
     * Schicht mit zwei unsichtbaren Wachen (SEC-01, TIM-04).
     */
    expect(einsatz).not.toMatch(/^\s*anstellung_id\b/mu);
    expect(einsatz).not.toMatch(/^\s*person_id\b/mu);
  });

  it('diese Domaene fuehrt keine einzige Geldspalte (§1.5)', () => {
    // Ein Entgelt hier waere die Zeile, die ein Reinigungsplaner sehen wuerde,
    // sobald er einen Security-Einsatz oeffnet (D-09 §6, K-05).
    expect(ANWEISUNGEN).not.toMatch(/\b\w*(_cent|stundensatz|betrag|entgelt)\w*\s+(bigint|numeric)/iu);
  });
});
