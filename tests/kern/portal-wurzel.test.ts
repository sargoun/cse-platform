/**
 * `wurzel` ist die PORTALWURZEL — nicht der Abschnitt, in dem man gerade steht.
 *
 * **Der Befund aus einem Rundgang über alle Rollen.** Ein Klick durch jede
 * Adresse und jeden Verweis fand **97 verschiedene Ziele, die auf 404
 * führten** — und fast alle hatten dieselbe Ursache: elf Seiten reichten
 * `wurzel={`/portal/${mandant}/einstellungen`}` oder
 * `…/dokumente` durch, also den ABSCHNITT statt der Wurzel.
 *
 * `SeitenNavigation` und die Tab-Leiste lösen jeden Menüpunkt dagegen auf
 * (`tabZiel`). Auf `/portal/reinigung/dokumente/<id>` zeigte das Menü deshalb
 * auf `/portal/reinigung/dokumente/crm`, `…/dokumente/zeiten`,
 * `…/dokumente/finanzen/rechnungen` — **die ganze Navigation führte ins
 * Nichts**, auf elf Seiten, für jede Rolle mit einer Sidebar.
 *
 * Gemerkt hätte man es nie an einer einzelnen Seite: sie sieht richtig aus,
 * bis man einen Menüpunkt drückt, und wer dort arbeitet, kommt über den
 * Zurück-Knopf zurück und hält es für einen verirrten Klick.
 *
 * Die vier Wurzeln sind die vier Portale aus `portalWurzel()`. Alles darunter
 * ist ein Abschnitt und gehört nie in dieses Feld.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentareMitTexten } from './hilfen/quelltext.js';

const WURZEL = 'src/app/portal';

/** Was `portalWurzel()` zurueckgeben kann — und sonst nichts. */
const ERLAUBT = [
  '`/portal/${mandant}`',
  "'/portal/gruppe'", '`/portal/gruppe`',
  "'/portal/mein'", '`/portal/mein`',
  "'/portal/kunde'", '`/portal/kunde`',
  "'/auth/bereich'", '`/auth/bereich`',
];

function seiten(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...seiten(voll));
    else if (/\.tsx$/u.test(e)) treffer.push(voll);
  }
  return treffer;
}

const ALLE = seiten(WURZEL);
/**
 * Die vier Wurzeln, jeweils mit einem Segment dahinter — genau die Form, die
 * kaputt war. `[^`'"]` statt `.` hält die Suche innerhalb EINES Literals.
 */
const ZU_TIEF = [
  /wurzel=\{`\/portal\/\$\{mandant\}\/[^`]/u,
  /wurzel=\{['"`]\/portal\/(?:gruppe|mein|kunde)\/[^'"`]/u,
];

describe('kein Bauteil bekommt einen Abschnitt als Portalwurzel', () => {
  it('es gibt überhaupt Dateien mit einem `wurzel`', () => {
    const mit = ALLE.filter((f) => readFileSync(f, 'utf8').includes('wurzel='));
    expect(mit.length).toBeGreaterThan(20);
  });

  for (const datei of ALLE) {
    const quelle = ohneKommentareMitTexten(readFileSync(datei, 'utf8'));
    if (!quelle.includes('wurzel={')) continue;
    it(datei.slice(WURZEL.length + 1), () => {
      for (const muster of ZU_TIEF) {
        const treffer = muster.exec(quelle);
        expect(
          treffer?.[0] ?? null,
          'Ein ABSCHNITT als Portalwurzel — jeder Menuepunkt loest dann '
          + 'dagegen auf und fuehrt auf 404.',
        ).toBeNull();
      }
    });
  }

  it('und die vier erlaubten Wurzeln kommen wirklich vor', () => {
    // Sonst pruefte die Schleife oben eine Form, die niemand benutzt.
    const alles = ALLE.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const w of ERLAUBT.slice(0, 5)) expect(alles, w).toContain(w);
  });
});

describe('und die Auflösung selbst hängt nur an der Wurzel', () => {
  it('`tabZiel` hängt den Pfad an die Wurzel — absolute Ziele bleiben absolut', async () => {
    const { tabZiel } = await import('../../src/server/registry/tableiste.js');
    const ziel = { schluessel: 'crm', label: 'CRM', pfad: 'crm', recht: 'crm.lesen',
      icon: 'crm' as const };
    expect(tabZiel('/portal/reinigung', ziel)).toBe('/portal/reinigung/crm');
    // Genau der Fall, der 97 Ziele gebrochen hat:
    expect(tabZiel('/portal/reinigung/dokumente', ziel)).toBe('/portal/reinigung/dokumente/crm');
    expect(tabZiel('/portal/reinigung', { ...ziel, pfad: '' })).toBe('/portal/reinigung');
    expect(tabZiel('/portal/reinigung', { ...ziel, pfad: '/portal/konto/profil' }))
      .toBe('/portal/konto/profil');
  });
});
