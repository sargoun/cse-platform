/**
 * Die Sperrklinke gegen die deutsche Verdrahtung — in beiden Richtungen.
 *
 * Eine Wache, die nie hat feuern sehen, ist von einer kaputten nicht zu
 * unterscheiden (so steht es im Kopf von `wachen.test.ts`, und es gilt hier
 * doppelt: diese Wache soll MONATE lang halten, waehrend 383 Dateien
 * umgestellt werden).
 */
import { describe, expect, it } from 'vitest';
import { festeZeichenketten } from '../../scripts/guards/seite-ohne-uebersetzung';
import { UEBERSETZUNG_AUSNAHMEN } from '../../scripts/guards/uebersetzung-ausnahmen';

const d = 'probe.tsx';

describe('festeZeichenketten', () => {
  it('meldet sichtbaren Text zwischen den Elementen', () => {
    const f = festeZeichenketten(d, 'export const A = () => <p>Offene Forderungen</p>;');
    expect(f).toHaveLength(1);
    expect(f[0]?.text).toBe('Offene Forderungen');
  });

  it('meldet eine Beschriftung als Attribut', () => {
    const f = festeZeichenketten(d, 'export const A = () => <X titel="Zahlungen" />;');
    expect(f.map((x) => x.text)).toEqual(['Zahlungen']);
  });

  it('meldet einen Spaltenkopf als Feld', () => {
    const f = festeZeichenketten(d, "export const S = [{ schluessel: 'a', kopf: 'Kunde' }];");
    expect(f.map((x) => x.text)).toEqual(['Kunde']);
  });

  it('meldet `alt` und `aria-label` — eine Sprachausgabe liest sie vor', () => {
    const f = festeZeichenketten(d,
      'export const A = () => <img alt="Platzhalterbild" aria-label="Vorschau" />;');
    expect(f.map((x) => x.text).sort()).toEqual(['Platzhalterbild', 'Vorschau']);
  });

  /* ── und was sie NICHT melden darf ───────────────────────────────────── */

  it('schweigt zu einer umgestellten Seite', () => {
    const f = festeZeichenketten(d,
      'export const A = ({ t }) => <p title={t.x} className="mt-s2 text-h1">{t.offeneForderungen}</p>;');
    expect(f).toEqual([]);
  });

  it('schweigt zu Technik — className, href, name, id', () => {
    const f = festeZeichenketten(d,
      'export const A = () => <a className="text-brand" href="/portal/finanzen" id="x" name="y" />;');
    expect(f).toEqual([]);
  });

  it('schweigt zu Zeichen ohne Sprache', () => {
    expect(festeZeichenketten(d, 'export const A = () => <p>— · 12,50 %</p>;')).toEqual([]);
  });

  it('schweigt zur Nummer einer offenen Frage', () => {
    expect(festeZeichenketten(d, 'export const A = () => <p>(O-159)</p>;')).toEqual([]);
  });

  it('schweigt zu Normen und Formaten, die in beiden Sprachen gleich heissen', () => {
    const f = festeZeichenketten(d, 'export const A = () => <p>IBAN · ZUGFeRD · PDF · DSGVO</p>;');
    expect(f).toEqual([]);
  });

  it('liest einen generischen Typ nicht als Element', () => {
    const f = festeZeichenketten(d, 'const M: Record<string, string> = {}; export default M;');
    expect(f).toEqual([]);
  });
});

describe('die Ausnahmeliste', () => {
  it('ist sortiert und ohne Doppelung — sonst waechst sie unbemerkt', () => {
    const sortiert = [...UEBERSETZUNG_AUSNAHMEN].sort();
    expect(UEBERSETZUNG_AUSNAHMEN).toEqual(sortiert);
    expect(new Set(UEBERSETZUNG_AUSNAHMEN).size).toBe(UEBERSETZUNG_AUSNAHMEN.length);
  });

  it('fuehrt nur Pfade unter portal/ oder components/', () => {
    const fremd = UEBERSETZUNG_AUSNAHMEN.filter(
      (p) => !p.startsWith('src/app/portal/') && !p.startsWith('src/components/'));
    expect(fremd).toEqual([]);
  });
});
