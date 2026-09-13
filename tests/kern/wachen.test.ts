/**
 * PR 0 acceptance (3)–(6) — each merge guard must fail a fixture written to
 * break it.
 *
 * The guards are the mechanism that keeps the invariants true after everyone
 * has forgotten why they exist. A guard that has never been seen to fire is
 * indistinguishable from one that does not work.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const WURZEL = resolve(import.meta.dirname, '../..');
const aufraeumen: string[] = [];
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Runs the guards in a throwaway copy of the tree with one file added. */
function guardsMit(dateien: Record<string, string>): { code: number; ausgabe: string } {
  const arbeit = mkdtempSync(join(tmpdir(), 'cse-wachen-'));
  aufraeumen.push(arbeit);
  mkdirSync(join(arbeit, 'docs'), { recursive: true });
  mkdirSync(join(arbeit, 'supabase'), { recursive: true });
  cpSync(join(WURZEL, 'scripts'), join(arbeit, 'scripts'), { recursive: true });
  cpSync(join(WURZEL, 'docs/DECISIONS.md'), join(arbeit, 'docs/DECISIONS.md'));
  cpSync(join(WURZEL, 'supabase/config.toml'), join(arbeit, 'supabase/config.toml'));
  // Die Tailwind-Wache prüft gegen das ECHTE Thema. Ohne Konfiguration
  // überspringt sie sich selbst — mit ihr braucht sie auch `src/lib/design`.
  cpSync(join(WURZEL, 'tailwind.config.ts'), join(arbeit, 'tailwind.config.ts'));
  cpSync(join(WURZEL, 'src/lib/design'), join(arbeit, 'src/lib/design'), { recursive: true });
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    const ziel = join(arbeit, pfad);
    mkdirSync(join(ziel, '..'), { recursive: true });
    writeFileSync(ziel, inhalt, 'utf8');
  }
  // The tsx binary is resolved from the real repository; only the working
  // directory is the throwaway copy, because that is what the guards read.
  const tsx = join(WURZEL, 'node_modules/.bin/tsx');
  try {
    const out = execFileSync(tsx, ['scripts/guards/run-all.ts'], {
      cwd: arbeit,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, ausgabe: out };
  } catch (fehler) {
    const f = fehler as { status?: number; stdout?: string; stderr?: string };
    return { code: f.status ?? 1, ausgabe: `${f.stdout ?? ''}${f.stderr ?? ''}` };
  }
}

const lies = (p: string): string => readFileSync(join(WURZEL, p), 'utf8');

