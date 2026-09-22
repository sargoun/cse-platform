/**
 * **Die Seitenleiste zeigt, wo man IST** — auf jeder Seite denselben Punkt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht, mit Bild).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Mandant klickte in der Leiste auf **CRM** und die Zeile blieb grau,
 * während **Objekte** sich hell färbte. Zwei Punkte derselben Leiste, zwei
 * verschiedene Verhalten — und kein sichtbarer Grund.
 *
 * Der Grund stand in der Seite: `/portal/[mandant]/crm/page.tsx` gab
 * `aktiverTab="dashboard"` mit. `Sidebar.tsx` vergleicht `schluessel ===
 * aktiv`; es leuchtete also „Übersicht", während der Mensch auf CRM stand.
 *
 * **Gemessen waren es 111 Seiten** — 110 mit dem falschen Punkt, eine mit
 * einem Schlüssel, den der Baum gar nicht kennt. Jede einzelne für sich ein
 * Tippfehler, zusammen eine Leiste, der man nicht glaubt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Regel: der LÄNGSTE passende Pfad gewinnt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `bank` trägt `pfad: 'buchhaltung/bank'`, `buchhaltung` trägt
 * `pfad: 'buchhaltung'`. Eine Seite unter `buchhaltung/bank/import` gehört
 * deshalb zu `bank` und nicht zu `buchhaltung` — der spezifischere Punkt ist
 * der, auf dem der Mensch steht. Ein Vergleich nur des ersten Segments hätte
 * hier 29 Seiten falsch gemeldet.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WURZEL = fileURLToPath(new URL('../../src/app/portal/[mandant]', import.meta.url));
const NAVI = fileURLToPath(new URL('../../src/server/registry/navigation.ts', import.meta.url));

function seiten(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return seiten(p);
    return e === 'page.tsx' ? [p] : [];
  });
}

/**
 * Seiten, die absichtlich KEINEN Punkt zum Leuchten bringen.
 *
 * **Die Liste darf schrumpfen, nie wachsen.** Jede Zeile ist eine
 * Entscheidung mit Grund — kein Ventil.
 */
const OHNE_PUNKT: Readonly<Record<string, string>> = {
  benachrichtigungen:
    'Der Meldungsposteingang wird ueber die GLOCKE in der Kopfzeile geoeffnet '
    + 'und steht in keinem Navigationsbaum. Ihn auf „Mehr" zu setzen waere '
    + 'ebenso falsch: er steht auch dort nicht. Keine Zeile leuchtet, und das '
    + 'ist hier die Wahrheit.',
};

interface Eintrag { readonly schluessel: string; readonly pfad: string }

function interneEintraege(): { eintraege: readonly Eintrag[]; schluessel: ReadonlySet<string> } {
  const nav = readFileSync(NAVI, 'utf8');
  const start = nav.indexOf('export const NAVIGATION');
  const ende = nav.indexOf('export const', start + 10);
  const intern = nav.slice(start, ende === -1 ? undefined : ende);
  const eintraege: Eintrag[] = [];
  const schluessel = new Set<string>();
  for (const m of intern.matchAll(/\{[^{}]*schluessel: '([a-z_]+)'[^{}]*\}/gu)) {
    schluessel.add(m[1] ?? '');
    const p = /pfad: '([^']*)'/u.exec(m[0]);
    if (p !== null && p[1] !== '') {
      eintraege.push({ schluessel: m[1] ?? '', pfad: p[1] ?? '' });
    }
  }
  // Der spezifischste Punkt zuerst.
  eintraege.sort((a, b) => b.pfad.length - a.pfad.length);
  return { eintraege, schluessel };
}

/**
 * Welcher Punkt eine Seite DECKT.
 *
 * **Zwei Regeln, und die zweite ist die, die `personal` rettet.**
 *
 *  1. Der längste Pfad, der die Seite präfixiert, gewinnt. `bank` trägt
 *     `buchhaltung/bank`, `buchhaltung` trägt `buchhaltung` — also gehört
 *     `buchhaltung/bank/import` zu `bank`.
 *  2. Trägt ein Punkt einen Pfad mit mehreren Gliedern (`personal/
 *     anstellungen`) und beansprucht KEIN anderer Punkt das erste Glied
 *     allein, dann deckt er den ganzen Bereich. Sonst fiele
 *     `personal/personen` durch jedes Raster — der Punkt heisst „Personal",
 *     seine LANDESEITE ist nur zufällig die Anstellungsliste.
 *
 * Die Unterscheidung zwischen den beiden ist genau die Frage, ob das erste
 * Glied einen eigenen Besitzer hat: `buchhaltung` hat einen, `personal`
 * nicht.
 */
