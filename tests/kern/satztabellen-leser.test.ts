/**
 * **Kein Satz einer Satztabelle, den niemand zeigt** (V-249, D-744).
 *
 * `ANTRAG_FORM_TEXTE.pflichtBei` stand in vier Sprachen in der Tabelle der
 * Antragsmaske und erschien auf keiner Seite: das Formular setzt den
 * gleichnamigen Satz aus `MEIN_FORMULAR_TEXTE` ein. Eine Prüfung rief den
 * toten Satz auf und bestätigte ihn — sie prüfte etwas, das kein Mensch liest.
 * Ein Satz, den niemand sieht, veraltet unbemerkt; `fehlt_einsatz` daneben
 * war veraltet, OBWOHL man ihn sah.
 *
 * Diese Prüfung verfolgt jeden Spracheintrag jeder Satztabelle unter
 * `src/lib/i18n` durch den ganzen Baum bis zu dem Feld, das gelesen wird
 * (`tests/kern/hilfen/satztabellen.ts`). Was beim Einfrieren niemand las,
 * steht in `satztabellen-bestand.ts` und darf nur weniger werden.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NICHT_VERFOLGTE_SATZTABELLEN, UNGELESENE_SATZFELDER } from './satztabellen-bestand.js';
import { leserDerSatztabellen, satztabellenIn, type Lesestand, type Satztabelle } from './hilfen/satztabellen.js';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

function baum(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return baum(p);
    return /\.tsx?$/u.test(e) ? [p] : [];
  });
}

const lies = (d: string): string | null => {
  try { return readFileSync(d, 'utf8'); } catch { return null; }
};

/** Die Tabellen des Baums mit ihrem Lesestand, geschlüsselt `datei#NAME`. */
function stand(): ReadonlyMap<string, { tabelle: Satztabelle; lesestand: Lesestand }> {
  const quellen = baum(join(WURZEL, 'src')).map((d) => [d, readFileSync(d, 'utf8')] as const);
  const tabellen = quellen
    .filter(([d]) => relative(WURZEL, d).startsWith(join('src', 'lib', 'i18n')))
    .flatMap(([d, q]) => satztabellenIn(d, q));
  const leser = leserDerSatztabellen(tabellen, quellen, lies, WURZEL);
  return new Map(tabellen.map((t) => [`${relative(WURZEL, t.datei)}#${t.name}`,
    { tabelle: t, lesestand: leser.get(`${t.datei}#${t.name}`)! }] as const));
}

function ungelesen(e: { tabelle: Satztabelle; lesestand: Lesestand }): readonly string[] {
  return e.tabelle.felder.filter((f) => !e.lesestand.felder.has(f));
}

