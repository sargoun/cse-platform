/**
 * **Der Weg zur neuen Referenz ist verdrahtet — von der Liste, vom Auftrag, bis
 * auf das Blatt der neuen Zeile** (V-154, D-648, PRO-05).
 *
 * Was die Datenbank tut, prüft `tests/isolation/referenz-anlegen.test.ts`.
 * Hier steht, dass ein Mensch dorthin KOMMT: vorher gab es keinen Knopf, keine
 * Seite, keine Handlung in der Route — und der Hinweis an der Kundenfreigabe
 * versprach einen Weg, den es nicht gab.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeMitPfad } from '../../src/server/registry/routen.js';
import { WEBSITE_REFERENZ_TEXTE } from '../../src/lib/i18n/verwaltung/website-referenz.js';

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');

describe('die Liste bietet das Anlegen an — auch im Leerzustand', () => {
  const liste = lies('src/app/portal/[mandant]/website/referenzen/page.tsx');

  it('der Knopf führt auf /neu und steht nur mit BEIDEN Rechten', () => {
    expect(liste).toContain('/website/referenzen/neu');
    expect(liste).toMatch(/darfAnlegen = !nurLesen && darf\['referenz\.schreiben'\] === true\s+&& darf\['referenz\.kundenfreigabe_erfassen'\] === true/u);
  });

  it('der Leerzustand trägt ihn — dort fehlte er am meisten', () => {
    const leer = /cse="keine-referenzen">([\s\S]*?)<\/Hinweis>/u.exec(liste)?.[1] ?? '';
    expect(leer).toContain('anlegenKnopf');
  });
});

describe('die Seite und die Route', () => {
  it('/neu steht in der Seitenkarte, mit dem Tor der übrigen Referenzseiten', () => {
    const r = routeMitPfad('/portal/[mandant]/website/referenzen/neu');
    expect(r).toBeDefined();
    expect(r?.bewachung).toEqual({
      art: 'recht', lesen: ['referenz.schreiben'], schreiben: [], aal2: false,
    });
  });

  it('die Route kennt „anlegen" — VOR der Kennungsprüfung, und führt weiter', () => {
    const route = lies('src/app/api/website/referenz/route.ts');
    const anlegen = route.indexOf("handlung === 'anlegen'");
    const kennung = route.indexOf('UUID.test(id)');
    expect(anlegen).toBeGreaterThan(-1);
    expect(anlegen).toBeLessThan(kennung);
    expect(route).toContain('legeReferenzAn(kontext');
    expect(route).toMatch(/weiter: `\/portal\/\$\{neu\.bereich\}\/website\/referenzen\/\$\{neu\.id\}\?angelegt=1/u);
    // Die Weiche im Gerüst: ein `{ weiter }` ist ein Ziel, kein Abfrageteil.
    expect(lies('src/app/api/website/gemeinsam.ts')).toContain('ergebnis.weiter');
  });

  it('jeder Grund des Anlegens hat einen Satz — in beiden Sprachen', () => {
    for (const grund of ['titel_fehlt', 'slug_form', 'slug_vergeben', 'jahr_ungueltig',
      'kein_freigaberecht', 'nicht_angelegt']) {
      expect(WEBSITE_REFERENZ_TEXTE.de.fehler[grund], `de.${grund}`).toBeDefined();
      expect(WEBSITE_REFERENZ_TEXTE.en.fehler[grund], `en.${grund}`).toBeDefined();
    }
    expect(WEBSITE_REFERENZ_TEXTE.en.anlegen).not.toBe(WEBSITE_REFERENZ_TEXTE.de.anlegen);
  });
});

describe('vom Auftrag aus — nur mit geltender Freigabe, nur als Vorschlag', () => {
  it('die Kundenfreigabe am Auftrag verlinkt die Anlage, wenn die Freigabe GILT', () => {
    const seite = lies('src/app/portal/[mandant]/auftraege/[id]/kundenfreigabe/page.tsx');
    expect(seite).toContain('const gilt = freigabeGilt(stand)');
    expect(seite).toMatch(/gilt && darf\['referenz\.schreiben'\] === true && sitzung\.ansicht !== 'gruppe'/u);
    expect(seite).toContain('/website/referenzen/neu?auftrag=${id}');
  });

  it('das Anlegeformular belegt nur Titel und Kunde vor — aus einer geltenden Freigabe', () => {
    const neu = lies('src/app/portal/[mandant]/website/referenzen/neu/page.tsx');
    expect(neu).toContain('freigabeGilt(stand)');
    expect(neu).toContain('defaultValue={vorlage?.bezeichnung');
    expect(neu).toContain('defaultValue={vorlage?.kunde');
    // Kein Auftragswert, kein Ansprechpartner im Formular.
    expect(neu).not.toMatch(/vorlage\?\.(ansprechpartner|freigabe_text)/u);
  });

  it('das Blatt der neuen Referenz schlägt vor — der Haken bleibt leer', () => {
    const blatt = lies('src/app/portal/[mandant]/website/referenzen/[id]/page.tsx');
    expect(blatt).toContain('vorschlag?.freigabe_tag');
    expect(blatt).toContain('defaultChecked={r.freigegeben}');
    expect(blatt).not.toMatch(/defaultChecked=\{[^}]*vorschlag/u);
  });
});

describe('Veröffentlichen: eine Abweisung ist ein Satz, kein JSON', () => {
  it('die Route leitet mit dem Grund zurück, und beide Seiten lesen ihn', () => {
    expect(lies('src/app/api/website/referenzen/route.ts')).toContain('grundAufsFormular(');
    for (const seite of ['src/app/portal/[mandant]/website/referenzen/page.tsx',
      'src/app/portal/[mandant]/website/referenzen/[id]/veroeffentlichen/page.tsx']) {
      expect(lies(seite), seite).toContain('t.statusFehler[abgewiesen] ?? t.statusFehlerSonst');
    }
    for (const s of ['de', 'en'] as const) {
      expect(WEBSITE_REFERENZ_TEXTE[s].statusFehler['ohne_kundenfreigabe']).toBeDefined();
    }
  });
});
