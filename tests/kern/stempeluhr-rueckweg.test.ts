/**
 * „Heute" im Arbeiterportal schlägt den Schlüssel aus `?stempel=` nur als
 * EIGENEN Eintrag nach — `?stempel=__proto__` brachte die Startseite zum
 * Absturz (V-275, D-773, D-769 Befund Nr. 4, D-728).
 *
 * **Der Befund.** `POST /api/mein/stempeluhr` schickt nach dem Stempeln
 * `?stempel=eingecheckt|ausgecheckt|abgelehnt|schon_offen` zurück, und die
 * Stempeluhr (`portal/mein/bausteine.tsx`) schlug das Wort mit
 * `SAETZE[meldung] ?? null` in einem gewöhnlichen Objektliteral nach. Das erbt
 * von `Object.prototype`: `?stempel=__proto__` fand `Object.prototype` selbst,
 * das ist nicht `null`, der Rückfall griff nicht, und React warf „Objects are
 * not valid as a React child" — die Startseite jeder Beschäftigten war mit
 * einem Link, den jeder tippen kann, eine Fehlerseite.
 *
 * Geprüft wird der ECHTE Baustein, gerendert wie auf der Seite, in allen vier
 * Sprachen des Arbeiterportals.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StempelUhr } from '../../src/app/portal/mein/bausteine.js';
import { MEIN_TEXTE, PORTAL_SPRACHEN, type PortalSprache } from '../../src/lib/i18n/texte.js';

/* Die `.tsx`-Bausteine laufen hier mit der klassischen JSX-Umwandlung — sie erwarten `React`. */
(globalThis as { React?: typeof React }).React = React;

const WURZEL = resolve(import.meta.dirname, '../..');

function uhr(meldung: string | null, sprache: PortalSprache = 'de'): string {
  return renderToStaticMarkup(createElement(StempelUhr, {
    offen: null, schicht: null, texte: MEIN_TEXTE[sprache], meldung,
  }));
}

describe('die Stempeluhr auf „Heute" — ein Schlüssel aus der Adresse', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    '?stempel=%s: kein Absturz, kein Satz — die Uhr steht wie ohne Parameter',
    (schluessel) => {
      expect(() => uhr(schluessel)).not.toThrow();
      const html = uhr(schluessel);
      expect(html).not.toContain('data-cse="stempel-meldung"');
      expect(html).toBe(uhr(null));
    });

  it('ein unbekanntes Wort und ein Satz aus einem präparierten Link werden kein Text', () => {
    for (const roh of ['irgendwas', 'Sie sind entlassen.', '<b>x</b>', '']) {
      expect(uhr(roh)).not.toContain('data-cse="stempel-meldung"');
      expect(uhr(roh)).not.toContain('entlassen');
    }
  });

  it.each(PORTAL_SPRACHEN)('%s: jeder Schlüssel der Route wird sein Satz', (sprache) => {
    const u = MEIN_TEXTE[sprache].stempeluhr;
    for (const [schluessel, satz] of [
      ['eingecheckt', u.eingecheckt], ['ausgecheckt', u.ausgecheckt],
      ['abgelehnt', u.abgelehnt], ['schon_offen', u.schonOffen],
    ] as const) {
      const html = uhr(schluessel, sprache);
      expect(html, `${sprache}.${schluessel}`).toContain('data-cse="stempel-meldung"');
      expect(html, `${sprache}.${schluessel}`)
        .toContain(renderToStaticMarkup(createElement('p', null, satz)).slice(3, -4));
    }
  });

  it('die Route schickt nur diese vier Wörter — und der Baustein schlägt als eigener Eintrag nach', () => {
    const route = readFileSync(resolve(WURZEL, 'src/app/api/mein/stempeluhr/route.ts'), 'utf8');
    expect(route).toContain('/portal/mein?stempel=schon_offen');
    expect(route).toContain('/portal/mein?stempel=${ergebnis}');
    const baustein = readFileSync(resolve(WURZEL, 'src/app/portal/mein/bausteine.tsx'), 'utf8');
    expect(baustein).toContain('eigenerEintrag(SAETZE, meldung)');
    expect(baustein).not.toMatch(/SAETZE\[meldung\]/u);
  });
});
