/**
 * PR 8 Akzeptanz (1), (2), (5) — die Shell im Browser.
 *
 * Diese drei sind Aussagen über das DOM und über die Tastatur; sie lassen sich
 * nur dort prüfen, wo beides existiert.
 */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/dev/portal');
});

test.describe('/dev/portal — die Portal-Shell', () => {
  test('(4b) der Identitätsstreifen liegt ganz oben und trägt den Hue des Bereichs', async ({ page }) => {
    const streifen = page.locator('[data-cse="identitaets-streifen"]');
    await expect(streifen).toHaveAttribute('data-bereich', 'reinigung');
    await expect(streifen).toHaveCSS('height', '3px');
  });

  test('(2) ein Wechsel ändert die berechnete Farbe des Streifens', async ({ page }) => {
    const streifen = page.locator('[data-cse="identitaets-streifen"]');
    const vorher = await streifen.evaluate((e) => getComputedStyle(e).backgroundColor);

    await page.click('[data-cse="umschalter-ausloeser"]');
    await page.getByRole('menuitem', { name: /SSE Security/ }).click();

    await expect(streifen).toHaveAttribute('data-bereich', 'security');
    const nachher = await streifen.evaluate((e) => getComputedStyle(e).backgroundColor);
    // Die BERECHNETE Farbe, nicht der Klassenname: ein Token, das nicht
    // aufgelöst wird, sähe im Markup richtig aus und auf dem Schirm grau.
    expect(nachher).not.toBe(vorher);
  });

  test('(3) die Gruppenansicht trägt NUR LESEN — im Menü und im Header', async ({ page }) => {
    await page.click('[data-cse="umschalter-ausloeser"]');
    await expect(page.locator('[data-cse="gruppenuebersicht"]')).toContainText('Nur Lesen');

    await page.getByRole('menuitem', { name: /Gruppenübersicht/ }).click();
    await expect(page.locator('[data-cse="header-nur-lesen"]')).toContainText('Nur Lesen');
    // Und der Streifen ist neutral: in der Gruppenansicht ist kein Bereich aktiv.
    await expect(page.locator('[data-cse="identitaets-streifen"]'))
      .toHaveAttribute('data-bereich', 'gruppe');
  });

  test('(5) ⌘K öffnet den Umschalter', async ({ page }) => {
    await expect(page.locator('[data-cse="umschalter-menue"]')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toBeVisible();
  });

  test('(5) Pfeile navigieren, Enter wechselt, Esc schliesst — ohne Maus', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Von Reinigung eine Zeile runter: Security.
    await expect(page.locator('[data-cse="identitaets-streifen"]'))
      .toHaveAttribute('data-bereich', 'security');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toHaveCount(0);
  });

  test('(5) axe meldet NULL Verstösse — auch bei geöffnetem Dropdown', async ({ page }) => {
    await page.click('[data-cse="umschalter-ausloeser"]');
    await expect(page.locator('[data-cse="umschalter-menue"]')).toBeVisible();
    const ergebnis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ergebnis.violations).toEqual([]);
  });

  test('am Telefon ist die Navigation eine Tab-Leiste, kein aufgeklapptes Menü', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-cse="tableiste"]')).toBeVisible();
    await expect(page.locator('[data-cse="sidebar"]')).toBeHidden();
    // §8: Tap-Ziele mindestens 44px.
    const hoehe = await page.locator('[data-cse="tableiste"] a').first()
      .evaluate((e) => e.getBoundingClientRect().height);
    expect(hoehe).toBeGreaterThanOrEqual(44);
  });

  test('und am Schreibtisch umgekehrt', async ({ page }) => {
    await expect(page.locator('[data-cse="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-cse="tableiste"]')).toBeHidden();
  });
});
