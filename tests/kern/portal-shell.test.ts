/**
 * PR 8 Akzeptanz (1) und (3, Typseite) — was sich ohne Browser prüfen lässt.
 *
 * (3) hat zwei Hälften, und beide zählen: der Kontext darf keine
 * Schreibmethode HABEN (hier), und ein direkter POST muss abgewiesen werden
 * (in der Isolationsprüfung). Ein Typ schützt den Code, den wir schreiben; die
 * Datenbank schützt den Rest.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { GRUPPEN_NAVIGATION, NAVIGATION } from '../../src/server/registry/navigation';
import { DIENSTE, SCHREIBENDE_DIENSTE } from '../../src/server/registry/dienste';
import { KATALOG } from '../../src/server/auth/katalog.generiert';
import { ROUTEN } from '../../src/server/registry/routen';

const WURZEL = resolve(import.meta.dirname, '../..');
const SCHLUESSEL = new Set(KATALOG.map((e) => e.schluessel));

describe('(1) ein Bereich heisst: kein Chevron, kein Dropdown im DOM', () => {
  const quelle = readFileSync(
    join(WURZEL, 'src/components/portal/BereichsUmschalter.tsx'), 'utf8',
  );

  it('die Komponente kehrt früh zurück, statt zu verstecken', () => {
    // `hidden` oder `display:none` wären falsch: ein Auslöser, den man nicht
    // sieht, aber im Quelltext findet, ist eine Einladung.
    expect(quelle).toMatch(/bereiche\.length <= 1[\s\S]{0,120}return \(/u);
    expect(quelle).toContain('data-cse="logo-statisch"');
  });

  it('und rendert dort weder Chevron noch Menü', () => {
    const frueh = quelle.slice(
      quelle.indexOf('bereiche.length <= 1'),
      quelle.indexOf('function waehle'),
    );
    expect(frueh).not.toContain('chevron');
    expect(frueh).not.toContain('umschalter-menue');
  });
});

describe('(3) der Gruppenkontext HAT keine Schreibmethode', () => {
  it('withGroupScope gibt LeseKontext zurück, nicht SchreibKontext', () => {
    const quelle = readFileSync(join(WURZEL, 'src/server/kontext/index.ts'), 'utf8');
    expect(quelle).toMatch(/withGroupScope[\s\S]{0,400}kontext: LeseKontext\) => Promise<T>/u);
    expect(quelle).toMatch(/export interface LeseKontext \{[^}]*\}/u);
    // `schreibe` steht ausschliesslich auf SchreibKontext.
    const lese = quelle.slice(quelle.indexOf('export interface LeseKontext'),
                              quelle.indexOf('export interface SchreibKontext'));
    expect(lese).not.toContain('schreibe');
  });

  it('ein Schreibversuch im Gruppenkontext ist ein COMPILERFEHLER', () => {
    // Die Zusage ist eine Typzusage. Sie zu prüfen heisst, den Compiler zu
    // fragen — eine Laufzeitprüfung könnte nur zeigen, dass es diesmal
    // niemand versucht hat.
    const verzeichnis = mkdtempSync(join(tmpdir(), 'cse-gruppe-'));
    const datei = join(verzeichnis, 'probe.ts');
    writeFileSync(datei, `
import type { LeseKontext } from '${join(WURZEL, 'src/server/kontext/index.js')}';
import { ROUTEN } from '../../src/server/registry/routen';
export async function schreibeInDerGruppe(k: LeseKontext): Promise<void> {
  await k.schreibe('insert into person (vorname, nachname) values ($1,$2)', ['A', 'B']);
}
`);
    let ausgabe = '';
    try {
      execFileSync(join(WURZEL, 'node_modules/.bin/tsc'),
        ['--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', datei],
        { encoding: 'utf8' });
    } catch (f) {
      ausgabe = (f as { stdout?: string }).stdout ?? '';
    }
    expect(ausgabe).toMatch(/schreibe/u);
  }, 120_000);
});

describe('(3) das Dienstregister deckt künftige Module automatisch ab', () => {
  it('jeder schreibende Dienst nennt sein Schreibrecht', () => {
    for (const d of SCHREIBENDE_DIENSTE) {
      expect(d.schreibRecht, d.pfad).toBeDefined();
      expect(SCHLUESSEL, `${d.pfad} → ${d.schreibRecht!}`).toContain(d.schreibRecht!);
    }
  });

  it('und das Register kennt jeden Dienst, der existiert', () => {
    // Die Gegenrichtung: sonst prüft der Gruppentest eine Teilmenge und
    // meldet dabei Vollständigkeit.
    // Nur `services/` — `jobs/` laeuft als `cse_job` ausserhalb jeder
    // Benutzersitzung, und die Gruppenansichtsfrage stellt sich dort nicht.
    const quellen = execFileSync('find',
      [join(WURZEL, 'src/server/services'), '-name', '*.ts'], { encoding: 'utf8' })
      .trim().split('\n').filter((z) => z !== '')
      .map((z) => z.replace(`${join(WURZEL, 'src/server/services')}/`, '').replace(/\.ts$/u, ''));
    const bekannt = new Set(DIENSTE.map((d) => d.pfad));
    expect(quellen.filter((q) => !bekannt.has(q))).toEqual([]);
  });
});

describe('das Navigationsregister', () => {
  it('jeder Punkt nennt ein Recht, das der Katalog kennt (K-19)', () => {
    for (const n of NAVIGATION) {
      expect(SCHLUESSEL, `${n.schluessel} → ${n.recht}`).toContain(n.recht);
    }
  });

  it('die Gruppenansicht zeigt nur, was dort auch sinnvoll ist', () => {
    expect(GRUPPEN_NAVIGATION.length).toBeLessThan(NAVIGATION.length);
    // `einstellungen` ist ein Verwaltungspunkt — in einer Ansicht ohne
    // aktiven Mandanten gibt es nichts einzustellen.
    expect(GRUPPEN_NAVIGATION.map((n) => n.schluessel)).not.toContain('einstellungen');
  });

  it('jeder Punkt zeigt auf eine Route, die es GIBT', () => {
    /**
     * Die Sidebar ist der erste Klick jedes Benutzers, und ein Punkt, der
     * nirgendwohin fuehrt, ist der sichtbarste 404 im ganzen Portal — und der
     * am leichtesten zu uebersehende, weil das Register ihn plausibel
     * ausfuellt. Genau das war er: `dienstplan` gab es als Pfad nicht, die
     * Seitenkarte kennt nur `dienstplan/woche` und seine Geschwister. Die
     * Tab-Leiste zeigte laengst richtig; hier stand die zweite Fassung.
     *
     * Geprueft wird gegen das Routen-Manifest, also gegen die Seitenkarte —
     * nicht gegen den Dateibaum, denn der beantwortet nur, was jemand gebaut
     * hat, und nicht, was gebaut sein sollte.
     */
    const mandantenrouten = new Set(
      ROUTEN.map((r) => r.pfad)
        .filter((p) => p.startsWith('/portal/[mandant]/'))
        .map((p) => p.slice('/portal/[mandant]/'.length)),
    );
    for (const n of NAVIGATION) {
      // Der Dashboardpunkt hat den leeren Pfad — er IST `/portal/[mandant]`.
      if (n.pfad === '') continue;
      expect(mandantenrouten, `${n.schluessel} → ${n.pfad}`).toContain(n.pfad);
    }
  });

  it('kein Punkt doppelt, kein Pfad doppelt', () => {
    const s = NAVIGATION.map((n) => n.schluessel);
    const p = NAVIGATION.map((n) => n.pfad);
    expect(new Set(s).size).toBe(s.length);
    expect(new Set(p).size).toBe(p.length);
  });
});
