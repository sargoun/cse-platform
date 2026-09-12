/**
 * PR 13 Akzeptanz (2)–(5) — die oeffentliche Startseite im Browser.
 *
 * Geprueft wird `/` und nicht mehr eine Entwicklungsflaeche mit festen
 * Beispielwerten. Der Unterschied ist nicht kosmetisch: die Fixture-Seite
 * konnte jede Zusage einhalten, waehrend die ausgelieferte Seite sie brach —
 * und niemand haette es gemerkt. Die Seite hier liest ihren Inhalt aus
 * `seite`/`abschnitt`, so wie ein Besucher sie bekommt.
 */
import { expect, test } from '@playwright/test';

test.describe('/ — die oeffentliche Startseite', () => {
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
    await page.goto('/', { waitUntil: 'networkidle' });
    expect(fremd).toEqual([]);
  });

  test('(2) jede Markenkarte traegt ihren Hue als 3px-Oberkante UND den Pflicht-Gradient', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');
    const farben = await page.locator('[data-cse="marken-karte"]')
      .evaluateAll((es) => es.map((e) => getComputedStyle(e).borderTopColor));
    expect(new Set(farben).size).toBe(4);
  });

  test('(3) genau EIN rotes Akzentwort auf der Seite (DESIGN §2)', async ({ page }) => {
    await page.goto('/');
    // Zwei sind kein Akzent mehr, sondern ein Stil.
    await expect(page.locator('[data-cse="akzent-wort"]')).toHaveCount(1);
  });

  test('(5) der Hero ist 21:9 am Schreibtisch und 4:5 am Telefon', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
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
    await page.goto('/');
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
    await page.goto('/');
    // Ein unauffälliger Platzhalter ist einer, der in Produktion landet.
    const marken = await page.locator('[data-cse="platzhalter-marke"]').count();
    expect(marken).toBeGreaterThan(0);
  });

  /**
   * **Die Gesellschaftswahl steht im KOPF** (DESIGN §6, D-381).
   *
   * Vorher stand hier die Markenavatar-Reihe unter dem Hero, und der Test
   * prueft dieselbe Frage an der neuen Stelle: nicht nur, DASS es die vier
   * Ziele gibt, sondern WO sie stehen — das war die Aussage, die zweimal
   * falsch war (erst Fussbereich, dann unter dem Hero).
   */
  test('die Gesellschaftswahl sitzt im Kopf und fuehrt zu allen vier',
    async ({ page }) => {
      await page.goto('/');
      const wahl = page.locator('[data-cse="gesellschaftswahl"]');
      await expect(wahl).toBeVisible();
      await expect(wahl.locator('[data-cse="gesellschaftswahl-ziel"]')).toHaveCount(4);

      // Im Kopf heisst: INNERHALB des Kopfelements, nicht bloss oberhalb von
      // etwas. Ein Element, das zufaellig weit oben liegt, erfuellt das nicht.
      await expect(
        page.locator('[data-cse="oeffentlicher-kopf"] [data-cse="gesellschaftswahl"]'),
      ).toHaveCount(1);

      // Und unter dem Hero steht sie NICHT mehr — die Reihe ist weg, nicht
      // verdoppelt. Zwei Wege zur selben Wahl waeren zwei Landmarken mit
      // demselben Namen.
      await expect(page.locator('[data-cse="marken-reihe"]')).toHaveCount(0);
    });

  test('sie oeffnet ohne JavaScript und nennt die offene Gesellschaft',
    async ({ page }) => {
      await page.goto('/unternehmen/bau');
      const wahl = page.locator('[data-cse="gesellschaftswahl"]');
      // `<details>` ist zu, bis jemand darauf tippt — ohne ein Skript.
      await expect(wahl).not.toHaveAttribute('open', /.*/u);
      await wahl.locator('summary').click();
      await expect(wahl).toHaveAttribute('open', /.*/u);

      const blatt = wahl.locator('[data-cse="gesellschaftswahl-blatt"]');
      await expect(blatt).toBeVisible();
      // Die Zusammenfassung zeigt, wo man IST. `aktiv` kam bis hierher nie an:
      // die alte Reihe bekam immer `null` und hat nie etwas hervorgehoben.
      await expect(wahl.locator('summary')).toContainText('REALTIME');
      await expect(blatt.locator('[aria-current="page"]')).toHaveCount(1);
    });

  test('der Fussbereich fuehrt dieselben vier Ziele — als Textlinks', async ({ page }) => {
    await page.goto('/');
    // Zwei `nav` mit demselben zugaenglichen Namen waeren ein mehrdeutiges
    // Landmark; der Fussbereich traegt deshalb einen eigenen.
    await expect(page.locator('footer [data-cse="fuss-gesellschaft"]')).toHaveCount(4);
    // Die Wahl sitzt im Kopf, nicht im Fuss — hier stehen Textlinks.
    await expect(page.locator('footer [data-cse="gesellschaftswahl"]')).toHaveCount(0);
  });
});
