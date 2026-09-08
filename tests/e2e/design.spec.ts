import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * PR 2 acceptance (2), (5), (7) — the assertions that need a real browser.
 *
 * axe and a 375px viewport are not a formality here: BFSG applies to this
 * platform, and "data tables become stacked cards below 768px" is a promise to
 * a worker checking their hours on a phone, on site.
 */
test.describe('/dev/kitchensink', () => {
  test('(2) axe reports ZERO accessibility violations', async ({ page }) => {
    await page.goto('/dev/kitchensink');
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Named, so a failure says WHICH rule rather than just a count.
    const verstoesse = ergebnis.violations.map((v) => `${v.id}: ${v.help}`);
    expect(verstoesse).toEqual([]);
  });

  test('(3) every interactive element shows a focus ring — none removes it', async ({ page }) => {
    await page.goto('/dev/kitchensink');
    const knopf = page.getByRole('button', { name: 'Angebot anfragen' });
    await knopf.focus();
    const schatten = await knopf.evaluate((el) => getComputedStyle(el).boxShadow);
    // The ring is rgba(227,6,19,0.40) — asserted by its channel values, so a
    // renamed token cannot make this pass silently.
    expect(schatten).toContain('227');
    expect(schatten).not.toBe('none');
  });

  test('(4) with prefers-reduced-motion, no transform transition runs', async ({ browser }) => {
    const kontext = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await kontext.newPage();
    await page.goto('/dev/kitchensink');
    const eigenschaft = await page
      .getByRole('button', { name: 'Angebot anfragen' })
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(eigenschaft).toBe('opacity');
    await kontext.close();
  });

  test('(5) at 375px the table is stacked cards, with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/dev/kitchensink');

    await expect(page.locator('[data-cse="tabelle"]')).toBeHidden();
    await expect(page.locator('[data-cse="stapel"]')).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);
  });

  test('at 1280px the table is a real table', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dev/kitchensink');
    await expect(page.locator('[data-cse="tabelle"]')).toBeVisible();
    await expect(page.locator('[data-cse="stapel"]')).toBeHidden();
  });

  test('(7) money renders 1.234,56 € with a non-breaking space', async ({ page }) => {
    await page.goto('/dev/kitchensink');
    const text = await page.locator('[data-cse="tabelle"] td.cse-zahl').first().innerText();
    expect(text).toMatch(/^1\.234,56 €$/u);
  });

  test('amounts are right-aligned with tabular figures', async ({ page }) => {
    await page.goto('/dev/kitchensink');
    const zelle = page.locator('[data-cse="tabelle"] td.cse-zahl').first();
    const stil = await zelle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { align: s.textAlign, ziffern: s.fontVariantNumeric };
    });
    expect(stil.align).toBe('right');
    expect(stil.ziffern).toContain('tabular-nums');
  });

  test('the placeholder register renders, so nothing ships unnoticed', async ({ page }) => {
    await page.goto('/dev/kitchensink');
    const eintraege = page.locator('[data-cse="platzhalter"] li');
    expect(await eintraege.count()).toBeGreaterThan(0);
    await expect(eintraege.first()).toContainText('Platzhalter');
  });
});
