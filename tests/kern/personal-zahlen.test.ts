/**
 * Der Personalbereich zeigt Postgres-Zahlen und Kalendertage in der deutschen
 * Schreibweise (V-196, EMP-04, EMP-05).
 *
 * **Der Befund.** `numeric`-Spalten wurden per `::text` gelesen und roh
 * ausgegeben: Stundenkonto „Urlaub (Tage)" und „Krank (Tage)" sowie die
 * Abwesenheiten standen als „5.000" oder „0.000" da — deutsch gelesen
 * fünftausend —, „Wochenstunden" als „38.50 h", „Arbeitstage pro Woche" als
 * „5.000". Die Listen der Beschäftigungen und die Personenseite zeigten
 * Eintritt und Austritt als „2026-01-15", das Detailblatt derselben
 * Beschäftigung dagegen als „15.01.2026"; das Entgeltblatt schrieb Stichtag
 * und Geltungsbeginn ebenfalls als ISO-Tag.
 *
 * Die Dienste liefern die Werte weiter in der Form der Datenbank — ISO-Tag
 * und Punkt —, weil Links, Stichtage und Vergleiche daran hängen. Umgeschrieben
 * wird NUR in der Anzeige, und genau das prüft dieser Test am Quelltext.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tagDeutsch } from '../../src/lib/datum/kalendertag.js';
import {
  formatiereMenge, mengeAusPostgres, tageAusPostgres,
} from '../../src/server/services/finanz/menge.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const P = 'src/app/portal/[mandant]/personal';

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

describe('die Umformung ändert nur die Anzeige', () => {
  it('Tage: „5.000" → „5", „0.000" → „0", „1.500" → „1,5"', () => {
    expect(tageAusPostgres('5.000')).toBe('5');
    expect(tageAusPostgres('0.000')).toBe('0');
    expect(tageAusPostgres('1.500')).toBe('1,5');
  });

  it('Wochenstunden (`numeric(5,2)`): „38.50" → „38,50"', () => {
    expect(formatiereMenge(mengeAusPostgres('38.50'))).toBe('38,50');
    expect(formatiereMenge(mengeAusPostgres('40.00'))).toBe('40,00');
  });

  it('Kalendertag: „2026-01-15" → „15.01.2026"', () => {
    expect(tagDeutsch('2026-01-15')).toBe('15.01.2026');
  });
});

describe('keine Seite des Personalbereichs gibt diese Werte roh aus', () => {
  it('Beschäftigungsblatt: Wochenstunden, Urlaub, Krank, Tage', () => {
    const s = quelle(`${P}/anstellungen/[id]/page.tsx`);
    expect(s).not.toMatch(/`\$\{kopf\.wochenstunden\} h`/u);
    expect(s).not.toMatch(/k\.(?:urlaub|krank) \?\? '0'/u);
    expect(s).not.toMatch(/\$\{a\.tage \?\? '—'\}/u);
    expect(s).toContain('tageAusPostgres(k.urlaub)');
    expect(s).toContain('tageAusPostgres(a.tage)');
  });

  it('Vertrag: Wochenstunden, Arbeitstage und der Geltungsbeginn', () => {
    const s = quelle(`${P}/anstellungen/[id]/vertrag/page.tsx`);
    expect(s).not.toMatch(/`\$\{zeile\.wochenstunden\} h`/u);
    expect(s).not.toMatch(/value=\{zeile\.arbeitstageWoche \?\?/u);
    expect(s).not.toMatch(/gilt ab \$\{laufend\.giltAb\}/u);
  });

  it('Entgelt: Stichtag, Geltung, Wochenstunden, Arbeitstage, Konditionen', () => {
    const s = quelle(`${P}/anstellungen/[id]/entgelt/page.tsx`);
    expect(s).not.toMatch(/>\{stichtag\}</u);
    expect(s).not.toMatch(/Für den \{stichtag\}/u);
    expect(s).not.toMatch(/laufend\?\.giltAb \?\?/u);
    expect(s).not.toMatch(/`\$\{zeile\.wochenstunden\} h`/u);
    // Als Kind in JSX — `?stichtag=${k.giltAb}` im Verweis bleibt ISO, und das ist richtig.
    expect(s).not.toMatch(/^\s*\{k\.giltAb\}\s*$/mu);
    expect(s).not.toMatch(/k\.wochenstunden \?\? '—'/u);
    expect(s).not.toMatch(/k\.arbeitstageWoche \?\? '—'/u);
  });

  /**
   * **Über den ganzen Personalbereich, nicht über die Liste des Befunds.**
   * Die Gegenprobe fand dieselbe Rohform auf acht weiteren Seiten — Antrags-
   * und Abwesenheitsblatt, beide Listen, Nachweisregister und -blatt,
   * Personenblatt, Beenden. Diese Prüfung liest jede `.tsx` unter
   * `personal/` und verlangt, dass ein ISO-Tag nur noch in Technik steht
   * (`href`, `key`, `min`, `defaultValue` eines Datumsfelds), nie im Text.
   */
  it('kein ISO-Tag im sichtbaren Text einer Seite des Personalbereichs', () => {
    const FELD = '(?:gueltigAb|gueltigBis|giltAb|giltBis|eintritt|austritt|vonDatum|bisDatum|von|bis)';
    const ROH = [
      // `{n.gueltigAb}` als Kind, allein auf der Zeile
      new RegExp(`^\\s*\\{(?!t\\.)[\\w.]+\\.${FELD}\\}\\s*$`, 'u'),
      // `{n.gueltigBis ?? 'unbefristet'}` als Kind
      new RegExp(`\\{[\\w.]+\\.${FELD} \\?\\? '[^']*'\\}`, 'u'),
      // `${antrag.vonDatum} bis …` in einem angezeigten Satz
      new RegExp(`\\$\\{[\\w.]+\\.${FELD}\\}`, 'u'),
      // `Stichtag {heute}` / `{von} bis {bis}`
      /[>\s]\{(?:heute|stichtag|von|bis)\}/u,
      // `wert={kopf.gueltigAb}` / `wert={x ?? 'unbefristet'}` an einem Feld
      new RegExp(`wert=\\{[\\w.]+\\.${FELD}(?: \\?\\? '[^']*')?\\}`, 'u'),
    ];
    const TECHNIK = /href=|key=|schluessel=|\bmin=|defaultValue=|\?stichtag=|\.slice\(/u;
    const dateien = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const v = join(d, e);
      return statSync(v).isDirectory() ? dateien(v) : v.endsWith('.tsx') ? [v] : [];
    });
    const funde: string[] = [];
    for (const datei of dateien(join(WURZEL, P))) {
      readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
        const code = zeile.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (TECHNIK.test(code)) return;
        if (ROH.some((r) => r.test(zeile))) {
          funde.push(`${datei.slice(WURZEL.length + 1)}:${String(i + 1)}: ${code}`);
        }
      });
    }
    expect(funde).toEqual([]);
  });

  it('Listen: Eintritt und Austritt als TT.MM.JJJJ', () => {
    for (const datei of [`${P}/anstellungen/page.tsx`, `${P}/personen/[id]/page.tsx`]) {
      const s = quelle(datei);
      expect(s, datei).not.toMatch(/\{\s*[az]\.eintritt\s*\}/u);
      expect(s, datei).not.toMatch(/\$\{[az]\.austritt\}/u);
      expect(s, datei).toContain('tagDeutsch(');
    }
  });
});