function deckung(
  eintraege: readonly Eintrag[], weg: string,
): Eintrag | undefined {
  const genau = eintraege.find((e) => weg === e.pfad || weg.startsWith(`${e.pfad}/`));
  if (genau !== undefined) return genau;
  const erstes = weg.split('/')[0] ?? '';
  const besitzerDesGlieds = eintraege.some((e) => e.pfad === erstes);
  if (besitzerDesGlieds) return undefined;
  return eintraege.find((e) => e.pfad.split('/')[0] === erstes);
}

interface Seite { readonly weg: string; readonly tab: string }

function seitenMitTab(): readonly Seite[] {
  const gefunden: Seite[] = [];
  for (const f of seiten(WURZEL)) {
    const weg = relative(WURZEL, f).split(/[/\\]/u).join('/').replace(/\/page\.tsx$/u, '');
    if (weg === 'page.tsx' || weg === '') continue;
    const m = /aktiverTab="([a-z_]+)"/u.exec(readFileSync(f, 'utf8'));
    if (m !== null) gefunden.push({ weg, tab: m[1] ?? '' });
  }
  return gefunden;
}

describe('die Seitenleiste zeigt, wo man ist', () => {
  const { eintraege, schluessel } = interneEintraege();
  const alle = seitenMitTab();

  it('es gibt Seiten und einen Baum zu prüfen', () => {
    expect(alle.length).toBeGreaterThan(100);
    expect(eintraege.length).toBeGreaterThan(20);
  });

  /**
   * **Ein Schlüssel, den der Baum nicht kennt, lässt die Leiste stumm.** Das
   * ist der schlimmere der beiden Fälle: es leuchtet gar nichts, und der
   * Mensch sieht keinen Unterschied zwischen „ich bin nirgends" und „die
   * Seite hat einen Tippfehler".
   */
  it('jeder `aktiverTab` steht im internen Baum', () => {
    const unbekannt = alle
      .filter((s) => s.tab !== 'mehr' && !schluessel.has(s.tab))
      .filter((s) => !(s.weg in OHNE_PUNKT))
      .map((s) => `${s.weg} → "${s.tab}"`);
    expect(unbekannt, 'Seiten mit einem Schlüssel, den kein Punkt trägt').toEqual([]);
  });

  /**
   * **Und es leuchtet der Punkt, auf dem man steht.** `crm/kunden/[id]` gab
   * `dashboard` mit: die Leiste zeigte „Übersicht", während der Mensch bei
   * einem Kunden stand.
   */
  it('jeder `aktiverTab` ist der Punkt, der die Seite deckt', () => {
    const falsch: string[] = [];
    for (const s of alle) {
      if (s.weg in OHNE_PUNKT) continue;
      const treffer = deckung(eintraege, s.weg);
      // Keine Deckung: die Seite liegt ausserhalb jedes Sidebarpunkts.
      if (treffer === undefined) continue;
      if (s.tab !== treffer.schluessel) {
        falsch.push(`${s.weg} → setzt "${s.tab}", erwartet "${treffer.schluessel}"`);
      }
    }
    expect(falsch, 'Seiten, die den falschen Punkt zum Leuchten bringen').toEqual([]);
  });

  /**
   * **Eine gedeckte Seite ohne `aktiverTab` leuchtet ebenfalls nicht.**
   *
   * Zehn Seiten unter `personal/` hatten das Prop gar nicht — dieselbe
   * Wirkung wie ein falscher Schlüssel, nur unauffälliger: kein Tippfehler
   * zu sehen, nur eine Leiste, die schweigt.
   */
  it('jede gedeckte Seite setzt überhaupt einen `aktiverTab`', () => {
    const ohne: string[] = [];
    for (const f of seiten(WURZEL)) {
      const weg = relative(WURZEL, f).split(/[/\\]/u).join('/').replace(/\/page\.tsx$/u, '');
      if (weg === 'page.tsx' || weg === '') continue;
      const inhalt = readFileSync(f, 'utf8');
      if (!inhalt.includes('PortalRahmen')) continue;
      if (/aktiverTab/u.test(inhalt)) continue;
      if (weg in OHNE_PUNKT) continue;
      if (deckung(eintraege, weg) === undefined) continue;
      ohne.push(weg);
    }
    expect(ohne, 'gedeckte Seiten ohne `aktiverTab` — die Leiste schweigt').toEqual([]);
  });

  /** Die Gegenrichtung: ein Eintrag, dessen Grund entfallen ist. */
  it('kein Eintrag in der Ausnahmeliste ist überflüssig', () => {
    const wege = new Set(alle.map((s) => s.weg));
    const ueberfluessig = Object.keys(OHNE_PUNKT).filter((w) => !wege.has(w));
    expect(ueberfluessig, 'Ausnahmen ohne Seite').toEqual([]);
  });
});
