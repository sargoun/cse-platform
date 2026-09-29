/**
 * **Ein Recht steht als SATZ auf dem Schirm, nicht als Schlüssel.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *     „ان كان ب اي صفحة الكود ظاهر صلحلي ياهن خليه اطار وجملة بدال كود"
 *     — wo auf einer Seite Quelltext steht, mach einen Rahmen und einen
 *     Satz daraus.
 *
 * Über hundert Stellen im Portal zeigten einem Menschen den rohen Schlüssel:
 *
 *     Ihnen fehlt `kalkulation.lesen`; die Spalte bleibt leer.
 *     Bestätigen darf, wer `bau.schreiben` hält.
 *
 * Für die Objektleitung, die das liest, ist `kalkulation.lesen` Quelltext.
 * Sie erfährt, dass ihr etwas fehlt, aber nicht WAS — und kann deshalb auch
 * nicht danach fragen. Ein Hinweis, den der Adressat nicht in eine Bitte
 * übersetzen kann, ist kein Hinweis.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Sperrklinke hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `<Recht schluessel="kalkulation.lesen" />` schreibt „Kalkulationen lesen"
 * und behält den Schlüssel in `title` und `data-recht` — für die
 * Administration, die ihn wortwörtlich braucht, und für die Browserläufe,
 * die nicht am übersetzten Wort hängen dürfen.
 *
 * Geprüft wird die Rückrichtung: **kein Katalogschlüssel darf wieder roh in
 * einem `<code>` landen.** Die nächste Seite, die aus einer bestehenden
 * kopiert wird, bringt den alten Zustand sonst unbemerkt zurück.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';
import { alleRechteschluessel, rechtName } from '../../src/lib/i18n/rechtname.js';
import { pruefeSichtbarenText } from './hilfen/sichtbarer-text.js';

const APP = fileURLToPath(new URL('../../src/app', import.meta.url));

function dateien(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p);
    return e.endsWith('.tsx') ? [p] : [];
  });
}

const SCHLUESSEL = new Set(KATALOG.map((e) => e.schluessel));

/**
 * `<code …>irgendwas</code>` — der Inhalt wird getrimmt, weil ein führendes
 * Leerzeichen im Element (`<code> crm.lesen</code>`) genau dieselbe Anzeige
 * ergibt und die Prüfung sonst daran vorbeiliefe.
 */
const CODE = /<code(?:\s[^>]*?)?>\s*([^<>{}]+?)\s*<\/code>/gu;
/**
 * Dieselbe Hülle, aber mit einem Bezeichner darin: `<code>{RECHT}</code>`,
 * `<code>{RECHT_SCHREIBEN}</code>`, `<code>{schreibrecht}</code>`.
 *
 * Gesucht wird das Wort `recht` im Namen, gross wie klein: der Umweg über
 * eine Variable sieht im Quelltext harmlos aus und ergibt auf dem Schirm
 * genau denselben rohen Schlüssel. `ausnahmeSchreibrecht(blatt)` war so
 * einer — eine Zeile, die der Suche nach `RECHT` entging.
 */
const CODE_KONSTANTE = /<code(?:\s[^>]*?)?>\{([A-Za-z_][A-Za-z0-9_]*[Rr]echt[A-Za-z0-9_]*)\}<\/code>/gu;

describe('ein Rechteschlüssel steht als Satz auf dem Schirm', () => {
  const alle = dateien(APP);

  it('die Umstellung ist geschehen und nicht nur beschrieben', () => {
    const treffer = alle.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/<Recht\b/gu)?.length ?? 0), 0);
    expect(treffer, 'so viele Stellen tragen den Satz').toBeGreaterThan(100);
  });

  it('kein Katalogschlüssel steht roh in einem `code`-Element', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<code')) continue;
      for (const m of inhalt.matchAll(CODE)) {
        if (!SCHLUESSEL.has(m[1] ?? '')) continue;
        const zeile = inhalt.slice(0, m.index ?? 0).split('\n').length;
        befunde.push(`${relative(APP, f)}:${String(zeile)} — ${m[1] ?? ''}`);
      }
    }
    expect(befunde, 'roher Rechteschlüssel statt `<Recht schluessel=…>`').toEqual([]);
  });

  it('auch nicht über den Umweg einer Konstanten', () => {
    const befunde: string[] = [];
    for (const f of alle) {
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('<code')) continue;
      for (const m of inhalt.matchAll(CODE_KONSTANTE)) {
        const zeile = inhalt.slice(0, m.index ?? 0).split('\n').length;
        befunde.push(`${relative(APP, f)}:${String(zeile)} — {${m[1] ?? ''}}`);
      }
    }
    expect(befunde, 'ein `RECHT…` in einem `code`-Element ist derselbe Befund').toEqual([]);
  });

  /**
   * Die andere Hälfte: der Satz muss auch für JEDEN Schlüssel entstehen, den
   * eine Seite anzeigen kann. Ein leerer oder roher Rückfall wäre hier das
   * Schlimmste — die Seite sähe aufgeräumt aus und sagte nichts mehr.
   */
  it('jeder Schlüssel des Katalogs ergibt einen Satz ohne Punkt darin', () => {
    const roh = alleRechteschluessel().filter((s) => {
      const de = rechtName(s, 'de');
      const en = rechtName(s, 'en');
      return de.trim() === '' || en.trim() === '' || de.includes('.') || en.includes('.');
    });
    expect(roh, 'Schlüssel ohne Satz — in `rechtname.ts` nachtragen').toEqual([]);
  });
});