describe('kein Satz einer Satztabelle, den niemand zeigt', () => {
  const heute = stand();

  it('die Prüfung findet die Tabellen und verfolgt die meisten bis zum Feld', () => {
    expect(heute.size).toBeGreaterThan(80);
    const verfolgt = [...heute.values()].filter((e) => !e.lesestand.alle);
    expect(verfolgt.length).toBeGreaterThan(70);
  });

  it('die Sätze der Formulare im Arbeiterportal haben jeder einen Leser', () => {
    for (const id of [
      'src/lib/i18n/mein-formular.ts#MEIN_FORMULAR_TEXTE',
      'src/lib/i18n/mein-formulare.ts#ANTRAG_FORM_TEXTE',
      'src/lib/i18n/mein-formulare.ts#MELDUNG_FORM_TEXTE',
      'src/lib/i18n/mein-formulare.ts#EINWAND_FORM_TEXTE',
    ]) {
      const e = heute.get(id);
      expect(e, id).toBeDefined();
      expect(e!.lesestand.gruende, id).toEqual([]);
      expect(ungelesen(e!), id).toEqual([]);
      expect(UNGELESENE_SATZFELDER[id], id).toBeUndefined();
    }
  });

  it('kein Feld, das niemand liest, ausser dem eingefrorenen Bestand', () => {
    const neu = [...heute.entries()].flatMap(([id, e]) => {
      if (e.lesestand.alle) return [];
      const alt = new Set(UNGELESENE_SATZFELDER[id] ?? []);
      return ungelesen(e).filter((f) => !alt.has(f)).map((f) => `${id}.${f}`);
    });
    expect(neu, 'einen Satz, den keine Seite zeigt, entfernen — oder die Seite, die ihn zeigen soll, '
      + 'ihn lesen lassen').toEqual([]);
  });

  it('der Bestand ist genau — ein Feld, das wieder gelesen wird oder fällt, wird gestrichen', () => {
    const veraltet = Object.entries(UNGELESENE_SATZFELDER).flatMap(([id, felder]) => {
      const e = heute.get(id);
      if (e === undefined) return [`${id}: keine Satztabelle mehr`];
      const jetzt = new Set(e.lesestand.alle ? [] : ungelesen(e));
      return felder.filter((f) => !jetzt.has(f)).map((f) => `${id}.${f}: wird gelesen oder fehlt`);
    });
    expect(veraltet, 'satztabellen-bestand.ts nachziehen').toEqual([]);
  });

  it('welche Tabellen die Prüfung nicht bis zum Feld verfolgen kann, steht mit Namen fest', () => {
    const blind = [...heute.entries()].filter(([, e]) => e.lesestand.alle)
      .map(([id, e]) => `${id} — ${e.lesestand.gruende[0] ?? ''}`);
    expect(blind.map((b) => b.split(' — ')[0]).sort(), blind.join('\n'))
      .toEqual([...NICHT_VERFOLGTE_SATZTABELLEN].sort());
  });

  it('die Gegenprobe: jeder Weg zu einem Feld zählt als Leser, und ein totes Feld wird gefunden', () => {
    const TABELLE = "export const T = {\n  de: { a: 'A', b: 'B', c: 'C' },\n  en: { a: 'A', b: 'B', c: 'C' },\n};\n";
    const WAHL = 'export function nachSprache(tabelle, sprache) { return tabelle[sprache]; }\n';
    const IMP = "import { T } from '@/lib/i18n/t';\n";
    const tot = (seite: string, weitere: (readonly [string, string])[] = []): string => {
      const dateien: (readonly [string, string])[] = [['/x/src/lib/i18n/t.ts', TABELLE],
        ['/x/src/lib/i18n/wahl.ts', WAHL], ['/x/src/app/a.tsx', seite], ...weitere];
      const tabellen = satztabellenIn('/x/src/lib/i18n/t.ts', TABELLE);
      const r = leserDerSatztabellen(tabellen, dateien, () => null, '/x').get('/x/src/lib/i18n/t.ts#T')!;
      return r.alle ? 'alle' : tabellen[0]!.felder.filter((f) => !r.felder.has(f)).join(',');
    };

    // Niemand liest — jedes Feld ist tot.
    expect(tot(IMP)).toBe('a,b,c');
    // Feldzugriff, Sprache als Name, Zerlegung, Wahlfunktion.
    expect(tot(`${IMP}const t = T[s];\nconst a = <p>{t.a}</p>;`)).toBe('b,c');
    expect(tot(`${IMP}const a = <p>{T.de.b}</p>;`)).toBe('a,c');
    expect(tot(`${IMP}const { a, c } = T.de;`)).toBe('b');
    expect(tot(`${IMP}import { nachSprache } from '@/lib/i18n/wahl';\n`
      + "const t = nachSprache(T, s);\nconst x = t.a + t['c'];")).toBe('b');
    // In einen Baustein — zerlegt, umbenannt, über `props`, mit Vorgabewert.
    expect(tot(`${IMP}function Satz({ t }) { return <p>{t.b}</p>; }\nconst a = <Satz t={T.de} />;`)).toBe('a,c');
    expect(tot(`${IMP}function Satz({ t: x }) { return <p>{x.c}</p>; }\nconst a = <Satz t={T.de} />;`)).toBe('a,b');
    expect(tot(`${IMP}function Satz(props) { return <p>{props.t.a}</p>; }\nconst a = <Satz t={T.de} />;`)).toBe('b,c');
    expect(tot(`${IMP}function Satz({ t = T.de }) { return <p>{t.b}</p>; }`)).toBe('a,c');
    // In eine Funktion, aus einer Funktion (auch über den Import), in ein Objekt.
    expect(tot(`${IMP}function zeige(x) { return x.b; }\nconst a = zeige(T[s]);`)).toBe('a,c');
    expect(tot(`${IMP}export function texte(s) { return T[s]; }`,
      [['/x/src/app/b.tsx', "import { texte } from './a';\nconst x = texte(s).a;"]])).toBe('b,c');
    expect(tot(`${IMP}const basis = { texte: T[s] };\nconst t = basis.texte;\nconst x = t.c;`)).toBe('a,b');
    // Eine Tabelle von Funktionen, aus der erst zur Laufzeit gewählt wird.
    expect(tot(`${IMP}const F = { x: (t) => t.a, y: (t) => t.b };\nconst f = eigenerEintrag(F, k);\n`
      + 'const s = f(T.de);')).toBe('c');
    // Ein Vergleich liest nichts.
    expect(tot(`${IMP}const t = T[s];\nconst x = t === null ? null : t.a;`)).toBe('b,c');
    // Wo die Verfolgung aufhört, gilt die Tabelle als ganz gelesen.
    expect(tot(`${IMP}const t = T[s];\nconst x = t[k];`)).toBe('alle');
    expect(tot(`${IMP}const x = Object.values(T.de);`)).toBe('alle');
    // Ein zweiter Name für die Tabelle liest wie die Tabelle selbst.
    expect(tot(`${IMP}const U = T;\nconst t = U[s];\nconst x = t.a;`)).toBe('b,c');
    expect(tot(`${IMP}import { nachSprache } from '@/lib/i18n/wahl';\n`
      + 'const U = T;\nconst x = nachSprache(U, s).c;')).toBe('a,b');
  });

  it('eine Beschriftungskarte liest der Wert — ganz, sobald eine Stelle sie liest, sonst gar nicht', () => {
    const KARTE = "import type { Karte } from './basis';\n"
      + "export const K: Karte<'offen' | 'zu'> = {\n  de: { offen: 'offen', zu: 'zu' },\n"
      + "  en: { offen: 'open', zu: 'closed' },\n};\n";
    const tot = (seite: string): string => {
      const dateien: (readonly [string, string])[] = [['/x/src/lib/i18n/k.ts', KARTE], ['/x/src/app/a.tsx', seite]];
      const tabellen = satztabellenIn('/x/src/lib/i18n/k.ts', KARTE);
      expect(tabellen.map((t) => t.karte)).toEqual([true]);
      const r = leserDerSatztabellen(tabellen, dateien, () => null, '/x').get('/x/src/lib/i18n/k.ts#K')!;
      return r.alle ? 'alle' : tabellen[0]!.felder.filter((f) => !r.felder.has(f)).join(',');
    };
    const IMP = "import { K } from '@/lib/i18n/k';\n";
    expect(tot(`${IMP}const a = <p>{beschriftung(K, zeile.status)}</p>;`)).toBe('');
    expect(tot(`${IMP}const a = <p>{eigenerEintrag(K.de, code) ?? 'Unbekannt.'}</p>;`)).toBe('');
    expect(tot(IMP)).toBe('offen,zu');
    // Eine Tabelle ohne die Angabe `Karte<…>` bleibt eine Satztabelle.
    expect(satztabellenIn('/x/t.ts', "export const T = {\n  de: { a: 'A' },\n  en: { a: 'A' },\n};\n")
      .map((t) => t.karte)).toEqual([false]);
  });
});
