/**
 * PR 16 Akzeptanz (1) und (5) — WCAG 2.1 AA auf JEDER oeffentlichen Route.
 *
 * **Warum jede und nicht eine Auswahl.** BFSG gilt fuer das Angebot, nicht fuer
 * die Startseite. Eine Stichprobe misst, wie sorgfaeltig die geprueften Seiten
 * gebaut wurden, und sagt ueber die uebrigen nichts — und die uebrigen sind
 * die, auf denen jemand ein Impressum oder einen Meldeweg sucht.
 *
 * Die Liste kommt aus `OEFFENTLICHE_ROUTEN`: eine neue Route ist damit
 * automatisch abgedeckt. Das ist der Unterschied zwischen einer Pruefung und
 * einer Erinnerung.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { OEFFENTLICHE_ROUTEN } from '../../src/server/services/inhalt/routen.js';

const ROUTEN = [...OEFFENTLICHE_ROUTEN.map((r) => r.pfad), '/barrierefreiheit'];

test.describe('(1) axe meldet NULL AA-Verstösse auf jeder öffentlichen Route', () => {
  for (const pfad of ROUTEN) {
    test(`axe: ${pfad}`, async ({ page }) => {
      const antwort = await page.goto(pfad);
      // Eine 404 mit null Verstössen wäre ein bestandener Test über eine
      // Seite, die es nicht gibt.
      expect(antwort?.status(), `${pfad} antwortet nicht mit 200`).toBe(200);

      const ergebnis = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // Benannt, damit ein Fehlschlag sagt WELCHE Regel — nicht nur wie viele.
      const verstoesse = ergebnis.violations.map(
        (v) => `${v.id}: ${v.help} (${String(v.nodes.length)}×)`,
      );
      expect(verstoesse, `${pfad}`).toEqual([]);
    });
  }
});

test.describe('(5) die Startseite ist vollständig mit der Tastatur bedienbar', () => {
  const BEDIENBAR =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

  /**
   * **Nur was gerade GERENDERT ist.**
   *
   * Ein geschlossenes `<details>` behaelt seinen Inhalt im DOM. Die Ziele des
   * Telefon-Menues stehen also auch am Schreibtisch in
   * `querySelectorAll(BEDIENBAR)` — unsichtbar, per Tab nicht erreichbar, und
   * `focus()` auf ihnen tut nichts. Ohne diesen Filter meldete die Pruefung
   * sie als „nicht erreichbar" und „ohne Fokusrahmen": zwei Fehlschlaege fuer
   * einen Zustand, der richtig ist. Ein verborgener Verweis SOLL nicht
   * fokussierbar sein; dass er es wird, sobald das Menue aufgeht, haelt
   * `firmenangaben.spec.ts` fest.
   *
   * `offsetParent` ist das Kriterium und nicht `visibility`: es ist genau
   * dann null, wenn das Element (oder ein Vorfahr) `display: none` traegt —
   * derselbe Test, den die Tap-Ziel-Pruefung schon benutzt.
   */
  const SICHTBAR = (e: Element): boolean =>
    (e as HTMLElement).offsetParent !== null
    || getComputedStyle(e).position === 'fixed';

  /**
   * Jedes Element bekommt eine eigene Nummer, bevor getabbt wird.
   *
   * Eine frühere Fassung erkannte die Elemente an ihrem `href` und brach ab,
   * sobald sie einen zweimal sah. Auf dieser Seite steht `/kontakt` in der
   * Kopfnavigation UND weiter unten — die Schleife hielt also mitten in der
   * Seite an und meldete Erfolg. Eine Prüfung, die zu früh aufhört, besteht
   * immer: das war der Beweis, dass sie nichts prüfte.
   */
  async function nummeriere(page: Page): Promise<number> {
    return page.evaluate((auswahl) => {
      const es = [...document.querySelectorAll(auswahl)].filter(
        (e) => (e as HTMLElement).offsetParent !== null
          || getComputedStyle(e).position === 'fixed',
      );
      es.forEach((e, i) => { e.setAttribute('data-a11y-nr', String(i)); });
      return es.length;
    }, BEDIENBAR);
  }

  test('jedes bedienbare Element wird per Tab ERREICHT', async ({ page }) => {
    await page.goto('/');
    const anzahl = await nummeriere(page);
    expect(anzahl, 'die Seite hat überhaupt bedienbare Elemente').toBeGreaterThan(4);

    const erreicht = new Set<string>();
    // Grosszügig, aber endlich: eine Fokusfalle läuft sonst ewig.
    for (let i = 0; i < anzahl * 3 + 10; i += 1) {
      await page.keyboard.press('Tab');
      const nr = await page.evaluate(
        () => document.activeElement?.getAttribute('data-a11y-nr') ?? null,
      );
      if (nr !== null) erreicht.add(nr);
      if (erreicht.size === anzahl) break;
    }

    const fehlend = [...Array(anzahl).keys()]
      .map(String).filter((n) => !erreicht.has(n));
    expect(fehlend, 'per Tastatur NICHT erreichbar (Index)').toEqual([]);
  });

  test('und zeigt im Fokus einen sichtbaren Ring — keines entfernt ihn', async ({ page }) => {
    await page.goto('/');
    const anzahl = await nummeriere(page);

    const ohneRing = await page.evaluate((auswahl) => {
      const schlecht: string[] = [];
      const sichtbare = [...document.querySelectorAll(auswahl)].filter(
        (e) => (e as HTMLElement).offsetParent !== null
          || getComputedStyle(e).position === 'fixed',
      );
      for (const e of sichtbare) {
        (e as HTMLElement).focus();
        const s = getComputedStyle(e);
        const sichtbar = (s.outlineStyle !== 'none' && s.outlineWidth !== '0px')
          || (s.boxShadow !== 'none' && s.boxShadow !== '');
        if (!sichtbar) {
          schlecht.push(
            `${e.tagName}[${e.getAttribute('data-a11y-nr') ?? '?'}] `
            + `${(e.getAttribute('href') ?? e.textContent ?? '').trim().slice(0, 40)}`,
          );
        }
      }
      return schlecht;
    }, BEDIENBAR);

    expect(anzahl).toBeGreaterThan(4);
    // `outline: none` ohne Ersatz ist die häufigste Art, eine Seite für
    // Tastaturnutzer unbedienbar zu machen, ohne dass es jemandem auffällt.
    expect(ohneRing, 'ohne sichtbaren Fokusrahmen').toEqual([]);
  });

  test('die rechtlichen Seiten sind von der Startseite aus verlinkt (§5 TMG, LEG-07)', async ({ page }) => {
    await page.goto('/');
    for (const ziel of ['/impressum', '/datenschutz', '/barrierefreiheit']) {
      await expect(
        page.locator(`a[href="${ziel}"]`),
        `${ziel} ist von der Startseite nicht erreichbar`,
      ).toHaveCount(1);
    }
  });
});