/**
 * **Ein Satz, der vor dem Recht auf „wer" endet, geht danach weiter**
 * (V-266, V-267; Prüfung der Gruppe kalender-dokumente). „Termine ändert und
 * sagt ab, wer" + Recht + „." stand als „…, wer „den Kalender bearbeiten“."
 * auf dem Schirm — ohne Verb. Das Hausmuster ist `…Vor` + Recht + `…Nach`
 * („hält."), wie `nurSuperAdminVor`/`nurSuperAdminNach`.
 */
describe('„…, wer" + Recht + „hält"', () => {
  const I18N = fileURLToPath(new URL('../../src/lib/i18n', import.meta.url));
  const texte = (dir: string): readonly string[] => readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return texte(p);
    return e.endsWith('.ts') ? [p] : [];
  });
  /** `schluessel: 'a' + 'b'` — die Teile zusammengesetzt, auch über Zeilen. */
  const EINTRAG = /(\w+):\s*((?:'[^'\n]*'\s*\+\s*)*'[^'\n]*')/gu;
  const wert = (roh: string): string => [...roh.matchAll(/'([^'\n]*)'/gu)].map((m) => m[1]).join('');
  const seiten = dateien(APP).map((f) => readFileSync(f, 'utf8'));

  /** Der deutsche Wert eines Schlüssels — die deutsche Tabelle steht vorn. */
  const deutsch = (inhalt: string, schluessel: string): string | null => {
    const n = new RegExp(`\\b${schluessel}:\\s*((?:'[^'\\n]*'\\s*\\+\\s*)*'[^'\\n]*')`, 'u')
      .exec(inhalt);
    return n === null ? null : wert(n[1] ?? '');
  };
  /** Auf der Seite: `{t.xVor}{' '}` + `<Recht … />{' '}` + `{t.yNach}`. */
  const FOLGE = /^\{' '\}\s*<Recht\b[^>]*\/>\{' '\}\s*\{\w+\.(\w+Nach)\}/u;

  it('jeder solche Satz ist ein …Vor; die Seite setzt nach dem Recht ein …Nach, das mit „hält" beginnt', () => {
    const befunde: string[] = [];
    let gefunden = 0;
    for (const f of texte(I18N)) {
      const inhalt = readFileSync(f, 'utf8');
      for (const m of inhalt.matchAll(EINTRAG)) {
        const [, schluessel = '', roh = ''] = m;
        if (!/, wer$/u.test(wert(roh))) continue;
        gefunden += 1;
        const ort = `${relative(I18N, f)} ${schluessel}`;
        if (!schluessel.endsWith('Vor')) { befunde.push(`${ort}: kein …Vor`); continue; }
        const stellen = seiten.flatMap((s) => s.split(`.${schluessel}}`).slice(1));
        if (stellen.length === 0) befunde.push(`${ort}: keine Seite setzt ihn`);
        for (const danach of stellen) {
          const nach = FOLGE.exec(danach)?.[1];
          const text = nach === undefined ? null : deutsch(inhalt, nach);
          if (text === null || !text.startsWith('hält')) {
            befunde.push(`${ort}: nach dem Recht folgt kein …Nach mit „hält" (${nach ?? '—'})`);
          }
        }
      }
    }
    expect(gefunden, 'die Prüfung findet die Sätze').toBeGreaterThanOrEqual(5);
    expect(befunde).toEqual([]);
  });
});

