/**
 * Erzeugt das Routen-Manifest aus `04-SEITENKARTE.md`.
 *
 * **Warum ausgelesen und nicht abgetippt.** Die Seitenkarte fuehrt 372 Zeilen
 * mit Pfad, Recht, Scope, SPEC und Phase. Eine zweite, von Hand gepflegte
 * Liste waere beim ersten Widerspruch die falsche — und niemand saehe den
 * Widerspruch, weil beide fuer sich plausibel blieben. Also gilt: das Dokument
 * ist die Quelle, dieses Skript liest sie, und `--check` faellt, sobald die
 * erzeugte Datei veraltet ist.
 *
 * **Und deshalb deckt die Aufzaehlungsprobe neue Routen automatisch ab.** Wer
 * eine Route in die Karte schreibt, hat sie damit in die Rollenprobe
 * geschrieben; wer sie vergisst, hat keine Route. Das ist die eigentliche
 * Zusage von PR 19 — nicht eine Liste von Faellen, die jemand pflegt.
 *
 *   pnpm seitenkarte          schreibt src/server/registry/routen.generiert.ts
 *   pnpm seitenkarte --check  scheitert, wenn die Datei veraltet ist
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WURZEL = resolve(import.meta.dirname, '../..');
export const QUELLE = join(WURZEL, 'docs/architecture/04-SEITENKARTE.md');
export const ZIEL = join(WURZEL, 'src/server/registry/routen.generiert.ts');

/**
 * Die Scope-Token aus §1.3. Jedes benennt einen Sitzungshelfer; ein Token, das
 * hier fehlt, ist eine Route, die die Datenbank ausserhalb der vier Scopes und
 * des K-08-Registers erreicht — und damit ein Fehler, kein neuer Fall.
 */
export const SCOPES = [
  '—', 'M1', 'GRP', 'PER', 'PER→M1', 'KDN', 'KDN→M1', 'USR', 'FEED', 'TOK',
] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Wie eine Route bewacht wird.
 *
 * `recht` traegt ZWEI Listen. `lesen` ist die Bedingung, die erfuellt sein
 * muss, um die Seite ueberhaupt zu sehen — mehrere Schluessel bedeuten UND
 * (`a + b` in der Karte). `schreiben` sind die Schluessel, die ein zusaetzlicher
 * Vorgang auf derselben Seite braucht (`a / b`, `a (+ b)`); ohne sie ist die
 * Seite lesbar, nicht bedienbar. Die beiden zu vermischen hiesse, eine Liste
 * zu verstecken, weil jemand darin nicht schreiben darf.
 */
export type Bewachung =
  | { readonly art: 'recht'; readonly lesen: readonly string[];
      readonly schreiben: readonly string[]; readonly aal2: boolean }
  /** `S` — Selbstzugriff ueber `app.person_id`, kein Recht, auch nicht fuer super_admin. */
  | { readonly art: 'selbst'; readonly schreiben: readonly string[] }
  /** Angemeldet, mehr nicht — die Route liest die eigenen Kontozeilen (`USR`). */
  | { readonly art: 'sitzung' }
  /** Oeffentlich (`—`). */
  | { readonly art: 'offen' }
  /** Der Check-in-Pfad: ein Token, keine Sitzung. */
  | { readonly art: 'token' }
  /** §2.6 — Datei statt Route (robots.ts, sitemap.ts, opengraph-image). */
  | { readonly art: 'infrastruktur'; readonly datei: string };

export interface RoutenEintrag {
  readonly pfad: string;
  /** Der Teil hinter dem Gedankenstrich in der Pfadzelle. Oft leer. */
  readonly beschreibung: string;
  readonly bewachung: Bewachung;
  readonly scope: Scope;
  readonly spec: readonly string[];
  /** Die ROADMAP-Phase, in der die Route zuerst ausgeliefert wird. */
  readonly phase: number;
  /** Der Abschnitt der Karte, aus dem die Zeile stammt. */
  readonly abschnitt: string;
  /** Die Zeilennummer in der Karte — damit ein Fehlschlag hinzeigen kann. */
  readonly zeile: number;
}

