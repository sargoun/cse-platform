/**
 * PR 13 Akzeptanz (2)–(5) — die oeffentliche Seite im Browser.
 */
import { expect, test } from '@playwright/test';

test.describe('/dev/website — die oeffentliche Startseite', () => {
  test('(4) NULL Anfragen an Dritte beim ersten Laden (PUB-13)', async ({ page }) => {
    /**
     * Daraus folgt, dass es keinen Cookie-Banner gibt: es gibt nichts zu
     * erlauben. Die Pruefung faengt jede Anfrage ab und zaehlt, was NICHT auf
     * den eigenen Host geht — Schriften, Analytik, Karten, alles.
     */
    const fremd: string[] = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost' && url.protocol !== 'data:') fremd.push(url.href);
      await route.continue();
    });
    await page.goto('/dev/website', { waitUntil: 'networkidle' });
    expect(fremd).toEqual([]);
  });

  test('(2) jede Markenkarte traegt ihren Hue als 3px-Oberkante UND den Pflicht-Gradient', async ({ page }) => {
    await page.goto('/dev/website');
    const karten = page.locator('[data-cse="marken-karte"]');
    await expect(karten).toHaveCount(4);

    for (let i = 0; i < 4; i += 1) {
      const karte = karten.nth(i);
      const stil = await karte.evaluate((e) => {
        const s = getComputedStyle(e);
        return { breite: s.borderTopWidth, farbe: s.borderTopColor };
      });
      expect(stil.breite).toBe('3px');
      // Die BERECHNETE Farbe: ein Token, das nicht auflöst, sähe im Markup
      // richtig aus und auf dem Schirm transparent.
      expect(stil.farbe).not.toBe('rgba(0, 0, 0, 0)');

      // Der Gradient ist Pflicht (§4.4) — eine Karte ohne ihn faellt durch.
      const gradient = await karte.locator('[data-cse="karten-gradient"]')
        .evaluate((e) => getComputedStyle(e).backgroundImage);
      expect(gradient).toContain('linear-gradient');
      expect(gradient).toContain('rgba(8, 8, 10, 0.15)');
    }
  });

  test('die vier Karten tragen VIER verschiedene Hues', async ({ page }) => {
    await page.goto('/dev/website');
    const farben = await page.locator('[data-cse="marken-karte"]')
      .evaluateAll((es) => es.map((e) => getComputedStyle(e).borderTopColor));
    expect(new Set(farben).size).toBe(4);
  });

  test('(3) genau EIN rotes Akzentwort auf der Seite (DESIGN §2)', async ({ page }) => {
    await page.goto('/dev/website');
    // Zwei sind kein Akzent mehr, sondern ein Stil.
    await expect(page.locator('[data-cse="akzent-wort"]')).toHaveCount(1);
  });

  test('(5) der Hero ist 21:9 am Schreibtisch und 4:5 am Telefon', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/website');
    const desktop = await page.locator('[data-cse="hero"]')
      .evaluate((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height);
    expect(desktop).toBeCloseTo(21 / 9, 1);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobil = await page.locator('[data-cse="hero"]')
      .evaluate((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height);
    expect(mobil).toBeCloseTo(4 / 5, 1);
  });

  test('(5) kein waagerechtes Scrollen bei 375px, und jedes Bild hat alt', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/dev/website');
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(ueberlauf).toBe(false);

    const ohneAlt = await page.locator('img').evaluateAll(
      (imgs) => imgs.filter((i) => (i.getAttribute('alt') ?? '').trim() === '').length,
    );
    expect(ohneAlt).toBe(0);
  });

  test('Platzhalterbilder sind SICHTBAR als solche markiert (§4.1)', async ({ page }) => {
    await page.goto('/dev/website');
    // Ein unauffälliger Platzhalter ist einer, der in Produktion landet.
    const marken = await page.locator('[data-cse="platzhalter-marke"]').count();
    expect(marken).toBeGreaterThan(0);
  });

  test('die Markenavatar-Reihe steht im Fussbereich (PUB-14)', async ({ page }) => {
    await page.goto('/dev/website');
    await expect(page.locator('[data-cse="marken-avatar"]')).toHaveCount(4);
  });
});