/**
 * **Nicht nur in `<code>`** (V-250, D-741).
 *
 * Die Prüfungen oben sahen nur die `<code>`-Hülle. Dieselben Schlüssel
 * standen weiter roh da — als Text („dafür fehlt `zeit.abwesenheit_lesen`"),
 * als Zeichenkette in einem Ast (`'… dafür fehlt Ihnen angebot.schreiben.'`),
 * in `<span className="font-mono">`, als `<strong>{RECHT_EINGANG_LESEN}</strong>`,
 * eingesetzt in eine Vorlage und in den Satztabellen der Seiten („Ihnen fehlt
 * objekt.schreiben."). Dazu Markdown-Backticks, die im Browser Backticks
 * bleiben. Diese Prüfung liest den Syntaxbaum (`hilfen/sichtbarer-text.ts`):
 * jede Stelle, deren Wert gerendert wird, und jede Satztabelle.
 */
describe('kein Katalogschlüssel und kein Backtick im sichtbaren Text', () => {
  const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

  function baum(dir: string, endung: RegExp): readonly string[] {
    return readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      // Routen antworten mit JSON oder leiten um — ihr Text ist kein Schirm.
      if (statSync(p).isDirectory()) return e === 'api' ? [] : baum(p, endung);
      return endung.test(e) ? [p] : [];
    });
  }

  const lies = (d: string): string | null => {
    try { return readFileSync(d, 'utf8'); } catch { return null; }
  };
  const pruefe = (dateien: readonly (readonly [string, string])[]): readonly string[] =>
    pruefeSichtbarenText(dateien, SCHLUESSEL, lies, WURZEL)
      .map((b) => `${relative(WURZEL, b.datei)}:${String(b.zeile)} ${b.art} ${b.fund} — ${b.text}`);

  it('Seiten, Bausteine und Satztabellen — über den ganzen Baum', () => {
    const dateien = [
      ...baum(join(WURZEL, 'src/app'), /\.tsx?$/u),
      ...baum(join(WURZEL, 'src/components'), /\.tsx?$/u),
      ...baum(join(WURZEL, 'src/lib/i18n'), /\.ts$/u),
    ];
    // Die Prüfung liest überhaupt etwas — sonst wäre „keine Befunde" billig.
    expect(dateien.length).toBeGreaterThan(600);
    expect(pruefe(dateien.map((d) => [d, readFileSync(d, 'utf8')] as const)),
      'ein Schlüssel gehört in `<Recht schluessel=…>`, ein Name in einen Satz').toEqual([]);
  });

  it('die Gegenprobe: jeder Weg eines Schlüssels auf den Schirm wird gefunden', () => {
    const befunde = (quelle: string, datei = '/x/a.tsx', weitere: [string, string][] = []) =>
      pruefeSichtbarenText([[datei, quelle], ...weitere], SCHLUESSEL, () => null, '/x')
        .map((b) => `${b.art}:${b.fund}`);

    // JSX-Text, mit und ohne Backticks.
    expect(befunde('const a = <p>Dafür fehlt `zeit.abwesenheit_lesen`.</p>;'))
      .toEqual(['backtick:`', 'schluessel:zeit.abwesenheit_lesen']);
    expect(befunde('const a = <span className="font-mono">vergabe.schreiben</span>;'))
      .toEqual(['schluessel:vergabe.schreiben']);
    // Eine Zeichenkette in einem Ast, durch `?:`, `&&`, `??` und `+`.
    expect(befunde("const a = <p>{x ? 'ok' : ' dafür fehlt Ihnen angebot.schreiben.'}</p>;"))
      .toEqual(['schluessel:angebot.schreiben']);
    expect(befunde("const a = <p>{x && 'Recht ' + 'kalkulation.lesen'}</p>;"))
      .toEqual(['schluessel:kalkulation.lesen']);
    expect(befunde("const a = <code>{recht ?? 'reinigung.lesen'}</code>;"))
      .toEqual(['schluessel:reinigung.lesen']);
    // Eine Konstante — in der Datei, in einer Vorlage, über den Import.
    expect(befunde("const R = 'eingang.lesen'; const a = <p>Es fehlt <strong>{R}</strong></p>;"))
      .toEqual(['schluessel:eingang.lesen']);
    expect(befunde("const R = 'finanzen.lesen'; const a = <p>{`Es fehlt ${R}.`}</p>;"))
      .toEqual(['schluessel:finanzen.lesen']);
    expect(befunde("import { R } from './r'; const a = <p>{R}</p>;", '/x/a.tsx',
      [['/x/r.ts', "export const R = 'versand.freigeben';"]]))
      .toEqual(['schluessel:versand.freigeben']);
    // Eine Beschriftung, ein Feldwert, eine Tabellenzelle, eine Funktion der Datei.
    expect(befunde('const a = <Feld wert="kein Leserecht (zeit.konto_lesen)" />;'))
      .toEqual(['schluessel:zeit.konto_lesen']);
    expect(befunde("const s = [{ zelle: (z) => (z ? 'a' : 'Recht crm.lesen fehlt') }];"))
      .toEqual(['schluessel:crm.lesen']);
    expect(befunde("function satz() { return 'Es fehlt crm.schreiben.'; } const a = <p>{satz()}</p>;"))
      .toEqual(['schluessel:crm.schreiben']);
    // Eine Satztabelle neben der Seite und in `src/lib/i18n`.
    expect(befunde("export const T = { kein_recht: 'Ihnen fehlt ' + 'objekt.schreiben.' };", '/x/daten.ts'))
      .toEqual(['schluessel:objekt.schreiben']);
    expect(befunde("export const T = { de: { rolle: '`admin` — Administration' } };", '/x/t.ts'))
      .toEqual(['backtick:`']);
    // Quelltext im Satz (V-251): ein Name mit Unterstrich, mit Schema, mit Aufrufklammern …
    expect(befunde('const a = <p>führt das Konto soll_minuten = 0</p>;')).toEqual(['bezeichner:soll_minuten']);
    expect(befunde('const a = <p>aus app.darf_kontaktiert_werden, derselben Prüfung</p>;'))
      .toEqual(['bezeichner:app.darf_kontaktiert_werden']);
    expect(befunde('const a = <p>Hier füllt fuelleTatsachen() nichts.</p>;'))
      .toEqual(['bezeichner:fuelleTatsachen()']);
    expect(befunde("const I = 'quelle_ausgabe_uk'; const a = <p>{`der Teilindex ${I} lässt`}</p>;"))
      .toEqual(['bezeichner:quelle_ausgabe_uk']);
    // … ein Dateipfad, ein SQL-Wort, und dasselbe in einer Satztabelle.
    expect(befunde('const a = <p>steht im Code (server/benachrichtigung/registry.ts)</p>;'))
      .toEqual(['pfad:server/benachrichtigung/registry.ts']);
    expect(befunde('const a = <p>eine neue Anzeige, kein UPDATE — der CHECK greift</p>;'))
      .toEqual(['sql:UPDATE', 'sql:CHECK']);
    expect(befunde("export const T = { de: { satz: 'trägt aber ist_platzhalter = false.' } };", '/x/t.ts'))
      .toEqual(['bezeichner:ist_platzhalter']);
  });

  it('und findet nichts, wo kein Text entsteht', () => {
    const befunde = (quelle: string, datei = '/x/a.tsx') =>
      pruefeSichtbarenText([[datei, quelle]], SCHLUESSEL, () => null, '/x').map((b) => b.fund);

    // Das Recht als Satz — der Schlüssel im `title` ist Absicht (Recht.tsx).
    expect(befunde('const a = <p>Es fehlt <Recht schluessel="crm.lesen" />.</p>;')).toEqual([]);
    expect(befunde('const a = <span title="Dafür fehlt crm.lesen">—</span>;')).toEqual([]);
    // Steuerung: Feldzugriff, Aufruf, Vergleich, reiner Schlüssel als Wert.
    expect(befunde("const a = <p>{darf['crm.lesen'] === true ? 'ja' : 'nein'}</p>;")).toEqual([]);
    expect(befunde("const a = <p>{hatRecht('crm.lesen') ? 'ja' : 'nein'}</p>;")).toEqual([]);
    expect(befunde("export const M = { recht: 'crm.lesen', pfad: '/crm' };", '/x/m.ts')).toEqual([]);
    // Ein längerer Name, der einen Schlüssel enthält, ist kein Schlüssel — aber ein Name.
    expect(befunde('const a = <p>Die Funktion app.crm.lesen_alt gibt es nicht.</p>;'))
      .toEqual(['app.crm.lesen_alt']);
    // Was der Mensch tippt oder wählt, ist kein Satz: ein Platzhalter, die Vorwahl einer
    // Auswahl, der Wert einer Option, ein Wert, der nur ein Name ist.
    expect(befunde('const a = <input placeholder="vollzeit_39" />;')).toEqual([]);
    expect(befunde('const a = <select defaultValue="nur_storno"><option value="nur_storno">x</option></select>;'))
      .toEqual([]);
    expect(befunde("const L = [{ wert: 'zeit_korrektur', text: 'Zeitkorrektur' }];")).toEqual([]);
    expect(befunde("export const M = { tabelle: 'lead_aktivitaet', pfad: 'crm/leads' };", '/x/m.ts'))
      .toEqual([]);
    // Eine Adresse mit Unterstrich und ein Kürzel in Grossbuchstaben sind kein Quelltext.
    expect(befunde('const a = <p>an max_muster@firma.de, nach DSGVO und UWG</p>;')).toEqual([]);
  });
});
