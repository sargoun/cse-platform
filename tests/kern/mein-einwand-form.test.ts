/**
 * Die kleinen Punkte der zweiten Prüfung am Arbeiterportal (V-193).
 *
 *  - Die Einwandliste schreibt jeden Tag in DERSELBEN, der gesetzlichen Form
 *    (TT.MM.JJJJ, Berliner Kalendertag, SEITENKARTE §12) — vorher stand der
 *    Tag des Einwands deutsch da und daneben Eingangs- und Entscheidungstag
 *    nach Sprache (englisch 09/21/2026, arabisch mit anderen Ziffern).
 *  - Die Pause trägt ihre Einheit in der Sprache der Kraft, nicht „(min)".
 *  - Die Gesellschaft ist eine Pflichtwahl OHNE Vorauswahl (D-09): ein leerer
 *    erster Eintrag, `required` verlangt die Wahl.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EinwandListe } from '../../src/app/portal/mein/bausteine.js';
import { meinTexte, PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import type { EinwandZeile } from '../../src/server/services/zeit/einwand.js';

/* Klassische JSX-Umwandlung dieses Testläufers — `React` im Geltungsbereich (wie V-153). */
(globalThis as { React?: typeof React }).React = React;

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

const EINWAND: EinwandZeile = {
  id: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e',
  mandantId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6f',
  anstellungId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d70',
  personId: '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d71',
  personName: 'Fatima Yilmaz',
  zeiteintragId: null,
  art: 'eintrag_fehlt',
  betrifftDatum: '2026-09-21',
  behauptetBeginn: null,
  behauptetEnde: null,
  behauptetPauseMinuten: null,
  begruendung: 'Die Marke ging nicht.',
  status: 'anerkannt',
  // 22:30 UTC am 21.09. ist in Berlin schon der 22.09. (MESZ, 00:30).
  eingereichtAm: new Date('2026-09-21T22:30:00Z'),
  entschiedenAm: new Date('2026-09-23T08:00:00Z'),
  entscheidungBegruendung: 'Nachgetragen.',
};

describe('EinwandListe — jeder Tag in der gesetzlichen Form, in jeder Sprache', () => {
  for (const sprache of PORTAL_SPRACHEN) {
    it(`${sprache}: Tag, Eingang und Entscheidung als TT.MM.JJJJ (Berlin)`, () => {
      const html = renderToStaticMarkup(createElement(EinwandListe, {
        einwaende: [EINWAND], texte: meinTexte(sprache), sprache,
      }));
      expect(html).toContain('21.09.2026');
      // Der Eingang ist der Berliner Tag des Zeitpunkts, nicht der UTC-Tag.
      expect(html).toContain('22.09.2026');
      expect(html).toContain('23.09.2026');
      expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}/u);
      expect(html).not.toMatch(/[٠-٩]/u);
    });
  }
});

describe('die Formulare des Arbeiterportals', () => {
  it('die Pause trägt ihre Einheit in der Sprache der Kraft — kein festes „(min)"', () => {
    for (const seite of ['src/app/portal/mein/zeiten/einwand/page.tsx',
      'src/app/portal/mein/zeiten/[id]/einwand/page.tsx']) {
      const text = lies(seite);
      expect(text, seite).not.toContain('(min)');
      expect(text, seite).toContain('{t.pauseMinuten}');
    }
    for (const sprache of PORTAL_SPRACHEN) {
      expect(meinTexte(sprache).pauseMinuten.trim(), sprache).not.toBe('');
    }
  });

  it('die Gesellschaft ist eine Pflichtwahl ohne Vorauswahl (D-09)', () => {
    for (const [seite, id] of [
      ['src/app/portal/mein/zeiten/einwand/page.tsx', 'fehlt-anstellung'],
      ['src/app/portal/mein/antraege/neu/page.tsx', 'antrag-anstellung'],
      ['src/app/portal/mein/abwesenheit/neu/page.tsx', 'abw-anstellung'],
    ] as const) {
      const text = lies(seite);
      const auswahl = text.slice(text.indexOf(`<select id="${id}"`));
      const kopf = auswahl.slice(0, auswahl.indexOf('{basis.anstellungen.map'));
      expect(kopf, seite).toContain('required');
      expect(kopf, seite).toContain('<option value="">{t.gesellschaftWaehlen}</option>');
      expect(kopf, seite).toMatch(/defaultValue=\{[^}]*\?\? ''\}/u);
    }
    for (const sprache of PORTAL_SPRACHEN) {
      expect(meinTexte(sprache).gesellschaftWaehlen.trim(), sprache).not.toBe('');
    }
  });
});