const KOPF =
  /^\|\s*Path\s*\|\s*(?:Right|Implementation)\s*\|\s*Scope\s*\|\s*SPEC\s*\|\s*Phase\s*\|\s*$/u;
const SCHLUESSEL = /^[a-z_]+(?:\.[a-z_]+){1,2}$/u;

/** `**x**` und `*x*` weg — Auszeichnung ist keine Bedeutung. */
function nackt(text: string): string {
  return text.replace(/\*\*/gu, '').replace(/(^|[^*])\*([^*]+)\*/gu, '$1$2').trim();
}

/** Jeder in Backticks stehende Text, in Reihenfolge. */
function eingefasst(text: string): readonly string[] {
  return [...text.matchAll(/`([^`]+)`/gu)].map((m) => m[1] ?? '');
}

/**
 * Ergaenzt einen abgekuerzten Schluessel.
 *
 * Die Karte schreibt `` `dienstanweisung.lesen` / `.schreiben` `` — der zweite
 * Schluessel beginnt mit einem Punkt und meint dasselbe Modul. Ihn wortwoertlich
 * zu uebernehmen ergaebe `.schreiben`, was `hat_recht` nie beantwortet: die
 * Seite waere fuer jeden gesperrt, und zwar still.
 */
function ergaenze(schluessel: string, vorher: readonly string[]): string {
  if (!schluessel.startsWith('.')) return schluessel;
  const letzte = vorher[vorher.length - 1];
  const modul = letzte?.split('.')[0];
  return modul === undefined ? schluessel : `${modul}${schluessel}`;
}

/**
 * Die Pfade EINER Zeile — es sind oft mehrere.
 *
 * 53 Zeilen der Karte fuehren Geschwister zusammen, weil sie dieselbe
 * Bedingung teilen: `` `…/serien` , `/neu` , `/[id]` ``. Nur den ersten zu
 * nehmen hiesse, 60 Routen aus dem Manifest zu lassen — und die
 * Aufzaehlungsprobe prueft, was im Manifest steht. Genau die Detailseiten,
 * auf denen die fremde Zeile stuende, waeren dann ungeprueft.
 *
 * Der erste Pfad ist die Basis; jeder weitere beginnt mit `/` und haengt an.
 */
export function pfadeAus(zelle: string): readonly string[] {
  const marken = eingefasst(zelle).filter((m) => m.startsWith('/'));
  const basis = marken[0];
  if (basis === undefined) return [];
  return [basis, ...marken.slice(1).map((s) => `${basis}${s}`)];
}

export class SeitenkarteFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'SeitenkarteFehler'; }
}

/**
 * Zerlegt die Rechte-Zelle.
 *
 * Vier Notationen aus §1.4 und drei Schreibweisen, die die Karte daneben
 * benutzt. Was in Klammern steht, ist NIE die Sehbedingung — es ist der
 * Zusatz, den ein Vorgang auf derselben Seite braucht.
 */
export function zerlegeBewachung(roh: string): Bewachung {
  const text = nackt(roh);
  if (text === '—' || text === '') return { art: 'offen' };

  const marken = eingefasst(text);
  // §2.6: die Zelle nennt eine Datei, keine Bedingung.
  const datei = marken.find((m) => m.includes('/') || m.endsWith('.tsx') || m.endsWith('.ts')
    || m === 'opengraph-image');
  if (datei !== undefined && !marken.some((m) => SCHLUESSEL.test(m))) {
    return { art: 'infrastruktur', datei };
  }

  /**
   * **„route handler" ist eine IMPLEMENTIERUNG, keine Bedingung.**
   *
   * Der Befund: `/.well-known/security.txt` trug in der Karte als
   * Implementierung „route handler" — und landete unten im
   * `sitzung`-Zweig, weil dieselbe Regex auf das Wort passt. Eine
   * `.well-known`-Datei hinter einer Anmeldung erfuellt ihren Zweck nicht;
   * ein Pruefwerkzeug, das sie abholt, hat keine Sitzung. `/llms.txt` kam nur
   * deshalb richtig heraus, weil daneben `text/plain` stand und der
   * Schraegstrich darin wie ein Dateiname aussah — also aus dem falschen
   * Grund.
   *
   * Die Pruefung steht VOR der Rechtezerlegung, aber NACH der Dateipruefung
   * oben: eine Zelle, die beides nennt („route handler, `text/plain`"), soll
   * weiter den Dateinamen tragen.
   */
  if (/route handler/iu.test(text) && !marken.some((m) => SCHLUESSEL.test(m))) {
    return { art: 'infrastruktur', datei: datei ?? 'route handler' };
  }

  const rechte = marken.filter((m) => SCHLUESSEL.test(m) || m.startsWith('.'));
  // `S` steht fuer sich — die Zelle traegt dann oft gar keinen Schluessel.
  // Diese Pruefung muss VOR der naechsten stehen: sonst faellt das haeufigste
  // Selbstzugriffs-Muster in den Zweig "nicht deutbar".
  if (marken.includes('S')) {
    return { art: 'selbst', schreiben: rechte.map((m, i) => ergaenze(m, rechte.slice(0, i))) };
  }
  if (rechte.length === 0) {
    // `token only, no login`, `token`
    if (/token/iu.test(text)) return { art: 'token' };
    // `Sitzung`, `authenticated`, `authenticated, 2FA pending`, `pending OTP
    // challenge`, `route handler`
    if (/sitzung|authenticated|otp|route handler/iu.test(text)) return { art: 'sitzung' };
    throw new SeitenkarteFehler(`Rechte-Zelle nicht deutbar: ${roh}`);
  }

  const aal2 = /aal2/u.test(text);

  // Alles in runden Klammern ist Zusatz, nie Sehbedingung.
  const inKlammern = new Set(
    [...text.matchAll(/\(([^()]*)\)/gu)].flatMap((m) => eingefasst(m[1] ?? '')),
  );
  // Ebenso alles hinter einem Semikolon ("… ; die ArbZG-Tafel zusaetzlich …").
  const nachSemikolon = new Set(eingefasst(text.split(';').slice(1).join(';')));

  const draussen: string[] = [];
  const zusatz: string[] = [];
  for (const m of rechte) {
    const voll = ergaenze(m, [...draussen, ...zusatz]);
    if (inKlammern.has(m) || nachSemikolon.has(m)) zusatz.push(voll);
    else draussen.push(voll);
  }

  /**
   * `a / b` trennt Sehen von Tun, `a + b` fordert beides zum Sehen. Steht
   * beides in einer Zelle, gewinnt der Schraegstrich: er teilt die Zelle, und
   * das `+` bindet innerhalb der Haelften.
   */
  const vorSchraeg = text.split('/')[0] ?? text;
  const lesend = new Set(eingefasst(vorSchraeg).filter((m) => SCHLUESSEL.test(m)));
  const lesen = draussen.filter((s) => lesend.has(s));
  const schreiben = [...draussen.filter((s) => !lesend.has(s)), ...zusatz];

  if (lesen.length === 0) {
    // Eine Zelle wie `social.schreiben` (read via `referenz.lesen`): das Recht
    // draussen ist die Bedingung, auch wenn es ein Schreibrecht benennt.
    return { art: 'recht', lesen: draussen, schreiben: zusatz, aal2 };
  }
  return { art: 'recht', lesen, schreiben, aal2 };
}