describe('the merge guards fail the branch that breaks an invariant', () => {
  it('(3a) a numeric money column fails CI (invariant 1)', () => {
    const { code, ausgabe } = guardsMit({
      'drizzle/9999_fixture.sql': lies('tests/fixtures/wachen/geld-numeric.sql'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('geld-nie-numeric');
  });

  it('(3a-i) a money-named column stays caught even WITH an exemption comment', () => {
    const { code, ausgabe } = guardsMit({
      'drizzle/9999_fixture.sql': lies('tests/fixtures/wachen/geld-numeric-mit-ausnahme.sql'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('geld-nie-numeric');
  });

  it('(3a-ii) an ambiguous `…wert` column that NAMES its unit passes', () => {
    const { code } = guardsMit({
      'drizzle/9999_fixture.sql': lies('tests/fixtures/wachen/nicht-geld-mit-einheit.sql'),
    });
    expect(code).toBe(0);
  });

  it('(3a-iii) the same column without a named unit still fails', () => {
    const { code, ausgabe } = guardsMit({
      'drizzle/9999_fixture.sql': lies('tests/fixtures/wachen/nicht-geld-ohne-einheit.sql'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('geld-nie-numeric');
  });

  it('(3b) a `timestamp without time zone` column fails CI (invariant 2)', () => {
    const { code, ausgabe } = guardsMit({
      'drizzle/9999_fixture.sql': lies('tests/fixtures/wachen/zeit-ohne-tz.sql'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('zeit-immer-tz');
  });

  it('(4) a route handler containing `db.` fails CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/app/api/fixture/route.ts': lies('tests/fixtures/wachen/route-mit-db.ts'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('route-ohne-db');
  });

  it('(5) a TODO(client) whose number the register does not hold fails CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/lib/fixture.ts': lies('tests/fixtures/wachen/todo-unbekannt.ts'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('todo-client-nicht-im-register');
  });

  /**
   * Die Schreibweise, die dieses Projekt TATSÄCHLICH benutzt.
   *
   * Der Ausdruck der Wache verlangte die schließende Klammer direkt nach
   * `client` und traf damit KEINE einzige Zeile im Baum — jahrelang grün,
   * ohne je etwas zu prüfen. Dieser Fall ist der Beleg, dass die Form mit
   * O-Nummer in der Klammer gesehen wird.
   */
  it('(5b) dieselbe Prüfung für `TODO(client, O-nnn)` — die Form des Projekts', () => {
    const { code, ausgabe } = guardsMit({
      'src/lib/fixture.ts':
        '// TODO(client, O-999): eine Nummer, die das Register nicht kennt\n'
        + 'export const x = 1;\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('todo-client-nicht-im-register');
  });

  /**
   * Die Ueberladung, die vier Stunden verschluckt.
   *
   * `($1::date) at time zone 'Europe/Berlin'` liest das Datum als
   * UTC-Mitternacht und rechnet es NACH Berlin — ein Tagesfenster beginnt
   * damit im Sommer vier Stunden zu spaet. Der Fehler stand an sieben Stellen
   * im Security-Modul; gemeldet hat ihn nie jemand, weil nichts bricht.
   */
  it('(5c) `($n::date) at time zone` fällt durch — `::timestamp` dazwischen nicht', () => {
    const kaputt = guardsMit({
      'src/server/services/fixture.ts':
        'export const q = `select 1 from t where a >= ($1::date) '
        + "at time zone 'Europe/Berlin'`;\n",
    });
    expect(kaputt.code).toBe(1);
    expect(kaputt.ausgabe).toContain('datum-zone-ueberladung');

    const richtig = guardsMit({
      'src/server/services/fixture.ts':
        'export const q = `select 1 from t where a >= ($1::date)::timestamp '
        + "at time zone 'Europe/Berlin'`;\n",
    });
    expect(richtig.code).toBe(0);
  });

  it('a TODO(client) with no number at all fails CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/lib/fixture.ts': '// TODO(client): eine Frage ohne Nummer\nexport const x = 1;\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('todo-client-ohne-nummer');
  });

  it('a TODO(client) carrying a registered number passes', () => {
    const { code } = guardsMit({
      'src/lib/fixture.ts': '// TODO(client): O-06 — Betriebsrat?\nexport const x = 1;\n',
    });
    expect(code).toBe(0);
  });

  it('the tree as it stands passes every guard', () => {
    const { code, ausgabe } = guardsMit({});
    expect(ausgabe).toContain('alle sauber');
    expect(code).toBe(0);
  });
});

  it('(7c) `border-t-0` ist eine Breite, keine Farbe — `border-blau` daneben schon', () => {
    /**
     * Eine Falschmeldung ist die teuerste Sorte Wache: wer sie ein paar Mal
     * sieht, faengt an, die Wache zu umgehen, und dann faellt die echte
     * Meldung mit durch. Die Fixtur beweist beides in einer Datei — sonst
     * zeigte sie nur, dass die Wache schweigt.
     */
    const { code, ausgabe } = guardsMit({
      'src/components/Fixtur.tsx': lies('tests/fixtures/wachen/rahmenbreite.tsx'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('border-blau');
    expect(ausgabe).not.toContain('border-t-0');
    expect(ausgabe).not.toContain('border-b-2');
    expect(ausgabe).not.toContain('border-x-4');
  });

  it('(7b) eine CSS-Deklaration ist keine Klasse — die Klasse daneben aber schon', () => {
    const { code, ausgabe } = guardsMit({
      'src/components/Fixtur.tsx': lies('tests/fixtures/wachen/farbe-neben-css.tsx'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('tailwind-farbe');
    // Gemeldet wird die KLASSE, nicht die Deklaration darueber.
    expect(ausgabe).toContain('text-gibtesnicht');
    expect(ausgabe).not.toContain('border-bottom');
  });

describe('(6) the database region is pinned to the EU (D-04)', () => {
  it('supabase/config.toml names eu-central-1', () => {
    expect(lies('supabase/config.toml')).toMatch(/region\s*=\s*"eu-central-1"/u);
  });

  it('a config without an EU region fails CI', () => {
    const { code, ausgabe } = guardsMit({
      'supabase/config.toml': '[deployment]\nregion = "us-east-1"\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('eu-region');
  });

  /**
   * (7) Eine Tailwind-Klasse, die es im Thema nicht gibt, bricht CI.
   *
   * Der Fall, der diese Wache erzwungen hat: `border-border` und `text-red`
   * standen in acht Dateien, das Thema kennt aber `line` und `brand`. Tailwind
   * erzeugt für eine unbekannte Farbe keine Regel und meldet nichts — jede
   * Rahmenlinie der Anwendung war unsichtbar, und im Markup sah alles richtig
   * aus.
   */
  it('(7) a colour class outside the Tailwind theme fails CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/components/Kaputt.tsx':
        'export const K = () => <div className="border-border text-red" />;\n',
    });
    expect(code).not.toBe(0);
    expect(ausgabe).toContain('tailwind-farbe');
    expect(ausgabe).toContain('border-border');
    expect(ausgabe).toContain('text-red');
  });

  it('(7) and the real tree passes it', () => {
    // Ohne diese Zusage könnte die Wache kaputt sein und niemand wüsste es.
    const { code } = guardsMit({});
    expect(code).toBe(0);
  });
});

/**
 * (11) Die §14-UStG-Vorabpruefung hat genau EINE Fassung, und `finalisiere()`
 * ruft sie (PR 47, FIN-04, Abnahme 4).
 *
 * Die Wache liest zwei Dateien, die es im Wegwerf-Baum nicht gibt — also legt
 * jeder Fall sie selbst an. Das ist der Punkt: die Wache soll den Baum
 * beurteilen, den sie vorfindet, und nicht schweigen, weil eine Datei fehlt,
 * die sie fuer entscheidend haelt.
 */
describe('(11) die §14-UStG-Vorabpruefung laesst sich nicht ueberspringen', () => {
  const PRUEFER =
    'export function pruefePflichtfelder(): void {}\n'
    + 'export async function pruefeRechnung(): Promise<void> {}\n';

  it('finalisiere() ohne Aufruf des Validators bricht CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/server/services/finanz/ustg14.ts': PRUEFER,
      'src/server/services/finanz/rechnung.ts':
        'export async function finalisiere(): Promise<void> {\n'
        + '  // kein Aufruf der Vorabpruefung\n}\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('validator-nicht-uebersprungen');
    expect(ausgabe).toContain('pruefeRechnung');
  });

  it('ein Aufruf OHNE Auswertung des Befundes bricht CI ebenfalls', () => {
    const { code, ausgabe } = guardsMit({
      'src/server/services/finanz/ustg14.ts': PRUEFER,
      'src/server/services/finanz/rechnung.ts':
        'export async function finalisiere(): Promise<void> {\n'
        + '  await pruefeRechnung();\n}\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('validator-nicht-uebersprungen');
  });

  it('eine ZWEITE Regelliste bricht CI', () => {
    const { code, ausgabe } = guardsMit({
      'src/server/services/finanz/ustg14.ts': PRUEFER,
      'src/server/services/finanz/rechnung.ts':
        'export async function finalisiere(): Promise<void> {\n'
        + '  const b = await pruefeRechnung();\n'
        + '  if (b.fehler.length > 0) throw new Error("");\n}\n',
      'src/app/api/fixtur/route.ts':
        'export function pruefePflichtfelder(): void {}\n',
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('validator-nicht-uebersprungen');
    expect(ausgabe).toContain('pruefePflichtfelder');
  });

  it('und die richtige Fassung geht durch', () => {
    const { code } = guardsMit({
      'src/server/services/finanz/ustg14.ts': PRUEFER,
      'src/server/services/finanz/rechnung.ts':
        'export async function finalisiere(): Promise<void> {\n'
        + '  const b = await pruefeRechnung();\n'
        + '  if (b.fehler.length > 0) throw new Error("");\n}\n',
    });
    expect(code).toBe(0);
  });
});

describe('(8) eine nicht wohlgeformte SVG faellt durch (D-376)', () => {
  /**
   * **Der Ausfall dahinter.** Acht Motivtafeln lagen im Baum, sahen im Editor
   * richtig aus und waren nie wohlgeformtes XML: ein Kommentar enthielt einen
   * doppelten Bindestrich. Der Server lieferte sie mit 200 aus, der Browser
   * verwarf sie beim Parsen, die Startseite blieb leer.
   *
   * **Warum kein Browsertest das gefunden hat.** Es gab einen, und er war
   * gruen. Er prueft die sichtbare Kennzeichnung NEBEN dem Bild — und die
   * stand da. Das `<img>` war im DOM, der `src` stimmte, die Antwort war 200,
   * die Datei existierte. Alles eine Ebene unter dem Fehler war in Ordnung.
   * Deshalb liegt die Pruefung jetzt dort, wo die Datei selbst gelesen wird.
   */
  const GUT =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n'
    + '  <!-- ein sauberer Kommentar -->\n'
    + '  <rect width="10" height="10" fill="#000"/>\n'
    + '</svg>\n';

  it('der doppelte Bindestrich im Kommentar — genau der echte Fehler', () => {
    const { code, ausgabe } = guardsMit({
      'public/platzhalter/fixtur.svg': GUT.replace(
        'ein sauberer Kommentar', 'der Token --cse-bild-overlay',
      ),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('svg-wohlgeformt');
    expect(ausgabe).toContain('public/platzhalter/fixtur.svg');
    expect(ausgabe).toContain('Doppelter Bindestrich');
  });

  it('ein nacktes `&` — der zweite Weg, eine SVG still unsichtbar zu machen', () => {
    const { code, ausgabe } = guardsMit({
      'public/fixtur.svg': GUT.replace('<rect', '<text>Reinigung & Service</text><rect'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('svg-wohlgeformt');
  });

  it('ein nicht geschlossenes Element', () => {
    const { code, ausgabe } = guardsMit({ 'public/fixtur.svg': GUT.replace('</svg>', '') });
    expect(code).toBe(1);
    expect(ausgabe).toContain('svg-wohlgeformt');
  });

  it('die Wache findet SVG auch tief im Unterverzeichnis', () => {
    const { code, ausgabe } = guardsMit({
      'public/a/b/c/fixtur.svg': GUT.replace('sauberer', 'kaputter --'),
    });
    expect(code).toBe(1);
    expect(ausgabe).toContain('public/a/b/c/fixtur.svg');
  });

  it('und die saubere Fassung geht durch — sonst waere die Wache ein Fehlalarm', () => {
    const { code, ausgabe } = guardsMit({ 'public/platzhalter/fixtur.svg': GUT });
    expect(code).toBe(0);
    expect(ausgabe).toContain('alle sauber');
  });

  it('die acht echten Tafeln gehen durch', () => {
    const { code } = guardsMit({
      'public/platzhalter/hero.svg': lies('public/platzhalter/hero.svg'),
      'public/platzhalter/reinigung.svg': lies('public/platzhalter/reinigung.svg'),
      'public/platzhalter/security.svg': lies('public/platzhalter/security.svg'),
      'public/platzhalter/bau.svg': lies('public/platzhalter/bau.svg'),
      'public/platzhalter/operations.svg': lies('public/platzhalter/operations.svg'),
      'public/platzhalter/objekt.svg': lies('public/platzhalter/objekt.svg'),
      'public/platzhalter/projekt.svg': lies('public/platzhalter/projekt.svg'),
      'public/platzhalter/team.svg': lies('public/platzhalter/team.svg'),
    });
    expect(code).toBe(0);
  });
});

/**
 * Die Wache `konformitaetsauftrag` — jeder Konformitaetsbereich hat seinen
 * eigenen CI-Auftrag, und kein Auftrag faehrt die anderen mit.
 *
 * **Der echte Ausfall, gegen den sie geschrieben ist.** `compliance.yml` hat
 * zwei Auftraege, jeder installiert sein eigenes Java-Werkzeug — KoSIT fuer
 * die XRechnung, veraPDF fuer das ZUGFeRD-Archiv. Beide riefen aber
 * `pnpm test:compliance` auf, und das faehrt die GANZE Konfiguration. Der
 * KoSIT-Auftrag fuhr damit auch den veraPDF-Test, ohne `VERAPDF_CLI` — und
 * die Konformitaetstests fallen in CI mit Absicht durch, statt sich zu
 * ueberspringen. Rot war also der Auftrag, dessen eigene Pruefung gruen war.
 *
 * Jeder Fall hier setzt genau EINE Schraube falsch; ginge einer davon durch,
 * kaeme derselbe Montag wieder.
 */
describe('(3h) ein Konformitaetsbereich ohne eigenen CI-Auftrag faellt', () => {
  const TEST_DATEI = 'export {};\n';

  /** Ein Baum mit `tests/compliance/zugferd`, dessen Verdrahtung stimmt. */
  function baum(
    aenderungen: { skripte?: Record<string, string>; ablauf?: string } = {},
  ): Record<string, string> {
    const skripte = aenderungen.skripte ?? {
      'test:compliance:zugferd':
        'vitest run --config vitest.compliance.config.ts tests/compliance/zugferd',
    };
    const ablauf = aenderungen.ablauf ?? 'jobs:\n  zugferd:\n'
      + '    steps:\n      - run: pnpm test:compliance:zugferd\n';
    return {
      'tests/compliance/zugferd/verapdf.test.ts': TEST_DATEI,
      'package.json': `${JSON.stringify({ name: 'pruefstueck', scripts: skripte }, null, 2)}\n`,
      '.github/workflows/compliance.yml': ablauf,
    };
  }

  it('die richtige Verdrahtung geht durch — sonst waere die Wache ein Fehlalarm', () => {
    const { code, ausgabe } = guardsMit(baum());
    expect(code).toBe(0);
    expect(ausgabe).toContain('alle sauber');
  });

  it('DER echte Fehler: ein Auftrag ruft `pnpm test:compliance` unbesehen', () => {
    const { code, ausgabe } = guardsMit(baum({
      ablauf: 'jobs:\n  xrechnung:\n    steps:\n      - run: pnpm test:compliance\n'
        + '  zugferd:\n    steps:\n      - run: pnpm test:compliance:zugferd\n',
    }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('konformitaetsauftrag');
    expect(ausgabe).toContain('Dieser Auftrag faehrt ALLE Konformitaetspruefungen');
  });

  it('… auch als `pnpm run test:compliance`', () => {
    const { code, ausgabe } = guardsMit(baum({
      ablauf: 'jobs:\n  alles:\n    steps:\n      - run: pnpm run test:compliance\n',
    }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('Dieser Auftrag faehrt ALLE Konformitaetspruefungen');
  });

  it('ein neuer Bereich ohne eigenes Skript', () => {
    const { code, ausgabe } = guardsMit(baum({ skripte: { test: 'vitest run' } }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('hat kein Skript `test:compliance:zugferd`');
  });

  it('ein Skript, das nicht auf seinen Bereich einschraenkt', () => {
    const { code, ausgabe } = guardsMit(baum({
      skripte: { 'test:compliance:zugferd': 'vitest run --config vitest.compliance.config.ts' },
    }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('schraenkt nicht auf `tests/compliance/zugferd` ein');
  });

  it('ein Skript, das kein Auftrag aufruft — geprueft wird dann nichts', () => {
    const { code, ausgabe } = guardsMit(baum({
      ablauf: 'jobs:\n  zugferd:\n    steps:\n      - run: pnpm lint\n',
    }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('Kein Auftrag ruft `pnpm test:compliance:zugferd` auf');
  });

  it('ein Skript fuer einen Bereich, den es nicht mehr gibt', () => {
    const { code, ausgabe } = guardsMit(baum({
      skripte: {
        'test:compliance:zugferd':
          'vitest run --config vitest.compliance.config.ts tests/compliance/zugferd',
        'test:compliance:gobd':
          'vitest run --config vitest.compliance.config.ts tests/compliance/gobd',
      },
      ablauf: 'jobs:\n  zugferd:\n    steps:\n      - run: pnpm test:compliance:zugferd\n'
        + '  gobd:\n    steps:\n      - run: pnpm test:compliance:gobd\n',
    }));
    expect(code).toBe(1);
    expect(ausgabe).toContain('zeigt auf `tests/compliance/gobd`');
  });

  it('ein Bereich ohne CI-Ablauf ueberhaupt', () => {
    const dateien = baum();
    const ohne: Record<string, string> = {
      'tests/compliance/zugferd/verapdf.test.ts': TEST_DATEI,
      'package.json': dateien['package.json'] ?? '',
    };
    const { code, ausgabe } = guardsMit(ohne);
    expect(code).toBe(1);
    expect(ausgabe).toContain('keinen CI-Ablauf');
  });

  it('und die ECHTE Verdrahtung des Baums geht durch', () => {
    const { code, ausgabe } = guardsMit({
      'tests/compliance/xrechnung/kosit.test.ts': TEST_DATEI,
      'tests/compliance/zugferd/verapdf.test.ts': TEST_DATEI,
      'package.json': lies('package.json'),
      '.github/workflows/compliance.yml': lies('.github/workflows/compliance.yml'),
    });
    expect(code).toBe(0);
    expect(ausgabe).toContain('alle sauber');
  });
});