function zerlegeScope(roh: string): Scope {
  const erste = eingefasst(nackt(roh))[0] ?? nackt(roh);
  const treffer = SCOPES.find((s) => s === erste);
  if (treffer === undefined) {
    throw new SeitenkarteFehler(`Unbekanntes Scope-Token: ${roh} (§1.3 kennt es nicht)`);
  }
  return treffer;
}

export function lies(quelle: string = QUELLE): readonly RoutenEintrag[] {
  const zeilen = readFileSync(quelle, 'utf8').split('\n');
  const eintraege: RoutenEintrag[] = [];
  let abschnitt = '';

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i] ?? '';
    if (zeile.startsWith('#')) { abschnitt = zeile.replace(/^#+\s*/u, '').trim(); continue; }
    if (!KOPF.test(zeile)) continue;

    // Kopf, Trennzeile, dann Daten bis zur ersten Zeile ohne Pipe.
    for (let j = i + 2; j < zeilen.length && (zeilen[j] ?? '').startsWith('|'); j += 1) {
      const zellen = (zeilen[j] ?? '').trim().replace(/^\||\|$/gu, '').split('|')
        .map((c) => c.trim());
      if (zellen.length !== 5) continue;

      const pfadZelle = zellen[0] ?? '';
      const pfade = pfadeAus(pfadZelle);
      // §2.6 fuehrt eine Zeile ohne Pfad (`opengraph-image` je Route). Sie ist
      // keine Route, und sie wegzulassen ist ehrlicher als sie zu erfinden.
      if (pfade.length === 0) continue;

      const gemeinsam = {
        beschreibung: nackt(pfadZelle.replace(/`[^`]*`/gu, '')).replace(/^[—–,\s-]+/u, '').trim(),
        bewachung: zerlegeBewachung(zellen[1] ?? ''),
        scope: zerlegeScope(zellen[2] ?? ''),
        spec: nackt(zellen[3] ?? '').split(',').map((s) => s.trim())
          .filter((s) => s !== '' && s !== '—'),
        phase: Number.parseInt(nackt(zellen[4] ?? '0'), 10),
        abschnitt,
        zeile: j + 1,
      };
      for (const pfad of pfade) eintraege.push({ pfad, ...gemeinsam });
    }
  }

  if (eintraege.length === 0) {
    throw new SeitenkarteFehler(
      'Keine einzige Route gelesen. Das ist nie richtig: entweder hat sich die '
      + 'Kopfzeile der Tabellen geändert, oder die Quelle ist die falsche Datei.',
    );
  }
  return eintraege;
}

export function erzeugeDatei(): string {
  const eintraege = lies();
  const zeilen = eintraege.map((e) => `  { pfad: ${JSON.stringify(e.pfad)},`
    + ` beschreibung: ${JSON.stringify(e.beschreibung)},`
    + ` bewachung: ${JSON.stringify(e.bewachung)},`
    + ` scope: ${JSON.stringify(e.scope)}, spec: ${JSON.stringify(e.spec)},`
    + ` phase: ${String(e.phase)}, abschnitt: ${JSON.stringify(e.abschnitt)},`
    + ` zeile: ${String(e.zeile)} },`);

  const jePhase = new Map<number, number>();
  for (const e of eintraege) jePhase.set(e.phase, (jePhase.get(e.phase) ?? 0) + 1);
  const verteilung = [...jePhase.entries()].sort((a, b) => a[0] - b[0])
    .map(([p, n]) => `Phase ${String(p)}: ${String(n)}`).join(' · ');

  return `/**
 * ERZEUGT — nicht von Hand ändern. \`pnpm seitenkarte\` schreibt neu.
 *
 * Quelle: docs/architecture/04-SEITENKARTE.md, die Routentabellen selbst.
 *
 * ${String(eintraege.length)} Routen. ${verteilung}.
 *
 * Die Rollenprobe (tests/isolation/rollen.test.ts) läuft über DIESE Liste.
 * Eine neue Zeile in der Karte ist damit automatisch geprüft; eine Route ohne
 * Zeile in der Karte gibt es nicht.
 */
import type { RoutenEintrag } from '../../../scripts/seitenkarte/extrahiere.js';

export const ROUTEN: readonly RoutenEintrag[] = [
${zeilen.join('\n')}
];
`;
}

const direkt = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (direkt) {
  const erwartet = erzeugeDatei();
  if (process.argv.includes('--check')) {
    if (readFileSync(ZIEL, 'utf8') !== erwartet) {
      process.stderr.write('Routen-Manifest ist veraltet. `pnpm seitenkarte` ausführen.\n');
      process.exit(1);
    }
    process.stdout.write('Routen-Manifest ist aktuell.\n');
  } else {
    writeFileSync(ZIEL, erwartet);
    process.stdout.write(`geschrieben: ${ZIEL} (${String(lies().length)} Routen)\n`);
  }
}
